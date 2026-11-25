# iOS 静态校验审计（AUDIT）

- 项目根：`D:\JS\pkg\02-项目源码\course-change`
- 审计对象：`ios/`（WKWebView 壳 + 原生服务 + 资源 + 工程文件）
- 审计者：verifier（独立静态校验）
- 审计日期：2026-10-27（初版）；2026-10-30（第 11 轮基线/门禁同步）；2026-10-30（第 12 轮：F10 扩展 + F11/F12，门禁 46 项）；2026-11-03（task-34：Widget 扩展 + A5/A6 分 target，门禁 47 项）；2026-11-03（task-35：G1 实时活动，门禁 48 项）；2026-11-24（task-42：B1–B5 换 45 action fixture、E1–E2 换共享层 manifest，门禁仍 48 项）；2026-11-24（task-45：公开仓 ios-ci 首次真实编译 run 45417661000，门禁/测试仍 48/66）；2026-11-24（task-47：考试三字段透传，F8 增第 8 节，iOS 测试 66→72）；2026-11-25（task-55：P0 页面服务自愈 + 登录等待时钟，门禁 48→50，iOS 测试 72→82）；2026-11-25（task-58/59 收口：reading 页面换代与旧导航身份校验并入 F14/F13，仍 50 项、82 测试）；2026-11-25（task-62/task-64：回前台加载会话与 1.5s terminate 看门狗并入 F13，仍 50 项；iOS 测试 82→83）
- 本机环境：Windows（无 Xcode、无 swiftc、无模拟器）；Node v24.21.0（DSH bundled）
- 结论：**`node ios/tools/check-ios.mjs` 50/50 ok，fail 0，退出码 0；`node --test ios/tests/` 83/83 pass；`node --test tests/*.test.mjs`（web v1.5.0）391/391 pass。未发现可由静态手段确认的产品缺陷。另由公开仓 `ios-ci` 的 run `45417661000` 完成 Debug/Release/真机三配置真实编译（0 error；warning 未清零，见 §1.5），产物 IPA 3,397,722 B / `b9282267…62706`；未签名、未真机。**

> 说明：本机无法编译 Swift、无法启动 WKWebView/Network.framework、无法跑真机，因此本审计只覆盖「静态可判定的结构与契约一致性」。编译、签名、运行时行为见 §6「未验证（需 Mac）」。

---

## 1. 如何运行

### 1.1 环境

```bash
cd /d/JS/pkg/02-项目源码/course-change        # 或 Windows 下的项目根
node -v                                        # 本审计使用 v24.21.0
```

Node 在 bash 里可能不在 PATH，本审计使用 bundled node：

```bash
NODE="C:/Users/19890/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe"
"$NODE" ios/tools/check-ios.mjs
```

### 1.2 全量检查与测试

```bash
# 静态检查：50 项，退出码 0=全绿 / 1=有 fail
node ios/tools/check-ios.mjs

# 测试：Node 24 在 Windows 下不会递归展开目录参数，
# 因此 ios/tests/package.json 的 main 指向 ios/tests/index.mjs，由它 import 全部测试文件。
node --test ios/tests/

# 等价的 glob 写法（不依赖目录入口）
node --test ios/tests/*.test.mjs
```

### 1.3 单项复现（把末尾 A1 换成表中任意编号）

```bash
node --input-type=module -e "import {runChecks} from './ios/tools/check-ios.mjs';for(const r of runChecks(process.cwd()).filter(x=>x.id===process.argv[1]))console.log(r.id, r.ok?'ok':'fail', r.detail)" A1
```

### 1.4 共享层清单（web/ + android/，不再冻结单一哈希）

```bash
# 逐文件登记 git 工作树里的共享层 blob（git hash-object 规范化行尾）
node ios/tools/check-ios.mjs --write-shared-manifest
# 已登记：ios/tools/shared-layer-manifest.json（formatVersion=1，186 个文件）
```

E1 只报 `missing` / `extra`（清单与 `git ls-files -c -o --exclude-standard -- web android` 的集合差异），E2 只报 `changed`（逐文件 blob 不同）；排除 `*.apk` / `*.zip` / `*/build/*` / `*/.gradle/*`。聚合哈希仅用于诊断，不再是门禁口径。`check-ios.mjs` 内置 git 解析回退（PATH → DSH/MSYS/Git for Windows），不依赖外部 sha256sum。

### 1.5 真实编译证据（2026-11-24，公开仓 ios-ci）

静态审计之外，v1.5.0 由公开仓 `fuwuqihmr/jiangshui-schedule` 分支 `ios-ci` 的 run [`45417661000`](https://github.com/fuwuqihmr/jiangshui-schedule/actions/runs/45417661000)（commit `823c522`）完成一次真实编译：

| 项 | 值 |
| --- | --- |
| 结论 | success，18 个步骤全 success |
| runner / 环境 | 申请 `macos-14`，实际 `macos-15-intel`（公开仓不支持前者）；macOS 15.7.9 / Xcode 16.4 / Swift 6.1.2 / Node 20.20.2 |
| 8 个退出码 | gen / check / test / build / release / device / ipa / sim 全 **0** |
| 门禁 / 测试 | check **48/48**；test **66/66** |
| 编译 | Debug 模拟器、Release 模拟器、Release 真机三种配置 `error: ` 均为 0，尾行均 `** BUILD SUCCEEDED **`；warning 行数 19 / 17 / 9（去重 8 类 = 7 类 Swift 诊断 + ONLY_ACTIVE_ARCH；Metadata 为正常提示、另计，**不是只有 1 条**） |
| IPA | 3,397,722 B；sha256 `b9282267410ed82fb9c1386efe3c879b16aedb5a209d20b7b69a6f05a6e62706`；arm64；无 `_CodeSignature` |
| Info.plist | 主 App `cn.local.tomorrow` / 1.5.0 / 64 / MinimumOSVersion 15.0 / `NSSupportsLiveActivities true`；Widget `cn.local.tomorrow.widgets` / 16.1 / `com.apple.widgetkit-extension` |
| 载荷 | 58 个 zip 条目（含 `Payload/` 根）；含 41 个 `web/` 文件、`PlugIns/JiangshuiWidgetsExtension.appex`；主二进制 1,364,704 B |
| 模拟器 | iPhone 16 Pro / iOS 18.5，`simctl launch` 后正常渲染并截图；`simulator.log` 有 `local: 127.0.0.1:47851 ... ready` |

这证明当前源码能在 Xcode 16.4 / Swift 6.1.2 下编译、打包出 arm64 未签名 IPA 并在模拟器启动；**不能替代签名、真机、学校账号与 EventKit/通知/后台/Live Activity 的运行期验证**（见 §6）。逐项日志与复现命令见 `BUILD-LOG.md` 第 18 轮。

---

## 2. 通过项（50/50）

执行命令：`node ios/tools/check-ios.mjs`（每条检查的单项命令见 §1.3）。

### A. pbxproj 与磁盘一致性（A1–A11，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| A1 | 文件头、objectVersion=56、compatibilityVersion="Xcode 14.0"、rootObject 合法 | `ios/Jiangshui.xcodeproj/project.pbxproj` 头部与 PBXProject 对象 | ok（objects=131） |
| A2 | 所有 UUID 引用均有定义 | pbxproj 全对象图 | ok（引用 131 个 UUID） |
| A3 | 无重复对象 UUID | objects 段顶层按花括号深度扫描 | ok（131 个对象唯一） |
| A4 | 每个 PBXFileReference 按 group 链解析后在磁盘存在 | root mainGroup → 各子 group → 文件 | ok（49 个文件引用全部存在） |
| A5 | 主 App 与 Widget 的 Sources 分别按 target 对应磁盘 .swift（数量动态，不写死） | 两个 target 的 Sources phase vs `ios/Jiangshui/**/*.swift`、`ios/JiangshuiWidgets/**/*.swift` | ok（主 App 磁盘 40 / 编译 41；Widget 3 / 3；Shared 双 target 1） |
| A6 | 主 App 的 Sources 阶段引用完整且只含 .swift | 主 target 的 PBXSourcesBuildPhase | ok（1 个阶段，41 个 buildFile） |
| A7 | Resources 含 web folder reference / PrivacyInfo / Assets / AppIcon | PBXResourcesBuildPhase | ok（4 项） |
| A8 | Debug/Release 的 bundle id、版本号、Info.plist、部署目标等 10 项 | target 两个 XCBuildConfiguration | ok（10/10 匹配） |
| A9 | Info.plist 只作为文件引用，不被编译或打包为资源 | PBXFileReference 存在、未进 Sources/Resources | ok |
| A10 | pbxproj 中所有 `$(...)` 必须带双引号 | 全文扫描 | ok（含 `"$(inherited)"`、`"$(TARGET_NAME)"`） |
| A11 | Widget 扩展结构：PBXTargetDependency + PBXContainerItemProxy、`.appex` 嵌入 `dstSubfolderSpec=13`、扩展 Info.plist 的 `NSExtensionPointIdentifier`、deployment target ≥16.1、WidgetBundle/ActivityConfiguration/`@available(iOS 16.1, *)`、共享 Attributes 双 target | `project.pbxproj` / `JiangshuiWidgets/Info.plist` / `JiangshuiWidgets/*.swift` | ok（依赖/嵌入/扩展 plist/16.1/WidgetBundle/ActivityConfiguration/共享 Attributes 均在位） |

### B. 45 action 契约对齐（B1–B7，全 ok）

权威清单是 `ios/tests/fixtures/bridge-actions.json`（v0-2026-11-18，MUST 35 + OPTIONAL 10）。契约 §3 保留 1.3.1 legacy 的 35 行，Android 仍按 1.3.1 legacy 或 1.5.0 目标档做精确匹配，不再要求「契约/Android/iOS 三向全等」。

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| B1 | fixture 可解析、contractVersion 与 dispatcher 常量一致、MUST 35 / OPTIONAL 10 / 编号 1..45 唯一；契约 §3 的 35 项命中 1.3.1 legacy 档（含 runtimeStatus、缺 cancelRecordSync） | `bridge-actions.json` + `BridgeDispatcher.swift:21` + 契约 §3 | ok（legacy 35 项命中，cancelRecordSync 是登记缺口） |
| B2 | Android MainActivity 的 switch(action) 精确匹配已知 profile（legacy 1.3.1 或目标 1.5.0） | `MainActivity.java` Bridge.request | ok（legacy: 35 个，缺 cancelRecordSync、含 runtimeStatus） |
| B3 | iOS dispatcher 覆盖 fixture 的 45 个 action，无缺无多 | `BridgeDispatcher.swift` 主 switch + `OptionalBridgeActions.swift` | ok（45） |
| B4 | MUST 35 全部在主 switch 且未被降级到 OptionalBridgeActions；OPTIONAL 10 恰好登记一次（主 switch 直接实现 1 个 runtimeStatus + 降级层 9 个）；非 OPTIONAL 不得进降级层 | 两个 dispatcher 文件 | ok（MUST 35 未降级；OPTIONAL 1+9） |
| B5 | iOS 全序 == fixture 45；Android MUST 子序列 == fixture MUST 顺序 | 三个解析结果 | ok（首 consentStatus、末 updateInstall；logout 第 36） |
| B6 | default 必须失败返回「不支持的操作」，不得静默成功 | 两端 default 文本 | ok |
| B7 | 4 个免同意白名单精确且真实绕过 requireAgreed | `BridgeDispatcher.swift` 的 consentFreeActions + `MainActivity.java:720` | ok（3 处一致） |

### C. Swift 声明/引用闭合（C1–C8，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| C1 | import 仅系统框架（15 项实际使用，系统框架白名单已含 ActivityKit/WidgetKit） | 全部 .swift 的 import | ok（ActivityKit/BackgroundTasks/CoreLocation/CryptoKit/EventKit/Foundation/Network/PhotosUI/Security/SwiftUI/UIKit/UniformTypeIdentifiers/UserNotifications/WebKit/WidgetKit） |
| C2 | ServiceProtocols 的 15 个协议均有实现；SessionVaulting 唯一实现是 C 的 SchoolSession.swift | 全 Swift conformance 扫描 | ok |
| C3 | NativeServices 的 13 个成员名称与类型 == NativeServicesProviding | `NativeServices.swift` | ok |
| C4 | BridgeDispatcher 只访问 NativeServicesProviding 声明的成员 | `services.<member>` 扫描 | ok（13 个） |
| C5 | `services.<member>.<method>` 在协议有声明且参数标签一致 | 42 个服务调用点 vs 协议签名 | ok（42/42） |
| C6 | 桥接三文件（JSBridge/WebHost/BridgeDispatcher）无 `!` 强解包、try!、as!、fatalError | 逐行扫描 | ok |
| C7 | 全部 .swift 括号配平且 import 在声明之前 | 43 个文件 | ok |
| C8 | ScheduleDayResolver 依赖的 JSONCompat 辅助均有声明 | 9 个辅助方法 | ok |

### D. Info.plist / PrivacyInfo / Assets（D1–D7，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| D1 | Info.plist、PrivacyInfo.xcprivacy、3 个 Assets Contents.json 可解析；AppIcon png 存在 | `ios/Jiangshui/Resources/` | ok |
| D2 | 版本宏、CFBundleDisplayName、UILaunchScreen、SceneManifest 正确 | Info.plist | ok |
| D3 | ATS：127.0.0.1/localhost + 5 个教务域 insecure + TLSv1.2，无 NSAllowsArbitraryLoads | Info.plist NSAppTransportSecurity | ok（7 域） |
| D4 | BGTaskSchedulerPermittedIdentifiers 恰好两个登记 id | `background-check` / `class-reminder` | ok |
| D5 | UIBackgroundModes 含 fetch + processing | Info.plist | ok |
| D6 | 日历/定位 4 条用途文案中文非空（相册/相机/麦克风由 F12 覆盖） | Info.plist | ok |
| D7 | PrivacyInfo 结构合法、2 类 Required Reason API 合法 | PrivacyInfo.xcprivacy | ok（UserDefaults CA92.1 / FileTimestamp C617.1） |

### E. 共享层禁改（E1–E2，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| E1 | 共享层文件集合 == `shared-layer-manifest.json`，只报 missing / extra | `git ls-files -c -o --exclude-standard -- web android`（排除 `*.apk` / `*.zip` / `build/` / `.gradle/`）vs 清单 186 条 | ok（missing 0 / extra 0） |
| E2 | 每个文件的 git blob（`git hash-object`，行尾规范化）与清单一致，只报 changed | 186 个文件逐条比较 | ok（changed 0） |

### F. 桥接常量/文案/桩（F1–F12，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| F1 | loopback 端口 47851..47860，只监听 127.0.0.1 | `LocalServer.swift` | ok |
| F2 | handler 名 jiangshuiBridge，WebHost 注册用 JSBridge.handlerName | `JSBridge.swift` / `WebHost.swift` | ok |
| F3 | 注入 shim 逐字符合契约（window.Android.request、String 化、systemDarkMode、IIFE、atDocumentStart、mainFrameOnly） | JSBridge.userScript | ok |
| F4 | onNativeResult 回包 `{value}` / `{error}`、同 id 只回一次、序列化失败回「操作失败」 | JSBridge.reply/markAnswered（上限 2000） | ok |
| F5 | 返回键 `__dsjOnBack` 表达式逐字 + 左边缘手势替代浮动按钮（RootView 不得再出现 backButton/chevron.left） | WebHost.navigateBack / handleEdgePan | ok |
| F6 | 前台恢复调用 window.onNativeResume | WebHost.resumePageIfReady | ok |
| F7 | 同意门三句文案 + agreement.json 从 bundle web/ 动态读版本 | ConsentStore.swift | ok |
| F8 | P2/P3 教务真实读取：状态机四阶段、请假/销假/续假三表单（278616/278615/278618，pageEnc 分键）、`LeaveRecordParser` 拒绝词表、`LeaveSyncCoordinator` 请假优先 + id 去重 + 15s watchdog + 续假失败只写日志、服务返回回调一次性、`cancelRecordSync` 路由、`loadState` 显式 NSNull 防御；考试三字段透传（`exams` 仅数组、`examFetchedAt`/`examError` 仅非空、`examError` 五类白名单外归 `other`，未知字段不进 payload，写入顺序在 persist/finish 之前） | `SchoolReadController.swift` / `SchoolProvider.swift` / `LeaveRecordsService.swift` / `LeaveRecordParser.swift` / `LeaveSyncCoordinator.swift` / `SchoolLeaveServiceReturnTracker.swift` / `BridgeDispatcher.swift` | ok（三表单、三错误码、watchdog、返回回调、cancelRecordSync 与考试三字段均在位） |
| F9 | project.yml 与 pbxproj 常量一致（版本/部署目标/bundle id/web 引用） | `ios/project.yml` | ok |
| F10 | 白条 A 方案：RootView 底层 `shellBackgroundColor`、WebView 只 `.ignoresSafeArea(.container, edges: .bottom)`、WebHost `clipsToBounds=true`，并用 `jiangshuiShellTheme` 同步 `--bg`；CSS 安全区仍保留 | `App/RootView.swift` / `Web/WebHost.swift` | ok |
| F11 | P2 无头核对：容器两分支 `alpha=0.01`、禁止交互、无障碍隐藏、首次挂载最底层插入；`attachHeadless` 返回 `Bool` 且 provider 挂载失败后 0.4s 重试；`capture` 不强制展示；仅 `needLogin` 触发 `onNeedsVisiblePresentation`（全文件恰好 1 个调用点）；`presentForUser` 前台 guard + completion 内置 `isUserVisible` | `School/SchoolWebViewHost.swift` / `School/SchoolProvider.swift` / `School/SchoolReadController.swift` | ok（A1/A3，task-24） |
| F12 | P3 请假深链 + 上传/定位资产：4 条用途文案非空、定位 `jiangshuiGeo` 只接受 xgxt https origin、shim 的 root 取 `window.top` 且主 frame 与同源 iframe 共用 `root.__jiangshuiGeoCallbacks`、`SchoolFilePicker.swift` 保持未接线、未实现 `runOpenPanelWith` | `Resources/Info.plist` / `School/SchoolGeolocationBridge.swift` / `School/SchoolFilePicker.swift` | ok（A2 + task-25 回归） |

### G. 实时活动（G1，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| G1 | Live Activity：`@available(iOS 16.1, *)` 门槛、`areActivitiesEnabled` 系统开关回退、`Activity.request` / `update` / `end`、`dismissalPolicy: .after(startDate + 600s)`（T+10 自动结束）、`endAll` 撤销、`ClassReminderService` 的 16.1 门槛调用、pending 通知 `prefix(60)` 上限与截断诊断、Info.plist `NSSupportsLiveActivities` | `Services/ClassActivityController.swift` / `Services/ClassReminderService.swift` / `Resources/Info.plist` | ok（16.1 门槛 + 系统开关 + T+10 + 失败回退 + 60 上限） |

### H. P0 修复（F13/F14，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| F13 | 页面服务自愈：LocalServer 的 `isRunning/isHealthy` 精确形状、`generation` 代际守卫、`waitingTimeout=1.5`、`onInterrupted`、`stop()` 可重入、`.waiting` 超时换端口、`.failed/.cancelled` 先 `dropListenerLocked` 再 `recoverLocked`、`failLocked` 全文件唯一 `onFailure`；端口仍 47851..47860 且只绑 127.0.0.1。WebHost 的 `serverErrorTitle`、`retryPage()` 公开/私有重载（先 stop 后 start）、`startIfNeeded` 用 `isHealthy` 识别半死 listener、`loadIndex` 清错误且同端口去重、`handleLoadFailure` 0.4s 只自动重试一次、`didFinish` 清错误；`didFinish/didFail/didFailProvisional` 均以 `isCurrentNavigation` 做对象身份校验拒绝旧导航（task-59）；RootView 显示标题并调用 `retryPage()`；`webViewWebContentProcessDidTerminate` 捕获 `pendingNavigation` 并挂 1.5s `DispatchWorkItem` 看门狗（`pageLoaded == false` / `isLoading` / 同端口 / 导航身份四条件；超时清 `isLoading`、写 `page-terminate-recover`、`loadIndex(force: true)`；原早退保留） | `Web/LocalServer.swift` / `Web/WebHost.swift` / `App/RootView.swift` | ok（健康判定 + 端口回退 + 错误遮罩 + 手动/自动重试 + 旧导航拒绝 + 1.5s 看门狗均在位） |
| F14 | 登录等待时钟：`loginDeadline=180`、`loginPresentationWait=6`、0.5s 轮询；`LoginPhase` 的 idle/presenting/waiting；`reading` 在 start / 登录结果 / xskb 换代 / finish 四处复位（`read()` 本身只置位）；`needLogin` 先 `cancelDeadline()` 再启动呈现轮询，而非只取消截止；`isApplicationActive` 判 `.active`；退后台暂停并累计已用时长、回前台续跑；6s 内未转可见写 `login-present-ignored` 诊断并回「学校登录页暂时无法打开…」；`xskb` 落点先 `leaveLogin()` 再进 `reading` 守卫；`leaveLogin` 停表并挂 60s；task-58 起用 `readingPageURL`/`readingToken` 记录本轮页面并作废旧注入/轮询（同一 URL 重复 `didFinish` 直接返回） | `School/SchoolReadController.swift` | ok（6s 呈现窗口 + 180s 活跃倒计时 + 后台暂停 + xskb 落点 + 页面换代均在位） |

### 测试（83/83 pass）

| 测试文件 | 覆盖 |
| --- | --- |
| `ios/tests/pbxproj.test.mjs` | OpenStep tokenizer（注释/引号/数组/嵌套/`$()`/错误输入）、pbxproj 版本与 target 构建设置、每个 target 的 Sources 都在磁盘且单 target 内不重复、主 App/Widget 分 target Sources 映射、共享文件只双 target、A1–A11 |
| `ios/tests/actions.test.mjs` | fixture 45（MUST 35 + OPTIONAL 10）、契约 §3 legacy 35、Android 1.3.1 legacy profile、iOS 45 全序、default 失败、4 白名单、协议标签回归（C5 根因） |
| `ios/tests/permission.test.mjs` | permissionStatus 快照形状/允许字段/`allowed===granted&&systemEnabled`、PermissionReporter 源码映射、篡改检出 |
| `ios/tests/plist-bridge.test.mjs` | XML plist 解析与残缺输入、Info.plist/ATS/后台/文案、PrivacyInfo、注入 shim、强解包 vs 逻辑非 |
| `ios/tests/baseline.test.mjs` | 共享层 manifest：formatVersion、无 count/hash 冻结字段、E1 集合相等、E2 逐文件 blob、排除 apk/zip/build/.gradle |
| `ios/tests/reminder-schedule.test.mjs` | 提醒窗口、BGTask 注册、权限首未知时等待回调后重排 |
| `ios/tests/live-activity.test.mjs` | 实时活动只在 iOS 16.1+ 可见、请求/更新/T+10 结束、失败只写诊断、ClassReminderService 接入并限制 60 条、Info.plist 与 Widget 无关闭入口 |
| `ios/tests/exam-passthrough.test.mjs` | exams 只有 JSON 数组才透传、examFetchedAt/examError 非空才写、examError 五类白名单外归 other 且只归一一次、未知字段不污染 rows/totalWeeks/semesterId、三字段顺序在 persist/finish 之前 |
| `ios/tests/p0-fixes.test.mjs` | P0 页面服务自愈（isHealthy/stop 可重入/waiting 1.5s/failed·cancelled 先清理再恢复/单一 onFailure）、WebHost 错误卡片与 stop→start 重试、0.4s 自动重试一次、RootView 重试按钮；登录 180s/6s 时钟、后台暂停、xskb 先 leaveLogin、reading 四处复位（read() 本身只置位）；WebHost 回前台 beginLoadSession 分轮、自动重试轮不清零、terminate 合并守卫与 1.5s 看门狗四条件 |
| `ios/tests/full-suite.test.mjs` | 50 项齐全且全 ok、formatResults 汇总、CLI 退出码 0 |
| `ios/tests/fixtures/bridge-actions.json` | v0-2026-11-18 权威 action 清单（45 个，含 level/webUsage/payload/response、8 个 callback） |

---

## 3. 失败项

**无。** 最终两轮复跑结果一致：

```text
汇总：50 项，ok 50，fail 0
全绿，退出码：0
```

---

## 4. 误报记录（checker 自身的 8 类误报，已全部修复）

首跑（修复前）为 ok 33 / fail 10（A1、A3、A4、A5、A7、A9、B7、C5、C6、F8）。逐条证据与修复如下；**没有为此改动任何被测文件**，只改 `ios/tools/check-ios.mjs`。

| # | 误报编号 | 误报现象 | 根因（证据） | 修复 | 复跑 |
| --- | --- | --- | --- | --- | --- |
| 1 | A1 | compatibilityVersion 读成 undefined | 该键在 PBXProject 对象内部（`project.pbxproj:224`），不在顶层；首版读 `raw.compatibilityVersion` | 改读 `parsePbxproj()` 返回的 `project.compatibilityVersion`，并校验 `project.isa === "PBXProject"` | ok |
| 2 | A3 | 重复 UUID：7A614F41DA46A46541C0B537 | 第二次出现在 `PBXProject.attributes.TargetAttributes`（`:218`）里作为**键**，不是对象定义 | 截出 objects 段，按行跟踪花括号深度，只在 depth=0 且匹配 `UUID = {` 时计入 | ok |
| 3 | A4/A5 | 文件引用未挂链、编译 swift 集合为空 | `walkProjectGroups(root, objects)` 内部误用 `root.rootObject`，而 root 是文件系统路径字符串 → project=undefined → mainGroup 链断（`project.pbxproj:231` 的 mainGroup 明明存在） | 签名改为 `walkProjectGroups(root, parsed, objects)`，内部用 `parsed.rootObject` | ok |
| 4 | A7/A9 | Resources/Info.plist 相关检查失败 | 同 #3 的 group 链断裂，资源引用也解析不到 | 同 #3 修复后自然恢复 | ok |
| 5 | B7 | 把 Android 的 HOSTS 白名单当成免同意白名单 | 首版取文件里第一个 `Arrays.asList`，命中的是 `MainActivity.java:62` 的 portal/eapp2 主机列表；真实判断在 `:720`：`if(!java.util.Arrays.asList("consentStatus","acceptConsent","declineConsent","setTheme").contains(action))UserConsent.require(...)` | 先定位 `UserConsent.require`，只取它之前且内容含 `consentStatus` 的 `Arrays.asList` | ok |
| 6 | C5 | 13 处协议参数标签不匹配 | 首版把参数**类型**当标签（`version: String`、`_ state: JSONObject`）；不是全局按方法名找，也不是 SessionVaulting.save 串味 | 按每个参数第一个 `:` 切分，左值取首个 token；`_`→`_`、`@attr`→`?`，在协议作用域内解析 | ok |
| 7 | C6 | `if !pageLoaded` / `if !consentFreeActions...` 被当强解包 | 旧正则允许标识符与 `!` 之间有空格（`WebHost.swift:89`、`BridgeDispatcher.swift:32`） | 改为 `([A-Za-z0-9_)]])!(?!=)`：`!` 必须紧跟标识符/`)`/`]`；另保留 try!/as!/fatalError | ok |
| 8 | F8 | 误判 sync 没有复用 capture | 首版在 stripSwift 后的文本上找，`"sync"` 字符串已被清空，且窗口只有 400 字符；实际 `BridgeDispatcher.swift:159-162` 是跨行 closure | 改用原文，窗口 600 字符，匹配 `case "sync":` 后出现 `services.school.capture()` | ok |

补充说明（给下一个会话防坑）：
- 首版 tokenizer **已经**会剥引号；A1 的真正问题是「读错了层级」，不是引号处理。
- A3 不能用「全局 UUID 出现次数」判重：TargetAttributes 的键、注释、字符串都会干扰；必须限定在 objects 段且处于顶层。
- B7 的 Android 实现是 `java.util.Arrays.asList(...).contains(action)`，不是 `Bridge.kt` / `!"consentStatus".equals(action)`（本仓库没有 Bridge.kt）。
- C5 的根因是标签解析，不是同名方法冲突；测试 `actions.test.mjs` 已对 `accept(version:)`、`save(_ state:expectedRevision:)`、`SessionVaulting.save(_:)` 做回归断言。
- 写 checker 时不要在 stripSwift 后的文本上匹配被字符串化的关键字；协议/调用解析要按作用域、按括号配平。

### 4.1 门禁变异测试（临时副本，未改被测文件）

2026-10-30/11-03/11-24/11-25 对 F10–F12、A5/A6/A11、G1、B1–B5、F8 与 F13/F14 做单点变异，确认断言不是空转（临时目录已清理，跑法：复制 `ios/` 到临时根，改一个点，再 `runChecks(tempRoot)` 只筛目标编号；临时根没有 `web/`，A7 的 web 目录检查会连带报环境缺失，不纳入结论）：

| 变异点 | 预期 | 实测 |
| --- | --- | --- |
| `App/RootView.swift` 的 `Color(uiColor: host.shellBackgroundColor)` → `Color.clear` | F10 fail | FAIL：RootView 缺少填充状态栏的 shellBackgroundColor 底层 |
| `Web/WebHost.swift` 的 `webView.clipsToBounds = true` → `false` | F10 fail | FAIL：WebView 缺少 clipsToBounds=true |
| `School/SchoolProvider.swift` 的 `capture` 开头插入 `sessionHost.presentForUser(from: presenter)` | F11 fail | FAIL：capture 路径调用了 presentForUser |
| `School/SchoolWebViewHost.swift` 两条 `view.alpha = 0.01` 都 → `1.0` | F11 fail | FAIL：首次挂载/复用已挂载两个分支都报未设 alpha=0.01 |
| 只改第一条 `view.alpha = 0.01`（:179） | F11 fail | FAIL：首次挂载分支未设 alpha=0.01 |
| 只改第二条 `view.alpha = 0.01`（:187） | F11 fail | FAIL：复用已挂载分支未设 alpha=0.01 |
| `School/SchoolGeolocationBridge.swift` 的 `"jiangshuiGeo"` → `"jiangshuiGeoX"` | F12 fail | FAIL：定位桥 handlerName 必须为 jiangshuiGeo |
| `Resources/Info.plist` 的 `NSPhotoLibraryUsageDescription` 键改名 | F12 fail | FAIL：Info.plist 缺 相册 用途文案 |
| `School/SchoolWebViewHost.swift` 的 `attachHeadless` 返回类型改回 `Void` | F11 fail | FAIL：attachHeadless 必须返回 Bool |
| `attachHeadlessOnMain` 的 dismiss 分支删掉 `return false` | F11 fail | FAIL：attachHeadlessOnMain 在 dismiss 窗口必须 return false |
| `SchoolProvider.swift` 的重试延迟 `0.4` → `0.5` | F11 fail | FAIL：未在挂载失败后 0.4s 重试 |
| 删 `presentForUser` 的 `applicationState == .active` guard | F11 fail | FAIL：未检查 applicationState == .active |
| 把 `isUserVisible = true` 从 present completion 移到 present 之前 | F11 fail | FAIL：isUserVisible 必须在 present completion 内 |
| 删定位 shim 的 `window.top` 回填根 | F12 fail | FAIL：window.top 与 try/catch 两条 |
| 删定位 shim 的 `__jiangshuiGeoCallbacks` 共享表 | F12 fail | FAIL：未共享 __jiangshuiGeoCallbacks |
| task-25 回归：`callbacks = root.__jiangshuiGeoCallbacks` → `callbacks = {}` | F12 fail | FAIL：定位 shim 必须把 root.__jiangshuiGeoCallbacks 作为唯一注册表 |
| A11：删主 target 的 `PBXTargetDependency` | A11 fail | FAIL：主 target 缺指向 Widget 的 PBXTargetDependency |
| A11：`dstSubfolderSpec = 13` → `0` | A11 fail | FAIL：主 target 应有 1 个 dstSubfolderSpec=13 的 PBXCopyFilesBuildPhase（实际 0） |
| A11：删 Widget Info.plist 的 `NSExtensionPointIdentifier` | A11 fail | FAIL：Widget NSExtensionPointIdentifier 应为 com.apple.widgetkit-extension（实际 undefined） |
| A11：删 `ClassActivityAttributes.swift` 的 `@available(iOS 16.1, *)` | A11 fail | FAIL：ClassActivityAttributes 缺 @available(iOS 16.1, *) |
| A5：把共享 `ClassActivityAttributes.swift` 从主 App Sources 移除 | A5 fail | FAIL：Shared 文件未进主 App：JiangshuiWidgets/Shared/ClassActivityAttributes.swift |
| A5：把主 App 一个 `.swift` buildFile 从 Sources 移除 | A5 fail | FAIL：主 App 磁盘有但未编译：Jiangshui/App/AppEnvironment.swift |
| A5：把 Widget 专属 `ClassActivityWidget.swift` 加进主 App Sources | A5 fail | FAIL：主 App 编译了非共享的 Widget 专属文件：JiangshuiWidgets/ClassActivityWidget.swift |
| A6：主 App Sources 阶段重复同一 buildFile | A6 fail | FAIL：同一 Sources 阶段重复编译：285A023B6776426E02167754 |
| G1：`ClassActivityController` 的 `.after(dismissal)` → `.immediate` | G1 fail | FAIL：实时活动未用 dismissalPolicy .after 在 T+10 结束 |
| G1：删 `candidates.count > 60` 并把两处 `candidates.prefix(60)` 改成 `candidates`（完全去掉 60 条上限） | G1 fail | FAIL：pending 通知未限制 60 条并记截断诊断 |
| G1：删 `guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }` | G1 fail | FAIL：未检查实时活动系统开关 |
| G1 兼容性回归：`Activity<ClassActivityAttributes>.request` → `Activity.request`（同步 throws 显式泛型） | G1 ok | ok（正则 `Activity(?:<ClassActivityAttributes>)?\.request` 两种写法均接受） |
| B3/B4：删 `BridgeDispatcher` 的 `case "calendarSync"` | B3/B4 fail | FAIL：iOS 缺 calendarSync；MUST 未进主 switch |
| B4：把 `calendarSync` 改为 `optionalActions.handle("calendarSync", payload:)` 后再 `reply(id,["ok":true])` | B4 fail | FAIL：MUST 被降级到 OptionalBridgeActions：calendarSync |
| B1/B3：把 fixture 的 `calendarSync` 键改名 `calendarSyncRenamed` | B1/B3 fail | FAIL：契约 §3 不是已知的 1.3.1 legacy 集合；iOS 缺/多 calendarSync |
| F8：删 `BridgeDispatcher` 的 `case "cancelRecordSync"` | F8 fail | FAIL：BridgeDispatcher 缺少 cancelRecordSync case（B3 也红） |
| F8：`LeaveRecordsService.fetchCancel` 的 formId 由 `cancelFormID` 改成 `leaveFormID` | F8 fail | FAIL：fetchCancel 未使用销假表单 278615 |
| F13：`LocalServer.isHealthy` 去掉 `&& port != nil` | F13 fail | FAIL：isHealthy 必须同时要求 shouldRun / listener / port |
| F13：`recoverLocked` 把 `onInterrupted?()` 移到 `dropListenerLocked` 之前 | F13 fail | FAIL：失效恢复必须先清理再通知 |
| F13：`retryPage(autoRetry:)` 删掉 `server.stop()` | F13 fail | FAIL：手动重试必须先 stop 再 start |
| F13：自动重试延迟 `0.4` → `0.5` | F13 fail | FAIL：加载失败未在 0.4s 自动重试一次 |
| F13：`didFinish` 不清 `serverError` | F13 fail | FAIL：didFinish 未清除错误 |
| F14：`loginDeadline` 由 180 改 90 | F14 fail | FAIL：登录活跃倒计时应为 180s |
| F14：`needLogin` 删掉 `startLoginClock()` | F14 fail | FAIL：needLogin 未启动登录时钟 |
| F14：`xskb` 分支把 `guard reading == false` 挪到 `leaveLogin()` 之前 | F14 fail | FAIL：xskb 落点必须先 leaveLogin |
| F14：`isApplicationActive` 改判 `.background` | F14 fail | FAIL：前台判定必须为 .active |
| F13：`isCurrentNavigation` 的 `currentNavigation` 为空改 `return true` | F13 fail | FAIL：currentNavigation 为空时必须拒绝旧导航 |
| F14：`read(attempt:token:)` 删掉 `token == readingToken` 守卫 | F14 fail | FAIL：read(attempt:token:) 缺代次守卫，旧注入回调会污染新一轮 |
| F14：`xskb` 分支删掉 `readingPageURL = nil` / `readingToken += 1` 复位 | F14 fail | FAIL：页面换代未复位 reading/URL/代次 |
| F13：删掉 `webViewWebContentProcessDidTerminate` 里的 1.5s 看门狗块 | F13 fail | FAIL：进程回收未捕获 pendingNavigation 或未挂看门狗 |
| F13：看门狗 `1.5` 改 `2.0` | F13 fail | FAIL：看门狗未在 1.5s 后执行 |
| F13：四条件里的导航身份改成 `self.currentNavigation === self.currentNavigation` | F13 fail | FAIL：未同时校验 pageLoaded/isLoading/端口/导航身份 |
| F13：删掉看门狗之后的原 early-return | F13 fail | FAIL：原 early-return 必须保留在看门狗之后 |

**F11 的一轮返工**：最初只断言 `attachHeadlessOnMain` 内「至少一处 alpha=0.01」，只改 :179 时 :187 的 else 分支仍满足，变异没有失败。已改成按 `if parent == nil` / `else` 两个分支分别断言 `alpha=0.01`、`isUserInteractionEnabled=false`、`accessibilityElementsHidden=true`，并只要求首次挂载分支有 `insertSubview(view, at: 0)`；再跑上述三种 alpha 变异均能 FAIL 并指出具体分支。该结构断言比「函数内至少一处」更严，未来若把两条分支合并成一次赋值，需要同步更新断言而不是删掉。

---

## 5. 观察（非 fail，未发现产品缺陷）

以下都是「静态看起来符合契约/与 Android 对齐，但值得下一位读者知道」的点，不作为失败项：

1. **ConsentStore.status() 返回已接受版本**（`Services/ConsentStore.swift:26-28`）。与 Android `UserConsent.status`（`UserConsent.java:7`）完全一致；`web/consent.mjs:7-8` 由 JS 比较 `status.version === agreement.version`，所以返回已接受版本是正确的，不是 bug。
2. **PermissionReporter 的 iOS 映射**（`Services/PermissionReporter.swift:9-27`）：`notifications.runtime=false`、`systemEnabled=granted`、`allowed=granted`；`exactAlarm.required=false` 让 web 隐藏精确闹钟行；`battery.exempt=true` 让 web 跳过电池优化提示；`autostart.supported=false` 仅为形状兼容。属于有注释的设计选择，web 端 `permissionRowsHtml()` 的分支与之匹配。
3. **iOS 上「电池优化 / 自启动」两行仍是 Android 文案**（web 端按快照字段渲染）：iOS 会显示「已忽略优化」「需在系统设置确认」，按钮调用 `batterySettings` / `autostartSettings`，在 iOS 都映射到 `openAppSettings()`。功能无碍，属文案/信息架构差异，建议 P2 做平台化文案。
4. **NotificationAuthorizationCache 首调可能是旧值**（`Services/SystemNotificationService.swift:6-49`）：`UNUserNotificationCenter` 异步返回，桥接同步读缓存；源码注释已说明「首次 permissionStatus 可能仍报未授权」。web 有「重新检查」按钮，最坏是第一屏按钮状态滞后，不是权限错误。
5. **NotificationPresenter 只做前台展示**（`App/NotificationPresenter.swift`）：`willPresent` 固定 `[.banner,.sound,.list]`，`didReceive` 直接 completion；P1 不接分类/深链，符合源码注释与阶段计划。
6. **与 Lead 描述的差异**：B7 的权威源是 `MainActivity.java:720`（不是 Bridge.kt）；C5 根因是标签解析（不是全局方法名冲突）。两处已在 §4 写明，避免后续会话按错误前提改代码。
7. **`loadState` 显式回包只是防御，不是保存冲突的根因**（`Web/BridgeDispatcher.swift:54-64`）。原写法把 `Any?` 直接传给 `reply` 时 Swift 会保留 nil，本就能正确回 `null`/对象；真正的死循环在 `_revision` 落后磁盘 + 冲突无兜底，修复见 `web/state-sync.mjs` 的三层兜底与真机日志。
8. **P2 四条运行期修复只能静态验形状**：`needLogin` 取消死线、`leaveLogin` 60s、SSO 重挂 90s、`onDismissed`、`onPageFinished` 的行为要等真机复跑；静态门禁只能保证这些调用/守卫还在源码里，不能证明学校页面真的按预期结束等待。
9. **首次保存冲突的起因静态无法定位**：可能是回包丢失、启动快照校验失败或页面重载，三者日志都表现为 `expected < disk`；本轮只证明了「有兜底、能收敛」，根因需真机 `applog.txt` 的 `state-save conflict expected=… disk=…` 才能定案。
10. **白条 / 无头 / 请假 / 定位只能静态验形状**（`App/RootView.swift`、`Web/WebHost.swift`、`School/SchoolWebViewHost.swift`、`School/SchoolLeaveSessionController.swift`、`School/SchoolGeolocationBridge.swift`）：F10–F12 守住的是视图层级、`clipsToBounds`、CSS 变量名、`alpha/isUserInteractionEnabled`、状态机标志与 origin 校验；WebKit 是否降频无头 WebView、白条在真机是否与状态栏同色、请假深链是否真的十步收敛，都必须真机验证。
11. **上传与定位是登记过的 P3 偏离，不是缺陷**：附件上传依赖 `WKUIDelegate.runOpenPanelWith`（iOS 18.4+），当前 `SchoolFilePicker.swift` 无调用点，因此请假附件按钮在 iOS 15–18.3 上无响应；定位依赖 `requestGeolocationPermissionFor`（iOS 27+），当前用 `WKUserScript` 替换 `navigator.geolocation` 并走 `jiangshuiGeo`（origin 限 https + xgxt、端口 0/443）。两项均已在 `docs/P2-SCHOOL-READ.md` §11.4 与 `docs/SHELL-NOTES.md` 登记。
12. **task-22 只读复核的 A1/A2/A3 已修（task-24/task-25）**：A1 把 `attachHeadless` 改为返回 `Bool`，provider 在 dismiss 窗口内失败后 0.4s 重试一次，不再空转 90s；A2 把定位 shim 的回填根改挂 `window.top`，task-25 进一步统一为主 frame 与同源 iframe 共用 `root.__jiangshuiGeoCallbacks`；A3 给 `presentForUser` 加 `applicationState == .active` 守卫，并在 present completion 内置 `isUserVisible`。仍保留两条运行期限制：跨域 iframe 定位会超时（code 3），后台收到 `needLogin` 只提示回前台、不自动重试 present，详见 `docs/P2-SCHOOL-READ.md` §11.5。
13. **Widget 双 target 的共享边界**：只有 `JiangshuiWidgets/Shared/ClassActivityAttributes.swift` 允许同时进主 App 与 Widget；Widget 专属视图不得进主 App。A5 按 target 分别比对「磁盘 .swift ↔ 该 target 的 Sources」，并额外查两个 target 的重复编译；A6 只校验主 App 的 Sources 阶段（阶段数、buildFile 引用、重复、后缀）；A11 校验扩展结构。这样不会用 union 掩盖「主 App 少编译一个自己的文件」或「主 App 误收 Widget 视图」。
14. **Live Activity 是尽力而为**（`Services/ClassActivityController.swift`）：系统关闭实时活动、App 被系统杀死或后台刷新未获得执行时间时，`reconcile` 不会启动/更新活动，用户仍会收到普通本地通知。G1 只验证 16.1 门槛、请求/更新/T+10 结束、失败写诊断与 60 条上限，不能证明锁屏实时活动在真机上的存活与刷新频率。
15. **共享层不再冻结单一哈希**：E1/E2 改为 `ios/tools/shared-layer-manifest.json` 的逐文件 git blob 比对，只报 missing / extra / changed；清单要随 `web/`、`android/` 的合法改动重跑 `node ios/tools/check-ios.mjs --write-shared-manifest`。`contractVersion` 与 45 action fixture 才是契约门禁的权威口径。
16. **考试字段只做透传，业务语义仍在 web 层**（`SchoolReadController.swift` / `web/school-reader.js`）：原生只把 `exams`（数组）、`examFetchedAt`（非空串）、`examError`（五类白名单，其它归 `other`）写进 payload，**不透传 `examHttpStatus`**；考试失败时是否保留旧快照、页面如何展示均由 `web/jiaowu-exam.mjs` 决定。F8 第 8 节与 `exam-passthrough.test.mjs` 只能验证静态源码形状；本轮 +19 行尚未重新编译、未真机、未用学校账号验证考试接口。
17. **P0 两处修复只能静态验形状**（task-55）：F13/F14 锁住的是 LocalServer 的健康判定/代际/顺序、WebHost 的 stop→start 与 0.4s 重试、登录时钟的常量/分支/后台通知订阅；端口真被占用时能否在 1.5s 内换端口、WKWebView 在 stop→start 后能否重新加载、真机锁屏/切后台时 180s 是否按前台时间累计，都必须真机 + 真实网络验证。`p0-fixes.test.mjs` 同样只读源码，不执行 Swift。
18. **回前台加载会话与 terminate 看门狗只能静态验形状**（task-62/task-64）：F13 锁的是 `beginLoadSession` 四项清零、scene `.active` 顺序、自动重试轮不清零、`loadIndex` 的 `autoRound` 分支、1.5s `DispatchWorkItem` 的四条件与 `loadIndex(force: true)`；WebKit 在真机后台被回收时的 `scenePhase` 时序、回前台首次加载失败是否仍误弹、同一端口能否在 1.5s 后恢复，都必须 CI 编译 + 真机/模拟器验证。

---

## 6. 未验证（需 Mac）

以下项目**本机无法验证**，交付说明中必须保留。标注「已验证」的条目是 2026-11-24 由公开仓 CI 补验的编译/打包层，**不代表真机运行通过**：

### 6.1 编译与工程
- `xcodebuild ... build` 能否编译通过 —— **已验证**（run 45417661000：Debug 模拟器 / Release 模拟器 / Release iphoneos 均 0 error、`** BUILD SUCCEEDED **`；Swift 语法、类型推断、actor/Sendable、iOS 15 availability 均通过）。
- Swift 6 / 新 Xcode 的并发检查是否阻塞 —— **当前不阻塞**（SWIFT_VERSION=5.0；Xcode 16.4 报 19/17/9 行 warning，去重 8 类 = 7 类 Swift 诊断 + ONLY_ACTIVE_ARCH）；升级到 Swift 6 语言模式前需修 `LeaveRecordsService.swift:195/199`、`LeaveSyncCoordinator.swift:92/136`、`SchoolProvider.swift:191/289`。
- Code signing、Provisioning Profile、Team、`cn.local.tomorrow` 是否与开发者账号匹配 —— **未验证**（本轮 IPA 无 `_CodeSignature`）。
- 构建产物 Info.plist 的变量展开 —— **已验证**（IPA 内主 App 为 1.5.0 / 64 / MinimumOSVersion 15.0；Widget 为 1.5.0 / 64 / 16.1）。
- Asset catalog 编译、AppIcon 实际渲染、LaunchScreen 实际效果、iPad 分屏/旋转 —— actool 编译已通过；实际渲染与分屏仍待真机。
- `web` folder reference 是否在 Copy Bundle Resources 中保持目录结构 —— **已验证打包**（IPA 内 41 个 `web/` 文件，含 `data/`、`assets/` 子目录）；运行时路径解析仍待真机/模拟器深链验证。
- Widget Extension（`JiangshuiWidgetsExtension`）的 `.appex` 签名、App Group/Team 匹配、`Embed App Extensions` 实际嵌入、`NSExtension` 激活、ActivityKit 在 iOS 16.1 真机的 Live Activity 能力 —— **编译与嵌入已验证**（`PlugIns/JiangshuiWidgetsExtension.appex` 在 IPA 中，Info.plist 的 `NSExtensionPointIdentifier` 正确）；签名与真机高刷/灵动岛仍待验证。

### 6.2 桥接与运行时
- WKUserScript 在 `.atDocumentStart` 的实际注入时序；`window.Android` shim 是否在 web 首帧前可用。
- WKScriptMessageHandler 的 `jiangshuiBridge` 实际回调、`payload` 字符串化、`onNativeResult` 恰好一次、同 id 去重（JS 侧与原生侧）。
- `__dsjOnBack` 返回键、`onNativeResume` 前台恢复的实际行为。
- loopback `NWListener`：47851 被占用时 47852..47860 的顺序回退、只绑 127.0.0.1、HTTP 431/400/404/405、15s 超时、32KB 上限、路径穿越与 MIME 白名单。
- P0 页面服务自愈（F13）：`.waiting` 1.5s 后是否真的释放并换下一个端口、`.failed/.cancelled` 是否只触发一次 `onInterrupted`、`stop→start` 后同一 WKWebView 能否重新加载、错误卡片与「重试」按钮在真机上的布局/点击；加载中进程回收时 1.5s 看门狗能否按四条件恢复（`page-terminate-recover`）也需真机/模拟器。
- ATS 对 5 个教务域 + `127.0.0.1` 的实际放行（尤其 http 的 8080/9443 端口）。
- window.open / target=_blank / 外链在 WKWebView 中的实际行为是否与 `isAllowed` 一致。

### 6.3 原生服务
- EventKit：权限弹窗、读写日历、删除、`requestAccess(to: .event)` 在 iOS 16 的实际行为与错误码。
- UNUserNotificationCenter：授权、排期、前台展示、点通知进 App、Badge、声音；`UNCalendarNotificationTrigger` 的时区/重复规则。
- Live Activity：`ActivityAuthorizationInfo` 系统开关、锁屏/灵动岛展示、T+10 的 `.after` 结束策略、App 被杀后的活动清理、`endAll` 撤销；静态检查只能确认 API 调用与 16.1 门槛。
- BGTaskScheduler：`BGTaskSchedulerPermittedIdentifiers` 与实际 `register`/提交任务是否一致（本审计只查 plist）；后台 fetch/processing 是否被系统调度。
- UIDocumentPicker：导入 JSON、导出 txt/png/pdf 的真实可用性、取消回调、临时文件清理。
- Keychain（`kSecClassGenericPassword` / `AfterFirstUnlock`）在真机上的保存/读取/清除。
- 学校 P2（**已实现，待真机验证**）：`leaveRecordSync` 走 URLSession 直连 + cookie 头手工拼接；`capture`/`sync`/`openSchool(mobile:false)` 走 `SchoolReadController` 四阶段状态机。真机必须验证：登录后自动回填课表、会话过期时 SSO 自动恢复一次、假条列表 role code 正确（NEED_LOGIN/NEED_SESSION/TIMEOUT）。见 `docs/P2-SCHOOL-READ.md`。「iOS 端教务读取将在下一阶段提供」常量已不再被任何实现路径返回（门禁 F8 守住）。
- 学校 P3（**已实现，待真机验证**）：白条 A 方案的视觉对齐、无头 WebView 是否被 WebKit 降频/暂停、请假十步状态机（warmup/CAS/450ms 复检/relogin/retarget）、定位 shim 在真实 xgxt 页面的授权与回包；上传附件按钮在 iOS 18.4 以下按设计无响应。见 `docs/P2-SCHOOL-READ.md` §11 与 `docs/SHELL-NOTES.md`。
- P0 登录等待时钟（F14）：真机锁屏/切后台时 `willResignActive/didBecomeActive` 是否成对、180s 是否只累计前台时间、6s 内未 present 的失败文案与诊断是否落盘、`xskb` 落点是否不再白等 180s；`simctl` 无法覆盖锁屏，需真机 + 学校账号。见 `docs/P2-SCHOOL-READ.md` §13。
- App Store：PrivacyInfo 的 Required Reason API 申报、ATS 例外说明、`ITSAppUsesNonExemptEncryption=false` 是否需要额外文件、4.2/5.1 审核口径。

---

## 7. 审计结论

- 静态检查：50 项全部通过，fail 0（`node ios/tools/check-ios.mjs` 退出码 0）。
- 测试：iOS 83 项全部通过（`node --test ios/tests/`）；web 391 项全部通过（`node --test tests/*.test.mjs`，v1.5.0）。
- 共享层：`shared-layer-manifest.json` 登记 186 个文件，E1/E2 逐文件 blob 一致（不再冻结 182 / 单一聚合哈希）。
- 真实编译：公开仓 `ios-ci` run `45417661000`（commit `823c522`）18 步全 success，8 个 rc 全 0，check 48/48、test 66/66，三份 xcodebuild 0 error / BUILD SUCCEEDED；warning 19/17/9 行（未清零），IPA 3,397,722 B / `b9282267…62706` / arm64 / 未签名。
- 真实缺陷：**本轮未发现可由静态手段确认的缺陷**；§5 是观察项，§6 是必须到 Mac 上补验的清单。task-34 新增 A11 后，Widget 扩展只能验证工程结构与源码门槛；task-35 新增 G1 后，Live Activity 也只验证 API 调用、16.1 门槛与 T+10 策略；task-42 的 B1–B5/E1–E2 只能验证 45 action 契约与共享层清单，task-47 的 F8 第 8 节与 `exam-passthrough.test.mjs` 只能验证考试三字段的静态透传形状；task-55 的 F13/F14 与 `p0-fixes.test.mjs` 只能验证页面服务自愈与登录时钟的源码形状（9 条变异均能红）；task-58/59 的页面换代（`readingPageURL`/`readingToken`）与旧导航身份校验（`isCurrentNavigation`）同样只是静态形状（新增 3 条变异均能红）；task-62/task-64 的回前台加载会话与 1.5s terminate 看门狗同样只是静态形状（新增 4 条变异均能红），都不能替代 Xcode 编译/签名/真机锁屏、端口占用或灵动岛验证。
- 产物：
  - `ios/tools/check-ios.mjs`：纯 Node、零第三方依赖、可重复运行。
  - `ios/tests/{pbxproj,actions,permission,plist-bridge,baseline,reminder-schedule,live-activity,exam-passthrough,p0-fixes,full-suite}.test.mjs` + `tests/fixtures/bridge-actions.json` + `package.json` + `index.mjs`（目录入口，兼容 Node 24 Windows）。
  - `ios/docs/AUDIT.md`：本文件。
