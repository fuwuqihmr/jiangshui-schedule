# 江水课表 iOS 端 · 移植契约（唯一事实来源）

状态：**未编译**（本机为 Windows，无 Xcode/swiftc）。本文件描述的是代码必须满足的结构契约，
静态检查脚本 `ios/tools/check-ios.mjs` 只能在 Windows 上验证结构与一致性，**不能代替编译**。

## 0. 目标与硬约束

- 路线：**WKWebView 壳 + 复用 `web/` 36 个纯 ES Module**，与 `android/` 结构 1:1 对应；苹果 4.2 拒审风险靠原生能力（日历/通知/导出）补足。
- **禁止修改 `web/` 与 `android/`**：`web/` 是 Android 与 iOS 共用层，任何 iOS 需求只能通过桥接与原生实现满足。
  基线（只统计入库源码，排除 `*.apk` / `*.zip` 这类 Android 本地构建产物）：`find web android -type f ! -name '*.apk' ! -name '*.zip' | sort | xargs sha256sum | sha256sum` = `1ea23688954ba6631a98c31aca4c62b593815da5052965434bd057ac6718cbdd`（182 个文件，2026-10-30 重算；唯一新增 web/state-sync.mjs）。
- 无第三方依赖（不加 SwiftPM/CocoaPods 包），只用系统框架：WebKit / EventKit / UserNotifications / UniformTypeIdentifiers / Network / Security。
- 最低系统：**iOS 15.0**（为兼容 2014 款 MacBook Air 上的 Xcode 13.2.1 / iOS 15.2 SDK 而降级；唯一用到的 iOS 16 API 已用 `if #available(iOS 16.0, *)` 回退）。
- Bundle ID：`cn.local.tomorrow`（与 Android `applicationId` 一致）；`MARKETING_VERSION = 1.3.1`、`CURRENT_PROJECT_VERSION = 48`（对齐 Android versionName 1.3.1-rc1 / versionCode 48）。
- 代码风格：Swift 5.9；每个文件 <400 行；桥接路径禁止 `!` 强解包；错误一律转成 `BridgeFailure` 文案回给 JS，不允许 crash。

## 1. 页面承载方式（关键决策，已定）

Android 用 `https://app.local/` 虚拟源 + `shouldInterceptRequest` 从 assets 供资源（MainActivity.java:108,132-143）。
iOS 的 WKWebView **不能**拦截 http(s) scheme，因此二选一，本契约定为 **loopback HTTP 服务**：

- 原生在 `127.0.0.1` 起一个只读 HTTP 服务（`Network.framework` NWListener，端口固定 **47851**，被占用时退化为 `0.0.0.0`? 不行 → 退化为 47852..47860 顺序尝试，并把实际端口用于加载），
  WebView 加载 `http://127.0.0.1:<port>/index.html`。
- 理由：这是一个**真实的 http origin**，与 Android 的 `https://app.local` 语义等价 —— `type="module"`、`fetch('./data/baseline.json')`、`localStorage`、`canvas.toBlob`、CSP `'self'` 全部按标准行为工作。
  自定义 scheme（`jiangshui://`）在 WebKit 上对同源 `fetch()` 行为不可靠（`web/app.mjs:40-41`、`web/consent.mjs:2`、`web/background.mjs:6` 都是顶层 `fetch`），故不采用。
- 只监听 127.0.0.1；提供 **路径穿越防护**（拒绝 `..`、绝对路径、反斜杠、非白名单后缀），后缀→MIME 表固定。
- ATS：Info.plist 设 `NSAppTransportSecurity.NSAllowsLocalNetworking = true`，并给 `127.0.0.1` 加 `NSExceptionAllowsInsecureHTTPLoads`。
- 生命周期：`scenePhase` 回前台时若 listener 已停则重启且**不**重载页面（页面已在内存）；冷启动先起服务再 load。
- 资源根：把 `web/` 目录**整个**作为 `Copy Bundle Resources` 的 folder reference（bundle 内 `web/`），服务器根 = bundle 的 `web/`。不复制源码进 `ios/`。

## 2. JS ↔ 原生桥接协议（必须与 Android 逐字等价）

注入（`WKUserContentController.addUserScript` 在 `documentStart` 注入，且 `WKScriptMessageHandler` 名 `jiangshuiBridge`）：

```js
window.Android = { request: function (id, action, payload) {
  window.webkit.messageHandlers.jiangshuiBridge.postMessage({ id: String(id), action: String(action), payload: String(payload) });
} };
window.__jiangshuiSystemDarkMode = function () { return <bool>; };  // 与 Android 的 systemDarkMode() 对应
```

- `web/bridge.mjs` 只认 `globalThis.Android.request(id, action, JSON.stringify(payload))`，返回 Promise；`web/app.mjs:37,82,119` 等多处用 `globalThis.Android` 做「是否原生」探测 → **必须注入这个 shim，否则大量原生功能会被 JS 判定为网页版而隐藏**。
- 回包（主线程，异步）：`window.onNativeResult(<idJson>, {value: <JSON>})` 或 `{error: "<文案>"}`。Android 的 `result/failure` 在 MainActivity.java:181 附近，语义：成功包 `{value}`，失败包 `{error}`（`error` 存在即 reject）。
- `id` 由 JS 生成（递增字符串），原生必须原样回传；原生侧对同一 id 只回一次。
- **JSON 编解码纪律**：Swift 侧统一用 `JSONSerialization`；回包前必须校验可序列化，序列化失败按 `{error:"操作失败"}` 回。
- **前台恢复**：`sceneWillEnterForeground` → `evaluateJavaScript("window.onNativeResume&&window.onNativeResume()")`（对应 Android MainActivity.java:798）。
- **返回键/滑回手势**：对应 Android MainActivity.java:801-810。
  `evaluateJavaScript("(function(){try{return window.__dsjOnBack?window.__dsjOnBack()===true:false}catch(e){return false}})()")`
  → `true` 表示 JS 已消费（不退出）；否则走原生返回：教务 WebView 可见时能 `goBack` 就 back / 否则关闭；否则 `moveTaskToBack` 等价行为（iOS 无处可退 → 无操作）。
  iOS 非导航栈，`interactivePopGestureRecognizer` 不可用。**P1 落地方式（2026-10-28 修正）**：不叠浮动按钮（44×44 浮层会压住 web 页面标题，run #9 截图已证），改用 `UIScreenEdgePanGestureRecognizer(edges: .left)` 划回 → 调同一段 `__dsjOnBack`；页面内每个可退状态本来就有自带按钮（假条页 `leave-page-back`、弹窗 ×、底部 tab）。静态门禁 F5 会阻止浮动按钮回归。
- **同意门**：除 `consentStatus / acceptConsent / declineConsent / setTheme` 四个 action 外，其余任何 action 在未同意前必须直接失败（Android: `UserConsent.require()` 抛异常）。

## 3. action 全表（**35 个**，1:1 对齐 MainActivity.java:718-758 的 switch 分支）

编号 = Android switch 分支顺序。**P1 = 本轮必须实现；P2 = 教务抓取相关，本轮只做桩（返回明确错误）**。

| # | action | 入参 payload | 出参 value | 阶段 |
|---|--------|--------------|-----------|------|
| 1 | consentStatus | — | 同 `UserConsent.status()` | P1 |
| 2 | acceptConsent | `{version}` | 同 `UserConsent.accept()`，必须含 `version`+`acceptedAt` | P1 |
| 3 | declineConsent | — | `{ok:true}`，随后退出应用（iOS 不能主动退出 → 显示「已拒绝」页面并禁用主界面） | P1 |
| 4 | loadState | — | 状态对象或 `null` | P1 |
| 5 | saveState | `{state, expectedRevision}` | `{revision}` | P1 |
| 6 | setTheme | `{background,surface,preference,dark}` | `{ok:true}` | P1 |
| 7 | classReminderStatus | — | `ClassReminders.status()` | P1 |
| 8 | previewClassReminder | `{lockedTest?}` | `ClassReminders.preview()` | P1 |
| 9 | classReminderSystemSettings | — | `{ok:true}` → 打开系统通知设置 | P1 |
| 10 | closeClassReminder | `{id}` | `ClassReminders.close()` | P1 |
| 11 | notificationSettings | — | `{ok:true}` → 打开系统通知设置 | P1 |
| 12 | permissionStatus | — | `permissionStatus()`（MainActivity） | P1 |
| 13 | autostartSettings | — | `{ok:true}`（iOS 无自启动 → 打开 App 设置） | P1 |
| 14 | runtimeStatus | — | `CheckScheduler.status()` | P1 |
| 15 | requestExactAlarm | — | `{ok:true}`（iOS 无精确闹钟设置 → 打开 App 设置） | P1 |
| 16 | batterySettings | — | `{ok:true}`（打开 App 设置） | P1 |
| 17 | openSchool | `{mobile}` | mobile=true → `{ok:true}`；否则进入抓取流程 | P2 |
| 18 | openWebApp | `{url,warmupUrl}` | `{ok:true}` → 打开假条 WebView | P2 |
| 19 | leaveRecordSync | — | 假条状态同步结果 | P2 |
| 20-22 | calendarStatus / calendarSync / calendarRemove | 见 Android `beginCalendarAction` | 同 `CalendarSync.status()/sync()/remove()/``error()` | P1 |
| 23 | calendarOpenSettings | — | `{ok:true}` → App 设置 | P1 |
| 24 | cancelRead | — | `{ok:true}` | P2 |
| 25-26 | capture / sync | — | 教务读取（异步回包） | P2 |
| 27 | requestNotifications | — | `{ok:bool}` | P1 |
| 28 | notify | `{title,body}` | `{ok:bool}` | P1 |
| 29 | import | — | `{text}`（≤2MB UTF-8）或 `{}`（用户取消） | P1 |
| 30 | export | `{text}` | `{ok:true}` → 写 `课表快照.json` | P1 |
| 31 | getDiagnostics | — | `Diagnostics.read()` | P1 |
| 32 | recordDiagnostic | `{kind,httpStatus}` | `{ok:true}`；kind 白名单 + status 0..599 | P1 |
| 33 | exportDiagnostics | `{filename,text}` | 写文件；文件名必须匹配 `江水课表-排查日志-[0-9-]+\.txt`，text ≤200000 | P1 |
| 34 | exportFile | `{mime,filename,base64}` | 写文件；mime ∈ {image/png,application/pdf,text/plain}；base64 ≤44,739,244；解码 1..32MB；文件名禁止 `\/:*?"<>|` 且 ≤180 | P1 |
| 35 | logout | — | `{ok:true}`，清除状态/同意/缓存/Cookie/Keychain/日志 | P1 |

> `unknown action` → `{error:"不支持的操作"}`。所有异常 → `{error:<中文文案>}`，文案与 Android 现有文案保持一致（不要另造）。

**精确 JSON 形状以 Android Java 为准，禁止自行发明字段**，对照文件：
- `android/.../UserConsent.java` → action 1,2,3
- `android/.../StateStore.java` → action 4,5（revision 语义：`expectedRevision` 不匹配时的冲突行为必须照抄）
- `android/.../CalendarSync.java` → action 20,21,22（`status/sync/remove/error` 的 JSON）
- `android/.../ClassReminders.java` → action 7,8,10
- `android/.../CheckScheduler.java` → action 14
- `android/.../Diagnostics.java` → action 31
- `MainActivity.java` 的 `permissionStatus()`、`systemDarkMode()`、`applyWindowTheme()` → action 12,6

Android→iOS 的能力映射（必须在代码注释里写明差异，不允许静默降级）：
| Android | iOS 等价 |
|---------|----------|
| 桌面小组件 ScheduleWidget*（467+54+…行） | **不做**（iOS WidgetKit 是另一独立扩展，本轮不实现） |
| XiaomiFocus.java | **不做**（iOS 无等效） |
| 精确闹钟 requestExactAlarm | 无等效 → `{ok:true}` + 打开 App 设置 |
| 自启动 autostartSettings | 无等效 → 打开 App 设置 |
| SAF 文件选择 import/export | `UIDocumentPickerViewController` |
| Base64→文件保存 exportFile | `UIDocumentPickerViewController(forExporting:)` 或 `UIActivityViewController` |
| JobScheduler 定时检查 | `BGTaskScheduler`（P2；P1 只登记 Info.plist 的 BGTaskSchedulerPermittedIdentifiers） |
| WorkManager `CheckScheduler` | 同上；`runtimeStatus` 返回「后台刷新是否可用」 |
| AK/SK 加密 school.enc | Keychain（`kSecClassGenericPassword`，`kSecAttrAccessibleAfterFirstUnlock`） |

## 4. 目录与文件归属（写作用域互斥，禁止越界）

```
ios/
  README-iOS.md                          # Lead
  docs/IOS-PORT-CONTRACT.md              # Lead（本文件）
  docs/PHASE2-SCHOOL.md                  # C（P2 交接稿）
  project.yml                            # A（XcodeGen 源）
  Jiangshui.xcodeproj/project.pbxproj    # A（由 tools/gen-pbxproj.mjs 生成）
  Jiangshui/App/                         # A
  Jiangshui/Web/                         # A（LocalServer/WebHost/Bridge/JSBridge）
  Jiangshui/Resources/                   # A（Info.plist / PrivacyInfo.xcprivacy / Assets）
  Jiangshui/Services/                    # B（除 SchoolSession）
  Jiangshui/Services/SchoolSession.swift # C
  Jiangshui/School/                      # C
  tools/gen-pbxproj.mjs                  # A
  tools/check-ios.mjs                    # D
  tests/                                 # D
```

- A = implementer-shell，B = implementer-services，C = implementer-school，D = verifier。
- 共享契约文件 `Jiangshui/Services/ServiceProtocols.swift` **由 Lead 写定，任何人不改**；实现方 conform，调用方只依赖协议。

## 5. 验收（Windows 上能做的）

1. `node ios/tools/check-ios.mjs` 必须 **0 fail**，检查项：
   - **35 个** action 在 dispatcher 里全部出现（且无多余 action；实现者 implementer-shell 已核对：Java switch 共 35 个 case 字符串）；
   - 每个 action 的 swift 服务方法在 `Services/` 里有定义（结构化扫描，非人工）；
   - `project.pbxproj` 内部一致：所有 24 位 hex 引用都有定义、所有 `*.swift` 都在 Sources 阶段、`web` folder reference 存在、Info.plist/Assets 在 Resources 阶段；
   - Info.plist 是合法 XML 且包含必需键（`NSCalendarsFullAccessUsageDescription`/`NSCalendarsWriteOnlyAccessUsageDescription`、`NSUserNotificationUsageDescription`?（iOS 不需要）、`UIBackgroundModes`、`NSAppTransportSecurity`）；
   - 所有 Swift 文件括号/引号配平（粗检）；
   - `web/` 与 `android/` 目录哈希仍等于基线（不得被污染）。
2. `node ios/tests/bridge-contract.test.mjs`：用 Node 模拟 `window.Android` + `webkit.messageHandlers`，加载真实 `web/bridge.mjs` 与 `web/consent.mjs`，验证 shim 协议、result/error 语义、id 往返。
3. **不能验证**（必须在交付说明里明写）：编译、签名、模拟器/真机运行、EventKit/通知/文档选择器实际行为、App Store 审核。


## 7. 接线决策（Lead 已拍板，2026-10-27，覆盖此前疑义）

1. 服务容器签名：`NativeServices(presenting: @escaping () -> UIViewController?, school: SchoolProviding)`；
   启动顺序 = 构造 `SchoolProvider`（自带 presenting VC）→ 构造 `NativeServices` → 交给 dispatcher。
   登出通过 `handleLogout()`（或 `logout` 属性）暴露，dispatcher 不 import 具体实现类。
2. `ConsentStoring.accept(version:)` **throws**（`ServiceProtocols.swift` 已更新）；版本不一致抛
   `BridgeFailure.message("协议已更新，请重新打开应用确认")`。不允许再加 `acceptChecked` 旁路。
3. `FileExchanging` 写入方法返回 Bool：`true`→`{ok:true}`，`false`（用户取消）→`{}`（对齐 Android MainActivity.java:786）；
   `importTextFile()` 返回 `{text}` 或 `{}`。
4. `permissionStatus` **严格照抄 Android 五组**（MainActivity.java:464-483：sdk/notifications/exactAlarm/battery/autostart），
   但 iOS 必须做两处映射，否则 JS 行为错：
   - `exactAlarm:{required:false, allowed:true}`（web/app.mjs:247 据此隐藏「精确闹钟」行）；
   - `battery:{exempt:true}`（web/app.mjs:292 不再催「关电池优化」）；
   - `notifications:{runtime:false, granted:<UN授权>, systemEnabled:<系统通知开关>, allowed:两者与}`；
   - `autostart:{supported:false, known:false, oem:"", openedAt:0}` —— JS 无条件渲染该行，iOS 无自启动，
     登记为**已知 UI 差异**（不可改 web/ 修掉）；`sdk` JS 不读，可省略。
5. `gen-pbxproj.mjs` 必须扫描目录、幂等可重跑；最终整合时由 Lead 再跑一次，把并行新增的 .swift 全部纳入。

## 7.1 追加决策（2026-10-27，C 交付后）
- **SessionVaulting 的实现归属 = C 的 `Services/SchoolSession.swift`**（Keychain 信封 version/savedAt/tgc/academic；
  Keychain service 名 = `cn.local.tomorrow.school-session`、account = `school-session-v1`，与 Android SessionVault.java 的 alias 语义对应）。
  B 不再写 SessionVault.swift，任何第二个 `SessionVaulting` 实现都会 duplicate conformance；NativeServices 内部 `private let vaultImpl = SchoolSession()`。
- **ATS**：除 127.0.0.1/localhost 外，必须为教务 5 域名加 `NSExceptionAllowsInsecureHTTPLoads`：
  portal.juwp.edu.cn / jiaowuh5.juwp.edu.cn / jiaowu.juwp.edu.cn(8080) / eapp2.juwp.edu.cn(9443) / eapp2.nit.edu.cn。
  禁用 NSAllowsArbitraryLoads（上架需说明）。审核说明写「学校教务系统仅支持 HTTP」。
- **openSchool(mobile:false) 行为**：P1 是「打开门户 + 回 `{ok:true}`」的桩；**P2（2026-10-29）已改为等价 `beginSchoolRead`**：走 `SchoolProvider.capture()` 真实读取（见 `docs/P2-SCHOOL-READ.md`）。`mobile:true` 仍只打开学校移动页。
- **iOS 独有文案**（Android 无对应，已登记）：「学校页面暂时无法打开，请稍后重试」、「学校会话保存失败/读取失败/清除失败」。

## 6. 阶段计划

- **P1（已交付）**：可编译结构 + 全本地功能（同意/主题/状态/日历/通知/上课提醒/导入导出/诊断/登出）+ 35 个 action 的 dispatcher 全量路由。
- **P2（2026-10-29 已交付，待真机验证）**：教务真实读取（`School/SchoolReadController.swift` 四阶段状态机：restore → ssoRecover → portal/profile → read）+ 假条列表直连同步（`School/LeaveRecordsService.swift`）+ 请假页会话参数记忆（uid/pageEnc）。实现细节与已知差异见 `docs/P2-SCHOOL-READ.md`；蓝图原文（行号对照、Android 逐段拆解）仍在 `docs/PHASE2-SCHOOL.md`。
