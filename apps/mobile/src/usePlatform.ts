import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  createPlatformClient,
  safePlatformError,
  PlatformError,
  platformErrorMessages,
  parseTunnelState,
  type TunnelState,
  type PlatformEnvironment,
  type SubscriptionSummary,
  type SubscriptionNodes,
} from '@hafen/domain';
import NativeHafenPlatform from '../specs/NativeHafenPlatform';

const client = createPlatformClient(NativeHafenPlatform ?? null);

export function usePlatform() {
  const [environment, setEnvironment] = useState<PlatformEnvironment | null>(
    null,
  );
  const [subscriptions, setSubscriptions] = useState<SubscriptionSummary[]>([]);
  const [tunnel, setTunnel] = useState<TunnelState>({
    state: 'disconnected',
    error: null,
    internetReachable: null,
  });
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<SubscriptionNodes | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [error, setError] = useState('');
  const alive = useRef(false);
  const locked = useRef(false);
  const tunnelVersion = useRef(0);
  const applyTunnel = useCallback((state: TunnelState) => {
    if (!alive.current) return;
    setTunnel(current => current.state === state.state && current.error === state.error && current.internetReachable === state.internetReachable ? current : state);
  }, []);

  // A ref closes the double-tap window before React commits the disabled button.
  const run = useCallback(async (operation: () => Promise<void>) => {
    if (locked.current || !alive.current) return false;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
      return true;
    } catch (reason) {
      if (alive.current) setError(safePlatformError(reason).message);
      return false;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }, []);

  const clearFeedback = useCallback(() => {
    setError('');
    setNotice('');
  }, []);

  const refresh = useCallback(
    () =>
      run(async () => {
        const [nextEnvironment, nextSubscriptions] = await Promise.all([
          client.getEnvironment(),
          client.listSubscriptions(),
        ]);
        if (!alive.current) return;
        setEnvironment(nextEnvironment);
        setSubscriptions(nextSubscriptions);
      }),
    [run],
  );

  useEffect(() => {
    alive.current = true;
    refresh();
    let polling = false;
    async function syncTunnel() {
      if (!alive.current || polling || AppState.currentState !== 'active') return;
      polling = true;
      const version = tunnelVersion.current;
      try {
        const state = await client.getVpnState();
        if (version === tunnelVersion.current) applyTunnel(state);
      } catch {
      } finally {
        polling = false;
      }
    }
    const nativeListener = NativeHafenPlatform?.onVpnStateChanged(json => {
      try {
        const state = parseTunnelState(json);
        tunnelVersion.current += 1;
        applyTunnel(state);
      } catch {}
    });
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') {
        // Do not wait for subscription refresh or the next timer tick.
        syncTunnel();
        refresh();
      }
    });
    syncTunnel();
    const timer = setInterval(syncTunnel, 1000);
    return () => {
      clearInterval(timer);
      alive.current = false;
      listener.remove();
      nativeListener?.remove();
    };
  }, [refresh, applyTunnel]);

  function save(name: string, url: string) {
    return run(async () => {
      const record = await client.saveSubscription(name, url);
      if (!alive.current) return;
      setSubscriptions(current => [record, ...current]);
      setOpenedId(record.id);
      setNodes(null);
      setSelectedId(null);
      setNotice('已添加订阅');
    });
  }

  function remove(id: string) {
    return run(async () => {
      await client.deleteSubscription(id);
      if (!alive.current) return;
      setSubscriptions(current => current.filter(record => record.id !== id));
      if (openedId === id) {
        setOpenedId(null);
        setNodes(null);
        setSelectedId(null);
      }
      setNotice('订阅及本地节点已删除。');
    });
  }

  function openSubscription(id: string) {
    return run(async () => {
      const result = await client.listSubscriptionNodes(id);
      if (!alive.current) return;
      setOpenedId(id);
      setNodes(result);
      setSelectedId(null);
    });
  }
  function updateSubscription(id: string, content?: string) {
    return run(async () => {
      const result =
        content === undefined
          ? await client.refreshSubscription(id)
          : await client.importSubscription(id, content);
      if (!alive.current) return;
      setOpenedId(id);
      setNodes(result);
      setSelectedId(null);
      setNotice(
        `已保存 ${result.nodes.length} 个节点，跳过 ${result.skipped} 个不支持或重复的条目。仅导入节点，不应用订阅中的规则、DNS 或策略组。`,
      );
    });
  }
  function connectSelected() {
    return run(async () => {
      if (!openedId || !nodes || !selectedId)
        throw new PlatformError('INVALID_NODE');
      const grantedNow = await client.prepareVpn();
      if (!grantedNow) {
        if (alive.current) setNotice('已取消系统授权。');
        return;
      }
      const version = ++tunnelVersion.current;
      const next = await client.startSubscriptionNode(
        openedId,
        nodes.revision,
        selectedId,
      );
      if (alive.current) {
        if (version === tunnelVersion.current) applyTunnel(next);
        setConnectionName(
          nodes.nodes.find(node => node.id === selectedId)?.name || '',
        );
        setNotice('');
      }
    });
  }

  function prepareVpn() {
    return run(async () => {
      const granted = await client.prepareVpn();
      const next = await client.getEnvironment();
      if (!alive.current) return;
      setEnvironment(next);
      setNotice(
        granted
          ? '系统授权已完成，VPN 尚未连接。'
          : '已取消系统授权，你可以稍后重试。',
      );
    });
  }

  function connect(server: string, port: string, password: string) {
    return run(async () => {
      const number = Number(port);
      if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > 65535 ||
        !server.trim() ||
        !password
      ) {
        throw new PlatformError('INVALID_CORE_PROFILE');
      }
      const grantedNow = await client.prepareVpn();
      if (!grantedNow) {
        if (alive.current) setNotice('已取消系统授权。');
        return;
      }
      const profile = JSON.stringify({
        type: 'shadowsocks',
        server: server.trim(),
        server_port: number,
        method: 'aes-128-gcm',
        password,
      });
      const version = ++tunnelVersion.current;
      const next = await client.startVpn(profile);
      if (alive.current) {
        if (version === tunnelVersion.current) applyTunnel(next);
        setConnectionName('手动节点');
        setNotice('');
      }
    });
  }
  // Stop stays available while a subscription download holds the UI operation lock.
  async function disconnect() {
    try {
      const version = ++tunnelVersion.current;
      const next = await client.stopVpn();
      if (version === tunnelVersion.current) applyTunnel(next);
    } catch (reason) {
      if (alive.current) setError(safePlatformError(reason).message);
    }
  }

  return {
    environment,
    connectionName,
    clearFeedback,
    openedId,
    nodes,
    selectedId,
    selectNode: setSelectedId,
    openSubscription,
    updateSubscription,
    connectSelected,
    tunnel,
    tunnelError: tunnel.error ? platformErrorMessages[tunnel.error] : '',
    connect,
    disconnect,
    subscriptions,
    busy,
    notice,
    error,
    refresh,
    save,
    remove,
    prepareVpn,
    diagnose: client.getVpnDiagnostics,
  };
}
