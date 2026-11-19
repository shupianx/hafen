# TestFlight 内部测试

已验证可连接的测试版本：`0.1.0 (8)`；体积优化构建为 `0.1.0 (9)`。宿主标识 `com.coolab.hafen`，扩展标识 `com.coolab.hafen.PacketTunnel`。
目标为开发者本人通过 TestFlight 测试；上传选项为 Internal Only，不提交外部测试或 App Store 上架。

2026-11-18 构建 9 已上传成功，Xcode 返回 `Uploaded Hafen` / `EXPORT SUCCEEDED`。等待 Apple 处理后再安装测试；尚未完成构建 9 的用户真机回归。未压缩归档 App 从 70.27 MiB 降至 66.01 MiB，下载大小以 Apple 报告为准。

2026-11-16 构建 1–8 均已上传成功，用户随后确认构建 8 可以接通。构建 9 拆分主程序/扩展绑定，并恢复 Hermes 的 Release 依赖选择；需要再次测试订阅、节点连接、系统开关和「检查连接」。后续新归档使用 `10` 或更大的构建号。
构建 8 修复生产核心的默认网卡监视器与网络暂停状态；iOS 在安装 VPN 路由前使用系统 DNS 解析节点，解析结果只存于本次会话，业务 DNS 仍经代理。该版随后由用户确认真机可以接通。构建 9 不改变这些网络策略；网络切换仍需手动重连。
用户此前确认构建 6 仍连接失败，Shadowrocket 同节点正常。构建 7 增加分阶段诊断；尚未取得用户手机的构建 7 分阶段结果，未把 DNS 依赖认定为已确认的手机故障根因。
构建 4 修复诊断 boolean JSON、增加系统 VPN 状态事件及共享 Keychain 节点恢复；构建 5 进一步让拨片在 disconnecting 时立即关闭，该修正已包含在构建 6。更新后先从 App 连接一次以保存节点，再测试系统开关关/开及「检查连接」。VPN 实际转发故障尚待真机有效检测结果。
构建 3 补全 iOS 全流量路由和旧配置迁移，修复包读取异常的关闭处理，新增「检查连接」。尚未确认用户真机 VPN 故障已解决；更新后断开重连，再记录节点 HTTPS、系统 HTTPS 和包计数结果。
构建 2 将订阅卡片动画与拖动移到 UI 线程，并避免 VPN 状态相同时首页重复渲染；重点在 ProMotion 真机对比卡片拖动与列表滚动，尚未完成实际 120Hz 测量。
当前仍需在 App Store Connect 确认处理结果、完成所需加密信息，并将构建与本人账号加入内部测试组。
上传有第三方预编译框架 dSYM 缺失警告，影响部分崩溃符号解析，不影响本次上传成功。

## 归档与上传

在 Xcode → Settings → Accounts 登录付费开发者账号。宿主和扩展都需要启用 Network Extensions（Packet Tunnel）能力。
工程保留模拟器默认标识；归档脚本通过 `HAFEN_BUNDLE_ID` 同时设置宿主与扩展，避免两者不匹配。

在仓库根目录执行：

```sh
export HAFEN_TEAM_ID=837CU37KL9
export HAFEN_BUNDLE_ID=com.coolab.hafen
export HAFEN_VERSION=0.1.0
export HAFEN_BUILD_NUMBER=12
npm run ios:archive
npm run ios:upload
```

`ios:archive` 构建签名的真机 Release 归档，包含 JS 和 Packet Tunnel 扩展，不依赖 Metro。
上例输出为 `build/ios/Hafen-12.xcarchive`，此前归档保留在 `build/ios/`。脚本拒绝覆盖已有归档；后续上传应增加构建号。
脚本会生成 HafenCore 与 HafenHost 两套框架，并检查 Hermes 配置切换脚本。若旧本地 Debug tarball 来源仍被 CocoaPods 缓存，应移除 `HERMES_ENGINE_TARBALL_PATH` 后运行 `bundle exec pod update hermes-engine --no-repo-update`，不能用调试依赖代替发行依赖。
`ios:upload` 先核对宿主/扩展标识、版本、JS 包和签名，再使用 Xcode 登录态上传到 App Store Connect。
Xcode 可以自动管理描述文件与分发签名，但账号权限、协议、证书服务或认证过期仍可能需要账号持有人在 Xcode 中处理。
不需要在代码仓库中保存账号密码、私钥或 App Store Connect API 密钥。

App Store Connect 需要与 `com.coolab.hafen` 对应的 App 记录。若尚无记录，在“我的 App → ＋ → 新建 App”创建：

- 平台：iOS；名称：Hafen（若已被占用，选择可用名称）。
- 主要语言：简体中文；Bundle ID：`com.coolab.hafen`。
- SKU：`hafen-ios`（账号内唯一即可）。

上传成功不等于可立即安装：等待 Apple 处理，完成构建要求的信息，再到 TestFlight 创建内部测试组、添加当前账号和构建。
在 iPhone 安装 Apple TestFlight，使用对应 Apple 账号接受测试邀请。

## 加密信息

本应用嵌入 sing-box/Go 加密实现，用于代理协议和 TLS/QUIC，不只有 Apple 操作系统提供的 HTTPS。
未添加 `ITSAppUsesNonExemptEncryption=false` 来跳过申报。上传后按 App Store Connect 的实际问题填写，是否需要文档以 Apple 对该应用的分类为准。
外部测试/公开发行另行准备隐私政策、测试说明和审核材料；Apple 的 VPN 审核条款包括组织开发者及数据使用声明要求。

## 建议测试内容

1. 首次打开正常显示拨片开关，点击「订阅」右侧的 ＋ 可添加订阅，卡片顶部下滑可关闭。
2. 更新订阅、选择节点、允许系统 VPN 配置，开关与系统 VPN 状态一致；连接 A 时点 B 自动重连到 B，切换中关闭开关应保持断开。
3. 检查网页/DNS、前后台切换、锁屏、Wi-Fi/蜂窝切换，以及断开后的网络恢复。
4. 若失败，记录机型、iOS 版本、协议、复现步骤和屏幕上的错误；反馈中不要粘贴订阅令牌或节点密码。

构建 8 用户已确认真机可以接通；构建 11 包含此前体积优化、节点选择持久化与连接中点选切换。升级后先断开并重新点选一次节点，再关闭 App、从系统 VPN 开关连接，回 App 核对实际节点名称和转发。

参考：[上传构建](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)、
[内部测试](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/)、
[测试构建加密信息](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds/)、
[VPN 审核条款 5.4](https://developer.apple.com/app-store/review/guidelines/#vpn-apps)。
