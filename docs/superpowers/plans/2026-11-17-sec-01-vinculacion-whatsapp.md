# SEC-01 Vinculación de WhatsApp robusta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El código de vinculación pasa a 12 caracteres criptográficos legibles y el dueño recibe un aviso push cuando su cuenta gana o pierde un número.

**Architecture:** Un helper puro del webhook normaliza y reconoce el comando `VINCULAR` (formato nuevo y el de 6 dígitos durante la transición); la PWA acepta ambos formatos; la migración 054 genera el código nuevo, anula los pendientes, encola avisos `whatsapp_linked`/`whatsapp_unlinked` al vincular y amplía el check de `client_notifications`. El envío usa el cron horario existente.

**Tech Stack:** PostgreSQL (Supabase), PGlite + Vitest, Edge Function Deno (TypeScript), React 19.

**Spec:** `docs/superpowers/specs/2026-11-17-sec-01-vinculacion-whatsapp-design.md`

## Global Constraints

- Alfabeto `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`; 12 caracteres; presentación `XXXX-XXXX-XXXX`; mensaje `VINCULAR XXXX-XXXX-XXXX`.
- Hash = `sha256` hex del código **normalizado** (mayúsculas, sin espacios ni guiones), igual en SQL y webhook.
- Aleatoriedad SQL: bytes de `uuid_send(gen_random_uuid())` sin los índices 6 y 8, `byte & 31` (como la 053).
- Vencimiento 10 minutos, uso único, límite 5 fallos / 15 min por teléfono: sin cambios.
- Avisos push: `whatsapp_linked` y `whatsapp_unlinked`, `url: ./#settings`, sin números de teléfono, nombres ni datos financieros. Se encolan solo si la cuenta tiene suscripción push; sin filtro por estado de membresía; re-vinculación al mismo número no avisa.
- No editar migraciones 001–053. Sin dependencias nuevas. Solo datos ficticios.

## Review Focus

- Frase común que empieza con "vincular" (p. ej. "vincular la tarjeta con la cuenta", "vincular" solo): no es vinculación ni suma intentos; test en Task 1.
- Código bien formado escrito con `O`/`0`/`I`/`1` u otro carácter fuera del alfabeto: se reconoce por forma, no existe, cuenta como intento fallido (como hoy); test en Task 1.
- Dos cuentas compiten por el mismo número (número que pasa de A a B): A recibe `whatsapp_unlinked`, B `whatsapp_linked`, ninguna fila duplicada; test en Task 3.
- Cuenta sin suscripción push que vincula: no se crea fila de aviso; test en Task 3.
- PWA recibiendo todavía un código de 6 dígitos (SQL anterior) durante la transición: sigue funcionando; test en Task 2.

---

### Task 1: Webhook — comando VINCULAR y avisos push nuevos

**Files:**
- Create: `supabase/functions/whatsapp-webhook/link-code.ts`
- Modify: `supabase/functions/whatsapp-webhook/processor.ts:74-75`
- Modify: `supabase/functions/whatsapp-webhook/client-push.ts` (tipo `kind` y `formatClientPush`)
- Test: `tests/whatsapp-link-code.test.ts`, `tests/client-push.test.ts`

**Interfaces:**
- Produces: `parseLinkCommand(text: string): string | null` — devuelve el código normalizado (`K7QMX3RT9PZD` o `123456`) o `null` si el texto no tiene forma de comando de vinculación. `processor.ts` hace `{ kind: "link", hash: await sha256(normalizado) }`.
- Produces: `ClientNotification.kind` incluye `"whatsapp_linked" | "whatsapp_unlinked"`.

- [ ] **Step 1: Tests** en `tests/whatsapp-link-code.test.ts`:
  - `reconoce el formato nuevo en mayúsculas, minúsculas, con guiones, con espacios y sin separadores` → todos `'K7QMX3RT9PZD'` (`VINCULAR K7QM-X3RT-9PZD`, `vincular k7qm-x3rt-9pzd`, `Vincular K7QM X3RT 9PZD`, `vincular k7qmx3rt9pzd`, con espacios alrededor).
  - `acepta 6 dígitos durante la transición` → `'123456'`.
  - `no reconoce frases comunes` → `null` para `vincular la tarjeta con la cuenta`, `vincular`, `vincular 12345`, `vincular K7QM-X3RT`, `vinculame K7QM-X3RT-9PZD`.
  - `un código con forma válida pero fuera del alfabeto se devuelve normalizado` → `vincular O0I1-AAAA-BBBB` → `'O0I1AAAABBBB'` (luego no existe y cuenta como intento).
  - En `tests/client-push.test.ts`: `whatsapp_linked` y `whatsapp_unlinked` tienen título/cuerpo del spec, `url './#settings'`, tags distintos, y ningún texto contiene dígitos.
- [ ] **Step 2:** `npx vitest run tests/whatsapp-link-code.test.ts tests/client-push.test.ts` → FAIL.
- [ ] **Step 3: Implementar.** Regex de forma: `^vincular\s+(?:([a-z0-9]{4})[\s-]?([a-z0-9]{4})[\s-]?([a-z0-9]{4})|(\d{6}))$` (i, sobre el texto con `trim`). Textos exactos del spec para los dos avisos.
- [ ] **Step 4:** mismo comando → PASS; `npx vitest run tests/be18-webhook-architecture-and-calls.test.ts tests/renewal-delivery.test.ts` → PASS; `deno task --config supabase/functions/whatsapp-webhook/deno.ci.json check` si Deno está disponible (si no, registrarlo como no verificado localmente; lo corre el CI).
- [ ] **Step 5: Commit** `feat(webhook): código de vinculación largo y avisos de vínculo (SEC-01)`.

### Task 2: PWA — aceptar ambos formatos

**Files:**
- Modify: `src/whatsappLink.ts`
- Test: `tests/whatsapp-link.test.ts`

- [ ] **Step 1: Tests:** `acepta el código nuevo` (`'K7QM-X3RT-9PZD'` → devuelto igual); el caso existente de `'123456'` sigue pasando; `rechaza formatos inválidos` agrega `'K7QM-X3RT'`, `'k7qm-x3rt-9pzd'` (minúsculas), `'K7QM-X3RT-9PZ0'` (fuera del alfabeto).
- [ ] **Step 2:** `npx vitest run tests/whatsapp-link.test.ts` → FAIL.
- [ ] **Step 3:** validar `^\d{6}$` **o** `^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}(-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){2}$`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat(pwa): aceptar el código de vinculación nuevo (SEC-01)`.

### Task 3: Migración 054 y pruebas SQL

**Files:**
- Create: `supabase/migrations/054_whatsapp_link_strong_code.sql`
- Create: `tests/whatsapp-link-strong-sql.test.ts`
- Modify: `tests/whatsapp-linking-sql.test.ts` (si su esquema llega a 054, hashear el código normalizado)

**Interfaces:**
- Consumes: hash = sha256 del normalizado (Task 1).
- Produces: `request_whatsapp_link_code()` → `{code: 'XXXX-XXXX-XXXX', expires_at}` (misma firma, permisos y dueño).

- [ ] **Step 1: Tests** (PGlite 001–053 como `tests/invitation-codes-sql.test.ts`, fixtures previos, luego 054; usuarios ficticios con suscripción activa):
  - `genera XXXX-XXXX-XXXX con el alfabeto`; `200 códigos distintos`; `vence a los 10 minutos`.
  - `el hash guardado es el del código normalizado` y `vincular con ese hash funciona` (vía `enqueue`/`claim`/`next`/`apply` como `whatsapp-linking-sql.test.ts`).
  - `la 054 anula los códigos pendientes` (fixture con hash antes de aplicar → `link_code_hash` null).
  - `vínculo nuevo con suscripción push → un whatsapp_linked`; `sin suscripción push → ninguna fila`.
  - `número que pasa de A a B → A whatsapp_unlinked y B whatsapp_linked`.
  - `re-vincular el mismo número → sin avisos nuevos`; `código inválido → sin avisos`.
  - `claim_client_notifications entrega whatsapp_linked aunque client_reminders_enabled y monthly_summary_enabled estén apagados`.
  - `el límite por teléfono sigue: 5 fallos bloquean`.
  - `request_whatsapp_link_code y apply_whatsapp_job conservan dueño, SECURITY DEFINER, search_path y EXECUTE`.
- [ ] **Step 2:** `npx vitest run tests/whatsapp-link-strong-sql.test.ts` → FAIL (falta 054).
- [ ] **Step 3: Implementar 054.** `create or replace` de `request_whatsapp_link_code` (base 018). Rama `link` de `apply_whatsapp_job`: partir de `pg_get_functiondef` vigente, reemplazar el bloque de éxito (las 5 sentencias `update` desde `update public.whatsapp_links set wa_id=null,status='pending'` hasta `update public.whatsapp_worker_state set user_id=u…`) verificando que aparezca exactamente una vez (si no, abortar), capturando antes el dueño previo del número y el número previo de la cuenta, y encolando los avisos con `on conflict do nothing` y `period_key` = marca de tiempo ISO del vínculo. Ampliar `client_notifications_kind_check`. `update whatsapp_links set link_code_hash=null, link_code_expires_at=null where link_code_hash is not null`. Bloque de verificación y `notify pgrst`.
- [ ] **Step 4:** → PASS; `npx vitest run tests/whatsapp-linking-sql.test.ts tests/client-notices.test.ts tests/client-push.test.ts tests/monthly-summary-push-sql.test.ts tests/durable-queue.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(sql): código de vinculación largo y avisos de vínculo (SEC-01)`.

### Task 4: Contrato de release y documentación

**Files:** `config/environments.json` (mínimo `054`, rollback = commit de `main` antes del merge, mínimo `053`), `scripts/release-tools.test.mjs` (053/052 → 054/053), `docs/operaciones/DEPLOY_Y_ROLLBACK.md` (contrato 054: orden merge/PWA → webhook → SQL; rollback sin volver el webhook a v75), `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md` (sección SEC-01 en rama).

- [ ] **Step 1:** actualizar el test de contrato → `node --test scripts/release-tools.test.mjs` FAIL.
- [ ] **Step 2:** `environments.json` → 14/14 PASS.
- [ ] **Step 3:** documentar.
- [ ] **Step 4:** `npm run lint`, `npm test`, `npm run build`, `npm run test:release:guards` → OK.
- [ ] **Step 5: Commit** `chore(release): contrato 054 y documentación de SEC-01`.
