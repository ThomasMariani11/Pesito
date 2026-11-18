# Logo de Pesito: chanchito con moneda dorada (diseño corto)

Fecha: 17/11/2026. Estado: propuesta pendiente de aprobación del propietario.

## Intención

Renovar el logo manteniendo el chanchito verde con brillo y sombras que ya identifica a Pesito. Se agrega una moneda dorada sobre la ranura y se quita la flecha. Además, la misma marca pasa a usarse en todos los lugares donde aparece el logo. Hoy hay tres versiones: el PNG del chanchito, la "P" del Dashboard y un `favicon.svg` azul que no se usa.

## Objetivos

- Contar con un SVG maestro del chanchito, basado en el boceto elegido ("1 · La que te gustó"): fondo verde degradado, cuerpo con brillo arriba a la izquierda, oreja, hocico y patas en verde oscuro, ranura, ojo sonriente, sombra en el piso y moneda dorada arriba.
- Generar desde ese maestro los PNG que ya consume la app: `icon-192.png`, `icon-512.png` y `apple-touch-icon.png` (180).
- Agregar `icon-maskable-512.png`, con margen suficiente para que la moneda quede dentro de la zona segura de Android. En el manifest, `purpose: "any"` y `purpose: "maskable"` pasan a ir en entradas separadas.
- Reemplazar `public/favicon.svg` por el logo nuevo y referenciarlo en `index.html`. El PNG de 192 queda como alternativa.
- Reemplazar la "P" (`brand-mark`) del encabezado del Dashboard por el chanchito.

## Fuera de alcance

- `og.png` (imagen para compartir en redes): no tiene chanchito y queda igual.
- Paleta de la app, `theme_color` y textos.
- Publicar o hacer deploy.

## Anti-objetivos

- Que el ícono deje de reconocerse como "el chanchito de Pesito".
- Que la moneda quede cortada en Android o el chanchito se vea borroso en tamaño chico.
- Sumar dependencias para generar imágenes.

## Enfoques considerados

1. **Redibujar en vector (elegido por el propietario).** Un SVG maestro en el repo, con PNG generados con el navegador integrado (canvas) y guardados en `public/`. Se ve nítido en cualquier tamaño, es fácil de editar y no agrega dependencias. El brillo resulta algo menos realista que en el PNG actual.
2. **Agregar la moneda al PNG actual.** Conserva el modelado actual, pero no deja un vector y no mejora la nitidez en tamaños chicos. Descartado.
3. **Agregar sharp o resvg y un script de exportación.** Sería reproducible, pero suma dependencias, algo que `CLAUDE.md` pide evitar. Descartado.

## Decisiones del implementador

- Pulir el boceto: degradados más suaves, borde inferior del cuerpo más oscuro para dar volumen y brillo en la moneda. Se mantienen la composición y los colores del boceto.
- Guardar el maestro como `public/favicon.svg` y no crear un archivo nuevo. En el Dashboard se usa como `<img>` y se ajusta solo el tamaño en el CSS existente.
- Verificar con el navegador integrado y el servidor local (`pesito-local`) en Login, Dashboard y pestaña. Correr `npm run lint`, `npm test` y `npm run build`.
- Trabajar en una rama nueva desde `main` (`feat/logo-chanchito-moneda`), no en `feat/sec-01-vinculacion-robusta`.
- Agregar una línea al registro de cambios de `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md`.

## Riesgos

- El service worker cachea los íconos por versión de build, así que se renuevan con el próximo deploy. Los íconos de la pantalla de inicio ya instalados pueden tardar en actualizarse, según el sistema operativo.
