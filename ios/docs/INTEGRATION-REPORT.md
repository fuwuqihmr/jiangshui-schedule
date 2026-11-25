# 江水课表 · iOS 端 P1–P3 整合报告

生成时间：2026-10-27（Asia/Shanghai）；2026-10-30 同步 P3 与 46 项门禁
生成者：Team Lead（5 人小队：shell / services / school / verifier / lead）
适用范围：`course-change/ios/` 全目录

> **一句话结论：P1（壳 + 原生能力 + 35 action 桥接 + 教务安全骨架）与 P2/P3（真实读取、无头核对、请假深链、定位）已静态交付并通过 46 项静态门禁；
> 但整份 iOS 代码从未编译过 —— 本机是 Windows，没有 Xcode / swiftc。**

---

## 1. 交付物

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| Swift 源文件 | 35 个（P1 28 个；P2 新增 SchoolReadController / LeaveRecordsService；P3 新增 SchoolLeaveSessionController / SchoolGeolocationBridge / SchoolLocationPermission / SchoolFilePicker） | 全部 < 720 行/文件，无第三方依赖 |
| 工程文件 | `Jiangshui.xcodeproj/project.pbxproj`（生成物） | 由 `tools/gen-pbxproj.mjs` 扫描磁盘生成，幂等 |
| 工程声明 | `project.yml` | XcodeGen 可用；与 pbxproj 常量一致 |
| 静态门禁 | `tools/check-ios.mjs` 46 项 | 退出码 0 = 全绿 |
| 可侧载产物 | `Jiangshui-unsigned.ipa`（CI artifact） | 未签名，供爱思助手 / Sideloadly 用免费 Apple ID 重签后装真机 |
| 门禁回归测试 | `tests/` 52 项 | `node --test ios/tests/` |
| 文档 | 6 份 | CONTRACT / AUDIT / AUDIT-APPENDIX-SERVICES / SHELL-NOTES / PHASE2-SCHOOL / 本报告 |

目录结构：

```
ios/
├── project.yml                      # XcodeGen 声明（若装了 xcodegen 可用它重新生成）
├── Jiangshui.xcodeproj/             # 生成物：不要手改，改完源码重跑 tools/gen-pbxproj.mjs
├── Jiangshui/
│   ├── App/          JiangshuiApp.swift / AppEnvironment.swift / RootView.swift / NotificationPresenter.swift
│   ├── Web/          LocalServer.swift / WebAssets.swift / JSBridge.swift / BridgeDispatcher.swift / WebHost.swift
│   ├── Services/     ServiceProtocols.swift（契约）/ NativeServices.swift（容器）+ 13 个服务实现
│   ├── School/       SchoolURLPolicy / SchoolWebViewHost / SchoolProvider / SchoolReadController / LeaveRecordsService / SchoolLeaveSessionController / SchoolGeolocationBridge / SchoolLocationPermission / SchoolFilePicker（未接线）
│   └── Resources/    Info.plist / PrivacyInfo.xcprivacy / Assets.xcassets / AppIcon-1024.png
├── tools/            gen-pbxproj.mjs / check-ios.mjs
├── tests/            52 项 node --test
└── docs/             6 份文档
```

## 2. 架构（与 Android 1:1 的对应关系）

| 层 | Android | iOS（本目录） |
| --- | --- | --- |
| UI/业务 | `web/`（ES Module 共享层，282 项 Node 测试） | **原样复用**；相对接手时仅 `web/app.mjs` 平台化与新增 `web/state-sync.mjs` |
| 页面承载 | `WebView` + `shouldInterceptRequest` 伪 origin `https://app.local/` | loopback HTTP 服务 `NWListener` 绑定 `127.0.0.1:47851..47860`，只读 GET/HEAD |
| JS↔原生 | `addJavascriptInterface(..., "Android")` + `request(id, action, payload)` + `window.onNativeResult` | `WKScriptMessageHandler("jiangshuiBridge")` + 注入 `window.Android` shim + `evaluateJavaScript("window.onNativeResult(...)")` |
| action 数 | 35 | **35**（三向逐字一致，含顺序） |
| 同意门 | 4 个免同意 action | 同 4 个，错一个就不一致 |
| 返回键 | `onBackPressed` 先问 `window.__dsjOnBack` | `WebHost` 先 evaluate `__dsjOnBack`，未消费再回退导航 |
| 前台恢复 | `onResume` → `window.onNativeResume()` | `scenePhase == .active` → 同函数 |
| 状态持久化 | `StateStore` + UserDefaults/文件 | JSON 文件 `state.json`，`expectedRevision` 语义一致 |
| 会话保管 | `SessionVault` + AndroidKeyStore + AES 文件 | Keychain（`cn.local.tomorrow.school-session`） |
| 日历 | `CalendarSync` + CalendarProvider | EventKit，local source 的「江水课表」日历 |
| 通知/提醒 | `NotificationCards` / `ClassReminders` / `CheckScheduler` | UNUserNotificationCenter + 本地排程 |
| 文件导入导出 | SAF + base64 桥 | UIDocumentPicker + UIDocument 导出 |
| 桌面小组件 | `ScheduleWidgetProvider`（4 个） | **无等价**（登记为差异） |
| 精确闹钟/自启动/小米专注 | 有 | **无等价**（`exactAlarm.required=false`、`battery.exempt=true`、`autostart.supported=false`） |
| 教务抓取 | `MainActivity.beginSchoolRead` 等 6 个 action | **P2 已实现**：`SchoolReadController` 四阶段状态机（restore→ssoRecover→portal/profile→read）+ `LeaveRecordsService` 假条直连同步；URL 安全策略 1:1 移植。见 `docs/P2-SCHOOL-READ.md` |

## 3. 验证结果（可复跑）

```bash
# 在 course-change/ios 下（Windows 无 node 时用 DSH 自带 node）
node tools/gen-pbxproj.mjs      # 幂等；连跑两次 sha256 相同
node tools/check-ios.mjs        # 46 项 ok 46 / fail 0 / exit 0
node --test ios/tests/          # 52 tests / 52 pass / 0 fail
```

| 检查 | 结果 |
| --- | --- |
| 工程一致性（A1-A10） | pbxproj 可解析、UUID 唯一、35 个 .swift 全在 Sources、Resources 4 项、`$(...)` 全部带引号、Info.plist 不参与编译 |
| action 对齐（B1-B7） | 契约 §3 = MainActivity.java switch = BridgeDispatcher.swift，35/35 集合与顺序一致；免同意白名单 4 项一致；未知 action 回「不支持的操作」 |
| 协议闭合（C1-C8） | 15 个协议各有实现、SessionVaulting 唯一、13 个容器成员一致、41 个调用点参数标签全匹配、import 仅系统框架、桥接三文件无强解包 |
| plist（D1-D7） | Info.plist/PrivacyInfo/Assets 合法；ATS 7 域（含 5 教务域 insecure、无 ArbitraryLoads）；BGTask 2 个 id；后台 fetch+processing；日历/定位/相册/相机/麦克风 7 条中文文案 |
| 共享层受控改动（E1-E2） | `web/`+`android/` **182 个入库文件**，sha256 `1ea23688…18cbdd`；相对接手时的改动是 `web/app.mjs` 权限面板平台化 + 新增 `web/state-sync.mjs` 保存三层兜底（Android 行为不变，web 282 项测试全绿） |
| 桥接逐字（F1-F12） | 端口区间、handlerName、shim 文本、onNativeResult 形状与去重、`__dsjOnBack` 表达式、onNativeResume、同意门文案、sync→capture、project.yml 常量、白条 A 方案、无头核对、请假/上传/定位资产 |
| **真实编译（CI）** | P2 已通过：GitHub Actions `macos-14` + Xcode 15.4 上 `xcodebuild ... -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO` → `** BUILD SUCCEEDED **`，0 error / 1 warning；产物 `Jiangshui.app` 5.9 MB。**P3（白条/无头/请假/定位）尚未编译**。证据见 `docs/BUILD-LOG.md` 第 10/11/12 轮 |

**门禁可信度自测**：删掉 `App/RootView.swift` 后 check-ios 立刻掉到 42/2（A4+A5 红），恢复后回到全绿 —— 证明不是空跑；该变异自测执行于 44 项版本，F10–F12 另有删除/改写断言的变异验证（见 AUDIT.md §4）。

## 4. 本轮做出的关键决策

1. **承载方式**：不用 `file://`、不用自定义 scheme —— `type="module"` 与顶层 `fetch`（`web/app.mjs:40-41`、`consent.mjs:2`、`background.mjs:6`）在 WKWebView 里只有 HTTP origin 才可靠。
2. **permissionStatus 双映射**：`exactAlarm:{required:false}`、`battery:{exempt:true}`。（2026-10-29 更新：已改为能力驱动 —— `exactAlarm/battery/autostart` 都带 `supported:false`，`web/app.mjs` 按 `supported!==false` 裁剪三行，权限面板现在只剩「通知」一行；Android payload 无该字段，行为不变。）
3. **SessionVaulting 只允许一个实现**：归 `Services/SchoolSession.swift`（Keychain），避免 duplicate conformance。
4. **登出入口**：`NativeServices.handleLogout() -> JSONObject`，dispatcher 只依赖协议，不 import 具体类。
5. **教务 P1 桩**（已被 P2 取代，2026-10-29）：`openSchool(mobile:false)` 现在走 `capture()`；`capture/sync` 走 `SchoolReadController` 四阶段状态机，`leaveRecordSync` 走 `LeaveRecordsService` 的 URLSession 直连。见 `docs/P2-SCHOOL-READ.md`。
6. **A 层（App/）补了前台通知 delegate**：否则 `previewClassReminder` 在 App 前台看不到横幅。

## 5. 已知差异与残余风险（诚实清单）

**静态可确证的产品缺陷：0 个。** 以下都是「需要 Mac/真机才能定性」的项：

| # | 项 | 风险 | Mac 上怎么验 |
| --- | --- | --- | --- |
| 1 | ~~全部 Swift 未编译~~ **已于 CI 编译（2026-10-29）** | Debug / Release / iphoneos 三条链路 0 error（见 `docs/BUILD-LOG.md` 第 10 轮）；仍未在真机运行时验证 | `xcodebuild -scheme Jiangshui -destination 'platform=iOS Simulator,name=iPhone 15' build` |
| 2 | WKWebView 注入时序 | shim 若晚于 `bootstrap.mjs` 执行，`window.Android` 为空、所有原生调用返回 null | 首次运行打开控制台看 `typeof window.Android` |
| 3 | `onNativeResult` 恰好一次 | 重复回包会让 Promise 静默失效 | 手动连点「检查更新 / 导出」 |
| 4 | loopback NWListener | 端口回退 47851→47860 是否真的可用、App 从后台回前台是否换端口 | 前台/后台切换 20 次 |
| 5 | ATS 教务域 | 5 个 education 域的实际 HTTP 放行 | 真机 openSchool |
| 6 | EventKit / UN / BGTask / UIDocumentPicker / Keychain | 授权、写入、排程、取消、卸载残留 | 真机逐项走 PHASE2-SCHOOL.md 的 20 条清单 |
| 7 | 图标 | 单尺寸 appiconset + 1024×1024 与安卓最新版同款（公开仓 assets/app-icon.png，2026-11-25，转 RGB 去 alpha），`actool` 实际接受度待 CI | Xcode 首次 build 时确认槽位；三端图标见 `docs/BUILD-LOG.md` 第 21 轮 |
| 8 | 后台模式声明 | Info.plist 有 `fetch/processing` 与 BGTask id，但 P1 未注册 handler，审核可能质疑 | 要么补注册，要么删键（SHELL-NOTES 4.x 有说明） |
| 9 | 诊断 platform 值 | iOS 返回 `ios`，`web/diagnostics.mjs` 只认 android/windows/browser → 显示 browser | 可接受（web 不可改），已登记 |
| 10 | 教务 P2/P3 已实现但未真机验证 | CAS/JSXSd/假条/课表解析已接线；无头核对、请假深链、定位 shim 的真实行为未知 | 真实学校账号跑 `docs/P2-SCHOOL-READ.md` §7/§11 |

## 6. Mac 首跑清单（按顺序，做完打勾）

1. `brew install xcodegen` → `cd ios && xcodegen generate`（或直接开已生成的 `.xcodeproj`）。
2. Xcode → Signing & Capabilities → 选 Team（bundle id `cn.local.tomorrow` 撞了就在 project.yml 加后缀并重生成）。
3. 模拟器 build 一次：先修编译错误（预计集中在 NWListener 生命周期、WK 委托签名、EventKit API 形态）。
4. 跑起来看三件事：页面出来了（loopback OK）、控制台 `typeof window.Android === "object"`、点「设置」能读权限。
5. 依次手验：主题切换 / 保存课表刷新不丢 / 通知授权 / 预览提醒（前台横幅）/ 导出 .txt / 导出诊断 / 导入 JSON / 导出日历（需真机）/ 登出（清空后回到同意页）。
6. 真机再验：教务处打开与返回、系统日历写入、通知权限拒绝后的降级、杀进程后提醒是否还在。
7. 上架前：图标已换 1024（与安卓最新版同款，2026-11-25）、隐私清单核对、审核说明写「学校教务系统仅支持 HTTP」、`NSAllowsLocalNetworking` 说明。

## 7. 变更文件边界（谁写了什么）

- `implementer-shell`（A）：`project.yml`、`Jiangshui.xcodeproj/`、`tools/gen-pbxproj.mjs`、`App/**`、`Web/**`、`Resources/**`、`docs/SHELL-NOTES.md`
- `implementer-services`（B）：`Services/**`（除 `SchoolSession.swift`、`ServiceProtocols.swift`）、`docs/AUDIT-APPENDIX-SERVICES.md`
- `implementer-school`（C）：`School/**`、`Services/SchoolSession.swift`、`docs/PHASE2-SCHOOL.md`
- `verifier`（D）：`tools/check-ios.mjs`、`tests/**`、`docs/AUDIT.md`
- `lead`：`docs/IOS-PORT-CONTRACT.md`、`Services/ServiceProtocols.swift`、`README-iOS.md`、`tools/gen-pbxproj.mjs` 的 `$(...)` 引号修复、本报告

**未触碰**：`android/`、`harmony/`。`web/` 相对接手时有上述两处受控改动（平台化 + `state-sync.mjs`），当前 282 项测试全绿、基线哈希可复验。
