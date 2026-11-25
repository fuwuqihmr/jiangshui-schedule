# P2 · 教务真实读取（iOS）

> 交付日期：2026-10-29　实现：Lead（本会话直接开发，未分工）
> 目标：把「一行不存在的 P2」变成能真正登录学校 → 读课表 → 读假条的 iOS 实现，与 Android 行为对齐。
> 状态：**已编译通过**（commit `9685ab5`：Debug / Release / iphoneos 三条链路 BUILD SUCCEEDED、0 error，未签名 IPA 3,243,844 B 已产出；静态门禁 50/50、iOS 82 测试、web 391 测试全绿）。**尚未用真实学校账号跑通** —— 真机验证是唯一的验收口径。
> 真机验证清单见 §7，必须用真实学校账号跑一遍本文件才算「P2 完成」。

## 1. 新增/改动的文件

| 文件 | 行数（约） | 角色 |
| --- | --- | --- |
| `Jiangshui/School/SchoolReadController.swift` | 1080 | 主线程状态机：restore → ssoRecover → portal/profile → read，含无头容器转可见回调 |
| `Jiangshui/School/LeaveRecordsService.swift` | 280 | 假条列表直连同步（URLSession + 手工 Cookie 头 + 表单解析） |
| `Jiangshui/School/SchoolProvider.swift` | 399 | 从 P1 桩改为真实实现；持有 host / controller / leaveRecords，负责无头/可见容器切换 |
| `Jiangshui/School/SchoolWebViewHost.swift` | 712 | 新增 `onNavigate`/`onNavigationFailure`/`onProcessTerminated`、`evaluate(script:completion:)`、`stopLoading()`、无头挂载与定位桥接线 |
| `Jiangshui/Web/BridgeDispatcher.swift` | 331 | `openSchool(mobile:false)` 改为走 `capture()`（对齐 `MainActivity.java:737`） |
| `Jiangshui/Services/ServiceProtocols.swift` | 191 | `SchoolProviding` 新增 `clearLeaveSession()` |
| `Jiangshui/Services/LogoutController.swift` | 52 | 注销时清请假会话参数（对应 Android 清 `leave-session`） |
| `Jiangshui/School/SchoolLeaveSessionController.swift` | 255 | P3 请假深链：五标志状态机，负责 xgxt/office 页重定向与重新登录探测 |
| `Jiangshui/School/SchoolGeolocationBridge.swift` | 253 | P3 定位：注入 navigator.geolocation shim，校验 xgxt https origin |
| `Jiangshui/School/SchoolLocationPermission.swift` | 165 | P3 定位权限：CLLocationManager 主线程请求与状态映射 |
| `Jiangshui/School/SchoolFilePicker.swift` | 197 | P3 上传预留：PHPicker/UIDocumentPicker，当前**未接线** |
| `Jiangshui/Web/LocalServer.swift` | 399 | P0 页面服务自愈：健康判定/代际/1.5s waiting/端口回退 |
| `Jiangshui/Web/WebHost.swift` | 559 | P0 错误遮罩、`retryPage()` stop→start、0.4s 自动重试一次 |
| `Jiangshui/App/RootView.swift` | 138 | P0 错误卡片标题与「重试」按钮 |
| `tools/check-ios.mjs` | — | F8 P2/P3 门禁 + F10-F14 + G1（当前 50 项） |

未改动：`android/`、`harmony/`。`web/` 基线 **182 文件 / `1ea23688…18cbdd`**；相对接手时新增 `web/state-sync.mjs`（保存三层兜底，见 §10），`web/app.mjs` 有启动/保存自愈改动，其余 ES Module 未动。

## 2. 四阶段状态机

```
start(host:completion:)
  ├─ 已在跑 → 直接回「正在读取课表，请稍候」
  ├─ note「正在检查学校会话…」，总超时 90s
  ├─ restoreCookies()
  │    ├─ WKHTTPCookieStore 已有 bzb_jsxsd → beginPageLoad()
  │    ├─ Keychain 有 tgc/academic 且通过 isSafeCookieValue → 写入 cookie → beginPageLoad()
  │    └─ 都没有 → sso("missing-academic-cookie")
  ├─ beginPageLoad()：再确认 bzb_jsxsd 仍在（否则 sso），
  │    目标页 = 没有 profile ? /jsxsd/framework/xsMainV.htmlx : /jsxsd/xskb/xskb_list.do?viweType=1
  └─ 每次 didFinish → page(url) 分派
```

| 阶段 | 触发 | 行为 |
| --- | --- | --- |
| restore | `start` | Keychain → WKHTTPCookieStore；TGC 域 `eapp2.juwp.edu.cn` path `/cas/`、bzb_jsxsd 域 `jiaowu.juwp.edu.cn` path `/jsxsd/`，+7 天过期 |
| ssoRecover | 缺 cookie / 落到 login 页 / 脚本回 login | **只重试一次**：note「正在使用已保存的学校登录状态恢复教务会话…」→ 载 `SchoolURLPolicy.schoolSSOEntryURL`；二次失败 → 「学校会话自动恢复未成功，原课表已保留。请稍后重试；如统一身份认证已过期，系统会要求重新登录」 |
| portal | 落到 portal / jiaowuh5 域 | 注入 JS 找教务入口链接（含 `jiaowu.juwp.edu.cn`）与登录标志；有密码框 → needLogin；20×400ms 未找到 → 「门户页面未提供教务入口，保留原课表」 |
| profile | 教务首页 | 注入 `web/profile-reader.js` 读年级 → 载课表页；读不到也继续（不阻塞） |
| read | 课表页 | 注入 `window.__tomorrowRequestId` + `web/school-reader.js`，每 200ms 轮询 `window.__tomorrowRead`（450 次 ≈ 90s） |

登录等待（`needLogin`）：`awaitingLogin = true`、note「请在学校页面完成登录」、**取消原截止计时**（对齐 `SchoolClient.java:47-48`，不再另设 60s；**不重置 ssoUsed**）。
用户登录成功后落到 `/jsxsd/framework/` → `leaveLogin()` 挂 **60s** 兜底（`leaveLoginDeadline`）+ `persistSessionCookies()` + 继续读；已保存 cookie 直接进教务时保留 `start()` 的 **90s** 总时限。

成功收尾：`{rows, totalWeeks, semesterId, studentProfile?}`；`semesterId` 不匹配 `^[0-9]{4}-[0-9]{4}-[12]$` → `"unknown"`；
`rows` 空或 `weeks` 不在 1..60 → 「学校课表不完整，保留上次课表」。失败一律先 `host.stopLoading()` + 取消投递。
用户取消 → 「已取消读取，保留原课表」（前端按前缀「已取消」识别为取消，不写变更记录）。

## 3. Cookie 与 Keychain

- `WKHTTPCookieStore` 与 `URLSession` 的 `HTTPCookieStorage` **不共享** → 假条同步自己拼 `Cookie` 头（见 §4）。
- Keychain 信封由 `SchoolSession`（P1 已交付）管理：`{version, savedAt, tgc, academic}`，服务 `cn.local.tomorrow.school-session`，单条上限 100000 字节。
- 会话失效：`clearExpiredTGC()` 写空 TGC（expires -60s）+ `vault.clearTGC()`，只清 TGC 不动教务 cookie。
- Keychain 同步 → 异步写入存在「读发生在写之后」的时序问题，已用「先写好再读」+ 状态机重入保护规避；真机需重点验。

## 4. 假条列表（leaveRecordSync）

- 前置：从学校 WebView 的 cookie store 取 `xgxt.juwp.edu.cn` 域的非空 cookie 拼头；空 → `{ok:false, code:"NEED_LOGIN"}`。
- 会话参数：`uid` 与 `pageEnc` 来自请假页 URL，登录后由 `SchoolWebViewHost.onNavigate` → `LeaveRecordsService.rememberSession(url:)` 记入 UserDefaults（键 `leave.uid` / `leave.pageEnc.<formId>`），正则校验：uid `^[0-9]{1,30}$`、pageEnc `^[A-Za-z0-9_-]{8,256}$`。缺失/非法 → `NEED_SESSION`。
- 请求：POST `SchoolURLPolicy.leaveListURL`，body 字段顺序必须与 Android 逐字一致：
  `formId=278616&uid=…&formUserId=0&aprvAppId=278616&pageEnc=…&cpage=1&pageSize=50&desensitization=&startTime=&endTime=`
  头：`Content-Type: application/x-www-form-urlencoded; charset=UTF-8`、`X-Requested-With: XMLHttpRequest`、`Cookie`。
- URLSession 用 ephemeral 配置 + `httpShouldSetCookies=false` + `httpCookieAcceptPolicy = .never`（禁止系统接管 cookie），12s/13s 超时。
- 错误码：`HTTP_<code>` / `PARSE`（非 JSON、超 2MB、结构不符）/ `TIMEOUT` / `NETWORK`；**一律回对象不抛错**，因为前端只读 `response.code`。
- 解析：`root.data.formsUserList` → `{id, status, statusText, statusId, typeText, reason, startAt, endAt, submittedAt, approver, number, durationDays}`；状态词表驳回/退回/不通过/拒绝/不同意 → `rejected`，待/审批中/处理中/审核中 → `pending`，通过/批准/同意/已完成 → `approved`，空文本且 `statusId=="2"` → `approved`。
- 时间：`submittedAt` 优先用表单「请假申请时间/申请时间」，否则 `inserttime` 毫秒按 GMT+8 格式化。
- **迁移陷阱**：Java `String.matches()` 是全串匹配，Swift `range(of:options:.regularExpression)` 是子串搜索 → 所有正则已手动加 `^`/`$`。

## 5. 桥接契约（与 web/ 前端对齐）

| action | 返回 |
| --- | --- |
| `capture` / `sync` / `openSchool(mobile:false)` | `{rows:[{kc_mc,jg0101mc,sktime,skddmc,jx0404id,kch}…], totalWeeks:Int, semesterId:String, studentProfile?:{…}}`，失败抛 `BridgeFailure` → `{error:文案}` |
| `leaveRecordSync` | `{ok:true, fetchedAt:<毫秒数字>, records:[…]}` 或 `{ok:false, code:…}` |
| `cancelRead` | `{ok:true}` |
| `openSchool(mobile:true)` | 打开学校移动页，回 `{ok:true}` |

前端 `web/app.mjs` 的 `readSchool()` 支持 `result.rows` 直传（用 `buildBundle` 组装）；`web/leave-status.mjs` 要求 `fetchedAt` 是数字毫秒。**web/ 未改动**，全部适配在原生侧。

## 6. 与 Android 的已知差异（登记）

1. **不转发 `window.onNativeProgress`**：进度只写学校容器顶栏 note。Android 会在 web 侧显示进度条文案。
2. **不读 StateStore 缓存的 `studentProfile`**：每次重读年级页（Android 优先用缓存）。
3. **无 `onReceivedHttpError` 分支**：WKWebView 无同等回调，统一按导航失败或脚本 `error` 处理。
4. **学校容器顶栏按钮**：仍是「返回课表」；读取中取消通过 `cancelRead` action（Android 会换成「取消读取并返回课表」）。
5. **失败后不自动收起学校页**：`fail()` 只 stopLoading + 回包；成功与失败在 `capture` 完成后由 Provider 统一 `closeHostAfterRead()`。
6. **子框架不做白名单判定**：`decidePolicyFor` 对 `targetFrame?.isMainFrame == false` 的导航直接 allow（Android `shouldOverrideUrlLoading` 只拦主框架）。顶层越界仍会被 cancel 并提示「已拦截校外页面跳转 / 已拦截自动跳转到校外页面」。
7. **URLSession 默认跟随重定向**：Android 的 `HttpURLConnection.setInstanceFollowRedirects(false)`，iOS 侧没有等价关闭 → 假条接口若 302 到登录页，会被当成 200 HTML 走 `PARSE`，错误码与 Android（`HTTP_302`）不同。文案层面都在「重新打开请假与调休」提示内。
8. **没有独立 connect 超时**：Android 是 connect 8s / read 12s；iOS 只有 `timeoutIntervalForRequest = 12s` + `timeoutIntervalForResource = 13s`（前者近似读超时，后者兜 connect）。弱网下最长可见等待比 Android 长约 3～4 秒。

## 7. 真机验证清单（必须用真实学校账号）

前置：Sideloadly 重签安装最新 IPA → 打开 App → 同意协议。

1. **首次登录**：点「读取学校课表 / 立即核对」→ 弹出学校页面（portal.juwp.edu.cn）→ 输入学号密码 + 统一身份认证 → 落到教务首页 → 学校页自动收起 → 主界面出现真实课表、学期、周次。
2. **缓存复用**：杀掉 App 重开 → 直接点「立即核对」→ **不再要求登录**（Keychain 里的 TGC/教务 cookie 生效），仍能读到课表。
3. **SSO 恢复**：等教务会话自然过期（或手动清教务 cookie）→ 点「立即核对」→ 应看到「正在使用已保存的学校登录状态恢复教务会话…」并自动恢复；恢复失败应看到完整文案且旧课表仍在。
4. **假条同步**：进「变更记录」→ 应出现真实假条列表（条数与教务一致），无假条时显示 0 条而不是「学校服务暂时不可用」。
5. **假条登录态**：假条页从未打开过时，`leaveRecordSync` 应回 `NEED_LOGIN/NEED_SESSION` 而不是崩溃；打开过「请假与调休」后立刻刷新应收敛为真实数据。
6. **取消**：读取中点学校页返回 → 主界面提示「已取消读取，保留原课表」，旧课表不丢。
7. **弱网/超时**：飞行模式下点核对 → 「学校页面暂时无法连接（错误码 N），原课表已保留」，不白屏。
8. **失败文案准确性**：确认错误码与文案对得上（`TIMEOUT`→学校响应超时，`PARSE`→结构变化，`HTTP_xxx`→服务异常）。

## 8. 风险

- **编译结论仍不完整**：首轮 CI 只暴露了 1 个类型错误（`SchoolProvider.swift:161` 的 `() -> ()?`），Swift 遇到首个类型错误后不会完整类型检查其余文件，所以「已修 1 条」不等于「已经能编过」。真正确认要等下一轮 CI 的 BUILD SUCCEEDED（Swift 5.0 语言模式 / iOS 15 部署目标）。
- **Keychain 与 Cookie 的时序**：写入后立刻读取依赖实现同步语义，真机首次登录路径必须实测。
- **学校页面结构**：`school-reader.js` / `profile-reader.js` 的选择器与接口沿用 Android 已跑通的版本，但教务系统改版会同时影响两端。
- **没有进度反馈**：iOS 侧只有顶栏 note，长流程体感比 Android 差（差异 1）。

## 9. 复跑命令（Windows 可跑，不需要 Mac）

```bash
cd ios
node tools/gen-pbxproj.mjs     # 幂等；自动收录新 .swift（当前 Swift 41 个）
node tools/check-ios.mjs       # 50 项静态门禁
node --test tests/             # 82 项桥接/工程一致性测试
cd .. && node --test tests/*.test.mjs   # web 共享层 391 项
```

## 10. 真机首跑故障与修复（2026-10-30）

### 10.1 现象

Sideloadly 重签的 IPA 在真机首次登录成功后，课表已能显示，但界面反复弹「课表已在后台更新，请稍后重试」，保存无法收敛；重开 App 后旧数据仍在，再保存继续冲突。

### 10.2 定位结论（task-11）

- 文案唯一来源是 `Jiangshui/Services/StateStore.swift:37-39`：`expectedRevision != 磁盘 revision` 时抛 `BridgeFailure("课表已在后台更新，请稍后重试")`，不是 web 侧文案。
- `StateStore` 的冲突比较读磁盘 `state.json` 的 `_revision`；而 `web/app.mjs` 内存里的 `state._revision` 在「启动恢复失败 / 上次回包丢失 / 页面重载」时会落后于磁盘，于是每次 `saveState` 都带旧 revision，必然冲突。
- **首次冲突的来源无法只靠静态证据确定**：可能是上次保存已落盘但回包丢失、启动时旧快照校验失败、或页面重载后回到旧内存；三者在日志上都表现为 `expected < disk`，必须靠真机 `applog.txt` 的 `state-save conflict expected=… disk=…` 区分。

### 10.3 三层兜底（`web/state-sync.mjs`，task-16）

1. **boot 保留磁盘 revision**：`app.mjs` 启动时若旧快照校验失败，不再直接丢弃 revision，而是用 `savedStateRevision()` 把磁盘 `_revision` 留在内存。
2. **冲突自愈重试**：新增 `saveStateWithRecovery(call, data, expectedRevision)`；第一次冲突 → `loadState` 读磁盘 revision → 用磁盘 revision 重存**同一份本地数据**。
3. **强制保存**：第二次仍冲突 → 用 `expectedRevision: -1` 跳过版本检查落盘；第三次失败才抛第三次的错误（不吞 I/O 错误）。

`app.mjs` 的 `save()` 统一走该函数；`readSchool()` 失败分支的 `await save()` 补 `.catch(()=>{})`，避免保存失败覆盖原始读取错误。

### 10.4 P2 四条运行期修复（task-13）

| # | 位置 | 问题 | 修复 |
| --- | --- | --- | --- |
| 1 | `SchoolReadController.swift` | `enterLogin()` 仍挂 60s 截止，用户在学校页慢慢输入时会被误杀；`navigationFailed` 在登录等待期直接终止读取 | `enterLogin()` 改 `cancelDeadline()`；`navigationFailed` 开头 `if awaitingLogin { return }`；登录成功进入教务后由 `leaveLogin()` 挂 `leaveLoginDeadline = 60` 兜底（task-55 进一步把登录等待改为 6s 呈现窗口 + 180s 前台倒计时、后台暂停，见 §13；`leaveLogin` 60s 不变） |
| 2 | `SchoolReadController.swift` | SSO 恢复阶段没有重挂总时限，Android 在 `sso()` 重挂 90s | `sso()` 内 `scheduleDeadline(Self.totalDeadline)` |
| 3 | `SchoolProvider.swift` | 用户点学校页「返回课表」后，读取协程仍空等到 90s | 新增 `dismissed = { controller.cancel() }` 并赋给 `created.onDismissed` |
| 4 | `SchoolProvider.swift` | 只在 `onNavigate` 抓 `uid/pageEnc`，重定向/前进后退会漏，假条同步恒 `NEED_SESSION` | `onPageFinished` 再调 `leaveRecords.rememberSession(url: url)`（与 `onNavigate` 共两处） |

> **因果不要写反**：`BridgeDispatcher.swift:54-64` 把 `loadState` 改成显式 `if let saved … else NSNull()` 只是防御（防止将来 `reply` 的 `Any?` 形参改动后 nil 被吞）；原写法直接传 `Any?` 本就能正确回 null/对象，**它不是保存死循环的根因**。根因是 `_revision` 落后磁盘 + 冲突无兜底。

### 10.5 状态与验收

- 已落盘：`web/state-sync.mjs`、`web/app.mjs` 三层兜底；`StateStore` 冲突日志；上表四条运行期修复；`BridgeDispatcher` 显式回包防御。
- 静态门禁 **50/50**、iOS **82 pass**、web **391 pass**（`node tools/check-ios.mjs` / `node --test tests/` / `node --test tests/*.test.mjs`）。
- **尚未重新编译、重签、真机复跑**：本机无 Xcode，结论只到静态与 Node 层。下一次真机重点验：首次登录不弹保存冲突、点「返回课表」立即取消、假条同步不再恒 `NEED_SESSION`、登录等待不再被 60s 误杀（现已改为 6s 呈现 + 180s 前台倒计时，见 §13）。

## 11. P3 进展：顶部白条、无头核对、请假深链、上传与定位（2026-10-30）

静态门禁已扩到 **50 项**：F10 增补白条 A 方案断言，新增 F11（无头核对）与 F12（请假深链 + 上传/定位资产）；task-55 又新增 F13（页面服务自愈）与 F14（登录时钟，见 §13）。以下四项仍需真机/真账号验证，本机只到静态层。

### 11.1 顶部白条：WebView 只落底部安全区

- `RootView` 底层先铺 `Color(uiColor: host.shellBackgroundColor).ignoresSafeArea()`，再把 `WebViewContainer` 改为 `.ignoresSafeArea(.container, edges: .bottom)`：WebView 顶边落在顶部安全区下沿，状态栏/灵动岛区域由不透明色条填充，**不用 CSS 遮挡**。
- `WebHost` 设 `isOpaque = false`、`clipsToBounds = true`，并注册 `jiangshuiShellTheme` handler：读页面 `--bg` 变量 + `MutationObserver`，主题切换时把状态栏色条同步成页面背景色；内核滚动内容被物理裁剪，不会画进顶部色条。
- 静态锁：F10 同时要求 `clipsToBounds = true`、`shellThemeUserScript`、handler 名与注册调用；回归（例如有人把 WebView 改回整体 `.ignoresSafeArea()`）会直接红。

### 11.2 无头核对：自动读取不强制弹学校页

- 自动核对（`capture` / `prepareHostForRead`）不再调 `presentForUser`；容器以 **headless** 方式挂在 presenter 最底层：`alpha = 0.01`（完全透明会被 WebKit 当后台冻结）、`isUserInteractionEnabled = false`、`accessibilityElementsHidden = true`、`insertSubview(view, at: 0)`。
- 挂载若落在学校页 dismiss 窗口内，`attachHeadless` 返回 `false`（不再静默失败），`prepareHostForRead` 返回 `nil`；`capture` 在 0.4s 后重试一次，仍失败回「学校页面正在关闭，请稍后再试」，避免自动核对空转到 90s（A1，task-24）。
- 只有 `SchoolReadController.needLogin()` 触发 `onNeedsVisiblePresentation?()` → `SchoolProvider` 在 `ensureHost` 里挂的 `presentForUser(from:)` 才把容器转成可见、可交互并全屏 present。静态锁：全 controller 恰好一个 `onNeedsVisiblePresentation?()` 调用点，且必须在 `needLogin` 内（F11）。
- `presentForUser` 只在前台执行：后台收到 `needLogin` 时提示「请回到江水课表完成登录」并放弃本次 present；`isUserVisible = true` 要等 present completion 且 `presentingViewController != nil` 才置位，避免 present 失败仍被当成可见（A3，task-24）。

### 11.3 请假深链：五标志十步状态机（对齐 `MainActivity.java:336-404`）

五标志：`warmupPending` / `targetRequested` / `officeLoaded` / `reloginTried` / `retargetTried`，全部只在主线程读写。十步：

1. `open(url:warmupUrl:host:)` 复位五标志、递增 `generation`、取消旧计时器并提示「正在加载学校登录页面…」。
2. `hasXgxtSession` 通过 `WKHTTPCookieStore` 做 RFC 6265 domain-match 找 `UID`（兼容学校把 cookie 设在父域 `.juwp.edu.cn`）。
3. 无 xgxt 会话且给了 warmup → 置 `warmupPending`，先载统一身份认证 warmup 页，并挂 30s 慢加载提示。
4. 已有 xgxt 会话 → 直接 `loadTarget()` 载请假目标深链。
5. `pageFinished` 落在 CAS 页 → 只提示「请在学校页面完成统一身份认证登录（本应用不保存密码）」，不抢导航。
6. warmup 页完成 → 复检 `UID`；已登录则 `loadTarget()`，未登录则提示「登录未完成…」。
7. Cookie 写入可能滞后于 `onPageFinished` → 450ms 后再复检一次（对齐 Android）。
8. 目标未请求且已有会话 → 自动 `loadTarget()`；否则停留等待用户操作。
9. 落到 office 表单页 → 置 `officeLoaded`，注入 `(document.body.innerText).includes('请重新登录')` 检测会话失效；只自动回 warmup 一次（`reloginTried`）。
10. 会话存在但落回 xgxt 首页而非 office → 只自动重载目标深链一次（`retargetTried`），避免循环；之后保留页面让用户手动刷新。

页面失败/进程回收分别提示「学校页面暂时无法连接，请检查网络后点刷新」「请假页面已关闭，请重新打开」。

### 11.4 P3 偏离：上传与定位（需真机验证）

| 项 | 现状 | 原因 / 风险 |
| --- | --- | --- |
| 请假附件上传 | `SchoolFilePicker.swift` 197 行已写好 PHPicker / UIDocumentPicker 与临时文件清理，但 **没有任何调用点**（F12 锁住“未接线”）。 | WKWebView 的文件选择入口 `WKUIDelegate.runOpenPanelWith` 仅 **iOS 18.4+** 才有；当前部署目标 iOS 15.0，直接实现会编译失败。P3 若要支持上传，需按可用性分支实现并补真机验证；在此之前请假表单的附件按钮无响应，其余请假/销假/续假流程不受影响。 |
| 请假页定位 | `SchoolGeolocationBridge` 以 `jiangshuiGeo` handler + `WKUserScript` 替换 `navigator.geolocation`；handler 校验 `message.frameInfo.securityOrigin`（https + `SchoolURLPolicy.isXgxtUrl` + 端口 0/443）、容器为请假模式且可见后才请求定位；`SchoolLocationPermission` 用 `CLLocationManager` 主线程请求并映射权限。 | `WKNavigationDelegate.requestGeolocationPermissionFor` 仅 **iOS 27+** 才有，旧系统无法走系统级代理，因此采用脚本 shim；需真机确认学校页面能接受 shim 返回的坐标、权限拒绝/受限/超时路径文案正确，以及 xgxt 若换域会立即被 origin 白名单拒绝。 |

### 11.5 已知限制（task-24/task-25 复核后保留）

1. **跨域 iframe 的定位仍会超时（code 3）**：shim 注入到所有 frame，原生回填只在主 frame 求值。同源 iframe 已由 task-25 修好——注入脚本无条件取 `window.top` 作为 root，主 frame 与同源 iframe 共用 `root.__jiangshuiGeoCallbacks` 一张注册表，主 frame 能查到 iframe 的 entry。跨域 iframe 访问 top 会抛 `SecurityError`，代码 try/catch 退化为自身 window，注册表仍在 iframe 内，主 frame 回调查不到 → 客户端超时。需要原生按 frame 回填（或限制定位只在顶层页面使用）才能彻底解决。
2. **后台收到 `needLogin` 不自动重试 present**：`presentForUser` 要求 `applicationState == .active`；后台时只提示「请回到江水课表完成登录」，回前台后不会自动补一次 present。用户需重新触发读取（或再次进入登录流程）才会弹出学校页。

### 11.6 状态

- 静态门禁 **50/50**、iOS **82 pass**、web **391 pass**（`node tools/check-ios.mjs` / `node --test tests/` / `node --test tests/*.test.mjs`）。
- **考试透传与 P0 修复本轮未编译**；白条视觉、无头容器是否被 WebKit 降频、请假深链回跳、上传/定位两条 P3 偏离都已随 v1.5.0 编译，但仍需 Mac + 真机复核。

## 12. 考试字段透传（S 档，2026-11-24，未编译验证）

- **数据链**：`web/school-reader.js` 在读取课表时已同源抓考试（`/jsxsd/xsks/xsksap_list`，每页 20 条、最多 5 页）；失败映射为 `session` / `http` / `format` / `timeout` / `other`，并附 `examHttpStatus`。iOS 之前只组装 `rows/totalWeeks/semesterId/studentProfile`，本次新增 19 行把三个字段透传给网页。
- **透传规则**：`exams` 仅当读取结果是 JSON 数组才写入；`examFetchedAt` 与 `examError` 仅非空才写入；`examError` 不在五类白名单（`http` / `session` / `timeout` / `format` / `other`）内统一归 `other`；`examHttpStatus` 有意不透传。
- **失败语义**：考试失败时 `school-reader.js` 带 `examError` 而不带 `exams` / `examFetchedAt`，网页据此保留旧快照（`web/jiaowu-exam.mjs`）；原生不做考试业务解析。
- **回归**：F8 新增第 8 节（payload 键集合、三字段守卫、白名单、未知字段、写入顺序），`ios/tests/exam-passthrough.test.mjs` 新增 6 条；变异「把 `optArray` 改成直接下标」会让 F8 与该测试同时红。
- **未验证**：本轮改动尚未重新编译、未真机、未用学校账号验证考试接口；`examHttpStatus` 是否需要透传由后续产品/前端决定。

## 13. P0 页面服务自愈与登录等待（2026-11-25，未编译验证）

这轮修的是两个会把用户卡死的运行期问题，产品代码由实现方修改，本文件只补说明、门禁与回归口径。

### 13.1 页面服务自愈（LocalServer + WebHost + RootView）

- **问题**：本机 loopback 服务只在启动时试一次端口；`NWListener` 进入 `.waiting`（端口被占用/系统回收）或 `.failed` 后，页面可能永远停在白屏，用户只能杀 App。
- **LocalServer**：新增 `isHealthy = shouldRun && listener != nil && port != nil`；`generation` 每次 start/stop/drop 递增，旧 listener 的迟到回调先比对代际与对象身份再处理；`.waiting` 挂 1.5s 定时器，超时后先 `dropListenerLocked`、回调 `onInterrupted`、再从 47851 或下一个候选端口重启；`.failed/.cancelled` 走同一恢复路径；`stop()` 可重入；端口耗尽时 `failLocked()` 只回调一次 `onFailure`（文案「本机端口 47851–47860 均被占用…」）。
- **WebHost**：新增 `serverErrorTitle`（默认「页面服务未启动」）；`onFailure` 设置标题与 `serverError`，`onInterrupted` 只清加载/导航状态等自动重启；`retryPage()` 先 `server.stop()` 再 `server.start()`；`startIfNeeded()` 在端口存在但 `isHealthy == false` 时直接重试；`loadIndex` 同端口去重并清错误；`handleLoadFailure` 忽略 `NSURLErrorCancelled`，每轮只做一次 0.4s 自动重试，第二次失败显示「页面加载失败 / 无法连接服务器。」；`didFinish` 清 `serverError` 与自动重试标记。task-59 起 `didFinish/didFail/didFailProvisional` 都先用 `isCurrentNavigation` 校验 `currentNavigation` 对象身份，导航被替换或 `currentNavigation` 已被清空时直接丢弃旧回调，避免旧页面回调污染新一轮。
- **RootView**：错误卡片显示 `host.serverErrorTitle`，并提供「重试」按钮调用 `host.retryPage()`。
- **门禁与回归**：F13 + `ios/tests/p0-fixes.test.mjs` 前 5 条；变异「isHealthy 去掉 port 判定 / recover 先通知后清理 / 重试不 stop / 0.4s 改 0.5 / didFinish 不清错误」均红；task-59 的旧导航身份校验由 F13 一并锁住（3 处导航回调）。

### 13.2 登录等待时钟（SchoolReadController + SchoolProvider）

- **旧口径的问题**：`enterLogin()` 只取消 60s 截止，登录页迟迟不出现时读取会一直挂着；后台时间也被算进超时；落到 `xskb` 时若仍在 `awaitingLogin`，会先撞上 `reading` 守卫白等。
- **新口径**：`loginDeadline = 180` 只累计前台时间；`loginPresentationWait = 6` 是「请求把学校页转成可见」的呈现窗口，0.5s 轮询宿主是否真的可见；可见后从 presenting 切到 waiting，并挂 180s 活跃倒计时。退后台 `pauseLoginClock()` 累计已用时长并取消两个 work，回前台 `resumeLoginClock()` 续跑；`willResignActive/didBecomeActive` 观察者弱引用，`stopLoginClock()` 统一移除。
- **失败语义**：6s 内未转可见，写 `login-present-ignored reason=no-host/not-active/already-presenting/present-ignored app-state=…` 诊断，并回「学校登录页暂时无法打开，请回到江水课表后重试（原课表已保留）」；180s 前台时间耗尽回「等待学校登录超时，保留上次课表。请重新读取」。
- **xskb 落点**：`if path.hasPrefix("/jsxsd/xskb/")` 分支先 `if awaitingLogin { leaveLogin() }` 停表，再进 `reading` 守卫并 `read()`；`leaveLogin()` 负责 `stopLoginClock()` 并挂 60s 教务读取兜底。
- **页面换代（task-58）**：`read()` 记录 `readingPageURL = host?.currentURLString` 并推进 `readingToken`；注入 completion、`recoverRead`、`pollRead`、`retryPollRead` 都带 token 且校验 `token == readingToken`；`xskb` 分支遇到 `reading` 时，同一 URL 的重复 `didFinish` 直接返回，URL 变了则复位 `reading/readingPageURL` 并推进代次后重新 `read()`，旧轮询看到代次不一致立刻退出。
- **SchoolProvider**：`onNeedsVisiblePresentation` 在无 host/presenter 时写 `login-present-skipped reason=…` 诊断，不再静默失败。
- **门禁与回归**：F14 + `p0-fixes.test.mjs` 后 5 条；变异「180 改 90 / needLogin 不启动时钟 / xskb 先 guard 后 leaveLogin / isApplicationActive 判 background」均红；task-58 的页面换代由 F14 一并锁住（旧轮询/旧注入作废）。

### 13.3 状态

- 本机静态门禁 **50/50**，iOS 回归 **82/82**，web **391/391**，gen 幂等 sha `b1cfa9e2…41b3d8b`。task-58/59 的 reading 换代与旧导航身份校验已并入 F14/F13，仍 50 项、不新增编号。
- **未编译、未真机**：端口占用/系统回收时的 1.5s 换端口、`stop→start` 后 WKWebView 重载、真机锁屏/切后台时 180s 的累计与恢复、错误卡片布局与按钮交互，都必须由 CI 编译 + 真机（含学校账号）验证。
