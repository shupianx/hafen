import { validateSubscriptionInput } from "./subscription.ts";

export interface SubscriptionSummary {
  id: string;
  name: string;
  host: string;
  createdAtMs: number;
}

export interface SubscriptionNodes {
  revision: string;
  updatedAtMs: number;
  format: "clash" | "sing-box" | "uri";
  skipped: number;
  nodes: {
    id: string;
    name: string;
    type: "shadowsocks" | "trojan" | "vless" | "hysteria2";
    blockedReason: "" | "NUMERIC_ENDPOINT_REQUIRED";
  }[];
}

export interface PlatformEnvironment {
  platform: "android" | "ios";
  nativeVersion: 1;
  coreAvailable: boolean;
  vpnAvailable: boolean;
  core: CoreInfo | null;
  vpnPermission: "granted" | "required" | "unsupported";
}

export interface CoreInfo {
  name: "sing-box";
  version: string;
  bindingVersion: 1;
  ready: boolean;
  tunnelAvailable: boolean;
  protocols: string[];
}

export interface TunnelState {
  state: "disconnected" | "connecting" | "connected" | "disconnecting";
  error: PlatformErrorCode | null;
  internetReachable: boolean | null;
}

const probeErrors = ["NONE", "DNS", "TLS", "TIMEOUT", "CONNECT", "HTTP", "CLOSED", "BUSY", "UNAVAILABLE", "PROTECTION", "REALITY", "REFUSED", "RESET", "UNREACHABLE", "EOF", "TLS_HANDSHAKE"] as const;
const probeStages = [...probeErrors, "IP", "SKIPPED", "NOT_RUN"] as const;
export interface TunnelDiagnostics {
  networkAvailable: boolean | null;
  networkPaused: boolean | null;
  endpointDNS: typeof probeStages[number];
  endpointTCP: typeof probeStages[number];
  proxyHandshake: typeof probeStages[number];
  targetTLS: typeof probeStages[number];
  errorTrace: string;
  proxyHTTPS: boolean | null;
  proxyError: typeof probeErrors[number];
  systemHTTPS: boolean | null;
  systemError: typeof probeErrors[number];
  includeAllNetworks: boolean;
  packetsIn: number | null;
  packetsOut: number | null;
  packetsInDelta: number | null;
  packetsOutDelta: number | null;
}

export interface PlatformTransport {
  startVpn(profile: string): Promise<string>;
  stopVpn(): Promise<string>;
  getVpnState(): Promise<string>;
  getVpnDiagnostics(): Promise<string>;
  getEnvironment(): Promise<string>;
  prepareVpn(): Promise<boolean>;
  listSubscriptions(): Promise<string>;
  listSubscriptionNodes(id: string): Promise<string>;
  refreshSubscription(id: string): Promise<string>;
  importSubscription(id: string, content: string): Promise<string>;
  startSubscriptionNode(
    id: string,
    revision: string,
    nodeId: string
  ): Promise<string>;
  saveSubscription(name: string, sourceUrl: string): Promise<string>;
  deleteSubscription(id: string): Promise<void>;
}

export const platformErrorMessages = {
  INVALID_SUBSCRIPTION_CONTENT:
    "无法识别配置，或包含重复字段、YAML 别名等不支持的内容。",
  SUBSCRIPTION_DOWNLOAD_FAILED:
    "下载失败，请检查网络、HTTPS 证书或订阅链接。旧节点已保留。",
  SUBSCRIPTION_TIMEOUT: "下载超过 20 秒，请稍后重试。旧节点已保留。",
  SUBSCRIPTION_HTTP_ERROR:
    "订阅服务未返回有效内容，请检查链接是否到期。旧节点已保留。",
  SUBSCRIPTION_TOO_LARGE: "订阅超过 512 KiB 限制，旧节点已保留。",
  SUBSCRIPTION_NODE_LIMIT: "每个订阅最多支持 256 个节点，请使用较小的订阅。",
  SUBSCRIPTION_STORAGE_LIMIT:
    "安全存储容量已满，请删除不需要的订阅。旧节点已保留。",
  NO_SUPPORTED_NODES:
    "没有找到支持的节点。支持 SS AEAD、Trojan/VLESS TLS、WS、gRPC，VLESS Reality/Vision，以及 Hysteria2 的受限参数。未知参数仍会跳过。旧节点已保留。",
  STALE_SUBSCRIPTION: "订阅已更新，请重新查看节点后连接。",
  INVALID_NODE: "节点不存在，请重新查看订阅。",
  NATIVE_UNAVAILABLE: "当前安装包尚未包含原生模块，请重新构建应用。",
  NATIVE_OPERATION_FAILED: "系统操作失败，请重试。",
  INVALID_NATIVE_RESPONSE: "原生模块返回了不兼容的数据，请更新应用。",
  STORAGE_UNAVAILABLE:
    "无法读取安全存储。请解锁设备后重试；已有数据不会被重置。",
  INVALID_NAME: "请输入 1–64 个字符的订阅名称。",
  INVALID_URL: "请输入完整、有效的订阅链接。",
  HTTPS_REQUIRED: "请使用 HTTPS 订阅链接。",
  URL_CREDENTIALS_NOT_ALLOWED: "订阅链接不能包含用户名和密码。",
  URL_FRAGMENT_NOT_ALLOWED: "请移除链接中的 # 片段。",
  DUPLICATE_SUBSCRIPTION: "这个订阅链接已经保存。",
  SUBSCRIPTION_LIMIT: "最多可保存 50 个订阅，请先删除不需要的订阅。",
  INVALID_SUBSCRIPTION: "订阅不存在或标识无效，请刷新列表。",
  OPERATION_IN_PROGRESS: "请先完成当前系统操作。",
  ACTIVITY_UNAVAILABLE: "请回到应用前台后重试。",
  VPN_UNAVAILABLE: "当前环境不能启动 VPN；iOS 需要签名后的真机版本。",
  VPN_PERMISSION_REQUIRED: "请先允许系统 VPN 配置。",
  VPN_NOT_CONNECTED: "请先连接 VPN，再检查连接。",
  VPN_DIAGNOSTICS_UNAVAILABLE: "当前平台暂不支持连接检测。",
  VPN_PERMISSION_REVOKED: "系统已撤销 VPN 授权。",
  TUNNEL_START_FAILED: "隧道启动失败，请检查节点与系统配置。",
  TUNNEL_START_TIMEOUT: "隧道启动超时，已取消连接。",
  TUNNEL_STOP_FAILED: "断开失败，请在系统 VPN 设置中检查状态。",
  TUNNEL_CANCELLED: "连接已取消。",
  TUNNEL_IO_FAILED: "隧道数据传输中断，连接已关闭。",
  NETWORK_CHANGED: "底层网络已断开，请在网络恢复后重新连接。",
  NETWORK_UNAVAILABLE: "没有可用的网络连接。",
  NUMERIC_ENDPOINT_REQUIRED:
    "当前版本需要填写节点的 IP 地址，暂不支持服务器域名。",
  ENDPOINT_DNS_FAILED: "节点域名解析失败，请检查当前网络后重新连接。",
  CORE_START_FAILED: "代理引擎启动失败，请检查节点配置。",
  INVALID_CORE_PROFILE: "节点参数无效或包含当前不支持的配置。",
  UNSUPPORTED_CORE_PROTOCOL: "当前内核适配版本尚未启用这个协议。",
  CORE_CONFIGURATION_FAILED: "内核无法加载节点配置，请检查参数。",
  CORE_SELF_TEST_FAILED: "代理引擎自检失败，请重新启动应用后重试。",
  CORE_CLOSE_FAILED: "代理引擎清理失败，请重新启动应用。",
} as const;

export type PlatformErrorCode = keyof typeof platformErrorMessages;

export class PlatformError extends Error {
  readonly code: PlatformErrorCode;
  constructor(code: PlatformErrorCode) {
    super(platformErrorMessages[code]);
    this.name = "PlatformError";
    this.code = code;
  }
}

/** Never render raw native errors: they may contain a URL or a filesystem path. */
export function safePlatformError(error: unknown): PlatformError {
  if (error instanceof PlatformError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;
  if (
    typeof code === "string" &&
    Object.prototype.hasOwnProperty.call(platformErrorMessages, code)
  ) {
    return new PlatformError(code as PlatformErrorCode);
  }
  return new PlatformError("NATIVE_OPERATION_FAILED");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new PlatformError("INVALID_NATIVE_RESPONSE");
  return value as Record<string, unknown>;
}

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new PlatformError("INVALID_NATIVE_RESPONSE");
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function coreInfo(value: unknown): CoreInfo | null {
  if (value == null) return null;
  const data = object(value);
  if (
    data.name !== "sing-box" ||
    typeof data.version !== "string" ||
    !/^(?:\d+\.\d+\.\d+|unknown)$/.test(data.version) ||
    data.bindingVersion !== 1 ||
    typeof data.ready !== "boolean" ||
    typeof data.tunnelAvailable !== "boolean" ||
    !Array.isArray(data.protocols) ||
    !data.protocols.every(
      (p) => typeof p === "string" && /^[a-z0-9-]{1,32}$/.test(p)
    ) ||
    data.protocols.length > 32 ||
    (data.ready && data.version === "unknown")
  )
    throw new PlatformError("INVALID_NATIVE_RESPONSE");
  return {
    name: "sing-box",
    version: data.version,
    bindingVersion: 1,
    ready: data.ready,
    tunnelAvailable: data.tunnelAvailable,
    protocols: [...data.protocols] as string[],
  };
}

function summary(value: unknown): SubscriptionSummary {
  const data = object(value);
  if (
    typeof data.id !== "string" ||
    !uuid.test(data.id) ||
    typeof data.name !== "string" ||
    !data.name.length ||
    data.name.length > 64 ||
    typeof data.host !== "string" ||
    !data.host.length ||
    data.host.length > 255 ||
    typeof data.createdAtMs !== "number" ||
    !Number.isSafeInteger(data.createdAtMs) ||
    data.createdAtMs < 0
  ) {
    throw new PlatformError("INVALID_NATIVE_RESPONSE");
  }
  // Explicit projection: secrets or additional native fields never reach UI state.
  return {
    id: data.id,
    name: data.name,
    host: data.host,
    createdAtMs: data.createdAtMs,
  };
}

export function parseTunnelState(json: string): TunnelState {
  const value = object(parse(json));
  if (
    !["disconnected", "connecting", "connected", "disconnecting"].includes(
      String(value.state)
    ) ||
    (value.internetReachable !== null &&
      typeof value.internetReachable !== "boolean") ||
    (value.error !== null && typeof value.error !== "string")
  )
    throw new PlatformError("INVALID_NATIVE_RESPONSE");
  return {
    state: value.state as TunnelState["state"],
    internetReachable: value.internetReachable as boolean | null,
    error:
      value.error === null
        ? null
        : safePlatformError({ code: value.error }).code,
  };
}

export function parseTunnelDiagnostics(json: string): TunnelDiagnostics {
  const value = object(parse(json));
  const result: Record<string, unknown> = {};
  for (const key of ["proxyHTTPS", "systemHTTPS"] as const) {
    if (value[key] !== null && typeof value[key] !== "boolean") throw new PlatformError("INVALID_NATIVE_RESPONSE");
    result[key] = value[key];
  }
  for (const key of ["proxyError", "systemError"] as const) {
    if (!probeErrors.includes(value[key] as TunnelDiagnostics["proxyError"])) throw new PlatformError("INVALID_NATIVE_RESPONSE");
    result[key] = value[key];
  }
  for (const key of ["endpointDNS", "endpointTCP", "proxyHandshake", "targetTLS"] as const) {
    const stage = value[key] ?? "NOT_RUN";
    if (!probeStages.includes(stage as TunnelDiagnostics["endpointDNS"])) throw new PlatformError("INVALID_NATIVE_RESPONSE");
    result[key] = stage;
  }
  for (const key of ["networkAvailable", "networkPaused"] as const) {
    const state = value[key] ?? null;
    if (state !== null && typeof state !== "boolean") throw new PlatformError("INVALID_NATIVE_RESPONSE");
    result[key] = state;
  }
  const trace = value.errorTrace ?? "";
  if (typeof trace !== "string" || trace.length > 200 || !/^[a-zA-Z0-9_.*: >\[\]-]*$/.test(trace)) throw new PlatformError("INVALID_NATIVE_RESPONSE");
  result.errorTrace = trace;
  for (const key of ["packetsIn", "packetsOut", "packetsInDelta", "packetsOutDelta"] as const) {
    const count = value[key];
    if (count !== null && (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)) throw new PlatformError("INVALID_NATIVE_RESPONSE");
    result[key] = count;
  }
  if (typeof value.includeAllNetworks !== "boolean") throw new PlatformError("INVALID_NATIVE_RESPONSE");
  result.includeAllNetworks = value.includeAllNetworks;
  return result as unknown as TunnelDiagnostics;
}

export function parseSubscriptionNodes(json: string): SubscriptionNodes | null {
  const parsed = parse(json);
  if (parsed === null) return null;
  const value = object(parsed);
  if (
    typeof value.revision !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.revision) ||
    typeof value.updatedAtMs !== "number" ||
    !Number.isSafeInteger(value.updatedAtMs) ||
    value.updatedAtMs < 0 ||
    !["clash", "sing-box", "uri"].includes(String(value.format)) ||
    typeof value.skipped !== "number" ||
    !Number.isInteger(value.skipped) ||
    value.skipped < 0 ||
    value.skipped > 256 ||
    !Array.isArray(value.nodes) ||
    value.nodes.length < 1 ||
    value.nodes.length > 256
  )
    throw new PlatformError("INVALID_NATIVE_RESPONSE");
  const nodes = value.nodes.map((raw) => {
    const node = object(raw);
    if (
      typeof node.id !== "string" ||
      !/^[a-f0-9]{32}$/.test(node.id) ||
      typeof node.name !== "string" ||
      !node.name ||
      [...node.name].length > 128 ||
      /[\p{Cc}\p{Cf}]/u.test(node.name) ||
      !["shadowsocks", "trojan", "vless", "hysteria2"].includes(
        String(node.type)
      ) ||
      !["", "NUMERIC_ENDPOINT_REQUIRED"].includes(String(node.blockedReason))
    )
      throw new PlatformError("INVALID_NATIVE_RESPONSE");
    return {
      id: node.id,
      name: node.name,
      type: node.type as SubscriptionNodes["nodes"][number]["type"],
      blockedReason: node.blockedReason as "" | "NUMERIC_ENDPOINT_REQUIRED",
    };
  });
  if (new Set(nodes.map((n) => n.id)).size !== nodes.length)
    throw new PlatformError("INVALID_NATIVE_RESPONSE");
  return {
    revision: value.revision,
    updatedAtMs: value.updatedAtMs,
    format: value.format as SubscriptionNodes["format"],
    skipped: value.skipped,
    nodes,
  };
}

export function createPlatformClient(transport: PlatformTransport | null) {
  function native(): PlatformTransport {
    if (!transport) throw new PlatformError("NATIVE_UNAVAILABLE");
    return transport;
  }
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw safePlatformError(error);
    }
  }
  function subscriptionID(id: string) {
    if (!uuid.test(id)) throw new PlatformError("INVALID_SUBSCRIPTION");
  }
  return {
    listSubscriptionNodes: (id: string) =>
      call(async () => {
        subscriptionID(id);
        return parseSubscriptionNodes(await native().listSubscriptionNodes(id));
      }),
    refreshSubscription: (id: string) =>
      call(async () => {
        subscriptionID(id);
        const result = parseSubscriptionNodes(
          await native().refreshSubscription(id)
        );
        if (!result) throw new PlatformError("INVALID_NATIVE_RESPONSE");
        return result;
      }),
    importSubscription: (id: string, content: string) =>
      call(async () => {
        subscriptionID(id);
        if (!content.trim() || content.length > 524288)
          throw new PlatformError("INVALID_SUBSCRIPTION_CONTENT");
        const result = parseSubscriptionNodes(
          await native().importSubscription(id, content)
        );
        if (!result) throw new PlatformError("INVALID_NATIVE_RESPONSE");
        return result;
      }),
    startSubscriptionNode: (id: string, revision: string, nodeId: string) =>
      call(async () => {
        subscriptionID(id);
        if (!/^[a-f0-9]{64}$/.test(revision) || !/^[a-f0-9]{32}$/.test(nodeId))
          throw new PlatformError("INVALID_NODE");
        return parseTunnelState(
          await native().startSubscriptionNode(id, revision, nodeId)
        );
      }),
    getVpnState: () =>
      call(async () => parseTunnelState(await native().getVpnState())),
    getVpnDiagnostics: () =>
      call(async () => parseTunnelDiagnostics(await native().getVpnDiagnostics())),
    stopVpn: () => call(async () => parseTunnelState(await native().stopVpn())),
    startVpn: (profile: string) =>
      call(async () => {
        if (!profile || profile.length > 16384)
          throw new PlatformError("INVALID_CORE_PROFILE");
        return parseTunnelState(await native().startVpn(profile));
      }),
    getEnvironment: () =>
      call(async (): Promise<PlatformEnvironment> => {
        const data = object(parse(await native().getEnvironment()));
        if (
          (data.platform !== "android" && data.platform !== "ios") ||
          data.nativeVersion !== 1 ||
          typeof data.coreAvailable !== "boolean" ||
          !["granted", "required", "unsupported"].includes(
            String(data.vpnPermission)
          )
        ) {
          throw new PlatformError("INVALID_NATIVE_RESPONSE");
        }
        const core = coreInfo(data.core);
        if (data.coreAvailable !== (core?.ready ?? false)) {
          throw new PlatformError("INVALID_NATIVE_RESPONSE");
        }
        return {
          platform: data.platform,
          nativeVersion: 1,
          coreAvailable: data.coreAvailable,
          vpnAvailable: data.vpnAvailable === true,
          core,
          vpnPermission:
            data.vpnPermission as PlatformEnvironment["vpnPermission"],
        };
      }),
    listSubscriptions: () =>
      call(async () => {
        const values = parse(await native().listSubscriptions());
        if (!Array.isArray(values) || values.length > 50)
          throw new PlatformError("INVALID_NATIVE_RESPONSE");
        const records = values.map(summary);
        if (new Set(records.map((record) => record.id)).size !== records.length)
          throw new PlatformError("INVALID_NATIVE_RESPONSE");
        return records.sort((a, b) => b.createdAtMs - a.createdAtMs);
      }),
    saveSubscription: (name: string, sourceUrl: string) =>
      call(async () => {
        const validated = validateSubscriptionInput({ name, sourceUrl });
        if (!validated.ok) throw new PlatformError(validated.error);
        const { value } = validated;
        return summary(
          parse(await native().saveSubscription(value.name, value.sourceUrl))
        );
      }),
    deleteSubscription: (id: string) =>
      call(async () => {
        if (!uuid.test(id)) throw new PlatformError("INVALID_SUBSCRIPTION");
        await native().deleteSubscription(id);
      }),
    prepareVpn: () =>
      call(async () => {
        const granted = await native().prepareVpn();
        if (typeof granted !== "boolean")
          throw new PlatformError("INVALID_NATIVE_RESPONSE");
        return granted;
      }),
  };
}
