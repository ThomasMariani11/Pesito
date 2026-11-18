// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  browserUrl,
  dismissIconNotice,
  ICON_NOTICE_UNTIL,
  readIconNoticeDismissed,
  shouldShowIconNotice,
} from '../src/iconNoticeRules';

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
