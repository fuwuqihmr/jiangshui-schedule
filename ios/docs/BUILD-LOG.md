# 编译记录（BUILD-LOG）

本文件记录 iOS 工程**真实编译**的证据。凡标「通过」的行，都有 CI 日志或本机日志作为依据；没有日志的结论不写在这里。

## 为什么用 CI 编译

开发机是 Windows，没有 Xcode / swiftc，也无法在虚拟机里跑 macOS 模拟器（无 Metal）。
GitHub Actions 的 `macos-14` runner 提供 Xcode 15.4，用它做「能不能编过」的判定；
**它不能替代模拟器/真机运行**——那两项仍需要一台真 Mac。

工作流：`.github/workflows/ios-build.yml`（push 到 `main` 且改动 `ios/**`、`web/**` 或工作流自身时触发）。

## 第 1 次编译通过（2026-10-28，run #6）

| 项 | 值 |
| --- | --- |
| 提交 | `b2a97a4`（修 WebHost 协议遵循 + LocalServer inout 默认参数） |
| Runner | macOS 14.8.9 (23J631)，`macos-14` |
| Xcode | 15.4 (15F31d)，swift-driver 1.90.11.1 / Apple Swift 5.10 |
| Node | v20.20.2 |
| 命令 | `xcodebuild build -project Jiangshui.xcodeproj -target Jiangshui -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO SYMROOT=$PWD/build-out/build` |
| 结果 | `** BUILD SUCCEEDED **` |
| 错误 | 0 |
| 警告 | 1（`ONLY_ACTIVE_ARCH=YES requested with multiple ARCHS ...`，因此产物是 x86_64 + arm64 通用二进制，属预期） |
| 步骤退出码 | `rc-gen=0 rc-check=0 rc-test=0 rc-build=0`（check-ios 43/43、node --test 52/52） |

产物 `ios/build-out/build/Debug-iphonesimulator/Jiangshui.app`（5.9 MB）内容核对：

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `Jiangshui` | 2,817,208 B | Mach-O universal binary（x86_64 + arm64） |
| `Assets.car` | 1,800,543 B | actool 编译成功；同时生成 `AppIcon60x60@2x.png`、`AppIcon76x76@2x~ipad.png`，证明 1024×1024 图标被接受 |
| `web/` | — | folder reference 完整复制：`index.html`、`bootstrap.mjs`、`app.mjs`、`style.css`、`agreement.json`、`assets/` 等 |
| `Info.plist` / `PrivacyInfo.xcprivacy` | 2,566 / 1,197 B | ATS 与隐私清单已进包 |

> 注：`AppIcon-1024.png`（962,381 B）也被当作**散装资源**复制进包，与 `Assets.car` 内的图标重复，约占 1 MB。不影响运行，后续可从 `project.yml` 的资源列表里去掉。

## 第 2 次运行：Debug + Release 双配置（2026-10-28，run #7）

同一提交 `f735e16` 上把 Release 也编了一遍，两步都过：

| 步骤 | 退出码 | 结果 | 产物 |
| --- | --- | --- | --- |
| Debug | `rc-build=0` | `** BUILD SUCCEEDED **`，0 error | `build/Debug-iphonesimulator/Jiangshui.app` 5.9 MB，二进制 2,817,208 B |
| Release | `rc-release=0` | `** BUILD SUCCEEDED **`，0 error / **0 warning** | `build-release/Release-iphonesimulator/Jiangshui.app` 4.9 MB，二进制 1,795,544 B |

`rc-gen / rc-check / rc-test / rc-build / rc-release` 全为 0。两者都是 x86_64 + arm64 通用二进制；
Release 包内 `Assets.car`、`web/`、`Info.plist`、`PrivacyInfo.xcprivacy` 与 Debug 一致，说明优化模式下资源同样齐全。

## 第 3 次运行：第一次真正把 App 跑起来（2026-10-28，run #8）

CI 里加了"模拟器启动 + 截图"步骤（`xcrun simctl boot/bootstatus/install/launch` → 等 30 s → `simctl io screenshot`）。

| 项 | 结果 |
| --- | --- |
| 选中设备 | iPhone 15 Pro（iOS 17.0，UDID `E3BBCD6B-…-96D3151F472D`） |
| 安装 + 启动 | 成功，`cn.local.tomorrow: 3088`（进程起来了、没闪退） |
| 原生 UI | 正常渲染：能显示"页面服务未启动 / 本机端口 47851–47860 均被占用…"的中文错误页，说明 SwiftUI 根视图与失败兜底逻辑都活着 |
| 真正的问题 | 日志 10 行 `江水课表 loopback 端口 4785x 创建失败：POSIXErrorCode(rawValue: 22): Invalid argument`，全部端口失守 |

**根因**（`LocalServer.swift` 原 :84 与 :86 两行冲突）：

```swift
parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: nwPort)  // 端口在这里
let listener = try NWListener(using: parameters, on: nwPort)                             // 又给一次
```

网络栈报 `nw_listener_copy_parameters_with_port Local endpoint has port set, cannot override to 47851`，
`NWListener` 构造直接抛 EINVAL，于是 47851–47860 全试了一遍全失败。

**修复**：端口只保留在 `requiredLocalEndpoint` 里，构造改成 `try NWListener(using: parameters)`。
`parameters.allowLocalEndpointReuse = true` 与"只绑 127.0.0.1"的语义不变，静态门禁 F1（47851..47860、仅 127.0.0.1）仍然通过。

> 意义：这是整个项目第一次**真机运行级**的证据——App 能启动、能画原生界面、错误路径有兜底。
> 但它同时也暴露了一个只有跑起来才会发现的 bug：编译期和 43 项静态检查都不可能发现网络栈的运行期约束。

## 第 4 次运行：第一次进入主界面（提交 `7ca1ffe`，run #9）

`rc-gen / rc-check / rc-test / rc-build / rc-release / rc-sim` 全部 0。

| 阶段 | 证据 |
| --- | --- |
| 首启 | `cn.local.tomorrow: 5808`；截图 `simulator-1-first-launch.png` 是**用户协议页**（标题「用户协议与 Cookie 授权」、版本 2026-10-17.1、复选框、「拒绝并退出 / 同意并使用」） |
| 预置同意后第二次启动 | `cn.local.tomorrow: 8367`；截图 `simulator-2-main.png` 是**课表主界面**：底部四个 tab（今日课表 / 完整课表 / 变更记录 / 设置与数据）、「2026—2027 第一学期」「样课表」、刷新按钮、以及一次性「权限检查（可跳过）」弹窗 |
| loopback 服务 | 日志出现 `127.0.0.1:47851` 的服务端连接与 `bytes in/out: 435/18203`、`/3783`、`/1166` 等 TCP 统计 —— 端口修复后 HTTP 服务确实在对外服务 |
| JS 桥回包 | 权限弹窗里四组状态（通知未开启 / 精确闹钟系统版本无需设置 / 电池优化 / 自启动）全部来自 `permissionStatus` 的异步回包，说明 `window.onNativeResult` 通路成立 |
| 资源承载 | 页面由 `../web/` 的 ES Module 提供，说明 folder reference + 本地 HTTP 组合可用（`file://` 下 `type="module"` 会被 CORS 拦死，这里正是靠 loopback HTTP 绕开） |

**结论：壳路线的三层（WKWebView 显示、本地 HTTP 供资源、JS↔原生桥回包）第一次同时成立。**

仍然**不是**可上架产物：没签名、只在模拟器、没连过真机、没走过 TestFlight。

### 同轮修掉的一个产品层问题

模拟器截图暴露：iOS 上「权限检查」面板照搬了 Android 的「电池优化 / 自启动」两行（iOS 没有电池优化豁免，也不能注册自启动）。已改为能力驱动：

- `ios/Jiangshui/Services/PermissionReporter.swift`：`battery` 增加 `"supported": false`（`autostart` 原本就是 `supported: false`）。
- `web/app.mjs`：`permissionStatus` 里 `supported === false` 的组整行不渲染，相关「小米/Redmi」说明与「自启动」文案同步隐藏。Android 的 payload 没有该字段，行为不变。
- 连带更新：`tools/check-ios.mjs` 登记 `battery.supported`、E1/E2 基线重算（**当时** 181 文件 / `0e19e158…ff7472`，原因就是 `web/app.mjs` 被有意改动）、`tests/baseline.test.mjs` 与 `tests/permission.test.mjs` 同步。当前基线见第 11 轮。
- 回归：当时 web 275 项、iOS 52 项、静态门禁 43 项全绿。

## 第 5 轮改动：拆掉压标题的浮动按钮 + 权限面板只留 iOS 真有的项

run #9 的两张截图暴露了两个纯 iOS 侧问题（编译期、43 项静态检查都发现不了）：

| 现象 | 根因 | 改法 |
| --- | --- | --- |
| 左上白色圆形返回按钮压住「用户协议与 Cookie 授权」「江水课表」标题 | 44×44 浮层叠在 WKWebView 之上，而 web 页面自己的标题就在同一位置 | **删掉浮动按钮**，改为左边缘右划手势（WebHost 的 UIScreenEdgePanGestureRecognizer，→ navigateBack()）；页面内可退状态本来都有自带按钮 |
| 权限弹窗里出现「电池优化 / 自启动」和「系统版本无需设置」的精确闹钟 | iOS 端 permissionStatus 照搬了 Android 的字段 | iOS 侧给 exactAlarm/battery/autostart 一律带 supported:false；web 端 supported===false 的组整行不渲染 |

- `ios/Jiangshui/Web/WebHost.swift`：加边缘手势 + `handleEdgePan`；RootView 不再渲染 backButton。
- `ios/Jiangshui/Services/PermissionReporter.swift`：`exactAlarm` 增加 `"supported": false`（`battery`/`autostart` 上轮已带）。
- `web/app.mjs`：`showExact/showBattery/showAutostart` 三处能力判断；新增 `__dsjCanGoBack()`（原生将来要用可退判断时不必再改 web）。
- 门禁：F5 改为「表达式逐字 + 边缘手势 + **RootView 不得再出现 backButton/chevron.left**」，防回归；E1/E2 基线当时为 181 文件 / `0e19e158…ff7472`（当前见第 11 轮）。
- 本地回归：当时 web 275、iOS 52、静态门禁 43 全绿。

## 第 6 次运行：run #12（提交 8769392）验证上轮两处修复

环境同前（macOS 14.8.9 / Xcode 15.4 / node 20.20.2），六项退出码 **gen 0 / check 0 / test 0 / build 0 / release 0 / sim 0**，
`xcodebuild.log` 与 `xcodebuild-release.log` 内 `error:` 命中 **0 行**，静态门禁 **43 项 ok 43 / fail 0**，校验器自测 **52 pass**。

| 上轮预期 | 本轮截图结果 |
| --- | --- |
| 同意页不再有浮层压标题 | ✅ 标题「用户协议与 Cookie 授权」完整显示，左上无任何覆盖物（`simulator-1-first-launch.png`，329,444 B） |
| 主界面不再有浮层压标题 | ✅ 「2026—2027 第一学期」「江水课表」完整显示（`simulator-2-main.png`，304,089 B） |
| 权限弹窗只剩「通知」一行 | ✅ 只剩「通知 · 未开启 / 去开启通知」+「稍后再说」；精确闹钟、电池优化、自启动三行都消失 |

结论：**手势代码在 Xcode 15.4 / Swift 5.10 下编译通过**（`UIScreenEdgePanGestureRecognizer` + `#selector` 无告警），
两项视觉缺陷均已消除。手势本身的**触发行为**无法用 `simctl` 截图验证，仍需真机（见下表）。

## 第 7 轮改动：让出 iOS 状态栏（安全区）+ 产出可侧载的未签名 IPA

run #12 的截图还有一处明显缺陷：主界面顶部「2026—2027 第一学期」「江水课表」以及右上的「样课表 / 刷新」都压在 iOS 状态栏（时间、电量、灵动岛）下面；同意页标题同样贴着状态栏。

| 现象 | 根因 | 改法 |
| --- | --- | --- |
| 顶部文字被状态栏/灵动岛遮住 | `RootView` 的 `WebViewContainer(...).ignoresSafeArea()` 让 WKWebView 铺满全屏，而 `web/style.css` 的手机版（`@media (max-width:720px)`）只为底部 tab 栏留了 `env(safe-area-inset-bottom)`，顶部没有任何安全区内边距 | 在 `ios/Jiangshui/Web/WebHost.swift` 加一段 **iOS 专属**样式，`documentStart` 注入，用 `env(safe-area-inset-top/left/right)` 给 `.main`、`.agreement-screen`、`.leave-page-topbar` 补内边距 |

- 为什么注入 CSS 而不是原生给 WKWebView 加约束：页面背景色能连续铺到状态栏底下（不会出现一条色带），且**只作用于 iOS**，Android 与桌面端完全不受影响 —— `web/` 一行没改，E1/E2 基线（**当时** 181 文件 / `0e19e158…ff7472`）保持不动；当前基线见第 11 轮。
- 实现要点：`installUserScripts(on:)` 统一装 shim + 安全区脚本；`loadIndex` 重新加载时也会重装（否则 `removeAllUserScripts()` 会把样式丢掉）。CSS 经 `JSONSerialization` 转成 JS 字符串字面量，避免手写转义。
- 门禁：新增 **F10**（`env(safe-area-inset-*)` 注入 + 每次加载重装 + 只作用于主框架），静态门禁 **43 → 44 项**，`tests/full-suite.test.mjs` 同步。

同轮还往 CI 加了一条真机产物链，用来把「真机验证」提前到买 Apple 开发者账号之前：

- `编译真机包（iphoneos，不签名）`：`xcodebuild -sdk iphoneos -configuration Release CODE_SIGNING_ALLOWED=NO`，退出码 `rc-device`。
- `打包未签名 IPA`：拷 `Release-iphoneos/Jiangshui.app` 到 `Payload/` 后 `zip`（同时校验 `lipo -info` 含 `arm64`、不含 `x86_64`），产出 `ios/build-out/Jiangshui-unsigned.ipa`，退出码 `rc-ipa`。
- 独立 artifact **`jiangshui-unsigned-ipa`**（与日志 artifact 分开），下载后可直接交给爱思助手 / Sideloadly 用免费 Apple ID 重签装真机。
- `device` / `ipa` 已加入汇总与判定的退出码列表：真机包编译失败会让 CI 变红，不会静默跳过。

下一轮（run #13）要核对的预期：两张截图顶部文字下移到状态栏以下；`rc-device` / `rc-ipa` 均为 0 且 artifact 里出现 `Jiangshui-unsigned.ipa`。
## 编译期踩过的坑（都已修，留给后来人）

1. **AppIcon 尺寸**：`AppIcon.appiconset/AppIcon-1024.png` 早期是 128×128（从 web 图标直接改名），Xcode 15.4 的 actool 直接报 `app icon set named "AppIcon" did not ...`。已重采样为真 1024×1024。
2. **参数名遮蔽方法名**：`ScheduleDayResolver.isFirstYear(snapshot:date:)` 的 `date` 参数遮蔽了同文件的 `static func date(fromDay:)` → `cannot call value of non-function type 'String'`。改用 `Self.date(fromDay:)`。
3. **逃逸闭包要写 `self.`**：`BridgeDispatcher` 内 `runBoolAction(id:written:)` 的闭包调用私有方法 `text(_:)` 必须显式 `self.text(...)`。
4. **协议遵循写在类型上**：`WebHost` 把 `BridgeDispatcher` 赋给 `BridgeDispatching?` 前，类声明必须写 `: BridgeDispatching`。
5. **`inout` 参数不能有默认值**：`LocalServer.sendLocked(... extraHeaders: inout String)` 改为值传递 `extraHeaders: String = ""`。
6. **基线口径**：`check-ios` 的 E1/E2 只统计**入库文件**（排除 `*.apk`/`*.zip` 构建产物）。工作树 188 个文件、CI checkout 182 个，不排除就必然假失败。当前基线：**182 文件 / `1ea23688…18cbdd`**（因 task-16 新增 `web/state-sync.mjs` 而重新登记，见第 11 轮）。

## 第 8 轮改动：P2 教务真实读取（2026-10-29，尚未编译）

本轮**没有新的编译证据**：改动只在本机（Windows，无 swiftc），静态门禁与 Node 测试能跑，Swift 编译必须等 CI。

| 项 | 值 |
| --- | --- |
| 新增代码 | `School/SchoolReadController.swift`（551 行，四阶段状态机）、`School/LeaveRecordsService.swift`（280 行，假条直连） |
| 改写 | `School/SchoolProvider.swift`（111 → 197 行，桩改真实实现）、`SchoolWebViewHost.swift`（+回调/+`evaluate`/去桩文案，400 → 436 行） |
| 接线 | `BridgeDispatcher` 的 `openSchool(mobile:false)` 走 `capture()`；`ServiceProtocols` 加 `clearLeaveSession()`；注销时清请假会话 |
| 门禁 | F8 重写为「P2 教务真实读取：状态机四阶段 + 假条直连同步（无残留桩）」，总数仍 44 |
| 本机结果 | `gen-pbxproj`→Swift 30 / 资源 3 / web folder reference 1 / 引用 36；`check-ios` **44/44**；`node --test ios/tests` **52 pass**；`node --test tests/*.test.mjs`（web，**当时**）**275 pass** |
| 预期风险 | 551 + 280 行 Swift 未经编译（本轮已被第 9 节的真实报错取代）；Swift 5.0 语言模式 + iOS 15 部署目标下，`URLSession.data(for:)`（iOS 15 OK）、`withCheckedThrowingContinuation`、`@escaping` 捕获与 `Any` 类型推断是最可能报错的地方 |

## 第 9 轮改动：P2 首轮 CI 编译报错与修复（2026-10-29）

CI（commit `926df61`，macos-14 / Xcode 15.4）结果：`rc-gen=0`、`rc-check=0`（44/44）、`rc-test=0`（52 pass），但 **`rc-build=65`、`rc-release=65`、`rc-device=65`、`rc-ipa` 未产出**（device 编译失败 → `lipo: can't open input file`）。三份 xcodebuild 日志里**去重后只有 1 条错误**：

| 错误 | 根因 | 修法 |
| --- | --- | --- |
| `School/SchoolProvider.swift:161:47: error: cannot convert value of type '() -> ()?' to expected argument type 'DispatchWorkItem'` | `let work = { self.host?.hide(animated: true) }` 闭包最后一条是可选链调用，被推断成 `() -> ()?`，而 `DispatchQueue.main.async(execute:)` 需要 `() -> Void` | `let work: () -> Void = { _ = self.host?.hide(animated: true) }`；同文件 `reset()` 的同类闭包一并显式标注 + `_ =` 丢弃 |

同一轮用两个静态审查员（swift-controller-auditor / swift-leave-auditor）把 P2 全部新代码按 Swift 规则复查了一遍，另修 **5 处运行期问题**（都不是编译错误，是审查发现的行为缺陷）：

| 位置 | 问题 | 修法 |
| --- | --- | --- |
| `SchoolReadController.swift:462` | 把 `AbortController` 实例当函数调用（`window.__tomorrowAbort()`）→ 页面抛 TypeError 且被空回调吞掉，读取失败时 in-flight fetch 不会被取消 | 改为 `window.__tomorrowAbort.abort()`（对齐 `web/school-reader.js:5`、Android `SchoolClient.java:69`） |
| `LeaveRecordsService.swift:113` | 读 `WKHTTPCookieStore` 时用 `hasSuffix` 匹配域，会误命中 `xxxgxt.juwp.edu.cn`；且不过滤过期、未按路径排序 | 改 RFC 6265 §5.1.3 domain-match + 过期过滤 + path 长度降序（对齐 `CookieManager.getCookie`） |
| `LeaveRecordsService.swift:140` | 在 `BridgeDispatcher` 的 `Task {}` 后台线程读 `WKWebsiteDataStore`（WebKit 主线程对象） | `withCheckedContinuation` + 显式切主线程（`Thread.isMainThread ? read() : DispatchQueue.main.async(execute: read)`） |
| `SchoolWebViewHost.swift:339` | `decidePolicyFor` 对所有导航做白名单判定，iframe 子框架也被 cancel（Android 只拦主框架）→ 教务页若用 iframe 会白屏 | 子框架（`targetFrame?.isMainFrame == false`）直接 allow；顶层越界仍会被拦住 |
| `SchoolWebViewHost.swift:85` | `present` 异步转场期间 `view.window` 仍为 nil，`isVisible` 判不出「已 present」→ 二次 present 被 UIKit 静默忽略 | 条件加 `\|\| presentingViewController != nil` |

改完本机回归：`gen-pbxproj` 幂等（Swift 30 / 资源 3 / web folder reference 1 / 引用 36）、`check-ios` **44/44**、`node --test ios/tests` **52 pass**、`node --test tests/*.test.mjs`（web，**当时**）**275 pass**。

**这一节只是「修完已知错误」，不代表已经编译通过**——Swift 的首个类型错误会让后续文件不被完整类型检查，剩余错误数仍未知，要等下一轮 CI。

## 第 10 轮：P2 编译通过（2026-10-29，提交 `9685ab5`）

这一轮**没有任何编译错误**。8 个退出码全 0，三份 xcodebuild 日志都是 `** BUILD SUCCEEDED **`：

| 步骤 | rc | 结论 |
| --- | --- | --- |
| gen | 0 | Swift 30 / 资源 3 / web folder reference 1 / 引用 36 |
| check（静态门禁） | 0 | **44 项 ok 44 / fail 0** |
| test（校验器自测） | 0 | **52 tests / 52 pass** |
| build（Debug，模拟器） | 0 | BUILD SUCCEEDED，`error:` 行数 **0** |
| release（Release，模拟器） | 0 | BUILD SUCCEEDED，`error:` 行数 **0** |
| device（Release，iphoneos） | 0 | BUILD SUCCEEDED，`error:` 行数 **0** |
| ipa（打包未签名 IPA） | 0 | 产出 `Jiangshui-unsigned.ipa` |
| sim（模拟器启动 + 两张截图） | 0 | 首启 330,770 B / 主界面 308,314 B |

**产物核对**

| 项 | 值 |
| --- | --- |
| 真机二进制 | 1,040,736 B，`Non-fat ... architecture: arm64`（thin，不含 x86_64） |
| 未签名 IPA | **3,243,844 B**，sha256 `d19cc4634b48a5427d29c7e8a5819e1bd99de6cb849b3a14d4de8b3abc53b739` |
| 包内 web/ | 34 个条目，含 `school-reader.js` 与 `profile-reader.js`（P2 注入脚本必须随包，否则运行期读不到） |
| 包内 Info.plist | `cn.local.tomorrow` / 1.3.1 / build 48 / MinimumOSVersion 15.0 / UIDeviceFamily [1,2] / UIBackgroundModes [fetch, processing] |
| P2 代码确实编进去了 | 设备二进制里 `SchoolReadController` 出现 100 次、`LeaveRecordsService` 57 次、`leaveRecordSync` 9 次、`278616` 3 次、`xgxt.juwp.edu.cn` 25 次，三段 P2 专属中文文案各 1 次 |

唯一 warning 仍是 `ONLY_ACTIVE_ARCH=YES requested with multiple ARCHS ...`（不签名、多架构构建的无害提示）。

**这一轮证明了什么 / 没证明什么**

- 证明：P2 的 551 + 280 行新 Swift 在 Swift 5.0 语言模式、iOS 15 部署目标下**类型检查与代码生成全部通过**，IPC/URLSession/Keychain/WebView 回调这些接口的签名都对；未签名真机包也已产出。
- 没证明：登录 → 恢复 → 读课表 → 假条同步的**真实行为**，必须用真实学校账号在真机上跑（清单见 `docs/P2-SCHOOL-READ.md` §7）。编译通过 ≠ 教务系统返回的数据结构与我们解析的一致。

## 第 11 轮：真机保存冲突与 P2 运行期修复（2026-10-30，尚未重新编译）

本轮**没有新的编译证据**：改动在 Windows 本机完成，静态门禁与 Node 测试能跑，Swift 编译/重签必须等 CI + `Sideloadly`。

| 类别 | 文件 | 内容 |
| --- | --- | --- |
| web 保存兜底 | `web/state-sync.mjs`（新增）、`web/app.mjs` | boot 保留磁盘 `_revision`；首次冲突后 `loadState` 读磁盘 revision 重存同一份数据；仍冲突用 `expectedRevision:-1` 强制保存，第三次才抛错 |
| Swift 防御 | `Web/BridgeDispatcher.swift` | `loadState` 显式 `if let saved … else NSNull()`；**只是防御，不是死循环根因** |
| P2 运行期 | `School/SchoolReadController.swift` | `needLogin` 取消原 60s 死线；`navigationFailed` 在登录等待期不终止；`sso()` 重挂 90s；`leaveLogin()` 挂 60s 兜底 |
| P2 运行期 | `School/SchoolProvider.swift` | `onDismissed` 取消读取；`onPageFinished` 再抓 `uid/pageEnc` |
| 诊断 | `Services/StateStore.swift` | 冲突时 `applog` 记录 `expected/disk` revision，便于真机定位 |

- 门禁：**F8** 追加「P2 四阶段运行期修复 + loadState 显式回包」断言（当时仍 44 项，不新增编号；第 12 轮起为 46 项）；E1/E2 重算为 **182 文件 / `1ea23688…18cbdd`**（新增 `web/state-sync.mjs`），`ios/tests/baseline.test.mjs` 同步。
- 本机结果：`gen-pbxproj` 幂等（当时 Swift 30 / 资源 3 / web folder reference 1 / 引用 36）；`check-ios` **44/44**（当时）；`node --test ios/tests` **52 pass**；`node --test tests/*.test.mjs`（web）**282 pass**。
- 已证明：保存冲突有三层兜底、P2 四条运行期问题在源码层已修，静态契约/引用/桥接未被破坏。
- **未证明**：真实账号首次登录不再冲突、点「返回课表」立即取消、假条同步不再恒 `NEED_SESSION` —— 要 CI 重编 + 重签真机复跑（清单见 `docs/P2-SCHOOL-READ.md` §7/§10）。

## 第 12 轮：顶部白条 + P2 无头核对 + P3 请假深链/上传/定位（2026-10-30，尚未编译）

本轮同样**没有新的编译证据**：全部改动在 Windows 本机完成，Swift 编译/签名仍等 CI + `Sideloadly`。

| 类别 | 文件 | 内容 |
| --- | --- | --- |
| 顶部白条 | `App/RootView.swift`、`Web/WebHost.swift` | A 方案：RootView 底层铺 `Color(uiColor: host.shellBackgroundColor).ignoresSafeArea()`，WebView 只 `.ignoresSafeArea(.container, edges: .bottom)`（顶边落在安全区下沿）；WebHost `isOpaque=false` + `clipsToBounds=true` 物理裁剪，`jiangshuiShellTheme` 脚本把 `--bg` 回传原生，不用 CSS 遮挡状态栏 |
| P2 无头核对 | `School/SchoolWebViewHost.swift`、`School/SchoolProvider.swift`、`School/SchoolReadController.swift` | 读取时容器 `alpha=0.01`、`isUserInteractionEnabled=false`、无障碍隐藏、`insertSubview(view, at:0)`；`capture` 不强制 `presentForUser`；仅 `needLogin()` 触发 `onNeedsVisiblePresentation`（全文件 1 个调用点） |
| P3 请假深链 | `School/SchoolLeaveSessionController.swift`（新增 255 行） | 五标志十步状态机：`warmupPending/targetRequested/officeLoaded/reloginTried/retargetTried`，含 450ms 复检、CAS 提示「请重新登录」只回 warmup 一次、非 office 只重载目标一次、30s 慢定时器 |
| P3 定位 | `School/SchoolGeolocationBridge.swift`（253）、`School/SchoolLocationPermission.swift`（165）、`Resources/Info.plist` | `WKUserScript` 替换 `navigator.geolocation` + `jiangshuiGeo` 消息；origin 必须 https + `SchoolURLPolicy.isXgxtUrl` + 端口 0/443；plist 增定位/相册/相机/麦克风 4 条中文用途文案 |
| P3 上传（预留） | `School/SchoolFilePicker.swift`（197，未接线） | `runOpenPanelWith` 仅 iOS 18.4+，当前 0 调用点；附件按钮在 iOS 15–18.3 无响应，其余请假流程不受影响，属登记过的 P3 偏离 |
| 静态门禁 | `ios/tools/check-ios.mjs`、`ios/tests/full-suite.test.mjs`、`.github/workflows/ios-build.yml` | F10 扩展白条 A 方案断言；新增 **F11**（无头核对）与 **F12**（请假/上传/定位资产）；门禁 **44→46**，测试与 workflow 步骤名同步 |

- 本轮同时修掉 task-22 只读复核的 A1（无头挂载窗口内静默失败 → 自动核对空转 90s）、A2（iframe 定位回填改挂 `window.top`）、A2 回归（主 frame 与 iframe 统一到 `root.__jiangshuiGeoCallbacks` 一张注册表，task-25）、A3（后台 `presentForUser` 守卫）：`attachHeadless` 返回 Bool，`prepareHostForRead` 失败后 0.4s 重试一次；`presentForUser` 要求 `applicationState == .active`，`isUserVisible` 移到 present completion 内置位。
- 本机结果：`gen-pbxproj` 幂等（**Swift 35 / 资源 3 / web folder reference 1 / 文件引用 41**）；`check-ios` **46/46**；`node --test ios/tests` **52 pass**；`node --test tests/*.test.mjs`（web）**282 pass**；E1/E2 仍 **182 文件 / `1ea23688…18cbdd`**。
- 已证明：白条层级、无头容器属性、`needLogin` 唯一转可见入口、请假状态机标志与定位 origin 校验都在源码里，且 pbxproj 收录了 35 个 Swift / 3 个资源 / web folder reference。
- **未证明**：白条在真机是否与状态栏同色、无头 WebView 是否被 WebKit 降频或暂停、请假十步在真实 xgxt 上是否收敛、定位 shim 在真实页面能否授权回包、附件按钮在 iOS 18.4+ 的真实行为 —— 全部要 CI 重编 + 真机复跑（清单见 `docs/P2-SCHOOL-READ.md` §11 与 `docs/SHELL-NOTES.md`）。

## 第 13 轮：给全部 Swift 源码加中文注释（2026-11-01，不影响编译）

起因：用户要求「把源码注释一下，哪一块实现什么的，通俗明白，电脑小白也能看懂」。

| 类别 | 范围 | 结果 |
| --- | --- | --- |
| App/ 4 个 + Web/ 5 个 | implementer-shell | +188 行注释 |
| Services/ 16 个（含 ThemeController） | implementer-services | +330 行注释 |
| School/ 核心 4 个（ReadController / WebViewHost / Provider / URLPolicy） | implementer-school | +235 行注释 |
| School/ 其余 6 个 | swift-controller-auditor | +197 行注释 |
| **合计** | **35 个 Swift** | **+950 行注释，0 删除、0 修改** |

- 编写标准：每文件顶部【这个文件干什么 / 什么时候会用到它 / 它和谁配合】；类与关键函数用 `///` 写「做什么、参数、失败会怎样」；常量旁写来源与影响（90s/60s/200ms/450 次/2048 字符/278616 等）。
- 约束（全部满足）：只新增整行 `//` 或 `///`；不改/不删/不重排任何已有行；无块注释；不插进多行语句中间；未动 `project.yml`/pbxproj/Info.plist/tests/tools。
- 新增文档 `docs/CODE-MAP.md`（209 行，写给不懂编程的人：构造、目录地图、读课表九步、请假七步、逐文件一句话、数据存放位置、改码 6 条规矩、名词小抄、注释覆盖情况）。
- 本机结果：`git diff -U0` 删除行 0、非注释新增行 0；`gen-pbxproj` 幂等（pbxproj 无变化，Swift 35 / 引用 41）；`check-ios` **46/46**；`node --test ios/tests` **52 pass**；`node --test tests/*.test.mjs`（web）**282 pass**；E1/E2 仍 **182 文件 / `1ea23688…18cbdd`**。
- **未证明**：注释不改变语义，但本轮仍未在 Xcode 下编译；下一次 CI run 是这批注释的首次真实编译。

## 第 14 轮：上课提醒「预排 + 到期清理 + BGTask」（2026-11-03，尚未编译）

起因：此前只有在 App 前台 `reconcile()` 命中的课才会发 1 秒通知；退后台或杀进程后没有任何提醒。

| 类别 | 文件 | 内容 |
| --- | --- | --- |
| 预排 | `Services/ClassReminderService.swift`（398 行） | reconcile 遍历未来 7 天事件，未关闭且 `expiresAt > now` 的全部排期；`showAt > now + 1000` 走 `UNCalendarNotificationTrigger`（Asia/Shanghai），已进窗口走 1 秒 interval；同一 identifier 先 removePending 再 add；指纹去掉会随时间变化的 phase（beta9），避免反复重发 |
| 到期清理 | `Services/ClassReminderService.swift` | 新增 `cleanupExpiredDelivered`：按 posted 账本（expiresAt + 3 天）反推 expiresAt，过期即 `removeDeliveredNotifications`；`clearAll` 连已投递的课程通知一起取消 |
| 权限时序 | `Services/SystemNotificationService.swift` | `NotificationAuthorizationCache.whenKnown` 排队等待首次异步授权结果；权限未知时 reconcile 只清理、不取消/不重排，回调后主线程补跑，避免启动首帧误删全部通知 |
| BGTask | `App/JiangshuiApp.swift`（132 行）、`App/AppEnvironment.swift`、`App/RootView.swift` | 注册 `cn.local.tomorrow.class-reminder` 的 `BGAppRefreshTask`；启动/回前台 reconcile，退后台 submit 下一次；handler 内 expirationHandler + 幂等 setTaskCompleted |
| 门禁 | `ios/tools/check-ios.mjs`、`ios/tests/reminder-schedule.test.mjs`、`ios/tests/index.mjs`、`ios/tests/pbxproj.test.mjs` | check-ios 适配 Widget 第二 target（A5/A6 按 target 对应 Sources，A7/A8 取主 target，A11 检查扩展结构）；D4 扩展为「两个登记 id + 注册/预排/到期清理代码在位」；检查项 **46→47**；新增 5 条提醒排期测试；pbxproj 测试支持共享文件去重 |
| 文档 | `docs/CODE-MAP.md`、本文件 | 补第 12 节「上课提醒怎么排」与本轮记录 |

- 本机结果：`gen-pbxproj` 连跑两次，pbxproj sha256 均为 `6d58856abf9bbded5989d39ac83703f85db0f4d23c1662102c187e72f244ea8d`（幂等）；输出为主 App Swift 36 个（其中共享 1 个）/ 资源 3 个 / 文件引用 46 条，Widget Swift 3 个 / iOS 16.1。`check-ios` **47/47**；`node --test ios/tests/` **59 pass**；`node --test tests/*.test.mjs`（web）**282 pass**；E1/E2 仍 **182 文件 / `1ea23688…18cbdd`**。
- **未证明**：Swift 未在 Xcode 下编译；`UNCalendarNotificationTrigger` 在真机的到点触发/通知中心展示、`removeDeliveredNotifications` 是否清干净、首次授权回调后补排是否及时、BGAppRefreshTask 是否被系统调度、Widget target 与主 App 的共享文件编译 —— 全部要 CI/simulator + 真机复跑。**BGTask 不保证准时，可能延后或不执行**。

## 第 15 轮：上课实时活动（Live Activity）+ pending 60 条上限（2026-11-03，尚未编译）

起因：task-33 要求到点不仅发通知，在 App 活着时同时显示实时活动；实时活动超过“上课开始 + 10 分钟”自动删除，且不能影响通知主路径。

| 类别 | 文件 | 内容 |
| --- | --- | --- |
| 实时活动 | `Services/ClassActivityController.swift`（新增 160 行） | `@available(iOS 16.1, *)` 单例；检查 ActivityAuthorizationInfo；active 立即 start、future 用主线程 Timer 等到 showAt；`Activity.request` 后立即 `end(using:dismissalPolicy:.after(start+10min))`，不依赖 T+10 时 App 活着；失败只写 `import-error kind=other http-status=0`；`endAll` 清 Timer/活动/账本 |
| 提醒对接 | `Services/ClassReminderService.swift`（398 行） | 候选事件按 showAt 升序、最多 60 条；调用活动 controller；超 60 条写白名单诊断；`clearAll` 调 `endAll`；`Event` 从 private 改为 internal 供 controller 引用 |
| Widget | `JiangshuiWidgets/Shared/ClassActivityAttributes.swift`、`JiangshuiWidgets/ClassActivityWidget.swift` | 已有共享 Attributes 与锁屏/灵动岛界面；无关闭按钮（本轮未改） |
| 配置 | `Resources/Info.plist` | `NSSupportsLiveActivities=true` 已在位，本轮未重复添加 |
| 门禁 | `tools/check-ios.mjs`、`tests/full-suite.test.mjs`、`tests/reminder-schedule.test.mjs`、`tests/live-activity.test.mjs`（新增）、`tests/index.mjs` | D4 改为检查 candidates/prefix(60)；新增 **G1** 实时活动断言；检查项 **47→48**；测试 59→64 |
| 文档 | `docs/LIVE-ACTIVITY.md`（新增）、本文件 | 写清通知必达/活动尽力、T+10、用户可划、杀进程无法启动、ActivityKit 部署目标与 .appex 签名风险 |

- 本机结果：`gen-pbxproj` 连跑两次，pbxproj sha256 均为 `72515764c8d40d465f1743b942346f6933279e05f7d2b1b95de22568ae7fc338`（幂等）；输出为主 App Swift 37 个（其中共享 1 个）/ 资源 3 个 / 文件引用 47 条，Widget Swift 3 个 / iOS 16.1。`check-ios` **48/48**；`node --test ios/tests/` **64 pass**；`node --test tests/*.test.mjs`（web）**282 pass**；E1/E2 仍 **182 文件 / `1ea23688…18cbdd`**。
- **未证明**：Swift 未在 Xcode 下编译。ActivityKit 的 `Activity.request`（iOS 16.1 是**同步 throws**，不是 async；`end` 才是 async） / `Activity.activities` / `update(using:)` / `end(using:dismissalPolicy:)` / `.after(_:)` 仅按 iOS 16.1 API 书写；主 target 仍是 15.0，`import ActivityKit` 在 15.0 target 下是否报警需 Xcode 15.4 首次编译确认；免费 Apple ID 侧载 .appex 需单独签名。真机到点显示、T+10 自动消失、用户长按结束、关闭实时活动开关、杀进程后仅通知等全部待真机复跑（清单见 `docs/LIVE-ACTIVITY.md` §9）。

## 尚未取得的证据（不要当成已通过）

| 项 | 需要什么 |
| --- | --- |
| 左边缘右划手势能否触发、与 WKWebView 滚动/翻页是否冲突 | 真机 + 签名（`simctl` 只能截图，无法注入手势） |
| 真机上的 `__dsjOnBack` 返回键交互、后台任务回调 | 真机 + 签名（模拟器已覆盖启动 / 渲染 / 桥回包） |
| LocalServer 端口回退 47851→47860 是否被 ATS 放行 | 同上（真机或模拟器） |
| EventKit / UNUserNotificationCenter / BGTaskScheduler / Keychain | 真机 + 签名 |
| P2 教务登录/读取/假条同步的实际结果 | 真机 + 学校账号（Sideloadly 免费签名即可，清单见 `docs/P2-SCHOOL-READ.md` §7） |
| 签名、Archive、TestFlight | Apple 开发者账号（¥688/年）+ 证书 |

## 如何在 CI 上复现

推送任意改动到 `ios/`、`web/` 或本工作流，然后看 Actions 的 **Annotations**（失败时）或 Job summary（成功时含环境、每步退出码、产物大小）。
本地等价命令（需 macOS + Xcode）：

```bash
cd ios && node tools/gen-pbxproj.mjs && node tools/check-ios.mjs && node --test tests/
xcodebuild build -project Jiangshui.xcodeproj -target Jiangshui -configuration Debug \
  -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO SYMROOT=$PWD/build-out/build
```
