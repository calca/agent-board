import { useBoard } from '../context/BoardContext';
import { getVsCodeApi, postMessage } from '../hooks/useVsCodeApi';

export function MobileCompanionDialog() {
  const { state, dispatch } = useBoard();
  const isVsCodeWebview = Boolean(getVsCodeApi());
  if (!isVsCodeWebview || !state.showMobileDialog) {
    return null;
  }

  const { mobileServerRunning, mobileServerUrl, mobileDevices, mobileQrSvg, mobileTunnelEnabled, mobileTunnelActive, mobileTunnelUrl } = state;

  return (
    <div className="mobile-dialog__overlay" onClick={() => dispatch({ type: 'CLOSE_MOBILE_DIALOG' })}>
      <div className="mobile-dialog" onClick={e => e.stopPropagation()}>
        <div className="mobile-dialog__header">
          <h3>agent-board Mobile</h3>
          <button className="mobile-dialog__close" onClick={() => dispatch({ type: 'CLOSE_MOBILE_DIALOG' })}>✕</button>
        </div>

        <div className="mobile-dialog__status">
          <span className={`mobile-dialog__dot ${mobileServerRunning ? 'mobile-dialog__dot--on' : 'mobile-dialog__dot--off'}`} />
          <span>{mobileServerRunning ? 'Server attivo' : 'Server non attivo'}</span>
        </div>

        <label className="mobile-dialog__tunnel-toggle">
          <input
            type="checkbox"
            checked={mobileTunnelEnabled}
            disabled={mobileServerRunning}
            onChange={(e) => {
              dispatch({ type: 'START_MOBILE_REFRESH' });
              postMessage({ type: 'setMobileTunnelEnabled', enabled: e.target.checked });
            }}
          />
          <span>Abilita localtunnel (accesso esterno)</span>
        </label>
        {mobileServerRunning && (
          <div className="mobile-dialog__hint">Disabilitato: stoppa il server per cambiare il tipo di connessione.</div>
        )}

        {mobileTunnelActive && mobileTunnelUrl && (
          <div className="mobile-dialog__tunnel-url">Tunnel URL: {mobileTunnelUrl}</div>
        )}

        {mobileQrSvg
          ? <div className="mobile-dialog__qr" dangerouslySetInnerHTML={{ __html: mobileQrSvg }} />
          : <div className="mobile-dialog__fallback">QR non disponibile</div>}

        <div className="mobile-dialog__url">{mobileServerUrl}</div>

        <div className="mobile-dialog__actions">
          <button className="toolbar__btn toolbar__btn--secondary" onClick={() => {
            dispatch({ type: 'START_MOBILE_REFRESH' });
            postMessage({ type: 'toggleMobileServer' });
            postMessage({ type: 'refreshMobileStatus' });
          }}>{mobileServerRunning ? 'Stop server' : 'Start server'}</button>
          <button className="toolbar__btn toolbar__btn--secondary" onClick={() => {
            dispatch({ type: 'START_MOBILE_REFRESH' });
            postMessage({ type: 'refreshMobileStatus' });
          }}>Refresh</button>
        </div>

        <div className="mobile-dialog__devices">
          <div className="mobile-dialog__devices-title">Device connessi ({mobileDevices.length})</div>
          {mobileDevices.length === 0
            ? <div className="mobile-dialog__empty">Nessun device connesso.</div>
            : mobileDevices.map(d => (
              <div key={d.ip} className="mobile-dialog__device">
                <strong>{d.ip}</strong>
                <span>{new Date(d.lastAccess).toLocaleString()}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
