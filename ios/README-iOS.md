# 江水课表 · iOS 端

本目录是 `江水课表` 的 iOS 实现（WKWebView 壳 + 复用 `../web/` 的 36 个纯 ES Module + 原生能力层）。

> **想先弄懂代码怎么组织？** 看 [docs/CODE-MAP.md](docs/CODE-MAP.md) —— 写给不懂编程的人：整体构造、目录地图、两条核心链路（读课表 / 请假）的分步说明、35 个 Swift 文件逐个一句话、数据存在哪、改代码的 6 条规矩。

> **状态：已编译通过并在 iPhone 15 Pro 模拟器（iOS 17.0）里真实启动、进入主界面**（GitHub Actions macOS runner / Xcode 15.4，
> Debug 与 Release 均 BUILD SUCCEEDED，模拟器步骤用 `simctl` 启动并截图）。
> 界面已按平台能力裁剪：权限面板只显示 iOS 真有的项（通知）；返回键改为左边缘右划手势，不再有压住标题的浮动按钮
> （run #12 截图已验证：两页标题均无遮挡、权限弹窗只剩「通知」一行）。
> 顶部白条改为 A 方案（2026-10-30）：RootView 底层铺 `shellBackgroundColor`，WebView 只让开底边、顶边落在安全区下沿，`WebHost` 用 `clipsToBounds` 物理裁剪并同步 `--bg`；不再依赖 CSS 遮挡状态栏。
> P3 请假深链与定位 shim 已实现（`SchoolLeaveSessionController.swift`、`SchoolGeolocationBridge.swift`），上传文件选择器按 P3 偏离预留未接线；均未编译、未真机。
> **P2 教务真实读取已实现（2026-10-29）**：登录 → 恢复 → 读课表 → 假条同步，代码见 `Jiangshui/School/SchoolReadController.swift`
> 与 `LeaveRecordsService.swift`，设计与真机验证清单见 `docs/P2-SCHOOL-READ.md`。**已编译通过**（Debug / Release / 真机 iphoneos 三条链路均 BUILD SUCCEEDED、0 error，未签名 IPA 已产出，见 `docs/BUILD-LOG.md` 第 10 轮），**但还没用真实学校账号跑通**。
> **2026-10-30 真机首跑问题已修**：登录成功后循环「课表已在后台更新，请稍后重试」的保存冲突已加三层兜底（boot 保留磁盘 revision / 冲突自愈重试 / -1 强制保存），并修 P2 四条运行期问题（needLogin 取消死线、SSO 重挂 90s、onDismissed 取消读取、onPageFinished 再抓会话；`loadState` 显式回包只是防御，不是根因）。改动尚未重新编译/重签，待 CI + 真机复跑验证，详见 `docs/P2-SCHOOL-READ.md` §10。
> **2026-10-30 P3 进展**：顶部白条 A 方案、P2 无头核对（`alpha=0.01` / 禁止交互 / 仅 `needLogin` 转可见）、请假十步深链、定位 shim 已落源码；上传因 `runOpenPanelWith` 仅 iOS 18.4+ 而预留未接线。静态门禁已扩到 **46 项**（F11 无头、F12 请假/上传/定位），仍未编译、未真机。
> 但**未签名、未连真机、未走 TestFlight**，仍不是可上架产物。
> 证据见 `docs/BUILD-LOG.md`（含每轮退出码、截图内容、修掉的运行期 bug）。本机是 Windows，没有 Xcode / swiftc；
> 所有编译与运行证据都来自 CI，不要当成已验证可上架。

## 1. 它是什么

| 层 | 复用/新写 | 说明 |
|----|-----------|------|
| UI + 业务逻辑 | **复用** `../web/` | 与 Android 完全同一套 ES Module，282 项 Node 测试锁住 |
| JS ↔ 原生桥 | **新写**，与 Android 逐字等价 | 35 个 action，见 `docs/IOS-PORT-CONTRACT.md` §2/§3 |
| 页面承载 | **新写** loopback HTTP 服务 | `127.0.0.1:47851`；因为 `type="module"` + 顶层 `fetch` 在 `file://` 下不工作 |
| 原生能力 | **新写** EventKit / UserNotifications / UIDocumentPicker / Keychain | 与 Android 的日历、通知、SAF、KeyStore 一一对应 |
| 教务抓取 | **P2 已实现（待真机验证）** | 登录 → 恢复 → 读课表 → 假条同步，见 `docs/P2-SCHOOL-READ.md`；P1 时代的算法蓝图留在 `docs/PHASE2-SCHOOL.md` |

与 Android 的能力差异（已在代码注释与契约中登记）：桌面小组件、小米专注模式、精确闹钟、自启动设置 —— iOS 无等价实现。

## 2. 在 Mac 上跑起来（三步）

```bash
# 1) 生成 Xcode 工程（project.yml 是唯一事实来源；pbxproj 是生成物，可丢弃）
brew install xcodegen
cd ios && xcodegen generate

# 2) 打开并设置签名
open Jiangshui.xcodeproj
#   Signing & Capabilities → Team 选你的个人开发者账号（Bundle ID cn.local.tomorrow 可加后缀避免冲突）

# 3) 先模拟器，后真机
xcodebuild -scheme Jiangshui -destination 'platform=iOS Simulator,name=iPhone 15' build
```

只想拿工程文件、不装 XcodeGen 时，也可以直接 `open Jiangshui.xcodeproj`（已由 `tools/gen-pbxproj.mjs` 生成），
但**改文件后要重新生成**，否则会漏文件：

```bash
node tools/gen-pbxproj.mjs
```

## 3. 第一次运行时必须核对的清单（Mac 侧）

1. **loopback 服务**：控制台应打印实际端口；`http://127.0.0.1:<port>/index.html` 能被 WebView 加载。
   ATS：`Info.plist` 已设 `NSAllowsLocalNetworking` + `127.0.0.1` 例外。
2. **localStorage origin**：端口固定 47851 就是为让 `jiangshui-theme` 等键跨启动保留；端口漂移会导致主题/引导态丢失（不致命，但要知道原因）。
3. **桥接**：设置页应出现「上课提醒」「导出日历」等只有 `globalThis.Android` 存在才渲染的区块 —— 不出现就说明 shim 注入失败。
4. **返回/滑回**：模态框打开时返回键应先关模态框（由 `web/app.mjs` 的 `__dsjOnBack` 决定）。
5. **权限文案**：日历、通知、定位、相册、相机、麦克风六类系统弹窗的中文说明来自 `Resources/Info.plist`（共 7 个用途键），需真机确认措辞。
6. **导出**：`exportFile` 的 PNG/PDF 经 `UIDocumentPickerViewController` 落盘；`import` 读回 ≤2MB UTF-8 JSON。
7. **教务线（P2 已实现）**：首次点「读取学校课表 / 立即核对」会打开学校页面要求登录；登录完成后自动恢复→读取→回填。
   成功应看到真实课表与「最近核对」时间；会话过期会走一次 SSO 自动恢复，仍失败则保留上次课表并提示重新登录。
   详见 `docs/P2-SCHOOL-READ.md`（含四阶段状态机、已知差异、真机验证清单）。

## 4. 目录

```
ios/
  project.yml                     XcodeGen 工程定义（事实来源）
  Jiangshui.xcodeproj/            生成物
  Jiangshui/
    App/                          App 生命周期、RootView(WKWebView 宿主)、返回逻辑
    Web/                          loopback 静态服务、MIME、WebHost、JSBridge、35-action dispatcher
    Services/                     同意/状态/主题/通知/上课提醒/日历/文件/诊断/权限/Keychain/登出
    School/                       教务 P2/P3（URL 白名单、学校 WebView、无头读取、请假深链、定位、文件选择器预留）
    Resources/                    Info.plist、PrivacyInfo.xcprivacy、Assets.xcassets
  tools/
    gen-pbxproj.mjs               生成 project.pbxproj（Windows 可跑）
    check-ios.mjs                 静态检查（Windows 可跑，替代不了的只有编译）
  tests/                          Node 侧桥接契约测试
  docs/
    IOS-PORT-CONTRACT.md          桥接与架构契约（唯一事实来源）
    PHASE2-SCHOOL.md              教务抓取移植交接稿
    SHELL-NOTES.md                壳层实现说明与 Mac 待核对项
```

## 5. 静态验证（Windows 上就能跑）

```bash
node ios/tools/gen-pbxproj.mjs     # 幂等重建工程文件
node ios/tools/check-ios.mjs       # 结构与契约检查，必须 0 fail
node --test ios/tests/*.test.mjs   # 桥接契约测试
```

## 6. 上架相关（沿用交接包结论）

个人开发者 ¥688/年、必须有 Mac + Xcode、国内联网需 ICP 备案；本 App 走壳路线，审核上要注意 **4.2 Minimum Functionality**
（靠日历写入、本地通知、导出这些原生能力做差异化）与 **4.3(b) 同质化**。详细成本见
原团队交接包文档《个人开发者上架 iOS 与鸿蒙对比-2026》（未随此仓库提供）。

## 6. 自检（Windows 上可跑，全绿）

```bash
# 工程文件生成物（幂等，可反复跑；改完 .swift 必须重跑）
node tools/gen-pbxproj.mjs

# 静态门禁：46 项检查（工程一致性 / 35 action 三向对齐 / 协议 conformance / plist / 桥接逐字 / 共享层基线哈希 / F10-F12 白条·无头·请假定位）
node tools/check-ios.mjs

# 校验器自身的回归测试：52 项
node --test ios/tests/
```

当前结果（2026-10-30）：`check-ios` **46/46 ok，0 fail**；`node --test ios/tests/` **52/52 pass**；`node --test tests/*.test.mjs`（web）**282/282 pass**；
`web/`+`android/` 基线哈希 `1ea23688954ba6631a98c31aca4c62b593815da5052965434bd057ac6718cbdd`（182 文件；相对接手时的变化是 `web/app.mjs` 权限面板平台化 + `web/state-sync.mjs` 保存三层兜底，Android 行为不变）。
详细逐项证据见 `docs/AUDIT.md`；误报记录（8 类）见同文件 §4；服务层已知差异见 `docs/AUDIT-APPENDIX-SERVICES.md`；
本轮整合结论与 Mac 首跑清单见 `docs/INTEGRATION-REPORT.md`。

> 注意：以上全部是**静态**检查。它们不能替代 `xcodebuild` 编译，也不能证明 WKWebView 运行时行为。

## 7. 不用开发者账号，怎么装到真机上（未签名 IPA 路线）

CI 除了模拟器编译，还会产出一份**未签名**的真机包：

1. 打开 Actions → 最近一次成功的 run → **Artifacts** 里下载 `jiangshui-unsigned-ipa`（另一个 `ios-build-logs` 是日志与截图）。
2. 用 **爱思助手（i4）/ Sideloadly** 的「IPA 签名」功能，登录你自己的 **免费 Apple ID**（普通账号即可，不需要 ¥688 的开发者计划）。
3. 签名后 USB 连 iPhone 安装。首次需在 iPhone「设置 → 隐私与安全性 → 开发者模式」打开并重启。
4. 免费账号的限制：签名 **7 天过期**（到期重签一次即可）、同一时间最多 3 个自签 App、每周最多 10 个 App ID。
5. 要长期使用 / TestFlight / 上架，仍然需要 Apple 开发者计划（¥688/年）+ 证书与描述文件。

> 这条路线只用于**真机验证**（左边缘手势、通知、后台刷新、Keychain），不是发布渠道：未签名 IPA 不能直接安装，App Store 也不接受重签产物。
>
> P3 真机注意：请假附件按钮在 iOS 18.4 以下按设计无响应（`runOpenPanelWith` 不可用）；定位走 `navigator.geolocation` shim + `jiangshuiGeo`，只在 https 的 xgxt 页面生效，需在真实请假页验证授权弹窗与回包。

