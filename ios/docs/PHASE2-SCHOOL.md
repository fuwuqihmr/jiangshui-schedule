# 第二阶段（P2）交接：学校 / 教务 / 请假线

本稿面向拥有 Mac + Xcode + 真机的 P2 实现者。P1 只交付“骨架 + 安全策略”，**不包含任何课表或假条抓取逻辑**。 所有“Android 做了什么”都指仓库内 android/app/src/main/java/cn/local/tomorrow/MainActivity.java（819 行） 与同目录 SchoolClient.java（72 行）；行号以当前文件为准。

## 0. P1 已交付内容

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| ios/Jiangshui/School/SchoolURLPolicy.swift | 318 | URL 白名单策略（逐条移植 MainActivity.java:62-107）+ 纯 Swift 断言 selfCheck() |
| ios/Jiangshui/Services/SchoolSession.swift | 146 | SessionVaulting 的 Keychain 实现（替代 Android SessionVault.java，仅依赖 Security 框架） |
| ios/Jiangshui/School/SchoolWebViewHost.swift | 396 | 第二个 WKWebView 容器（UIViewController），导航默认拒绝，界面入口带主线程兜底 |
| ios/Jiangshui/School/SchoolProvider.swift | 111 | SchoolProviding：openSchool / openWebApp 真打开；抓取接口明确报错 |

P1 未做（P2 必做）：CAS 登录链、cookie 保存与恢复、JSXSd 页面注入读取、课表解析与合并、 假条同步（leaveRecordSync 表单 278616）、总超时/取消、后台线程读取、失败文案全表、logout 清理。

## 1. P1 行为（可执行基线，P2 不要改坏）

- SchoolProvider.openSchool(mobile:)：mobile=true 打开 http://jiaowuh5.juwp.edu.cn/，否则打开
  http://portal.juwp.edu.cn；返回 {"ok": true}。
  **偏离**：IOS-PORT-CONTRACT.md action 表把 mobile=false 记为“进入抓取流程”，本轮按 Lead 指示一律打开页面；
  P2 必须把 mobile=false 改成 beginSchoolRead 等价流程（见 §4.1）。
- SchoolProvider.openWebApp(url:warmupUrl:)：先 allowedOpenUrl(url)，再 allowedWarmupUrl(warmupUrl)，
  失败分别抛 BridgeFailure.message("不允许的请假地址") / ("不允许的登录地址")；学校容器可见时抛
  ("正在读取课表，请稍后再打开请假服务")；成功返回 {"ok": true}。
- leaveRecordSync / capture：**P1 基线**抛 BridgeFailure.message("iOS 端教务读取将在下一阶段提供")；cancelRead 返回
  {"ok": true}。桥接层负责把 BridgeFailure 转成 {ok:false} / error（A 的壳）。
  → **P2（2026-10-29）已替换**：leaveRecordSync 走 `School/LeaveRecordsService.swift`，capture 走
  `School/SchoolReadController.swift`；本文档其余章节保留为 P2 的蓝图与行号对照，不再代表当前实现。
- 所有 URL 判断 fail-closed：无法解析、带 userInfo、非 https、端口不在白名单、含控制字符/反斜杠、
  长度超过 2048（UTF-16）→ 拒绝。P2 新增入口（prepare/start 之类）也必须先过这同一套策略。
- SchoolURLPolicy.selfCheck() -> [String]：约 60 条纯逻辑断言（不依赖 XCTest）。本机无 swiftc 未能执行，
  P2 在 Mac 上可直接放进临时 XCTest 或 @main 脚本运行，期望返回空数组。

## 2. Android → iOS API 对照（P2 直接照这个换）

| Android | iOS 16 对应 | 备注 |
| --- | --- | --- |
| WebView + WebViewClient | WKWebView + WKNavigationDelegate | P1 已有容器 |
| shouldOverrideUrlLoading | webView(_:decidePolicyFor:decisionHandler:) | 已实现默认拒绝 |
| onPageFinished | webView(_:didFinish:) | 注意 P2 要像 Android 一样只在 url == webView.url 时推进状态机 |
| onReceivedHttpError | 无直接回调；用 URLSession 抓取或 navigationResponse 分支 | 见 §3.4 |
| onReceivedError | webView(_:didFailProvisionalNavigation:withError:) / didFail | 已忽略 NSURLErrorCancelled |
| onReceivedSslError | **无公开等价 API** | iOS 不暴露证书错误回调，见 §3.5 |
| onRenderProcessGone | webViewWebContentProcessDidTerminate(_:) | 已实现提示 |
| CookieManager.getCookie(url) | WKWebsiteDataStore.default().httpCookieStore.getAllCookies 后按 domain/path 过滤 | 异步回调，主线程 |
| CookieManager.setCookie | httpCookieStore.setCookie(_:completionHandler:) | 无 flush；写完等 completionHandler |
| CookieManager.flush() | 无对应 API | WebKit 自行落盘，不能假设立即持久化 |
| evaluateJavascript(script, cb) | evaluateJavaScript(_:completionHandler:) | completion 可能在任意线程回调，处理需回主线程 |
| assets/*.js 注入 | WKUserScript（atDocumentEnd）或 evaluateJavaScript 直接注入 | web/school-reader.js、web/profile-reader.js 需被 A 打包进 bundle |
| SharedPreferences | UserDefaults.standard | leave.uid / leave.pageEnc.<formId> 键名保持一致 |
| AndroidKeyStore + AES-GCM | Keychain（P1 SchoolSession） | iOS 卸载重装可能残留，logout 必须显式 clear |
| HttpURLConnection | URLSession.dataTask / async/await | ATS 对 URLSession 同样生效 |
| org.json.JSONArray/JSONObject | JSONSerialization / Codable | 字段名逐字一致，见 §5 |
| SimpleDateFormat("GMT+8") | DateFormatter + TimeZone(secondsFromGMT: 28800) | 假条提交时间格式见 §5 |

## 3. Android 行号分段对照

### 3.1 常量与 URL 策略（P1 已移植）

**62-67 常量**：HOSTS 五个域名、XGXT_ORIGIN、LEAVE_SSO、LEAVE_PREFS=“leave-session”、 LEAVE_FORM_ID=“278616”、LEAVE_LIST_URL。→ iOS：SchoolURLPolicy 同名常量已逐字对齐（含 leaveFormID、 leaveListURL）。风险：无。真机验证：无（纯常量）。

**69-108 URL 策略**：allowedOpenUrl 要求 https + host 精确 xgxt.juwp.edu.cn + 无 userInfo + 端口 -1/443 + path 以 “/” 开头 + 长度 ≤ 2048 + 无控制字符/反斜杠/换行；allowedWarmupUrl 只接受 null 或 LEAVE_SSO； allowedNav 对 https scheme + 五个白名单 host 组合放行，xgxt 仅 -1/443，eapp2.* 额外允许 9443； isXgxtUrl / isCasUrl / isOfficePath（仅含 “/office/” 的 xgxt 页面）。→ iOS： allowedOpenUrl / allowedWarmupUrl / allowedNav / allowedSchoolNav / isXgxtUrl / isCasUrl / isOfficePath 已实现，私有 ParsedURL 手写解析器保证 fail-closed。风险：Android Uri.parse 的边界行为（带方括号 IPv6、 畸形端口）与手写解析器可能有细微差异，selfCheck 已覆盖主要分支，P2 可补差分用例。真机验证：无（纯逻辑）。

**109-190 主 WebView / 桥 / 状态**：Android 主 WebView 加载 web/ 静态资源、注入 window.Android 桥、 处理主题/权限/日志，并在 190 行 unprotect 解密学校会话。→ iOS 属于 A（壳 + 桥）与 B（状态/日志）， 不在本线；P2 只需确认桥接层把 action 15-19/24-26 路由到 SchoolProvider / SchoolSession。 风险：P1 已把教务 action 接到桩；P2 换成真实现时返回值形状不变（{ok:true} / {ok:false,code}）。

### 3.2 学校 HTTP 直连（P2 新增）

**191-196 schoolRequest(endpoint, query, token)**：endpoint 白名单（/teachingWeek、/Get_sjkbms、 /student/curriculum）；POST http://jiaowuh5.juwp.edu.cn/njwhd + endpoint + query，请求头 token； 20s connect / 20s read；非 200 抛“学校读取失败，请重新确认登录”；data.data 非 JSONArray 抛 “学校会话失效或响应结构变化，请重新登录”。→ iOS：URLSession + ATS 例外（见 §3.6）；超时用 URLSessionConfiguration.timeoutIntervalForRequest = 20。风险：是否需要 UA/Cookie 未知，Android 只带 token； 真机验证：移动教务接口在 WebView 之外能否直接 POST（可能有设备指纹/冻结头）。

**208-213 httpGet(pathQuery, cookie)**：GET http://jiaowu.juwp.edu.cn:8080/jsxsd + pathQuery，Cookie 头， 20s，读上限 4,000,000 字节。→ iOS：URLSession + 从 WKHTTPCookieStore 取到的 Cookie 手工拼头。 风险：WKHTTPCookieStore 与 URLSession 的 HTTPCookieStorage 不共享，必须手工传 Cookie；Cookie 过期/域匹配 需真机验证。真机验证：登录后取 bzb_jsxsd 与 TGC，确认 URLSession 能拿到同一份会话。

### 3.3 学校容器（215-227）

Android：ensureSchool 懒建 SchoolClient、学校 WebView 作为覆盖层 addView；beginSchoolRead 做并发保护、 取 studentProfile、启动读取；showSchool 叠提示条 + 取消按钮；hideSchool 移除视图、alpha 0、schoolVisible=false； openSchool 先 hideWebApp 再打开门户或移动教务。→ iOS：P1 SchoolWebViewHost 已提供 show/hide/isVisible/ goback/reload + 顶栏（返回课表/标题/刷新）；P2 需要：
1. beginSchoolRead(id) 等价物：主线程串行状态机（禁止并发读取）；
2. 读取过程中顶栏显示“请在学校页面完成登录，完成后会自动读取课表”和“取消读取并返回课表”按钮；
3. hideSchool 时停止 90s 总超时、停止轮询、清空待注入脚本。 风险：iOS present 是模态，Android 是覆盖层叠 view；返回手势/弹窗与模态冲突需真机调试。 真机验证：present 期间来电话/切后台、横竖屏、返回手势、两次快速点 openSchool 不重复 present。

### 3.4 请假 WebView 容器（228-304）

Android 配置：JS/DOM 开启、禁文件访问、MIXED_CONTENT_NEVER_ALLOW、wideViewport、禁多窗口、 LOAD_DEFAULT、geolocation；拦截下载并提示；onShowFileChooser 处理文件选择（MODE_OPEN / 多选，accept types 转 MIME，失败 fallback）；geolocation 只对 allowedGeoOrigin（https + xgxt 域名 + 443 + 无 userInfo） 且系统已授予定位权限时放行。WebViewClient 回调：allowedNav 放行，否则 mainFrame 的 http(s) 且有用户手势时 交给外部浏览器并提示“已拦截自动跳转到校外页面”；onPageFinished 先 rememberLeaveSession 再 webAppPageFinished；SSL 错误 cancel + “学校安全连接验证失败，请检查系统时间或网络”；主框架错误 “学校页面暂时无法连接，请检查网络后点刷新”；HTTP 错误 “学校页面返回 HTTP <code>，请稍后重试”； 渲染进程回收时 destroyWebApp + “请假页面已关闭，请重新打开”。顶栏：返回课表 / 请假服务（实验）/ 刷新 + note。

→ iOS：P2 建议拆独立 LeaveWebViewHost（Android 是第三个 WebView，P1 为省事复用了 SchoolWebViewHost 的 leaveApp 模式）。需要：文件选择用 WKWebView 原生 input[type=file] 支持或 WKUIDelegate 的 open panel （iOS 端可用性需真机确认，**不要直接照搬 macOS 的 runOpenPanel 签名**）；下载用 WKDownload（iOS 14.5+， 需真机确认学校页面是否有下载）；定位能力 iOS WKWebView 无公开 geolocation 回调，**属于未验证项**： P2 先真机确认 navigator.geolocation 是否需要 shim，禁止用私有 API。 风险：iOS 无 MIXED_CONTENT_NEVER_ALLOW 公开设置；ATS 已限制页面本身走 https，页面内混合内容需真机确认。 真机验证：文件选择、下载、定位、alert/confirm（P1 已用 UIAlertController 处理）、外部跳转拦截文案。

### 3.5 请假状态机（305-404）

Android：showWebApp / hideWebApp / destroyWebApp；hasXgxtSession 从 CookieManager.getCookie(XGXT_ORIGIN) 里分段找 “UID”；30 秒未完成加载提示“加载较慢，可刷新或返回”。webAppPageFinished 状态机： 1) CAS URL → 提示“请在学校页面完成统一身份认证登录（本应用不保存密码）”； 2) 非 xgxt 页面 → 不推进； 3) warmupPending 时若 hasXgxtSession 则加载 target，否则提示“登录未完成，请在学校页面完成登录”，
   450ms 后复检； 4) target 未请求且 hasXgxtSession → 加载 target； 5) isOfficePath → 提示“请在学校页面完成请假、销假或续假操作”，并用 evaluateJavascript 检查页面
   innerText 是否含“请重新登录”，命中且未重试过则重走 warmup； 6) UID 失效兜底：非 office 且未 retarget 过 → 重载 target 一次；否则仍提示步骤 5 文案。 openWebApp(url, warmupUrl)：校验失败文案见 §1；activeReadId != null 或 schoolVisible → 并发提示； 重置 6 个状态位；无 xgxt 会话且有 warmup → 先 load warmup（warmupPending），否则直接 load target。

→ iOS：P2 用 WKHTTPCookieStore 异步取全量 cookie，判断 domain 含 juwp.edu.cn 且 name 为 UID（区分大小写？ Android 用 contains(“UID”)，P2 保持宽松匹配）；warmup 的 SSO URL 是 SchoolURLPolicy.leaveSSO； 状态位用主线程串行队列；450ms 复检用 asyncAfter；office 判定用 isOfficePath；innerText 检查用 evaluateJavaScript 取 document.body.innerText（返回 String）。 风险：WKWebView 的 cookie 写入/读取与页面加载时序存在竞争（Android 也有），复检次数要限制； CAS 页面 URL 判定 Android 未必有明确规则（需 P2 对照 SchoolCode 补），当前只知道 contains “cas/login”之类。 真机验证：SSO 预热 → 登录 → 回到请假页 → 打开请假表单全链路；UID 过期后重登。

### 3.6 ATS / Cookie / SSL / Keychain（iOS 特有，必须处理）

**ATS（最高优先级，阻塞 P1 页面打开）**：Android 用 http://portal.juwp.edu.cn、 http://jiaowuh5.juwp.edu.cn/、http://jiaowu.juwp.edu.cn:8080/jsxsd/。iOS 默认 ATS 会直接拦截这些 http 页面。 Info.plist（由 A 维护，不在我的写作用域）需要 NSAppTransportSecurity → NSExceptionDomains，至少为 portal.juwp.edu.cn、jiaowu.juwp.edu.cn、jiaowuh5.juwp.edu.cn、eapp2.juwp.edu.cn、eapp2.nit.edu.cn 配置 NSExceptionAllowsInsecureHTTPLoads=true（对 eapp2 的 https 端口通常不需要，但域名级配置可统一放）。 NSAllowsArbitraryLoadsInWebContent 只覆盖 WKWebView，不覆盖 URLSession；P2 的 schoolRequest/httpGet 用 URLSession，因此必须给对应域名加 per-domain 例外，不能只靠 web-content 开关。 风险：App Store 审核对 ATS 例外要求说明理由（学校站点仅支持 http），需在审核备注写明；这只是 “学校教务页面”用途，不是全站放开。 真机验证：干净安装后第一次打开门户/移动教务/教务 jsxsd 均能加载；URLSession 直连亦不被 ATS 拦。

**WKWebView Cookie**：用 default() 的 WKWebsiteDataStore；读取 getAllCookies 异步；写入 setCookie 异步； 没有 flush()。WKHTTPCookieStore 与 URLSession 的 HTTPCookieStorage **不共享**，P2 用 URLSession 时 必须把 cookie 手工拼进 Cookie 头（或改用 WKWebView 内 fetch 读取，如 web/school-reader.js 的做法）。 风险：Cookie 的 Secure/HttpOnly 域属性用 HTTPCookie(properties:) 构造时，iOS 可能拒绝部分属性组合， 需要真机验证；设置的 cookie 可能在 WebKit 首次导航后才生效。

**SSL**：WKWebView 不暴露证书错误回调，无法等价移植 onReceivedSslError；学校证书异常只会表现为 加载失败（已提示“学校页面暂时无法连接，请检查网络后重试”）。wx 学校若使用自签名证书，iOS 没有 公开的绕过方式（只能域名级 ATS 配置，且 WKWebView 仍会校验证书链），**P2 需先真机确认证书链正常**； 不要尝试私有 API 或证书 pinning 绕过。 风险：eapp2.juwp.edu.cn:9443、jiaowu.juwp.edu.cn:81 的非标准端口 TLS 配置、证书链完整性需真机验证。

**Keychain**：P1 SchoolSession 使用 kSecClassGenericPassword + kSecAttrAccessibleAfterFirstUnlock， service=cn.local.tomorrow.school-session、account=school-session-v1；JSON 信封 {version,savedAt,tgc,academic} 字段与 Android 一致。风险：iOS 卸载重装后 Keychain 可能残留，logout 必须 clear；首次解锁前读取会失败 （kSecAttrAccessibleAfterFirstUnlock 只在设备首次解锁后可用），P2 读取失败按“无会话”处理而不是崩溃。 真机验证：重启设备后先冷启动读 cookie（应成功）；飞行模式；卸载重装后行为。

### 3.7 文件选择 / 定位 / 权限（405-483）

405-458：文件选择器与 geolocation 放行判断；460-463：定位权限检查；464-483：permissionStatus 结构 （sdk、notifications、exactAlarm、battery、autostart）。→ 这些大部分属于 B（权限/系统能力）与 A（桥）， 本线只关心：请假页的定位域名白名单（xgxt+443）已在 SchoolURLPolicy 概念中保留；iOS 无 exactAlarm / autostart / battery exemption 概念，B 的 permissionStatus 需返回平台差异字段（P1 已由 B 处理）。 风险：P1 未实现定位；若请假页面依赖定位，P2 需先真机确认 WKWebView 是否弹出系统定位授权。

### 3.8 会话保护与请假会话记忆（512-526）

512 protect(value)：AndroidKeyStore AES-GCM 生成 school-session 密钥，信封 {iv,data} 写 school.enc； 190 unprotect 反向解密。→ iOS：P1 SchoolSession（Keychain）替代，不再落地加密文件。 513-526 queryParameter + rememberLeaveSession(url)：只有 XGXT_ORIGIN + “/office/” 且 path 含 apply.html 才记录；Uri 必须 isXgxtUrl 且 path 含 apply.html；uid 匹配 [0-9]{1,30}；pageEnc 匹配 [A-Za-z0-9_-]{8,256}；formId 匹配 [0-9]{1,20}（参数名 formid 或 formId）；存 UserDefaults（Android 用 SharedPreferences，前缀 leave-session）键 leave.uid 与 leave.pageEnc.<formId>； 不保存 cookie / 账号 / 密码。 → iOS P2 必须逐字保持键名与正则，否则 fetchLeaveRecords 找不到 uid/pageEnc。 风险：页面可能用 formid 小写；UserDefaults 需在读取前 synchronize？不需要（现代 iOS 自动），但跨进程无。 真机验证：完成一次请假申请后杀掉 App 再打开，假条列表仍能同步（uid/pageEnc 已存）。

### 3.9 假条解析与同步（527-680）

527-601 解析：
- leaveFormFields：遍历 item.formData[].fields[]，取 {label, values[0].val}；
- leaveStatus：文本优先（驳回|退回|不通过|拒绝|不同意 → rejected；待|审批中|处理中|审核中 → pending；
  通过|批准|同意|已完成 → approved；否则 unknown；空文本且 statusId == "2" → approved，否则 unknown）；
- leaveIsoTime：yyyy-MM-dd 原样；yyyy-MM-dd HH:mm → 加 ":00+08:00"；带秒 → 加 "+08:00"；
- leaveSubmittedAt：优先表单“请假申请时间”/“申请时间”，否则 inserttime（毫秒）按 GMT+8 格式化为
  yyyy-MM-dd'T'HH:mm:ss'+08:00'；
- leaveTrimmedRecord 输出：id（id 或 autoId）、status、statusText、statusId、typeText（请假类型）、
  reason（请假原因）、startAt（请假开始时间）、endAt（请假结束时间）、submittedAt、approver
  （allAprvUserList）、number（请假编号）、durationDays（请假时长）。 → iOS：用 JSONSerialization 解析；字段名逐字一致；数组下标访问前判类型与数量（禁止强解包/强制下标）。 与 web/leave-status.mjs 的 schoolRecord 字段必须一致（statusText / statusId / typeText / reason / startAt / endAt / submittedAt / approver / number / durationDays），否则前端显示会回退。

602-651 fetchLeaveRecords：
- cookie = CookieManager.getCookie(XGXT_ORIGIN)，空 → {ok:false, code:"NEED_LOGIN"}；
- prefs 取 uid 与 pageEnc.<278616>，缺任一 → {ok:false, code:"NEED_SESSION"}；
- POST LEAVE_LIST_URL，body 固定顺序：
  formId=278616&uid=<enc>&formUserId=0&aprvAppId=278616&pageEnc=<enc>&cpage=1&pageSize=50&
  desensitization=&startTime=&endTime=
- 头：Content-Type: application/x-www-form-urlencoded; charset=UTF-8、X-Requested-With: XMLHttpRequest、Cookie；
- connect 8000ms / read 12000ms；
- 非 200 → {ok:false, code:"HTTP_"+状态码}；解析 root.data.formsUserList；
- 超时 → TIMEOUT；JSON 解析失败 → PARSE；IO/其他 → NETWORK；
- 成功 → {ok:true, fetchedAt: 毫秒, records: [...]}。 → iOS：URLSession + 手动 Cookie 头（从 WKHTTPCookieStore 取 UID）；表单 body 必须 application/x-www-form-urlencoded 且百分号编码与 Android 一致（uid/pageEnc 已由正则限定字符，基本可直接拼）；错误码必须逐字一致，前端 leave-status.mjs 依赖 NEED_LOGIN / NEED_SESSION / TIMEOUT / PARSE / NETWORK / HTTP_n。 风险：学校接口可能校验 UA/Referer/Origin；Android 只带这三个头，P2 先照搬，失败再真机抓包对比。 真机验证：有效会话下列表非空；过期会话 NEED_LOGIN；删 App 重装 NEED_SESSION（uid/pageEnc 丢失）。

652-680 假条同步：finishLeaveSync 去重；beginLeaveRecordSync 并发时失败“正在同步假条，请稍候”； 15 秒 watchdog → TIMEOUT；cancelLeaveSync。→ iOS：用一个 in-flight Task 做并发保护，Task.cancel 或 URLSession task cancel 实现取消；watchdog 用 DispatchWorkItem asyncAfter(15s) 并在成功/失败时取消。 风险：iOS 的 Task 取消只对支持取消的 URLSession 生效，注意 completion 竞态只结算一次。

### 3.10 桥路由 / 登出 / 返回（718-815）

718-758 Bridge：先 UserConsent.require（consentStatus/acceptConsent/declineConsent/setTheme 除外）。 case openSchool：mobile → openSchool(true) 并回 {ok:true}；否则 Android 走 beginSchoolRead(id)（长任务， 完成后回包）。case openWebApp：optString url + nullable warmupUrl，成功回 {ok:true}。case leaveRecordSync → beginLeaveRecordSync(id)。case cancelRead → {ok:true}。case capture / sync → beginSchoolRead(id)。 default → “不支持的操作”；catch → e.getMessage() 为空时“操作失败”。 → iOS：A 的桥接层已按此表路由；P2 要把 mobile=false、capture、sync 接到真实现并保持异步回包 id 对应。 风险：P1 的 openSchool 对 mobile=false 直接 {ok:true}（见 §1 偏离），web/app.mjs 对无 snapshot 的 openSchool+ok 显示“学校登录窗口已打开”，P2 修改后前端文案可能变化，需同步 web 侧（但 web 不允许改，需 确认是否接受既有文案）。

755 logout：清 consent / 提醒 / 调度 / cancelRead / cancelLeaveSync / destroyWebApp / LEAVE_PREFS / schoolClient / WebStorage / state.json / SessionVault / school.enc / KeyStore / removeAllCookies(flush)， 回 {ok:true}。→ iOS：A 的 logout 已清大部分；P2 补齐：SchoolSession.clear()、UserDefaults 删 leave.uid 与 所有 leave.pageEnc.*、cancelRead、关闭并释放 SchoolWebViewHost、WKWebsiteDataStore.default().httpCookieStore 删除全部 cookie（异步，删完再回包）、URLCache 清理（可选）。 风险：WKHTTPCookieStore 无批量删除 API，只能 getAllCookies 后逐个 delete；删除是异步的，logout 回包要等完成。

801-815 返回键：先 evaluateJavascript(window.__dsjOnBack)；webAppVisible 且 canGoBack 且 isOfficePath → webApp.goBack()；否则 hideWebApp；schoolVisible → activeReadId ? cancelRead() : showMain()；否则 moveTaskToBack。→ iOS：没有物理返回键；P1 顶栏的“返回课表”按 hide；P2 要处理 iOS 侧滑关闭模态 （isModalInPresentation / presentationController delegate）与“读取中禁止关闭”的语义。 风险：iOS 模态下拉关闭会绕过状态机，需在读取中设置 isModalInPresentation = true 并弹确认。

### 3.11 SchoolClient.java 全文（72 行，P2 主战场）

P2 要把 SchoolClient.java 逐个方法移植成 Swift 的 SchoolReadController（建议文件 ios/Jiangshui/School/SchoolReadController.swift，>400 行时拆 SchoolReadState.swift 与 SchoolReadScripts.swift，每文件 <400 行）。

| SchoolClient 方法 / 行为 | Android 做了什么 | iOS 需要什么 |
| --- | --- | --- |
| 常量 ROOT / FRAME / TABLE / SSO_ENTRY / CAS_COOKIE_URL / HOSTS | 教务根 http://jiaowu.juwp.edu.cn:8080，FRAME 教务首页，TABLE 课表页，SSO 入口，CAS cookie 写入地址，五个白名单域名 | SchoolURLPolicy 已有同名常量；P2 用 WKHTTPCookieStore.setCookie 写 TGC 与 bzb_jsxsd |
| jsxsd(url) | http + jiaowu 域名 + 8080 端口 + path 以 /jsxsd/ 开头 | 新增 SchoolURLPolicy.isJsxsdURL（P1 尚无，P2 补） |
| create() | WebView 配置；shouldOverrideUrlLoading 只放行 HOSTS + http(s) | P1 容器已有 allowedNavigation；P2 确认学校模式放行 http（P1 allowedSchoolNav 已按 Android HOSTS 放行 http） |
| onPageStarted | 复位 script/tableReady/generation++ | 对应 didStartProvisionalNavigation：清注入标记、generation += 1 |
| onPageFinished | 仅 url == view.getUrl() 时 persistSessionCookies + page(url) | didFinish 中同样做 URL 相等判断；persist 后推进状态机 |
| onReceivedError mainFrame | fail(“学校页面暂时无法连接（错误码 N），原课表已保留。可在设置页导出排查日志”) | didFailProvisionalNavigation / didFail；P1 已提示“学校页面暂时无法连接，请检查网络后重试”，P2 换成含错误码的文案 |
| onReceivedHttpError mainFrame 401 | 若 page 属于 academic-home/timetable/academic → sso(“expired-school-cookie”)；否则非后台 401 POST school-login → clearExpiredTgc + needLogin | WKWebView 无 HTTP 状态回调；P2 只有在用 URLSession 抓取时能拿到 401；WebView 内导航需靠 sso 重试/登录页检测兜底（分析见 §6） |
| onReceivedSslError | cancel + fail(“学校安全连接验证失败，原课表已保留。请检查系统日期或网络后重试”) | 无等价 API；见 §3.6，真机确认证书链 |
| onRenderProcessGone | fail(“学校页面进程已回收，保留上次课表”) + destroy | P1 已做 UI 提示；P2 还要复位读取状态并保留旧课表 |
| start(request, inBackground, cachedProfile) | 同意检查、并发检查、StateStore.acquire、progress、90s timeout、restoreCookies | 主线程状态机：busy 保护、总超时 90s、restore 后 continueStart |
| safeCookieValue | 非空、长度 ≤ 4096、匹配 [A-Za-z0-9._~+/%=-]+ | P1 SchoolSession.isSafeCookieValue 已实现（public static） |
| restoreCookies | SessionVault.load 取 tgc/academic；setCookie CAS_COOKIE_URL 上 TGC+Path=/cas/; Secure; HttpOnly，setCookie TABLE 上 bzb_jsxsd+Path=/jsxsd; HttpOnly；flush；continueStart | P1 SchoolSession.loadSession()；P2 用 WKHTTPCookieStore.setCookie 两个 cookie（HTTPCookie(properties:) 构造，注意 Secure/HttpOnly 支持情况需真机验证），写完再 continueStart |
| continueStart | TABLE cookie 有 bzb_jsxsd：无 profile 载 FRAME，否则载 TABLE；无 cookie → sso(“missing-academic-cookie”) | 读 cookie 判断 bzb_jsxsd；studentProfile 来自 StateStore 缓存（P1 iOS 侧 B 的 StateStoring） |
| persistSessionCookies | flush + SessionVault.save(tgc, academic) | WKHTTPCookieStore.getAllCookies 取 TGC 与 bzb_jsxsd，SchoolSession.saveSession(tgc:academic:) |
| clearExpiredTgc | setCookie TGC 空 + Max-Age=0；SessionVault.clearTgc | P2 用 httpCookieStore.delete(cookie) 或设置过期 cookie；再 SchoolSession.clearTGC()（P1 已实现） |
| timeout(ms) | 版本号防重入；超时 fail(“学校响应超时，保留上次课表”) | DispatchWorkItem + generation 校验；超时文案逐字一致 |
| sso(reason) | 只自动重试一次；重复 → fail(“学校会话自动恢复未成功，原课表已保留。请稍后重试；如统一身份认证已过期，系统会要求重新登录”)；否则 progress “正在使用已保存的学校登录状态恢复教务会话…” + load SSO_ENTRY | 状态机加 ssoAttempted 布尔；进度文案同上 |
| needLogin | 后台 → fail(“学校会话已失效，请打开江水课表重新登录”)；前台 → awaitingLogin=true + progress “请在学校页面完成登录” + listener.loginRequired(view) | iOS 无前后台区分时一律前台处理；进度文案同上；loginRequired 交给 SchoolWebViewHost 顶栏提示 |
| leaveLogin | progress 后 portalEntered | 用于从登录页离开后的状态复位 |
| page(url) | jsxsd/framework → leaveLogin + flush + （无 profile ? readProfile : 载 TABLE）；jsxsd/xskb → leaveLogin + read()；jsxsd/xk/LoginToXk → return；path 含 login → sso 或 fail；portal host → inspectPortal；eapp2 host → JS 检测密码框/userAccount/execution，命中 → clearExpiredTgc + needLogin | 逐条移植成 URL 路由函数；JS 检测用 evaluateJavaScript 返回字典/布尔 |
| inspectPortal(expected, attempt) | 等门户页；JS 取 a[href*=jiaowu.juwp.edu.cn] 与 login 标记；login → needLogin；href 为 jiaowu http(s) → stage=1 + leaveLogin + progress “正在连接教务系统…” + load href；最多 20 次 × 400ms，否则 fail(“门户页面未提供教务入口，保留原课表”) | 页面轮询用 evaluateJavaScript + asyncAfter 400ms，最多 20 次；文案逐字一致 |
| readProfile | 注入 assets/profile-reader.js；pollProfile 每 200ms 最多 90 次，取 window.__jiangshuiProfile；done 后载 TABLE | 把 web/profile-reader.js 当字符串注入（或 WKUserScript atDocumentEnd）；轮询 window.__jiangshuiProfile |
| read() | 仅 jsxsd 页面；先注入 window.__tomorrowRequestId + assets/school-reader.js；poll 每 200ms；结果 id 匹配且 done 后：login → sso；error 非空 → fail；rows 空或 weeks < 1 或 > 60 → fail(“学校课表不完整，保留上次课表”)；sem 校验 4位-4位-[12] 否则 “unknown”；组装 {rows, totalWeeks, semesterId, studentProfile?} 并 success | 注入 web/school-reader.js 内容并轮询；结果形状 {done, error, login, rows, weeks, sem} 需与读取脚本一致（见 web/school-reader.js） |
| fail(text) | evaluateJavascript(window.__tomorrowAbort.abort()) + stopLoading + failure(text) | 取消读取时先执行 window.__tomorrowAbort.abort()（若存在），再 stopLoading、结算回调 |
| cancel() | fail(“已取消读取，保留原课表”)（读取脚本依赖“已取消”前缀判断 cancelled） | 文案逐字一致；JS 侧 await 的 AbortController 已被 abort；P2 不要改前缀 |
| destroy() | 销毁 WebView | 释放 SchoolWebViewHost 中的 web 与注入脚本，取消所有定时器 |

四阶段状态机（P2 建议命名）： 1) restore：从 Keychain 取 TGC/教务 cookie → 写 WKHTTPCookieStore → 继续； 2) ssoRecover：无教务 cookie 或 401 过期 → 只重试一次 SSO； 3) portal：门户页找教务入口 → 载入 FRAME/TABLE； 4) read：注入读取脚本 → 轮询 → 组装结果或按文案失败。 请假线独立：openWebApp → SSO warmup → 目标 office 页 → rememberLeaveSession； leaveRecordSync 走 URLSession 直连，不经过 WebView。

## 4. P2 实现蓝图

### 4.1 入口与并发

- openSchool(mobile:true) 保持现行为。openSchool(mobile:false) / capture / sync 改为启动
  SchoolReadController.start(requestID:inBackground:)；该函数必须 async 并最终调用桥接层回包（id 对应）。
- 并发：busy 时立即失败“正在读取课表，请稍候”；与请假页互斥（activeRead 时 openWebApp 失败
  “正在读取课表，请稍后再打开请假服务”）。
- cancelRead：把 SchoolReadController.cancel() 接到桥；P1 的 cancelRead 直接回 {ok:true} 要替换。
- 建议把 SchoolWebViewHost 从“展示型”扩展成可被状态机驱动：暴露 load、evaluateJavaScript、
  didFinish 回调、cookie 读取便利方法；不要在 ViewController 里塞业务逻辑。

### 4.2 失败文案表（P2 必须逐字一致，前端/测试会比对）

- 不允许的请假地址 / 不允许的登录地址 / 正在读取课表，请稍后再打开请假服务
- 学校读取失败，请重新确认登录 / 学校会话失效或响应结构变化，请重新登录
- 学校页面暂时无法连接（错误码 N），原课表已保留。可在设置页导出排查日志
- 学校安全连接验证失败，原课表已保留。请检查系统日期或网络后重试
- 学校页面进程已回收，保留上次课表
- 学校页面暂时无法连接，请检查网络后点刷新 / 学校页面返回 HTTP <code>，请稍后重试
- 学校响应超时，保留上次课表
- 学校会话自动恢复未成功，原课表已保留。请稍后重试；如统一身份认证已过期，系统会要求重新登录
- 学校会话已失效，请打开江水课表重新登录
- 学校课表不完整，保留上次课表
- 已取消读取，保留原课表（前缀“已取消”）
- 门户页面未提供教务入口，保留原课表
- 学校页面暂时无法打开，请稍后重试（P1 新增：没有可 present 的窗口时）
- ~~不允许的教务读取（P1 桩：iOS 端教务读取将在下一阶段提供）~~ —— P2 已移除该失败路径

### 4.3 Cookie 读写建议

- 读：webView.configuration.websiteDataStore.httpCookieStore.getAllCookies(completionHandler:)，
  在主线程过滤 domain 后缀 juwp.edu.cn；TGC 取 name == “TGC”，教务取 name == “bzb_jsxsd”，
  UID 取 name 含 “UID”（与 Android hasXgxtSession 一致）。
- 写：HTTPCookie(properties: [.domain/.path/.name/.value/.secure/.expires]) 构造后 setCookie；
  注意 iOS 可能不允许给未访问过的域写 cookie，真机验证；写入回调后再继续状态机。
- 持久化：不要自己再写文件；WKWebsiteDataStore default 会落盘，但卸载重装会丢，所以 TGC/教务
  cookie 另存 Keychain（P1 SchoolSession）。

### 4.4 JS 注入建议

- web/school-reader.js、web/profile-reader.js 需要 A 把 web/ 打进 bundle（P1 壳的静态服务器方案也可
  用 loopback 取，但那要求页面同源 http://127.0.0.1:47851，学校页面是别的域，跨域取脚本会失败）。
  推荐：Build Phase 把脚本复制进 Resources，Swift 读成 String 后 evaluateJavaScript 注入（Android 是 assets）。
- 注入时机：didFinish 且 URL 匹配后才注入（与 Android 一致）；先设 window.__tomorrowRequestId，
  再执行脚本；轮询用 asyncAfter 200ms，最多 90 次（18s），与 90s 总超时区分。
- evaluateJavaScript completion 可能返回 String/NSNumber/NSDictionary；统一用 JSONSerialization
  转 JSONObject 再取字段，禁止强制转换。

### 4.5 超时与取消

- 总超时 90s（SchoolClient.java:timeout），到点 fail“学校响应超时，保留上次课表”，并停 WebView。
- 页面轮询 200ms × 90（18s）；门户轮询 400ms × 20（8s）；请假慢加载提示 30s；假条同步 watchdog 15s。
- 取消：cancel() → JS abort（若已注入）→ stopLoading → 回调 {ok:false,code:"CANCELLED"}？
  Android 实际上把“已取消读取，保留原课表”当成 failure 文本，JS 侧靠前缀判断；P2 必须与 Android
  完全一致，不要新增 code 字段（前端 leave/school 流程依赖文案）。
- 所有 DispatchWorkItem 在 deinit / destroy 时 cancel。

### 4.6 leaveRecordSync（表单 278616）

P2 实现步骤：
1. 从 WKHTTPCookieStore 取 xgxt 域 cookie，拼 Cookie 头；空 → {ok:false, code:"NEED_LOGIN"}。
2. UserDefaults 读 leave.uid 与 leave.pageEnc.278616；缺 → {ok:false, code:"NEED_SESSION"}。
3. 组 body（顺序固定）：formId=278616&uid=...&formUserId=0&aprvAppId=278616&pageEnc=...&cpage=1&pageSize=50&desensitization=&startTime=&endTime=
4. POST https://xgxt.juwp.edu.cn/office/data/approve/apps/forms/fore/user/list，头三个；
   URLSessionConfiguration.timeoutIntervalForRequest = 12（Android 读超时 12s），连接超时用 request timeout 近似。
5. 解析 root.data.formsUserList；逐条映射 leaveTrimmedRecord（字段见 §3.9），status 规则照抄；
   失败码 TIMEOUT / PARSE / NETWORK / HTTP_n 逐字一致。
6. 返回 {ok:true, fetchedAt: Int64(Date().timeIntervalSince1970*1000), records: [...]}；
   前端 leave-status.mjs 会把 fetchedAt 毫秒转 ISO。
7. 并发保护 + 15s watchdog；取消走 cancelLeaveSync（action 由桥接层路由）。

### 4.7 iOS 独有文案（Android 无对应）

以下文案只存在于 iOS 实现，Android（MainActivity.java / SchoolClient.java）没有逐字对应的用户文案；
登记在此避免 P2 误以为需要对齐 Android。桥接层仍以 BridgeFailure.message 返回，前端按 {ok:false} 展示，
P2 **不要改字**（前端/测试会比对）。

| 文案 | 产生位置 | 触发条件 | 说明 |
| --- | --- | --- | --- |
| 学校页面暂时无法打开，请稍后重试 | SchoolProvider.openSchool / openWebApp | 没有可 present 的顶层控制器（topPresenter() 返回 nil） | §4.2 已重复登记；Android 无对应 |
| 学校会话保存失败 | SchoolSession.save / saveSession | 空数据、超过 100000 字节、Keychain 写入失败 | iOS 新增，Android 无对应 |
| 学校会话读取失败 | SchoolSession.load | Keychain 读取失败或返回类型异常 | iOS 新增，Android 无对应 |
| 学校会话清除失败 | SchoolSession.clear | Keychain 删除返回非 errSecSuccess / errSecItemNotFound | iOS 新增，Android 无对应 |

SchoolWebViewHost 顶栏/提示条里的文案（如“已拦截校外页面跳转”；P2 起学校模式只保留“请在学校页面完成登录”，原“……将在下一阶段提供”已删除）
属于 iOS 本地 UI 提示，不进入桥接错误表，P2 可按界面需要微调，但不要与上表四条混淆。

## 5. 真机验证清单（P2 在 Mac + 真机上按序执行）

基础环境：
1. 干净安装（非覆盖升级），首次启动无崩溃；Keychain 里没有旧会话时 openSchool 直接打开门户。
2. Info.plist 的 ATS 例外生效：门户/移动教务/教务 jsxsd 三个 http 页面都能加载（页面不能白屏）。
3. 真机时间正确（学校 SSL 对时间敏感），系统语言中文。

CAS / 教务登录链：
4. 门户页 openSchool(mobile:false) → 打开 portal.juwp.edu.cn；点击“教务系统”等入口能跳进
   jiaowu.juwp.edu.cn:81/sso.jsp → CAS 登录页（eapp2.juwp.edu.cn:9443）→ 输入账号密码 → 回教务首页。
5. 关闭再打开 App，beginSchoolRead 走 restoreCookies：不需要再次输密码即可读到课表（TGC 有效期内）。
6. TGC 过期后：自动 SSO 恢复只重试一次；第二次失败出现“学校会话自动恢复未成功…”文案，不无限循环。
7. 未登录直接 capture：得到“学校会话已失效，请打开江水课表重新登录”或登录提示，不崩溃。

课表读取：
8. FRAME 页 → 注入 profile-reader 取年级 → 载 TABLE 课表页 → 注入 school-reader 读取成功，
   rows/weeks/sem 组装正确，前端显示与 Android 一致；跨学期切换正常。
9. 弱网/断网：超时文案、错误码文案出现；取消按钮/返回后停止加载，再次读取不被旧 generation 干扰。
10. 后台转入前台、锁屏再解锁、WKWebView 进程回收后重新读取均正常。

请假 / 假条：
11. 打开请假服务（openWebApp）→ 必须已完成 xgxt 登录才进入请假页；未登录时先 SSO warmup。
12. 完成一次请假申请，URL 带 apply.html 与 uid/pageEnc，rememberLeaveSession 成功写入；
    杀掉 App 重开，假条列表同步成功（若无数据也应是空列表而不是错误）。
13. 表单 ID 278616 的接口请求体与 Android 抓包逐字节一致（字段顺序、空参数都保留）。
14. 无效 pageEnc / 过期会话：NEED_SESSION / NEED_LOGIN 文案；HTTP 500 时 code=HTTP_500。
15. 假条状态映射正确（待审批/已通过/已驳回，statusId==2 兜底通过）；时间显示 +08:00 正确。

退出与清理：
16. logout 后：cookie 被清空、Keychain 学校会话被清、UserDefaults 的 leave.* 被清、学校容器关闭，
    再 capture 要求重新登录。
17. 卸载重装后 Keychain 残留处理：logout 逻辑能清掉；若首次读取到残留但已失效，按未登录处理不崩溃。

边界与表现：
18. 打开学校页后旋转、切后台、来电、下拉关闭模态：读取中不允许静默关闭（isModalInPresentation）。
19. 连续点两次 openSchool / capture：第二次立即“正在读取课表，请稍候”，不并发两个状态机。
20. 学校页面里点外链、window.open、下载、alert/confirm：默认拦截 + 中文提示，不崩溃。

## 6. 风险与未决问题（需 Lead / A / B 决策）

1. **ATS（阻塞级，A 负责 Info.plist）**：必须给 portal.juwp.edu.cn、jiaowu.juwp.edu.cn、
   jiaowuh5.juwp.edu.cn、eapp2.juwp.edu.cn、eapp2.nit.edu.cn 加 NSExceptionAllowsInsecureHTTPLoads。
   **已处理（2026-10-27）**：A 已按上述 5 域名在 Info.plist 配置例外（未使用 NSAllowsArbitraryLoads），
   127.0.0.1/localhost 例外保留；P2 真机仍需逐页确认三个 http 页面可加载。审核备注需写明
   “学校教务系统仅支持 http，用户需登录本校系统”。
2. **WKWebView 无 SSL 错误回调**：Android 的 onReceivedSslError 文案无法等价；若学校证书链有问题，
   只能在真机上看到加载失败。若真机确认证书异常，需要产品决策（提示用户/放弃该端口），不能绕 SSL。
3. **WKWebView 无 HTTP 状态错误回调**：Android onReceivedHttpError 的 401 分支（重试 SSO / 清 TGC）
   在 iOS 纯 WebView 形态下拿不到状态码。建议 P2 用 URLSession 复核会话（先 httpGet FRAME 判定 401），
   或在 SSO 恢复后再读一次 cookie；这是行为差异，需要 Lead 认可。
4. **定位 / 文件选择 / 下载**：P1 未实现；WKWebView 对 geolocation 没有公开回调，input[type=file] 与
   WKDownload 的可用性需真机确认。若请假页依赖定位，P2 可能需要 JS shim（不许私有 API）。
5. **请假容器复用**：P1 openWebApp 复用 SchoolWebViewHost 的 leaveApp 模式；Android 是独立第三个
   WebView。P2 建议拆 LeaveWebViewHost，否则学校读取与请假状态互相污染。
6. **openSchool 偏离**：mobile=false 目前只打开页面并回 {ok:true}，与 contract action 表不一致；
   P2 改成 beginSchoolRead 后，web/app.mjs 的“学校登录窗口已打开”分支会变化，需要同步评估（web 不可改，
   但可确认文案是否仍是可接受行为）。
7. **SchoolSession 文案（已定）**：新增“学校会话保存失败/读取失败/清除失败”三条，Lead 已接受并
   登记于 §4.7；P2 不要改字。
8. **cookie 写入属性**：HTTPCookie(properties:) 对 Secure/HttpOnly 的支持、跨域写 cookie 的时机，
   需真机验证；若 setCookie 失败，需回退到“让 WebView 自己产生 cookie，再读出来存 Keychain”的方案。
9. **Keychain 卸载重装残留**：与 Android 语义不同，P2 需在首次读取时校验 cookie 有效性并与 logout 清理。
10. **未验证项**：本机无 Xcode/swiftc，P1 四个 Swift 文件均未编译；所有“编译通过”的假设都要在 Mac 上
    先跑一次 xcodebuild 才能确认。selfCheck() 也未执行。

## 7. P2 验收标准（DoD）

- Mac 上 xcodebuild 编译通过（iOS 16 模拟器 + 至少一台真机）。
- node ios/tools/check-ios.mjs 0 fail；node ios/tests/bridge-contract.test.mjs 全过。
- 真机 CAS 登录 → 读取课表成功，跨 App 重启会话恢复成功，失败路径文案与 Android 逐字一致。
- 请假服务：SSO warmup、请假页打开、rememberLeaveSession、leaveRecordSync 表单 278616 全链路通过。
- logout 后所有学校会话（WebKit cookie / Keychain / UserDefaults leave.*）清空。
- 无 ! 强解包；无新增第三方依赖；每个 Swift 文件 < 400 行；URL 策略 fail-closed 保持不变。
- 本文档 §5 清单逐条打勾（真机截图/日志留档）。

## 8. 给 P2 实现者的交接清单（按实施顺序）

每条都给出「静态可验」与「必须真机验」两种验收方式；静态可验未过不要上真机，真机未过不要合并。

1. **编译基线**：先确认 ios/Jiangshui/Services/NativeServices.swift、LogoutHandling 等跨文件依赖已补齐，
   且新增 .swift 已被 ios/tools/gen-pbxproj.mjs 重新生成进 pbxproj（否则不进 Sources）。
   静态可验：在 Mac 上 xcodebuild build（iOS 16 模拟器）0 error，check-ios.mjs 0 fail。
   真机验：安装启动不崩，openSchool(mobile:true) 能打开 jiaowuh5，mobile:false 能打开 portal。
2. **URL 策略自检**：静态可验：把 SchoolURLPolicy.selfCheck() 放进临时 XCTest / @main，期望返回 []；
   同时覆盖 P2 新增入口（prepare/start 等）先过 SchoolURLPolicy 的断言。真机验：无（纯逻辑）。
3. **会话恢复**：SchoolSession.loadSession() → WKHTTPCookieStore 写 TGC 与 bzb_jsxsd → continueStart。
   静态可验：review cookie 的 domain/path/Secure/HttpOnly 属性与 safeCookieValue 调用点。
   真机验：登录一次后杀掉 App 重开，capture 不再要求登录即可读课表；重启设备首次解锁后冷启动读取正常。
4. **CAS 登录链 + SSO 单次重试**：静态可验：状态机含 ssoAttempted 标志，缺 cookie/401 只触发一次 SSO；
   重试失败文案逐字为“学校会话自动恢复未成功，原课表已保留。请稍后重试；如统一身份认证已过期，系统会要求重新登录”。
   真机验：门户 → 教务入口 → CAS（eapp2:9443）→ 输入账号 → 回教务首页；手动让 TGC 过期后只自动重试一次。
5. **JSXSd 注入读取**：静态可验：web/school-reader.js、web/profile-reader.js 已随 App 打包（或同源可取）；
   200ms × 90 轮询、结果 id 匹配、rows/weeks 校验（weeks 1..60）、sem 不合法置 unknown。
   真机验：FRAME → profile-reader 取年级 → TABLE → school-reader 的 rows/weeks/sem 与 Android 逐项对照；
   WKWebView 进程回收后重读不串 generation。
6. **leaveRecordSync（表单 278616）**：静态可验：body 顺序固定、三个请求头、连接 8s / 读 12s、
   错误码 NEED_LOGIN / NEED_SESSION / TIMEOUT / PARSE / NETWORK / HTTP_n 逐字一致、并发保护 + 15s watchdog。
   真机验：有效会话列表非空；抓包与 Android 逐字节对拍；过期会话/缺 pageEnc 分别得到 NEED_LOGIN/NEED_SESSION。
7. **假条解析与 rememberLeaveSession**：静态可验：leaveTrimmedRecord 字段名逐字、状态映射规则、
   GMT+8 时间格式、uid/pageEnc 正则与 UserDefaults 键名 leave.uid / leave.pageEnc.<formId> 对齐。
   真机验：提交一次请假后杀掉 App 重开仍能同步假条；审批状态变化后前端显示正确。
8. **logout 清理**：静态可验：SchoolSession.clear()、删 UserDefaults 的 leave.*、WKHTTPCookieStore 全删
   （异步完成后再回包）、关闭并释放 SchoolWebViewHost、cancelRead。真机验：logout 后 capture 要求重新登录；
   卸载重装后残留 Keychain 按“无会话”处理；重开 App 无 cookie 串用。
