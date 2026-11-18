# Aviso de ícono nuevo en iPhone (diseño corto)

Fecha: 18/11/2026. Aprobado por el propietario en la conversación.

## Intención

iOS guarda el ícono de una web instalada en el momento de agregarla y no lo actualiza. Quien instaló Pesito en iPhone antes del logo nuevo (MARCA-01, PR #110) sigue viendo el chanchito con la flecha. El aviso le explica cómo reinstalar y le facilita el paso de abrir Pesito en el navegador.

## Comportamiento

- **Quién lo ve:** solo iPhone o iPad con Pesito abierto desde el ícono instalado (modo standalone). No se muestra en Android, porque Chrome actualiza el ícono solo, ni en el navegador.
- **Dónde:** en el Resumen, con la tarjeta de avisos existente (`client-notice client-notice-info`), antes de la invitación a notificaciones.
- **Texto:**
  - Título: «Pesito estrenó ícono».
  - Cuerpo: «Si todavía ves el chanchito con la flecha: tocá Abrir en navegador, después Compartir → Agregar a inicio, y borrá el ícono viejo. Vas a tener que iniciar sesión y activar las notificaciones de nuevo.»
- **Botones:**
  - **«Abrir en navegador»:** un enlace a `x-safari-https://<dirección de Pesito>`. La dirección sale de la propia app (`location.origin` + `BASE_URL`) y no se escribe a mano. El esquema `x-safari-` existe desde iOS 17, pero Apple no lo documenta.
  - **«Entendido»:** oculta el aviso para siempre en ese dispositivo. Se guarda en `localStorage` con la clave `pesito:aviso-icono-nuevo`. Sin almacenamiento disponible, se oculta solo hasta recargar.
- **Vencimiento:** no se muestra desde el 01/01/2027 00:00 (hora de Argentina).

## Fuera de alcance

- El botón «Copiar enlace». El propietario quiere probar primero si alcanza con «Abrir en navegador».
- Android, el navegador común y los cambios de backend.

## Enfoques considerados

1. **Enlace `x-safari-https://` (elegido).** Abre Safari de verdad desde la app instalada. No está documentado, así que puede fallar en versiones viejas o futuras de iOS.
2. **Enlace normal con `target="_blank"`.** Desde una app instalada, iOS lo abre dentro de la misma app. Descartado.
3. **Copiar enlace.** Funciona siempre, pero agrega un paso. Queda como posible agregado si la prueba en el iPhone falla.

## Riesgos y verificación

- La prueba real del botón la hace el propietario en su iPhone después de publicar. Acá solo se verifica con tests y en jsdom.
- Al borrar el ícono viejo se borran la sesión y la suscripción push de esa instalación. El texto lo advierte.
