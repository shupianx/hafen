import { PlatformError, type NodeSelection, type TunnelState } from './platform.ts';

interface SwitchClient {
  getVpnState(): Promise<TunnelState>;
  selectSubscriptionNode(id: string, revision: string, nodeId: string): Promise<NodeSelection>;
  stopVpn(): Promise<TunnelState>;
  startSubscriptionNode(id: string, revision: string, nodeId: string): Promise<TunnelState>;
}
interface SwitchOptions {
  cancelled(): boolean;
  onSelection(selection: NodeSelection): void;
  onSwitching(): void;
  pause?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Disconnected taps only select; connected taps replace the running connection.
 * The caller serializes taps and cancels this operation when the user presses stop.
 */
export async function selectAndSwitchNode(
  client: SwitchClient,
  target: { subscriptionId: string; revision: string; nodeId: string },
  options: SwitchOptions,
): Promise<void> {
  const pause = options.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const check = () => {
    if (options.cancelled()) throw new PlatformError('TUNNEL_CANCELLED');
  };
  check();
  const initial = await client.getVpnState();
  check();
  if (initial.state === 'connecting' || initial.state === 'disconnecting')
    throw new PlatformError('OPERATION_IN_PROGRESS');
  // Validate and persist before disrupting a working connection. A bad/stale
  // node must leave the running VPN alone.
  const selected = await client.selectSubscriptionNode(target.subscriptionId, target.revision, target.nodeId);
  options.onSelection(selected);
  check();
  if (initial.state === 'disconnected') return;
  const current = await client.getVpnState();
  check();
  // Settings may have stopped the VPN during selection. Do not undo that stop.
  if (current.state === 'disconnected' || current.state === 'disconnecting') return;
  if (current.state !== 'connected') throw new PlatformError('OPERATION_IN_PROGRESS');
  options.onSwitching();
  let state = await client.stopVpn();
  const stopDeadline = now() + 10000;
  while (state.state !== 'disconnected') {
    check();
    if (now() >= stopDeadline) throw new PlatformError('TUNNEL_STOP_FAILED');
    await pause(100);
    check();
    state = await client.getVpnState();
  }
  check();
  // Native start still checks permission/revision and refuses overlapping VPNs.
  // Keep the operation locked until the system confirms connection, not merely
  // until iOS accepts startTunnelWithOptions.
  try {
    state = await client.startSubscriptionNode(selected.subscriptionId, selected.revision, selected.nodeId);
    const deadline = now() + 15000;
    let sawConnecting = state.state === 'connecting';
    while (state.state !== 'connected') {
      check();
      if (state.error) throw new PlatformError(state.error);
      if (state.state === 'disconnecting' || (sawConnecting && state.state === 'disconnected'))
        throw new PlatformError('TUNNEL_START_FAILED');
      if (now() >= deadline) throw new PlatformError('TUNNEL_START_TIMEOUT');
      await pause(100);
      check();
      state = await client.getVpnState();
      sawConnecting ||= state.state === 'connecting';
    }
    check();
  } catch (error) {
    // Explicit cancellation already calls stopVpn. A failed/timeout start must
    // not finish connecting later after the UI has reported failure.
    if (!options.cancelled()) {
      try { await client.stopVpn(); } catch { /* Preserve the original error. */ }
    }
    throw error;
  }
}
