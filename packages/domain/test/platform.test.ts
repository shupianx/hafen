import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlatformClient,
  PlatformError,
  safePlatformError,
  type PlatformTransport,
} from "../src/platform.ts";

const item = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Test",
  host: "example.com",
  createdAtMs: 1,
};
function bridge(overrides: Partial<PlatformTransport> = {}): PlatformTransport {
  return {
    getVpnState: async () =>
      JSON.stringify({
        state: "disconnected",
        error: null,
        internetReachable: null,
      }),
    getSelectedNode: async () => "null",
    selectSubscriptionNode: async () => "null",
    getVpnDiagnostics: async () => "{}",
    startVpn: async () =>
      JSON.stringify({
        state: "connecting",
        error: null,
        internetReachable: null,
      }),
    stopVpn: async () =>
      JSON.stringify({
        state: "disconnected",
        error: null,
        internetReachable: null,
      }),
    getEnvironment: async () =>
      JSON.stringify({
        platform: "android",
        nativeVersion: 1,
        coreAvailable: false,
        vpnPermission: "required",
      }),
    prepareVpn: async () => false,
    listSubscriptions: async () => "[]",
    listSubscriptionNodes: async () => "null",
    refreshSubscription: async () => "null",
    importSubscription: async () => "null",
    startSubscriptionNode: async () => "{}",
    saveSubscription: async () => JSON.stringify(item),
    deleteSubscription: async () => {},
    ...overrides,
  };
}

test("rejects unsafe input before crossing the native boundary", async () => {
  let calls = 0;
  const client = createPlatformClient(
    bridge({
      saveSubscription: async () => {
        calls++;
        return "{}";
      },
    })
  );
  await assert.rejects(
    () => client.saveSubscription("Test", "http://example.com/?token=secret"),
    (e: unknown) => e instanceof PlatformError && e.code === "HTTPS_REQUIRED"
  );
  await assert.rejects(
    () => client.deleteSubscription(""),
    (e: unknown) =>
      e instanceof PlatformError && e.code === "INVALID_SUBSCRIPTION"
  );
  assert.equal(calls, 0);
});

test("native errors never expose subscription URLs or underlying exception text", () => {
  for (const error of [
    new Error("https://example.com/?token=secret"),
    { code: "STORAGE_UNAVAILABLE", message: "secret" },
    { code: "toString", message: "secret" },
  ]) {
    assert.equal(safePlatformError(error).message.includes("secret"), false);
  }
});

test("projects metadata and preserves signed URLs only in the save call", async () => {
  const url = "https://example.com/sub?token=a%2Bb&sign=%3D";
  const client = createPlatformClient(
    bridge({
      saveSubscription: async (name, sourceUrl) => {
        assert.equal(name, "Test");
        assert.equal(sourceUrl, url);
        return JSON.stringify({ ...item, sourceUrl: url });
      },
    })
  );
  assert.deepEqual(await client.saveSubscription(" Test ", ` ${url} `), item);
});

test("malformed, duplicate or incompatible native responses fail instead of clearing storage", async () => {
  for (const json of [
    "not json",
    "{}",
    "[null]",
    JSON.stringify([item, item]),
    JSON.stringify([{ ...item, createdAtMs: -1 }]),
  ]) {
    await assert.rejects(
      () =>
        createPlatformClient(
          bridge({ listSubscriptions: async () => json })
        ).listSubscriptions(),
      (e: unknown) =>
        e instanceof PlatformError && e.code === "INVALID_NATIVE_RESPONSE"
    );
  }
  await assert.rejects(
    () =>
      createPlatformClient(
        bridge({
          getEnvironment: async () => JSON.stringify({ nativeVersion: 2 }),
        })
      ).getEnvironment(),
    (e: unknown) =>
      e instanceof PlatformError && e.code === "INVALID_NATIVE_RESPONSE"
  );
});

test("permission denial stays false and never claims the core exists", async () => {
  const client = createPlatformClient(bridge());
  assert.equal(await client.prepareVpn(), false);
  assert.equal((await client.getEnvironment()).coreAvailable, false);
  await assert.rejects(
    () => createPlatformClient(null).listSubscriptions(),
    (e: unknown) =>
      e instanceof PlatformError && e.code === "NATIVE_UNAVAILABLE"
  );
});

test("a linked engine is reported separately from a working VPN tunnel", async () => {
  const core = {
    name: "sing-box",
    version: "1.14.4",
    bindingVersion: 1,
    ready: true,
    tunnelAvailable: false,
    protocols: ["shadowsocks", "trojan", "vless"],
  };
  const environment = {
    platform: "ios",
    nativeVersion: 1,
    coreAvailable: true,
    vpnPermission: "unsupported",
    core,
  };
  const result = await createPlatformClient(
    bridge({
      getEnvironment: async () => JSON.stringify(environment),
    })
  ).getEnvironment();
  assert.equal(result.coreAvailable, true);
  assert.equal(result.core?.tunnelAvailable, false);
  for (const invalid of [
    null,
    { ...core, version: "unknown" },
    { ...core, bindingVersion: 2 },
  ]) {
    await assert.rejects(
      () =>
        createPlatformClient(
          bridge({
            getEnvironment: async () =>
              JSON.stringify({ ...environment, core: invalid }),
          })
        ).getEnvironment(),
      (e: unknown) =>
        e instanceof PlatformError && e.code === "INVALID_NATIVE_RESPONSE"
    );
  }
});

test("tunnel readiness does not invent internet reachability and errors are projected", async () => {
  const client = createPlatformClient(
    bridge({
      getVpnState: async () =>
        JSON.stringify({
          state: "connected",
          error: null,
          internetReachable: null,
          profile: "secret",
        }),
    })
  );
  assert.deepEqual(await client.getVpnState(), {
    state: "connected",
    error: null,
    internetReachable: null,
  });
  await assert.rejects(() =>
    createPlatformClient(
      bridge({
        getVpnState: async () =>
          JSON.stringify({
            state: "ready",
            error: null,
            internetReachable: true,
          }),
      })
    ).getVpnState()
  );
  const failed = await createPlatformClient(
    bridge({
      getVpnState: async () =>
        JSON.stringify({
          state: "disconnected",
          error: "secret",
          internetReachable: null,
        }),
    })
  ).getVpnState();
  assert.equal(failed.error, "NATIVE_OPERATION_FAILED");
});

const nodeList = {
  revision: "a".repeat(64),
  updatedAtMs: 123,
  format: "clash",
  skipped: 1,
  nodes: [
    {
      id: "b".repeat(32),
      name: "Test",
      type: "shadowsocks",
      blockedReason: "",
      profile: { password: "secret" },
    },
  ],
};
test("subscription UI receives only metadata and native selection uses versioned IDs", async () => {
  let calls = 0;
  const client = createPlatformClient(
    bridge({
      listSubscriptionNodes: async () =>
        JSON.stringify({
          ...nodeList,
          sourceUrl: "https://example.com/secret",
        }),
      startSubscriptionNode: async (id, revision, nodeId) => {
        assert.equal(id, item.id);
        assert.equal(revision, nodeList.revision);
        assert.equal(nodeId, nodeList.nodes[0].id);
        calls++;
        return JSON.stringify({
          state: "connected",
          error: null,
          internetReachable: null,
        });
      },
    })
  );
  const nodes = await client.listSubscriptionNodes(item.id);
  assert.equal(JSON.stringify(nodes).includes("secret"), false);
  assert.equal(nodes?.nodes.length, 1);
  await client.startSubscriptionNode(
    item.id,
    nodeList.revision,
    nodeList.nodes[0].id
  );
  await assert.rejects(() =>
    client.startSubscriptionNode(item.id, "bad", nodeList.nodes[0].id)
  );
  assert.equal(calls, 1);
});
test("invalid or stale subscription results do not appear as valid empty updates", async () => {
  for (const value of [
    null,
    { ...nodeList, nodes: [] },
    { ...nodeList, nodes: [nodeList.nodes[0], nodeList.nodes[0]] },
    { ...nodeList, skipped: -1 },
    { ...nodeList, nodes: [{ ...nodeList.nodes[0], blockedReason: "secret" }] },
  ]) {
    await assert.rejects(() =>
      createPlatformClient(
        bridge({ refreshSubscription: async () => JSON.stringify(value) })
      ).refreshSubscription(item.id)
    );
  }
  assert.equal(
    await createPlatformClient(bridge()).listSubscriptionNodes(item.id),
    null
  );
  await assert.rejects(
    () =>
      createPlatformClient(
        bridge({
          startSubscriptionNode: async () => {
            throw { code: "STALE_SUBSCRIPTION", message: "secret" };
          },
        })
      ).startSubscriptionNode(item.id, nodeList.revision, nodeList.nodes[0].id),
    (e: unknown) =>
      e instanceof PlatformError &&
      e.code === "STALE_SUBSCRIPTION" &&
      !e.message.includes("secret")
  );
});

for (const type of ["hysteria2", "anytls"]) {
  test(`${type} metadata is accepted without exposing credentials`, async () => {
    const value = {
      ...nodeList,
      nodes: [
        {
          ...nodeList.nodes[0],
          type,
          profile: {
            password: "secret",
            obfs: { password: "secret" },
            certificate_sha256: "secret",
          },
        },
      ],
    };
    const client = createPlatformClient(
      bridge({ listSubscriptionNodes: async () => JSON.stringify(value) })
    );
    const result = await client.listSubscriptionNodes(item.id);
    assert.equal(result?.nodes[0].type, type);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  });
}

test("diagnostics expose only bounded counters and fixed error codes", async () => {
  const report = { proxyHTTPS: false, proxyError: "TLS", systemHTTPS: false, systemError: "TIMEOUT", includeAllNetworks: true, packetsIn: 10, packetsOut: 4, packetsInDelta: 6, packetsOutDelta: 2 };
  const client = createPlatformClient(bridge({ getVpnDiagnostics: async () => JSON.stringify({ ...report, server: "secret", password: "secret" }) }));
  assert.deepEqual(await client.getVpnDiagnostics(), { ...report, networkAvailable: null, networkPaused: null, endpointDNS: "NOT_RUN", endpointTCP: "NOT_RUN", proxyHandshake: "NOT_RUN", targetTLS: "NOT_RUN", errorTrace: "" });
  for (const change of [{ networkAvailable: 1 }, { networkPaused: "false" }, { endpointTCP: "secret" }, { errorTrace: "https://private.example/password" }, { errorTrace: "a".repeat(201) }, { proxyError: "secret" }, { packetsIn: -1 }, { packetsOut: Number.MAX_SAFE_INTEGER + 1 }, { systemHTTPS: "true" }, { includeAllNetworks: null }]) {
    const invalid = createPlatformClient(bridge({ getVpnDiagnostics: async () => JSON.stringify({ ...report, ...change }) }));
    await assert.rejects(() => invalid.getVpnDiagnostics(), (e: unknown) => e instanceof PlatformError && e.code === "INVALID_NATIVE_RESPONSE");
  }
});


test("staged diagnostics preserve safe types and categories", async () => {
  const report = {networkAvailable:true, networkPaused:false, proxyHTTPS:false, proxyError:"DNS", systemHTTPS:false, systemError:"TIMEOUT", includeAllNetworks:true, packetsIn:0, packetsOut:0, packetsInDelta:0, packetsOutDelta:0, endpointDNS:"DNS", endpointTCP:"NOT_RUN", proxyHandshake:"NOT_RUN", targetTLS:"NOT_RUN", errorTrace:"*fmt.wrapError > dns-rcode:3"};
  const client = createPlatformClient(bridge({getVpnDiagnostics: async () => JSON.stringify(report)}));
  assert.deepEqual(await client.getVpnDiagnostics(), report);
});

test("persisted selection is validated and projected without node credentials", async () => {
  const selection = { subscriptionId: item.id, revision: 'a'.repeat(64), nodeId: 'b'.repeat(32), name: 'Saved node' };
  let selected = 'null';
  const client = createPlatformClient(bridge({
    getSelectedNode: async () => selected,
    selectSubscriptionNode: async (id, revision, nodeId) => {
      assert.deepEqual([id, revision, nodeId], [selection.subscriptionId, selection.revision, selection.nodeId]);
      selected = JSON.stringify({ ...selection, password: 'secret', profile: 'private' });
      return selected;
    },
    getVpnState: async () => JSON.stringify({ state: 'connected', error: null, internetReachable: null, connectionName: 'Actually running node' }),
  }));
  assert.equal(await client.getSelectedNode(), null);
  assert.deepEqual(await client.selectSubscriptionNode(item.id, selection.revision, selection.nodeId), selection);
  assert.deepEqual(await client.getSelectedNode(), selection);
  // The active connection must never be relabelled using the next selection.
  assert.equal((await client.getVpnState()).connectionName, 'Actually running node');
  await assert.rejects(() => client.selectSubscriptionNode(item.id, 'invalid', selection.nodeId), { code: 'INVALID_NODE' });
  selected = JSON.stringify({ ...selection, name: 'bad\nname' });
  await assert.rejects(() => client.getSelectedNode(), { code: 'INVALID_NATIVE_RESPONSE' });
});
