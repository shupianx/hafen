import assert from 'node:assert/strict';
import test from 'node:test';
import { selectAndSwitchNode } from '../src/nodeSwitch.ts';
import { PlatformError, type NodeSelection, type TunnelState } from '../src/platform.ts';

const target = { subscriptionId: 'subscription-b', revision: 'revision-b', nodeId: 'node-b' };
const selected: NodeSelection = { ...target, name: 'B' };
const state = (value: TunnelState['state'], error: TunnelState['error'] = null): TunnelState =>
  ({ state: value, error, internetReachable: null, connectionName: value === 'connected' ? 'A' : null });
function fixture() {
  let clock = 0;
  let cancelled = false;
  let current = state('connected');
  const calls: string[] = [];
  const client = {
    getVpnState: async () => { calls.push('state'); return current; },
    selectSubscriptionNode: async () => { calls.push('save:B'); return selected; },
    stopVpn: async () => { calls.push('stop'); current = state('disconnected'); return current; },
    startSubscriptionNode: async (id: string, revision: string, node: string) => {
      assert.deepEqual([id, revision, node], [target.subscriptionId, target.revision, target.nodeId]);
      calls.push('start:B'); current = { ...state('connected'), connectionName: 'B' }; return current;
    },
  };
  const options = {
    cancelled: () => cancelled,
    onSelection: () => { calls.push('selected:B'); },
    onSwitching: () => { calls.push('switching'); },
    pause: async (ms: number) => { clock += ms; },
    now: () => clock,
  };
  return { client, options, calls, cancel: () => { cancelled = true; }, setState: (s: TunnelState) => { current = s; } };
}

test('connected tap saves B, stops A, then starts B; disconnected tap only saves', async () => {
  const f = fixture();
  await selectAndSwitchNode(f.client, target, f.options);
  assert.deepEqual(f.calls, ['state', 'save:B', 'selected:B', 'state', 'switching', 'stop', 'start:B']);
  const off = fixture(); off.setState(state('disconnected'));
  await selectAndSwitchNode(off.client, target, off.options);
  assert.deepEqual(off.calls, ['state', 'save:B', 'selected:B']);
});

test('iOS disconnecting acknowledgement is not permission to start; wait for disconnected and connected', async () => {
  const f = fixture();
  f.client.stopVpn = async () => { f.calls.push('stop'); f.setState(state('disconnecting')); return state('disconnecting'); };
  f.client.startSubscriptionNode = async () => { f.calls.push('start:B'); f.setState(state('connecting')); return state('connecting'); };
  let ticks = 0;
  f.options.pause = async () => {
    ticks++;
    if (ticks === 2) f.setState(state('disconnected'));
    if (ticks === 4) f.setState({ ...state('connected'), connectionName: 'B' });
  };
  await selectAndSwitchNode(f.client, target, f.options);
  assert.equal(ticks, 4);
  assert.ok(f.calls.indexOf('start:B') > f.calls.lastIndexOf('stop') + 2);
});

test('stale/unpersistable node does not disrupt A', async () => {
  for (const code of ['STALE_SUBSCRIPTION', 'STORAGE_UNAVAILABLE'] as const) {
    const f = fixture();
    f.client.selectSubscriptionNode = async () => { throw new PlatformError(code); };
    await assert.rejects(selectAndSwitchNode(f.client, target, f.options), { code });
    assert.deepEqual(f.calls, ['state']);
  }
});

test('user stop during save or disconnect cancels the queued reconnect', async () => {
  for (const phase of ['save', 'disconnect']) {
    const f = fixture();
    if (phase === 'save') f.options.onSelection = () => f.cancel();
    else {
      f.client.stopVpn = async () => { f.calls.push('stop'); return state('disconnecting'); };
      f.options.pause = async () => f.cancel();
    }
    await assert.rejects(selectAndSwitchNode(f.client, target, f.options), { code: 'TUNNEL_CANCELLED' });
    assert.ok(!f.calls.includes('start:B'));
  }
});

test('system stop while saving B is respected', async () => {
  const f = fixture();
  f.options.onSelection = () => f.setState(state('disconnected'));
  await selectAndSwitchNode(f.client, target, f.options);
  assert.ok(!f.calls.includes('start:B'));
  assert.ok(!f.calls.includes('stop'));
});

test('disconnect timeout never starts B', async () => {
  const f = fixture();
  f.client.stopVpn = async () => { f.setState(state('disconnecting')); return state('disconnecting'); };
  await assert.rejects(selectAndSwitchNode(f.client, target, f.options), { code: 'TUNNEL_STOP_FAILED' });
  assert.ok(!f.calls.includes('start:B'));
});

test('failed or timed out B is stopped and never silently falls back to A', async () => {
  for (const failure of ['native-error', 'timeout', 'disconnect']) {
    const f = fixture();
    f.client.startSubscriptionNode = async () => {
      f.calls.push('start:B');
      if (failure === 'native-error') throw new PlatformError('CORE_START_FAILED');
      f.setState(state('connecting')); return state('connecting');
    };
    if (failure === 'disconnect') f.options.pause = async () => f.setState(state('disconnected', 'ENDPOINT_DNS_FAILED'));
    const code = failure === 'native-error' ? 'CORE_START_FAILED' : failure === 'timeout' ? 'TUNNEL_START_TIMEOUT' : 'ENDPOINT_DNS_FAILED';
    await assert.rejects(selectAndSwitchNode(f.client, target, f.options), { code });
    assert.equal(f.calls.filter(c => c === 'start:B').length, 1);
    assert.equal(f.calls.filter(c => c === 'stop').length, 2);
  }
});
