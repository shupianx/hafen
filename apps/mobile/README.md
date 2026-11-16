# Hafen Mobile

React Native 0.88.1 的 Android / iOS 原生宿主。

从仓库根目录执行 `npm ci`、`npm run core:bootstrap`，然后按目标平台执行
`npm run core:android` 或 `npm run core:ios`，再启动 `npm start` 与原生应用。
iOS 需先在此目录执行 `bundle install`，再进入 `ios` 执行 `bundle exec pod install`。

当前包含：首页、订阅地址新增/列表/删除、输入校验、TurboModule、Android Keystore 加密存储、
iOS Keychain 存储及 Android 系统授权桥接。双端宿主编译和模拟器存储流程已通过验证。
sing-box 移动绑定提供版本查询、受限节点配置校验和本机加密 TCP 自检。
Android 已实现 VpnService 与手动 SS 测试节点连接；真实系统 TUN 的 TCP/UDP/DNS 与后台 TCP 已在模拟器通过。
iOS Packet Tunnel Extension 已编译，需带 Network Extension 签名的真机测试。订阅下载、受限节点解析与选择入口已实现。
当前范围与操作说明见 [系统隧道原型](../../docs/vpn-prototype.md)。

根目录运行 `npm run android:preview` 可生成内置 JS、不可调试的优化测试 APK，无需 Metro。使用发行版依赖、代码与资源裁剪及原生库压缩，签名仍为公开开发密钥；不可作为正式发行签名。
验证记录和构建注意事项见 [验证说明](../../docs/verification.md)。

完整方案见 [项目说明](../../README.md) 与 [原生接入计划](../../docs/native-integration.md)。
应用标识和图标暂为开发占位，正式发行前需要确定；Android release 未配置发行签名。

订阅功能现支持手动 HTTPS 更新、粘贴配置、节点列表和选择连接。
具体格式与限制见 [订阅说明](../../docs/subscriptions.md)，测试结果见 [验证记录](../../docs/verification.md)。

节点服务器已支持域名与 IP；TLS、WS、gRPC、VLESS Reality/Vision 的支持范围见订阅说明。
引导解析使用受保护的 Cloudflare DoH，应用 DNS 继续经代理。
