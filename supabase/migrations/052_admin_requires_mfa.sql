-- SEC-03 (auditoría de pre-lanzamiento, Fase 1.1): las operaciones de administración exigen
-- una sesión con verificación en dos pasos (AAL2, TOTP de Supabase Auth).
-- Alcance decidido por el propietario: obligatorio solo para administradores; los clientes no cambian.
-- Recuperación decidida por el propietario: si se pierde el factor, se elimina desde el panel de Supabase.
--
-- Expansiva y compatible: solo redefine is_admin() y admin_renew_subscription() conservando
-- dueños y permisos. Todas las políticas y RPC que ya usan is_admin() heredan el requisito.
-- Una sesión AAL1 de un admin conserva el acceso a sus propios datos (has_active_subscription no cambia).
begin;
set local lock_timeout = '5s';

-- Guarda contra el bloqueo: no aplicar si algún administrador no tiene un factor TOTP verificado.
-- (En entornos sin Supabase Auth, como PGlite, la tabla no existe y la guarda no aplica.)
do $guard$
begin
  if to_regclass('auth.mfa_factors') is not null and exists (
    select 1 from public.profiles p
    where p.role = 'admin'
      and not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = p.id and f.factor_type::text = 'totp' and f.status::text = 'verified'
      )
  ) then
    raise exception 'SEC03_ADMIN_SIN_TOTP: inscribir y verificar un factor TOTP para cada administrador antes de aplicar 052';
  end if;
end
$guard$;

-- AAL de la sesión, con el mismo criterio que auth.uid(): claim individual o JSON de claims.
-- coalesce(..., '') garantiza un booleano: nunca NULL (un NULL en "if not is_admin()" saltearía el control).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
           nullif(current_setting('request.jwt.claim.aal', true), ''),
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
           ''
         ) = 'aal2'
     and exists (
           select 1 from public.profiles
           where id = auth.uid() and role = 'admin'
         );
$$;

-- admin_renew_subscription (032) no usa is_admin(): agrega el mismo requisito AAL2.
-- CREATE OR REPLACE conserva el dueño acotado (pesito_subscription_writer) y su ACL.
create or replace function public.admin_renew_subscription(p_request_id uuid,p_client_id uuid,p_action text,p_days integer default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor uuid:=public.subscription_actor_id();target public.profiles%rowtype;receipt public.admin_subscription_requests%rowtype;
 fingerprint text;added integer:=0;replayed boolean:=false;server_now timestamptz;
begin
 if actor is null then raise exception 'Solo un administrador puede renovar cuentas.' using errcode='42501';end if;
 if coalesce(nullif(current_setting('request.jwt.claim.aal', true), ''),
             nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') <> 'aal2' then
   raise exception 'Verificá tu identidad con el código de dos pasos para renovar cuentas.' using errcode='42501';
 end if;
 perform 1 from public.profiles where id=actor and role='admin' for share;
 if not found then raise exception 'Solo un administrador puede renovar cuentas.' using errcode='42501';end if;
 if p_request_id is null or p_client_id is null or p_action is null or p_action not in ('extend','lifetime')
    or (p_action='extend' and (p_days is null or p_days not between 1 and 3650))
    or (p_action='lifetime' and p_days is not null) then
   raise exception 'Revisá la duración: de 1 a 3650 días, o sin vencimiento.' using errcode='22023';
 end if;
 fingerprint:=md5(jsonb_build_array(p_client_id,p_action,p_days)::text);
 perform pg_advisory_xact_lock(hashtextextended('subscription:'||actor::text||':'||p_request_id::text,31));
 select * into receipt from public.admin_subscription_requests where admin_id=actor and request_id=p_request_id;
 if found then
   if receipt.request_hash<>fingerprint then raise exception 'El intento corresponde a otra renovación.' using errcode='22023';end if;
   replayed:=true;added:=receipt.days_added;
 end if;
 select * into target from public.profiles where id=p_client_id and role='client' for update;
 if not found then raise exception 'No encontramos ese cliente.' using errcode='22023';end if;
 if not replayed then
   server_now:=clock_timestamp();
   if target.subscription_until is not null and not isfinite(target.subscription_until) then
     raise exception 'El vencimiento requiere revisión.' using errcode='22023';
   end if;
   if p_action='lifetime' then target.subscription_until:=null;
   elsif not(target.subscription_status in ('active','suspended') and target.subscription_until is null) then
     target.subscription_until:=greatest(server_now,target.subscription_until)+make_interval(days=>p_days);added:=p_days;
   end if;
   if target.subscription_status<>'suspended' then target.subscription_status:='active';end if;
   update public.profiles set subscription_status=target.subscription_status,subscription_until=target.subscription_until,updated_at=server_now where id=p_client_id;
   if not exists(select 1 from public.profiles where id=p_client_id and subscription_status=target.subscription_status and subscription_until is not distinct from target.subscription_until) then
     raise exception 'No se pudo completar la renovación.' using errcode='P0001';end if;
   insert into public.admin_subscription_requests(admin_id,request_id,client_id,request_hash,days_added)
     values(actor,p_request_id,p_client_id,fingerprint,added);
 end if;
 return jsonb_build_object('client_id',target.id,'subscription_status',target.subscription_status,
   'subscription_until',target.subscription_until,'days_added',added,'replayed',replayed);
end $$;

-- Verificación: definiciones nuevas, mismos dueños y permisos de ejecución.
do $verify$
begin
  if position('aal2' in pg_get_functiondef('public.is_admin()'::regprocedure)) = 0
     or position('aal2' in pg_get_functiondef('public.admin_renew_subscription(uuid,uuid,text,integer)'::regprocedure)) = 0 then
    raise exception 'SEC03_DEFINICION_INESPERADA';
  end if;
  if not (select prosecdef from pg_proc where oid = 'public.is_admin()'::regprocedure) then
    raise exception 'SEC03_IS_ADMIN_SIN_SECURITY_DEFINER';
  end if;
  if (select pg_get_userbyid(proowner) from pg_proc where oid = 'public.admin_renew_subscription(uuid,uuid,text,integer)'::regprocedure)
     <> 'pesito_subscription_writer' then
    raise exception 'SEC03_DUENO_RENOVACION_ALTERADO';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_renew_subscription(uuid,uuid,text,integer)', 'execute')
     or has_function_privilege('anon', 'public.admin_renew_subscription(uuid,uuid,text,integer)', 'execute') then
    raise exception 'SEC03_PERMISOS_RENOVACION_ALTERADOS';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
commit;
