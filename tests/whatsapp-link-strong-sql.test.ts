import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile as readSqlFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseLinkCommand } from '../supabase/functions/whatsapp-webhook/link-code.ts';

// SEC-01 (Fase 1.3): código de vinculación de WhatsApp largo y avisos de vínculo por Web Push.
// Datos ficticios. Esquema con las migraciones reales 001–053; la 054 se aplica sobre fixtures previos.
const readFile = async (path: URL | string) => (await readSqlFile(path, 'utf8')).replace(/\r\n/g, '\n');
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const FORMAT = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}(-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){2}$/;
const ISO_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const OK_REPLY = '¡Listo! Tu WhatsApp quedó vinculado con Pesito ✅';
const BAD_CODE = 'Ese código no es válido o ya venció 🤔\nGenerá uno nuevo desde la app, en Ajustes.'; // texto vigente (050)
const LOCKED = 'Demasiados intentos fallidos de vinculación. Por seguridad, esperá 15 minutos antes de volver a intentar.';

type LinkCode = { code: string; expires_at: string };
type Notice = { user_id: string; kind: string; period_key: string };

describe('SEC-01: vinculación de WhatsApp con código largo (migración 054)', { timeout: 120_000 }, () => {
  const db = new PGlite();
  const migrationUrl = new URL('../supabase/migrations/', import.meta.url);
  const admin = '54000000-0000-4000-8000-000000000001';
  const userA = '54000000-0000-4000-8000-000000000002';
  const userB = '54000000-0000-4000-8000-000000000003';
  const userC = '54000000-0000-4000-8000-000000000004'; // sin suscripción push
  const token1 = '54100000-0000-4000-8000-000000000001';
  const sender1 = '5491100005401';
  const sender2 = '5491100005402';
  const legacyCode = '123456';
  const FUNCTIONS = ['request_whatsapp_link_code', 'apply_whatsapp_job'];
  const propertiesSql = `select p.proname, pg_get_userbyid(p.proowner) as owner, p.proacl::text as proacl, p.prosecdef, p.proconfig
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any($1) order by p.proname`;
  let propertiesBefore: unknown[];

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
    for (const m of migrations.filter((m) => m >= '021' && m < '054')) {
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
    // Clientes activos por el alta real (códigos de invitación ficticios).
    await db.exec("insert into public.invitation_codes(code, duration_days) values('PESO-SECA-2026', 30), ('PESO-SECB-2026', 30), ('PESO-SECC-2026', 30)");
    await db.query(`insert into auth.users(id, email, raw_user_meta_data) values
      ($1, 'a@example.invalid', '{"invitation_code":"PESO-SECA-2026"}'),
      ($2, 'b@example.invalid', '{"invitation_code":"PESO-SECB-2026"}'),
      ($3, 'c@example.invalid', '{"invitation_code":"PESO-SECC-2026"}')`, [userA, userB, userC]);
    // A y B tienen un dispositivo con notificaciones; C no.
    await db.query(`insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values
      ($1, 'https://push.example.test/a', $3, $4), ($2, 'https://push.example.test/b', $3, $4)`,
    [userA, userB, 'B' + 'a'.repeat(86), 'a'.repeat(22)]);
    // Código de 6 dígitos pendiente ANTES de la 054.
    await db.query("update public.whatsapp_links set link_code_hash = $2, link_code_expires_at = clock_timestamp() + interval '10 minutes' where user_id = $1",
      [userA, sha256(legacyCode)]);
    propertiesBefore = (await db.query(propertiesSql, [FUNCTIONS])).rows;
    await db.exec(await readFile(new URL('054_whatsapp_link_strong_code.sql', migrationUrl)));
  }, 120_000);

  afterAll(async () => { await db.close(); });
  beforeEach(async () => { await db.exec('begin; update public.whatsapp_queue_control set enabled = true'); });
  afterEach(async () => { await db.exec('rollback'); });

  async function requestCode(actor: string): Promise<LinkCode> {
    await db.exec('savepoint caller');
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [actor]);
      await db.exec('set local role authenticated');
      const result = await db.query<{ r: LinkCode }>('select public.request_whatsapp_link_code() as r');
      await db.exec('reset role; release savepoint caller');
      return result.rows[0].r;
    } catch (error) {
      await db.exec('rollback to savepoint caller; release savepoint caller');
      throw error;
    }
  }

  async function applyLink(sender: string, hash: string): Promise<string> {
    await db.query('insert into public.whatsapp_worker_state(wa_id) values($1) on conflict do nothing', [sender]);
    await db.query('select public.claim_whatsapp_actor($1, $2)', [sender, token1]);
    const msgId = 'msg-sec01-' + Math.random().toString(36).slice(2, 10);
    const job = (await db.query<{ id: string }>(
      `insert into public.whatsapp_message_queue(wa_message_id, wa_id, payload, queue_version, status, attempts)
       values($1, $2, '{"type":"text"}', 2, 'processing', 1) returning id`, [msgId, sender])).rows[0];
    const res = await db.query<{ r: { reply_text: string } }>(
      'select public.apply_whatsapp_job($1, $2, $3::jsonb) as r', [job.id, token1, JSON.stringify({ kind: 'link', hash })]);
    return res.rows[0].r.reply_text;
  }

  const linkWithNewCode = async (user: string, sender: string) =>
    applyLink(sender, sha256(parseLinkCommand('vincular ' + (await requestCode(user)).code.toLowerCase())!));

  const notices = async (user?: string) => (await db.query<Notice>(
    `select user_id, kind, period_key from public.client_notifications
     where kind in ('whatsapp_linked', 'whatsapp_unlinked') and ($1::uuid is null or user_id = $1)
     order by created_at, kind`, [user ?? null])).rows;

  it('genera XXXX-XXXX-XXXX con el alfabeto', async () => {
    expect((await requestCode(userA)).code).toMatch(FORMAT);
  });

  it('200 códigos distintos', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add((await requestCode(userA)).code);
    expect(codes.size).toBe(200);
  });

  it('vence a los 10 minutos', async () => {
    const created = await requestCode(userA);
    const minutes = (new Date(created.expires_at).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(9);
    expect(minutes).toBeLessThanOrEqual(10.05);
  });

  it('el hash guardado es el del código normalizado', async () => {
    const { code } = await requestCode(userA);
    const row = (await db.query<{ link_code_hash: string }>('select link_code_hash from public.whatsapp_links where user_id = $1', [userA])).rows[0];
    expect(row.link_code_hash).toBe(sha256(code.replace(/-/g, '')));
    expect(row.link_code_hash).not.toBe(sha256(code));
  });

  it('vincular con ese hash funciona', async () => {
    expect(await linkWithNewCode(userA, sender1)).toContain(OK_REPLY);
    const link = (await db.query<{ status: string; wa_id: string; link_code_hash: string | null }>(
      'select status, wa_id, link_code_hash from public.whatsapp_links where user_id = $1', [userA])).rows[0];
    expect(link).toEqual({ status: 'active', wa_id: sender1, link_code_hash: null });
    const profile = (await db.query<{ phone_number: string }>('select phone_number from public.profiles where id = $1', [userA])).rows[0];
    expect(profile.phone_number).toBe(sender1);
  });

  it('la 054 anula los códigos pendientes', async () => {
    const pending = (await db.query<{ n: number }>('select count(*)::int as n from public.whatsapp_links where link_code_hash is not null or link_code_expires_at is not null')).rows[0];
    expect(pending.n).toBe(0);
    expect(await applyLink(sender1, sha256(legacyCode))).toBe(BAD_CODE);
  });

  it('vínculo nuevo con suscripción push → un whatsapp_linked', async () => {
    await linkWithNewCode(userA, sender1);
    const rows = await notices();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: userA, kind: 'whatsapp_linked' });
    expect(rows[0].period_key).toMatch(ISO_KEY);
    const linkedAt = (await db.query<{ k: string }>(
      `select to_char(linked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as k from public.whatsapp_links where user_id = $1`, [userA])).rows[0];
    expect(rows[0].period_key).toBe(linkedAt.k);
  });

  it('sin suscripción push → ninguna fila', async () => {
    expect(await linkWithNewCode(userC, sender1)).toContain(OK_REPLY);
    expect(await notices()).toEqual([]);
  });

  it('cambio de número → whatsapp_linked al dueño', async () => {
    await linkWithNewCode(userA, sender1);
    await linkWithNewCode(userA, sender2);
    const rows = await notices();
    expect(rows.map((r) => [r.user_id, r.kind])).toEqual([[userA, 'whatsapp_linked'], [userA, 'whatsapp_linked']]);
    expect(new Set(rows.map((r) => r.period_key)).size).toBe(2);
  });

  it('número que pasa de A a B → A whatsapp_unlinked y B whatsapp_linked', async () => {
    await linkWithNewCode(userA, sender1);
    await db.exec('delete from public.client_notifications');
    expect(await linkWithNewCode(userB, sender1)).toContain(OK_REPLY);
    const rows = await notices();
    expect(rows.map((r) => [r.user_id, r.kind]).sort()).toEqual([[userA, 'whatsapp_unlinked'], [userB, 'whatsapp_linked']].sort());
    const linkA = (await db.query<{ wa_id: string | null }>('select wa_id from public.whatsapp_links where user_id = $1', [userA])).rows[0];
    expect(linkA.wa_id).toBeNull();
  });

  it('número que pasa de una cuenta sin push a otra con push → solo whatsapp_linked de la nueva', async () => {
    await linkWithNewCode(userC, sender1);
    expect(await linkWithNewCode(userA, sender1)).toContain(OK_REPLY);
    expect((await notices()).map((r) => [r.user_id, r.kind])).toEqual([[userA, 'whatsapp_linked']]);
  });

  it('dueño previo presente solo en profiles.phone_number → whatsapp_unlinked si tiene push', async () => {
    await db.query('update public.profiles set phone_number = $2 where id = $1', [userA, sender1]);
    const active = (await db.query<{ n: number }>("select count(*)::int as n from public.whatsapp_links where wa_id = $1 and status = 'active'", [sender1])).rows[0];
    expect(active.n).toBe(0);
    expect(await linkWithNewCode(userB, sender1)).toContain(OK_REPLY);
    expect((await notices()).map((r) => [r.user_id, r.kind]).sort()).toEqual([[userA, 'whatsapp_unlinked'], [userB, 'whatsapp_linked']].sort());
  });

  it('re-vincular el mismo número → sin avisos nuevos', async () => {
    await linkWithNewCode(userA, sender1);
    expect(await notices()).toHaveLength(1);
    expect(await linkWithNewCode(userA, sender1)).toContain(OK_REPLY);
    expect(await notices()).toHaveLength(1);
  });

  it('código inválido → sin avisos', async () => {
    await requestCode(userA);
    expect(await applyLink(sender1, sha256('ZZZZZZZZZZZZ'))).toBe(BAD_CODE);
    expect(await notices()).toEqual([]);
  });

  it('claim_client_notifications entrega whatsapp_linked aunque client_reminders_enabled y monthly_summary_enabled estén apagados', async () => {
    await db.query('update public.app_settings set client_reminders_enabled = false, monthly_summary_enabled = false where user_id = $1', [userA]);
    await linkWithNewCode(userA, sender1);
    const claimed = (await db.query<{ r: Array<{ kind: string; period_key: string; subscriptions: unknown[] }> }>(
      "select public.claim_client_notifications('54200000-0000-4000-8000-000000000001'::uuid, 50) as r")).rows[0].r;
    const mine = claimed.filter((n) => n.kind === 'whatsapp_linked');
    expect(mine).toHaveLength(1);
    expect(mine[0].subscriptions).toHaveLength(1);
  });

  it('el límite por teléfono sigue: 5 fallos bloquean', async () => {
    const valid = sha256((await requestCode(userA)).code.replace(/-/g, ''));
    const invalid = sha256('ZZZZZZZZZZZZ');
    for (let i = 0; i < 4; i++) expect(await applyLink(sender1, invalid)).toBe(BAD_CODE);
    expect(await applyLink(sender1, invalid)).toBe(LOCKED);
    expect(await applyLink(sender1, valid)).toBe(LOCKED);
    const link = (await db.query<{ status: string }>('select status from public.whatsapp_links where user_id = $1', [userA])).rows[0];
    expect(link.status).not.toBe('active');
    expect(await notices()).toEqual([]);
  });

  it('request_whatsapp_link_code y apply_whatsapp_job conservan dueño, SECURITY DEFINER, search_path y EXECUTE', async () => {
    const after = (await db.query(propertiesSql, [FUNCTIONS])).rows;
    expect(after).toEqual(propertiesBefore);
    const privs = (await db.query<Record<string, boolean>>(`select
      has_function_privilege('authenticated', 'public.request_whatsapp_link_code()', 'execute') as req_auth,
      has_function_privilege('anon', 'public.request_whatsapp_link_code()', 'execute') as req_anon,
      has_function_privilege('authenticated', 'public.apply_whatsapp_job(uuid,uuid,jsonb)', 'execute') as apply_auth,
      has_function_privilege('anon', 'public.apply_whatsapp_job(uuid,uuid,jsonb)', 'execute') as apply_anon,
      has_function_privilege('service_role', 'public.apply_whatsapp_job(uuid,uuid,jsonb)', 'execute') as apply_service`)).rows[0];
    expect(privs).toEqual({ req_auth: true, req_anon: false, apply_auth: false, apply_anon: false, apply_service: true });
  });
});
