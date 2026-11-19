# iOS 静态校验审计（AUDIT）

- 项目根：仓库根目录（`ios/` 的上一级；本文档随 iOS 快照迁入主仓）
- 审计对象：`ios/`（WKWebView 壳 + 原生服务 + 资源 + 工程文件）
- 审计者：verifier（独立静态校验）
- 审计日期：2026-10-27（初版）；2026-10-30（第 11 轮基线/门禁同步）；2026-10-30（第 12 轮：F10 扩展 + F11/F12，门禁 46 项）；2026-11-03（task-34：Widget 扩展 + A5/A6 分 target，门禁 47 项）；2026-11-03（task-35：G1 实时活动，门禁 48 项）
- 本机环境：Windows（无 Xcode、无 swiftc、无模拟器）；Node v24.21.0（DSH bundled）
- 结论：**`node ios/tools/check-ios.mjs` 48/48 ok，fail 0，退出码 0；`node --test ios/tests/` 64/64 pass；`node --test tests/*.test.mjs`（web）282/282 pass。未发现可由静态手段确认的产品缺陷。**

> 说明：本机无法编译 Swift、无法启动 WKWebView/Network.framework、无法跑真机，因此本审计只覆盖「静态可判定的结构与契约一致性」。编译、签名、运行时行为见 §6「未验证（需 Mac）」。

---

## 1. 如何运行

### 1.1 环境

```bash
cd <仓库根目录>        # 例如 git clone 得到的仓库根
node -v                                        # 本审计使用 v24.21.0
```

Node 在 bash 里可能不在 PATH，本审计使用 bundled node：

```bash
NODE="C:/Users/<user>/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe"
"$NODE" ios/tools/check-ios.mjs
```

### 1.2 全量检查与测试

```bash
# 静态检查：48 项，退出码 0=全绿 / 1=有 fail
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

### 1.4 禁改基线（web/ + android/ 共 182 个入库文件）

```bash
# 构建产物（*.apk / *.zip）不入基线；本工作树共 188 个文件，其中 6 个是产物
find web android -type f ! -name '*.apk' ! -name '*.zip' | sort | xargs sha256sum | sha256sum
# 期望：1ea23688954ba6631a98c31aca4c62b593815da5052965434bd057ac6718cbdd（2026-10-30 新增 web/state-sync.mjs 后重算）
```

`check-ios.mjs` 的 E1/E2 不依赖外部 sha256sum：它在 Node 内按「sha256 + " *" + 相对路径」、以 Buffer 字节序排序后计算，等价于上面的 MSYS 二进制模式命令。

---

## 2. 通过项（48/48）

执行命令：`node ios/tools/check-ios.mjs`（每条检查的单项命令见 §1.3）。

### A. pbxproj 与磁盘一致性（A1–A11，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| A1 | 文件头、objectVersion=56、compatibilityVersion="Xcode 14.0"、rootObject 合法 | `ios/Jiangshui.xcodeproj/project.pbxproj` 头部与 PBXProject 对象 | ok（objects=123） |
| A2 | 所有 UUID 引用均有定义 | pbxproj 全对象图 | ok（引用 123 个 UUID） |
| A3 | 无重复对象 UUID | objects 段顶层按花括号深度扫描 | ok（123 个对象唯一） |
| A4 | 每个 PBXFileReference 按 group 链解析后在磁盘存在 | root mainGroup → 各子 group → 文件 | ok（45 个文件引用全部存在） |
| A5 | 主 App 与 Widget 的 Sources 分别按 target 对应磁盘 .swift（数量动态，不写死） | 两个 target 的 Sources phase vs `ios/Jiangshui/**/*.swift`、`ios/JiangshuiWidgets/**/*.swift` | ok（主 App 磁盘 36 / 编译 37；Widget 3 / 3；Shared 双 target 1） |
| A6 | 主 App 的 Sources 阶段引用完整且只含 .swift | 主 target 的 PBXSourcesBuildPhase | ok（1 个阶段，37 个 buildFile） |
| A7 | Resources 含 web folder reference / PrivacyInfo / Assets / AppIcon | PBXResourcesBuildPhase | ok（4 项） |
| A8 | Debug/Release 的 bundle id、版本号、Info.plist、部署目标等 10 项 | target 两个 XCBuildConfiguration | ok（10/10 匹配） |
| A9 | Info.plist 只作为文件引用，不被编译或打包为资源 | PBXFileReference 存在、未进 Sources/Resources | ok |
| A10 | pbxproj 中所有 `$(...)` 必须带双引号 | 全文扫描 | ok（含 `"$(inherited)"`、`"$(TARGET_NAME)"`） |
| A11 | Widget 扩展结构：PBXTargetDependency + PBXContainerItemProxy、`.appex` 嵌入 `dstSubfolderSpec=13`、扩展 Info.plist 的 `NSExtensionPointIdentifier`、deployment target ≥16.1、WidgetBundle/ActivityConfiguration/`@available(iOS 16.1, *)`、共享 Attributes 双 target | `project.pbxproj` / `JiangshuiWidgets/Info.plist` / `JiangshuiWidgets/*.swift` | ok（依赖/嵌入/扩展 plist/16.1/WidgetBundle/ActivityConfiguration/共享 Attributes 均在位） |

### B. 35 action 三向对齐（B1–B7，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| B1 | 契约 §3 解析出 35 个 action，编号 1..35 连续 | `ios/docs/IOS-PORT-CONTRACT.md` §3 表格（含 20-22、25-26 合并行） | ok |
| B2 | Android MainActivity 的 switch(action) 有 35 个 case | `android/app/src/main/java/cn/local/tomorrow/MainActivity.java` Bridge.request | ok |
| B3 | iOS BridgeDispatcher 的 switch action 有 35 个 case | `ios/Jiangshui/Web/BridgeDispatcher.swift` | ok |
| B4 | 契约 / Android / iOS 三向集合一致 | 三个解析结果 | ok |
| B5 | 三向顺序一致（首 consentStatus、末 logout） | 同上 | ok |
| B6 | default 必须失败返回「不支持的操作」，不得静默成功 | 两端 default 文本 | ok |
| B7 | 4 个免同意白名单精确且真实绕过 requireAgreed | `BridgeDispatcher.swift` 的 consentFreeActions + `MainActivity.java:720` | ok（3 处一致） |

### C. Swift 声明/引用闭合（C1–C8，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| C1 | import 仅系统框架（15 项实际使用，系统框架白名单已含 ActivityKit/WidgetKit） | 全部 .swift 的 import | ok（ActivityKit/BackgroundTasks/CoreLocation/CryptoKit/EventKit/Foundation/Network/PhotosUI/Security/SwiftUI/UIKit/UniformTypeIdentifiers/UserNotifications/WebKit/WidgetKit） |
| C2 | ServiceProtocols 的 15 个协议均有实现；SessionVaulting 唯一实现是 C 的 SchoolSession.swift | 全 Swift conformance 扫描 | ok |
| C3 | NativeServices 的 13 个成员名称与类型 == NativeServicesProviding | `NativeServices.swift` | ok |
| C4 | BridgeDispatcher 只访问 NativeServicesProviding 声明的成员 | `services.<member>` 扫描 | ok（13 个） |
| C5 | `services.<member>.<method>` 在协议有声明且参数标签一致 | 41 个服务调用点 vs 协议签名 | ok（41/41） |
| C6 | 桥接三文件（JSBridge/WebHost/BridgeDispatcher）无 `!` 强解包、try!、as!、fatalError | 逐行扫描 | ok |
| C7 | 全部 .swift 括号配平且 import 在声明之前 | 39 个文件 | ok |
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
| E1 | web/ + android/ 入库文件数仍为 182（排除 apk/zip） | 递归枚举 | ok |
| E2 | 基线哈希 == 1ea23688…18cbdd | 182 个文件逐个 sha256 后按 `hash * path` 汇总（`web/app.mjs` 平台化 + 新增 `web/state-sync.mjs` 后重登记） | ok |

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
| F8 | P2 教务真实读取（无残留桩）+ 真机运行期修复 + loadState 显式 NSNull 防御 | SchoolReadController.swift / SchoolProvider.swift / BridgeDispatcher.swift:54-64 | ok（needLogin 取消死线、leaveLogin 60s、SSO 重挂 90s、onDismissed、onPageFinished；loadState 显式回包） |
| F9 | project.yml 与 pbxproj 常量一致（版本/部署目标/bundle id/web 引用） | `ios/project.yml` | ok |
| F10 | 白条 A 方案：RootView 底层 `shellBackgroundColor`、WebView 只 `.ignoresSafeArea(.container, edges: .bottom)`、WebHost `clipsToBounds=true`，并用 `jiangshuiShellTheme` 同步 `--bg`；CSS 安全区仍保留 | `App/RootView.swift` / `Web/WebHost.swift` | ok |
| F11 | P2 无头核对：容器两分支 `alpha=0.01`、禁止交互、无障碍隐藏、首次挂载最底层插入；`attachHeadless` 返回 `Bool` 且 provider 挂载失败后 0.4s 重试；`capture` 不强制展示；仅 `needLogin` 触发 `onNeedsVisiblePresentation`（全文件恰好 1 个调用点）；`presentForUser` 前台 guard + completion 内置 `isUserVisible` | `School/SchoolWebViewHost.swift` / `School/SchoolProvider.swift` / `School/SchoolReadController.swift` | ok（A1/A3，task-24） |
| F12 | P3 请假深链 + 上传/定位资产：4 条用途文案非空、定位 `jiangshuiGeo` 只接受 xgxt https origin、shim 的 root 取 `window.top` 且主 frame 与同源 iframe 共用 `root.__jiangshuiGeoCallbacks`、`SchoolFilePicker.swift` 保持未接线、未实现 `runOpenPanelWith` | `Resources/Info.plist` / `School/SchoolGeolocationBridge.swift` / `School/SchoolFilePicker.swift` | ok（A2 + task-25 回归） |

### G. 实时活动（G1，全 ok）

| 编号 | 检查内容 | 关键证据 | 结果 |
| --- | --- | --- | --- |
| G1 | Live Activity：`@available(iOS 16.1, *)` 门槛、`areActivitiesEnabled` 系统开关回退、`Activity.request` / `update` / `end`、`dismissalPolicy: .after(startDate + 600s)`（T+10 自动结束）、`endAll` 撤销、`ClassReminderService` 的 16.1 门槛调用、pending 通知 `prefix(60)` 上限与截断诊断、Info.plist `NSSupportsLiveActivities` | `Services/ClassActivityController.swift` / `Services/ClassReminderService.swift` / `Resources/Info.plist` | ok（16.1 门槛 + 系统开关 + T+10 + 失败回退 + 60 上限） |

### 测试（64/64 pass）

| 测试文件 | 覆盖 |
| --- | --- |
| `ios/tests/pbxproj.test.mjs` | OpenStep tokenizer（注释/引号/数组/嵌套/`$()`/错误输入）、pbxproj 版本与 target 构建设置、每个 target 的 Sources 都在磁盘且单 target 内不重复、主 App/Widget 分 target Sources 映射、共享文件只双 target、A1–A11 |
| `ios/tests/actions.test.mjs` | 契约/Android/iOS 三向 35 action 集合与顺序、default 失败、4 白名单、协议标签回归（C5 根因） |
| `ios/tests/permission.test.mjs` | permissionStatus 快照形状/允许字段/`allowed===granted&&systemEnabled`、PermissionReporter 源码映射、篡改检出 |
| `ios/tests/plist-bridge.test.mjs` | XML plist 解析与残缺输入、Info.plist/ATS/后台/文案、PrivacyInfo、注入 shim、强解包 vs 逻辑非 |
| `ios/tests/baseline.test.mjs` | 182 文件、基线哈希、排序/唯一/存在性、文本哈希仅诊断 |
| `ios/tests/reminder-schedule.test.mjs` | 提醒窗口、BGTask 注册、权限首未知时等待回调后重排 |
| `ios/tests/live-activity.test.mjs` | 实时活动只在 iOS 16.1+ 可见、请求/更新/T+10 结束、失败只写诊断、ClassReminderService 接入并限制 60 条、Info.plist 与 Widget 无关闭入口 |
| `ios/tests/full-suite.test.mjs` | 48 项齐全且全 ok、formatResults 汇总、CLI 退出码 0 |

---

## 3. 失败项

**无。** 最终两轮复跑结果一致：

```text
汇总：48 项，ok 48，fail 0
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

2026-10-30/11-03 对 F10–F12、A5/A6/A11、G1 做单点变异，确认断言不是空转（临时目录已清理，跑法：复制 `ios/` 到临时根，改一个点，再 `runChecks(tempRoot)` 只筛目标编号；临时根没有 `web/`，A7 的 web 目录检查会连带报环境缺失，不纳入结论）：

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

---

## 6. 未验证（需 Mac）

以下项目**本机无法验证**，交付说明中必须保留：

### 6.1 编译与工程
- `xcodebuild -scheme Jiangshui -destination "generic/platform=iOS" build` 是否能编译通过（Swift 语法、类型推断、actor/Sendable、iOS 15 availability）。
- Swift 6 / Xcode 新版本的并发检查与 warning 是否阻塞（本工程 SWIFT_VERSION=5.0）。
- Code signing、Provisioning Profile、Team、`cn.local.tomorrow` 是否与开发者账号匹配。
- 构建产物 Info.plist 的变量展开（`$(MARKETING_VERSION)` → 1.3.1、`$(CURRENT_PROJECT_VERSION)` → 48）。
- Asset catalog 编译、AppIcon 实际渲染、LaunchScreen 实际效果、iPad 分屏/旋转。
- `web` folder reference 是否在 Copy Bundle Resources 中保持目录结构（静态检查只能确认工程引用）。
- Widget Extension（`JiangshuiWidgetsExtension`）的 `.appex` 签名、App Group/Team 匹配、`Embed App Extensions` 实际嵌入、`NSExtension` 激活、ActivityKit 在 iOS 16.1 真机的 Live Activity 能力；静态检查只验证工程结构与 `@available` 门槛。

### 6.2 桥接与运行时
- WKUserScript 在 `.atDocumentStart` 的实际注入时序；`window.Android` shim 是否在 web 首帧前可用。
- WKScriptMessageHandler 的 `jiangshuiBridge` 实际回调、`payload` 字符串化、`onNativeResult` 恰好一次、同 id 去重（JS 侧与原生侧）。
- `__dsjOnBack` 返回键、`onNativeResume` 前台恢复的实际行为。
- loopback `NWListener`：47851 被占用时 47852..47860 的顺序回退、只绑 127.0.0.1、HTTP 431/400/404/405、15s 超时、32KB 上限、路径穿越与 MIME 白名单。
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
- App Store：PrivacyInfo 的 Required Reason API 申报、ATS 例外说明、`ITSAppUsesNonExemptEncryption=false` 是否需要额外文件、4.2/5.1 审核口径。

---

## 7. 审计结论

- 静态检查：48 项全部通过，fail 0（`node ios/tools/check-ios.mjs` 退出码 0）。
- 测试：iOS 64 项全部通过（`node --test ios/tests/`）；web 282 项全部通过（`node --test tests/*.test.mjs`）。
- 共享层：web/ + android/ 182 个入库文件，基线哈希 `1ea23688…18cbdd` 与磁盘一致；新增 `web/state-sync.mjs` 已登记。
- 真实缺陷：**本轮未发现可由静态手段确认的缺陷**；§5 是观察项，§6 是必须到 Mac 上补验的清单。task-34 新增 A11 后，Widget 扩展只能验证工程结构与源码门槛；task-35 新增 G1 后，Live Activity 也只验证 API 调用、16.1 门槛与 T+10 策略，不能替代 Xcode 编译/签名/真机锁屏或灵动岛验证。
- 产物：
  - `ios/tools/check-ios.mjs`：纯 Node、零第三方依赖、可重复运行。
  - `ios/tests/{pbxproj,actions,permission,plist-bridge,baseline,reminder-schedule,live-activity,full-suite}.test.mjs` + `package.json` + `index.mjs`（目录入口，兼容 Node 24 Windows）。
  - `ios/docs/AUDIT.md`：本文件。
