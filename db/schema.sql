-- Isolated portfolio demo storage; does not alter any existing application table.
-- Run once against the chosen Supabase project after checking the preflight in README.md.
-- Deliberately fails if this table already exists: review before migrating an older version.
begin;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto' and n.nspname = 'extensions'
  ) then
    raise exception 'Preflight: pgcrypto must already be installed in the extensions schema; inspect its schema before applying.';
  end if;
  if not pg_catalog.has_schema_privilege('anon', 'extensions', 'USAGE')
     or not pg_catalog.has_schema_privilege('authenticated', 'extensions', 'USAGE') then
    raise exception 'Preflight: anon and authenticated need existing USAGE on the verified pgcrypto schema.';
  end if;
end;
$$;

create table public.portfolio_demo_workspaces (
  app text not null check (app in ('webhooklab', 'fieldpilot', 'payroute')),
  workspace_hash text not null check (workspace_hash ~ '^[a-f0-9]{64}$'),
  revision integer not null default 0 check (revision >= 0 and revision < 2147483647),
  state jsonb not null check (pg_catalog.octet_length(state::text) <= 524288),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null default (pg_catalog.now() + interval '7 days'),
  primary key (app, workspace_hash),
  check (expires_at <= created_at + interval '7 days'),
  check (expires_at > created_at),
  check (updated_at >= created_at)
);

alter table public.portfolio_demo_workspaces enable row level security;
alter table public.portfolio_demo_workspaces force row level security;
revoke all on public.portfolio_demo_workspaces from public, anon, authenticated;
grant select, insert on public.portfolio_demo_workspaces to anon, authenticated;
grant update (state, revision, updated_at) on public.portfolio_demo_workspaces to anon, authenticated;

-- Invalid or missing token yields NULL, which can never satisfy an ownership policy.
-- Repeated expressions avoid adding an additional public helper RPC.
create policy portfolio_demo_select on public.portfolio_demo_workspaces
for select to anon, authenticated
using (
  expires_at > pg_catalog.now()
  and workspace_hash = (
    select case
      when coalesce(nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-demo-token', '') ~ '^[a-f0-9]{64}$'
      then pg_catalog.encode(extensions.digest(nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-demo-token', 'sha256'), 'hex')
      else null
    end
  )
);
create policy portfolio_demo_insert on public.portfolio_demo_workspaces
for insert to anon, authenticated
with check (
  expires_at > pg_catalog.now()
  and created_at <= pg_catalog.now()
  and workspace_hash = (
    select case
      when coalesce(nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-demo-token', '') ~ '^[a-f0-9]{64}$'
      then pg_catalog.encode(extensions.digest(nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-demo-token', 'sha256'), 'hex')
      else null
    end
  )
);
create policy portfolio_demo_update on public.portfolio_demo_workspaces
for update to anon, authenticated
using (
  expires_at > pg_catalog.now()
  and workspace_hash = (
    select case
      when coalesce(nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-demo-token', '') ~ '^[a-f0-9]{64}$'
      then pg_catalog.encode(extensions.digest(nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-demo-token', 'sha256'), 'hex')
      else null
    end
  )
)
with check (
  expires_at > pg_catalog.now()
  and workspace_hash = (
    select case
      when coalesce(nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-demo-token', '') ~ '^[a-f0-9]{64}$'
      then pg_catalog.encode(extensions.digest(nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-demo-token', 'sha256'), 'hex')
      else null
    end
  )
);

create function public.portfolio_demo_cas(p_app text, p_expected_revision integer, p_state jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_token text := coalesce(nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb ->> 'x-demo-token', '');
  v_hash text;
  v_row public.portfolio_demo_workspaces%rowtype;
begin
  if v_token !~ '^[a-f0-9]{64}$' or p_app not in ('webhooklab', 'fieldpilot', 'payroute')
     or p_app is null or p_expected_revision is null or p_expected_revision < -1
     or p_state is null or pg_catalog.octet_length(p_state::text) > 524288 then
    raise exception 'Invalid demo workspace request' using errcode = '22023';
  end if;
  v_hash := pg_catalog.encode(extensions.digest(v_token, 'sha256'), 'hex');
  if p_expected_revision = -1 then
    insert into public.portfolio_demo_workspaces (app, workspace_hash, revision, state)
      values (p_app, v_hash, 0, p_state)
      on conflict (app, workspace_hash) do nothing
      returning * into v_row;
  else
    update public.portfolio_demo_workspaces
      set state = p_state, revision = revision + 1, updated_at = pg_catalog.now()
      where app = p_app and workspace_hash = v_hash and revision = p_expected_revision
      returning * into v_row;
  end if;
  if found then
    return pg_catalog.jsonb_build_object('ok', true, 'state', v_row.state, 'revision', v_row.revision);
  end if;
  return pg_catalog.jsonb_build_object('ok', false, 'state', null, 'revision', null);
end;
$$;
revoke all on function public.portfolio_demo_cas(text, integer, jsonb) from public;
grant execute on function public.portfolio_demo_cas(text, integer, jsonb) to anon, authenticated;

commit;
