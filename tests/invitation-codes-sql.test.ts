import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';
import { smokeInvitationContract } from '../scripts/release-invitation-contract.mjs';

// SEC-02 (Fase 1.2): los códigos de invitación se generan solo en el servidor y vencen a los 7 días.
// Datos ficticios. Esquema con las migraciones reales 001–052; la 053 se aplica sobre fixtures previos.
const readFile = async (path: URL | string) => (await readSqlFile(path, 'utf8')).replace(/\r\n/g, '\n');
const FORMAT = /^PESO-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}(-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){2}$/;
type Created = { id: string; code: string; duration_days: number | null; expires_at: string };

describe('SEC-02: códigos de invitación generados en el servidor (migración 053)', { timeout: 120_000 }, () => {
  const db = new PGlite();
  const admin = '53000000-0000-4000-8000-000000000001';
  const client = '53000000-0000-4000-8000-000000000002';
  const migrationUrl = new URL('../supabase/migrations/', import.meta.url);

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
    for (const m of migrations.filter((m) => m >= '021' && m < '053')) {
      let sql = await readFile(new URL(m, migrationUrl));
      if (m === '021_whatsapp_queue_recovery.sql' || m === '022_whatsapp_recovery_private_transport.sql') {
        sql = sql.replace(/^create extension[^\n]+\n/gm, '');
      }
      if (m === '027_whatsapp_observability.sql') {
        await db.exec(`alter table cron.job add column if not exists jobid bigint generated always as identity, add column if not exists active boolean default true;
          create table if not exists cron.job_run_details(jobid bigint, status text, start_time timestamptz default clock_timestamp(), end_time timestamptz);`);
      }
      if (m === '052_admin_requires_mfa.sql') {
        await db.exec('create table auth.mfa_factors(user_id uuid, factor_type text, status text)');
        await db.query("insert into auth.mfa_factors values($1, 'totp', 'verified')", [admin]);
      }
      await db.exec(sql);
    }
    // Cliente activo por el alta real y fixtures de códigos ANTERIORES a la 053.
    await db.exec("insert into public.invitation_codes(code, duration_days) values('PESO-CLIE-2026', 30)");
    await db.query(`insert into auth.users(id, email, raw_user_meta_data) values($1, 'cliente@example.invalid', '{"invitation_code":"PESO-CLIE-2026"}')`, [client]);
    await db.query(`insert into public.invitation_codes(code, duration_days, expires_at, renewal_user_id, is_used, used_by, used_at) values
      ('PESO-LIBR-2026', 30, null, null, false, null, null),
      ('PESO-PREV-2026', 30, '2030-01-01T00:00:00Z', null, false, null, null),
      ('PESO-USAD-2026', 30, null, null, true, $1, now()),
      ('PR-RENOVACIONFICTICIA0001', 30, null, $1, false, null, null)`, [client]);
    await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated');
    await db.exec(await readFile(new URL('053_server_invitation_codes.sql', migrationUrl)));
  }, 120_000);

  afterAll(async () => { await db.close(); });
  beforeEach(async () => { await db.exec('begin'); });
  afterEach(async () => { await db.exec('rollback'); });

  async function as<T>(actor: string, aal: '' | 'aal1' | 'aal2', sql: string, args: unknown[] = [], role = 'authenticated'): Promise<T> {
    await db.exec('savepoint caller');
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.aal', $2, true), set_config('request.jwt.claims', '', true)", [actor, aal]);
      await db.exec(`set local role ${role}`);
      const result = await db.query<{ r: T }>(sql, args);
      await db.exec('reset role; release savepoint caller');
      return result.rows[0]?.r;
    } catch (error) {
      await db.exec('rollback to savepoint caller; release savepoint caller');
      throw error;
    }
  }
  const create = (days: number | null = 30, notes: string | null = null, actor = admin, aal: '' | 'aal1' | 'aal2' = 'aal2', role = 'authenticated') =>
    as<Created>(actor, aal, 'select public.admin_create_invitation_code($1, $2) as r', [days, notes], role);
  const codeRow = async (code: string) => (await db.query<{ expires_at: string | null; is_used: boolean }>(
    'select expires_at, is_used from public.invitation_codes where code = $1', [code])).rows[0];

  it('genera PESO-XXXX-XXXX-XXXX con el alfabeto permitido', async () => {
    const created = await create();
    expect(created.code).toMatch(FORMAT);
  });

  it('200 códigos generados son distintos', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add((await create()).code);
    expect(codes.size).toBe(200);
  });

  it('vence a los 7 días', async () => {
    const created = await create();
    const hours = (new Date(created.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(7 * 24 - 1);
    expect(hours).toBeLessThanOrEqual(7 * 24);
  });

  it('guarda duración, nota recortada y created_by', async () => {
    const created = await create(90, '  Cliente ficticio  ');
    const row = (await db.query<{ duration_days: number; notes: string; created_by: string }>(
      'select duration_days, notes, created_by from public.invitation_codes where id = $1', [created.id])).rows[0];
    expect(row).toEqual({ duration_days: 90, notes: 'Cliente ficticio', created_by: admin });
  });

  it('nota vacía → null y duración null = membresía sin vencimiento', async () => {
    const created = await create(null, '   ');
    expect(created.duration_days).toBeNull();
    const row = (await db.query<{ notes: string | null }>('select notes from public.invitation_codes where id = $1', [created.id])).rows[0];
    expect(row.notes).toBeNull();
  });

  it('rechaza duración 0, -1, 3651 y nota de 201 caracteres con 22023', async () => {
    for (const days of [0, -1, 3651]) await expect(create(days)).rejects.toMatchObject({ code: '22023' });
    await expect(create(30, 'x'.repeat(201))).rejects.toMatchObject({ code: '22023' });
  });

  it('rechaza admin con aal1, cliente y anon', async () => {
    await expect(create(30, null, admin, 'aal1')).rejects.toMatchObject({ code: '42501' });
    await expect(create(30, null, client, 'aal2')).rejects.toMatchObject({ code: '42501' });
    await expect(create(30, null, '', '', 'anon')).rejects.toMatchObject({ code: '42501' });
  });

  it('insert y update directos de invitation_codes fallan para admin aal2', async () => {
    await expect(as(admin, 'aal2', "insert into public.invitation_codes(code, duration_days) values('PESO-DEBI-2026', 30) returning id as r"))
      .rejects.toMatchObject({ code: '42501' });
    await expect(as(admin, 'aal2', "update public.invitation_codes set duration_days = null, expires_at = null where code = 'PESO-LIBR-2026' returning id as r"))
      .rejects.toMatchObject({ code: '42501' });
    const row = (await db.query<{ duration_days: number | null; expires_at: string | null }>(
      "select duration_days, expires_at from public.invitation_codes where code = 'PESO-LIBR-2026'")).rows[0];
    expect(row.duration_days).toBe(30);
    expect(row.expires_at).not.toBeNull();
  });

  it('el admin puede borrar un código libre pero no uno de renovación', async () => {
    const created = await create();
    expect(await as(admin, 'aal2', 'delete from public.invitation_codes where id = $1 returning id as r', [created.id])).toBe(created.id);
    await expect(as(admin, 'aal2', "delete from public.invitation_codes where code = 'PR-RENOVACIONFICTICIA0001' returning id as r"))
      .rejects.toMatchObject({ code: '22023' });
  });

  it('el admin sigue viendo los códigos y un cliente no', async () => {
    expect(await as(admin, 'aal2', 'select count(*)::int as r from public.invitation_codes')).toBeGreaterThan(0);
    expect(await as(client, 'aal2', 'select count(*)::int as r from public.invitation_codes')).toBe(0);
  });

  it('la 053 da 7 días a los códigos libres sin usar y no toca usados, con vencimiento previo ni de renovación', async () => {
    const free = await codeRow('PESO-LIBR-2026');
    const hours = (new Date(free.expires_at!).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(7 * 24 - 1);
    expect(hours).toBeLessThanOrEqual(7 * 24);
    expect(new Date((await codeRow('PESO-PREV-2026')).expires_at!).toISOString()).toBe('2030-01-01T00:00:00.000Z');
    expect((await codeRow('PESO-USAD-2026')).expires_at).toBeNull();
    expect((await codeRow('PR-RENOVACIONFICTICIA0001')).expires_at).toBeNull();
  });

  it('alta con código vencido falla', async () => {
    await db.exec("update public.invitation_codes set expires_at = now() - interval '1 minute' where code = 'PESO-LIBR-2026'");
    await db.exec('savepoint signup');
    await expect(db.query(`insert into auth.users(id, email, raw_user_meta_data) values('53000000-0000-4000-8000-000000000010', 'vencido@example.invalid', '{"invitation_code":"PESO-LIBR-2026"}')`))
      .rejects.toThrow('REGISTRATION_INITIALIZATION_FAILED');
    await db.exec('rollback to savepoint signup; release savepoint signup');
    expect((await db.query("select 1 from public.profiles where id = '53000000-0000-4000-8000-000000000010'")).rows).toHaveLength(0);
    expect((await codeRow('PESO-LIBR-2026')).is_used).toBe(false);
  });

  it('alta con código vigente escrito en minúsculas y con espacios funciona', async () => {
    const created = await create(30);
    await db.query(`insert into auth.users(id, email, raw_user_meta_data) values('53000000-0000-4000-8000-000000000011', 'nuevo@example.invalid', $1)`,
      [JSON.stringify({ invitation_code: `  ${created.code.toLowerCase()} ` })]);
    expect((await codeRow(created.code)).is_used).toBe(true);
  });

  it('canje con código vencido devuelve success false', async () => {
    await db.exec("update public.invitation_codes set expires_at = now() - interval '1 minute' where code = 'PESO-LIBR-2026'");
    const result = await as<{ success: boolean; error: string }>(client, 'aal1', "select public.redeem_invitation_code('PESO-LIBR-2026', $1) as r", [client]);
    expect(result).toMatchObject({ success: false, error: 'Código de invitación inválido o no disponible.' });
    expect((await codeRow('PESO-LIBR-2026')).is_used).toBe(false);
  });

  it('la función es SECURITY DEFINER con search_path pg_catalog, public', async () => {
    const row = (await db.query<{ prosecdef: boolean; proconfig: string[] }>(
      "select prosecdef, proconfig from pg_proc where oid = 'public.admin_create_invitation_code(integer, text)'::regprocedure")).rows[0];
    expect(row.prosecdef).toBe(true);
    expect(row.proconfig).toContain('search_path=pg_catalog, public');
  });

  it('el contrato del ensayo de release para invitaciones pasa con la 053', async () => {
    await smokeInvitationContract((sql: string) => db.exec(sql), { transaction: false });
  });

  it('el contrato detecta un permiso de escritura por columna para clientes', async () => {
    await db.exec('grant update(notes) on public.invitation_codes to authenticated');
    await expect(smokeInvitationContract((sql: string) => db.exec(sql), { transaction: false })).rejects.toThrow('RELEASE_INVITATION_DIRECT_WRITE');
  });
});
