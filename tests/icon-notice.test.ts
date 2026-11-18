// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconNotice } from '../src/IconNotice';
import {
  browserUrl,
  dismissIconNotice,
  ICON_NOTICE_UNTIL,
  readIconNoticeDismissed,
  shouldShowIconNotice,
} from '../src/iconNoticeRules';

vi.mock('../src/supabase', () => ({ supabase: {} }));

const NOW = Date.parse('2026-11-20T12:00:00-03:00');
const base = { ios: true, standalone: true, dismissed: false, now: NOW };

describe('MARCA-02 · cuándo aparece el aviso de ícono nuevo', () => {
  it('solo en iPhone con la app instalada, sin cerrar y antes del vencimiento', () => {
    expect(shouldShowIconNotice(base)).toBe(true);
    expect(shouldShowIconNotice({ ...base, ios: false })).toBe(false);
    expect(shouldShowIconNotice({ ...base, standalone: false })).toBe(false);
    expect(shouldShowIconNotice({ ...base, dismissed: true })).toBe(false);
    expect(shouldShowIconNotice({ ...base, now: ICON_NOTICE_UNTIL })).toBe(false);
  });

  it('vence el 1 de enero de 2027 en hora argentina', () => {
    expect(ICON_NOTICE_UNTIL).toBe(Date.parse('2027-01-01T00:00:00-03:00'));
  });

  it('arma la dirección para abrir Safari conservando la ruta base', () => {
    expect(browserUrl('https://thomasmariani11.github.io/chatbot-gastos/')).toBe('x-safari-https://thomasmariani11.github.io/chatbot-gastos/');
    expect(browserUrl('http://127.0.0.1:5199/chatbot-gastos/')).toBe('x-safari-http://127.0.0.1:5199/chatbot-gastos/');
  });
});

describe('MARCA-02 · memoria del aviso en el dispositivo', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('"Entendido" lo oculta para siempre en este dispositivo', () => {
    expect(readIconNoticeDismissed()).toBe(false);
    dismissIconNotice();
    expect(readIconNoticeDismissed()).toBe(true);
    expect(window.localStorage.getItem('pesito:aviso-icono-nuevo')).not.toBeNull();
  });

  it('sin almacenamiento disponible no rompe', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    expect(readIconNoticeDismissed()).toBe(false);
    expect(() => dismissIconNotice()).not.toThrow();
  });
});

describe('MARCA-02 · tarjeta en el Resumen', () => {
  const APP_URL = 'https://thomasmariani11.github.io/chatbot-gastos/';
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (env: { ios: boolean; standalone: boolean }) =>
    act(() => root.render(h(IconNotice, { env, now: () => NOW, appUrl: APP_URL })));

  it('en iPhone instalado muestra el texto y el botón para abrir el navegador', () => {
    render({ ios: true, standalone: true });
    const region = container.querySelector('[role="region"][aria-label="Ícono nuevo de Pesito"]');
    expect(region).not.toBeNull();
    expect(region!.textContent).toContain('Pesito estrenó ícono');
    expect(region!.textContent).toContain('¿Todavía ves el chanchito con la flecha? Actualizalo en 3 pasos:');
    const steps = Array.from(region!.querySelectorAll('ol > li')).map((li) => li.textContent);
    expect(steps).toEqual(['Tocá Abrir en navegador', 'Compartir → Agregar a inicio', 'Borrá el ícono viejo']);
    expect(region!.textContent).toContain('Vas a tener que iniciar sesión y activar las notificaciones de nuevo.');
    const link = Array.from(region!.querySelectorAll('a')).find((a) => a.textContent === 'Abrir en navegador');
    expect(link?.getAttribute('href')).toBe('x-safari-https://thomasmariani11.github.io/chatbot-gastos/');
  });

  it('se destaca y compara el ícono viejo con el nuevo', () => {
    render({ ios: true, standalone: true });
    const region = container.querySelector('[aria-label="Ícono nuevo de Pesito"]')!;
    expect(region.classList.contains('icon-notice')).toBe(true);
    expect(region.textContent).toContain('Nuevo');
    const images = Array.from(region.querySelectorAll('img')).map((img) => [img.getAttribute('src'), img.getAttribute('alt')]);
    expect(images).toEqual([
      [`${import.meta.env.BASE_URL}icon-anterior.png`, 'Ícono anterior'],
      [`${import.meta.env.BASE_URL}favicon.svg`, 'Ícono nuevo'],
    ]);
  });

  it('"Ya lo hice" lo oculta y lo recuerda', () => {
    render({ ios: true, standalone: true });
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Ya lo hice');
    act(() => button!.click());
    expect(container.querySelector('[aria-label="Ícono nuevo de Pesito"]')).toBeNull();
    expect(readIconNoticeDismissed()).toBe(true);
  });

  it('no aparece en Android ni en Safari sin instalar', () => {
    render({ ios: false, standalone: true });
    expect(container.innerHTML).toBe('');
    render({ ios: true, standalone: false });
    expect(container.innerHTML).toBe('');
  });

  it('está en el Resumen antes de la invitación a notificaciones', () => {
    const source = readFileSync(join(process.cwd(), 'src/Dashboard.tsx'), 'utf8');
    expect(source.indexOf('<IconNotice')).toBeGreaterThan(-1);
    expect(source.indexOf('<IconNotice')).toBeLessThan(source.indexOf('<PushPrompt'));
  });
});
