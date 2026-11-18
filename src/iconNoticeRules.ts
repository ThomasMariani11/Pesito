// MARCA-02: iOS no actualiza el ícono de una web ya agregada a la pantalla de inicio.
// Este aviso explica cómo reinstalar Pesito para ver el logo nuevo (MARCA-01).

/** Desde esta fecha el aviso deja de mostrarse, también en instalaciones nuevas. */
export const ICON_NOTICE_UNTIL = Date.parse('2027-01-01T00:00:00-03:00');

const KEY = 'pesito:aviso-icono-nuevo';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readIconNoticeDismissed(): boolean {
  try {
    const store = storage();
    return store ? store.getItem(KEY) !== null : false;
  } catch {
    return false;
  }
}

/** "Entendido": no vuelve a aparecer en este dispositivo. */
export function dismissIconNotice(): void {
  try {
    storage()?.setItem(KEY, '1');
  } catch {
    // Sin almacenamiento el aviso se oculta solo hasta recargar.
  }
}

export function shouldShowIconNotice(input: { ios: boolean; standalone: boolean; dismissed: boolean; now: number }): boolean {
  return input.ios && input.standalone && !input.dismissed && input.now < ICON_NOTICE_UNTIL;
}

/** Esquema de iOS 17+ (no documentado) que abre la dirección en Safari desde una web instalada. */
export function browserUrl(appUrl: string): string {
  return appUrl.replace(/^(https?):\/\//, 'x-safari-$1://');
}
