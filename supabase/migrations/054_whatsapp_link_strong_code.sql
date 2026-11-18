-- SEC-01 (Fase 1.3): código de vinculación de WhatsApp largo y avisos de vínculo por Web Push.
-- Publicar después de desplegar el webhook que acepta XXXX-XXXX-XXXX y redacta whatsapp_linked/whatsapp_unlinked.
-- Sin cambios de permisos: create or replace conserva dueño y ACL; se repiten los revoke/grant de 018.
begin;
set local lock_timeout = '5s';

-- Impide escrituras concurrentes en whatsapp_links mientras se aplica; una llamada de la RPC anterior ya en curso
-- puede emitir un último código de 6 dígitos al terminar (vence en 10 minutos). Por eso el webhook y la PWA
-- siguen aceptando 6 dígitos durante la transición.
lock table public.whatsapp_links in share row exclusive mode;

-- 1. Dos tipos nuevos de aviso: reemplazar el check de client_notifications.kind (como 051).
do $$
declare con record;
begin
  for con in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.client_notifications'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%subscription_7%'
  loop
    execute format('alter table public.client_notifications drop constraint %I', con.conname);
  end loop;
end $$;
alter table public.client_notifications add constraint client_notifications_kind_check
  check (kind in ('subscription_7', 'subscription_1', 'registration_noon', 'registration_night', 'monthly_summary',
                  'whatsapp_linked', 'whatsapp_unlinked'));

-- 2. Código de 12 caracteres (alfabeto de 32, ~10^18 combinaciones) presentado como XXXX-XXXX-XXXX.
--    Se guarda solo el sha256 del código normalizado (mayúsculas, sin guiones), igual que el webhook.
create or replace function public.request_whatsapp_link_code()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  -- Bytes de gen_random_uuid() (CSPRNG) sin los de versión (6) y variante (8): sus 5 bits bajos son uniformes.
  positions constant integer[] := array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13];
  v_user_id uuid := auth.uid();
  v_bytes bytea;
  v_pos integer;
  v_chars text;
  v_code text;
  v_hash text;
  v_expires timestamptz;
  v_constraint text;
begin
  if v_user_id is null then
    raise exception 'Necesitás una sesión con acceso vigente para vincular WhatsApp.' using errcode = '42501';
  end if;

  -- Serializar solicitudes del mismo usuario sin cambiar campos del perfil.
  perform 1 from public.profiles where id = v_user_id for update;
  if not found then
    raise exception 'No se encontró el perfil de la sesión.' using errcode = '42501';
  end if;
  if not public.has_active_subscription() then
    raise exception 'Necesitás una sesión con acceso vigente para vincular WhatsApp.' using errcode = '42501';
  end if;
  v_expires := now() + interval '10 minutes';

  for attempt in 1..10 loop
    v_bytes := uuid_send(gen_random_uuid());
    v_chars := '';
    foreach v_pos in array positions loop
      v_chars := v_chars || substr(alphabet, (get_byte(v_bytes, v_pos) & 31) + 1, 1);
    end loop;
    v_code := substr(v_chars, 1, 4) || '-' || substr(v_chars, 5, 4) || '-' || substr(v_chars, 9, 4);
    v_hash := encode(sha256(convert_to(v_chars, 'UTF8')), 'hex');
    if exists(select 1 from public.whatsapp_links where link_code_hash=v_hash) then continue; end if;
    begin
      insert into public.whatsapp_links(user_id, link_code_hash, link_code_expires_at)
      values (v_user_id, v_hash, v_expires)
      on conflict (user_id) do update set
        link_code_hash = excluded.link_code_hash,
        link_code_expires_at = excluded.link_code_expires_at;
      -- No activa un teléfono ni interrumpe un vínculo existente.
      return jsonb_build_object('code', v_code, 'expires_at', v_expires);
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'whatsapp_links_code_hash_unique' then raise; end if;
    end;
  end loop;
  raise exception 'No pudimos generar el código. Intentá nuevamente.';
end;
$$;

revoke all on function public.request_whatsapp_link_code() from public, anon;
grant execute on function public.request_whatsapp_link_code() to authenticated;

-- 3. apply_whatsapp_job, rama link: avisar al dueño del vínculo y a la cuenta que pierde el número.
--    Solo se reemplaza el bloque de éxito (las cinco sentencias update vigentes desde 040); debe aparecer
--    exactamente una vez, si no aborta sin cambios. Límites, bloqueo, leases y texto de respuesta no cambian.
do $migration$
declare
  definition text;
  hits integer;
  old_success constant text := $old$          update public.whatsapp_links set wa_id=null,status='pending' where wa_id=q.wa_id and user_id<>u;
          update public.profiles set phone_number=null where phone_number=q.wa_id and id<>u;
          update public.whatsapp_links set wa_id=q.wa_id,status='active',linked_at=clock_timestamp(),link_code_hash=null,link_code_expires_at=null where user_id=u;
          update public.profiles set phone_number=q.wa_id where id=u;
          update public.whatsapp_worker_state set user_id=u,link_attempts=0,link_locked_until=null,last_link_attempt_at=null where wa_id=q.wa_id;
$old$;
  new_success constant text := $new$          declare
            -- SEC-01: avisos de vínculo (Web Push), solo a cuentas con al menos una suscripción.
            sec01_prev_wa text;
            sec01_prev_owners uuid[];
            sec01_linked_at timestamptz;
            sec01_key text;
          begin
            select wa_id into sec01_prev_wa from public.whatsapp_links where user_id=u;
            select coalesce(array_agg(distinct o.id), '{}') into sec01_prev_owners from (
              select user_id as id from public.whatsapp_links where wa_id=q.wa_id and user_id<>u
              union select id from public.profiles where phone_number=q.wa_id and id<>u) o;
            update public.whatsapp_links set wa_id=null,status='pending' where wa_id=q.wa_id and user_id<>u;
            update public.profiles set phone_number=null where phone_number=q.wa_id and id<>u;
            update public.whatsapp_links set wa_id=q.wa_id,status='active',linked_at=clock_timestamp(),link_code_hash=null,link_code_expires_at=null where user_id=u
              returning linked_at into sec01_linked_at;
            update public.profiles set phone_number=q.wa_id where id=u;
            update public.whatsapp_worker_state set user_id=u,link_attempts=0,link_locked_until=null,last_link_attempt_at=null where wa_id=q.wa_id;
            sec01_key := to_char(sec01_linked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
            -- Re-vincular el mismo número no avisa; un vínculo nuevo o un cambio de número sí.
            if sec01_prev_wa is distinct from q.wa_id then
              insert into public.client_notifications(user_id, kind, period_key)
              select u, 'whatsapp_linked', sec01_key
              where exists (select 1 from public.push_subscriptions ps where ps.user_id = u)
              on conflict (user_id, kind, period_key) do nothing;
            end if;
            insert into public.client_notifications(user_id, kind, period_key)
            select o, 'whatsapp_unlinked', sec01_key from unnest(sec01_prev_owners) o
            where exists (select 1 from public.push_subscriptions ps where ps.user_id = o)
            on conflict (user_id, kind, period_key) do nothing;
          end;
$new$;
begin
  select replace(pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure), chr(13), '') into definition;
  hits := (char_length(definition) - char_length(replace(definition, replace(old_success, chr(13), ''), '')))
          / char_length(replace(old_success, chr(13), ''));
  if hits <> 1 or position('sec01_prev_owners' in definition) > 0 then
    raise exception 'SEC01_APPLY_DEFINITION_UNEXPECTED %', hits;
  end if;
  execute replace(definition, replace(old_success, chr(13), ''), replace(new_success, chr(13), ''));
end;
$migration$;

-- 4. Anular los códigos pendientes: ningún código de 6 dígitos queda vigente.
update public.whatsapp_links set link_code_hash = null, link_code_expires_at = null
  where link_code_hash is not null or link_code_expires_at is not null;

-- Verificación.
do $verify$
declare
  f regprocedure;
begin
  foreach f in array array['public.request_whatsapp_link_code()'::regprocedure, 'public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure] loop
    if not (select prosecdef from pg_proc where oid = f)
       or not (select 'search_path=pg_catalog, public' = any(proconfig) from pg_proc where oid = f) then
      raise exception 'SEC01_FUNCION_INESPERADA %', f;
    end if;
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'SEC01_PERMISOS_ANON %', f;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.request_whatsapp_link_code()', 'execute')
     or has_function_privilege('authenticated', 'public.apply_whatsapp_job(uuid,uuid,jsonb)', 'execute') then
    raise exception 'SEC01_PERMISOS_FUNCION';
  end if;
  if position('sec01_prev_owners' in pg_get_functiondef('public.apply_whatsapp_job(uuid,uuid,jsonb)'::regprocedure)) = 0
     or position('uuid_send(gen_random_uuid())' in pg_get_functiondef('public.request_whatsapp_link_code()'::regprocedure)) = 0 then
    raise exception 'SEC01_DEFINICION_NO_APLICADA';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.client_notifications'::regclass
                 and conname = 'client_notifications_kind_check'
                 and pg_get_constraintdef(oid) like '%whatsapp_unlinked%') then
    raise exception 'SEC01_TIPOS_DE_AVISO';
  end if;
  if exists (select 1 from public.whatsapp_links where link_code_hash is not null or link_code_expires_at is not null) then
    raise exception 'SEC01_CODIGOS_PENDIENTES';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
commit;
