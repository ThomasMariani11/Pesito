# SEC-01 — Vinculación de WhatsApp robusta (diseño)

Fecha: 17/11/2026. Fase 1.3 del plan de remediación de la auditoría de pre-lanzamiento.

## Intención

Que nadie pueda adivinar un código de vinculación y quedarse con el WhatsApp de una cuenta ajena. Hoy el código tiene 6 dígitos (900.000 combinaciones), el único freno son 5 intentos fallidos cada 15 minutos **por teléfono** (se evade usando varios números) y, si se acierta, el teléfono del atacante reemplaza al del dueño sin aviso.

## Cómo funciona hoy

- `request_whatsapp_link_code()` (018) genera un código de 6 dígitos con `gen_random_uuid()`, guarda solo su `sha256` en `whatsapp_links.link_code_hash` con vencimiento a 10 minutos y lo devuelve a la PWA.
- La PWA (`src/Settings.tsx:170-199` "Conectar en 1 toque"/"Cambiar número" y `src/Dashboard.tsx:214-220`) abre `https://wa.me/<bot>?text=VINCULAR%20<código>`; el cliente solo toca Enviar. El texto de estado muestra el código.
- El webhook (`supabase/functions/whatsapp-webhook/processor.ts:74-75`) reconoce `^vincular\s+(\d{6})$` y encola `{kind:'link', hash}`.
- `apply_whatsapp_job` (rama `link`, 040:136-177; textos redefinidos en 049/050) busca el hash vigente; si falla suma intentos por teléfono (5 → bloqueo 15 min); si acierta, desvincula ese número de cualquier otra cuenta, vincula el teléfono a la cuenta dueña del código y borra el código.

## Decisiones del propietario (17/11/2026)

- Enfoque **A**: código largo y legible + aviso al dueño. Sin paso de confirmación en la PWA.
- Lo normal es vincular desde el celular con el botón; desde la computadora también funciona (el código viaja en el enlace). Escribirlo a mano es un caso raro pero debe seguir siendo posible.

## Objetivos

1. Código de vinculación de **12 caracteres** aleatorios criptográficos del alfabeto `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (~1,15·10¹⁸ combinaciones), presentado como `XXXX-XXXX-XXXX`. Mensaje: `VINCULAR K7QM-X3RT-9PZD`.
2. El bot acepta el código escrito a mano: sin distinguir mayúsculas, con o sin guiones, con espacios.
3. Se mantienen el vencimiento de 10 minutos, el uso único y el límite de 5 fallos / 15 min por teléfono.
4. **Aviso al dueño** por Web Push cuando su cuenta queda vinculada a un número (nuevo vínculo o cambio de número).
5. **Aviso a la cuenta que pierde el número** cuando ese número pasa a otra cuenta.
6. Ningún código de 6 dígitos queda válido después de aplicar la migración.

## No objetivos

- Paso de confirmación en la PWA antes de activar (enfoque B, descartado).
- Límite global de intentos: con ~10¹⁸ combinaciones no aporta contra la adivinación (mismo criterio que SEC-02).
- Avisos por WhatsApp (son pagos fuera de la ventana de 24 h y no se habilitan por iniciativa del agente). Los avisos usan solo Web Push.
- Banner o bandeja de avisos dentro de la PWA para quien no activó notificaciones: Ajustes ya muestra el número vinculado.
- Un botón "Desvincular": el dueño recupera su vínculo con "Cambiar número" (que reemplaza al número anterior).

## Anti-objetivos

- Agregar pasos o fricción al flujo normal de un toque.
- Incluir el número de teléfono, nombres o datos financieros en el texto del push (la regla de `client-push.ts` es "sin datos financieros ni nombres"; el número es dato personal).
- Romper el webhook en producción durante la transición, o dejar un intervalo en que nadie pueda vincular.
- Aumentar el consumo de IA: el parser determinístico sigue resolviendo `VINCULAR`.

## Enfoques considerados

- **A. Código largo y legible + aviso (elegido).** Elimina la adivinación sin tocar la experiencia; el aviso cubre el caso residual (un código visto en la pantalla del dueño).
- B. A + confirmación en la PWA: protege aun con el código filtrado, pero suma un paso justo donde más gente abandona y el bot no responde hasta confirmar. Descartado.
- C. Solo confirmación con 6 dígitos: sigue siendo adivinable; toda la protección depende de que el dueño no confirme por error. Descartado.

## Diseño

### Webhook (`supabase/functions/whatsapp-webhook/`)

- `processor.ts`: el comando acepta `vincular` seguido del código nuevo (12 caracteres del alfabeto tras quitar espacios y guiones, sin distinguir mayúsculas) **y** el formato anterior de 6 dígitos (solo para la transición; después de la migración no existe ningún código de 6 dígitos vigente). El hash se calcula sobre el código **normalizado**: mayúsculas, sin espacios ni guiones (`K7QMX3RT9PZD`). Solo se reconoce como vinculación un texto con **forma de código**: `vincular` + 12 caracteres alfanuméricos en grupos de 4 (separados por guion, espacio o nada) o `vincular` + 6 dígitos. Cualquier otro texto que empiece con "vincular" (p. ej. "vincular la tarjeta con la cuenta" o "vincular" solo) sigue el camino normal de hoy (parser/IA) y **no** suma intentos fallidos. *(Decisión del implementador, tras el chequeo: evita bloquear 15 minutos a clientes ya vinculados por una frase común.)* Un código con forma válida pero inexistente o vencido sí cuenta como intento fallido, como hoy.
- `client-push.ts`: dos tipos nuevos con textos fijos y sin datos personales:
  - `whatsapp_linked`: título "Tu WhatsApp quedó vinculado", cuerpo "Pesito ya recibe tus mensajes desde un número nuevo. Si no fuiste vos, volvé a conectar tu número desde Ajustes.", `url: ./#settings`, tag propio.
  - `whatsapp_unlinked`: título "Tu WhatsApp se desvinculó", cuerpo "Ese número se vinculó a otra cuenta. Si no fuiste vos, volvé a conectarlo desde Ajustes.", `url: ./#settings`, tag propio. *(La PWA reconoce `#settings`, igual que el aviso de vencimiento; no se agrega una ruta nueva.)*
- Se despliega **antes** que el SQL. Con el SQL anterior, nunca recibe esos tipos ni códigos largos: es compatible.

### Migración 054 (`054_whatsapp_link_strong_code.sql`)

- `request_whatsapp_link_code()` redefinida: misma firma, permisos, dueño y validaciones (sesión, perfil, suscripción vigente, 10 minutos, reintento por colisión). Genera los 12 caracteres con los bytes de `gen_random_uuid()` sin los de versión y variante y `byte & 31` (mismo método que la 053), guarda `sha256` del código normalizado y devuelve `{code: 'XXXX-XXXX-XXXX', expires_at}`.
- `apply_whatsapp_job`, rama `link`: al vincular con éxito, además de lo actual:
  - Encola `client_notifications(user_id = dueño, kind = 'whatsapp_linked', period_key = <marca única del vínculo>)`.
  - Si ese número estaba vinculado a **otra** cuenta, encola `whatsapp_unlinked` para esa cuenta.
  - Si la cuenta ya estaba vinculada a ese **mismo** número (re-vinculación), no se avisa.
  - Como los avisos existentes (046/051), cada aviso se encola **solo si esa cuenta tiene al menos una suscripción push**; sin suscripción no se crea la fila. No se filtra por estado de la membresía: es un aviso de seguridad y también le llega a una cuenta vencida que pierde su número. *(Decisión del implementador.)*
  - El texto de respuesta del bot y el resto de la lógica (límites, bloqueo, leases) no cambian. La redefinición parte de la versión vigente (la de 050) y reemplaza solo la rama `link`, verificando el texto esperado como hicieron 049/050.
- `client_notifications.kind`: el check incorpora `whatsapp_linked` y `whatsapp_unlinked`.
- `claim_client_notifications`: los dos tipos nuevos no dependen de preferencias ni de ventanas horarias (son avisos de seguridad); se envían en el siguiente ciclo del cron `pesito-client-push` (horario: el aviso puede tardar hasta ~60 minutos; aceptado por el propietario el 17/11/2026, sin disparo inmediato).
- Al aplicarse: se anulan los códigos pendientes (`link_code_hash = null, link_code_expires_at = null`), así no queda ningún código de 6 dígitos vigente. Quien estaba en medio de vincular genera otro (vencen en 10 minutos de todos modos).
- Bloque de verificación al final y `notify pgrst`.

### PWA

- `src/whatsappLink.ts` hoy rechaza todo código que no sea `^d{6}# SEC-01 — Vinculación de WhatsApp robusta (diseño)

Fecha: 17/11/2026. Fase 1.3 del plan de remediación de la auditoría de pre-lanzamiento.

## Intención

Que nadie pueda adivinar un código de vinculación y quedarse con el WhatsApp de una cuenta ajena. Hoy el código tiene 6 dígitos (900.000 combinaciones), el único freno son 5 intentos fallidos cada 15 minutos **por teléfono** (se evade usando varios números) y, si se acierta, el teléfono del atacante reemplaza al del dueño sin aviso.

## Cómo funciona hoy

- `request_whatsapp_link_code()` (018) genera un código de 6 dígitos con `gen_random_uuid()`, guarda solo su `sha256` en `whatsapp_links.link_code_hash` con vencimiento a 10 minutos y lo devuelve a la PWA.
- La PWA (`src/Settings.tsx:170-199` "Conectar en 1 toque"/"Cambiar número" y `src/Dashboard.tsx:214-220`) abre `https://wa.me/<bot>?text=VINCULAR%20<código>`; el cliente solo toca Enviar. El texto de estado muestra el código.
- El webhook (`supabase/functions/whatsapp-webhook/processor.ts:74-75`) reconoce `^vincular\s+(\d{6})$` y encola `{kind:'link', hash}`.
- `apply_whatsapp_job` (rama `link`, 040:136-177; textos redefinidos en 049/050) busca el hash vigente; si falla suma intentos por teléfono (5 → bloqueo 15 min); si acierta, desvincula ese número de cualquier otra cuenta, vincula el teléfono a la cuenta dueña del código y borra el código.

## Decisiones del propietario (17/11/2026)

- Enfoque **A**: código largo y legible + aviso al dueño. Sin paso de confirmación en la PWA.
- Lo normal es vincular desde el celular con el botón; desde la computadora también funciona (el código viaja en el enlace). Escribirlo a mano es un caso raro pero debe seguir siendo posible.

## Objetivos

1. Código de vinculación de **12 caracteres** aleatorios criptográficos del alfabeto `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (~1,15·10¹⁸ combinaciones), presentado como `XXXX-XXXX-XXXX`. Mensaje: `VINCULAR K7QM-X3RT-9PZD`.
2. El bot acepta el código escrito a mano: sin distinguir mayúsculas, con o sin guiones, con espacios.
3. Se mantienen el vencimiento de 10 minutos, el uso único y el límite de 5 fallos / 15 min por teléfono.
4. **Aviso al dueño** por Web Push cuando su cuenta queda vinculada a un número (nuevo vínculo o cambio de número).
5. **Aviso a la cuenta que pierde el número** cuando ese número pasa a otra cuenta.
6. Ningún código de 6 dígitos queda válido después de aplicar la migración.

## No objetivos

- Paso de confirmación en la PWA antes de activar (enfoque B, descartado).
- Límite global de intentos: con ~10¹⁸ combinaciones no aporta contra la adivinación (mismo criterio que SEC-02).
- Avisos por WhatsApp (son pagos fuera de la ventana de 24 h y no se habilitan por iniciativa del agente). Los avisos usan solo Web Push.
- Banner o bandeja de avisos dentro de la PWA para quien no activó notificaciones: Ajustes ya muestra el número vinculado.
- Un botón "Desvincular": el dueño recupera su vínculo con "Cambiar número" (que reemplaza al número anterior).

## Anti-objetivos

- Agregar pasos o fricción al flujo normal de un toque.
- Incluir el número de teléfono, nombres o datos financieros en el texto del push (la regla de `client-push.ts` es "sin datos financieros ni nombres"; el número es dato personal).
- Romper el webhook en producción durante la transición, o dejar un intervalo en que nadie pueda vincular.
- Aumentar el consumo de IA: el parser determinístico sigue resolviendo `VINCULAR`.

## Enfoques considerados

- **A. Código largo y legible + aviso (elegido).** Elimina la adivinación sin tocar la experiencia; el aviso cubre el caso residual (un código visto en la pantalla del dueño).
- B. A + confirmación en la PWA: protege aun con el código filtrado, pero suma un paso justo donde más gente abandona y el bot no responde hasta confirmar. Descartado.
- C. Solo confirmación con 6 dígitos: sigue siendo adivinable; toda la protección depende de que el dueño no confirme por error. Descartado.

## Diseño

### Webhook (`supabase/functions/whatsapp-webhook/`)

- `processor.ts`: el comando acepta `vincular` seguido del código nuevo (12 caracteres del alfabeto tras quitar espacios y guiones, sin distinguir mayúsculas) **y** el formato anterior de 6 dígitos (solo para la transición; después de la migración no existe ningún código de 6 dígitos vigente). El hash se calcula sobre el código **normalizado**: mayúsculas, sin espacios ni guiones (`K7QMX3RT9PZD`). Solo se reconoce como vinculación un texto con **forma de código**: `vincular` + 12 caracteres alfanuméricos en grupos de 4 (separados por guion, espacio o nada) o `vincular` + 6 dígitos. Cualquier otro texto que empiece con "vincular" (p. ej. "vincular la tarjeta con la cuenta" o "vincular" solo) sigue el camino normal de hoy (parser/IA) y **no** suma intentos fallidos. *(Decisión del implementador, tras el chequeo: evita bloquear 15 minutos a clientes ya vinculados por una frase común.)* Un código con forma válida pero inexistente o vencido sí cuenta como intento fallido, como hoy.
- `client-push.ts`: dos tipos nuevos con textos fijos y sin datos personales:
  - `whatsapp_linked`: título "Tu WhatsApp quedó vinculado", cuerpo "Pesito ya recibe tus mensajes desde un número nuevo. Si no fuiste vos, volvé a conectar tu número desde Ajustes.", `url: ./#settings`, tag propio.
  - `whatsapp_unlinked`: título "Tu WhatsApp se desvinculó", cuerpo "Ese número se vinculó a otra cuenta. Si no fuiste vos, volvé a conectarlo desde Ajustes.", `url: ./#settings`, tag propio. *(La PWA reconoce `#settings`, igual que el aviso de vencimiento; no se agrega una ruta nueva.)*
- Se despliega **antes** que el SQL. Con el SQL anterior, nunca recibe esos tipos ni códigos largos: es compatible.

### Migración 054 (`054_whatsapp_link_strong_code.sql`)

- `request_whatsapp_link_code()` redefinida: misma firma, permisos, dueño y validaciones (sesión, perfil, suscripción vigente, 10 minutos, reintento por colisión). Genera los 12 caracteres con los bytes de `gen_random_uuid()` sin los de versión y variante y `byte & 31` (mismo método que la 053), guarda `sha256` del código normalizado y devuelve `{code: 'XXXX-XXXX-XXXX', expires_at}`.
- `apply_whatsapp_job`, rama `link`: al vincular con éxito, además de lo actual:
  - Encola `client_notifications(user_id = dueño, kind = 'whatsapp_linked', period_key = <marca única del vínculo>)`.
  - Si ese número estaba vinculado a **otra** cuenta, encola `whatsapp_unlinked` para esa cuenta.
  - Si la cuenta ya estaba vinculada a ese **mismo** número (re-vinculación), no se avisa.
  - Como los avisos existentes (046/051), cada aviso se encola **solo si esa cuenta tiene al menos una suscripción push**; sin suscripción no se crea la fila. No se filtra por estado de la membresía: es un aviso de seguridad y también le llega a una cuenta vencida que pierde su número. *(Decisión del implementador.)*
  - El texto de respuesta del bot y el resto de la lógica (límites, bloqueo, leases) no cambian. La redefinición parte de la versión vigente (la de 050) y reemplaza solo la rama `link`, verificando el texto esperado como hicieron 049/050.
- `client_notifications.kind`: el check incorpora `whatsapp_linked` y `whatsapp_unlinked`.
- `claim_client_notifications`: los dos tipos nuevos no dependen de preferencias ni de ventanas horarias (son avisos de seguridad); se envían en el siguiente ciclo del cron `pesito-client-push` (horario: el aviso puede tardar hasta ~60 minutos; aceptado por el propietario el 17/11/2026, sin disparo inmediato).
- Al aplicarse: se anulan los códigos pendientes (`link_code_hash = null, link_code_expires_at = null`), así no queda ningún código de 6 dígitos vigente. Quien estaba en medio de vincular genera otro (vencen en 10 minutos de todos modos).
- Bloque de verificación al final y `notify pgrst`.

### PWA

 ("No recibimos un código de vinculación válido"). Debe aceptar **ambos** formatos (6 dígitos y `XXXX-XXXX-XXXX` del alfabeto) para la transición. *(Hallazgo al planificar.)*
- `Settings.tsx` y `Dashboard.tsx` arman el enlace con el `code` tal cual; el guion no necesita codificación en la URL. Sin otros cambios.

### Orden de publicación

1. Merge: Pages publica la PWA, que acepta ambos formatos (compatible con el SQL anterior).
2. Webhook (acepta ambos formatos y sabe redactar los avisos nuevos); smoke 401 en las rutas como en despliegues anteriores.
3. `db push` de la 054 (dry-run previo).

Rollback: conservar la 054. El webhook anterior (v75) no reconoce el código largo, así que **no** se vuelve el webhook a v75 mientras la 054 esté aplicada sin antes revertir la RPC con una migración nueva.

### Pruebas

- **Webhook (Deno):** parser con código nuevo en mayúsculas/minúsculas, con y sin guiones, con espacios; 6 dígitos (transición); `vincular` con basura → intento fallido; textos de los avisos nuevos sin números de teléfono.
- **SQL (PGlite, 001–054):**
  - Formato y alfabeto del código; 200 códigos distintos; vencimiento 10 minutos.
  - Vincular con el código normalizado funciona; un código de 6 dígitos ya no existe tras aplicar.
  - Avisos: vínculo nuevo → un `whatsapp_linked`; cambio de número → `whatsapp_linked` al dueño; número que pasa de otra cuenta → `whatsapp_unlinked` a esa cuenta; re-vinculación al mismo número → sin aviso; fallo → sin aviso.
  - `claim_client_notifications` entrega los tipos nuevos sin ventana horaria.
  - Límite por teléfono intacto; permisos de las funciones sin cambios.
- **Pruebas existentes a actualizar:** `tests/whatsapp-link.test.ts` y `tests/whatsapp-linking-sql.test.ts` (usan el formato de 6 dígitos). El ensayo de release no usa códigos de vinculación (escribe `wa_id` directo), así que no cambia salvo el contrato.
- Contrato de release a mínimo 054.

## Queda a criterio del implementador

- La marca única de `period_key` para los avisos (p. ej. el `linked_at` en ISO).
- Nombres internos y estructura de las funciones auxiliares.
- Si conviene mostrar el código con guiones también en el texto de estado de la PWA.
