import { useCallback, useState } from 'react';
import { useBoard } from '../context/BoardContext';
import { getVsCodeApi, postMessage } from '../hooks/useVsCodeApi';

export function MobileCompanionDialog() {
  const { state, dispatch } = useBoard();
  const isVsCodeWebview = Boolean(getVsCodeApi());
  if (!isVsCodeWebview || !state.showMobileDialog) {
    return null;
  }

  const { mobileServerRunning, mobileServerUrl, mobileDevices, mobileQrSvg, mobileTunnelEnabled, mobileTunnelActive, mobileTunnelUrl } = state;
  const activeUrl = mobileTunnelActive && mobileTunnelUrl ? mobileTunnelUrl : mobileServerUrl;

  return (
    <div className="mc__overlay" onClick={() => dispatch({ type: 'CLOSE_MOBILE_DIALOG' })}>
      <div className="mc" onClick={e => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="mc__header">
          <div className="mc__header-left">
            <span className="mc__icon">📱</span>
            <div>
              <h3 className="mc__title">Mobile Companion</h3>
              <span className="mc__subtitle">Accedi alla board dal tuo telefono</span>
            </div>
          </div>
          <button className="mc__close" onClick={() => dispatch({ type: 'CLOSE_MOBILE_DIALOG' })} aria-label="Chiudi">✕</button>
        </div>

        {/* ── Main content ── */}
        <div className="mc__body">
          {/* QR Section */}
          <div className="mc__qr-section">
            {mobileQrSvg ? (
              <div className="mc__qr" dangerouslySetInnerHTML={{ __html: mobileQrSvg }} />
            ) : (
              <div className="mc__qr-placeholder">
                <span className="mc__qr-placeholder-icon">⏳</span>
                <span>Avvia il server per generare il QR code</span>
              </div>
            )}
            {mobileServerRunning && activeUrl && (
              <div className="mc__url-chip" title={activeUrl}>
                <span className="mc__url-text">{activeUrl}</span>
                <CopyButton text={activeUrl} />
              </div>
            )}
          </div>

          {/* Controls Section */}
          <div className="mc__controls">
            {/* Status */}
            <div className="mc__status-row">
              <span className="mc__label">Stato</span>
              <span className={`mc__badge ${mobileServerRunning ? 'mc__badge--on' : 'mc__badge--off'}`}>
                <span className="mc__badge-dot" />
                {mobileServerRunning ? 'Attivo' : 'Non attivo'}
              </span>
            </div>

            {/* Tunnel toggle */}
            <div className="mc__setting-row">
              <div className="mc__setting-info">
                <span className="mc__label">Accesso esterno</span>
                <span className="mc__setting-desc">Usa localtunnel per accedere da fuori la rete locale</span>
              </div>
              <label className="mc__switch">
                <input
                  type="checkbox"
                  checked={mobileTunnelEnabled}
                  disabled={mobileServerRunning}
                  onChange={(e) => {
                    dispatch({ type: 'START_MOBILE_REFRESH' });
                    postMessage({ type: 'setMobileTunnelEnabled', enabled: e.target.checked });
                  }}
                />
                <span className="mc__switch-track">
                  <span className="mc__switch-thumb" />
                </span>
              </label>
            </div>
            {mobileServerRunning && (
              <div className="mc__setting-hint">Ferma il server per modificare questa impostazione.</div>
            )}

            {mobileTunnelActive && mobileTunnelUrl && (
              <div className="mc__tunnel-badge">
                🌐 Tunnel attivo
              </div>
            )}

            {/* Buttons */}
            <div className="mc__actions">
              <button
                className={`mc__btn ${mobileServerRunning ? 'mc__btn--danger' : 'mc__btn--primary'}`}
                onClick={() => {
                  dispatch({ type: 'START_MOBILE_REFRESH' });
                  postMessage({ type: 'toggleMobileServer' });
                  postMessage({ type: 'refreshMobileStatus' });
                }}
              >
                {mobileServerRunning ? '⏹ Ferma server' : '▶ Avvia server'}
              </button>
              <button
                className="mc__btn mc__btn--ghost"
                onClick={() => {
                  dispatch({ type: 'START_MOBILE_REFRESH' });
                  postMessage({ type: 'refreshMobileStatus' });
                }}
              >
                ↻ Aggiorna
              </button>
            </div>
          </div>
        </div>

        {/* ── Devices footer ── */}
        <div className="mc__devices">
          <div className="mc__devices-header">
            <span className="mc__label">Dispositivi connessi</span>
            <span className="mc__devices-count">{mobileDevices.length}</span>
          </div>
          {mobileDevices.length === 0 ? (
            <div className="mc__devices-empty">Nessun dispositivo connesso</div>
          ) : (
            <div className="mc__devices-list">
              {mobileDevices.map(d => (
                <div key={d.ip} className="mc__device-row">
                  <span className="mc__device-ip">{d.ip}</span>
                  <span className="mc__device-time">{new Date(d.lastAccess).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available */
    }
  }, [text]);

  return (
    <button className="mc__copy-btn" onClick={handleCopy} title="Copia URL" aria-label="Copia URL">
      {copied ? '✓' : '📋'}
    </button>
  );
}
