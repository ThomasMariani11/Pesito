import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseLinkCommand } from '../supabase/functions/whatsapp-webhook/link-code';
import { prepareMessage } from '../supabase/functions/whatsapp-webhook/processor';
import type { Job } from '../supabase/functions/whatsapp-webhook/queue';

describe('parseLinkCommand', () => {
  it('reconoce el código con guiones o sin separadores, en mayúsculas o minúsculas', () => {
    for (const text of [
      'VINCULAR K7QM-X3RT-9PZD',
      'vincular k7qm-x3rt-9pzd',
      'Vincular K7QMX3RT9PZD',
      'vincular k7qmx3rt9pzd',
      '  vincular   K7QM-X3RT-9PZD  ',
    ]) {
      expect(parseLinkCommand(text), text).toBe('K7QMX3RT9PZD');
    }
  });

  it('acepta los 32 caracteres del alfabeto del código (el mismo de la migración 054)', () => {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (let i = 0; i < alphabet.length; i += 4) {
      const group = alphabet.slice(i, i + 4);
      expect(parseLinkCommand(`vincular ${group}-${group}-${group}`), group).toBe(group.repeat(3));
    }
  });

  it('ya no acepta el formato anterior de 6 dígitos', () => {
    expect(parseLinkCommand('vincular 123456')).toBeNull();
  });

  it('no reconoce frases comunes ni códigos separados por espacios', () => {
    for (const text of [
      'vincular la tarjeta con la cuenta',
      'vincular',
      'vincular 12345',
      'vincular 1234567',
      'vincular K7QM-X3RT',
      'vincular K7QM-X3RT-9PZD-XXXX',
      'vinculame K7QM-X3RT-9PZD',
      'vincular mama papa nene',
      'vincular esta cosa toda',
      'Vincular K7QM X3RT 9PZD',
      'vincular K7QM-X3RT9PZD',
    ]) {
      expect(parseLinkCommand(text), text).toBeNull();
    }
  });

  it('caracteres fuera del alfabeto del código no son un código', () => {
    expect(parseLinkCommand('vincular O0I1-AAAA-BBBB')).toBeNull();
  });
});

describe('prepareMessage: rama de vinculación', () => {
  const run = (body: string) => {
    const from = vi.fn(), rpc = vi.fn(), checkpoint = vi.fn(), gate = vi.fn();
    const db = { from, rpc } as unknown as Parameters<typeof prepareMessage>[0];
    const job = { payload: { type: 'text', text: { body } } } as Job;
    return { result: prepareMessage(db, job, checkpoint, undefined, gate), from, rpc, checkpoint, gate };
  };

  it('encola la vinculación con el hash del código normalizado, sin red ni IA', async () => {
    const r = run('vincular k7qm-x3rt-9pzd');
    const hash = createHash('sha256').update('K7QMX3RT9PZD', 'utf8').digest('hex');
    expect(await r.result).toEqual({ kind: 'link', hash });
    expect(r.from).not.toHaveBeenCalled();
    expect(r.rpc).not.toHaveBeenCalled();
    expect(r.checkpoint).not.toHaveBeenCalled();
    expect(r.gate).not.toHaveBeenCalled();
  });
});
