# SEC-02 Códigos de invitación en el servidor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los códigos de invitación se generan solo en el servidor (12 caracteres criptográficos) y vencen a los 7 días si no se usan.

**Architecture:** Migración 053 con la RPC `admin_create_invitation_code` (SECURITY DEFINER, exige `is_admin()` = admin + aal2), políticas de `invitation_codes` reducidas a `select`/`delete` para admin, y vencimiento de 7 días para los códigos libres sin usar existentes. La PWA reemplaza el insert directo por la RPC y muestra el vencimiento.

**Tech Stack:** PostgreSQL (Supabase), PGlite + Vitest, React 19 + TypeScript, `@supabase/supabase-js`.

**Spec:** `docs/superpowers/specs/2026-11-17-sec-02-codigos-invitacion-design.md`

## Global Constraints

- Formato: `PESO-XXXX-XXXX-XXXX`, alfabeto `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, 12 caracteres aleatorios.
- Aleatoriedad: bytes de `gen_random_uuid()` (sin pgcrypto), descartando versión y variante; `byte & 31`.
- Vencimiento: `clock_timestamp() + interval '7 days'` en códigos nuevos y en los libres sin usar existentes con `expires_at is null`.
- `p_duration_days`: null o 1–3650. `p_notes`: trim, máximo 200, vacío → null.
- `search_path = pg_catalog, public`; `revoke all … from public, anon`; `grant execute … to authenticated`.
- No tocar códigos de renovación (`renewal_user_id is not null`), ni `guard_renewal_code`, ni las políticas de `pesito_subscription_writer`.
- No editar migraciones aplicadas (001–052). Solo datos ficticios en tests.

## Review Focus

- Código ingresado en minúsculas o con espacios en el alta: debe seguir validando (normalización actual `upper(trim)`); test en Task 1.
- Código vencido usado en el alta (`bootstrap_user`) y en el canje (`redeem_invitation_code`): rechazo; test en Task 1.
- PWA vieja intentando `insert` directo tras la 053: rechazo RLS, sin crear nada; test en Task 1.
- Admin con aal1 (MFA sin verificar) intenta generar: 42501; test en Task 1.
- Error de la RPC en la UI (red o 42501): el panel muestra el error y no muestra un código; test en Task 2.

---

### Task 1: Migración 053 y pruebas SQL

**Files:**
- Create: `supabase/migrations/053_server_invitation_codes.sql`
- Test: `tests/invitation-codes-sql.test.ts`

**Interfaces:**
- Produces: `public.admin_create_invitation_code(p_duration_days integer, p_notes text) returns jsonb` → `{ id: uuid, code: text, duration_days: integer|null, expires_at: timestamptz }`. Errores: 42501 si no es admin aal2; 22023 si los parámetros son inválidos.

- [ ] **Step 1: Escribir el test.** Armar el esquema como `tests/admin-mfa-sql.test.ts` (roles, `auth.uid()` por `request.jwt.claim.sub`, stubs cron/net/vault/http, 001–052 con un factor TOTP verificado para el admin) y aplicar 053. Helper `as(actor, aal, sql, args)` con `set local role authenticated` y savepoint. Tests:
  - `genera PESO-XXXX-XXXX-XXXX con el alfabeto permitido`: regex `^PESO-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}(-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){2}$`.
  - `200 códigos generados son distintos`.
  - `vence a los 7 días`: `expires_at - now()` entre 6d23h y 7d.
  - `guarda duración, nota recortada y created_by`; `nota vacía → null`; `duración null = membresía sin vencimiento`.
  - `rechaza duración 0, -1, 3651 y nota de 201 caracteres` con 22023.
  - `rechaza admin con aal1, cliente y anon` (42501; anon sin EXECUTE).
  - `insert y update directos de invitation_codes fallan para admin aal2` (RLS); `delete de un código libre funciona`; `delete de un código de renovación sigue bloqueado`.
  - `la 053 da 7 días a los códigos libres sin usar y no toca usados, con vencimiento previo ni de renovación` (insertar fixtures antes de aplicar 053).
  - `alta con código vencido falla y con código vigente en minúsculas funciona` (insert en `auth.users` con `raw_user_meta_data.invitation_code`).
  - `canje con código vencido devuelve success false`.
  - `la función es SECURITY DEFINER con search_path pg_catalog, public`.

- [ ] **Step 2: Correr y verificar que falla.** `npx vitest run tests/invitation-codes-sql.test.ts` → FAIL (falta la migración 053).

- [ ] **Step 3: Implementar la 053.** Función según Global Constraints; reintento ante `unique_violation` (hasta 5). Reemplazar la política `"admins manage invitation codes"` por `admins read invitation codes` (select) y `admins delete invitation codes` (delete), ambas `using (public.is_admin())`. `update` de existentes. Bloque `do` de verificación (prosecdef, proconfig, ACL anon/authenticated, que no quede política `for all`/insert/update para `authenticated` sobre `invitation_codes`). Terminar con `notify pgrst, 'reload schema';`.

- [ ] **Step 4: Correr y verificar que pasa.** Mismo comando → PASS. También `npx vitest run tests/admin-mfa-sql.test.ts tests/subscription-payment-codes.test.ts tests/signup-sql.test.ts` → PASS (sin regresiones).

- [ ] **Step 5: Commit.** `git add supabase/migrations/053_server_invitation_codes.sql tests/invitation-codes-sql.test.ts && git commit -m "feat(sql): códigos de invitación generados en el servidor (SEC-02)"`

### Task 2: Panel Admin usa la RPC y muestra el vencimiento

**Files:**
- Modify: `src/AdminPanel.tsx` (eliminar `generateRandomCode` :45-53; `handleCreateCode` :351-375; tipo `InvitationCode` agrega `expires_at: string | null`; celda Estado :1054-1059; mensaje WhatsApp :386-402)
- Test: `tests/admin-invitation-codes-ui.test.ts`

**Interfaces:**
- Consumes: `admin_create_invitation_code` de Task 1.

- [ ] **Step 1: Escribir el test** (jsdom, `AdminPanel` con `supabase` mockeado como en `tests/fe18-queries-and-pagination.test.ts`):
  - `Generar código llama a la RPC con duración y nota y muestra el código devuelto`: `rpc` llamado con `('admin_create_invitation_code', { p_duration_days: 30, p_notes: 'Nota' })`; no hay `from('invitation_codes').insert`; aparece `PESO-ABCD-EFGH-JKLM`.
  - `"Sin vencimiento" envía p_duration_days null`.
  - `si la RPC falla muestra el error y no muestra un código`.
  - `la lista muestra "Vence el …" en disponibles y "Vencido" si expires_at ya pasó`.
  - `el mensaje de WhatsApp menciona que el enlace vence en 7 días`.

- [ ] **Step 2: Correr y verificar que falla.** `npx vitest run tests/admin-invitation-codes-ui.test.ts` → FAIL.

- [ ] **Step 3: Implementar.** `handleCreateCode` usa `supabase.rpc('admin_create_invitation_code', { p_duration_days, p_notes })` y toma `data.code`. Error: mantener el patrón actual de `window.alert('Error al generar código: …')`. Estado del código libre: `Vence el <formatShortDate>` o `Vencido` (pill gris) si `expires_at <= now`; los vencidos no muestran botones de copiar. Mensaje: agregar la línea "⏳ El enlace vence en 7 días." después del paso 1.

- [ ] **Step 4: Correr y verificar que pasa.** Mismo comando → PASS; `npx vitest run tests/fe18-queries-and-pagination.test.ts tests/accessible-dialogs-and-labels.test.ts` → PASS.

- [ ] **Step 5: Commit.** `git add src/AdminPanel.tsx tests/admin-invitation-codes-ui.test.ts && git commit -m "feat(admin): generar invitaciones con la RPC del servidor y mostrar vencimiento (SEC-02)"`

### Task 3: Contrato de release, runbook y contexto

**Files:**
- Modify: `config/environments.json` (release: `minimumMigration '053'`, `rollbackCommit 'd350e08412a10aa71a552adc73381654b05b0c3e'`, `rollbackMinimumMigration '052'`)
- Modify: `scripts/release-tools.test.mjs` (constantes y rangos a 053/052, como se hizo para 052/051)
- Modify: `docs/operaciones/DEPLOY_Y_ROLLBACK.md` (sección "Contrato candidato 053": orden SQL 053 → PWA; rollback: conservar 053, PWA a d350e08, crear códigos queda bloqueado hasta republicar)
- Modify: `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md` (sección "SEC-02 … (en rama)")

- [ ] **Step 1: Actualizar el test de contrato** a 053/052 y correr `node --test scripts/release-tools.test.mjs` → FAIL hasta cambiar `environments.json`.
- [ ] **Step 2: Actualizar `environments.json`** y correr de nuevo → 14/14 PASS.
- [ ] **Step 3: Documentar** runbook y contexto.
- [ ] **Step 4: Verificación completa.** `npm run lint`, `npm test`, `npm run build` → todo OK.
- [ ] **Step 5: Commit.** `git add config/environments.json scripts/release-tools.test.mjs docs/operaciones/DEPLOY_Y_ROLLBACK.md docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md docs/superpowers && git commit -m "chore(release): contrato 053 y documentación de SEC-02"`
