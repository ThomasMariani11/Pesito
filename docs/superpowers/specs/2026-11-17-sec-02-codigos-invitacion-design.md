# SEC-02 — Códigos de invitación generados en el servidor (diseño corto)

Fecha: 17/11/2026. Fase 1.2 del plan de remediación de la auditoría de pre-lanzamiento.

## Intención

Que nadie pueda adivinar un código de invitación y obtener una membresía sin pagar. Hoy el Panel Admin arma el código en el navegador (`PESO-XXXX-2026`: 4 caracteres con `Math.random`, ~1 millón de combinaciones), lo inserta directo en `invitation_codes` y nunca completa `expires_at`.

## Objetivos

- El código de invitación se genera **solo en el servidor**, con aleatoriedad criptográfica y **12 caracteres** de un alfabeto de 32 (~10¹⁸ combinaciones).
- Todo código de invitación nuevo **vence a los 7 días** si no se usa (decisión del propietario, 17/11/2026).
- Los códigos de invitación **sin usar que ya existen** reciben el mismo plazo, contado desde la aplicación de la migración (decisión del propietario).
- Ni la PWA ni otro cliente pueden insertar ni modificar códigos directamente.

## No objetivos

- Códigos de **renovación** (`PR-…`, 043): ya se generan en el servidor; no cambian.
- **SEC-10** (identificador del límite de `check_invitation_code` tomado de cabeceras): queda para un paso posterior, después de observar qué cabeceras llegan en producción.
- **Límite propio en el alta:** no se construye. Un contador en `bootstrap_user` se perdería con el rollback del alta fallida, y con ~10¹⁸ combinaciones adivinar deja de ser viable. El límite de altas de Supabase Auth se revisa en la consola (Fase 0.3).

## Anti-objetivos

- Que un cliente invitado antes de la migración pierda su código sin aviso (por eso los existentes reciben 7 días, no se anulan).
- Que una versión vieja de la PWA, o cualquier cliente, pueda seguir creando códigos débiles.
- Debilitar el MFA de la 052: la generación exige admin con `aal2`.

## Enfoques considerados

- **A. RPC de generación + quitar el insert directo (elegido por el propietario).** Mismo patrón que los códigos de renovación; el servidor es la única fuente de códigos.
- B. Insert directo con un trigger que reemplace código y vencimiento: el panel guardaría un código y la base otro; confuso y frágil. Descartado.
- C. Edge Function: suma superficie expuesta sin ventaja. Descartado.

## Diseño

**Migración 053** (`053_server_invitation_codes.sql`):

- `public.admin_create_invitation_code(p_duration_days integer, p_notes text) returns jsonb`
  - `SECURITY DEFINER`, `set search_path = pg_catalog, public`. Exige `public.is_admin()` (por lo tanto `aal2`); si no, 42501.
  - Valida `p_duration_days` nulo (membresía sin vencimiento) o entre 1 y 3650; `p_notes` recortado, máximo 200 caracteres, vacío → null.
  - Genera `PESO-XXXX-XXXX-XXXX` con el alfabeto `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`. Aleatoriedad: bytes de `gen_random_uuid()` (CSPRNG, sin depender de pgcrypto), descartando los bytes de versión y variante; cada byte & 31 (uniforme porque 256 es múltiplo de 32). Reintenta ante `unique_violation`.
  - Inserta con `expires_at = clock_timestamp() + interval '7 days'`, `created_by = auth.uid()`. Devuelve `{id, code, duration_days, expires_at}`.
  - `revoke all … from public, anon`; `grant execute … to authenticated`.
- **Políticas:** se reemplaza `"admins manage invitation codes"` (`for all`) por una de `select` y otra de `delete`, ambas `using (public.is_admin())`. Sin `insert` ni `update` para clientes. Las políticas de `pesito_subscription_writer` (031) y el trigger `guard_renewal_code` (043) no cambian.
- **Códigos existentes:** `update … set expires_at = clock_timestamp() + interval '7 days' where not is_used and expires_at is null and renewal_user_id is null`.
- Bloque de verificación al final (definición, `prosecdef`, ACL, políticas), igual que en la 052.

**PWA (`src/AdminPanel.tsx`):**

- `handleCreateCode` llama a `supabase.rpc('admin_create_invitation_code', …)` y muestra el código devuelto. Se elimina `generateRandomCode`.
- La lista de invitaciones muestra el vencimiento del código ("Vence el …" / "Vencido") en los no usados.
- El mensaje para WhatsApp agrega que el enlace vence en 7 días.

**Orden de publicación:** SQL 053 primero, después la PWA. La PWA anterior deja de poder crear códigos cuando se aplica la 053 (falla cerrado); la nueva necesita la RPC. Rollback: conservar 053 y volver la PWA a la versión anterior (crear códigos queda bloqueado hasta republicar).

**Pruebas:**

- PGlite (esquema 001–053): formato y alfabeto, unicidad en lote, vencimiento a 7 días, rechazo con aal1 y para clientes y `anon`, validación de parámetros, insert/update directo rechazado, delete de admin permitido (y bloqueado para códigos de renovación), códigos existentes con vencimiento y los usados o de renovación intactos, alta y canje rechazados con un código vencido.
- UI (Vitest/jsdom): el panel llama a la RPC y muestra el código y el vencimiento.
- Contrato de release a 053 (rollback a la versión publicada con 052).

## Queda a criterio del implementador

- Textos exactos de la UI y estilo del vencimiento en la lista.
- Cantidad de reintentos ante colisión (una colisión es prácticamente imposible).
