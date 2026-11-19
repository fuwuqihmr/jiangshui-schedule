# 江水课表 iOS 版 · 代码地图

> 这份文档写给**不懂编程的人**看。它回答三个问题：这个 App 是怎么拼起来的？每一块代码是干什么的？我想改点什么该动哪个文件？
>
> 阅读顺序：先看第 1、2 节建立整体印象，第 3 节看一次「打开 App」发生了什么，第 4、5 节看两个最核心的功能（读课表、请假）怎么跑起来，最后按需查第 6 节的逐文件清单。

---

## 1. 一句话说清这个 App 的构造

App 里你看到的**整个界面，其实是一个装在 App 内部的小网页**（就是 `web/` 文件夹里那些 .mjs 和 .css）。

Swift 代码（`ios/Jiangshui/` 里的 .swift 文件）不画界面，它只做四件事：

1. **把网页显示出来** —— 用一个叫 WKWebView 的控件（iOS 自带的「浏览器零件」），并且在本机起一个只给这个 App 用的小服务器，把网页喂给它。
2. **当网页的跑腿** —— 网页说「帮我存一下课表」「帮我读一下学校网站」「给我弹个通知」，Swift 就去干，干完把结果回给网页。
3. **干网页干不了的事** —— 比如取手机定位、调系统相册选文件、写系统日历、后台定时检查。
4. **兜底** —— 网页崩了、服务起不来、协议没同意，显示原生的中文提示页。

**为什么这么设计**：网页那一层是和安卓版**共用同一份代码**的（`web/` 目录）。改一次，两边一起生效。各平台只单独写「系统能力」这一层，所以 iOS 这边是 Swift，安卓那边是 Java。

---

## 2. 目录地图：每个文件夹一句话

| 目录 | 用大白话说 |
| --- | --- |
| `ios/Jiangshui/App/` | App 的「外壳」：启动、窗口、颜色、通知弹窗。相当于房子的大门和门厅。 |
| `ios/Jiangshui/Web/` | 网页和原生之间的「中介」：本地小服务器、网页文件、互相喊话的通道。 |
| `ios/Jiangshui/Services/` | 「跑腿的部门」：存数据、写日历、发通知、导出文件、记住同意书。 |
| `ios/Jiangshui/School/` | 「学校专线」：登录学校、抄课表、请假、定位。这是整个 App 最复杂的部分。 |
| `ios/Jiangshui/Resources/` | 不是代码的东西：图标、启动配置（Info.plist）、隐私声明。 |
| `ios/tools/` | 检查工具：自动生成 Xcode 工程文件、自动检查代码有没有违规。 |
| `ios/tests/` | 自动测试：52 个小检查，改完代码跑一遍就知道有没有弄坏东西。 |
| `ios/docs/` | 各种文档（构建记录、审计报告、路线图）。本文就是其中之一。 |
| `web/` | **两端共用**的界面层：页面长什么样、按钮点了做什么。 |
| `android/` | 安卓版的原生代码，改动 iOS 时一般不用碰，但可以作为「参考答案」。 |
| `.github/workflows/ios-build.yml` | 云端编译流水线：把代码送到 GitHub 的 Mac 上真的编译一次、跑测试、出安装包。 |

---

## 3. 打开 App 之后的 30 秒，发生了什么

按时间顺序，每一步都对应一个文件：

1. 系统把 App 拉起来 → `App/JiangshuiApp.swift`（门口）
2. 组装各种「服务」（存数据的、写日历的、发通知的…）→ `App/AppEnvironment.swift`
3. 显示主界面 → `App/RootView.swift`（它只干一件事：放一个网页容器 + 顶部白条 + 出错时的提示卡片）
4. 网页容器开始工作 → `Web/WebHost.swift`
   - 先在本机 `127.0.0.1:47851` 起一个小服务器 → `Web/LocalServer.swift`
   - 再让浏览器打开 `index.html` → `Web/WebAssets.swift`（把网页文件从 App 包里读出来）
5. 网页开始跑 → `web/bootstrap.mjs` → 先问「同意书签了吗」→ `Services/ConsentStore.swift`
6. 同意过就加载主程序 `web/app.mjs`，向原生要「上次存的课表」→ `Services/StateStore.swift`
7. 如果开了「自动更新」，页面会自动发起一次核对 → 走第 4 节的流程
8. 期间如果需要通知权限、定位权限，都会经过 `Services/PermissionReporter.swift` 和系统弹窗

---

## 4. 一次「刷新课表」的完整旅程（最核心的链路）

你在页面上点右上角的刷新按钮，背后发生的事：

1. 页面脚本 `web/app.mjs` 决定要读学校 → 通过桥喊一声 `capture`。
2. 桥 → `Web/JSBridge.swift` 把这句话包成一条消息，交给 `Web/BridgeDispatcher.swift`。
3. `BridgeDispatcher` 就像公司前台，按「动作名」把活派出去；这次派给 `School/SchoolProvider.swift`。
4. `SchoolProvider` 负责编排：先准备一个「看不见的浏览器」→ `School/SchoolWebViewHost.swift`（无头模式：挂在屏幕外、透明、不能点，用户完全看不见）。
5. 真正的流程在 `School/SchoolReadController.swift`，分四步：
   - **第一步 恢复登录状态**：从钥匙串取上次的登录凭证 → `Services/SchoolSession.swift`
   - **第二步 会话失效就自动恢复**：跳统一身份认证（SSO）走一遍
   - **第三步 进教务**：如果还没有年级信息，先读一次个人信息 → `web/profile-reader.js`
   - **第四步 抄课表**：往教务页面里塞一段小脚本 → `web/school-reader.js`，它会读学期、周数、每一节课，写到页面的一个变量里；原生每 0.2 秒看一次好了没。
6. 拿到结果后，`SchoolProvider` 把数据回给网页 → 网页存盘 `saveState` → `Services/StateStore.swift` 写进手机里的 `state.json`。
7. 网页重画界面。整个过程如果超过 90 秒，会中止并保留上一次的课表。

**为什么学校页面要单独开一个浏览器？** 因为要带着学校的登录 Cookie 去访问学校网站，还要执行学校页面自己的脚本。这跟 App 自己的界面是两码事，混在一起会互相干扰。

---

## 5. 一次「请假」的旅程

1. 点「请假与调休」→ 页面喊 `openWebApp`（带上请假地址和登录预热地址）。
2. `SchoolProvider` 先做**白名单检查** → `School/SchoolURLPolicy.swift`（只允许学校域名，防止被带到乱七八糟的网站）。
3. 打开一个**看得见**的浏览器窗口，交给 `School/SchoolLeaveSessionController.swift` 管流程。它维护五个「等待关卡」：
   - 预热登录页加载完了吗？
   - 有没有拿到学校会话？
   - 是不是该跳到请假表单了？
   - 会不会落回首页（这时要再跳一次）？
   - 页面是不是提示「请重新登录」（这时只重登一次，不无限循环）？
4. 顺手从请假页地址里抄下两个参数（`uid`、`pageEnc`），存进偏好设置 → `School/LeaveRecordsService.swift`。
5. 请假记录列表不走浏览器，直接从 App 里发网络请求拿（这样更快、更稳）。
6. 上传请假凭证 → 用系统自带的文件选择器（`School/SchoolFilePicker.swift` 是为未来系统版本预留的，现在实际走系统默认行为）。
7. 需要定位 → 网页里的定位函数被换成了一个「假函数」→ `School/SchoolGeolocationBridge.swift`，它把请求转给原生，原生问系统要位置，再填回网页。

---

## 6. 数据都存在手机的哪里

| 存什么 | 存在哪 | 对应代码 |
| --- | --- | --- |
| 课表、设置、变更记录 | App 沙盒里的 `state.json`，带一个版本号 | `Services/StateStore.swift` |
| 学校登录凭证（TGC、教务 Cookie） | 系统钥匙串（加密存储，App 删了也没了） | `Services/SchoolSession.swift` |
| 同意书签没签、请假页参数 | 系统的偏好设置（UserDefaults） | `Services/ConsentStore.swift`、`School/LeaveRecordsService.swift` |
| 排查日志 | App 沙盒里的 `applog.txt` | `School/SchoolDiagnosticLog.swift` |

**为什么课表要带版本号？** 防止「两个人同时改」时把数据改坏：每次保存都要求版本号对得上，对不上就报「课表已在后台更新，请稍后重试」，页面会重新取一次最新版本再存。

---

## 7. 逐文件清单（35 个 Swift 文件，一句话一个）

### App/ —— 外壳

| 文件 | 干什么的 |
| --- | --- |
| `JiangshuiApp.swift` | App 的入口，程序从这里开始跑；同时注册上课提醒的 BGAppRefreshTask。 |
| `AppEnvironment.swift` | 把各种服务组装好，统一交给界面用；启动时做一次提醒对账。 |
| `RootView.swift` | 主界面：网页 + 顶部白条 + 出错提示卡片；前后台切换时补做提醒对账。 |
| `NotificationPresenter.swift` | App 在前台时，通知也照样弹出来（系统默认是不弹的）。 |

### Web/ —— 网页与原生之间的中介

| 文件 | 干什么的 |
| --- | --- |
| `WebHost.swift` | 网站长：起服务器、装桥、加载页面、处理前后台切换、边缘手势返回。 |
| `LocalServer.swift` | 在本机 47851–47860 找一个空端口，起一个只服务本 App 的小服务器。 |
| `WebAssets.swift` | 把打包进 App 的网页文件读出来交给服务器。 |
| `JSBridge.swift` | 双向电话线：网页喊原生、原生回话。 |
| `BridgeDispatcher.swift` | 前台总机：按动作名（35 个）把活派给对应服务。 |

### Services/ —— 跑腿的部门

| 文件 | 干什么的 |
| --- | --- |
| `StateStore.swift` | 课表数据的读写与版本冲突检查。 |
| `ServiceProtocols.swift` | 各个服务的「岗位说明书」（接口定义）。 |
| `NativeServices.swift` | 把所有服务打包成一份，方便传递。 |
| `CalendarService.swift` | 把课表写进系统日历。 |
| `ClassReminderService.swift` | 上课提醒：未来 7 天预排通知、到期清理、开关/预览/关闭。 |
| `SystemNotificationService.swift` | 发系统通知、跳系统设置。 |
| `ScheduleDayResolver.swift` | 把「第几周第几节」换算成具体日期和时间。 |
| `ConsentStore.swift` | 记住用户协议签没签、哪天签的。 |
| `SchoolSession.swift` | 学校登录凭证的加密存取（钥匙串）。 |
| `PermissionReporter.swift` | 汇报通知/定位等权限的当前状态给网页。 |
| `RuntimeStatusService.swift` | 汇报运行环境信息（版本、系统等）。 |
| `DiagnosticsService.swift` | 收集排查信息，导出成文本。 |
| `FileExchangeService.swift` | 导入/导出课表快照等文件。 |
| `LogoutController.swift` | 注销：清数据、清凭证、清 WebView。 |
| `ThemeController.swift` | 深浅色主题与页面背景色的同步。 |
| `JSONCompat.swift` | 网页传来的数据类型和 Swift 对不上，这里统一转换。 |

### School/ —— 学校专线（最复杂的部分）

| 文件 | 干什么的 |
| --- | --- |
| `SchoolProvider.swift` | 学校功能的总调度：网页点按钮最后都落到这里。 |
| `SchoolReadController.swift` | 「自动抄课表」的流程控制器（四阶段状态机）。 |
| `SchoolWebViewHost.swift` | 藏在 App 里的第二个浏览器（可见/无头两种模式）。 |
| `SchoolLeaveSessionController.swift` | 请假页面的流程控制（五个等待关卡）。 |
| `LeaveRecordsService.swift` | 请假记录的读取与参数记忆。 |
| `SchoolURLPolicy.swift` | 网址白名单与参数合法性检查（安全闸门）。 |
| `SchoolGeolocationBridge.swift` | 让网页能拿到手机定位（转发给原生）。 |
| `SchoolLocationPermission.swift` | 定位权限的申请与状态查询。 |
| `SchoolFilePicker.swift` | 自定义文件选择器（为 iOS 18.4+ 预留，当前未接线）。 |
| `SchoolDiagnosticLog.swift` | 学校线的排查日志（写在本地，导出时脱敏）。 |

---

## 8. 想改代码，先记住这 6 条规矩

1. **`web/` 是和安卓共用的**。改它等于同时改两端，必须把两端测试都跑过；而且它被「基线」锁着（`ios/tools/check-ios.mjs` 会比对 182 个文件的哈希），改了要同步更新基线。
2. **改完 Swift 必须跑两条命令**：`node ios/tools/check-ios.mjs`（46 项静态检查）和 `cd ios && node --test tests/`（52 项测试）。
3. **这台 Windows 电脑编不了 iOS**。Swift 只能靠 GitHub Actions 的 Mac 编译，所以改完要推上去看流水线。
4. **注释也算代码**：本仓库的注释要求「先讲人话，再讲术语」。
5. **提交要一次推一条**：流水线开了「新提交取消旧运行」，连着推会把正在跑的那次取消掉。
6. **不要在代码里写死密码、Cookie、密钥**：凭证只进钥匙串。

---

## 9. 建议的阅读顺序（从简单到复杂）

1. `App/JiangshuiApp.swift` —— 20 行，看 App 怎么起来
2. `App/RootView.swift` —— 看界面骨架
3. `Web/WebHost.swift` —— 看「网页是怎么被装进来的」
4. `Web/JSBridge.swift` + `Web/BridgeDispatcher.swift` —— 看两边怎么喊话
5. `Services/StateStore.swift` —— 看数据怎么存
6. `School/SchoolProvider.swift` —— 看学校功能的总入口
7. `School/SchoolReadController.swift` —— 最后看这个（最长，也最核心）

---

## 10. 名词小抄

| 词 | 大白话 |
| --- | --- |
| WKWebView | iOS 自带的「浏览器零件」，能在 App 里显示网页。 |
| 本地服务器 / loopback | 在手机自己身上开的一扇小门，只有本 App 能访问，用来把网页文件喂给浏览器。 |
| Cookie | 网站发给你的「进门凭证」，下次带着它就不用重新登录。 |
| Keychain（钥匙串） | 系统提供的加密保险箱，适合放密码和凭证。 |
| UserDefaults（偏好设置） | 系统提供的小抽屉，适合放开关状态、短字符串。 |
| 桥 / bridge | 网页和原生之间的传话筒。 |
| 无头（headless） | 浏览器在跑，但用户看不见（挂在屏幕外、透明、不能点）。 |
| 门禁 / check-ios | 一组自动检查脚本，防止改坏关键约定。 |
| IPA | iOS 的安装包文件（相当于安卓的 apk）。 |
| TestFlight | 苹果官方的内测分发渠道，需要付费开发者账号。 |
| bundle id | App 的唯一身份，这里是 `cn.local.tomorrow`。 |

---

## 11. 注释覆盖情况（2026-11-01）

全部 **35 个 Swift 文件**都已加上给新手看的中文注释，合计新增 **950 行注释**，原有代码 **0 行删除、0 行修改**（只是加解释，不动逻辑）：

| 目录 | 文件数 | 新增注释行 | 谁写的（团队分工） |
| --- | --- | --- | --- |
| `App/` | 4 | 28 | implementer-shell |
| `Web/` | 5 | 160 | implementer-shell |
| `Services/` | 16 | 330 | implementer-services |
| `School/` 核心 4 个 | 4 | 235 | implementer-school |
| `School/` 其余 6 个 | 6 | 197 | swift-controller-auditor |
| **合计** | **35** | **950** | — |

注释后总行数 7,022 → **7,972 行**。加注释后这几个文件超过了「单文件 400 行」的软约束（`SchoolReadController` 796、`SchoolWebViewHost` 712、`WebHost` 447、`ScheduleDayResolver` 434）。`ClassReminderService` 在本轮 P0 改造中通过去重和精简回落到 398 行，重新满足软约束。

验证方式：`git diff -U0` 里没有删除行、新增行全部以 `//` 或 `///` 开头；`check-ios` 46/46、`node --test ios/tests/` 52/52、`node --test tests/*.test.mjs` 282/282 全绿。**注释不改变语义，但仍未在 Mac/Xcode 上编译过**，编译证据见 `docs/BUILD-LOG.md`。

---

## 12. 上课提醒怎么排（2026-11-03）

1. **启动/回前台**：`AppEnvironment` 和 `RootView` 叫一次 `ClassReminderService.reconcile()`。
2. **算未来窗口**：`reconcile()` 取今天前后共 9 天（-1…7）的课程，算出每条课的 `showAt`（上课前 30 分钟）和 `expiresAt`（上课后 5 分钟）。
3. **预排**：未来事件用 `UNCalendarNotificationTrigger` 交给系统；已经进入窗口的事件仍用 1 秒 `UNTimeIntervalNotificationTrigger` 立即发。每条通知用 `class/<date>|<key>` 作为 identifier，先移除同 identifier 的 pending 再 add，课程表变化时整批覆盖。
4. **到期清理**：已投递且超过 `expiresAt` 的通知用 `removeDeliveredNotifications` 移除；下次启动、回前台、保存课表或 BGTask 执行时都会顺带做。
5. **后台唤醒**：`JiangshuiApp` 注册 `cn.local.tomorrow.class-reminder` 的 `BGAppRefreshTask`，系统给机会时补跑 `reconcile()`。**它只是 best-effort：系统可能延后、合并，省电模式下甚至完全不执行，不能当闹钟用。** 真正的提醒仍靠第 3 步预排。

_本文与代码同步维护：如果新增了文件或改了职责，请顺手更新对应表格。_
