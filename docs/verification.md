# 构建与验证记录

记录日期：2026-11-16。按阶段保留验证证据；不能作为双端真机或正式发行验收。

## UI 线程动画与 ProMotion（2026-11-16，构建 2）

- 核对构建 1 的实际归档：`CADisableMinimumFrameDurationOnPhone=true` 已存在；不能将用户的流畅度反馈归因为缺少该开关，也没有测得全局 60Hz 锁定。
- 添加订阅卡片从 RN Animated / JS PanResponder 迁移到 Reanimated / 原生 Gesture Handler，位移、遮罩与回弹在 UI 线程执行。只在关闭时回到 JS 处理键盘和 Modal 状态。
- 固定 Reanimated 4.7.1、Worklets 0.13.1、Gesture Handler 3.5.0，与 RN 0.88 兼容；上游 iOS 显示链接请求 120 fps，低刷新率设备和系统节能策略仍可降帧。未修改上游源码。
- VPN 状态轮询仅在 state/error/internetReachable 变化时更新 React 状态，避免状态相同仍每秒重渲染整个首页。
- TypeScript、ESLint、14 项领域/桥接测试通过；Android Preview、iOS 真机 Release 签名归档和 iOS Release 模拟器构建通过。
- Android 模拟器实际操作通过：短拖动回弹、下滑关闭、关闭按钮、遮罩、返回键、键盘输入和草稿保留；测试草稿已通过重启清理，没有保存测试订阅。
- iOS Release 模拟器正常渲染首页和读取 Keychain。首次无签名模拟器包出现 Keychain 权限错误，改用正常模拟器签名后恢复；真机归档始终保留正常签名。
- 构建 2 的 ProMotion 开关已核对仍为 true。尚未测得用户 iPhone 16 Pro 的实际呈现帧率，模拟器运行结果不能当作 120Hz 验收；需通过新 TestFlight 包对比滚动和卡片拖动。
- `0.1.0 (2)` 已上传 TestFlight Internal Only：Xcode 返回 `Upload succeeded` / `EXPORT SUCCEEDED`，退出码 0；上传结束时 Apple 状态为 processing。原有三个第三方预编译框架 dSYM 警告仍为非阻断项。

## TestFlight 内部测试上传（2026-11-16）

- Xcode 27.0，Release / generic iOS 真机架构，`0.1.0 (1)` 归档成功。
- 宿主 `com.coolab.hafen`、扩展 `com.coolab.hafen.PacketTunnel`，同一开发团队签名，描述文件包含 Packet Tunnel 权限；上传前 codesign 完整性验证通过。
- 包含约 1.3 MB 的离线 Hermes JS 包和 VPN 扩展；补齐 1024 × 1024 无透明通道 iOS 图标。
- 添加 `ios:archive` / `ios:upload` 命令，上传目标限定 TestFlight Internal Only，核对宿主/扩展标识、版本、JS 包与签名。
- 创建 App Store Connect 记录后重试成功：Xcode 返回 `Upload succeeded`、`Uploaded Hafen` 和 `EXPORT SUCCEEDED`，退出码 0。Apple 已接收 `0.1.0 (1)`，上传结束时状态为 processing；尚未确认处理完成、加密信息已通过或测试组已分配。
- 非阻断警告：预编译 React.framework、ReactNativeDependencies.framework、hermesvm.framework 缺少匹配 dSYM；上传成功，但这些第三方框架的崩溃堆栈可能无法完整符号化。
- 签名归档位于 `build/ios/Hafen-1.xcarchive`；不代表已验证 iOS 真机 VPN 转发。
- 操作流程见 [TestFlight 内部测试](testflight.md)。

## 首页与添加订阅交互

- 首页开关置顶，左上角 ＋ 打开底部卡片；精简说明文案，手动节点折叠展示。
- Android 模拟器实际操作验证：卡片顶部下滑、遮罩点击、返回键关闭；键盘弹出后输入框和添加按钮可见；虚构订阅保存后自动收起卡片并展开列表。
- 实际选择本机虚构 SS 节点，通过顶部开关启动系统 VPN，原生状态为 connected，开关呈选中态；再次点击后断开。此项只验证 UI 与隧道状态，不验证网络可达。
- iOS 模拟器确认新版首页正常渲染；模拟器显示 VPN 不可用，手势和 VPN 真机测试仍未完成。
- TypeScript、ESLint 与 14 项现有领域/桥接测试通过；Android Preview 构建通过，移除 Metro 端口映射后独立启动，实际点击 ＋ 与关闭按钮通过。原生内核未修改。
- 本轮虚构订阅已清理，Android 原生存储剩余 0 条，VPN 已断开。

## Hysteria2 接入验证

| 检查 | 结果与边界 |
| --- | --- |
| 应用检查 | 14 项领域/桥接测试、TypeScript、ESLint 通过；HY2 元数据可显示，凭据不进入节点列表 |
| Go 检查 | 18 项常规测试通过，2 项设备 fixture 默认跳过；保留 race 检测，原有 Vision 例外不变 |
| 订阅格式 | Hysteria2 / hy2 URI、Base64、Clash YAML、sing-box JSON；合成用例验证参数映射一致、默认端口、userpass、端口范围、整证书指纹与非法字段拒绝 |
| 实际 QUIC 转发 | 本机 plain、Salamander、整证书指纹、指纹 + Salamander、端口跳跃共 5 个组合通过 TCP/UDP 回显；端口跳跃后仍可转发，新 socket 再次经过保护 |
| 实际 IP 数据包 | 第二个 gVisor 栈模拟设备，通过生产 SubmitPacket / NextPacket → TUN → HY2（指纹 + Salamander）→ 回显服务，TCP/UDP 精确往返通过；socket 保护失败不转发 |
| 认证拒绝 | 错误证书指纹、未知 CA、错误域名、错误密码和 socket 保护失败均无法完成转发；不降级为忽略证书验证 |
| 真实订阅 | 双端原生下载与解析通过：65 条均可解析，去重后 60 个（46 个 VLESS、14 个 HY2），跳过 5 条重复项；16 条原始 HY2 均可独立解析 |
| 重启与清理 | 两端重启后恢复同版本 60 个节点、含 14 个 HY2；临时订阅已从两端删除 |
| 原生桥接 | 两端各 8 种配置构造检查通过，含 HY2；各 3 次原有加密回环自检通过 |
| 真实 HY2 网络限制 | Android 抽测 2 个节点，HTTPS 未成功，首个节点 DNS 无响应；主机对首个节点的握手检查超时，固定公共 QUIC 端点握手也失败。原因尚未确认，不能据此声称真实 HY2 节点已连通 |
| iOS 范围 | 宿主与 Packet Tunnel 扩展编译通过；原生下载、解析、存储验证通过，VPN 仍需签名真机验收 |
| 最终交付 | Android Debug / Preview、iOS 宿主和扩展最终构建通过；两端源码/二进制 manifest 哈希一致；Android Preview 移除 Metro 映射后正常启动 |
| 最终清理 | 本机临时订阅文件和两端测试记录已删除，源码未发现本次链接/令牌；Android 无残留 VPN 服务或 tun0 |

整证书指纹适配使用公开 TLS VerifyPeerCertificate 回调，保留系统 CA、域名和有效期验证；
不将 Hysteria 的整证书 SHA-256 误当作 sing-box 的公钥 SHA-256。未修改上游模块，协议仍由 sing-quic 实现。
端口跳跃测试的两个 UDP 前端转发到同一个 QUIC 服务，验证迁移后的数据和新 socket 保护。
测试中的本机 CA 仅注入测试配置，不在生产 profile 接口或安装包中加入信任例外。
新增依赖从官方 Go 代理恢复并经 Go 模块校验；`core/tools.go` 保留固定 gomobile 支持包，避免 tidy 删除绑定工具依赖。
没有进行真实节点测速、长时间运行或切网测试；只记录计数和固定错误类别，不记录订阅链接、凭据、地址或出口 IP。

## 用户授权的真实订阅验证（上一阶段）

只记录统计与结果，不保存订阅 URL、令牌、节点名称、服务端地址、凭据或出口 IP。

| 检查 | 结果与边界 |
| --- | --- |
| 真实格式 | Base64 包装 URI 列表，共 65 条：49 条 VLESS、16 条 Hysteria2 |
| 双端下载解析 | Android / iOS 原生 HTTPS 下载成功；49 条 VLESS 均可解析，去重后 46 个；跳过 3 条重复项和 16 条尚未接入的 Hysteria2 |
| 修复 | 兼容 URI 导出器的空字段和已知中性默认值；仍拒绝跳过证书验证、有实际含义的不支持值、重复参数和未知字段 |
| Go 回归 | 15 项常规测试通过，2 项设备 fixture 默认跳过；新增合成 URI 用例，不使用真实凭据；竞态检测及 Vision 例外同下文 |
| Android VLESS WS/TLS | 抽测 1 个节点；固定 HTTPS 请求返回 204 / 200；出口 IP 相比断开时变化；DNS 查询 rcode 0 / 2 个答案；protectedSockets=8、failedProtection=0 |
| Android VLESS Reality/Vision | 抽测 1 个节点；固定 HTTPS 请求返回 204 / 200；出口 IP 相比断开时变化；DNS 查询 rcode 0 / 2 个答案；protectedSockets=7、failedProtection=0 |
| 构建 | Android Debug / Preview、iOS 模拟器宿主与 Packet Tunnel 扩展构建成功 |
| 产物一致性 | 两端核心 manifest 的源码与二进制 SHA-256 均匹配 |
| 测试清理 | 两端临时订阅记录与本机订阅临时文件已删除；源码中未发现本次链接/令牌；Android 已断开，无 VPN 服务或 tun0 |

HTTPS 检查请求 Google 静态 204 端点和 Cloudflare trace，仅比较出口变化，不记录 IP。
DNS 经 Android 系统隧道向配置的 DNS 地址查询 example.com；未对所有节点测速、做长时间或切网测试。
iOS 本轮只验证原生下载、解析和编译，不能据此认定 iOS VPN 可用。

## 域名节点与常见传输验证（上一阶段）

| 检查 | 结果与边界 |
| --- | --- |
| 应用检查 | 13 项领域/桥接测试、TypeScript、ESLint 通过 |
| Go 检查 | 14 项常规测试通过，2 项设备 fixture 默认跳过；保留竞态检测，Vision 例外见下文 |
| 订阅映射 | Clash / sing-box / URI 对同一 WS、gRPC、Reality 节点生成相同受限 profile；非法参数/HTTP 头拒绝 |
| 本机真实传输 | Trojan TLS/WS/gRPC，VLESS TLS/WS/gRPC/Vision/Reality，共 8 个组合通过实际握手和 TCP 回显 |
| 认证拒绝 | 不可信 TLS 证书、错误 Reality 公钥均无法完成回显，不降级为明文连接 |
| 受保护引导 DNS | 本机可信 DoH 解析节点域名后经 SS 回显成功；protect 失败时无 DNS 请求和转发；应用 DNS 保持代理 detour |
| Android 域名 SS | 从订阅选择 10.0.2.2.sslip.io 节点，真实系统 TUN 的 TCP/UDP 精确回显、DNS rcode 0 / 2 个答案通过；protectedSockets=16、failedProtection=0（本次采样） |
| Android 域名 Reality/Vision | 同样从加密订阅记录启动，TCP/UDP 精确回显、代理 DoH 查询通过；protectedSockets=12、failedProtection=0（本次采样） |
| 两端原生桥接 | 7 种配置构造检查通过，含 WS/gRPC/Vision/Reality；两端各 3 次加密回环自检通过 |
| iOS | 宿主与扩展编译成功；域名网络设置不调用未受保护的系统解析，VPN 真机实测仍待完成 |
| 兼容旧数据 | Go 测试验证旧 bundle 的 NUMERIC_ENDPOINT_REQUIRED 标记在读取时解除，版本/节点 ID 保留 |
| 双端订阅回归 | 原生导入返回域名节点可选；失败更新保留旧配置；重启后节点恢复，删除后不可再读取 |
| 最终交付 | Android Debug / Preview、iOS 模拟器宿主和扩展最终构建成功；两端源码/产物 SHA-256 匹配；Android Preview 无 Metro 映射正常启动 |
| 测试清理 | 临时测试订阅删除，fixture 停止且删除临时凭据；Android 无残留 VPN 服务或 tun0 |

域名测试只借用 sslip.io 的 IP 映射域名解析到模拟器宿主，未向该服务发送节点凭据。
Reality 使用本机随机身份与密钥、受限路由的测试服务；仅允许回显与固定 Cloudflare DoH，不是商业节点。
这些结果不证明所有供应商参数、iOS 真机网络扩展、完整 IPv6 或长时间稳定性。

固定 sing-vmess 的 Vision 使用 uintptr 访问 Go/uTLS 内部字段，标准 race 模式附带的 checkptr 会在该上游实现中终止进程。
测试脚本仅对 `github.com/sagernet/sing-vmess/vless` 加 `-d=checkptr=0`，其余包保留指针检查，race detector 仍开启。
未修改上游模块或关闭全局检测；此次额外验证了 Android 实际 Vision TCP、UDP 和 HTTPS DNS 转发。
升级相关依赖或 Go 后必须重新验证这些内部布局依赖，不能把此次结果沿用到其他版本。

复现与兼容范围见 [订阅说明](subscriptions.md) 和 [系统隧道说明](vpn-prototype.md)。

## 订阅闭环原型验证（上一阶段）

| 检查 | 结果 |
| --- | --- |
| 应用检查 | 13 项领域/桥接测试、TypeScript、ESLint 通过 |
| Go 检查 | 11 项常规测试含 race detector 通过；fixture 默认跳过 |
| 格式与边界 | Clash YAML、sing-box JSON、URI / Base64；重复键、别名、多文档、嵌套深度、节点数/大小、危险或不支持参数拒绝 |
| HTTPS 自动化 | 本机 TLS 服务验证成功下载/相对重定向；拒绝不可信证书、降级、循环重定向、超时、HTTP 错误、超大及 gzip 膨胀响应 |
| 双端实际下载 | 两端模拟器请求 mihomo 官方公开示例成功；本次提取 1 个受限节点、跳过 54 个，未连接示例节点 |
| 双端原生存储 | 导入成功；无效导入和 HTML 下载失败均保留旧版本；节点摘要不返回 profile/密码；过期版本拒绝连接；域名节点阻止连接 |
| 双端重启 | 强制结束并重启后仍能读取同版本/数量的节点；删除订阅后节点不可再读，重复删除幂等 |
| Android 订阅连接 | 从原生存储按订阅 ID/版本/节点 ID 启动真实 VPN；启动即取消无残留，再次启动成功 |
| Android 界面操作 | 实际点击订阅 → 节点 → 连接；原生状态为 connected，TCP 精确回显通过 |
| Android 实际流量 | 已保存的本机 SS fixture 节点：TCP/UDP 精确回显通过，DNS 查询 rcode 0 / 2 个答案 |
| 最终构建 | Android Debug / Preview 与 iOS arm64 模拟器宿主、Packet Tunnel 扩展均构建成功 |
| 最终交付检查 | 两端真实内核桥接自检通过；源码/二进制 manifest 哈希一致；Android Preview 移除 Metro 映射后正常启动 |
| 测试清理 | 临时订阅和密码文件已删除；本机 fixture 已结束；Android 无残留 VPN 服务或 tun0 |

公开示例来源：[mihomo 官方配置示例](https://raw.githubusercontent.com/MetaCubeX/mihomo/Meta/docs/config.yaml)。
下载测试只读取文档示例，不使用真实订阅。解析后的示例节点不可视为可用服务。
失败保留测试请求 example.com HTML 页面；所有本地测试数据使用虚构凭据，测试结束删除。
共享 Go 下载器的本机 TLS 测试使用仅测试客户端信任的证书；生产下载器没有跳过证书验证。

本轮不证明 Trojan/VLESS 服务端互通、域名节点引导解析、策略组/规则应用或 iOS 真机 VPN。
范围与复现见 [订阅说明](subscriptions.md)。

## 系统隧道原型验证（上一阶段）

| 检查 | 结果 |
| --- | --- |
| 应用检查 | 11 项领域/桥接测试、TypeScript、ESLint 通过 |
| Go 包通道 | 7 项常规测试通过（含 race detector）；专用 fixture 默认跳过；实际 IPv4 TCP/UDP、保护失败阻断、关闭中断等待 |
| 构建 | Android Debug / Preview 成功；iOS arm64 模拟器宿主和 HafenTunnel.appex 编译、链接及嵌入成功 |
| 两端内核桥接 | 真实版本查询、三类受限配置校验、非法参数拒绝，各连续三次本机 SS 加密自检通过 |
| Android 授权/服务 | 系统授权允许后，真实 VpnService 进入前台并建立 tun0 |
| Android TCP / UDP | 模拟器 shell 发往 198.18.0.1:29392，经 TUN → gVisor → SS → 主机回显；两种 payload 精确匹配 |
| Android DNS | 向 172.19.0.2:53 查询 example.com A；经代理 DoH 返回相同事务 ID、rcode 0、2 个答案 |
| Android 后台 | 应用退到 Home 后，实际 TCP 回显仍成功 |
| Android 生命周期 | 拒绝重复启动、重复停止幂等、启动即取消、无效域名节点失败清理、重新连接通过 |
| Android 清理 | 最终 state=disconnected；/sys/class/net 无 tun0；dumpsys activity services com.hafen 为空 |
| Android 独立预览 | 最终 Preview APK 安装后无 adb reverse 映射，重启正常显示内核版本、未连接状态和手动节点表单 |
| iOS 模拟器行为 | 宿主正常加载内核；vpnAvailable=false、授权 unsupported；不伪装系统 VPN 可用 |

Android 使用有界本机 SS fixture，随机测试密码只写入临时 0600 文件，五分钟后服务结束并删除文件。
fixture 自身先完成 SS 回显检查，再用于设备测试；不会读取真实订阅。DNS 检查只访问 Cloudflare DoH。
系统 shell/应用 UID 测试时需保持 nc 输入端开启等待响应；立即关闭 stdin 不能作为转发失败的可靠依据。
包计数与 socket protect 计数用于定位问题，不用于推断公网健康。

这些结果不覆盖 iOS 真机 VPN、真实商业节点、完整 IPv6 转发/泄漏、系统撤权、网络切换、长时间运行或正式发行。
本轮未重复执行所有早期存储持久化用例；下面保留其历史证据。
使用范围、平台设计和复现入口见 [系统隧道原型](vpn-prototype.md)。

## sing-box 绑定阶段验证（历史）

- 固定 sing-box v1.14.4 / Go 1.26.1 / gomobile 与 gobind v0.1.12；Go 模块校验数据库保持启用。
- `npm run core:bootstrap` 与 `core:test` 通过；5 项 Go 测试含 race detector、实际配置构造、
  未支持输入拒绝、TLS 验证策略，以及连续三次本机 Shadowsocks 加密 TCP 往返与清理。
- `core:android` 成功并验证重复构建，生成 arm64-v8a / x86_64 AAR；`core:ios` 成功，
  生成 arm64 设备及 arm64 / x86_64 模拟器 XCFramework。各产物附源码输入与产物 SHA-256 manifest。
- 加入内核后的 Android Debug / Preview、iOS arm64 模拟器 Debug 均构建成功。
  iOS 使用 Objective-C 薄包装隔离 gomobile 头文件与 RN Objective-C++ 编译设置，并链接 Network.framework。
- `npm run core:smoke` 在 Android 与 iOS 运行中的实际 TurboModule 均通过：读取真实链接版本 1.14.4，
  三种受限配置通过内核构造校验，非法 TLS 参数被拒绝且无凭据回显，两端各连续三次加密 TCP 自检成功。
- 应用层 10 项测试、TypeScript 与 ESLint 通过。
- 新 Android Preview 包安装后移除 Metro 端口映射并重启，仍能显示 sing-box 1.14.4、零订阅和禁用的连接按钮；
  双端界面均明确提示系统隧道未接通。

自检只用随机凭据和 127.0.0.1 临时端口；不访问订阅、不建立系统 VPN。
当时两端均返回 `coreAvailable: true`、`tunnelAvailable: false`；iOS VPN 准备为不支持。
这不代表 Trojan/VLESS 公网互通、UDP、DNS、规则或系统路由已经通过验收。

复现：先按 `core/README.md` 构建内核和 Debug 应用，让两端连接同一 Metro，执行 `npm run core:smoke`。
默认 Metro 端口 8093，可用 `HAFEN_METRO_PORT` 修改。检查输出同时包含 android 和 ios；只有一个平台的输出仅证明该端通过。

## 基础阶段已验证（接入内核之前）

| 检查 | 结果与范围 |
| --- | --- |
| npm ci | 依赖安装完成；缺失下载用锁文件 SHA-512 校验后恢复缓存 |
| npm test | 9 项通过，覆盖订阅校验、连接状态、桥接协议校验及错误脱敏 |
| npm run typecheck / lint | 通过，包含应用与共享领域代码 |
| Android assembleDebug | Kotlin、Codegen、C++ 与打包成功 |
| Android assemblePreview | 内置 Hermes JS 包；模拟器移除 Metro 端口映射后启动 |
| iOS Debug | Codegen、Objective-C++、Pods 与模拟器应用构建成功 |
| 两端原生存储 | 在运行中的模拟器调用实际 TurboModule 验证，不使用 mock |
| 两端进程重启 | 强制结束应用后重启，测试记录仍存在；随后删除并验证幂等删除 |
| Android 磁盘检查 | 应用私有密文文件中未出现测试名称、域名或令牌的明文 |
| Android 授权取消 | 打开真实系统 VPN 对话框后取消，界面提示已取消并保持未连接 |

原生存储用例包括：空名称、非 HTTPS 地址、保存、只返回元数据、重复地址拒绝、并发相同地址仅一次成功、
列表与删除。使用 `example.com` 虚构链接，不发送网络请求；测试记录已清理。桥接测试通过 Metro 调试
协议在两端执行，再关闭和重新启动应用确认持久化。Android 文件检查通过该开发应用的 `run-as` 完成。
这不等于对设备被攻破、备份恢复、存储损坏或所有生命周期竞态做过全面测试。

## 复现

从根目录执行 `npm ci`、`npm test`、`npm run typecheck`、`npm run lint`。
先按 `core/README.md` 构建目标平台内核，再构建原生 App；缺少 AAR / XCFramework 会明确报错。
正常开发使用 `npm start` 和 `npm run android` / `npm run ios`。

若 8081 已被其他项目占用，使用单独端口，避免中断其他项目：

```sh
npm start -- --port 8093 --host 127.0.0.1
npm run android -- --port 8093
npm run ios -- --port 8093
```

Android 独立预览：

```sh
npm run android:preview
adb install -r apps/mobile/android/app/build/outputs/apk/preview/app-preview.apk
```

Preview 使用公开开发密钥，`debuggable=true`，关闭 RN 开发服务器依赖并内置 JS。
它不是正式 Release；正式版未配置发行签名。

iOS 先在 `apps/mobile` 运行 `bundle install`，在 `ios` 运行 `bundle exec pod install`。
使用 Xcode 打开 `Hafen.xcworkspace`，选择模拟器运行。命令行构建示例（Apple Silicon）：

```sh
cd apps/mobile/ios
xcodebuild -workspace Hafen.xcworkspace -scheme Hafen -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/simulator CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=YES build
```

模拟器构建也保留 ad hoc 签名：曾用 `CODE_SIGNING_ALLOWED=NO` 编译成功，但运行时 Keychain 访问失败；
恢复签名并重新安装后存储测试通过。真机需配置自己的开发团队与签名，不能使用上述签名参数替代。
`Gemfile.lock` 在 Apple Silicon 上由本地已安装 gems 解析生成；已核对 bundle 依赖，尚未验证全新机器安装。
Intel Mac 需要为其平台解析对应 gems。

手工复测存储：输入虚构 HTTPS 订阅 → 保存 → 确认仅显示名称/域名 → 重复输入应被拒绝 →
结束应用并重启 → 确认记录保留 → 确认删除 → 再重启应为空。保存地址不会下载节点。

## 本次工具链与下载恢复

Node 24.22.2、React Native 0.88.1、React 19.3.0；Android SDK / Build Tools 37、NDK 27.1.12297006、
Gradle 9.4.1；Xcode 27、Ruby 4.0.9、CocoaPods 1.17.0、xcodeproj 1.28.1。
使用 Android API 37 模拟器及 iOS 27 arm64 模拟器。最低系统要求以工程配置为准，未完成最低版本实测。

本机下载出现超时，验证构建采用了两项临时缓存恢复，未替换项目的官方仓库地址：

- AndroidX core 1.13.1 AAR 由已有缓存恢复，并对照官方 SHA-1
  `4606d420282fe1e5c8d5c4e647ec188e1045b7be`；通过命令行临时 Gradle init script 提供限定该版本的本地 Maven 来源。
- iOS Hermes Debug 官方归档分段下载后核对官方 SHA-256
  `c92c147a668e3349b041f27e457859e80d50512dc0aa4d9241987b4c64675625`，
  通过 `HERMES_ENGINE_TARBALL_PATH` 执行 pod install。仓库不依赖该机器的临时路径。

有正常网络的新环境应按标准 npm / Gradle / CocoaPods 流程下载。尚未验证完全清空缓存后的端到端安装。

## 尚未验证与下一步

- Android 允许授权与取消已实测；授权撤销与 Activity 重建仍需完整交互验收。
- Android 系统 TUN 已通过上述模拟器测试；iOS 扩展已完成签名归档，真机转发仍待验收。
- 订阅下载、受限解析和少量真实节点已验证；完整 IPv6、路由泄漏或 Wi-Fi/蜂窝切换尚未验收。
- 已完成 iOS 正式签名及 TestFlight 上传；iOS 真机转发、最低系统版本、长时间运行及公开商店发行尚未完成验证。

已采用 sing-box v1.14.4。下一步补齐 iOS 真机原型验收和 Android 网络变化测试。
订阅下载、受限配置解析、节点选择与 Android 真实连接已实现；策略组、规则与更多协议仍待补齐。

## 2026-11-16 iOS「已连接但未生效」修正与诊断（构建 3）

用户在 iPhone 16 Pro 上反馈 VLESS 连接后网页仍能打开，但出口/目标网站访问未变化。尚无该手机的隧道计数或连接错误证据，不能据此确认唯一根因。

- iOS `NETunnelProviderProtocol.includeAllNetworks=true`，`excludeLocalNetworks=false`，在准备连接时迁移已启用的旧 VPN 配置；IPv4/IPv6 默认路由与隧道 DNS 保留。系统规定的必要服务仍可能例外，不能宣称零泄漏。
- Go packet platform 正确报告 iOS Network Extension 和 includeAllNetworks，继续使用公共 packetFlow 与 gVisor，未使用私有 utun FD。
- `NextPacket` 意外报错时关闭隧道并通知系统；正常 stop 的过期回调通过 generation 忽略。
- UI 状态改为「隧道已连接」，不将 NEVPNStatusConnected 当作互联网可用性证明。
- iOS 新增按需「检查连接」：扩展通过所选 outbound 请求 `https://1.1.1.1/cdn-cgi/trace`，宿主用全新 ephemeral NSURLSession 请求 `https://www.cloudflare.com/cdn-cgi/trace`；同时读取探测前后 packet counters。前者验证节点 HTTPS（仍可能依赖节点域名 bootstrap），后者覆盖系统路由与域名解析。仅返回布尔值、固定错误码和计数；不返回远端 IP、目标日志、订阅 URL 或凭据，不保存诊断结果。请求时限 12 秒，扩展消息超时 2/14 秒，停止或换连接使结果失效。
- 检测结果针对 Cloudflare；单一站点失败不等于整个节点不可用，包计数增长也不能单独证明出口 IP 已改变。尚未实现每次连接的自动健康判定。

验证：TypeScript、ESLint、15 个 domain 测试通过；Go 全套 race 测试通过（原有依赖外部环境的 fixture 跳过），新增的 socket 保护失败/关闭后探测专项 race 测试通过。真实本地 VLESS TLS 和 WS 经同一 packet API 的 IPv4/IPv6 TCP、UDP 回显通过，源地址改为与原生隧道实际设置一致；同时回归 direct/Hysteria2 和保护失败路径。HTTPS 探测测试覆盖成功、不跟随重定向、拒绝不可信证书和取消。Android Kotlin/codegen 编译通过；iOS arm64 + arm64 simulator core 重建、签名 Release 归档成功。

限制：上述 IPv6 使用本地 gVisor 端到端测试，并非 iOS 真机 IPv6 网络验收；这次没有连接用户 iPhone，不能宣称实际 VPN 故障已修好。后续用构建 3 在原网络、原 VLESS 节点上断开重连并点击「检查连接」，记录结果与 iOS 版本、Wi-Fi/蜂窝信息。若节点 HTTPS 失败优先检查节点/证书/域名 bootstrap；节点通过但系统 HTTPS 失败则结合计数检查系统路由/DNS；两者均通过仍需新建网页请求验证目标与出口。

依据：[Apple includeAllNetworks](https://developer.apple.com/documentation/networkextension/nevpnprotocol/includeallnetworks)、[Apple 全隧道路由说明](https://developer.apple.com/videos/play/wwdc2025/234/)。

构建 3 上传结果：2026-11-16 Xcode 返回 `Upload succeeded` / `EXPORT SUCCEEDED`，Apple 状态为 processing；第三方 React、ReactNativeDependencies、Hermes 预编译框架的 dSYM 警告仍存在。未确认 App Store Connect 处理完成或内部测试组分配。

## 2026-11-16 系统 VPN 开关与诊断桥接（构建 4）

用户确认：构建 3 点检测提示「原生模块返回了不兼容的数据」；系统关闭 VPN 后 App 延迟很久才更新，且系统不能重新开启。

确定复现的诊断根因：Objective-C `.m` 中逻辑表达式 `@(!error && status==200)` 被装箱为 C int，JSON 为 `1/0`，不是 TypeScript 合同要求的 boolean。引入 `HafenJSONBoolean` 显式使用 `@YES/@NO`，未放宽 JS 校验。`Tests/DiagnosticsJSON.m` 编译后的真实 Foundation JSON 已由 domain 的解析器检查，true、false、缺失计数情况均通过。

状态同步：监听 `NEVPNStatusDidChangeNotification` 与配置变更，使用 TurboModule typed event 向 JS 发送状态；回到前台立即刷新，轮询也重新读取系统管理器，不因订阅操作锁而暂停。异步命令和轮询结果不能覆盖更晚的原生通知。`Tests/TunnelStateSmoke.m` 直接编译生产控制器，以替代系统 manager 测试系统关闭/开启通知、删除配置后的重新加载，均通过；这不是实际 Network Extension 设备端验收。

系统启动：主 App 在启动前把选中的单个节点写入共享 Keychain（`$(AppIdentifierPrefix)$(HAFEN_BUNDLE_ID).tunnel`）；扩展在系统未传 options 时读取该项。权限为 AfterFirstUnlockThisDeviceOnly、不云同步；宿主原有 Keychain 访问组保留，订阅 URL 和完整配置仍在宿主私有 vault。删除来源订阅同时删除匹配的恢复项；不匹配订阅不会清除其他节点。初次升级后需在 App 内连接一次建立恢复项。没有启用按需连接或自动重连。

验证：TypeScript、ESLint、15 个 domain 测试及 Android Kotlin/codegen 编译通过。iOS Release 签名归档通过；已核对扩展的 keychain-access-groups 与宿主 Info.plist 展开的共享组一致。Go 内核与路由没有在此构建继续修改。

VPN 转发仍未得到该手机的有效诊断结果，不宣称已修好。下一步使用构建 4 输出的节点 HTTPS、系统 HTTPS、路由与数据包计数定位故障。

Keychain 运行验证：在同一 iOS 27 模拟器安装两个独立 App 身份（专用测试访问组，非生产组），运行生产 `HafenTunnelStore.h`。A 写入并更新虚构节点，删除不匹配订阅后节点保留；B 跨进程读取成功并删除匹配订阅；A 再读取确认 errSecItemNotFound，三阶段均通过。测试源为 `Tests/KeychainSmoke.m`。测试 App 由 Xcode 构建并采用 UIScene 生命周期。测试记录与两个临时 App 已删除。此验证不替代 iPhone 真机系统 VPN 启停验收。

构建 5 在构建 4 基础上补齐拨片显示：仅 connecting/connected 显示开启；disconnecting 立即显示关闭并暂时禁用拨片，节点编辑仍保持锁定至完全断开，避免清理期间看起来仍开启。TypeScript、ESLint 与签名 Release 归档通过。构建 4 已上传成功，但本次建议验收最终构建 5。

构建 5 上传结果：Xcode 返回 `Upload succeeded` / `EXPORT SUCCEEDED`，Apple 状态 processing；第三方框架缺失 dSYM 警告与前版相同。App Store Connect 处理完成和真机验收仍待确认。

## 2026-11-16 iOS 出站网卡绑定（构建 6）

用户在构建 5 提供有效诊断：节点 HTTPS CONNECT，系统 HTTPS TIMEOUT，全流量路由开启，探测期间 packetsIn +34 / packetsOut +3（累计 70/8）。用户确认同一手机、同一网络、同一节点在其他客户端可用。该证据说明至少有流量进入 packet API，但不能仅凭少量返回包认定代理成功。

对照官方 Apple 客户端与本地 sing-box dialer 源码，Hafen 的平台保护回调此前只返回 YES，并未执行实际网卡绑定。构建 6 在安装 TUN 路由前用公开 NWPathMonitor 获取可用 Wi-Fi/蜂窝/有线出口，对每个出站 TCP/UDP socket 使用公开 IP_BOUND_IF / IPV6_BOUND_IF 绑定。无出口、无效 socket 或 setsockopt 失败均拒绝连接；网络出口变化后关闭隧道，需手动重连。没有访问 packetFlow 私有 FD，没有关闭证书校验。

连接诊断新增固定分类：出口保护失败、REALITY 校验失败、连接拒绝/重置、无路由、EOF、TLS 握手失败；覆盖 uTLS 证书错误。只返回预定义枚举，不把原始异常或服务器地址带到界面。原先 CONNECT 合并了这些错误，因此截图本身不能确认是路由回环还是握手失败；出站绑定缺口已修正，但仍需真机复测确认是否解决此故障。

验证：
- 使用此前用户授权订阅，在本机以生产解析器和 packet session 出站配置严格匹配截图 AWS / 新加坡 / 02 的一个 VLESS 节点，生产 Probe 返回 proxyHTTPS=true（HTTPS 200）。测试网络并非用户 iPhone 网络，不能替代设备验收。原始订阅临时文件及临时测试源已删除，未输出地址、UUID、密码或订阅令牌。
- `Tests/SocketBindingSmoke.m` 在 macOS 上实际创建 IPv4/IPv6 TCP/UDP socket，绑定后通过 getsockopt 核验接口索引；零接口、关闭/无效 fd 均拒绝。当前物理网络的 NWPathMonitor 初始出口获取通过。这验证 Darwin socket 行为，不是 iOS Network Extension 全链路验收。
- Go 全套 race 检查通过，包括既有 IPv4/IPv6 VLESS TLS/WS packet 转发与新错误分类；TypeScript、ESLint、15 个 domain 测试通过。

参考：[官方 Apple 平台适配](https://github.com/SagerNet/sing-box-for-apple/blob/main/Library/Network/ExtensionPlatformInterface.swift) 的接口监控与自动绑定策略；实际接入仍采用 Hafen 的公开 packetFlow 适配。

构建 6 的 iOS core（真机 arm64、模拟器 arm64）重建与 Release 签名归档通过。重建框架后使用本机 CocoaPods 更新工程，随后归档复用已验证内核。仍需用户在相同 iPhone 网络和节点上复测；没有将本机节点 HTTPS 成功等同于手机 VPN 验收。

构建 6 已上传成功：Xcode 返回 `Upload succeeded` / `EXPORT SUCCEEDED`，Apple 状态 processing。第三方框架 dSYM 警告同前版；尚未确认 Apple 处理完成和用户真机转发恢复。

## 2026-11-16 构建 6 仍失败：分阶段诊断与 iOS 原生复现（构建 7）

用户确认当前安装构建 6，仍为节点连接失败、系统超时；同一节点在 Shadowrocket 可用。因此构建 6 的出口绑定修正未解决用户故障，不能把本机测试成功写作真机恢复。

本次以生产订阅解析器严格选择截图对应的 AWS / 新加坡 / 02 节点，在专用 iOS 27 arm64 模拟器运行独立原生 App，直接链接本次 HafenCore，使用生产 `HafenInitialInterface` 与 `HafenBindSocketToInterface`，调用生产 `MobileNewPacketSession` / `Probe`。结果为 proxyHTTPS=true，endpointDNS、endpointTCP、proxyHandshake、targetTLS 全部 NONE。这覆盖 iOS 编译的内核、VLESS/REALITY/Vision 和实际 socket 绑定，但没有安装系统 Network Extension 路由，且网络与用户手机不同；不能排除真机 DNS 可达性或 Network Extension 路由差异。私有订阅和节点临时文件已删除，测试 App 已卸载；未打印节点凭据。

构建 7 不改变出站、DNS 或路由策略，而是拆分检测：
- 节点解析：使用实际 bootstrap DNS，禁用本次查询缓存，最多 6 秒；字面 IP 标记 IP。
- 节点 TCP：调用同一个原生 protector，最多 5 秒；Hysteria2 使用 UDP，故跳过该 TCP 阶段。
- 代理连接：由生产 outbound 建立；这一阶段通过不等于服务端认证或后续转发一定成功。
- 目标 TLS / HTTPS：经代理访问固定 Cloudflare 目标，检查证书和 HTTP 200。目标仍不能代表所有站点。

内核总检测期限 24 秒，原生 IPC 等待 26 秒，系统 HTTPS 检测并行执行。首个失败阶段停止后续阶段，未运行显示「未执行」。诊断只返回固定枚举、错误类型名和数值 errno / DNS rcode，不返回异常原文、服务器地址、响应正文或认证字段。JS 接受旧版缺失阶段字段，仍严格校验 boolean、计数和字段枚举。连接状态仍只代表系统隧道建立，不等同互联网可用。

验证：Go 全套 race 测试通过（包含受保护 TCP、拒绝、取消、真实本地 DNS NXDOMAIN 阶段和错误脱敏）；16 个 domain 测试、TypeScript、ESLint 通过。真实 Foundation 生成的诊断 JSON 经 JS 合同解析通过。iOS 真机 arm64 / 模拟器 arm64 内核均构建成功。待用户运行新阶段检测后再定位故障，不宣称已修复。

构建 7 的 Release 签名归档已通过，宿主与扩展的 Bundle ID、0.1.0 / 7 版本一致，打包后的 JS 已包含全部阶段字段。归档为 `build/ios/Hafen-7.xcarchive`。

构建 7 已上传成功：Xcode 返回 `Upload succeeded` / `EXPORT SUCCEEDED`，Apple 状态 processing。React / ReactNativeDependencies / Hermes 预编译框架的 dSYM 缺失警告同前版；未确认 Apple 处理完成，也未确认用户真机 VPN 故障恢复。下一步需构建 7 的完整分阶段检测结果。


## 2026-11-16 与官方 Apple 客户端的源码比对

用户要求对照官方开源 iOS 客户端。审计固定 Apple 仓库 `c9cea9bf1187ea9031dc380be344c10328f57dc4`（main，2026-11-03），内核侧检查 Hafen 锁定的 sing-box v1.14.4。此处比较平台行为，不假定两份源码的 libbox 绑定接口名称完全兼容。

1. **已复现：正式会话继承了空网卡监视器。** `packetPlatform` 嵌入 `diagnosticPlatform`，没有覆盖 `CreateDefaultInterfaceMonitor`。其 `DefaultInterface()` 永远 nil、回调注册为空。锁定版本的 `route/network.go:dispatchInterfaceUpdateLocked` 在启动时因此执行 `NetworkPause()`。临时审计测试用生产 `NewPacketSession` 创建不联网的虚构节点，读取真实 pause manager，结果 `defaultInterfaceMissing=true networkPaused=true`。测试源已删除。官方 `ExtensionPlatformInterface` 使用 NWPathMonitor，向 libbox 更新接口名称、索引、费用与受限状态；libbox monitor 保存真实默认接口并通知内核。这是确定的集成缺陷，但不能单独据此认定 VLESS 超时根因：VLESS 直拨与 DoH 路径没有统一等待 pause manager，构建 7 的模拟器 Probe 也已经通过。
2. **节点引导 DNS 的单点依赖。** Hafen `tunnelConfig` 把域名节点的 bootstrap 固定为直接访问 1.1.1.1 的 HTTPS DNS；业务 DNS 才经 proxy。官方 `startService` 接收完整 configContent，DNS 取决于配置，并未在该启动路径强制相同的单一 bootstrap。手机无法直达这个 DoH 时，即使代理服务器可用也无法开始握手。这是代码可证的故障条件，尚无用户设备侧证据证明已触发。应结合构建 7 的 endpointDNS 结果验证，避免盲目换另一个公共 DNS。
3. **路由策略不同。** 官方 iOS includeAllNetworks 默认 false、excludeLocalNetworks 默认 true，并将 TUN options 的地址、MTU、包含与排除路由应用到系统。Hafen 强制 includeAllNetworks=true、excludeLocalNetworks=false，并在 Go 与 Objective-C 两处分别固定 TUN 参数。这些差异需要控制变量验证；没有证据支持立即切换设置作为修复。Go auto_route=false 是由原生侧安装系统路由的设计，不代表系统没有默认路由。
4. **数据包接入不同。** 官方 openTun 在安装网络设置后，优先通过 packetFlow 的 KVC 路径 socket.fileDescriptor 获取 FD，再尝试 LibboxGetTunnelFileDescriptor。Hafen 使用公开 readPackets/writePackets + Go gVisor channel，逐包跨 Objective-C/Go、没有经过 JS。官方路径不等于可直接照搬的公开 packetFlow API；现有公开路径也不能仅凭架构差异判定无效。当前 Probe 直接调用 outbound，不覆盖 packetFlow 全链路。
5. **网络变化与资源管理不同。** 官方 libbox 接收真实网络更新、具有 DNS 配置监视与缓存更新路径，ExtensionProvider 具有 sleep/wake 及 OOM 配置。Hafen 目前固定启动时网卡索引、索引变化则关闭隧道，Go 端缺少真实监视器和同等初始化；没有接入 libbox 的 Go GC/内存预算设置。内存差异是稳定性缺口，尚无该手机被系统终止扩展的证据。

后续优先级：补齐真实平台监视器及其回归检查；按构建 7 的阶段证据解决 bootstrap/握手问题；进行真实 Network Extension 路由 A/B 验证；再补内存预算和网络恢复。此次为源码比对与隔离审计，没有改动运行时代码或发布新 TestFlight 包。

源码：
- [Apple 平台接口](https://github.com/SagerNet/sing-box-for-apple/blob/c9cea9bf1187ea9031dc380be344c10328f57dc4/Library/Network/ExtensionPlatformInterface.swift)
- [Apple 扩展启动](https://github.com/SagerNet/sing-box-for-apple/blob/c9cea9bf1187ea9031dc380be344c10328f57dc4/Library/Network/ExtensionProvider.swift)
- [Apple 默认偏好](https://github.com/SagerNet/sing-box-for-apple/blob/c9cea9bf1187ea9031dc380be344c10328f57dc4/Library/Database/SharedPreferences.swift)
- [锁定内核网络管理](https://github.com/SagerNet/sing-box/blob/c005f35300ce76427dc285481ec5695f5b179cd2/route/network.go)
- [锁定内核 libbox 平台适配](https://github.com/SagerNet/sing-box/blob/c005f35300ce76427dc285481ec5695f5b179cd2/experimental/libbox/service.go)

## 2026-11-16 平台接入修复（构建 8）

用户授权按官方客户端比对结果修复。修正已复现的空默认网卡缺陷，并解除 iOS 节点启动对直连 Cloudflare DoH 的固定依赖；仍未取得用户手机的构建 7 分阶段结果，因此不将 DNS 单点依赖认定为已证实的真机根因。

- `SocketProtector` 现在同时提供真实接口名称与索引；iOS 来自 NWPathMonitor 选中的物理接口和 if_indextoname，Android 来自所绑定 Network 的 LinkProperties / NetworkInterface。缺失接口拒绝启动。生产 packet platform 覆盖空监视器，向 sing-box 提供真实默认接口和可注销的变更回调。
- 同一接口的路径变化触发网络信息刷新及内核连接重置；失去接口或切换物理接口先通知 NetworkLost，再关闭会话。当前仍需手动重连，不宣称实现无缝切网。生命周期锁避免刷新/关闭并发，回调不持有 monitor 锁，默认接口以副本返回。
- iOS 使用 `StartPacketSessionBeforeRoutes`，在调用 setTunnelNetworkSettings 前通过 Go 的系统解析器取得节点地址，最多 5 秒。锁定 Go 源码对 iOS 默认选择 cgo/getaddrinfo。地址仅作为本次会话的 bootstrap hosts 响应；原始 server、TLS SNI、REALITY 和传输 Host 不变，订阅及共享 Keychain 不保存解析结果。重连重新解析。系统节点 DNS 不保证加密；业务网站 DNS 继续走代理 remote DoH。Android 引导 DNS 保持受保护 DoH。
- 节点系统解析失败返回固定 ENDPOINT_DNS_FAILED。iOS 16+ 从系统获取断开原因，按允许列表转换为提示，未知异常仅映射为通用错误；新连接清除旧错误，异步旧结果不能覆盖更新连接。
- 诊断新增 networkAvailable / networkPaused，在界面显示内核网络可用、暂停或未知。iOS packet session 采用 40 MiB Go 软内存预算、GOGC=50；这是内核软预算，不是系统进程上限或 OOM 不发生的保证。未改 includeAllNetworks、TLS 校验或公开 packetFlow 路径。

验证：Go 全套 race 检查通过（56.243 秒），包含真实默认网卡启动不暂停、丢网暂停、并发刷新/关闭、回调注销、实际本地 SS 转发、出站保护拒绝、系统 DNS 失败脱敏、原始 TLS 参数保持。16 个 domain 测试、TypeScript、ESLint 通过；Foundation 诊断 JSON 经 JS 解析通过；生产原生控制器的系统状态与断开错误脱敏 smoke 通过。Android arm64 核心和 Kotlin preview 编译通过。

真实节点验证：在专用 iOS 27 arm64 模拟器，用此前授权订阅严格匹配同一 AWS / 新加坡 / 02 节点，原生调用连接前系统 DNS 入口与实际 socket 网卡绑定。节点解析、TCP、代理连接、目标 TLS、HTTPS 均成功；初始化及 RefreshNetwork 后均为 networkAvailable=true / networkPaused=false。没有安装 Network Extension 路由，这仍不能替代用户真机 VPN 验收。凭据临时文件和提取用测试源已删除，隔离测试 App 已卸载，仅保留脱敏结果。

跨平台绑定曾因两个 NewPacketSession 前缀工厂生成重复 Java 构造方法而失败，随后将 iOS 工厂改名为 StartPacketSessionBeforeRoutes；Android 和 iOS 产物已重建，Android Kotlin 编译验证通过。名称调整不改变上述已验证的入口行为。

构建 8 Release 签名归档成功，宿主和 Packet Tunnel 扩展均为 0.1.0 / 8。已核验归档 JS 含 networkAvailable、networkPaused 和 ENDPOINT_DNS_FAILED；上传脚本另行校验完整签名、标识、版本和 Release JS 包。

构建 8 已上传成功：Xcode 返回 Upload succeeded / EXPORT SUCCEEDED，Apple 状态 processing。第三方 React / ReactNativeDependencies / Hermes 的 dSYM 警告同前版；尚未确认 Apple 处理完成或用户手机 VPN 转发恢复。

## 2026-11-16 iOS 用户确认与 Android 回归

用户确认 iOS 已可以接通。该反馈对应此前交付的 TestFlight 构建 8；不把这次确认扩大为所有协议、IPv6、后台长时间运行或切网均通过。

修复分层：默认接口监视器、内核网络暂停状态和网络变更通知属于共享 Go 层；安装 VPN 路由前使用系统 DNS 解析节点、扩展软内存预算与系统断开原因读取属于 iOS 适配。Android 仍通过 VpnService.protect / Network.bindSocket 保护出站，节点引导 DNS 保持受保护 Cloudflare DoH。

Android API 37 arm64 模拟器实测发现，LinkProperties 首次回调中的 RefreshNetwork 调用 Go UpdateInterfaces 返回失败，导致有效隧道被关闭。Android 已有 ConnectivityManager 提供的物理 Network 和接口，因此在 Android 分支跳过该枚举，保留默认接口通知及原生 socket 绑定。iOS 分支保持原有刷新行为。没有记录底层 errno，不能据此断定某一特定系统权限错误。

验证结果：
- Android arm64 AAR、Debug 和 Preview 构建通过。
- 本机临时 VLESS / REALITY / Vision 节点先执行主机 TCP 自检；通过域名 10.0.2.2.sslip.io 连接，覆盖 Android 引导 DNS。实际系统 TUN 的 TCP、UDP 回显各收到完全一致的 23 字节，代理 DNS 查询返回 rcode=0、2 条回答。
- 退到后台后 TCP、UDP、DNS 再次通过；内核 networkAvailable=true、networkPaused=false，socket 保护失败计数为 0。
- 重复启动被拒绝、重复停止幂等、启动取消、无效配置失败清理及重连通过；最终 disconnected 且无 Hafen VPN 服务残留。
- 测试期间模拟器物理网络从蜂窝切换至 Wi-Fi，应用按当前设计停止并提示 NETWORK_CHANGED；手动重连后通过流量测试。不宣称无缝切网。
- Preview 安装后移除本次 tcp:8093 映射并强制重启，界面正常显示；不依赖 Metro。该 APK 为 arm64-v8a、公开开发签名，供测试使用。

流量复现：在上述临时 fixture 运行且 Debug 应用已连接时，执行 `ADB=/path/to/adb ANDROID_SERIAL=emulator-5554 python3 scripts/android-packet-smoke.py`。脚本通过双向 `adb shell -T` 保持 stdin，检查真实响应而非只看包计数；不读取订阅凭据。测试服务器已停止，合成凭据临时文件已清理。

Android 真机、真实订阅出口验证与长时间运行仍待用户测试。本次未重新上传或替换已可用的 iOS 构建。

## 2026-11-16 Android APK 体积优化

最终 arm64 Preview APK 从 110.09 MiB（115,441,515 字节）降至 18.41 MiB（19,300,581 字节），减少约 83.3%。产物为 `build/android/hafen-preview-arm64.apk`，SHA-256 为 `f6f179130382a5d451c589bf21bb3fc149ca5bff0b71537931415e0df049a182`；R8 映射另存于同目录 `hafen-preview-mapping.txt`。

- Preview 改为继承 release，依赖回退到 release，关闭 debuggable，开启 R8 与资源裁剪；保留开发签名以允许覆盖测试包。Debug 仍用于开发调试，生产 release 仍需配置私有签名。
- React Native 主库解压体积由 22.95 MiB 降至 6.72 MiB；Reanimated / Worklets 合计由约 14.2 MiB 降至约 2.8 MiB。APK 中 sing-box 由 26.61 MiB 压缩为 9.23 MiB，解压后 SHA-256 与旧包一致，没有删减协议或修改内核配置。
- 仅 Preview 使用压缩原生库的 APK 打包方式，Android 安装时解压；下载大小与安装占用不同。release 保留默认原生库打包策略。参考 [Android JNI 打包设置](https://developer.android.com/reference/tools/gradle-api/8.8/com/android/build/api/dsl/JniLibsPackaging)。
- `android:preview` 在 assemble 前执行 `:app:clean`，清除 app 构建目录，避免增量 ZIP 残留空隙，保留依赖与 Go 缓存。新 APK 全部 ZIP 文件内容合计 19,249,509 字节，其余目录、对齐和签名等开销约 51 KB。

首次构建下载发行依赖时 Gradle 访问 React Native 仓库发生 TLS 握手错误；通过 HTTPS 获取同一 0.88.1 官方 AAR，并按官方 module 元数据校验大小和 SHA-256 后放入临时本地 Maven 缓存，没有替换版本或关闭 TLS 校验。构建成功，包括 R8、资源优化和 lintVitalPreview；8 项构建脚本测试通过。

最终 APK 经 apksigner 签名校验和 zipalign 对齐校验通过；manifest 为非 debuggable，仅 arm64-v8a。Android API 37 模拟器覆盖安装成功，无 Metro 端口映射时冷启动正常，添加订阅卡片打开及下滑关闭正常。

直接在最终优化包的界面填写本机临时 SS 测试节点，实际系统 VPN 的 TCP / UDP 回显均返回完全相同的 23 字节，代理 DNS 返回 rcode=0、2 条回答；退后台重复上述测试仍通过。应用开关断开后无 Hafen VPN 服务残留。临时服务器已停止，参数与设备 UI 临时文件已清理，重启清除了手动输入。本轮最终包测的是 SS；此前的 VLESS 测试记录仍保留，内核二进制一致不替代所有协议的真机验收。

## 2026-11-18 iOS 主程序体积优化（构建 9）

主程序改为链接独立的 HafenHost，VPN 扩展继续链接 HafenCore。宿主绑定只导出原有七个服务接口，使用 `hafen_host,with_utls,with_quic` 编译，不包含 PacketSession、系统 TUN 或 gVisor；构建脚本检查依赖图，发现数据包引擎依赖时拒绝生成宿主库。订阅、配置构造、协议注册和 SS 加密回环仍复用原有实现，未把真实校验降为 JSON 校验，也未删除支持的协议。宿主仍需要出站协议和 Go 运行时，因此本次没有消除所有重复代码。

两套框架分别记录源码、构建标签、绑定包、架构和产物哈希。iOS 开发及归档入口会生成两套框架，CocoaPods 只向主程序链接 HafenHost，扩展只链接 HafenCore；Android 继续使用完整 mobile 绑定。

额外发现已安装的 Hermes podspec 仍缓存此前本地 Debug tarball 来源，没有配置切换脚本。常规 pod install 未刷新该来源，定向 `pod update hermes-engine --no-repo-update` 恢复锁定版本的官方脚本；最终 Release 日志确认替换成功。归档入口新增检查，缺少 Hermes 配置切换脚本时拒绝归档。未改动 node_modules 或上游协议实现。

同口径比较签名归档内 `.app` 的未压缩大小（MiB），不是 TestFlight 下载大小：

| 内容 | 构建 8 | 构建 9 |
| --- | ---: | ---: |
| 主程序可执行文件 | 25.13 | 21.78 |
| VPN 扩展可执行文件 | 22.64 | 22.64 |
| Hermes | 7.05 | 6.13 |
| React | 11.45 | 11.45 |
| 整个 App | 70.27 | 66.01 |

合计减少约 4.26 MiB（6.07%）。最终归档为 `build/ios/Hafen-9.xcarchive`；构建 8 和首次未刷新 Hermes 的中间归档均保留。主程序和扩展均为 0.1.0 / 9，签名验证通过。下载与安装大小仍应以 Apple 处理后的报告为准。

验证：完整 mobile race 测试通过（51.093 秒），精简标签下的 host race 测试通过（1.697 秒），覆盖四种协议构造、订阅筛选与选择、凭据脱敏、过期版本拒绝和真实 SS 回环；16 项领域测试、TypeScript、ESLint 及 8 项构建脚本测试通过。

独立 iOS 27 arm64 模拟器 App 直接编译生产 HafenCoreBridge.m 并链接 HafenHost：核心 ready、VLESS 订阅导入/选择/校验、摘要脱敏、非法配置拒绝、真实加密回环全部通过。宿主绑定头文件包含七个预期 API，且没有 PacketSession。此测试不能代替真机系统 VPN 转发验收；用户确认构建 8 可用，仍需更新构建 9 后复测。

完整 React Native Release 模拟器 App 编译并启动通过，Hermes Release 能正常渲染界面，订阅列表完成初始化。测试使用独立 Bundle ID `com.coolab.hafen.sizecheck`；Release 模拟器显式指定 arm64 以匹配本次框架切片。首次无签名启动出现 Keychain 权限错误，随后由 Xcode 使用开发团队生成正确的模拟器签名/权限，重新安装后错误消失；没有通过修改存储实现或跳过权限来规避。真机归档未受这些模拟器测试签名操作影响。

构建 9 已上传 TestFlight Internal Only，Xcode 返回 `Uploaded Hafen` / `EXPORT SUCCEEDED`。仍有第三方 React / ReactNativeDependencies / Hermes 预编译框架缺少 dSYM 的警告，与此前性质相同，影响相关崩溃符号解析；上传成功。Apple 处理完成状态和用户真机回归尚未确认。两个隔离模拟器 App 已卸载。

## 2026-11-18 节点选择持久化（构建 10）

修复 UI 只在内存中保存勾选、iOS 系统开关仍使用上次连接 profile 的错位。
新增原生选择/读取接口，iOS 点选时将节点身份与重连 profile 原子保存到同一个
共享 Keychain 项；Android 使用现有加密 vault 保存选择。冷启动恢复订阅与节点，
浏览其他订阅不改变选择。更新订阅时同步版本；节点消失或订阅删除时清除旧选择。
当前连接名称独立于选择：iOS 从扩展启动时固定的快照读取，Android 从 service 读取。
旧版缺少身份的记录不猜测匹配，需要升级后重新选择一次节点。

验证结果：

- 17 项领域测试、TypeScript、ESLint 通过；Android Kotlin/Codegen 编译通过。
- iOS 原生 Keychain 写入、进程退出、重新读取选择与 profile、按订阅删除通过。
- 直接编译生产 TunnelController 的测试通过：系统开关状态通知、实际节点名称读取与变更、错误脱敏、重新加载已删除配置。
- 完整 iOS Debug 模拟器 App 使用独立 Bundle ID；真实原生桥接通过点选立即保存、删除其他订阅不影响选择、稳定节点更新版本、拒绝过期选择请求、冷启动恢复、移除节点与删除订阅清理测试。
- 冷启动截图确认已保存订阅自动展开、Selected B 保持勾选。最初已有 Metro 缓存的 Worklets 初始化失败，独立端口 8094 重建缓存后正常；未修改产品代码绕过该问题。
- 真机 Release 签名归档 `build/ios/Hafen-10.xcarchive` 成功，宿主和扩展版本均为 0.1.0 (10)，签名校验通过。未压缩 App 约 66.03 MiB，保持此前体积优化。

本轮不改 sing-box 协议、路由或数据包处理。模拟器不能验证真实 Network Extension
系统开关重连；仍需在 iPhone 更新后重新选节点、关闭 App、从系统 VPN 开启，再回 App
核对实际节点和转发。测试数据均为合成配置；隔离测试 App 已卸载。

构建 10 已成功上传 TestFlight Internal Only，Xcode 返回 `Upload succeeded`、
`Uploaded Hafen` 和 `EXPORT SUCCEEDED`；Apple 后续处理及真机回归尚未确认。
与构建 9 相同，第三方 React / ReactNativeDependencies / Hermes 缺少 dSYM 的警告
不阻止上传，但相关第三方崩溃符号解析仍受限。

## 2026-11-18 连接中点选切换节点（构建 11）

节点列表在 connected 状态允许点选。共享 JS 流程先校验并持久化 B，再停止 A，
等原生确认 disconnected 后启动 B，并等 connected 才结束“切换中…”状态。
切换时总开关保持可关闭；关闭会取消排队重连。失败或超时不会伪报成功，也不自动回退 A。
未连接时仍只保存选择。没有修改协议、路由、原生桥接或凭据存储格式。

验证：24 项领域测试、TypeScript、ESLint 通过。新增测试覆盖两种点选语义、iOS 异步
停止与启动状态、保存失败不打断 A、系统在保存期间停止、用户取消、停止超时、启动失败
及超时后的清理。Android Debug 完整构建与 iOS Release 签名归档通过。

Android API 37 模拟器使用两个不同端口（29391 / 29393）的本机 SS 测试节点。通过
真实界面在连接 A 时点击 B，原生状态随后为 connected、connectionName=Switch B，
界面 B 勾选且顶部显示 B。确认 B 已连接后 TCP / UDP 各精确回显 23 字节，代理 DNS
返回 rcode=0、2 条回答。首次流量检查发起于 disconnecting 间隙，TCP/UDP 未返回；
等待系统确认 connected 后重测通过，符合重连中断语义。

再点击 A 并立即关闭总开关，两次随后读取均为 disconnected、无错误、无运行中
数据包会话，未发生延迟重连。合成订阅已删除，测试前选择已恢复，临时 adb 映射已移除。
复现时先启动 `TestTunnelFixture`，设置 `HAFEN_TEST_SWITCH=1`、`HAFEN_TEST_PROFILE`，
执行 `scripts/subscription-smoke.mjs connect`，再在 UI 中点击 B，待连接后运行
`scripts/android-packet-smoke.py`；最后执行 subscription smoke 的 disconnect 清理。

iOS 归档为 `build/ios/Hafen-11.xcarchive`。当前功能共用相同 JS 流程，但 iOS
Network Extension 的真实节点切换仍需 TestFlight 真机回归。

构建 11 上传成功，Xcode 返回 `Uploaded Hafen` / `EXPORT SUCCEEDED`，Apple 后续
处理状态尚未确认。第三方预编译框架缺少 dSYM 的警告与前两版相同。
本轮测试服务已停止，合成凭据文件已自动删除；双端点 fixture 正常退出并通过。
