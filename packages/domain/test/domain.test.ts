import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnavailableVpnClient, VpnError } from '../src/vpn.ts';
import { validateSubscriptionInput } from '../src/subscription.ts';

test('preserves signed subscription tokens and trims user input', () => {
  const sourceUrl = 'https://example.com/sub?token=a%2Bb&signature=AA%3D';
  assert.deepEqual(
    validateSubscriptionInput({
      name: ' 我的订阅 ',
      sourceUrl: ` ${sourceUrl} `,
    }),
    {
      ok: true,
      value: { name: '我的订阅', sourceUrl },
    },
  );
});

test('discards share labels while preserving encoded hashes in signed URLs', () => {
  const sourceUrl = 'https://example.com:4300/sub?token=a%23b%2Bc';
  for (const label of ['#Demo%20Network', '#我的 网络#备用', '#\\%ZZ', '#', '#' + 'x'.repeat(8192)]) {
    assert.deepEqual(validateSubscriptionInput({ name: 'Test', sourceUrl: sourceUrl + label }), {
      ok: true, value: { name: 'Test', sourceUrl },
    });
  }
});

test('rejects invalid, insecure and ambiguous subscription addresses without echoing secrets', () => {
  const cases = [
    ['http://example.com/?token=private-token', 'HTTPS_REQUIRED'],
    [
      'https://user:private-token@example.com/sub',
      'URL_CREDENTIALS_NOT_ALLOWED',
    ],
    ['https:example.com', 'INVALID_URL'],
    ['https://example.com/\nprivate-token', 'INVALID_URL'],
    ['https://example.com\\private-token', 'INVALID_URL'],
    ['not-a-url-private-token', 'INVALID_URL'],
    ['', 'INVALID_URL'],
  ];
  for (const [sourceUrl, error] of cases) {
    const result = validateSubscriptionInput({ name: 'Test', sourceUrl });
    assert.deepEqual(result, { ok: false, error });
    assert.equal(JSON.stringify(result).includes('private-token'), false);
  }
});

test('requires a nonempty bounded display name', () => {
  for (const name of ['', '  ', 'x'.repeat(65), 'a\u0000b']) {
    assert.deepEqual(
      validateSubscriptionInput({ name, sourceUrl: 'https://example.com/sub' }),
      {
        ok: false,
        error: 'INVALID_NAME',
      },
    );
  }
});

test('a build without native VPN never reports connected or accepts commands', async () => {
  const vpn = createUnavailableVpnClient('android');
  assert.equal((await vpn.capabilities()).available, false);
  const before = await vpn.getSnapshot();
  const commands = [
    () => vpn.start('profile'),
    () => vpn.stop(),
    () => vpn.setMode('global'),
    () => vpn.selectProxy('group', 'proxy'),
    () => vpn.testDelay('proxy'),
  ];
  for (const command of commands) {
    await assert.rejects(
      command,
      (error: unknown) =>
        error instanceof VpnError && error.code === 'NATIVE_UNAVAILABLE',
    );
  }
  assert.deepEqual(await vpn.getSnapshot(), before);
  assert.equal(before.status, 'unavailable');
  assert.equal(before.traffic, null);
});
