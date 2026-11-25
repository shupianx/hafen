# 订阅导入与节点连接

当前实现支持手动更新 HTTPS 订阅、粘贴配置、加密保存节点、查看节点和选择连接。
Android 已用本机测试节点和用户授权的真实订阅验证系统 VPN 转发；iOS 支持下载和节点管理，VPN 仍需签名真机验收。

## 使用

1. 点击「订阅」右侧的 **＋**，在底部卡片填写名称与 HTTPS 链接，点击“添加”。拖动卡片顶部向下、点击遮罩或关闭按钮均可收起；未保存的输入在本次运行中保留。
2. 新订阅会自动展开，点击“更新节点”；也可以在该面板粘贴配置导入。点击订阅名称可展开或收起节点列表。
3. 选择可用节点，点击首页顶部开关，允许系统 VPN 配置；再次点击开关断开。
4. 切换节点前先断开。收起列表不清除当前选择；下载更新只替换本地缓存，不改变已经运行的连接。

节点列表显示节点数量、协议和跳过条目数量。更新失败保留上次有效节点；尚未导入过则保持无节点。
更新、删除、连接读取由原生存储队列串行处理；连接携带订阅 ID、内容版本和节点 ID，过期版本会被拒绝。
应用重启后节点保留，当前列表选择不持久化；不自动连接。删除订阅同时删除本地节点，已有隧道需单独断开。

## 支持范围

| 格式 | 当前支持 |
| --- | --- |
| Clash / mihomo YAML | 只读取 `proxies` 内的受限节点；也可读取 proxy-provider 的内联节点文件 |
| sing-box JSON | 只读取 `outbounds` 内的受限节点 |
| URI 列表 | SS、Trojan、VLESS、AnyTLS、Hysteria2（含 hy2 别名），每行一个；接受整个列表的标准或 URL-safe Base64 |
| SS 链接 | SIP002 userinfo Base64 / 百分号编码，以及旧式整段 Base64 |

协议子集：

- Shadowsocks：aes-128-gcm、aes-256-gcm、chacha20-ietf-poly1305；无插件。
- Trojan：TCP + TLS、WS + TLS、gRPC + TLS，可指定 SNI、ALPN、受支持的 uTLS 指纹。
- VLESS：明确启用 TLS 的 TCP、WS、gRPC；TCP 支持 xtls-rprx-vision 和 Reality（公钥、short ID、SNI、uTLS）。
- WS：path、自定义 headers、有限 early data；gRPC：service_name，使用上游 lite 实现。
- Reality 当前限 VLESS TCP；Vision 不与 WS/gRPC 组合。仍不支持 multiplex、明文 VLESS、插件、SS2022、TUIC。
- AnyTLS 使用密码认证并验证 TLS 证书。分享链接示例为 `anytls://demo%40pass@proxy.example/?sni=tls.example#Demo`，端口默认 443。分享链接支持 `type=tcp`、已支持的 `fp` 指纹和空的 `pcs`。Clash 和 sing-box 格式也支持 ALPN 及现有的 uTLS 指纹。空闲会话使用内核默认值，带自定义会话参数的节点会被跳过。
- Hysteria2：TLS + QUIC，密码 / userpass、SNI、h3 ALPN、Salamander 混淆、整数 Mbps 带宽（0–10000；省略时采用上游默认拥塞控制）。
- Hysteria2 端口跳跃：URI 的 `mport`、Clash 的 `ports`、sing-box 的 `server_ports`；最多 16 段，端口 1–65535。可选固定跳跃间隔 5–3600 秒，默认由上游处理。URI 省略端口时使用 443，暂不接受 URI authority 中的多端口写法。
- Hysteria2 证书固定：URI `pinSHA256`、Clash `fingerprint` 按整个叶证书 SHA-256 校验，并保留系统证书链、域名与有效期验证；不把整证书哈希误映射成 sing-box 的公钥哈希。自签名证书不会仅凭指纹被接受。
- Hysteria2 暂不导入 Gecko、ECH、Realm、自定义证书/公钥哈希或 QUIC 高级调参；有这些有效字段的节点会被跳过。

节点字段采用允许列表；未知参数、插件、跳过证书验证、禁用 UDP 等不受支持的设置会使整个节点被跳过，
不会删除字段后假装兼容。混合订阅可以导入支持的节点；重复节点也计入跳过数量。全部不支持则整次更新失败。
Trojan/VLESS URI 兼容导出器的已知无效默认字段：`insecure` / `allowInsecure` 仅接受空值、`0`、`false`；
`headerType` / `quicSecurity` 仅接受空值或 `none`；`pcs` 仅接受空值。
空的 `host`、`path`、`serviceName`、`mode`、`ed`、`eh` 按未配置处理；重复参数、未知字段和有实际含义的不支持值仍拒绝。
导入通过内核配置构造校验，不代表服务端连通；本机真实 TCP 回显已验证上述 TLS/传输组合；不代表所有服务商参数均已兼容。

**已支持服务器域名或 IP。** iOS 构建 8 起，节点域名在安装 VPN 路由前通过系统 DNS 解析，最多 5 秒；系统 DNS 不保证加密。结果仅在本次连接内存中使用，重连重新解析，不改写订阅或 TLS/REALITY 的服务器名称。
Android 仍使用受保护的 Cloudflare bootstrap DoH（1.1.1.1:443）。两端业务网站的 DNS 都经所选代理到 remote DoH，无业务 DNS 直连回退；目前没有自定义解析服务设置。
旧版保存的域名节点会自动解除限制，无需重新添加订阅。
不导入订阅中的规则、DNS、策略组、入站监听、控制 API、脚本、本地路径或远程 provider；不会请求其引用资源。
provider URL 不会递归展开；需要提供直接含节点的内容。配额、到期时间、自动更新、ETag 和订阅编辑暂未实现。

Hysteria2 字段依据：[官方 URI 规范](https://v2.hysteria.network/docs/developers/URI-Scheme/)、[Mihomo 配置](https://wiki.metacubex.one/config/proxies/hysteria2/)、[sing-box 配置](https://sing-box.sagernet.org/configuration/outbound/hysteria2/)。具体接入范围以上表为准。

## 下载、解析与存储

- Go 原生下载器：20 秒总网络超时、最多 3 次重定向，每次都要求 HTTPS；验证系统证书。
- 无 cookie jar、自定义认证头或第三方转换服务；URL 查询令牌仅用于用户保存的订阅请求。
- 网络走应用当前系统路由；VPN 开启时不另外配置绕过代理的下载通道。未提供下载取消按钮；超时自动结束。
- 响应最多 512 KiB（包括自动解压后的限制）、响应头最多 32 KiB；每份配置最多 256 条节点记录。
- YAML 固定 `go.yaml.in/yaml/v3 v3.0.6`，只解析数据；拒绝别名/锚点、合并键、重复键、多文档，限制深度和 AST 节点数。
- Android Keystore AES-GCM + AtomicFile；iOS Keychain 原子更新单条记录。整个订阅库限制约 2 MB；超限保留旧数据。
- 下载原文不落盘，只保存提取并校验后的节点与内容哈希。凭据留在原生存储，JS 节点列表只收到名称、类型、ID、受限原因。
- 手动粘贴内容暂存在输入框，成功后清空；手动输入和粘贴本身会经过 JS，不能据此声称 JS 从未接触任何凭据。
- 不把底层 HTTP、解析或 TLS 异常文本传到 UI，只传固定错误码；不输出 URL 令牌、密码或节点配置。

## 验证入口

`npm test`、`npm run typecheck`、`npm run lint`、`npm run core:test`。

连接 Metro 8093 的 Debug 应用可运行：

```sh
npm run subscription:smoke -- seed
# 重启宿主应用之后：
npm run subscription:smoke -- verify
npm run subscription:smoke -- download
```

`seed` 创建虚构订阅，测试导入/失败保留/旧版本拒绝/域名节点可选；`verify` 验证重启持久化并删除测试数据。
可用 HAFEN_TEST_APP=com.hafen 或 org.reactjs.native.example.Hafen 限定平台。
`download` 读取 mihomo 官方公开示例配置，仅验证下载和解析，不连接其中的节点，结束即删除测试记录。
外部示例可能变化，跳过数量不是固定契约。

Android 转发复现沿用 [系统隧道 fixture](vpn-prototype.md)：启动有界本机 SS 服务后，
设置 HAFEN_TEST_PROFILE 指向临时 JSON，执行 `subscription:smoke -- connect`，通过实际 TUN 检查回显，
最后执行 `subscription:smoke -- disconnect` 断开并删除测试订阅。connect 会真实启动系统 VPN，不能用真实用户配置替代测试 fixture。

规范参考：[Shadowsocks SIP002](https://shadowsocks.org/doc/sip002.html)、
[mihomo SS 字段](https://wiki.metacubex.one/en/config/proxies/ss/)、
[sing-box Shadowsocks 出站](https://sing-box.sagernet.org/configuration/outbound/shadowsocks/)、
[官方 Go YAML 文档](https://pkg.go.dev/go.yaml.in/yaml/v3)。

## 扩展字段映射

| 输入 | 关键映射 |
| --- | --- |
| Clash | network=ws/grpc；ws-opts 的 path/headers/max-early-data/early-data-header-name；grpc-opts.grpc-service-name；client-fingerprint、alpn、flow、reality-opts.public-key/short-id |
| sing-box | transport.type/path/headers/max_early_data/early_data_header_name/service_name；tls.server_name/alpn/utls/reality；flow |
| URI | type=tcp/ws/grpc；security=tls/reality；sni、fp、alpn、flow、pbk、sid、path、host、serviceName；WS 的 ed/eh；gRPC mode 仅 gun |

字段类型、嵌套未知字段、非法 Reality 公钥/short ID、重复大小写 HTTP 头、换行注入均会拒绝；
不把不支持参数悄悄删除。未列出的参数（例如 Reality spx、gRPC multi 模式、额外证书路径）仍不支持。
规范与固定版本源码参考：[TLS](https://sing-box.sagernet.org/configuration/shared/tls/)、
[V2Ray transport](https://sing-box.sagernet.org/configuration/shared/v2ray-transport/)、
[出站域名解析](https://sing-box.sagernet.org/configuration/shared/dial/)。

域名 / Reality 模拟器验证还可使用 `core/mobile/reality_fixture_test.go`：显式设置 HAFEN_REALITY_FIXTURE，
运行 TestRealityFixture；五分钟后自动停止。它生成兼容 `subscription:smoke -- connect` 的临时 profile，
只允许 198.18.0.1:29392 回显与 1.1.1.1:443 DoH，测试结束须执行 disconnect 并停止 fixture。
Go 测试与 fixture 编译都需 with_gvisor,with_utls,with_quic 标签。
