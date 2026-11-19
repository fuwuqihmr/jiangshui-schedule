# P2 · 教务 SSO 故障诊断（task-17）

> 时间：2026-10-30　设备：iPhone 15 Pro Max（侧载未签名 IPA，commit 6ba5229）
> 症状：点「检查更新」后打开的是**教务系统自带登录页**，随后 toast「未能确认最新课表 / 学校页面脚本执行失败，请稍后重试」；主界面已有一份真实课表。
> 本机 Windows 无 Xcode，**以下结论区分「实测证据」与「静态推断」**，未真机复现的不写成定论。

## 1. 先定位 toast 的唯一出处

- 全仓库只有 `ios/Jiangshui/School/SchoolReadController.swift:411` 产生「学校页面脚本执行失败，请稍后重试」。
- 路径：`academicPage` → 课表页 `/jsxsd/xskb/` → `read()`（:363-396）→ `host.evaluate(script: prefix + source)` 的 completion 收到 `error` → :411 fail。
- 因此 toast 与「教务登录页」不是同一个错误：页面先停在教务登录 HTML，脚本注入又报了 completion error。

## 2. 实测证据（2026-10-30 07:05–07:17 GMT+8，本机 curl）

1. `https://jiaowu.juwp.edu.cn:81/sso.jsp`：HTTP 200，证书 `*.juwp.edu.cn` 有效（TLS 1.3），响应体只有 151 字节：
   `<script languge='javascript'>window.location.href='https://eapp2.juwp.edu.cn:9443/cas/login?service=http%3A%2F%2Fjiaowu.juwp.edu.cn%2Fsso.jsp'</script>`
   即 SSO 入口本身不是登录页，而是跳 CAS 的 JS；ATS/TLS 不是本次「打开教务登录」的原因。
2. `http://jiaowu.juwp.edu.cn:8080/jsxsd/framework/xsMainV.htmlx` 无 cookie / 带无效 cookie：均 HTTP 200，约 80,682 字节，`<title>登录`，正文含 `LoginToXk`、`userAccount`、`password`。**服务端不 302，而是在 FRAME 原 URL 直接返回登录 HTML。**
3. `http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?viweType=1` 无 cookie / 带无效 cookie：同样 HTTP 200、约 80,680 字节、标题「登录」。**所以 `page(rawURL)` 会把登录 HTML 当成课表页，随后调用 `read()`。**
4. `http://jiaowu.juwp.edu.cn/sso.jsp`（无 :81，CAS 回跳用的 service）也是同一段 151 字节 JS 跳转；证书与 :81 同域有效。

结论：只要本地还留着一个「值非空但服务端已失效」的 `bzb_jsxsd`，`restoreCookies` 就会走 `beginPageLoad`，直接载 FRAME/TABLE，**根本不会执行 `sso()`**；服务端返回登录 HTML 后，页面停在教务登录页。

## 3. 候选根因 A：异步 IIFE 的返回值让 `evaluateJavaScript` 报错（高置信，待真机日志）

- `web/school-reader.js` 是 `(async () => { ... })();`（:2 开始，:57 结尾）；`web/profile-reader.js` 同样是 `(async()=>{...})();`（:2、:43）。`SchoolReadController.read()` 注入的是 `prefix + source`，最后一条表达式的值是 **Promise**。
- WKWebView 的 `evaluateJavaScript(_:completionHandler:)` 会把返回值序列化给 completion；Promise 不是可序列化类型，WebKit 走 error 回调（常见 `WKErrorDomain` / "JavaScript execution returned a result of an unsupported type"）。JS 本身仍在跑，但 iOS 把「返回值不可序列化」当成注入失败。
- Android 的 `evaluateJavascript(script, callback)` 不要求返回值可序列化，所以同一脚本在 Android 正常 → 这是 iOS 专有失败。
- 与 toast 完全吻合：`read()` 的 completion 在 :381-393 拿到 error → :411 fail。`readProfile()`（:325-341）也注入异步 IIFE，当前改为记录 error 后继续载 TABLE，所以只有课表读取这一处弹「脚本执行失败」。
- **证据等级**：脚本末尾是 Promise 已由源码确认；「Promise 必触发 WKError」基于 WebKit 行为，本机无 Xcode/WebKit 无法本地复现，必须看下一次真机的 `reader-inject-failed` 日志（domain/code）确认。

## 4. 候选根因 B：陈旧 cookie + 登录页分支静默（已由代码与服务端响应确认）

- `academicCookie(in:)`（:224-232）原先只检查 name/domain/值非空，**不检查 `expiresDate`**；`makeCookie`（:211-222）给 `bzb_jsxsd` 写 7 天过期。于是 Keychain 里 7 天内的旧教务 cookie 会被当成有效，直接跳过 `sso()`。本轮已在 :227 过滤过期 cookie。
- 即使 cookie 未到期，服务端会话也可能已死；第 2 节实测表明此时 FRAME/TABLE 都返回 200 登录 HTML，而不是 302。
- `page` 的 `/jsxsd/xk/LoginToXk` 分支原为直接 `return`，既不 `sso` 也不 `needLogin`，命中登录页时完全没有动作（直到 90s 超时）；本轮改为 :304-312 的分支（手动登录中仍交给表单，否则 SSO/失败）。
- 加重项（静态）：`academicPage` 原先在 FRAME 分支先 `persistSessionCookies()`（旧 :235），登录 HTML 也会被写回 Keychain，使失效 cookie 在下次启动继续被复用；本轮改为 `inspectAcademicLogin` 确认不是登录页后才 persist（:280-294）。
- **证据等级**：服务端返回登录 HTML 已实测；设备端 cookie 是否过期/Keychain 内容需下一次真机 `session-cookie-restore` / `session-cookie-state` 日志确认。

## 5. 其他已排除/待确认项

- `:81` 的 HTTPS：本机 curl 无 `-k` 也 200，证书链有效、TLS 1.3；ATS 只放宽 http，不放宽证书错误，本案没有证据表明走了证书失败。真机若仍失败，看 `navigationFailed` 的错误码（-1200 等）。
- CAS 页 `https://eapp2.juwp.edu.cn:9443/cas/login?...`：HTTP 200、有 JSESSIONID、X-Frame-Options DENY；说明 SSO 链路的下一跳本身可达。
- 用户主界面已有真实课表：说明至少一次成功，Keychain 中应有 tgc/academic；也说明失败发生在「再次核对」而不是首次登录。
- `readProfile()` 的异步 IIFE 同样会报 completion error；修复前它被静默忽略、不产生 toast，本轮一并追加 `;0;` 并记录 `reader-inject-failed stage=unknown`，仍继续载 TABLE。

## 6. 本轮最小修复（已落地，行号回填）

1. **修 Promise 注入**：`read()` :381 / `readProfile()` :332 注入末尾追加 `;0;`，让最后表达式可序列化；completion error 不再直接 fail。
2. **可自愈**：首次注入 error → 记诊断 → 250ms 后重试一次（:383-390）；仍 error → 先用轻量脚本探查 `window.__tomorrowRead` 是否已有本轮结果（`recoverRead` :400-414），有则继续轮询，无才保留原文案 fail。
3. **不再停在教务登录页**：`inspectAcademicLogin`（:534-552）在 FRAME/TABLE 注入前先查 `input[type=password]` 等登录标志，命中即 `sso()`；`LoginToXk` 分支（:304-312）不再静默（非手动登录等待时走 SSO）；FRAME 登录页只有在确认不是登录页后才 `persistSessionCookies()`（:280-294），避免把失效 cookie 写回 Keychain。
4. **cookie 过期判断**：`academicCookie` 在 :227 过滤 `expiresDate <= now` 的 cookie；会话失效仍由登录页检测兜底。
5. **可诊断**：新增 `ios/Jiangshui/School/SchoolDiagnosticLog.swift`，把 `reader-inject-failed domain=… code=… message=…` 与导航失败写入 `applog.txt`；同时写一条 DiagnosticsService 现有白名单能识别的 `reader-error stage=unknown http-status=<code> kind=other`，保证导出里至少能看到错误码。
6. **SSO 入口不可达可区分**：`sso()`（:575-591）记录正在载入入口；入口/CAS 导航失败（:112-129）或超时（:621-634）用「统一身份认证入口暂时无法打开…（原课表已保留）」，其余失败保留原文案。

## 7. 下一次真机验证看什么（3-5 条）

1. 点「检查更新」，学校容器应直接出现 **统一身份认证（eapp2…/cas/login）**，不再出现「登录 / LoginToXk」的教务页；若仍出现，截图地址栏所在 URL。
2. 导出排查日志，搜 `reader-inject-failed`：确认是否仍有（若有，记录 domain/code/message；Promise 修复后应为 0 条）。
3. 搜 `reader-error`：应看到 `stage=unknown http-status=5 kind=other`（若 5 = WKErrorDomain unsupported type）或明确的登录页恢复记录；不能只有「脚本执行失败」。
4. 首次登录成功后杀 App 重开：应复用 Keychain/cookie 直接读课表；若又跳 CAS，说明 TGC/教务 cookie 未持久化，抓 `session-cookie-restore tgc=… academic=…`。
5. 弱网/断网：应出现「统一身份认证入口暂时无法打开…」或连接错误码，而不是教务登录页；取消/返回仍应保留旧课表。

## 8. 验证/未验证清单

| 项 | 状态 |
| --- | --- |
| 服务端 sso.jsp 跳 CAS、FRAME/TABLE 返回登录 HTML | **已实测**（本机 curl） |
| `academicCookie` 不看 expiresDate、LoginToXk 静默 | **已由源码确认** |
| 异步 IIFE 返回值导致 evaluate error（A） | **静态高置信，未真机验证** |
| A 修复落地（`;0;` + 重试/探查） | **代码已落地，静态确认；未编译/未真机** |
| 设备端 Keychain/cookie 是否过期（B） | **未验证**，靠下一次真机日志 |
| B 修复落地（过期过滤 + 登录页检测 + LoginToXk） | **代码已落地；服务端登录 HTML 已实测，设备端仍未验证** |
| C 诊断落盘（domain/code/message） | **代码已落地；日志导出待真机验证** |
| check-ios 46/46、ios tests 52、web tests 282 | **已通过（2026-10-30 本机 Node 门禁）** |
| 修复后编译/构建 | **未验证**（本机无 Xcode） |
| 修复后 SSO 真实登录 | **未验证**（需真机 + 学校账号） |
