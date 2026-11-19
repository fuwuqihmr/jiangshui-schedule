# iOS 端（1.3.1 基线 · 未完成）

本目录是「江水课表」的 iOS 工程：WKWebView 壳 + 原生能力层（EventKit / UserNotifications /
Keychain / Network.framework 等），2026-11-19 从团队 iOS 快照接入主仓
`fuwuqihmr/jiangshui-schedule`。源码按快照原样保留，只做了脱敏改写（清单见文末「接入记录」）。

## 当前状态

- 版本：`MARKETING_VERSION = 1.3.1` / `CURRENT_PROJECT_VERSION = 48`。**未完成、未上架。**
- 已验证（Windows，仅静态）：`tools/gen-pbxproj.mjs` 在本仓布局下幂等（生成前后 pbxproj sha256 一致）；
  工程结构/契约检查在 1.3.1 快照内曾记录 48/48（见 [docs/AUDIT.md](docs/AUDIT.md)）。
- **未验证**：本机没有 Xcode / swiftc，Swift 一行都没有在本仓编译过；未签名、未真机、未 TestFlight。
  编译、签名、运行时行为只能在 Mac 上补证。
- 本仓的 `web/`、`android/` 已推进到 1.5.0，而 iOS 桥接契约钉在 1.3.1 时代；因此**在主仓里跑 iOS
  静态检查/自测会出现契约漂移与共享层基线两类失败**，见「已知缺口」。这属于 iOS 端未完成的部分，
  不影响 Android/web 侧。

## 与仓内 web/ 的关系

`project.yml` 用 `- path: ../web` 以 folder reference 引用**仓库根**的共享 web 层，构建时整目录打包进
App bundle（bundle 内路径仍是 `web/...`）。**不要在 `ios/` 下复制第二份 web 源码**；改共享 web 层时
要同时考虑 iOS 桥接（iOS 目前有 35 个 MUST action + 9 个 S 档降级 action）。

## Mac 构建入口

```bash
brew install xcodegen
cd ios && xcodegen generate     # project.yml 是唯一事实来源
node ios/tools/gen-pbxproj.mjs  # 不装 XcodeGen 时用仓内生成器重建 pbxproj（Windows 可跑，幂等）
open Jiangshui.xcodeproj        # 选 Team 签名后 Run / Archive
xcodebuild -scheme Jiangshui -destination 'platform=iOS Simulator,name=iPhone 15' build
```

接手顺序、首跑核对清单与常见编译错误见 [docs/MAC-RUNBOOK.md](docs/MAC-RUNBOOK.md)（接入前的历史文档，
路径已脱敏，打包/克隆步骤以本 README 为准）；完整交付说明见 [README-iOS.md](README-iOS.md)；
CI 编译记录见 [docs/BUILD-LOG.md](docs/BUILD-LOG.md)。

## S 档补丁（1.5.0）

[docs/patches/s-tier-1.5.0.patch](docs/patches/s-tier-1.5.0.patch) 是把 iOS 追平 1.5.0 S 档的变更留档
（考试三字段透传、`onNativeProgress`、`onLeaveServiceReturn`、9 个可选 action 的诚实降级）。
**未编译验证，需 Mac 应用/验证**。本快照源码已包含该补丁对应的改动，补丁用于追溯、以及需要在更早
1.3.1 基线上重建时使用——不要对当前源码重复应用。设计说明见 [docs/S-TIER-1.5.0.md](docs/S-TIER-1.5.0.md)。

- 归档补丁 sha256：`aa11fa577c67c5de3c02cd1604ef221dbfe98a5174b115ab71f742e077e148ec`
  （源补丁 `b23cd33723770b686b679b3337c81d212637129d075c4fca6a8581ef9e6fcea4`；差异仅为内部仓库名前缀
  `a/<team-repo>/ios/` → `a/ios/` 共 5 处归一，便于在仓根直接 `git apply`）。

## 更新规则

- 版本号：`ios/project.yml` 与 `ios/Jiangshui.xcodeproj/project.pbxproj` 中的 `MARKETING_VERSION` /
  `CURRENT_PROJECT_VERSION` 单独维护（本次接入**不改版本号**）；Android/web 版本仍以仓根 `package.json` 为准。
- 新增/删除 Swift 文件后必须重跑 `node ios/tools/gen-pbxproj.mjs`（或 `xcodegen generate`），否则工程漏文件。
- 桥接契约：`ios/docs/IOS-PORT-CONTRACT.md` 是 action 与参数契约的单一事实来源，改动需三向对齐
  （契约文档 / Android `MainActivity.java` / iOS `BridgeDispatcher.swift`）。
- 上传门禁：`tools/upload-allowlist.txt` 已放行 `/ios/**`；`.gitignore` 已排除 Xcode 用户数据（`xcuserdata/`、
  `*.xcuserstate`）与本地构建输出（`DerivedData/`、`build/`、`ios/build-out/`）。

## 已知缺口（未验证项）

1. **action 契约漂移**：主仓 `android/` 已有 44 个 action，iOS MUST 契约仍是 35 个；
   `tools/check-ios.mjs` 的 B2/B4/B5 在主仓会失败（iOS 侧尚未追平 1.5.0 的 action 集合）。
2. **共享层基线**：`tools/check-ios.mjs` 的 E1/E2 钉死 1.3.1 快照的 `web/`+`android/`
   （182 文件 / `1ea23688954ba6631a98c31aca4c62b593815da5052965434bd057ac6718cbdd`）；
   主仓当前是 185 文件 / `a8280102aa9af7caec29daa011b6eae24402b285519298b60ebc48fc2beb848e`，在主仓会失败。
   是否把基线改为跟随主仓，需要单独定夺（本次接入不做）。
3. 在主仓执行 `node --test ios/tests/`：73 项中 10 项失败，全部来自上述两条漂移（B2/B4/B5、E1/E2、
   full-suite 对 48/48 与退出码 0 的断言）。Android/web 侧根仓 `npm test`（507/507）与
   `node tools/check-upload-scope.mjs` 不受影响。
4. Mac 编译/签名/真机（EventKit 日历写入、通知与后台刷新、教务真实读取、S 档补丁）全部未验证；
   App Store 审核（4.2 / 4.3(b)）未走。
5. 团队快照里的 iOS CI（GitHub Actions macOS）未随本次接入迁移，主仓暂无 iOS 构建工作流。

## 接入记录（2026-11-19）

- 来源：团队 iOS 快照 `ios/`，80 文件 / 1,745,571 B。原样复制为仓内 `ios/`，排除 `.git`、
  `.DS_Store`、构建产物与 DerivedData（快照中本来就没有这些）。
- 脱敏改写 8 行（真实用户名 2 处、内部工程绝对路径 5 处、内部交接文档路径 1 处），详见本目录
  `docs/` 中对应文件；接口/行为未改动。
- S 档补丁内部仓库名前缀 5 处归一后归档；新增本 README 与 `docs/patches/s-tier-1.5.0.patch`。
- 版本号、`web/`、`android/`、`harmony/` 均未改动。
