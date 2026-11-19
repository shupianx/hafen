# Hafen sing-box 适配

采用上游 sing-box v1.14.4，源码 commit / Go 模块校验值 / 构建工具版本在 `upstream.lock.json`。
没有 fork 或重写协议实现。Hysteria2 整证书指纹通过公开 TLS 回调校验，协议收发仍由固定版本 sing-quic 执行。
`mobile/` 提供配置限制、生命周期和移动绑定；诊断平台 stub 改编自
上游配置检查代码，修改与版权来源记录在第三方声明中。

## 当前范围

- `Info()`：读取实际链接的 Go 模块版本，返回协议注册范围和独立的隧道可用标记。
- `CheckProfile(json)`：限制输入字段，然后由 sing-box 真正创建/校验节点对象；不启动连接或隧道。
- `NewPacketSession(profile, protector)`：创建 sing-box TUN 入站与 gVisor channel endpoint；原生调用 SubmitPacket / NextPacket 传递原始 IP 包，Close 幂等关闭并中断等待。
- `StartPacketSessionBeforeRoutes(profile, protector)`：iOS 在安装 VPN 路由前用系统 DNS 解析选中节点，最多 5 秒；原域名、TLS SNI、REALITY 和传输参数保持不变，重连重新解析。
- `SocketProtector` 提供实际 `InterfaceName/InterfaceIndex`；`RefreshNetwork` 通知同网卡路径变化，`NetworkLost` 在拆除前通知网络丢失。更换物理网卡仍关闭后手动重连。
- `SelfTest()`：本机随机端口运行 sing-box Shadowsocks 客户端/服务端，验证加密 TCP 往返并清理。
  只访问 127.0.0.1，使用随机凭据，不读取用户订阅。不能替代 VPN、UDP、DNS 或公网验收。

首批配置适配只开放 Shadowsocks AEAD（aes-128-gcm / aes-256-gcm / chacha20-ietf-poly1305）、
Trojan/VLESS over TLS、WebSocket、gRPC（上游 lite 实现），VLESS Reality / Vision，
以及 Hysteria2（Salamander、带宽、端口跳跃、整证书 SHA-256 固定）；Shadowsocks 暂不支持插件与 2022。
这只是 Hafen 的接入子集，不代表 sing-box 本身缺少这些能力。未知协议/字段明确报错。
TLS 证书验证不能关闭；不接受订阅自定义监听地址、控制接口、本地文件或可执行内容。

原生桥接保留稳定错误代码，不向 JS 返回凭据、生成的配置或上游异常原文。
核心自身不创建系统 VPN，Info 中的 `tunnelAvailable` 仍为 false。原生层的 `vpnAvailable` 报告平台能否启动系统 VPN；
实际连接状态通过 getVpnState 返回，不能由核心版本或包计数推断公网可达。

## 构建

需要锁定的 Go 1.26.1，以及 Android SDK/NDK/JDK 或完整 Xcode。所有工具与缓存放在本目录被忽略的子目录，
不改全局 Go 配置。保持 Go checksum database 启用。
构建和测试均启用 `with_gvisor,with_utls,with_quic`，使用 sing-box 固定依赖的 SagerNet/gvisor，不另写 TCP/IP 协议栈。
脚本固定 gomobile 与 gobind 版本；不运行会安装 `gobind@latest` 的上游 init。

仓库根目录运行：

```sh
npm run core:bootstrap
npm run core:test
npm run core:android
npm run core:ios
```

在两端 Debug App 已连接到同一 Metro 后，运行 `npm run core:smoke` 检查实际原生桥接。
默认端口 8093，可用 `HAFEN_METRO_PORT` 修改；脚本会报告本次实际检测到的平台，
只连接一端不能视为双端通过。它不保存订阅或连接公网节点。

Android 只支持 arm64-v8a / x86_64；日常默认仅构建当前主机架构，可传 `--arch=arm64`、
`--arch=amd64` 或 `--arch=all`，也可用 `HAFEN_CORE_ARCH` 设置默认值。iOS 默认构建设备 arm64
和当前主机架构的模拟器；`--arch=all` 包含两种模拟器架构。
Android 输出 `artifacts/android/hafen.aar`，iOS 输出 `artifacts/ios/HafenCore.xcframework`。
`core:ios` 同时生成主程序专用的 `artifacts/ios-host/HafenHost.xcframework`；也可以用 `core:ios:host` 单独构建。
宿主库绑定 `host/`，使用 `hafen_host,with_utls,with_quic`，不编译 PacketSession、TUN 或 gVisor。
订阅处理、四种协议的真实配置构造校验与本机加密自检仍复用 `mobile/`，没有改成仅检查 JSON。
因此它仍包含出站协议和 Go 运行时，并非只有订阅解析器。完整库继续供 iOS VPN 扩展和 Android 使用。
两套 iOS 框架只能分别链接到宿主与扩展，不应同时链接到同一个进程。
原生产物不进版本库；manifest 记录源码、工具版本、构建参数、目标架构及产物 SHA-256。
先构建内核，再构建 RN 应用；iOS 生成框架后在 `apps/mobile/ios` 执行 `bundle exec pod install`。

重复执行构建命令会先校验 manifest。源码、依赖和构建参数未变且所有产物哈希匹配时，
直接复用已有结果；覆盖所需架构的全架构产物也可复用。测试文件的变化不会触发原生库重编译。
`--check` 仅做只读校验，不下载依赖或构建；`--force` 强制重建。
新产物先在临时目录编译并校验，失败时保留之前可用的产物。Go 编译命令通过
`core/.build.lock` 串行化；异常终止留下锁时，须确认锁内 PID 已退出后再删除锁文件。

本机旧版 manifest 的一次性迁移：`npm run core:android -- --adopt-legacy` 或
`npm run core:ios -- --adopt-legacy`。仅用于原先脚本生成的全架构产物：核对旧源码清单、
上游锁、全部文件哈希和实际架构后补录新构建参数，不重新编译。不对未知来源的二进制使用此选项。
普通构建不会自动信任缺少构建参数的旧 manifest。

仓库根目录的 `npm run clean:build` 先预览可重建缓存，附加 `-- --apply` 才清理。
清理保留 `artifacts/`、`.tools/` 和 `.cache/go/`，不会影响已验证内核的后续复用。

Go 测试含真实本机 socket；受限沙箱可能需要允许本机网络。网络受限时可用 `GODEBUG=http2client=0`
重试官方模块下载，不能关闭校验或随意更换源码。不得用未验证来源的 AAR/XCFramework 替换。

## 平台隧道

Android：原生 VpnService 持有 TUN fd，独立线程通过 PacketSession 传包，出站 protect 并绑定物理网络。
iOS：独立 Packet Tunnel Extension 使用公开 packetFlow API，PacketSession 实现 sing-tun 的 GVisorTun 接口。
上游 v1.14.4 libbox OpenTun 要求 fd，不能直接认为其签名支持公开 packetFlow；不使用 KVC 读取私有 fd。

Android 模拟器的真实 TCP/UDP/DNS 与后台 TCP 已通过；iOS 仅完成扩展编译。
订阅下载/解析已完成；本机 Trojan/VLESS TLS、WS、gRPC、Vision、Reality TCP 回显通过。
尚需商业服务端兼容、完整 IPv6、网络切换和双端真机后台/内存验收。
详见 `../docs/vpn-prototype.md`。

上游许可见 `../docs/licenses/sing-box-LICENSE.txt` 与 `../THIRD_PARTY_NOTICES.md`。
发行时还需提供匹配版本的全部对应源码、构建脚本、依赖许可证及我们自己的修改；产物哈希不替代源码交付。

## 订阅适配

`FetchSubscription` / `ParseSubscription` 返回仅供原生安全存储使用的受限节点 bundle（含凭据）。
`SubscriptionSummary` 显式移除 profile，`SubscriptionProfile` 按 revision / node ID 取出连接参数。
下载和解析边界、协议允许列表及复现方式见 [订阅说明](../docs/subscriptions.md)。
新增依赖固定官方 Go YAML v3.0.6；详细许可证见第三方声明。

iOS 构建 8 起，节点域名在安装 VPN 路由前通过系统 DNS 解析，地址只存于本次会话；系统 DNS 不保证加密。Android 继续通过受保护的 bootstrap DoH 解析节点；
用户 DNS 仍通过代理到 remote DoH，没有直连回退。新适配会解除旧 bundle 的域名限制标记。
Vision 的上游指针检查例外与升级要求见 [第三方说明](../THIRD_PARTY_NOTICES.md)。
