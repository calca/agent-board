import type * as LocalTunnelNS from 'localtunnel';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { LocalApiServer } from '../server/LocalApiServer';
import { getLocalIPv4 } from '../utils/repoDetection';
import * as QRCode from 'qrcode';

export interface MobileBootstrapResult {
  mobileServer: LocalApiServer;
  getMobileStatusPayload: () => Promise<{
    running: boolean;
    url: string;
    devices: { ip: string; lastAccess: string }[];
    qrSvg: string;
    tunnelEnabled: boolean;
    tunnelActive: boolean;
    tunnelUrl: string | undefined;
  }>;
  setTunnelEnabled: (enabled: boolean) => void;
  isTunnelEnabled: () => boolean;
  ensureMobileTunnel: () => Promise<void>;
  stopMobileTunnel: () => Promise<void>;
}

/**
 * Creates the LocalApiServer for mobile companion support and
 * manages localtunnel state (enable/disable, start/stop).
 */
export function bootstrapMobile(
  extensionPath: string,
  workspaceName: string,
  providerRegistry: ProviderRegistry,
): MobileBootstrapResult {
  const mobileServerPort = 3333;
  const mobileServer = new LocalApiServer(providerRegistry, extensionPath, workspaceName);
  let mobileTunnelEnabled = false;
  let mobileTunnel: LocalTunnelNS.Tunnel | undefined;

  const stopMobileTunnel = async (): Promise<void> => {
    if (!mobileTunnel) {
      return;
    }
    try {
      await mobileTunnel.close();
    } catch {
      // no-op
    }
    mobileTunnel = undefined;
  };

  const ensureMobileTunnel = async (): Promise<void> => {
    if (!mobileTunnelEnabled || !mobileServer.isRunning() || mobileTunnel) {
      return;
    }
    try {
      const ltModule = await import('localtunnel') as unknown as Record<string, unknown>;
      // Handle both ESM default and CJS module.exports
      const ltFn: ((opts: { port: number }) => Promise<LocalTunnelNS.Tunnel>) | undefined =
        typeof ltModule === 'function' ? ltModule as unknown as ((opts: { port: number }) => Promise<LocalTunnelNS.Tunnel>)
        : typeof ltModule.default === 'function' ? ltModule.default as unknown as ((opts: { port: number }) => Promise<LocalTunnelNS.Tunnel>)
        : undefined;
      if (!ltFn) {
        console.error('localtunnel: module did not expose a callable export');
        return;
      }
      const tunnel = await ltFn({ port: mobileServer.getPort() });
      mobileTunnel = tunnel;
      tunnel.on('close', () => {
        mobileTunnel = undefined;
      });
    } catch (err) {
      console.error('localtunnel: failed to create tunnel: %s', err);
    }
  };

  const getMobileStatusPayload = async () => {
    const localIp = getLocalIPv4() ?? '127.0.0.1';
    if (!mobileServer.isRunning()) {
      await stopMobileTunnel();
    } else if (mobileTunnelEnabled) {
      await ensureMobileTunnel();
    }

    const baseUrl = mobileTunnelEnabled && mobileTunnel?.url
      ? mobileTunnel.url
      : `http://${localIp}:${mobileServer.getPort()}`;
    const sessionToken = mobileServer.getSessionToken();
    const url = sessionToken ? `${baseUrl}/?token=${sessionToken}` : baseUrl;
    const qrSvg = await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      width: 240,
    });
    return {
      running: mobileServer.isRunning(),
      url,
      devices: mobileServer.getConnectedDevices().map(d => ({ ip: d.ip, lastAccess: d.lastAccess })),
      qrSvg,
      tunnelEnabled: mobileTunnelEnabled,
      tunnelActive: Boolean(mobileTunnel?.url),
      tunnelUrl: mobileTunnel?.url,
    };
  };

  const setTunnelEnabled = (enabled: boolean): void => {
    mobileTunnelEnabled = enabled;
  };

  const isTunnelEnabled = (): boolean => mobileTunnelEnabled;

  // Start the mobile server immediately
  mobileServer.start(mobileServerPort);

  return {
    mobileServer,
    getMobileStatusPayload,
    setTunnelEnabled,
    isTunnelEnabled,
    ensureMobileTunnel,
    stopMobileTunnel,
  };
}
