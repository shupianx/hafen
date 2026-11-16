export type ProxyMode = 'rule' | 'global' | 'direct';

export type VpnStatus =
  | 'unavailable'
  | 'disconnected'
  | 'requestingPermission'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error';

export type VpnErrorCode =
  | 'NATIVE_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'INVALID_PROFILE'
  | 'CORE_START_FAILED'
  | 'NETWORK_UNAVAILABLE'
  | 'OPERATION_FAILED';

/** No URLs, passwords, controller tokens or raw core errors in UI events. */
export interface VpnSnapshot {
  status: VpnStatus;
  mode: ProxyMode;
  activeProfileId: string | null;
  sessionId: string | null;
  traffic: {
    uploadedBytes: number;
    downloadedBytes: number;
    sampledAtMs: number;
  } | null;
  errorCode: VpnErrorCode | null;
}

export interface VpnCapabilities {
  available: boolean;
  platform: 'android' | 'ios' | 'unsupported';
  coreVersion: string | null;
}

/** Commands resolve to native-confirmed results; status never comes from a UI toggle. */
export interface VpnClient {
  capabilities(): Promise<VpnCapabilities>;
  getSnapshot(): Promise<VpnSnapshot>;
  start(profileId: string): Promise<VpnSnapshot>;
  stop(): Promise<VpnSnapshot>;
  setMode(mode: ProxyMode): Promise<VpnSnapshot>;
  selectProxy(group: string, proxy: string): Promise<void>;
  testDelay(proxy: string): Promise<number>;
  subscribe(listener: (snapshot: VpnSnapshot) => void): () => void;
}

export class VpnError extends Error {
  readonly code: VpnErrorCode;

  constructor(code: VpnErrorCode) {
    super(code);
    this.name = 'VpnError';
    this.code = code;
  }
}

/** Explicit unavailable adapter, never a simulated VPN. Replace at the native integration boundary. */
export function createUnavailableVpnClient(
  platform: VpnCapabilities['platform'],
): VpnClient {
  const unavailable = async (): Promise<never> => {
    throw new VpnError('NATIVE_UNAVAILABLE');
  };

  return {
    capabilities: async () => ({
      available: false,
      platform,
      coreVersion: null,
    }),
    getSnapshot: async () => ({
      status: 'unavailable',
      mode: 'rule',
      activeProfileId: null,
      sessionId: null,
      traffic: null,
      errorCode: 'NATIVE_UNAVAILABLE',
    }),
    start: unavailable,
    stop: unavailable,
    setMode: unavailable,
    selectProxy: unavailable,
    testDelay: unavailable,
    subscribe: () => () => {},
  };
}
