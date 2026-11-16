# 原生接入契约与验收

已实现订阅存储、核心绑定、Android VpnService 与 iOS Packet Tunnel 原型。
Android 已通过模拟器真实流量测试；iOS TestFlight 构建 8 已由用户确认真机可连接，完整发行验收仍待完成。详见 [当前原型](vpn-prototype.md)。

## 已实现：NativeHafenPlatform

Codegen 定义位于 `apps/mobile/specs/NativeHafenPlatform.ts`。Android 使用 Kotlin，iOS 桥接使用
Objective-C++（宿主仍为 Swift）。`packages/domain/src/platform.ts` 校验返回值并统一错误信息。

| 方法 | 当前行为 |
| --- | --- |
| getEnvironment | 返回平台、桥接版本、实际链接的 sing-box 版本及授权状态；内核加载与隧道可用性分别报告 |
| prepareVpn | Android 系统授权；iOS 真机保存系统 VPN 配置，模拟器返回 VPN_UNAVAILABLE |
| startVpn(profile) | 本次受限节点参数启动；凭据不持久化。Android 就绪后返回，iOS 请求启动后由系统状态确认 |
| stopVpn / getVpnState | 停止并清理 / 原生状态快照；internetReachable 当前为 null |
| listSubscriptions | 返回 ID、名称、域名、创建时间，不返回完整 URL |
| saveSubscription | 校验名称与 HTTPS URL、拒绝完全相同的地址、保存后返回元数据 |
| deleteSubscription | 按 ID 删除，重复删除幂等 |
| checkCoreProfile | 原生调用受限配置检查，再由 sing-box 创建节点对象；不启动隧道 |
| runCoreSelfTest | 原生执行本机 Shadowsocks 加密 TCP 往返诊断；不代表 VPN 已连接 |

两端均限制最多 50 条记录、名称 64 个 UTF-16 单元、URL 8192 个 UTF-16 单元。原生再次校验输入，
不只依赖 JS。每个模块的存储操作串行执行，避免连续点击导致覆盖或重复保存。
Android 文件位于 `noBackupFilesDir`，使用 Keystore AES-256-GCM 与 AtomicFile；密钥丢失或密文损坏时
返回错误而非清空已有数据。iOS 将记录保存在 `AfterFirstUnlockThisDeviceOnly` Keychain 项中，关闭同步。
完整订阅仍只供宿主使用；选中节点另存于宿主/扩展共享 Keychain，允许系统 VPN 开关恢复上次节点。

订阅链接输入时会经过 JS 内存；成功保存后清空输入框。原生查询/事件不回传凭据，异常仅传稳定代码。
卸载应用不是两端统一的删除契约，尤其 iOS Keychain 可能保留记录；删除订阅请使用应用内删除操作。

## 后续完整客户端接口规划

完整订阅客户端计划依赖 `VpnClient` 接口；当前原型使用上表的 NativeHafenPlatform，内核、系统权限、私有文件位置不暴露给界面组件。
接口使用异步命令、状态快照与订阅事件。Go 层只导出可绑定的标量、字节或 JSON；
不把 Go map/interface/channel 直接放入跨语言签名。

| 命令 | 行为 |
| --- | --- |
| capabilities | 返回平台、是否集成、内核版本及支持的操作 |
| getSnapshot | 从原生服务/系统查询当前状态，不使用 JS 缓存冒充 |
| start(profileId) | 原生校验配置、申请权限、启动内核和隧道；UI 等待状态事件 |
| stop | 停止转发、关闭内核和 TUN、移除前台通知，幂等 |
| setMode(mode) | 原生串行更新；成功后返回已应用快照 |
| selectProxy(group, proxy) | 验证组和节点存在，应用后确认 |
| testDelay(proxy) | 受限并发、可取消/超时的连通性测试 |
| subscribe(listener) | 监听原生状态；返回取消订阅函数 |

凭据不进入快照；错误以稳定代码传递，详细日志在原生侧脱敏并限量。

## Android

1. 通过 `VpnService.prepare()` 每次确认授权状态；处理用户拒绝、Activity 重建和授权撤回。
2. 启动符合目标 SDK 要求的前台服务与通知，正确配置 manifest 的权限和服务声明。
3. 配置 TUN 地址、MTU、IPv4/IPv6 路由和 DNS；管理 `ParcelFileDescriptor` 的所有权。
4. 原生持有 TUN fd，数据包通过 Go PacketSession；内核出站先 protect 再绑定物理网络。
5. 当前底层网络丢失时关闭隧道，之后手动重连；数值 IP 节点不依赖引导 DNS。
6. `onRevoke`、停止、启动失败、服务退出都释放 core、fd、通知和监听器。

不使用“只开本地 HTTP/SOCKS 端口”替代全设备 VPN。分应用代理、始终开启 VPN 等在基本转发稳定后再加入。

## iOS

1. 创建宿主和独立 Packet Tunnel Extension target；配置 Network Extension entitlement 与签名；当前临时节点参数不需要 App Group。
2. 宿主通过 `NETunnelProviderManager` 加载/保存配置并启动隧道；观察系统状态。
3. 扩展使用 `NEPacketTunnelProvider.setTunnelNetworkSettings` 配置路由与 DNS。
4. 通过公开 `packetFlow.readPackets/writePackets` 路径接入数据包适配层，再接 sing-box。
   已实现 gVisor channel endpoint 适配并编译，不调用 libbox 的 fd 接口；真机运行仍待验证。
5. 选择验证可行的静态库/XCFramework 产物，覆盖真机与所需模拟器架构；不下载执行动态内核。
6. Go 内核在扩展中运行，不能依赖宿主 RN 进程存活。限制日志、连接、规则数据与 Go 内存使用，实测扩展资源限制。
7. startTunnelWithOptions 传递本次节点；系统无 options 启动时从共享 Keychain 读取上次节点。构建 8 在安装路由前完成节点系统 DNS 解析，原始节点与认证参数不变。
8. 原生向 Go 默认网卡监视器提供出站绑定的实际网卡名称和索引；同接口路径变化通知内核重置连接，接口丢失或切换先发布 network lost 再关闭隧道，暂不自动重连。
9. 停止、失败和前台恢复均查询系统状态；诊断包含 networkAvailable/networkPaused，断开错误仅显示固定代码。iOS packet session 设置 Go 40 MiB 软内存预算和 GOGC=50，这不保证扩展不会被系统回收。

不使用 KVC 获取未公开 tunnel fd 等私有实现作为发行方案。

## 最小实测矩阵

| 情况 | 预期 |
| --- | --- |
| 用户拒绝 VPN 权限 | 保持未连接，允许重试，不遗留内核或接口 |
| 无效配置 / 不支持的协议 | 启动前报可操作错误，原有有效配置保留 |
| 正常节点 | 独立验证 TCP、UDP、DNS，以及规则命中与出口地址 |
| IPv4、IPv6、双栈、IPv6-only | 明确定义 IPv6 转发或阻断行为，不允许静默绕过 |
| 快速点击启停 / 同时切配置 | 无重复 core、悬空 fd 或错误的已连接状态 |
| Wi-Fi 切蜂窝 / 断网恢复 | 系统和 UI 状态一致；恢复后连接可用 |
| 退后台 / 锁屏 / 宿主重启 | 按平台生命周期保持或恢复真实状态 |
| 系统撤销 VPN / 启动另一 VPN | 释放资源并更新 UI |
| 订阅下载超时 / 错误跳转 / 文件过大 | 中止更新，旧配置可用，错误不含订阅令牌 |
| 隧道启动后内核失败 | 不显示已连接；连接与路由清理按设计完成 |
| 长时间运行 | 观察内存、耗电、CPU、网络唤醒与日志增长 |

测试节点使用环境注入或本地私有文件；CI 不提交真实订阅。UI 单元测试不能替代上述真机网络验收。

## 订阅原生接口（已实现）

- `listSubscriptionNodes(id)`：只返回节点摘要；未导入时返回 JSON null。
- `refreshSubscription(id)`：原生读取 URL，HTTPS 下载、解析、内核校验后原子提交；失败保留旧 bundle。
- `importSubscription(id, content)`：同一解析与提交路径，支持用户粘贴内容。
- `startSubscriptionNode(id, revision, nodeId)`：从原生安全存储获取凭据，校验版本后启动；不向 JS 返回 profile。

两端共用 Go 解析和下载器；存储操作串行，停止命令可取消排队的连接请求。当前更新不热切换运行中的隧道。
详见 [订阅说明](subscriptions.md)。
