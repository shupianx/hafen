# 第三方声明

订阅卡片的关闭图标来自 Google Material Symbols，应用将其转换为 PNG 并着色。[Close Rounded 原图标](https://icon-sets.iconify.design/material-symbols/close-rounded/) · [Apache 2.0 许可](https://www.apache.org/licenses/LICENSE-2.0)

订阅详情的删除图标由 480 Design 创作，应用将其转换为 PNG 并着色。[Solar 原图标](https://icon-sets.iconify.design/solar/trash-bin-trash-outline/) · [CC BY 4.0 许可](https://creativecommons.org/licenses/by/4.0/)

## UI 线程动画与手势

- 固定 `react-native-reanimated 4.7.1`、`react-native-worklets 0.13.1`、`react-native-gesture-handler 3.5.0`；npm 官方来源与 integrity 在 package-lock.json。
- 上游：[Reanimated / Worklets](https://github.com/software-mansion/react-native-reanimated)、[Gesture Handler](https://github.com/software-mansion/react-native-gesture-handler)。未修改上游源码。
- 保留 MIT 原文：[Reanimated](docs/licenses/react-native-reanimated-LICENSE.txt)、[Worklets](docs/licenses/react-native-worklets-LICENSE.txt)、[Gesture Handler](docs/licenses/react-native-gesture-handler-LICENSE.txt)。
- 原生模糊使用 [React Native Blur](https://github.com/sbaiahmed1/react-native-blur)，节点拖动使用 [React Native Reorderable List](https://github.com/omahili/react-native-reorderable-list)。[Blur MIT 许可](docs/licenses/react-native-blur-LICENSE.txt)、[Reorderable List MIT 许可](docs/licenses/react-native-reorderable-list-LICENSE.txt)。

测速卡片使用 [Google 和 YouTube 图标](https://github.com/gilbarbara/logos/tree/main/logos)、[GitHub 网站图标](https://github.githubassets.com/favicons/favicon.png)、[X 网站图标](https://abs.twimg.com/favicons/twitter.3.ico)、[Claude 网站图标](https://claude.ai/favicon.ico) 和 [ChatGPT 网站图标](https://chatgpt.com/cdn/assets/favicon-48x48.7d42b2e65f.png) 标识测速目标。品牌及标志属于各自权利人。

## React Native Community Template

- 来源：`@react-native-community/template@0.88.1`，npm 官方注册表。
- 下载包：<https://registry.npmjs.org/@react-native-community/template/-/template-0.88.1.tgz>
- SHA-512 integrity：`sha512-bFGQpjZ7RrH4+ZXgkPnbOXR87db49uoFRue3GuGOQOGDpev0a7z3/QY+DG79Z1vo7P1dcRZgWgY618mZfPDdFQ==`
- 已在展开前核对最终下载文件的 integrity。
- 许可证：[MIT 原文](docs/licenses/react-native-template-MIT.txt)。原模板源码版权声明保留。
- 修改：应用名替换为 Hafen；适配 npm workspace；替换欢迎页；移除示例测试；发行构建不使用调试签名。

CLI 下载耗时较长，本次使用同一官方模板直接展开并按 template.config.js 中的占位符规则生成工程。

本文件目前记录已引入的模板来源，不是未来发行包的完整依赖清单。React、React Native、
safe-area-context 及其传递依赖的许可证保留在对应软件包中；发行前需生成完整声明。

## sing-box

- 已选择 sing-box，替代原先 mihomo 候选；未包含 mihomo 源码/二进制。
- 来源：<https://github.com/SagerNet/sing-box/releases/tag/v1.14.4>。
- commit：`c005f35300ce76427dc285481ec5695f5b179cd2`。
- Go 模块校验值和构建工具版本：[上游锁文件](core/upstream.lock.json)。
- 许可证：GPL-3.0-or-later，保留 [上游 LICENSE](docs/licenses/sing-box-LICENSE.txt)，包含名称使用声明。
- 下载的 sing-box 模块未修改；Hafen 适配代码和受限协议注册位于 `core/mobile`。
- `core/mobile/diagnostic_platform.go` 改编自该版本的 `experimental/libbox/config.go` 平台 stub，保留上游许可。
  修改：重命名类型、使用不访问系统路由的空监控器。配置检查与本机诊断直接使用；
  packetPlatform 继承无操作默认项，明确覆盖实际包接口和必须成功的 socket 保护，网络变化由原生处理。
- 绑定工具：SagerNet/gomobile v0.1.12；来源 <https://github.com/SagerNet/gomobile>。

Go 传递依赖固定在 `core/go.sum`，各依赖保持自身许可证。这里并非完整发行 SBOM；发行前需按实际构建
依赖生成完整许可和对应源码清单。Hafen 新增代码保持 GPL-3.0-only。

## gVisor 用户态网络栈

- 使用 sing-tun 已固定的 `github.com/sagernet/gvisor v0.0.0-20260727.0-sing-box-mod.1`，未修改上游源码。
- 来源：<https://github.com/SagerNet/gvisor>；许可 Apache-2.0，见 [LICENSE](docs/licenses/gvisor-LICENSE.txt)。
- 版本与模块校验值在 core/go.mod / core/go.sum；通过 with_gvisor 构建标签启用。
- Hafen 只适配原生数据包队列和生命周期，不自行实现 TCP/IP 或代理协议。

## Go YAML

- 官方维护仓库：<https://github.com/yaml/go-yaml>，固定 `go.yaml.in/yaml/v3 v3.0.6`。
- 模块校验值保存在 core/go.sum；未修改上游源码。
- 使用 YAML AST 解析订阅，应用另行限制别名、深度、文档数量与节点字段。
- MIT / Apache-2.0，保留 [原始许可声明](docs/licenses/go-yaml-LICENSE.txt)。

## uTLS / Reality

- 随固定 sing-box 依赖启用 `github.com/metacubex/utls v1.8.7`（with_utls）；未修改上游源码。
- 来源：<https://github.com/MetaCubeX/utls>；[BSD 许可](docs/licenses/utls-LICENSE.txt)、[dicttls 许可](docs/licenses/utls-dicttls-LICENSE.txt)。
- 新增传递依赖版本与校验值记录在 core/go.mod / core/go.sum，发行前依旧需要完整 SBOM。
- Vision 使用上游 sing-vmess 对 Go/uTLS 结构的适配。测试保留 race detector，仅对
  `github.com/sagernet/sing-vmess/vless` 关闭不兼容的 checkptr 插桩；未关闭其他包的指针检查。
  该上游实现依赖 TLS 内部字段布局，升级 Go / sing-box / uTLS 时必须重新做真实握手与转发验证。

## Hysteria2 / QUIC

- 随固定 sing-box 启用 `github.com/sagernet/sing-quic v0.7.2-0.20261020082049-7e0a5869a5f4`、`github.com/sagernet/quic-go v0.61.0-sing-box-mod.12`，构建标签 `with_quic`。
- 保留 [sing-quic GPL 许可](docs/licenses/sing-quic-LICENSE.txt) 和 [quic-go MIT 许可](docs/licenses/quic-go-LICENSE.txt)；新增传递依赖版本与校验值记录在 core/go.mod / core/go.sum。
- `core/mobile/hysteria2_outbound.go` 改编自 sing-box v1.14.4 `protocol/hysteria2/outbound.go`，保留上游版权与 GPL-3.0-or-later 声明。
  修改：只对带整证书 SHA-256 指纹的受限配置增加公开 TLS VerifyPeerCertificate 回调；保持正常证书验证、受保护拨号、上游 QUIC 收发与生命周期清理。无指纹节点仍使用上游 outbound。
- 未修改模块缓存中的上游源码；未自行实现 Hysteria2 或 QUIC 协议。

## AnyTLS

- 使用 sing-box 固定的 [sing-anytls v0.0.11](https://github.com/anytls/sing-anytls/tree/v0.0.11)。上游采用 GPL-3.0-or-later，见[原始许可声明](docs/licenses/sing-anytls-LICENSE.txt)。
