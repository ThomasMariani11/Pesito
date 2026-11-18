# Logo chanchito con moneda: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan checkboxes (`- [ ]`) para el seguimiento.

**Objetivo:** reemplazar los íconos de Pesito por el chanchito vectorial con moneda dorada y usarlo en el favicon, el manifest, el ícono de iOS, el Login, el Paywall, las notificaciones push y el encabezado del Dashboard.

**Arquitectura:** el maestro es el SVG `public/favicon.svg`, que se usa a sangre completa (cuadrado, sin esquinas redondeadas, porque el sistema operativo aplica su máscara). Una variante con margen, `brand/pesito-maskable.svg`, sirve para el ícono `maskable` de Android. Los PNG se exportan con canvas en el navegador integrado mediante `brand/export-icons.html`, servida por Vite. Se guardan en `public/` y se versionan. No se agregan dependencias.

**Stack:** SVG, Vite 8 (servidor local `pesito-local`), React 19, Vitest 4 y CSS existente en `app/globals.css`.

**Spec:** `docs/superpowers/specs/2026-11-17-logo-chanchito-moneda-design.md`

## Restricciones globales

- No agregar dependencias (ni sharp ni resvg ni Playwright) ni usar los helpers Python.
- Los SVG no deben tener `<script>`, `href` externos, `<image>` ni `<foreignObject>`. La CSP es `img-src 'self' data:`.
- Colores del boceto 1: fondo `#34d39b`→`#17a571`; cuerpo `#97eec9`/`#45c992`/`#1b8d60`; verde oscuro `#2f9a6b`→`#0a5238`; moneda `#fff4bd`/`#ffcc45`/`#c4860a`; brillo `#fff6d2`.
- Composición del boceto 1: chanchito de perfil mirando a la izquierda, oreja arriba a la derecha, dos patas, ranura, ojo sonriente, brillo arriba a la izquierda, sombra en el piso, moneda arriba centrada sobre la ranura y sin flecha.
- Tamaños: `icon-192.png` 192×192, `icon-512.png` 512×512, `apple-touch-icon.png` 180×180 y `icon-maskable-512.png` 512×512, todos RGBA.
- Maskable: todo el chanchito y la moneda deben quedar dentro del círculo central de radio 0,4 × lado (zona segura W3C).
- Rama: `feat/logo-chanchito-moneda` desde `main`. No tocar `auditoria_pre_lanzamiento_claude.md` ni `docs/auditoria/` (archivos sin seguimiento, de otra tarea).
- No publicar ni hacer deploy.

## Foco de revisión

- **Ícono a 16–32 px (pestaña):** la moneda y el hocico tienen que seguir distinguiéndose. El paso de verificación con zoom a 32 px lo controla.
- **Recorte circular en Android:** la moneda no puede quedar fuera de la zona segura. Lo cubre el test geométrico de la Tarea 1.
- **Fondo transparente en iOS:** `apple-touch-icon.png` no debe tener esquinas transparentes, porque iOS las pinta de negro. Lo cubre el test de alfa en las esquinas (Tarea 2).
- **CSP:** si el SVG se carga como `<img>`, no debe disparar errores en la consola. La verificación en el navegador de la Tarea 3 lo revisa.
- **Notificaciones push:** siguen usando `icon-192.png`. Como el nombre no cambia, no hay que tocar `public/sw.js`. El test de la Tarea 3 controla que el archivo exista.

---

### Task 1: SVG maestro y variante maskable

**Archivos:**
- Modificar (reemplazo completo): `public/favicon.svg`
- Crear: `brand/pesito-maskable.svg`
- Test: `tests/brand-assets.test.ts`

**Interfaces:**
- Produce: `public/favicon.svg` con `viewBox="0 0 512 512"`, fondo a sangre completa y el chanchito dentro de `<g id="pesito">`. `brand/pesito-maskable.svg`, también de 512, con el mismo fondo y el mismo `<g id="pesito">` envuelto en un `transform` que lo achica y lo centra.

- [ ] **Paso 1: escribir los tests que fallan** en `tests/brand-assets.test.ts`, leyendo los archivos con `readFileSync`.
  - `it('el maestro es un SVG seguro de 512')`: el contenido incluye `viewBox="0 0 512 512"` y `id="pesito"`, y no matchea `/<script|<image|<foreignObject|href="http/i`.
  - `it('el maestro tiene la moneda dorada y no tiene flecha')`: incluye `#ffcc45` y no incluye `<polyline`.
  - `it('la variante maskable deja al chanchito en la zona segura')`: incluye `viewBox="0 0 512 512"` y un atributo `data-safe-box="x y w h"` en el grupo escalado. Ese rectángulo, que el autor declara a partir del bounding box real medido en el Paso 4, debe quedar dentro del círculo de centro (256,256) y radio 204.8: las cuatro esquinas a una distancia ≤ 204,8.
- [ ] **Paso 2:** ejecutar `npx vitest run tests/brand-assets.test.ts`. Esperado: FAIL, porque falta `id="pesito"` y no existe el maskable.
- [ ] **Paso 3: dibujar los dos SVG** pasando el boceto 1 a la escala de 512 (×3 aprox.) y puliéndolo: degradados radiales más suaves, sombra de borde inferior en el cuerpo (un segundo círculo con degradado radial transparente→`#0a5238` con opacidad ≤0,35), destello en la moneda y la sombra de piso como elipse con opacidad. En la versión de favicon, el contenido ocupa casi todo el lienzo (margen ~6 %). En la maskable, escala ≈0,72 centrada.
- [ ] **Paso 4:** medir el bounding box del grupo escalado con `getBBox()` en el navegador integrado (página de la Tarea 2 o la URL del SVG en `pesito-local`), escribirlo en `data-safe-box` y volver a correr el test. Esperado: PASS.
- [ ] **Paso 5:** commit `feat(marca): logo vectorial del chanchito con moneda`.

### Task 2: exportar los PNG

**Archivos:**
- Crear: `brand/export-icons.html`
- Modificar (reemplazo binario): `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`
- Crear: `public/icon-maskable-512.png`
- Test: `tests/brand-assets.test.ts`

**Interfaces:**
- Consume: los dos SVG de la Tarea 1.
- Produce: `window.exportIcons(): Promise<Record<string, string>>` en `brand/export-icons.html`, que devuelve `{ 'icon-192.png': dataURL, 'icon-512.png': …, 'apple-touch-icon.png': …, 'icon-maskable-512.png': … }`. Carga cada SVG con `new Image()` desde su ruta relativa, dibuja en un `<canvas>` del tamaño de destino y devuelve `toDataURL('image/png')`.

- [ ] **Paso 1: tests que fallan**, con un helper `pngInfo(buf)` que lee el ancho y el alto de IHDR (bytes 16–23, big-endian) y el tipo de color (byte 25).
  - `it.each([['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180],['icon-maskable-512.png',512]])('%s mide %i px')`.
  - `it('los íconos son opacos en las esquinas')`: los dos SVG fuente empiezan su contenido con `<rect width="512" height="512"` sin `rx`, y ese rect cubre todo el lienzo. Agregar esta aserción al test del maestro y al del maskable. Los PNG heredan la opacidad, así que no hace falta decodificarlos.
- [ ] **Paso 2:** `npx vitest run tests/brand-assets.test.ts`. Esperado: FAIL, porque falta `icon-maskable-512.png`.
- [ ] **Paso 3:** escribir `brand/export-icons.html` (HTML estático, sin dependencias ni red).
- [ ] **Paso 4:** con `preview_start pesito-local`, abrir `http://127.0.0.1:5199/brand/export-icons.html`. Ejecutar `await exportIcons()` con `javascript_tool`, guardar cada dataURL en el scratchpad y decodificarla a `public/` con un script Node propio (`Buffer.from(b64,'base64')`), sin construir comandos con el contenido de la página. Antes de eso, confirmar que el servidor apunta al repo local.
- [ ] **Paso 5:** mirar cada PNG con la herramienta Read (tienen que verse nítidos, sin recortes ni fondo transparente) y correr el test. Esperado: PASS.
- [ ] **Paso 6:** commit `feat(marca): íconos PNG exportados desde el SVG`.

### Task 3: conectar el logo en la app

**Archivos:**
- Modificar: `public/manifest.webmanifest`, `index.html:14`, `src/Dashboard.tsx:860`, `app/globals.css` (regla `.brand-mark`)
- Test: `tests/brand-assets.test.ts`

**Interfaces:**
- Consume: los archivos de las Tareas 1 y 2.

- [ ] **Paso 1: tests que fallan.**
  - `it('el manifest separa any y maskable')`: con `JSON.parse` del manifest, `icons` es igual a `[{src:'./icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'./icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},{src:'./icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose:'maskable'}]`, y cada `src` existe en `public/`.
  - `it('index.html declara el favicon SVG antes del PNG')`: `index.html` contiene `<link rel="icon" type="image/svg+xml" href="./favicon.svg" />` en una posición anterior al link del PNG de 192.
  - `it('el encabezado del Dashboard usa el logo')`: `src/Dashboard.tsx` matchea ``/className="brand-mark"[^>]*src=\{`\$\{import\.meta\.env\.BASE_URL\}favicon\.svg`\}/`` y ya no contiene `brand-mark">P<`.
- [ ] **Paso 2:** `npx vitest run tests/brand-assets.test.ts`. Esperado: FAIL.
- [ ] **Paso 3:** cambios mínimos.
  - **Manifest:** las 3 entradas de arriba.
  - **index.html:** el link SVG.
  - **Dashboard.tsx:860:** `<img className="brand-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />`. Va con alt vacío porque al lado ya está el texto "Pesito".
  - **CSS `.brand-mark` en `app/globals.css`:** conserva `width`/`height` de 35 px y `border-radius: 11px`. Se quitan `background`, `color`, `font-weight` y `display:grid` y se agrega `display:block`. La sombra se mantiene. Revisar que `.auth-card .brand-mark` (en `app/forms.css`) no se use con texto en otro componente: `git grep brand-mark`.
- [ ] **Paso 4:** `npx vitest run tests/brand-assets.test.ts`. Esperado: PASS.
- [ ] **Paso 5: verificación en el navegador** con `pesito-local`.
  - Login: con `read_page`, confirmar el ícono y tomar una captura sin datos reales. Si para llegar al Dashboard hace falta una sesión, usar solo una cuenta de prueba local. Si no hay ninguna, verificar el encabezado renderizando el componente o dejarlo anotado como no verificado.
  - `read_console_messages` sin errores de CSP.
  - Zoom del favicon a 32 px.
- [ ] **Paso 6:** correr `npm run lint`, `npm test` y `npm run build`, los tres en verde. Revisar que `dist/` incluya `favicon.svg` e `icon-maskable-512.png`.
- [ ] **Paso 7:** agregar una línea con fecha al registro de cambios de `docs/contexto/CONTEXTO_PESITO_PARA_CLAUDE.md` ("Logo: chanchito vectorial con moneda; en rama, sin publicar") y hacer commit `feat(marca): usar el logo nuevo en manifest, favicon y Dashboard`.
