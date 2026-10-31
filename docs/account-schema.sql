-- New isolated account objects only. Existing demo/prod tables and auth settings are untouched.
-- Apply once after pgcrypto/extensions preflight and review. Credentials are registered separately.
begin;
do $$begin
  if pg_catalog.to_regprocedure('extensions.digest(text,text)') is null
     or not pg_catalog.has_schema_privilege('anon','extensions','USAGE')
     or not pg_catalog.has_schema_privilege('authenticated','extensions','USAGE') then
    raise exception 'Preflight: verified pgcrypto digest in extensions and schema USAGE for API roles are required';
  end if;
end;$$;
create schema portfolio_account_private;
revoke all on schema portfolio_account_private from public, anon, authenticated;
grant usage on schema portfolio_account_private to authenticated, anon;

create table portfolio_account_private.portfolio_account_backend_credentials (
  app text primary key check (app in ('webhooklab','fieldpilot','payroute')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$')
);
create table portfolio_account_private.portfolio_account_workspaces (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  app text not null check (app in ('webhooklab','fieldpilot','payroute')),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  revision integer not null default 0 check (revision between 0 and 2147483646),
  state jsonb not null check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 524288),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ingestion_key_hash text check (ingestion_key_hash is null or (app = 'webhooklab' and ingestion_key_hash ~ '^[a-f0-9]{64}$')),
  unique(id,app)
);
create table portfolio_account_private.portfolio_account_memberships (
  workspace_id uuid not null references portfolio_account_private.portfolio_account_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','staff','viewer')),
  created_at timestamptz not null default now(),
  primary key(workspace_id,user_id)
);
create index portfolio_account_memberships_user on portfolio_account_private.portfolio_account_memberships(user_id);
create table portfolio_account_private.portfolio_account_invitations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  workspace_id uuid not null references portfolio_account_private.portfolio_account_workspaces(id) on delete cascade,
  email text not null check (char_length(email) between 3 and 254 and email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text not null check (role in ('editor','staff','viewer')),
  invited_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  unique(workspace_id,email)
);

alter table portfolio_account_private.portfolio_account_backend_credentials enable row level security;
alter table portfolio_account_private.portfolio_account_backend_credentials force row level security;
alter table portfolio_account_private.portfolio_account_workspaces enable row level security;
alter table portfolio_account_private.portfolio_account_workspaces force row level security;
alter table portfolio_account_private.portfolio_account_memberships enable row level security;
alter table portfolio_account_private.portfolio_account_memberships force row level security;
alter table portfolio_account_private.portfolio_account_invitations enable row level security;
alter table portfolio_account_private.portfolio_account_invitations force row level security;
-- No permissive table policies or client grants. Only the checked gateway below can touch these rows.
revoke all on all tables in schema portfolio_account_private from public, anon, authenticated;

create function portfolio_account_private.verified_email() returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_email text;
begin
  select pg_catalog.lower(u.email) into v_email from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null and u.email is not null;
  if v_email is null then raise exception 'Verified account required' using errcode = '42501'; end if;
  return v_email;
end;
$$;
create function portfolio_account_private.require_backend(p_app text, p_key text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' or not exists (
    select 1 from portfolio_account_private.portfolio_account_backend_credentials c
    where c.app = p_app and c.key_hash = pg_catalog.encode(extensions.digest(p_key,'sha256'),'hex')
  ) then raise exception 'Backend credential required' using errcode = '42501'; end if;
end;
$$;
create function portfolio_account_private.member_role(p_app text,p_workspace_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  perform portfolio_account_private.verified_email();
  select m.role into v_role from portfolio_account_private.portfolio_account_memberships m
    join portfolio_account_private.portfolio_account_workspaces w on w.id = m.workspace_id
    where w.id = p_workspace_id and w.app = p_app and m.user_id = auth.uid();
  if v_role is null then raise exception 'Workspace unavailable' using errcode = '42501'; end if;
  return v_role;
end;
$$;
create function portfolio_account_private.row_result(p_workspace_id uuid,p_role text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'state',case when w.app = 'webhooklab' and p_role = 'viewer' then w.state - 'secret' else w.state end,
    'revision',w.revision,'role',p_role,
    'workspace',pg_catalog.jsonb_build_object('id',w.id,'name',w.name,'ingestionConfigured',w.ingestion_key_hash is not null)
  ) from portfolio_account_private.portfolio_account_workspaces w where w.id = p_workspace_id;
$$;
create function portfolio_account_private.read_workspace(p_app text,p_workspace_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_role text;
begin
  v_role := portfolio_account_private.member_role(p_app,p_workspace_id);
  return portfolio_account_private.row_result(p_workspace_id,v_role);
end;
$$;

create function portfolio_account_private.cas_workspace(p_app text,p_workspace_id uuid,p_expected_revision integer,p_command text,p_state jsonb,p_backend_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_role text; v_row portfolio_account_private.portfolio_account_workspaces%rowtype; v_job jsonb; v_next jsonb; v_changed integer := 0; v_i integer := 0;
begin
  perform portfolio_account_private.require_backend(p_app,p_backend_key);
  select * into v_row from portfolio_account_private.portfolio_account_workspaces where id = p_workspace_id and app = p_app for update;
  v_role := portfolio_account_private.member_role(p_app,p_workspace_id);
  if v_role = 'viewer' then raise exception 'Read only membership' using errcode = '42501'; end if;
  if p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object' or pg_catalog.octet_length(p_state::text) > 524288 or p_expected_revision is null then raise exception 'Invalid workspace state' using errcode = '22023'; end if;
  if v_row.revision <> p_expected_revision then return pg_catalog.jsonb_build_object('ok',false); end if;
  if not ((p_app = 'fieldpilot' and p_command = any(array['create_customer','create_estimate','approve_estimate','move_job','create_invoice','pay_invoice']))
    or (p_app = 'payroute' and p_command = any(array['simulate','provider','route','reconcile','reset']))
    or (p_app = 'webhooklab' and p_command = any(array['sample','capture','replay','advance-clock','reset','rotate-secret','settings']))) then raise exception 'Unknown command' using errcode = '22023'; end if;
  if v_role = 'staff' then
    if p_app <> 'fieldpilot' or p_command <> 'move_job'
      or (p_state - array['jobs','activity']) is distinct from (v_row.state - array['jobs','activity'])
      or pg_catalog.jsonb_typeof(p_state->'jobs') is distinct from 'array'
      or pg_catalog.jsonb_typeof(p_state->'activity') is distinct from 'array'
      or pg_catalog.jsonb_array_length(p_state->'jobs') <> pg_catalog.jsonb_array_length(v_row.state->'jobs') then raise exception 'Staff scope exceeded' using errcode = '42501'; end if;
    for v_job in select value from pg_catalog.jsonb_array_elements(v_row.state->'jobs') loop
      v_next := p_state->'jobs'->v_i;
      if (v_job - 'status') is distinct from (v_next - 'status') then raise exception 'Staff job scope exceeded' using errcode = '42501'; end if;
      if v_job->>'status' is distinct from v_next->>'status' then
        v_changed := v_changed + 1;
        if not ((v_job->>'status' = 'scheduled' and v_next->>'status' = 'in_progress') or (v_job->>'status' = 'in_progress' and v_next->>'status' = 'completed')) then raise exception 'Invalid job transition' using errcode = '42501'; end if;
      end if;
      v_i := v_i + 1;
    end loop;
    if v_changed <> 1 then raise exception 'Staff must move one job' using errcode = '42501'; end if;
  elsif v_role = 'editor' and p_app = 'payroute' then
    if p_command not in ('simulate','reconcile') or (p_state - array['transactions','reconciliation']) is distinct from (v_row.state - array['transactions','reconciliation']) then raise exception 'Provider settings require ownership' using errcode = '42501'; end if;
    if p_command = 'reconcile' and p_state->'transactions' is distinct from v_row.state->'transactions' then raise exception 'Reconciliation cannot rewrite payments' using errcode = '42501'; end if;
  elsif v_role = 'editor' and p_app = 'webhooklab' then
    if p_command not in ('sample','capture','replay','advance-clock') then raise exception 'Endpoint settings require ownership' using errcode = '42501'; end if;
    if p_command = 'advance-clock' then
      if (p_state - 'clock') is distinct from (v_row.state - 'clock') then raise exception 'Clock scope exceeded' using errcode = '42501'; end if;
    elsif (p_state - 'events') is distinct from (v_row.state - 'events') then raise exception 'Event scope exceeded' using errcode = '42501'; end if;
  end if;
  update portfolio_account_private.portfolio_account_workspaces set state = p_state,revision = revision + 1,updated_at = pg_catalog.now() where id = p_workspace_id;
  return portfolio_account_private.row_result(p_workspace_id,v_role) || pg_catalog.jsonb_build_object('ok',true);
end;
$$;

create function portfolio_account_private.team(p_app text,p_workspace_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_selected uuid; v_role text; v_result jsonb; v_inv record;
begin
  if p_app not in ('webhooklab','fieldpilot','payroute') or p_app is null then raise exception 'Invalid app' using errcode = '22023'; end if;
  v_email := portfolio_account_private.verified_email();
  -- Match only the database's verified current auth.users email. No JWT email or user_metadata trust.
  for v_inv in select i.* from portfolio_account_private.portfolio_account_invitations i
    join portfolio_account_private.portfolio_account_workspaces w on w.id = i.workspace_id
    where i.email = v_email and i.expires_at > pg_catalog.now() and w.app = p_app for update of i
  loop
    insert into portfolio_account_private.portfolio_account_memberships(workspace_id,user_id,role)
      values(v_inv.workspace_id,auth.uid(),v_inv.role) on conflict(workspace_id,user_id) do nothing;
    delete from portfolio_account_private.portfolio_account_invitations where id = v_inv.id;
  end loop;
  select pg_catalog.jsonb_build_object('workspaces',coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',w.id,'name',w.name,'role',m.role) order by w.created_at,w.id),'[]'::jsonb))
    into v_result from portfolio_account_private.portfolio_account_workspaces w
    join portfolio_account_private.portfolio_account_memberships m on m.workspace_id = w.id
    where w.app = p_app and m.user_id = auth.uid();
  if p_workspace_id is null then
    select w.id into v_selected from portfolio_account_private.portfolio_account_workspaces w
      join portfolio_account_private.portfolio_account_memberships m on m.workspace_id = w.id
      where w.app = p_app and m.user_id = auth.uid() order by w.created_at,w.id limit 1;
  else v_selected := p_workspace_id; end if;
  if v_selected is null then return v_result; end if;
  v_role := portfolio_account_private.member_role(p_app,v_selected);
  v_result := v_result || pg_catalog.jsonb_build_object('workspaceId',v_selected,'members',(
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('userId',m.user_id,'email',u.email,'role',m.role) order by m.created_at,m.user_id),'[]'::jsonb)
    from portfolio_account_private.portfolio_account_memberships m join auth.users u on u.id = m.user_id where m.workspace_id = v_selected));
  if v_role = 'owner' then
    v_result := v_result || pg_catalog.jsonb_build_object('pendingInvitations',(
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',i.id,'email',i.email,'role',i.role) order by i.created_at),'[]'::jsonb)
      from portfolio_account_private.portfolio_account_invitations i where i.workspace_id = v_selected and i.expires_at > pg_catalog.now()));
  end if;
  return v_result;
end;
$$;

create function portfolio_account_private.manage_team(p_app text,p_action text,p_workspace_id uuid,p_name text,p_email text,p_user_id uuid,p_role text,p_seed jsonb,p_backend_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_id uuid; v_role text; v_target_role text;
begin
  v_email := portfolio_account_private.verified_email();
  if p_app not in ('webhooklab','fieldpilot','payroute') or p_app is null then raise exception 'Invalid app' using errcode = '22023'; end if;
  if p_action = 'create' then
    perform portfolio_account_private.require_backend(p_app,p_backend_key);
    if p_name is null or pg_catalog.char_length(pg_catalog.btrim(p_name)) not between 1 and 80 or p_seed is null or pg_catalog.jsonb_typeof(p_seed) <> 'object' or pg_catalog.octet_length(p_seed::text) > 524288 then raise exception 'Invalid workspace details' using errcode = '22023'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text || ':' || p_app,0));
    if (select count(*) from portfolio_account_private.portfolio_account_workspaces where app = p_app and created_by = auth.uid()) >= 10 then raise exception 'Workspace limit reached' using errcode = '22023'; end if;
    insert into portfolio_account_private.portfolio_account_workspaces(app,name,state,created_by) values(p_app,pg_catalog.btrim(p_name),p_seed,auth.uid()) returning id into v_id;
    -- Owner is assigned here only. No API role field can grant ownership.
    insert into portfolio_account_private.portfolio_account_memberships(workspace_id,user_id,role) values(v_id,auth.uid(),'owner');
    return portfolio_account_private.team(p_app,v_id);
  end if;
  perform 1 from portfolio_account_private.portfolio_account_workspaces where id = p_workspace_id and app = p_app for update;
  v_role := portfolio_account_private.member_role(p_app,p_workspace_id);
  if v_role <> 'owner' then raise exception 'Workspace owner required' using errcode = '42501'; end if;
  if p_action in ('invite','role') and (p_role is null or p_role not in ('editor','staff','viewer') or (p_role = 'staff' and p_app <> 'fieldpilot')) then raise exception 'Invalid team role' using errcode = '22023'; end if;
  if p_action = 'invite' then
    if p_email is null or pg_catalog.char_length(p_email) not between 3 and 254 or p_email <> pg_catalog.lower(pg_catalog.btrim(p_email)) or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_email = v_email then raise exception 'Invalid invitation email' using errcode = '22023'; end if;
    if exists(select 1 from portfolio_account_private.portfolio_account_memberships m join auth.users u on u.id = m.user_id where m.workspace_id = p_workspace_id and pg_catalog.lower(u.email) = p_email) then raise exception 'Already a member' using errcode = '22023'; end if;
    delete from portfolio_account_private.portfolio_account_invitations where workspace_id = p_workspace_id and expires_at <= pg_catalog.now();
    if (select count(*) from portfolio_account_private.portfolio_account_memberships where workspace_id = p_workspace_id) + (select count(*) from portfolio_account_private.portfolio_account_invitations where workspace_id = p_workspace_id) >= 100 then raise exception 'Team limit reached' using errcode = '22023'; end if;
    insert into portfolio_account_private.portfolio_account_invitations(workspace_id,email,role,invited_by) values(p_workspace_id,p_email,p_role,auth.uid())
      on conflict(workspace_id,email) do update set role = excluded.role,invited_by = excluded.invited_by,expires_at = pg_catalog.now() + interval '7 days';
  elsif p_action in ('role','remove') then
    select role into v_target_role from portfolio_account_private.portfolio_account_memberships where workspace_id = p_workspace_id and user_id = p_user_id;
    if v_target_role is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
    if p_user_id = auth.uid() or v_target_role = 'owner' then raise exception 'Cannot remove or change ownership' using errcode = '42501'; end if;
    if p_action = 'role' then update portfolio_account_private.portfolio_account_memberships set role = p_role where workspace_id = p_workspace_id and user_id = p_user_id;
    else delete from portfolio_account_private.portfolio_account_memberships where workspace_id = p_workspace_id and user_id = p_user_id; end if;
  else raise exception 'Invalid team action' using errcode = '22023'; end if;
  return portfolio_account_private.team(p_app,p_workspace_id);
end;
$$;

create function portfolio_account_private.integration_key(p_app text,p_workspace_id uuid,p_key_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from portfolio_account_private.portfolio_account_workspaces where id = p_workspace_id and app = p_app for update;
  if p_app <> 'webhooklab' or portfolio_account_private.member_role(p_app,p_workspace_id) <> 'owner' then raise exception 'Endpoint owner required' using errcode = '42501'; end if;
  if p_key_hash is not null and p_key_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid key hash' using errcode = '22023'; end if;
  update portfolio_account_private.portfolio_account_workspaces set ingestion_key_hash = p_key_hash,updated_at = pg_catalog.now() where id = p_workspace_id;
  return pg_catalog.jsonb_build_object('workspaceId',p_workspace_id,'configured',p_key_hash is not null);
end;
$$;
create function portfolio_account_private.require_ingest(p_workspace_id uuid,p_integration_key text,p_backend_key text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform portfolio_account_private.require_backend('webhooklab',p_backend_key);
  if p_integration_key is null or p_integration_key !~ '^whk_ingest_[a-f0-9]{64}$' or not exists (
    select 1 from portfolio_account_private.portfolio_account_workspaces w where w.id = p_workspace_id and w.app = 'webhooklab'
    and w.ingestion_key_hash = pg_catalog.encode(extensions.digest(p_integration_key,'sha256'),'hex')
  ) then raise exception 'Integration credential required' using errcode = '42501'; end if;
end;
$$;
create function portfolio_account_private.ingest_read(p_workspace_id uuid,p_integration_key text,p_backend_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform portfolio_account_private.require_ingest(p_workspace_id,p_integration_key,p_backend_key);
  return (select pg_catalog.jsonb_build_object('state',state,'revision',revision) from portfolio_account_private.portfolio_account_workspaces where id = p_workspace_id and app = 'webhooklab');
end;
$$;
create function portfolio_account_private.ingest_cas(p_workspace_id uuid,p_integration_key text,p_backend_key text,p_expected_revision integer,p_state jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row portfolio_account_private.portfolio_account_workspaces%rowtype;
begin
  select * into v_row from portfolio_account_private.portfolio_account_workspaces where id = p_workspace_id and app = 'webhooklab' for update;
  perform portfolio_account_private.require_ingest(p_workspace_id,p_integration_key,p_backend_key);
  if p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object' or pg_catalog.octet_length(p_state::text) > 524288 or pg_catalog.jsonb_typeof(p_state->'events') is distinct from 'array' then raise exception 'Invalid event state' using errcode = '22023'; end if;
  if p_expected_revision is null or v_row.revision <> p_expected_revision then return pg_catalog.jsonb_build_object('ok',false); end if;
  -- Ingestion may capture events only; it cannot change signing secret, clock, settings or membership.
  if (p_state - 'events') is distinct from (v_row.state - 'events') then raise exception 'Ingestion scope exceeded' using errcode = '42501'; end if;
  update portfolio_account_private.portfolio_account_workspaces set state = p_state,revision = revision + 1,updated_at = pg_catalog.now() where id = p_workspace_id;
  return pg_catalog.jsonb_build_object('ok',true,'state',p_state,'revision',v_row.revision + 1);
end;
$$;

-- Public wrappers have no elevated privileges. Private gateways intentionally centralize checks.
create function public.portfolio_account_read(p_app text,p_workspace_id uuid) returns jsonb language sql security invoker set search_path = '' as $$select portfolio_account_private.read_workspace(p_app,p_workspace_id)$$;
create function public.portfolio_account_cas(p_app text,p_workspace_id uuid,p_expected_revision integer,p_command text,p_state jsonb,p_backend_key text) returns jsonb language sql security invoker set search_path = '' as $$select portfolio_account_private.cas_workspace(p_app,p_workspace_id,p_expected_revision,p_command,p_state,p_backend_key)$$;
create function public.portfolio_account_team(p_app text,p_workspace_id uuid) returns jsonb language sql security invoker set search_path = '' as $$select portfolio_account_private.team(p_app,p_workspace_id)$$;
create function public.portfolio_account_manage_team(p_app text,p_action text,p_workspace_id uuid,p_name text,p_email text,p_user_id uuid,p_role text,p_seed jsonb,p_backend_key text) returns jsonb language sql security invoker set search_path = '' as $$select portfolio_account_private.manage_team(p_app,p_action,p_workspace_id,p_name,p_email,p_user_id,p_role,p_seed,p_backend_key)$$;
create function public.portfolio_account_integration_key(p_app text,p_workspace_id uuid,p_key_hash text) returns jsonb language sql security invoker set search_path = '' as $$select portfolio_account_private.integration_key(p_app,p_workspace_id,p_key_hash)$$;
create function public.portfolio_account_ingest_read(p_workspace_id uuid,p_integration_key text,p_backend_key text) returns jsonb language sql security invoker set search_path = '' as $$select portfolio_account_private.ingest_read(p_workspace_id,p_integration_key,p_backend_key)$$;
create function public.portfolio_account_ingest_cas(p_workspace_id uuid,p_integration_key text,p_backend_key text,p_expected_revision integer,p_state jsonb) returns jsonb language sql security invoker set search_path = '' as $$select portfolio_account_private.ingest_cas(p_workspace_id,p_integration_key,p_backend_key,p_expected_revision,p_state)$$;

revoke all on all functions in schema portfolio_account_private from public,anon,authenticated;
grant execute on function portfolio_account_private.read_workspace(text,uuid),portfolio_account_private.cas_workspace(text,uuid,integer,text,jsonb,text),portfolio_account_private.team(text,uuid),portfolio_account_private.manage_team(text,text,uuid,text,text,uuid,text,jsonb,text),portfolio_account_private.integration_key(text,uuid,text) to authenticated;
grant execute on function portfolio_account_private.ingest_read(uuid,text,text),portfolio_account_private.ingest_cas(uuid,text,text,integer,jsonb) to anon,authenticated;
revoke all on function public.portfolio_account_read(text,uuid),public.portfolio_account_cas(text,uuid,integer,text,jsonb,text),public.portfolio_account_team(text,uuid),public.portfolio_account_manage_team(text,text,uuid,text,text,uuid,text,jsonb,text),public.portfolio_account_integration_key(text,uuid,text),public.portfolio_account_ingest_read(uuid,text,text),public.portfolio_account_ingest_cas(uuid,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.portfolio_account_read(text,uuid),public.portfolio_account_cas(text,uuid,integer,text,jsonb,text),public.portfolio_account_team(text,uuid),public.portfolio_account_manage_team(text,text,uuid,text,text,uuid,text,jsonb,text),public.portfolio_account_integration_key(text,uuid,text) to authenticated;
grant execute on function public.portfolio_account_ingest_read(uuid,text,text),public.portfolio_account_ingest_cas(uuid,text,text,integer,jsonb) to anon,authenticated;
commit;
