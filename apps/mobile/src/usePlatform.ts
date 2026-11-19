import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  createPlatformClient,
  selectAndSwitchNode,
  safePlatformError,
  PlatformError,
  platformErrorMessages,
  parseTunnelState,
  type TunnelState,
  type NodeSelection,
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
  const [selection, setSelection] = useState<NodeSelection | null>(null);
  const restored = useRef(false);
  const selectedId = selection?.subscriptionId === openedId && nodes?.nodes.some(node => node.id === selection.nodeId) ? selection.nodeId : null;
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const selectionRequest = useRef(0);
  const selectionInProgress = useRef(false);
  const [notice, setNotice] = useState('');
  const connectionName = tunnel.connectionName || '';
  const [error, setError] = useState('');
  const alive = useRef(false);
  const locked = useRef(false);
  const tunnelVersion = useRef(0);
  const applyTunnel = useCallback((state: TunnelState) => {
    if (!alive.current) return;
    setTunnel(current => current.state === state.state && current.error === state.error && current.internetReachable === state.internetReachable && current.connectionName === state.connectionName ? current : state);
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
      if (alive.current && safePlatformError(reason).code !== 'TUNNEL_CANCELLED')
        setError(safePlatformError(reason).message);
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
        const [nextEnvironment, nextSubscriptions, nextSelection] = await Promise.all([
          client.getEnvironment(),
          client.listSubscriptions(),
          client.getSelectedNode(),
        ]);
        if (!alive.current) return;
        setEnvironment(nextEnvironment);
        setSubscriptions(nextSubscriptions);
        setSelection(nextSelection);
        if (!restored.current) {
          if (nextSelection) {
            const nextNodes = await client.listSubscriptionNodes(nextSelection.subscriptionId);
            if (!alive.current) return;
            setOpenedId(nextSelection.subscriptionId);
            setNodes(nextNodes);
          }
          restored.current = true;
        }
      }),
    [run],
  );

  useEffect(() => {
    alive.current = true;
    refresh();
    let polling = false;
    async function syncTunnel() {
      if (!alive.current || polling || selectionInProgress.current || AppState.currentState !== 'active') return;
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
      selectionRequest.current += 1;
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
      }
      if (selection?.subscriptionId === id) setSelection(null);
      setNotice('订阅及本地节点已删除。');
    });
  }

  function openSubscription(id: string) {
    return run(async () => {
      const result = await client.listSubscriptionNodes(id);
      if (!alive.current) return;
      setOpenedId(id);
      setNodes(result);
    });
  }
  function updateSubscription(id: string, content?: string) {
    return run(async () => {
      const result =
        content === undefined
          ? await client.refreshSubscription(id)
          : await client.importSubscription(id, content);
      const nextSelection = await client.getSelectedNode();
      if (!alive.current) return;
      setOpenedId(id);
      setNodes(result);
      setSelection(nextSelection);
      setNotice(
        `已保存 ${result.nodes.length} 个节点，跳过 ${result.skipped} 个不支持或重复的条目。仅导入节点，不应用订阅中的规则、DNS 或策略组。`,
      );
    });
  }
  function selectNode(nodeId: string) {
    return run(async () => {
      if (!openedId || !nodes) throw new PlatformError('INVALID_NODE');
      selectionInProgress.current = true;
      const request = ++selectionRequest.current;
      const cancelled = () => !alive.current || request !== selectionRequest.current;
      // Native notifications win over a slower command/poll response.
      const observe = async (operation: () => Promise<TunnelState>) => {
        const version = ++tunnelVersion.current;
        const state = await operation();
        if (version === tunnelVersion.current) applyTunnel(state);
        return state;
      };
      try {
        await selectAndSwitchNode({
          selectSubscriptionNode: client.selectSubscriptionNode,
          getVpnState: () => observe(client.getVpnState),
          stopVpn: () => observe(client.stopVpn),
          startSubscriptionNode: (id, revision, selectedNode) =>
            observe(() => client.startSubscriptionNode(id, revision, selectedNode)),
        }, { subscriptionId: openedId, revision: nodes.revision, nodeId }, {
          cancelled,
          onSelection: next => { if (alive.current) setSelection(next); },
          onSwitching: () => { if (alive.current) setSwitching(true); },
        });
      } finally {
        selectionInProgress.current = false;
        if (alive.current) setSwitching(false);
      }
    });
  }
  function connectSelected() {
    return run(async () => {
      if (!selection)
        throw new PlatformError('INVALID_NODE');
      const grantedNow = await client.prepareVpn();
      if (!grantedNow) {
        if (alive.current) setNotice('已取消系统授权。');
        return;
      }
      const version = ++tunnelVersion.current;
      const next = await client.startSubscriptionNode(
        selection.subscriptionId,
        selection.revision,
        selection.nodeId,
      );
      if (alive.current) {
        if (version === tunnelVersion.current) applyTunnel(next);
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
        setNotice('');
      }
    });
  }
  // Stop stays available while a subscription download holds the UI operation lock.
  async function disconnect() {
    selectionRequest.current += 1;
    setSwitching(false);
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
    selection,
    selectNode,
    openSubscription,
    updateSubscription,
    connectSelected,
    tunnel,
    tunnelError: tunnel.error ? platformErrorMessages[tunnel.error] : '',
    connect,
    disconnect,
    subscriptions,
    busy,
    switching,
    notice,
    error,
    refresh,
    save,
    remove,
    prepareVpn,
    diagnose: client.getVpnDiagnostics,
  };
}
