# iOS S 档追平（1.5.0）· 改动说明

- 日期：2026-11-18
- 来源任务：V-IOS（task-62）/ A7 决定「iOS 纳入重构并追平，先做 S 档」。
- 基线：本仓快照 = v1.3.1-rc1 / vC48 / 35 action（zip sha256 2b81f61d…b7487b）。
- 证据等级：**静态检查**。本机（Windows）无 Xcode/swiftc，**未编译、未真机**；编译与真机验收步骤见
  `work/docs/phase-1.5.0/ios-s/交给卢同志的说明.md`。

## 0. 一句话

iOS 壳补上 1.4.x 共享 web 需要的四类能力：**9 个可选 action 的诚实降级**、**考试三字段透传**、
**onNativeProgress / onLeaveServiceReturn 两个回调**；权限面板的 `supported` 属于共享 web 层，
本次**不改 web/**，只在交付目录给出精确的 web 改动清单。

## 1. 没有改 MUST 契约（为什么 9 个 action 不在主 switch 里）

`docs/IOS-PORT-CONTRACT.md` §3 的 35 个 action 是 MUST 集合，`tools/check-ios.mjs` 的 B1–B5
用「契约 = Android = iOS = 35」做三向对齐。S 档新增的 9 个 action 是 1.4.x 的 **OPTIONAL 能力**
（契约 v0 D3），iOS 还没有真实实现，所以：

- 主 `switch action` 保持 35 个 case 不动 → B1–B5、`tests/actions.test.mjs` 继续通过；
- 9 个 action 走 `default` 分支里的 `OptionalBridgeActions.handle(...)` **降级层**；
- 未登记的 action 仍回 `{error:"不支持的操作"}`（B6 继续通过）。

等 M 档真正实现某个能力时（如 cancelRecordSync 走销假表单 278615），把它提升进主 switch 即可。

## 2. 9 个诚实降级 action（`Jiangshui/Web/OptionalBridgeActions.swift`）

| action | 回包 | web 1.4.1 的消费结果 |
|---|---|---|
| cancelRecordSync | `{ok:false, code:"UNSUPPORTED_PLATFORM", message:"…"}`（值回包） | 不再被误映射成「请先打开一次请假服务完成登录」；当前 web 对未知 code 显示通用不可用，建议 web 侧加一条 code 映射（见交付清单） |
| feedbackInfo | `{enabled:false, title, intro:"", url:""}` | 反馈入口隐藏，不显示“打开失败” |
| openFeedback | `{error:"iOS 版暂不支持应用内反馈…"}` | 入口本来不渲染；真被调用也不假装打开 |
| updateInfo | `{enabled:false, currentVersion:<真实版本>, skippedVersion:"", lastAutoCheckAt:0}` | 自动检查更新按“关闭”显示 |
| updateSettings | `{error:"iOS 版暂不支持应用内更新…"}` | 开关回弹并 toast 原因（不静默忽略） |
| updateCheck | `{ok:false, errorCode:"unsupported", message:"…"}` | 提示真实原因，不再是「网络连接失败，请检查网络后重试」 |
| updateDownload | `{ok:false, errorCode:"unsupported", message:"…"}` | 正常流程不可达（check 不会返回有新版本） |
| updateCancel | `{error:"…"}` | 成功值会被 web 当成“已取消”提示 → 必须失败信封；正常流程不可达 |
| updateSkip | `{error:"…"}` | 成功值会被 web 当成“已跳过”提示 → 必须失败信封；正常流程不可达 |

> `updateInstall` 是 web 从不调用的死 API（platform-reconnect §7.1），S 档不登记，仍回「不支持的操作」。

## 3. 考试三字段透传（`School/SchoolReadController.swift` handleReadResult）

读取脚本 `web/school-reader.js` 已在结果里带 `{exams, examFetchedAt, examError}`；
原生此前只拷贝 `rows/totalWeeks/semesterId/studentProfile`，考试数据被丢弃。现已与
Android `SchoolClient.java:78-80` 逐字段对齐：

- `exams`：原样透传（数组才透传），解析/容错在共享层 `web/jiaowu-exam.mjs`；
- `examFetchedAt`：非空才透传；
- `examError`：非空才透传，并做 `{http,session,timeout,format,other}` 5 类白名单归一（未知归 `other`）。

要求：iOS 打包的 `web/` 必须是含考试读取的 1.4.x 版本；旧 1.3.1 web 的 reader 不产生这些字段，
web 侧会按“老壳”路径保留旧快照（`attachExamPayload` 对两个字段都缺省直接返回，不报错）。

## 4. 两个回调

### 4.1 `window.onNativeProgress(id, text)`（学校读取阶段文案）

- `SchoolReadController.note(_:)` 在更新容器顶栏的同时调用 `onProgress`；
- `SchoolProvider` 通过新可选协议 `SchoolReadProgressReporting` 转出；
- `BridgeDispatcher.runSchoolRead(id:)` 在 capture / sync / openSchool(mobile:false) 前挂回调，
  以**当前桥接请求 id** 调 `JSBridge.sendReadProgress` → `window.onNativeProgress(<id>,<text>)`；结束（成功/失败/取消）后摘掉。
- 与 Android `MainActivity.progress()`（MainActivity.java:213）同语义；web 只在 `busy && androidCallbacks.has(id)` 时接收。

### 4.2 `window.onLeaveServiceReturn()`（从请假服务页返回）

- `SchoolProvider` 在请假容器 `onDismissed` 且 `mode == .leaveApp` 时触发 `onLeaveServiceReturn`；
- `ShellModel` 把它接到 `WebHost.notifyLeaveServiceReturn()` → `JSBridge.sendLeaveServiceReturn()` →
  `window.onLeaveServiceReturn()`（对应 Android `hideWebApp()`，MainActivity.java:363）；
- 注销清理（`SchoolProvider.reset()`）用 `suppressLeaveServiceReturn` 抑制，避免登出后误刷新（Android logout 走 `destroyWebApp`，不发该回调）；
- `openSchool(mobile:true)` 从请假页切走时按 Android `hideWebApp()` 语义补发一次。

## 5. 共享 web 侧（本次未改）

权限面板 `supported` 的整行隐藏逻辑（旧 web 有，当前 1.4.1 web 丢失）属于共享层，
本仓不改 `web/`。精确改动清单与补丁见：
`work/docs/phase-1.5.0/ios-s/web-side/权限面板-supported-改动清单.md`（+ 同目录 `.patch`）。

## 6. 静态验证（Windows 可跑）

```bash
node ios/tools/gen-pbxproj.mjs      # 新 .swift 必须重跑，纳入 Sources
node ios/tools/check-ios.mjs        # 48 项静态门禁，必须 0 fail
node --test ios/tests/              # 含新增 s-tier.test.mjs
```

## 7. 已知限制

- 未编译：Swift 语法/类型错误只能靠 Mac/CI 首次编译暴露（预计问题集中在新文件与回调闭包捕获）。
- 未真机：进度文案是否实时显示、请假返回是否即时刷新、考试卡片是否出现，均需真机验收。
- 考试透传依赖学校考试接口可读（iOS 容器内未验证）。
- `updateCheck` 的 `errorCode:"unsupported"` 是 web 未登记的新 code，web 会回退到 message 文案；若以后要在 UI 上特殊化，需 web 加映射。
