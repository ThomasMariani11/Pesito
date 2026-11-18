import { describe, expect, it } from 'vitest';
import { parseLinkCommand } from '../supabase/functions/whatsapp-webhook/link-code';

describe('parseLinkCommand', () => {
  it('reconoce el formato nuevo en mayúsculas, minúsculas, con guiones, con espacios y sin separadores', () => {
    for (const text of [
      'VINCULAR K7QM-X3RT-9PZD',
      'vincular k7qm-x3rt-9pzd',
      'Vincular K7QM X3RT 9PZD',
      'vincular k7qmx3rt9pzd',
      '  vincular   K7QM-X3RT-9PZD  ',
    ]) {
      expect(parseLinkCommand(text), text).toBe('K7QMX3RT9PZD');
    }
  });

  it('acepta 6 dígitos durante la transición', () => {
    expect(parseLinkCommand('vincular 123456')).toBe('123456');
  });

  it('no reconoce frases comunes', () => {
    for (const text of [
      'vincular la tarjeta con la cuenta',
      'vincular',
      'vincular 12345',
      'vincular K7QM-X3RT',
      'vinculame K7QM-X3RT-9PZD',
    ]) {
      expect(parseLinkCommand(text), text).toBeNull();
    }
  });

  it('un código con forma válida pero fuera del alfabeto se devuelve normalizado', () => {
    expect(parseLinkCommand('vincular O0I1-AAAA-BBBB')).toBe('O0I1AAAABBBB');
  });
});
