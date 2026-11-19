# Plantillas de correo de Supabase Auth

Fuente versionada de los correos que manda Supabase Auth. Se cargan **a mano** en el panel: Supabase → proyecto Pesito → **Authentication → Emails → Templates** (no se usa `config push`). Si se cambia una plantilla en el panel, actualizar también este archivo.

**Por qué existen:** las plantillas por defecto están en inglés, son genéricas y llegaban como correo no deseado con aspecto de estafa (19/11/2026).

**Criterios:**
- En español, con la marca Pesito, y explicando por qué llega el correo.
- Un solo botón con el enlace. Sin imágenes externas ni adjuntos (empeoran la entrega).
- Avisar qué hacer si no fue la persona, y que Pesito nunca pide contraseñas ni datos bancarios por correo.
- Sin datos financieros ni información de la cuenta más allá del correo.

**Remitente** (Authentication → Emails → SMTP Settings): nombre `Pesito`. Mientras se use Gmail, el correo sale desde la dirección del propietario; con un dominio propio y un servicio transaccional (Fase 3) mejora la entrega.

Variables de Supabase usadas: `{{ .ConfirmationURL }}` (enlace de un solo uso) y `{{ .Email }}`.

---

## 1. Confirm signup (confirmar el alta)

**Asunto:** `Confirmá tu cuenta de Pesito`

```html
<div style="margin:0;padding:24px 12px;background:#f5f7f6;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 24px;">
    <p style="margin:0 0 4px;font-size:13px;font-weight:bold;letter-spacing:1px;color:#15803d;">PESITO</p>
    <h1 style="margin:0 0 16px;font-size:22px;color:#1f2933;">Confirmá tu cuenta</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">¡Hola! Recibimos un pedido para crear una cuenta en Pesito con este correo ({{ .Email }}).</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">Para activarla, tocá el botón:</p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 24px;border-radius:8px;">Confirmar mi cuenta</a>
    </p>
    <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#52606d;">Si no creaste una cuenta en Pesito, ignorá este correo: no se va a activar nada.</p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#52606d;">Pesito nunca te va a pedir tu contraseña ni datos bancarios por correo.</p>
  </div>
</div>
```

## 2. Magic Link (entrar sin contraseña)

**Asunto:** `Tu enlace para entrar a Pesito`

```html
<div style="margin:0;padding:24px 12px;background:#f5f7f6;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 24px;">
    <p style="margin:0 0 4px;font-size:13px;font-weight:bold;letter-spacing:1px;color:#15803d;">PESITO</p>
    <h1 style="margin:0 0 16px;font-size:22px;color:#1f2933;">Entrá a tu cuenta</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Pediste entrar a Pesito sin contraseña con este correo ({{ .Email }}).</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">Tocá el botón para ingresar. El enlace sirve una sola vez y vence en poco tiempo.</p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 24px;border-radius:8px;">Entrar a Pesito</a>
    </p>
    <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#52606d;">Si no lo pediste vos, ignorá este correo: tu cuenta sigue protegida.</p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#52606d;">Pesito nunca te va a pedir tu contraseña ni datos bancarios por correo.</p>
  </div>
</div>
```

## 3. Change Email Address (cambio de correo)

**Asunto:** `Confirmá el cambio de correo en Pesito`

```html
<div style="margin:0;padding:24px 12px;background:#f5f7f6;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px 24px;">
    <p style="margin:0 0 4px;font-size:13px;font-weight:bold;letter-spacing:1px;color:#15803d;">PESITO</p>
    <h1 style="margin:0 0 16px;font-size:22px;color:#1f2933;">Confirmá el cambio de correo</h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.5;">Recibimos un pedido para cambiar el correo de tu cuenta de Pesito a {{ .Email }}.</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.5;">Si fuiste vos, confirmalo con el botón:</p>
    <p style="margin:0 0 24px;text-align:center;">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 24px;border-radius:8px;">Confirmar el cambio</a>
    </p>
    <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#52606d;">Si no lo pediste vos, no toques el botón y escribinos por WhatsApp: tu correo actual sigue igual.</p>
    <p style="margin:0;font-size:13px;line-height:1.5;color:#52606d;">Pesito nunca te va a pedir tu contraseña ni datos bancarios por correo.</p>
  </div>
</div>
```

---

## Si siguen llegando a spam

1. Pedile a quien lo recibió que lo marque como "No es spam" (Gmail aprende de eso).
2. Verificar que el nombre del remitente sea `Pesito` y el asunto, el de esta guía.
3. Solución de fondo: dominio propio y servicio de correo transaccional (Brevo, Resend) con SPF, DKIM y DMARC configurados. Queda para la Fase 3.
