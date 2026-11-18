# Aviso de ícono nuevo en iPhone: plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: superpowers:executing-plans (elegida por el propietario). Los pasos usan checkboxes (`- [ ]`).

**Objetivo:** mostrar en el Resumen, solo en iPhone con la app instalada, un aviso con el botón «Abrir en navegador» para reinstalar Pesito con el ícono nuevo.

**Arquitectura:** las reglas puras van en `src/iconNoticeRules.ts`: memoria en `localStorage`, vencimiento y armado de la URL de Safari. El componente `src/IconNotice.tsx` usa la tarjeta `client-notice` existente. Para detectar la plataforma se reutilizan `isIos` e `isStandalone` de `src/pushNotifications.ts`, que pasan a exportarse.

**Stack:** React 19, Vitest 4 con jsdom.

**Spec:** `docs/superpowers/specs/2026-11-18-aviso-icono-ios-design.md`

## Restricciones globales

- Textos exactos de la spec, en español rioplatense.
- Clave `pesito:aviso-icono-nuevo`; vencimiento `Date.parse('2027-01-01T00:00:00-03:00')`.
- Sin dependencias nuevas y sin cambios en el backend ni en la CSP.

## Foco de revisión

- Si `localStorage` falla (por ejemplo, en modo privado), el aviso no puede romper el Resumen. Cubierto por un test con un `getItem` que lanza error.
- No debe aparecer en Android standalone ni en Safari sin instalar. Cubierto por un test.
- La URL de Safari debe conservar la ruta base (`/chatbot-gastos/`). Cubierto por un test.

---

### Task 1: reglas del aviso

**Archivos:** crear `src/iconNoticeRules.ts`. Modificar `src/pushNotifications.ts:30-37` para exportar `isIos` e `isStandalone`. Test en `tests/icon-notice.test.ts`.

**Interfaces que produce:**
- `ICON_NOTICE_UNTIL: number`
- `readIconNoticeDismissed(): boolean`
- `dismissIconNotice(): void`
- `shouldShowIconNotice(input: { ios: boolean; standalone: boolean; dismissed: boolean; now: number }): boolean`
- `browserUrl(appUrl: string): string`: devuelve `x-safari-https://…`, o `x-safari-http://…` si la dirección es http.

- [ ] Paso 1: tests que fallan.
  - Solo es `true` con `ios && standalone && !dismissed && now < ICON_NOTICE_UNTIL`. Hay un caso para cada condición en falso.
  - `browserUrl('https://thomasmariani11.github.io/chatbot-gastos/')` es `'x-safari-https://thomasmariani11.github.io/chatbot-gastos/'`.
  - `dismissIconNotice()` hace que `readIconNoticeDismissed()` sea `true`.
  - Con un `getItem` que lanza error, `readIconNoticeDismissed()` es `false` y no propaga el error.
- [ ] Paso 2: `npx vitest run tests/icon-notice.test.ts` falla.
- [ ] Paso 3: implementar las reglas, con el mismo patrón de `storage()` que `pushPromptRules.ts`.
- [ ] Paso 4: el test pasa. Commit `feat(pwa): reglas del aviso de ícono nuevo en iPhone`.

### Task 2: componente y conexión con el Resumen

**Archivos:** crear `src/IconNotice.tsx`. Modificar `src/Dashboard.tsx` para agregar el componente antes de `<PushPrompt` y dentro de la misma condición de sección. Test en `tests/icon-notice.test.ts`.

**Interfaces que consume:** las de la Task 1.

**Interfaces que produce:** `IconNotice(props: { env?: { ios: boolean; standalone: boolean }; now?: () => number; appUrl?: string })`. Por defecto, el entorno se calcula con `isIos(navigator)`/`isStandalone(window)` y `appUrl` con `new URL(import.meta.env.BASE_URL, location.origin).href`.

- [ ] Paso 1: tests que fallan, con jsdom.
  - Con `env {ios:true, standalone:true}` se renderiza una región con el nombre accesible «Ícono nuevo de Pesito», el título y el texto exactos, y un enlace «Abrir en navegador» con `href` `x-safari-https://…`.
  - Al tocar «Entendido» el aviso desaparece y queda guardado.
  - Con `env {ios:false, standalone:true}` no se renderiza nada.
  - `src/Dashboard.tsx` contiene `<IconNotice` antes que `<PushPrompt`.
- [ ] Paso 2: el test falla.
- [ ] Paso 3: implementar con el ícono `sparkles` y las clases `client-notice`, `button-secondary` y `text-button`.
- [ ] Paso 4: el test pasa. Correr `npm run lint`, `npm test` y `npm run build` en verde. Agregar una línea en el CONTEXTO (MARCA-02). Commit `feat(pwa): aviso de ícono nuevo en iPhone`.
