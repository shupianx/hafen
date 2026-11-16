# 技术决策与来源

核对日期：2026-11-15。

## 已确认：采用 sing-box

用户已确认采用成熟的 sing-box 内核，停止自研内核和 mihomo 主线接入。
基线选择官方稳定版 v1.14.4；不使用 testing 分支或尚未验证的 1.15 特性。
Hafen 自有代码只负责配置策略、平台适配、生命周期和界面，不重写代理协议或 TCP/IP 栈。
版本来源：[官方发行](https://github.com/SagerNet/sing-box/releases/tag/v1.14.4)。

订阅格式与运行内核分离。后续支持节点导入后生成应用控制的 sing-box 配置；
不承诺保留任意 Clash YAML 的策略组、DNS 和规则语义。导入未支持字段必须报错，不能静默降级。
sing-box 的配置/平台 API 随版本演进，升级必须重新验证构建、配置和网络测试。

v1.14.4 的 libbox OpenTun 接口接收 fd；这不自动满足 iOS 的公开 packetFlow 接入约束。
需先验证适配方案，不通过 KVC 读取私有 fd，也不把参考客户端存在视为我们的发行路径已通过验证。

以下 Clash 记录保留为选型历史，不再代表当前实施方案。

## Clash 是否开源

原版 Clash 曾以 GPLv3 发布，Clash Premium 是另一条闭源产品线，不能把二者混为一谈。
原仓库当前无法正常取得，不建议新项目依赖原版持续维护。可优先评估 Clash 系衍生核心 mihomo。

本次直接核对了 mihomo `Meta` 分支与 `v1.19.30` tag 中的 LICENSE，均为 GNU GPL version 3。
搜索引擎对仓库默认分支的摘要存在与代理核心不一致的结果，因此选型依据是实际分支/tag 的源文件，
不是搜索摘要中的许可证标签。`v1.19.30` 是本次核查样本，不表示项目已经锁定、下载或集成此版本。

- [mihomo Meta 分支 README](https://raw.githubusercontent.com/MetaCubeX/mihomo/Meta/README.md)
- [mihomo Meta 分支 LICENSE](https://raw.githubusercontent.com/MetaCubeX/mihomo/Meta/LICENSE)
- [mihomo v1.19.30 LICENSE](https://raw.githubusercontent.com/MetaCubeX/mihomo/v1.19.30/LICENSE)
- [GNU GPLv3 正文](https://www.gnu.org/licenses/gpl-3.0.html)

## 本项目的开源方向

用户已选择开源发布。项目新增代码选择 GPL-3.0-only；实际引入 mihomo 时保留作者声明、
许可证、第三方许可清单及完整对应源码/构建脚本。许可证精确 SPDX 标识与第三方头部声明需随最终依赖确认。
未锁定内核依赖前，不把其依赖全部描述为统一许可证，也不声称应用已经完成发行合规。RN 模板保留 MIT 许可。

GPL 允许收费和商业使用；将核心库紧密集成进应用并分发，不能仅因添加 RN 外壳或使用跨进程调用就认定可以闭源。
本项目按整体开源设计。应用商店分发条款与 GPL 的兼容性需在发行前另行核实，开源本身不保证 App Store 可上架。

## 移动端边界

- [Android 官方 VPN 开发文档](https://developer.android.com/develop/connectivity/vpn)：VpnService、授权、TUN fd、protect 与生命周期。
- [Apple NEPacketTunnelProvider](https://developer.apple.com/documentation/networkextension/nepackettunnelprovider)：packetFlow 与独立扩展。
- [Apple 文档 Markdown](https://developer.apple.com/documentation/networkextension/nepackettunnelprovider.md)：公开 API 与 entitlement 说明。
- [Apple App Review Guidelines 5.4](https://developer.apple.com/app-store/review/guidelines/#vpn-apps)：VPN 应用的组织账号、隐私与地区要求。
- [React Native 开发环境](https://reactnative.dev/docs/set-up-your-environment)：双端构建工具链要求。

选择 bare React Native 是工程判断，不意味着其他 UI 框架或自定义 Expo 构建无法实现 VPN。
本项目采用原生包转发与 Go 核心、JS 控制面分离的结构，是为了使 VPN 生命周期独立于 RN 界面。
