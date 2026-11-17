-- SEC-02 (Fase 1.2): los códigos de invitación se generan solo en el servidor y vencen a los 7 días.
-- Antes la PWA armaba PESO-XXXX-2026 en el navegador (Math.random, ~1 millón de combinaciones) y lo insertaba directo.
-- Los códigos de renovación (renewal_user_id, migración 043) no cambian.
begin;

-- 1. Generación en el servidor: PESO-XXXX-XXXX-XXXX, 12 caracteres de un alfabeto de 32 (~10^18 combinaciones).
create or replace function public.admin_create_invitation_code(p_duration_days integer, p_notes text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  -- Bytes de gen_random_uuid() (CSPRNG) sin los de versión (6) y variante (8): sus 5 bits bajos son uniformes.
  positions constant integer[] := array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13];
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_bytes bytea;
  v_chars text;
  v_code text;
  v_row public.invitation_codes%rowtype;
  v_pos integer;
begin
  if not public.is_admin() then
    raise exception 'Verificá tu identidad con el código de dos pasos para crear invitaciones.' using errcode = '42501';
  end if;
  if p_duration_days is not null and (p_duration_days < 1 or p_duration_days > 3650) then
    raise exception 'La duración debe estar entre 1 y 3650 días.' using errcode = '22023';
  end if;
  if char_length(v_notes) > 200 then
    raise exception 'La nota puede tener hasta 200 caracteres.' using errcode = '22023';
  end if;

  for attempt in 1..5 loop
    v_bytes := uuid_send(gen_random_uuid());
    v_chars := '';
    foreach v_pos in array positions loop
      v_chars := v_chars || substr(alphabet, (get_byte(v_bytes, v_pos) & 31) + 1, 1);
    end loop;
    v_code := 'PESO-' || substr(v_chars, 1, 4) || '-' || substr(v_chars, 5, 4) || '-' || substr(v_chars, 9, 4);
    begin
      insert into public.invitation_codes(code, duration_days, notes, created_by, expires_at)
        values (v_code, p_duration_days, v_notes, auth.uid(), clock_timestamp() + interval '7 days')
        returning * into v_row;
      return jsonb_build_object('id', v_row.id, 'code', v_row.code, 'duration_days', v_row.duration_days, 'expires_at', v_row.expires_at);
    exception when unique_violation then
      null; -- colisión prácticamente imposible: se reintenta con otro código
    end;
  end loop;
  raise exception 'No se pudo generar el código. Probá de nuevo.' using errcode = 'P0001';
end;
$$;

revoke all on function public.admin_create_invitation_code(integer, text) from public, anon;
grant execute on function public.admin_create_invitation_code(integer, text) to authenticated;

-- 2. Sin alta ni modificación directa desde clientes: el admin solo lee y borra (el trigger 043 protege los de renovación).
drop policy if exists "admins manage invitation codes" on public.invitation_codes;
create policy "admins read invitation codes" on public.invitation_codes
  for select to authenticated using (public.is_admin());
create policy "admins delete invitation codes" on public.invitation_codes
  for delete to authenticated using (public.is_admin());
revoke insert, update on public.invitation_codes from anon, authenticated;

-- 3. Códigos de invitación sin usar ya repartidos: 7 días desde esta migración (decisión del propietario, 17/11/2026).
update public.invitation_codes
  set expires_at = clock_timestamp() + interval '7 days'
  where not is_used and expires_at is null and renewal_user_id is null;

-- Verificación.
do $verify$
begin
  if not (select prosecdef from pg_proc where oid = 'public.admin_create_invitation_code(integer,text)'::regprocedure)
     or not (select 'search_path=pg_catalog, public' = any(proconfig)
             from pg_proc where oid = 'public.admin_create_invitation_code(integer,text)'::regprocedure) then
    raise exception 'SEC02_FUNCION_INESPERADA';
  end if;
  if not has_function_privilege('authenticated', 'public.admin_create_invitation_code(integer,text)', 'execute')
     or has_function_privilege('anon', 'public.admin_create_invitation_code(integer,text)', 'execute') then
    raise exception 'SEC02_PERMISOS_FUNCION';
  end if;
  if has_table_privilege('authenticated', 'public.invitation_codes', 'insert')
     or has_table_privilege('authenticated', 'public.invitation_codes', 'update')
     or has_table_privilege('anon', 'public.invitation_codes', 'insert')
     or has_table_privilege('anon', 'public.invitation_codes', 'update') then
    raise exception 'SEC02_ESCRITURA_DIRECTA';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invitation_codes'
             and cmd in ('ALL', 'INSERT', 'UPDATE') and not ('pesito_subscription_writer' = any(roles))) then
    raise exception 'SEC02_POLITICA_DE_ESCRITURA';
  end if;
  if exists (select 1 from public.invitation_codes
             where not is_used and expires_at is null and renewal_user_id is null) then
    raise exception 'SEC02_CODIGOS_SIN_VENCIMIENTO';
  end if;
end
$verify$;

notify pgrst, 'reload schema';
commit;
