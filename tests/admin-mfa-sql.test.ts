import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';
import { smokeRenewalContract } from '../scripts/release-renewal-contract.mjs';

// SEC-03 (Fase 1.1): la migración 052 exige una sesión AAL2 (TOTP) para toda operación de administración.
// Datos ficticios. El esquema se arma con las migraciones reales 001–051 y la 052 se aplica al final.
const readFile = async (path: URL | string) => (await readSqlFile(path, 'utf8')).replace(/\r\n/g, '\n');

describe('SEC-03: administración con verificación en dos pasos (migración 052)', { timeout: 120_000 }, () => {
  const db = new PGlite();
  const admin = '52000000-0000-4000-8000-000000000001';
  const client = '52000000-0000-4000-8000-000000000002';
  const migrationUrl = new URL('../supabase/migrations/', import.meta.url);
  const ADMIN_FUNCTIONS = ['is_admin', 'admin_renew_subscription'];
  const privileges = async () => (await db.query<{ proname: string; proacl: string | null; prosecdef: boolean; owner: string }>(
    `select p.proname, p.proacl::text as proacl, p.prosecdef, pg_get_userbyid(p.proowner) as owner
       from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by p.proname`, [ADMIN_FUNCTIONS],
  )).rows;
  let before: Awaited<ReturnType<typeof privileges>>;
  let migration052: string;

  beforeAll(async () => {
    await db.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
    `);
    // Un usuario existente antes de 005 queda promovido a admin (antecedente documentado de 005).
    await db.query("insert into auth.users(id, email) values($1, 'admin@example.invalid')", [admin]);

    const migrations = (await readdir(migrationUrl)).filter((m) => /^\d+.*\.sql$/.test(m)).sort();
    for (const m of migrations.filter((m) => m < '021')) {
      if (m === '002_enable_realtime.sql') continue;
      let sql = await readFile(new URL(m, migrationUrl));
      if (m === '001_initial.sql') sql = sql.replace('create extension if not exists pgcrypto;', '');
      await db.exec(sql.replace(/^﻿/, ''));
    }
    await db.exec(`
      create schema cron; create schema net; create schema vault;
      create table net.http_request_queue(id bigint); create table net._http_response(id bigint);
      create table cron.job(jobname text, schedule text, command text);
      create table vault.decrypted_secrets(name text, decrypted_secret text);
      create function cron.schedule(text, text, text) returns bigint language plpgsql as $$ begin insert into cron.job values($1,$2,$3); return 1; end $$;
      create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language sql as $$ select 1::bigint $$;
      create schema if not exists extensions;
      create function extensions.http_set_curlopt(varchar, varchar) returns boolean language sql as $$ select true $$;
      create function extensions.http_reset_curlopt() returns boolean language sql as $$ select true $$;
      create type extensions.http_header as (field varchar, value varchar);
      create type extensions.http_request as (method varchar, uri varchar, headers extensions.http_header[], content_type varchar, content varchar);
      create function extensions.http_header(varchar, varchar) returns extensions.http_header language sql as $$ select row($1,$2)::extensions.http_header $$;
      create function extensions.http(extensions.http_request) returns table(status integer) language sql as $$ select 200 $$;
    `);
    for (const m of migrations.filter((m) => m >= '021' && m < '052')) {
      let sql = await readFile(new URL(m, migrationUrl));
      if (m === '021_whatsapp_queue_recovery.sql' || m === '022_whatsapp_recovery_private_transport.sql') {
        sql = sql.replace(/^create extension[^\n]+\n/gm, '');
      }
      if (m === '027_whatsapp_observability.sql') {
        await db.exec(`alter table cron.job add column if not exists jobid bigint generated always as identity, add column if not exists active boolean default true;
          create table if not exists cron.job_run_details(jobid bigint, status text, start_time timestamptz default clock_timestamp(), end_time timestamptz);`);
      }
      await db.exec(sql);
    }
    // Cliente activo por el alta real (bootstrap_user) con un código ficticio.
    await db.exec("insert into public.invitation_codes(code, duration_days) values('MFA-CLIENTE', 30)");
    await db.query(`insert into auth.users(id, email, raw_user_meta_data) values($1, 'cliente@example.invalid', '{"invitation_code":"MFA-CLIENTE"}')`, [client]);
    await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated');

    before = await privileges();
    migration052 = await readFile(new URL('052_admin_requires_mfa.sql', migrationUrl));

    // Guarda contra el bloqueo: con la tabla de factores presente, sin TOTP verificado la 052 no se aplica.
    await db.exec('create table auth.mfa_factors(user_id uuid, factor_type text, status text)');
    await expect(db.exec(migration052)).rejects.toThrow(/SEC03_ADMIN_SIN_TOTP/);
    await db.exec('rollback');
    await db.query("insert into auth.mfa_factors values($1, 'totp', 'unverified')", [admin]);
    await expect(db.exec(migration052)).rejects.toThrow(/SEC03_ADMIN_SIN_TOTP/);
    await db.exec('rollback');
    await db.query("insert into auth.mfa_factors values($1, 'totp', 'verified')", [admin]);
    await db.exec(migration052);
  });

  afterAll(async () => { await db.close(); });
  beforeEach(async () => { await db.exec('begin'); });
  afterEach(async () => { await db.exec('rollback'); });

  // Ejecuta como usuario autenticado con el nivel de sesión indicado ('' = sin claim).
  async function as<T>(actor: string, aal: '' | 'aal1' | 'aal2', sql: string, args: unknown[] = []): Promise<T> {
    await db.exec('savepoint caller');
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.aal', $2, true), set_config('request.jwt.claims', '', true)", [actor, aal]);
      await db.exec('set local role authenticated');
      const result = await db.query<{ r: T }>(sql, args);
      await db.exec('reset role; release savepoint caller');
      return result.rows[0]?.r;
    } catch (error) {
      await db.exec('rollback to savepoint caller; release savepoint caller');
      throw error;
    }
  }

  it('is_admin() exige AAL2 y nunca devuelve NULL', async () => {
    expect(await as(admin, 'aal2', 'select public.is_admin() as r')).toBe(true);
    expect(await as(admin, 'aal1', 'select public.is_admin() as r')).toBe(false);
    expect(await as(admin, '', 'select public.is_admin() as r')).toBe(false);
    expect(await as(client, 'aal2', 'select public.is_admin() as r')).toBe(false);
    expect(await as(admin, '', 'select public.is_admin() is not null as r')).toBe(true);
  });

  it('acepta el nivel de sesión desde el JSON de claims (formato de PostgREST)', async () => {
    await db.exec('savepoint json');
    await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.aal', '', true), set_config('request.jwt.claims', $2, true)",
      [admin, JSON.stringify({ sub: admin, aal: 'aal2' })]);
    await db.exec('set local role authenticated');
    expect((await db.query<{ r: boolean }>('select public.is_admin() as r')).rows[0].r).toBe(true);
    await db.exec('reset role; rollback to savepoint json; release savepoint json');
  });

  const ADMIN_RPCS: Array<[string, string, unknown[]]> = [
    ['whatsapp_ops_dashboard', 'select public.whatsapp_ops_dashboard() as r', []],
    ['whatsapp_ai_quota_dashboard', 'select public.whatsapp_ai_quota_dashboard() as r', []],
    ['admin_subscription_renewals', 'select public.admin_subscription_renewals(10, 0) as r', []],
    ['acknowledge_whatsapp_ops_alert', "select public.acknowledge_whatsapp_ops_alert('queue_delay') as r", []],
    ['wake_subscription_renewals', 'select public.wake_subscription_renewals() as r', []],
    ['admin_renew_subscription', "select public.admin_renew_subscription(gen_random_uuid(), $1, 'extend', 30) as r", [client]],
  ];

  // Rechazo de administración: 42501 o el error propio de la RPC (*_ADMIN_REQUIRED, P0001).
  async function expectDenied(promise: Promise<unknown>) {
    const error = await promise.then(() => null, (e: { code?: string; message?: string }) => e);
    expect(error, 'se esperaba un rechazo').not.toBeNull();
    expect(error?.code === '42501' || /ADMIN_REQUIRED/.test(error?.message ?? '')).toBe(true);
  }

  for (const [name, sql, args] of ADMIN_RPCS) {
    it(`${name}: un admin con sesión AAL1 es rechazado`, async () => {
      await expectDenied(as(admin, 'aal1', sql, args));
    });
    it(`${name}: un admin con sesión AAL2 opera`, async () => {
      await as(admin, 'aal2', sql, args);
    });
  }

  it('admin_confirm_renewal_payment exige AAL2 antes de mirar la solicitud', async () => {
    await expect(as(admin, 'aal1', 'select public.admin_confirm_renewal_payment(gen_random_uuid(), 30) as r')).rejects.toMatchObject({ code: '42501' });
    // Con AAL2 pasa el control de admin y llega a la validación de negocio (solicitud inexistente).
    await expect(as(admin, 'aal2', 'select public.admin_confirm_renewal_payment(gen_random_uuid(), 30) as r')).rejects.toMatchObject({ code: '22023' });
  });

  it('políticas: con AAL1 el admin no ve perfiles ajenos ni escribe configuración o códigos', async () => {
    expect(await as<number>(admin, 'aal1', 'select count(*)::int as r from public.profiles where id = $1', [client])).toBe(0);
    expect(await as<number>(admin, 'aal2', 'select count(*)::int as r from public.profiles where id = $1', [client])).toBe(1);
    await expect(as(admin, 'aal1', "insert into public.system_config(key, value) values ('support_phone', '0') on conflict (key) do update set value = excluded.value returning 1 as r"))
      .rejects.toMatchObject({ code: '42501' });
    await expect(as(admin, 'aal1', "insert into public.invitation_codes(code, duration_days) values ('MFA-AAL1', 30) returning 1 as r"))
      .rejects.toMatchObject({ code: '42501' });
    expect(await as(admin, 'aal2', "insert into public.invitation_codes(code, duration_days) values ('MFA-AAL2', 30) returning 1 as r")).toBe(1);
  });

  it('con AAL1 el admin no puede cambiar roles; con AAL2 sí (trigger de perfiles)', async () => {
    const role = async () => (await db.query<{ role: string }>('select role from public.profiles where id = $1', [client])).rows[0].role;
    await expect(as(admin, 'aal1', "update public.profiles set role = 'admin' where id = $1 returning 1 as r", [client])).resolves.toBeUndefined();
    expect(await role()).toBe('client');
    expect(await as(admin, 'aal2', "update public.profiles set role = 'admin' where id = $1 returning 1 as r", [client])).toBe(1);
    expect(await role()).toBe('admin');   // se revierte en afterEach
  });

  it('admin_renew_subscription con AAL2 suma días; con AAL1 no cambia nada', async () => {
    const until = async () => (await db.query<{ u: string | null }>('select subscription_until::text as u from public.profiles where id = $1', [client])).rows[0].u;
    const start = await until();
    await expect(as(admin, 'aal1', "select public.admin_renew_subscription(gen_random_uuid(), $1, 'extend', 10) as r", [client])).rejects.toMatchObject({ code: '42501' });
    expect(await until()).toBe(start);
    const result = await as<{ days_added: number }>(admin, 'aal2', "select public.admin_renew_subscription(gen_random_uuid(), $1, 'extend', 10) as r", [client]);
    expect(result.days_added).toBe(10);
    expect(await until()).not.toBe(start);
  });

  it('los clientes no cambian: con AAL1 leen su perfil y su membresía sigue vigente', async () => {
    expect(await as<number>(client, 'aal1', 'select count(*)::int as r from public.profiles where id = $1', [client])).toBe(1);
    expect(await as<boolean>(client, 'aal1', 'select public.has_active_subscription() as r')).toBe(true);
    await expectDenied(as(client, 'aal2', 'select public.whatsapp_ops_dashboard() as r'));
  });

  it('conserva dueños, SECURITY DEFINER y permisos de ejecución', async () => {
    expect(await privileges()).toEqual(before);
    const config = (await db.query<{ c: string[] }>("select proconfig as c from pg_proc where oid = 'public.is_admin()'::regprocedure")).rows[0].c;
    expect(config).toEqual(['search_path=pg_catalog, public']);
  });
  it('el contrato de renovación del ensayo de release pasa con 052 y rechaza al admin con AAL1', async () => {
    // El setup de este archivo concede tablas a authenticated; se deshace aquí (transacción) para el chequeo de privacidad del contrato.
    await db.exec('revoke all on public.subscription_renewal_requests, public.subscription_renewal_notices from authenticated');
    await db.exec("select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)");
    await smokeRenewalContract((sql: string) => db.exec(sql), client, { transaction: false });
  });
});
