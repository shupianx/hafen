# 系统隧道原型

当前 Android 已在 API 37 模拟器通过真实系统 TUN → sing-box gVisor → Shadowsocks / VLESS REALITY Vision 的 TCP、UDP、DNS 验证。
iOS TestFlight 构建 8 已由用户确认真机可连接。Android 真机和双端完整发行验收仍待完成。

## 使用与边界

应用的“手动测试节点”支持 Shadowsocks / aes-128-gcm，填写服务器 **域名或 IP**、端口和密码。
应用申请系统 VPN 授权后启动；密码不持久化，成功提交后清空输入。停止或进程被系统结束后，不自动恢复连接。
现已支持订阅下载、受限格式解析和节点选择；见 [订阅说明](subscriptions.md)。

Go 适配支持 SS AEAD、Trojan/VLESS TLS、WS、gRPC 与 VLESS Reality/Vision 子集；本地服务端实际握手和 TCP 回显已验证。
iOS 构建 8 在安装 VPN 路由前通过系统 DNS 解析选中节点，最多 5 秒；系统 DNS 不保证加密。内核随后使用会话内 hosts 结果，不再依赖直连公共 DoH 来启动代理。重连重新解析，原域名和 TLS/REALITY 参数保留。
Android 节点解析仍使用受保护 bootstrap DoH（1.1.1.1，证书名 cloudflare-dns.com）。两种节点引导方式均不承担业务网站 DNS。
TLS 节点使用匹配证书的 server_name，不能关闭证书验证；Reality 使用服务器公钥验证。
全局 IPv4/IPv6 默认路由进入 TUN，MTU 1500，接口地址为 172.19.0.1/30 与 fdfe:dcba:9876::1/126。
系统 DNS 指向接口的 .2 / ::2 地址；sing-box 将 DNS 通过所选代理发送到 Cloudflare DoH（1.1.1.1，证书名 cloudflare-dns.com），不配置直连回退。
当前 DNS 服务固定，尚无自定义设置；IPv6 实际转发和泄漏测试仍待完成。

“隧道已连接”表示系统接口和内核已经启动；`internetReachable` 保持 null，不能据此判断节点能访问公网。
暂未提供自动重连、分应用代理、规则模式、流量速率或断线阻断（kill switch）。关闭隧道后恢复系统正常网络。
出站保护失败时拒绝该连接；这不是断线阻断功能。

## Android

`HafenVpnService` 独立于 RN 界面持有 TUN、sing-box 和两个数据包线程。使用带断开操作的前台通知，
不支持始终开启/无人值守重启。启动命令只携带随机请求 ID，凭据在同进程临时请求中传递，使用后释放引用。

- 每次连接确认 `VpnService.prepare()`；前台界面才能发起连接。
- 优先选择默认物理网络；每个内核出站 socket 先 protect，再绑定该物理网络。
- 默认接口来自 ConnectivityManager；网络刷新不依赖 Android 应用中可能失败的 Go 网卡枚举。底层接口变化仍需重新连接。
- 使用系统 TUN 的非阻塞 fd；读线程通过短时 poll 等待，写线程从有界 Go 包队列读取。
- 停止、撤权、启动失败和底层网络丢失时取消 core、结束读写、关闭 fd、移除通知与监听器。
- 当前网络丢失时停止；不承诺无缝 Wi-Fi/蜂窝切换。撤权与网络丢失路径仍需更多设备实测。
- 重复启动拒绝；重复停止幂等；启动即取消和无效配置失败均已检查无残留 TUN / 服务。

## iOS

`HafenTunnel` target 只链接 HafenCore，不运行 React Native。宿主使用 `NETunnelProviderManager` 管理系统配置，
通过 `startTunnelWithOptions` 传递本次节点；providerConfiguration 和偏好设置不保存密码。
没有启动参数时从宿主与扩展共享 Keychain 读取上次选中的节点，以支持系统 VPN 开关重连；不启用按需连接。

扩展调用 `setTunnelNetworkSettings` 和公开的 `packetFlow.readPackets/writePackets`。
原始 IP 包进入 Go `PacketSession` 的 gVisor channel endpoint；不读取私有 fd、不使用 KVC，也不改动上游协议实现。
出站使用 Network Extension 的底层网络路径；关闭会中断待取包操作。路径不可用时停止，不自动重连。

真机测试前在 Xcode 为 Hafen 与 HafenTunnel 选择同一开发团队，为两个 App ID 启用 Network Extension 能力，
核对各自 provisioning profile。若修改宿主 bundle ID，同时将扩展 ID 改为“宿主 ID.PacketTunnel”。
相关 entitlements 已加入工程。模拟器明确返回 VPN 不可用；编译成功不能代替真机的路由、后台与内存验收。

## 验证与复现

常规检查：`npm test`、`npm run typecheck`、`npm run lint`、`npm run core:test`。
Go 测试使用第二个上游 gVisor 栈模拟设备包，验证 IPv4 TCP/UDP、保护失败拒绝转发、关闭中断等待及重复清理。
编译依赖 `with_gvisor,with_utls,with_quic` 标签，构建脚本已设置。

Android 模拟器的端到端测试使用 `core/mobile/fixture_test.go`：显式设置 HAFEN_TUNNEL_FIXTURE 才运行，
默认测试会跳过。它在主机 127.0.0.1:29391 开启随机密码的 SS 节点，29392 提供 TCP/UDP 回显，五分钟后退出并删除临时参数文件。
仅允许将 198.18.0.1:29392 转到本机回显，以及访问 1.1.1.1:443 验证 DoH；其余目标拒绝。
模拟器客户端通过 10.0.2.2 访问主机。测试节点先自行检查 SS 回显，不使用真实订阅。

`npm run vpn:smoke -- state|prepare|start|stop|lifecycle` 对连接 Metro 的 Android Debug 应用执行真实桥接调用。
默认端口 8093，使用 HAFEN_METRO_PORT 修改。start/lifecycle 必须提供 HAFEN_TEST_PROFILE，指向上述临时 JSON 文件。
prepare 的系统弹窗需在模拟器允许；lifecycle 会实际启停 VPN，结束后必须检查返回 disconnected、服务与 tun0 均消失。
TCP/UDP 回显、DNS 查询和后台转发的实测结果见 verification.md；这套桥接脚本本身不等同于流量测试。

参考：[Android VPN 文档](https://developer.android.com/develop/connectivity/vpn)、
[Apple NEPacketTunnelFlow](https://developer.apple.com/documentation/networkextension/nepackettunnelflow)。
