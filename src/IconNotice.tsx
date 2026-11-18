import { useState } from 'react';
import { Icon } from './Icons';
import { browserUrl, dismissIconNotice, readIconNoticeDismissed, shouldShowIconNotice } from './iconNoticeRules';
import { isIos, isStandalone } from './pushNotifications';

type Props = {
  /** Inyectables para pruebas. */
  env?: { ios: boolean; standalone: boolean };
  now?: () => number;
  appUrl?: string;
};

function currentEnv() {
  if (typeof window === 'undefined') return { ios: false, standalone: false };
  return { ios: isIos(window.navigator), standalone: isStandalone(window) };
}

function currentAppUrl() {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

/** MARCA-02: en iPhone instalado, explica cómo reinstalar para ver el ícono nuevo. */
export function IconNotice({ env, now = Date.now, appUrl }: Props) {
  const [dismissed, setDismissed] = useState(readIconNoticeDismissed);
  const { ios, standalone } = env ?? currentEnv();

  if (!shouldShowIconNotice({ ios, standalone, dismissed, now: now() })) return null;

  function close() {
    dismissIconNotice();
    setDismissed(true);
  }

  return (
    <div className="client-notices">
      <section className="client-notice client-notice-info" role="region" aria-label="Ícono nuevo de Pesito">
        <span className="client-notice-icon" aria-hidden="true"><Icon name="sparkles" size={18} /></span>
        <div className="client-notice-copy">
          <strong>Pesito estrenó ícono</strong>
          <small>
            Si todavía ves el chanchito con la flecha: tocá Abrir en navegador, después Compartir → Agregar a inicio, y borrá el ícono viejo. Vas a tener que iniciar sesión y activar las notificaciones de nuevo.
          </small>
        </div>
        <div className="client-notice-actions">
          <a className="button-secondary" href={browserUrl(appUrl ?? currentAppUrl())}>Abrir en navegador</a>
          <button type="button" className="text-button" onClick={close}>Entendido</button>
        </div>
      </section>
    </div>
  );
}
