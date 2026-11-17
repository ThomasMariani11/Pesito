// SEC-02 (053). Solo se invoca mediante el adaptador del stack descartable, nunca contra Supabase alojado.
// Corre como postgres sobre el esquema instalado: permisos reales de Supabase (incluidos los privilegios por defecto),
// generación por la RPC con admin aal1/aal2 y rechazo del insert directo con el rol authenticated.
const ADMIN = '53000000-0000-4000-8000-000000000099';
const FORMAT = '^PESO-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$';

export async function smokeInvitationContract(sql, { transaction = true } = {}) {
  await sql(`${transaction ? 'begin;' : ''}
    do $$begin
      if has_function_privilege('anon','public.admin_create_invitation_code(integer,text)','execute')
        or not has_function_privilege('authenticated','public.admin_create_invitation_code(integer,text)','execute') then
        raise exception 'RELEASE_INVITATION_RPC_ACL';end if;
      if has_any_column_privilege('anon','public.invitation_codes','insert')
        or has_any_column_privilege('anon','public.invitation_codes','update')
        or has_any_column_privilege('authenticated','public.invitation_codes','insert')
        or has_any_column_privilege('authenticated','public.invitation_codes','update') then
        raise exception 'RELEASE_INVITATION_DIRECT_WRITE';end if;
      if exists(select 1 from public.invitation_codes where not is_used and expires_at is null and renewal_user_id is null) then
        raise exception 'RELEASE_INVITATION_WITHOUT_EXPIRY';end if;
    end$$;
    insert into public.invitation_codes(code,duration_days)values('RELEASE-INVITE-ADMIN',30);
    insert into auth.users(id,email,raw_user_meta_data)values('${ADMIN}','invite-admin@example.invalid','{"invitation_code":"RELEASE-INVITE-ADMIN"}');
    -- Fixture del stack local: admin creado directo, sin promover un perfil mediante UPDATE.
    delete from public.profiles where id='${ADMIN}';
    insert into public.profiles(id,email,role,subscription_status,subscription_until)
      values('${ADMIN}','invite-admin@example.invalid','admin','active',null);
    select set_config('request.jwt.claim.sub','${ADMIN}',true);
    do $$declare r jsonb;begin
      perform set_config('request.jwt.claim.aal','aal1',true);
      begin
        perform public.admin_create_invitation_code(30,null);
        raise exception 'RELEASE_INVITATION_WITHOUT_MFA';
      exception when insufficient_privilege then null;
      end;
      perform set_config('request.jwt.claim.aal','aal2',true);
      r:=public.admin_create_invitation_code(30,'release');
      if r->>'code' !~ '${FORMAT}'
        or (r->>'expires_at')::timestamptz not between clock_timestamp()+interval '6 days 23 hours' and clock_timestamp()+interval '7 days' then
        raise exception 'RELEASE_INVITATION_FORMAT';end if;
      execute 'set local role authenticated';
      begin
        insert into public.invitation_codes(code,duration_days)values('RELEASE-DIRECT-INSERT',30);
        raise exception 'RELEASE_INVITATION_DIRECT_INSERT';
      exception when insufficient_privilege then null;
      end;
      execute 'reset role';
      perform set_config('request.jwt.claim.aal','',true);
    end$$;
    ${transaction ? 'rollback;' : ''}`);
}
