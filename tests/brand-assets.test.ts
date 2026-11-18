import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const exists = (path: string) => existsSync(new URL(`../${path}`, import.meta.url));

const UNSAFE_SVG = /<script|<image|<foreignObject|href="http/i;
const OPAQUE_FULL_BACKGROUND = /^\s*(?:<\?xml[^>]*>\s*)?<svg[^>]*>\s*(?:<defs>[\s\S]*?<\/defs>\s*)?<rect width="512" height="512"(?![^>]*\brx=)[^>]*\/>/;

describe('marca: logo vectorial del chanchito', () => {
  const master = () => read('public/favicon.svg');
  const maskable = () => read('brand/pesito-maskable.svg');

  it('el maestro es un SVG seguro de 512', () => {
    const svg = master();
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('id="pesito"');
    expect(svg).not.toMatch(UNSAFE_SVG);
  });

  it('el maestro tiene la moneda dorada y no tiene flecha', () => {
    const svg = master();
    expect(svg.toLowerCase()).toContain('#ffcc45');
    expect(svg).not.toContain('<polyline');
  });

  it('los íconos son opacos en las esquinas', () => {
    expect(master()).toMatch(OPAQUE_FULL_BACKGROUND);
    expect(maskable()).toMatch(OPAQUE_FULL_BACKGROUND);
  });

  it('la variante maskable deja al chanchito en la zona segura', () => {
    const svg = maskable();
    expect(svg).toContain('viewBox="0 0 512 512"');
    expect(svg).toContain('id="pesito"');
    expect(svg).not.toMatch(UNSAFE_SVG);
    const box = svg.match(/data-safe-box="([\d.\s]+)"/);
    expect(box).not.toBeNull();
    const [x, y, w, h] = box![1].trim().split(/\s+/).map(Number);
    const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
    for (const [cx, cy] of corners) {
      expect(Math.hypot(cx - 256, cy - 256)).toBeLessThanOrEqual(204.8);
    }
  });
});

export { exists, read };
