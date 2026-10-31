-- Rollback-only integration/security assertions. Run as project administrator after account-schema.sql.
-- First SET portfolio_test.user_a and portfolio_test.user_b to TWO DISTINCT existing,
-- verified synthetic test-account UUIDs. Do not use real customer accounts.
-- No email is sent and no auth.users row/settings is changed by this script.
begin;
do $$
declare a uuid := nullif(current_setting('portfolio_test.user_a',true),'')::uuid;
        b uuid := nullif(current_setting('portfolio_test.user_b',true),'')::uuid;
        w uuid; app_name text;
begin
  if a is null or b is null or a = b or (select count(*) from auth.users where id in (a,b) and email_confirmed_at is not null) <> 2 then
    raise exception 'Set portfolio_test.user_a and portfolio_test.user_b to distinct verified synthetic test users first';
  end if;
  perform set_config('portfolio_test.user_a_email',(select lower(email) from auth.users where id = a),true);
  perform set_config('portfolio_test.user_b_email',(select lower(email) from auth.users where id = b),true);
  foreach app_name in array array['webhooklab','fieldpilot','payroute'] loop
    insert into portfolio_account_private.portfolio_account_backend_credentials(app,key_hash)
      values(app_name,encode(extensions.digest(repeat(case app_name when 'webhooklab' then 'a' when 'fieldpilot' then 'b' else 'c' end,64),'sha256'),'hex'))
      on conflict(app) do update set key_hash = excluded.key_hash;
    insert into portfolio_account_private.portfolio_account_workspaces(app,name,state,created_by)
      values(app_name,'Rollback synthetic A',case app_name
        when 'webhooklab' then '{"version":1,"secret":"whsec_synthetic","clock":"2026-10-30T00:00:00Z","events":[]}'::jsonb
        when 'fieldpilot' then '{"customers":[],"estimates":[],"jobs":[{"id":"job1","status":"scheduled","title":"Synthetic"}],"invoices":[],"activity":[]}'::jsonb
        else '{"version":1,"providers":[],"transactions":[],"reconciliation":null}'::jsonb end,a) returning id into w;
    perform set_config('portfolio_test.'||app_name,w::text,true);
    insert into portfolio_account_private.portfolio_account_memberships(workspace_id,user_id,role) values(w,a,'owner'),(w,b,case app_name when 'webhooklab' then 'viewer' when 'fieldpilot' then 'staff' else 'editor' end);
  end loop;
  insert into portfolio_account_private.portfolio_account_workspaces(app,name,state,created_by) values('fieldpilot','Rollback synthetic B','{}',b) returning id into w;
  perform set_config('portfolio_test.other_workspace',w::text,true);
  insert into portfolio_account_private.portfolio_account_memberships(workspace_id,user_id,role) values(w,b,'owner');
  insert into portfolio_account_private.portfolio_account_workspaces(app,name,state,created_by) values('fieldpilot','Rollback invitation','{}',a) returning id into w;
  perform set_config('portfolio_test.invite_workspace',w::text,true);
  insert into portfolio_account_private.portfolio_account_memberships(workspace_id,user_id,role) values(w,a,'owner');
  insert into portfolio_account_private.portfolio_account_invitations(workspace_id,email,role,invited_by) values(w,(select lower(email) from auth.users where id = a),'viewer',a);
end;
$$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('portfolio_test.user_b'),'role','authenticated')::text,true);
do $$
declare r jsonb; w uuid := current_setting('portfolio_test.webhooklab')::uuid;
        f uuid := current_setting('portfolio_test.fieldpilot')::uuid; s jsonb;
begin
  -- Viewer may read events but never receive the HMAC signing secret, even through direct RPC.
  r := public.portfolio_account_read('webhooklab',w);
  if r->'state' ? 'secret' or r->>'role' <> 'viewer' then raise exception 'Viewer secret/role failure'; end if;
  begin perform public.portfolio_account_cas('webhooklab',w,0,'sample','{}',repeat('a',64)); raise exception 'Viewer write unexpectedly allowed'; exception when insufficient_privilege then null; end;
  -- Direct private-table access is denied despite schema USAGE.
  begin perform 1 from portfolio_account_private.portfolio_account_workspaces; raise exception 'Direct SELECT unexpectedly allowed'; exception when insufficient_privilege then null; end;
  -- A JWT with an allowed command cannot submit arbitrary raw state without backend key.
  begin perform public.portfolio_account_cas('fieldpilot',f,0,'move_job','{}',null); raise exception 'Missing backend credential allowed'; exception when insufficient_privilege then null; end;
  -- Wrong app-bound credential cannot authorize writes (only webhook credential below is rotated later).
  begin perform public.portfolio_account_cas('fieldpilot',f,0,'move_job','{}',repeat('a',64)); raise exception 'Forged backend credential allowed'; exception when insufficient_privilege then null; end;
  begin perform portfolio_account_private.row_result(w,'owner'); raise exception 'Private helper EXECUTE unexpectedly allowed'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('portfolio_test.user_b'),'role','authenticated','email',current_setting('portfolio_test.user_a_email'),'user_metadata',jsonb_build_object('role','owner'))::text,true);
  begin perform public.portfolio_account_team('fieldpilot',current_setting('portfolio_test.invite_workspace')::uuid); raise exception 'Forged JWT email accepted another account invitation'; exception when insufficient_privilege then null; end;
  s := public.portfolio_account_read('fieldpilot',f)->'state';
  begin perform public.portfolio_account_cas('fieldpilot',f,0,'move_job',jsonb_set(s,'{invoices}','[{"forged":true}]'),repeat('b',64)); raise exception 'Staff finance change unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin perform public.portfolio_account_cas('fieldpilot',f,0,'move_job',jsonb_set(s,'{jobs,0,status}','"completed"'),repeat('b',64)); raise exception 'Staff skipped lifecycle'; exception when insufficient_privilege then null; end;
  r := public.portfolio_account_cas('fieldpilot',f,0,'move_job',jsonb_set(s,'{jobs,0,status}','"in_progress"'),repeat('b',64));
  if r->>'ok' <> 'true' then raise exception 'Legal staff move failed'; end if;
  r := public.portfolio_account_cas('fieldpilot',f,0,'move_job',s,repeat('b',64));
  if r->>'ok' <> 'false' then raise exception 'Stale revision was not rejected'; end if;
  begin perform public.portfolio_account_cas('payroute',current_setting('portfolio_test.payroute')::uuid,0,'simulate','{"version":1,"providers":[{"forged":true}],"transactions":[],"reconciliation":null}',repeat('c',64)); raise exception 'Editor changed provider settings'; exception when insufficient_privilege then null; end;
end;
$$;
-- Account A cannot read account B's unrelated workspace, and cannot forge app scope.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('portfolio_test.user_a'),'role','authenticated')::text,true);
do $$
declare w uuid := current_setting('portfolio_test.invite_workspace')::uuid; created jsonb;
begin
  begin perform public.portfolio_account_manage_team('fieldpilot','create',null,'Denied synthetic',null,null,null,'{}',null); raise exception 'Create without backend key unexpectedly allowed'; exception when insufficient_privilege then null; end;
  created := public.portfolio_account_manage_team('fieldpilot','create',null,'Seeded synthetic',null,null,'viewer','{"synthetic":true}',repeat('b',64));
  if not exists(select 1 from jsonb_array_elements(created->'workspaces') x where x->>'id' = created->>'workspaceId' and x->>'role' = 'owner') then raise exception 'Create did not assign owner in DB'; end if;
  if public.portfolio_account_read('fieldpilot',(created->>'workspaceId')::uuid)->'state' <> '{"synthetic":true}'::jsonb then raise exception 'Synthetic seed was not preserved'; end if;
  begin perform public.portfolio_account_read('fieldpilot',current_setting('portfolio_test.other_workspace')::uuid); raise exception 'Cross-tenant read unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin perform public.portfolio_account_read('payroute',current_setting('portfolio_test.webhooklab')::uuid); raise exception 'Cross-app read unexpectedly allowed'; exception when insufficient_privilege then null; end;
  begin perform public.portfolio_account_manage_team('fieldpilot','invite',w,null,current_setting('portfolio_test.user_b_email'),null,'owner',null,null); raise exception 'Owner role injection allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.portfolio_account_manage_team('fieldpilot','remove',w,null,null,current_setting('portfolio_test.user_a')::uuid,null,null,null); raise exception 'Owner self removal allowed'; exception when insufficient_privilege then null; end;
  perform public.portfolio_account_manage_team('fieldpilot','invite',w,null,current_setting('portfolio_test.user_b_email'),null,'viewer',null,null);
  perform public.portfolio_account_integration_key('webhooklab',current_setting('portfolio_test.webhooklab')::uuid,encode(extensions.digest('whk_ingest_'||repeat('c',64),'sha256'),'hex'));
end;
$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('portfolio_test.user_b'),'role','authenticated')::text,true);
do $$
declare r jsonb; w uuid := current_setting('portfolio_test.invite_workspace')::uuid;
begin
  -- Only confirmed auth.users email can accept the pending invitation.
  r := public.portfolio_account_team('fieldpilot',w);
  if not exists(select 1 from jsonb_array_elements(r->'workspaces') x where x->>'id' = w::text and x->>'role' = 'viewer') then raise exception 'Verified invitation was not accepted'; end if;
  begin perform public.portfolio_account_manage_team('fieldpilot','invite',w,null,'someone@example.test',null,'viewer',null,null); raise exception 'Viewer invited a member'; exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('portfolio_test.user_a'),'role','authenticated')::text,true);
select public.portfolio_account_manage_team('fieldpilot','role',current_setting('portfolio_test.invite_workspace')::uuid,null,null,current_setting('portfolio_test.user_b')::uuid,'editor',null,null);
select public.portfolio_account_manage_team('fieldpilot','remove',current_setting('portfolio_test.invite_workspace')::uuid,null,null,current_setting('portfolio_test.user_b')::uuid,null,null,null);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('portfolio_test.user_b'),'role','authenticated')::text,true);
do $$begin
  begin perform public.portfolio_account_read('fieldpilot',current_setting('portfolio_test.invite_workspace')::uuid); raise exception 'Removed member retained access'; exception when insufficient_privilege then null; end;
end;$$;
-- Unauthenticated external integration key alone is insufficient to retrieve state or signing secret.
set local role anon;
select set_config('request.jwt.claims','{}',true);
do $$
declare w uuid := current_setting('portfolio_test.webhooklab')::uuid; r jsonb;
begin
  begin perform public.portfolio_account_ingest_read(w,'whk_ingest_'||repeat('c',64),null); raise exception 'Integration key alone exposed workspace'; exception when insufficient_privilege then null; end;
  begin perform public.portfolio_account_ingest_read(w,'whk_ingest_'||repeat('d',64),repeat('a',64)); raise exception 'Forged integration key allowed'; exception when insufficient_privilege then null; end;
  begin perform public.portfolio_account_read('webhooklab',w); raise exception 'Anonymous account read allowed'; exception when insufficient_privilege then null; end;
  r := public.portfolio_account_ingest_read(w,'whk_ingest_'||repeat('c',64),repeat('a',64));
  begin perform public.portfolio_account_ingest_cas(w,'whk_ingest_'||repeat('c',64),repeat('a',64),0,jsonb_set(r->'state','{secret}','"forged"')); raise exception 'Integration changed signing secret'; exception when insufficient_privilege then null; end;
  r := public.portfolio_account_ingest_cas(w,'whk_ingest_'||repeat('c',64),repeat('a',64),0,jsonb_set(r->'state','{events}','[{"synthetic":true}]'));
  if r->>'ok' <> 'true' then raise exception 'Authorized ingestion failed'; end if;
end;
$$;
rollback;
