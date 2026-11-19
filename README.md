# Hafen

基于 React Native 的开源 Android / iOS 代理订阅客户端，采用 sing-box（Go 内核）。

## 当前状态

项目已完成双端宿主、原生桥接与订阅下载、节点解析与安全存储，**Android 已通过模拟器系统 VPN 转发测试，iOS TestFlight 构建 8 已由用户确认真机可连接**。
目标是开源发布双平台客户端；不内置代理服务器、不销售订阅。

已完成依赖安装，通过 14 项领域/桥接契约测试、应用 TypeScript 检查和 ESLint。
Android Debug / Preview 与 iOS 模拟器 Debug 均编译成功，双端模拟器已验证保存、去重、并发防重、
重启恢复与删除。Android Preview 内置 JS，可脱离 Metro 启动；Android 真机与双端完整发行验收仍待完成。

- 添加、列出与删除 HTTPS 订阅地址；拒绝重复地址和不合法输入。
- Android 使用 Keystore AES-GCM 加密文件；iOS 使用本机 Keychain，不同步到 iCloud。
- 列表只显示名称和域名，原生返回值不包含完整订阅 URL 或令牌。
- Android：系统授权、前台 VpnService、TUN 与出站保护；模拟器 TCP/UDP/DNS、后台 TCP 与启停清理通过。
- iOS：宿主管理和独立 Packet Tunnel Extension；公开 packetFlow 接入，TestFlight 构建 8 用户确认可连接。
- sing-box 1.14.4：固定源码校验值和构建工具，提供真实配置校验与本机加密 TCP 自检。
- 手动连接入口暂限 Shadowsocks / aes-128-gcm、域名或 IP；节点参数仅用于本次连接。
- 支持 HTTPS 下载和粘贴导入 Clash YAML、sing-box JSON、URI / Base64 节点列表的受限子集。
- 节点凭据原生加密存储，JS 只收列表元数据；更新失败保留旧节点，过期版本拒绝连接。
- 支持域名节点：iOS 在安装 VPN 路由前使用系统 DNS 解析节点；Android 使用受保护的 Cloudflare DoH。应用 DNS 均经代理。
- 支持 Trojan/VLESS 的 TLS、WS、gRPC，以及 VLESS Reality / Vision；仍采用明确的字段子集。
- 支持 Hysteria2，包括 Salamander、带宽参数、端口跳跃和整证书 SHA-256 固定；继续验证系统证书链与域名。
- 不支持的协议/传输参数会跳过，规则、订阅 DNS、策略组不导入。
- 未完成 Android 真机、完整 IPv6、长时间运行和正式发行验收。

- [订阅格式、使用方式与限制](docs/subscriptions.md)
- [系统隧道原型、使用范围与真机准备](docs/vpn-prototype.md)
- [产品范围、架构与里程碑](docs/architecture.md)
- [原生内核接入与验收](docs/native-integration.md)
- [技术选型来源与许可证](docs/decisions.md)
- [构建、模拟器验证与已知边界](docs/verification.md)
- [TestFlight 内部测试与签名归档](docs/testflight.md)
- [sing-box 内核绑定与构建](core/README.md)

## 工程原则

1. React Native 负责界面与交互；原生服务负责 VPN 生命周期；Go 内核负责网络转发。
2. 系统 VPN 与内核都就绪才能报告已连接。JS 被挂起或界面退出不能终止已建立的隧道。
3. 订阅属于不可信输入。下载、解析、内核校验成功后才原子更新节点缓存；运行中的连接不自动切换。
4. 订阅 URL、节点密码、控制接口令牌不进入普通日志和版本库。
5. 采用开源发布路线。sing-box 版本、commit、构建工具链固定在 core/upstream.lock.json。

## 当前目录

```text
apps/mobile/            React Native 应用及 Android / iOS 宿主
packages/domain/        平台无关的数据类型、校验和业务逻辑
core/                   sing-box 移动绑定、固定版本、原生构建产物
docs/                   架构、平台接入、里程碑与技术来源
```

不提交第三方内核源码缓存或预编译库；记录来源、版本、校验值及完整构建步骤。
诊断平台适配保留其上游版权和许可声明。

## 开发

Node 24.3+（24.x），或满足根目录 `engines` 的版本。RN 固定为 0.88.1；内核构建固定 Go 1.26.1。

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run core:bootstrap
npm run core:test
npm run core:android  # 默认当前机器架构；校验通过则直接复用现有产物
npm run core:ios      # 真机 arm64 + 当前机器架构的模拟器；macOS + Xcode
npm start
```

另开终端，配置好 Android SDK / JDK 后运行 `npm run android`。
iOS 需安装 Ruby 3.2+，先在 `apps/mobile` 执行 `bundle install`，然后在其 `ios` 子目录执行 `bundle exec pod install`，
再回到仓库根目录执行 `npm run ios`。签名和真机 VPN 测试另见原生接入文档。
iOS 会分别生成主程序使用的 HafenHost 与 VPN 扩展使用的 HafenCore，保留配置校验和自检能力，避免主程序携带数据包引擎。

生成无需 Metro 的 Android 开发预览包：

```sh
npm run android:preview
adb install -r apps/mobile/android/app/build/outputs/apk/preview/app-preview.apk
```

Preview 使用发行版依赖、代码与资源裁剪，内置 JS 且不可调试；仍使用公开开发签名，仅供测试。正式发行需要私有签名与发行验收。
为缩小直接分发的 APK，Preview 压缩原生库，安装时由系统解压；安装占用不会按相同比例缩小。
`android:preview` 会清理 app 构建目录后重新打包，避免增量 APK 残留空隙，保留依赖与 Go 缓存。
`npm test` 可在未安装依赖时运行，覆盖领域层；它不代表原生应用或 VPN 已经通过验收。

### 控制构建占用

`npm run android`、`npm run android:preview`、`npm run ios` 会先校验内核的源码、固定依赖、
构建参数及产物 SHA-256。未变化时复用 AAR / XCFramework，不再次运行 Go 编译。
已有全架构产物可供单架构开发复用；不会为缩小现有产物而强制重编译。

- Android 日常安装使用 RN 的 `--active-arch-only`，仅编译连接设备的 ABI。
- Preview 默认当前机器架构；Apple Silicon 为 arm64-v8a，Intel 为 x86_64。
  若连接的设备与电脑架构不同，使用 `npm run android -- --arch=arm64` 或 `--arch=amd64`。
- iOS 开发固定使用 `build/ios/Simulator`。内核框架的架构布局变化时，开发入口会重新运行
  `bundle exec pod install` 更新 CocoaPods 的复制脚本，因此仍需按前文安装 Ruby/Bundler。
- 多架构内核用 `npm run core:android:all`、`npm run core:ios:all`；多架构预览包用
  `npm run android:preview:all`。正式 Android 发布前，先生成全架构内核。

```sh
npm run core:android -- --check    # 只校验现有产物，不构建
npm run core:ios -- --check
npm run core:android -- --force    # 确实需要时才强制重编译
npm run test:build                # 构建缓存与入口的回归测试
npm run clean:build               # 只列出可清理目录和体积
npm run clean:build -- --apply    # 无编译进程时删除 Go / iOS 中间缓存
```

清理仅覆盖 `core/.cache/build`、`build/ios/Simulator`、`build/ios/DerivedData` 及旧的
`build/simulator`。保留内核产物、Go 模块下载、Pods、npm 依赖和 `.xcarchive` 发布归档。
清理后，未变化的内核仍能直接复用；下次原生 App 编译会重新生成相应中间文件。

## 开源

项目新增代码采用 [GPL-3.0-only](LICENSE)。官方 RN 模板保留其 MIT 许可，见
[第三方声明](THIRD_PARTY_NOTICES.md)。sing-box 保留上游 GPLv3-or-later 声明；后续发行需要随实际依赖补全许可清单。
