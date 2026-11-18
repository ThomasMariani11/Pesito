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
      <section className="icon-notice" role="region" aria-label="Ícono nuevo de Pesito">
        <div className="icon-notice-compare">
          <img className="icon-notice-old" src={`${import.meta.env.BASE_URL}icon-anterior.png`} alt="Ícono anterior" width={44} height={44} />
          <Icon name="chevronRight" size={22} />
          <img className="icon-notice-new" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="Ícono nuevo" width={58} height={58} />
          <span className="icon-notice-badge">Nuevo</span>
        </div>
        <strong className="icon-notice-title">Pesito estrenó ícono</strong>
        <p>¿Todavía ves el chanchito con la flecha? Actualizalo en 3 pasos:</p>
        <ol>
          <li>Tocá <b>Abrir en navegador</b></li>
          <li>Compartir → Agregar a inicio</li>
          <li>Borrá el ícono viejo</li>
        </ol>
        <small>Vas a tener que iniciar sesión y activar las notificaciones de nuevo.</small>
        <a className="icon-notice-primary" href={browserUrl(appUrl ?? currentAppUrl())}>Abrir en navegador</a>
        <button type="button" className="icon-notice-close" onClick={close}>Ya lo hice</button>
      </section>
    </div>
  );
}
