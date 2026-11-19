import { describe, expect, it } from 'vitest';
import { isStrongPassword, PASSWORD_RULE } from '../src/passwordPolicy';
import { registrationErrorMessage } from '../src/registration';

// Regla acordada con el propietario (19/11/2026): al menos 8 caracteres, con mayúsculas, minúsculas y números.
describe('política de contraseñas', () => {
  it.each(['Clave2026', 'Pesito-Seguro9', 'aB345678'])('acepta %s', (password) => {
    expect(isStrongPassword(password)).toBe(true);
  });

  it.each([
    ['', 'vacía'],
    ['Cl4ve', 'menos de 8'],
    ['clave2026', 'sin mayúscula'],
    ['CLAVE2026', 'sin minúscula'],
    ['ClaveSegura', 'sin número'],
    ['test-password', 'la del formulario anterior'],
  ])('rechaza %s (%s)', (password) => {
    expect(isStrongPassword(password)).toBe(false);
  });

  it('el mensaje explica la regla completa', () => {
    expect(PASSWORD_RULE).toBe('Usá al menos 8 caracteres, con mayúsculas, minúsculas y números.');
  });

  it('un rechazo de contraseña de Auth muestra la regla, sin el texto interno', () => {
    expect(registrationErrorMessage({ message: 'Password should contain at least one character of each: abcdefghijklmnopqrstuvwxyz' }, true)).toBe(PASSWORD_RULE);
  });
});
