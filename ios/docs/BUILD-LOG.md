# 编译记录（BUILD-LOG）

本文件记录 iOS 工程**真实编译**的证据。凡标「通过」的行，都有 CI 日志或本机日志作为依据；没有日志的结论不写在这里。

## 为什么用 CI 编译

开发机是 Windows，没有 Xcode / swiftc，也无法在虚拟机里跑 macOS 模拟器（无 Metal）。
GitHub Actions 的 macOS runner 提供 Xcode，用它做「能不能编过」的判定；实际镜像与编译器版本随仓库可用的 runner 标签变化（2026-11-24 公开仓实测 `macos-15-intel` / Xcode 16.4；早期是 `macos-14` / Xcode 15.4），**以每次 artifact 里的 `env.txt` 为准**。
**CI 能编译、打包并在模拟器启动截图；仍不能替代真机与学校账号运行。**

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
6. **基线口径**：`check-ios` 的 E1/E2 不再冻结固定文件数或单一哈希，改为 `ios/tools/shared-layer-manifest.json` 逐文件记录 `git ls-files -c -o --exclude-standard -- web android` 的 blob（排除 `*.apk`/`*.zip`/`build/`/`.gradle/`），只报 missing/extra/changed。当前清单 186 个文件；`web/`、`android/` 有合法改动后重跑 `node ios/tools/check-ios.mjs --write-shared-manifest`（见第 16 轮）。

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

第 10 轮当时唯一 warning 是 `ONLY_ACTIVE_ARCH=YES requested with multiple ARCHS ...`（不签名、多架构构建的无害提示）。**第 18 轮换到 Xcode 16.4 后已不止这 1 条**（19/17/9 行，见上）。

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

## 第 16 轮：门禁换代（web v1.5.0：45 action fixture + 共享层 manifest）（2026-11-24，尚未编译）

起因：`web/` 已同步公开仓 v1.5.0（测试 282→391），桥接契约从 1.3.1 的 35 action 扩展到 45 个（MUST 35 + OPTIONAL 10）；同时旧的「冻结 182 文件 / 单一哈希」基线无法表达合法的新增与逐文件变更，需要换成可审计的清单。

| 类别 | 文件 | 内容 |
| --- | --- | --- |
| action 契约 | `ios/tests/fixtures/bridge-actions.json`（新增，复制自已核对的公开仓 fixture，28290 B） | v0-2026-11-18 权威清单：45 个 action、level/webUsage/payload/response、8 个 callback |
| 门禁 B 组 | `tools/check-ios.mjs` | B1–B5 改为 fixture 45 模型：B1 校验 fixture 与 contractVersion、契约 §3 命中 1.3.1 legacy 35；B2 Android 精确匹配 legacy/目标 profile；B3 iOS 45 个 case 无缺无多；B4 MUST 35 不得降级、OPTIONAL 10 恰好登记一次；B5 iOS 全序 + Android MUST 子序列 |
| 门禁 E 组 | `tools/check-ios.mjs`、`tools/shared-layer-manifest.json`（新增，186 文件） | E1/E2 改为 `git ls-files -c -o --exclude-standard` + `git hash-object` 的逐文件 blob 清单，只报 missing/extra/changed；新增 `--write-shared-manifest` 复现命令；内置 git 路径回退（PATH / DSH / MSYS / Git for Windows） |
| 门禁 F8 | `tools/check-ios.mjs` | 换代到 P3：状态机四阶段、请假/销假/续假三表单（278616/278615/278618，pageEnc 分键）、`LeaveRecordParser` 拒绝词表、`LeaveSyncCoordinator` 请假优先 + id 去重 + 15s watchdog + 续假失败只写日志、返回回调一次性、`cancelRecordSync` |
| 测试 | `tests/actions.test.mjs`、`tests/baseline.test.mjs`、`tests/full-suite.test.mjs` | actions 改为 fixture 45 + 契约 legacy 35 + Android profile；baseline 改为 manifest（formatVersion / 无冻结字段 / E1 集合 / E2 逐文件 blob）；full-suite 仍 48 项 |
| 文档/CI | `.github/workflows/ios-build.yml`、`ios/tools/mac-first-run.sh`、`README-iOS.md`、`IOS-PORT-CONTRACT.md`、`AUDIT.md`、本文件 | 步骤名 66 项、门禁 48 项；契约 §3 增补 OPTIONAL 10、版本 1.5.0/64、manifest 口径；AUDIT 同步 B/E/F8 与测试数 |

- 本机结果：`gen-pbxproj` 连跑两次，pbxproj sha256 均为 `b1cfa9e26a82765e555f434a8ad02e7668f3404aaad3f3503d306f98741b3d8b`（幂等）；输出为主 App Swift 41 个（其中共享 1 个）/ 资源 3 个 / 文件引用 51 条，Widget Swift 3 个 / iOS 16.1。`check-ios` **48/48**；`node --test ios/tests/` **66 pass**；`node --test tests/*.test.mjs`（web v1.5.0）**391 pass**；共享层 manifest 186 文件、E1/E2 全绿。
- 变异测试（临时副本，已清理）：删 `case "calendarSync"` → B3/B4 红；把 MUST 的 `calendarSync` 改成 `optionalActions.handle` → B4 红；fixture 改名 `calendarSync` → B1/B3 红；删 `case "cancelRecordSync"` → F8 红；`fetchCancel` 改用 `leaveFormID` → F8 红。
- **未证明**：Swift 未在 Xcode 下编译；45 action 的 OPTIONAL 降级层与 web v1.5.0 的真实交互、请假/销假/续假在真实学校站点的回包、manifest 在 CI 干净 checkout 中的 git 行为，均需 CI + 真机验证。

## 第 17 轮：同步公开仓 v1.5.0（web 41 文件 + 契约 45 + 销假/续假）（2026-11-24，尚未编译）

> 编号说明：第 15 轮已被「实时活动」占用、第 16 轮是门禁换代；本轮产品同步的代码其实先于门禁换代落盘，但文档按登记顺序顺延为第 17 轮，避免覆盖历史记录。

起因：公开仓 `fuwuqihmr/jiangshui-schedule` 发布 v1.5.0，本地 `web/` 还是 1.3.1 快照。iOS 必须跟上游保持同一套业务逻辑（销假/续假、45 action 契约），否则网页层会按旧契约调用原生。

| 类别 | 文件 | 内容 |
| --- | --- | --- |
| 共享层 | `web/`（整包替换） | 1.3.1 快照 → v1.5.0，41 个文件；`find web -type f \| sort \| xargs sha256sum \| sha256sum` = `5c2648ea908ccabdfbe5ca702ddc6f7b97fe32eb7aabce986fb108fc8e86fcb1`；web 测试 282→391 |
| action 契约 | `tests/fixtures/bridge-actions.json`、`Web/BridgeDispatcher.swift`、`Web/OptionalBridgeActions.swift`（新增） | 35→45（MUST 35 + OPTIONAL 10）；`cancelRecordSync` 真调销假表单 278615；补两个 MUST 回调 `onNativeProgress` / `onLeaveServiceReturn`；OPTIONAL 10 由降级层回 unsupported 信封 |
| 教务读取 | `School/LeaveRecordParser.swift`（新增）、`School/LeaveSyncCoordinator.swift`（新增）、`School/SchoolLeaveServiceReturnTracker.swift`（新增） | 请假/销假/续假三表单 278616/278615/278618，`pageEnc` 按表单分键；解析含拒绝状态词表；同步时请假优先、按 id 去重、15s watchdog；续假失败只写 `leave-renew-sync failed` 诊断、**不回 NEED_RENEW_SESSION**；从请假页返回只回调一次 |
| 接线 | `School/SchoolProvider.swift`、`Services/ServiceProtocols.swift`、`Web/BridgeDispatcher.swift` | `onProgress` / `onLeaveServiceReturn` / `cancelRecordSync` 进协议与路由；`leaveRecordSync` 走 `LeaveSyncCoordinator` |
| 版本 | `project.yml`、`tools/gen-pbxproj.mjs`、`Jiangshui.xcodeproj/project.pbxproj` | `MARKETING_VERSION` **1.5.0**、`CURRENT_PROJECT_VERSION` **64**（对齐 Android v1.5.0 / versionCode 64） |
| 门禁/文档 | `tools/check-ios.mjs`、`tests/`、本文件、`README-iOS.md`、`IOS-PORT-CONTRACT.md`、`AUDIT.md` | B1–B5 换 45 action fixture、E1/E2 换共享层 manifest（186 文件）、F8 换 P2/P3 断言；检查项仍 48、测试 66（细节见第 16 轮） |

- 本机结果：`gen-pbxproj` 连跑两次，pbxproj sha256 均为 `b1cfa9e26a82765e555f434a8ad02e7668f3404aaad3f3503d306f98741b3d8b`（幂等）；输出为主 App Swift 41 个（其中共享 1 个）/ 资源 3 个 / 文件引用 51 条，Widget Swift 3 个 / iOS 16.1。`check-ios` **48/48**；`node --test ios/tests/` **66 pass**；`node --test tests/*.test.mjs`（web v1.5.0）**391 pass**。
- **未证明**：Swift 未在 Xcode 下编译；v1.5.0 的 45 action 与网页层真实交互、销假/续假在真实学校站点的回包、OPTIONAL 降级层的 UI 表现，都要 CI 编译 + 真机 + 学校账号复跑。

## 第 18 轮：v1.5.0 首次真实编译通过（公开仓分支 ios-ci）（2026-11-24）

起因：本地 `HEAD 4251669` 同步公开仓 v1.5.0（web 41 文件、契约 45、请假/销假/续假）后仍只有 Windows 静态检查。本轮用公开仓的 GitHub Actions 跑一次真实 Xcode 编译，验证 41 个 Swift、Widget 扩展、ActivityKit、Info.plist 变量展开与未签名 IPA 打包。

| 运行项 | 值 |
| --- | --- |
| 仓库 / 分支 | `fuwuqihmr/jiangshui-schedule` / `ios-ci` |
| commit | `823c522` |
| run id | [`45417661000`](https://github.com/fuwuqihmr/jiangshui-schedule/actions/runs/45417661000) |
| 结论 | success；18 个步骤全部 success（含 GitHub 的 Set up job） |
| runner | workflow 申请 `macos-14`，公开仓实际分配到 `macos-15-intel`；annotations 原文 `The configuration 'macos-14-arm64-us-default' is not supported` |
| 实际环境 | macOS 15.7.9（24G830）/ Xcode 16.4（16F6）/ Swift 6.1.2 / Node v20.20.2 |
| 产物 | `jiangshui-unsigned-ipa`（3,397,722 B）+ `ios-build-logs`（全部日志与截图） |

### 18.1 八个退出码

| 步骤 | rc 文件 | 值 |
| --- | --- | --- |
| 重新生成 Xcode 工程 | `rc-gen` | 0 |
| 静态门禁 48 项 | `rc-check` | 0（48/48，末行「全绿，退出码：0」） |
| 校验器自测 66 项 | `rc-test` | 0（`# tests 66 / # pass 66 / # fail 0`） |
| Debug 模拟器编译 | `rc-build` | 0（`** BUILD SUCCEEDED **`） |
| Release 模拟器编译 | `rc-release` | 0（`** BUILD SUCCEEDED **`） |
| Release 真机编译 | `rc-device` | 0（`** BUILD SUCCEEDED **`） |
| 打包未签名 IPA | `rc-ipa` | 0 |
| 模拟器启动截图 | `rc-sim` | 0（该步 `continue-on-error`，不参与最终判定；本轮通过） |

### 18.2 产物核对

| 核对项 | 实测值 |
| --- | --- |
| `gen.log` | 主 App Swift **41 个**（其中共享 1 个）/ 资源 3 个 / 文件引用 51 条；Widget Swift 3 个 / 资源 0 个 / iOS 16.1 / bundle `cn.local.tomorrow.widgets`；`.appex` 经 Embed App Extensions 嵌入；web folder reference 1 个 |
| 三次 xcodebuild | `error: ` 均为 **0**，尾行均为 `** BUILD SUCCEEDED **`；warning 行数：Debug 19 / Release 17 / 真机 9（详见 18.3，**不是只有 1 条**） |
| IPA | `Jiangshui-unsigned.ipa` **3,397,722 B**；sha256 `b9282267410ed82fb9c1386efe3c879b16aedb5a209d20b7b69a6f05a6e62706` |
| 架构 | `lipo -info` = `Non-fat ... architecture: arm64`（无 x86_64） |
| 主 Info.plist | `cn.local.tomorrow` / **1.5.0** / **64** / `MinimumOSVersion 15.0` / `NSSupportsLiveActivities true` / 后台 fetch+processing / 两个 BGTask id |
| Widget Info.plist | `cn.local.tomorrow.widgets` / 1.5.0 / 64 / `MinimumOSVersion 16.1` / `NSExtensionPointIdentifier = com.apple.widgetkit-extension` |
| 载荷 | zip 共 **58 条目**（含 `Payload/` 根；`Payload/` 下 57 项 = 51 文件 + 6 目录），含 `Payload/Jiangshui.app/PlugIns/JiangshuiWidgetsExtension.appex` 与 41 个 `web/` 文件 |
| 主二进制 | `Payload/Jiangshui.app/Jiangshui` **1,364,704 B** |
| 签名 | `Payload/Jiangshui.app/_CodeSignature` **不存在**（未签名，符合预期） |
| 截图 | `simulator-1-first-launch.png` 344,264 B（用户协议页，卡片式、无浮层压标题，协议版本 2026-10-17.1）；`simulator-2-main.png` 446,016 B（权限面板只剩「通知 · 未开启」，背景为页面 CSS 模糊效果） |
| 模拟器 | iPhone 16 Pro / iOS 18.5；`simulator.log` 有 `local: 127.0.0.1:47851 ... ready`，WebKit 正常加载，进程未崩溃 |

符号命中（对主二进制做 ASCII 字符串扫描，等价于 `strings | grep`；表中均为出现次数，`onLeaveServiceReturn` 17 次分布在 15 条 ASCII 字符串中）：

| 符号/常量 | 命中 |
| --- | --- |
| `LeaveSyncCoordinator` | 94 |
| `cancelRecordSync` | 10 |
| `onLeaveServiceReturn` | 17（15 条字符串） |
| `SchoolGeolocationBridge` | 41 |
| `SchoolLeaveSessionController` | 61 |
| `SchoolFilePicker` | 50 |
| `LeaveRecordParser` | 15 |
| `278615` / `278618` | 各 1 |

复现命令（Mac；本文数字已在 Windows 上对 artifact 独立复算）：

```bash
shasum -a 256 Jiangshui-unsigned.ipa
plutil -p Payload/Jiangshui.app/Info.plist
unzip -l Jiangshui-unsigned.ipa | tail -1          # 58 entries
lipo -info Payload/Jiangshui.app/Jiangshui        # Non-fat, arm64
strings -a Payload/Jiangshui.app/Jiangshui | grep -c LeaveSyncCoordinator
strings -a Payload/Jiangshui.app/Jiangshui | grep -o onLeaveServiceReturn | wc -l
```

### 18.3 编译警告（0 error，但不是只有 1 条）

Xcode 16.4 / Swift 6.1.2 在 `SWIFT_VERSION=5.0` 下把下列问题降级为 warning；**切到 Swift 6 语言模式前必须处理**：

- `Jiangshui/School/LeaveRecordsService.swift:195`：非隔离上下文访问 main actor 的 `WKWebsiteDataStore.default().httpCookieStore` / `getAllCookies`（3 条，其中 2 条注明 Swift 6 下会变 error）。
- `Jiangshui/School/LeaveRecordsService.swift:199`：non-sendable 函数值转 `@MainActor @Sendable` 闭包，可能引入数据竞争。
- `Jiangshui/School/LeaveSyncCoordinator.swift:92` 与 `:136`：在 `@Sendable` 闭包捕获 non-sendable 的 `ContinuationGate<JSONObject>` / `ContinuationGate<JSONObject?>`。
- `Jiangshui/School/SchoolProvider.swift:191`：同类 non-sendable 闭包转换；`:289`：`using '_' to ignore ... is redundant`。
- `ONLY_ACTIVE_ARCH=YES` 多架构警告（Debug，两个 target 各 1 条）；`Metadata extraction skipped. No AppIntents.framework dependency found`（Xcode 正常提示）。

warning 行数在 Debug/Release/真机三份日志里分别是 19/17/9，差异来自多架构与 target 数量；去重后是上述几类。**不要把它写成「唯一 warning 是 ONLY_ACTIVE_ARCH」**。

### 18.4 证明了什么 / 没证明什么

**已证明**：

- v1.5.0 的 41 个主 App Swift（含 1 个共享 Attributes）与 3 个 Widget Swift 能在 Xcode 16.4 / Swift 6.1.2 下编译；Debug、Release、真机 iphoneos 三种配置均 0 error / BUILD SUCCEEDED。
- Widget Extension 能编译并作为 `.appex` 嵌入主 App；ActivityKit 的 `@available(iOS 16.1, *)` 门槛在 target 15.0 下可编译。
- Info.plist 变量展开正确（1.5.0 / 64）、`NSSupportsLiveActivities` 与 Widget `NSExtension` 生效；`web/` folder reference 与 `PrivacyInfo.xcprivacy` 被打进 IPA。
- 未签名 IPA 可产出，arm64、含 Widget 与 41 个 web 文件。
- App 能在 iPhone 16 Pro / iOS 18.5 模拟器启动；首启同意页与主界面（权限面板仅通知）可渲染，loopback 服务实际监听 `127.0.0.1:47851`。

**仍未证明**：

- **未签名**：IPA 没有 `_CodeSignature`，不能直接装真机；免费 Apple ID 重签后能否安装、Widget/Keychain/后台任务在真机是否正常，均未验证。
- **未真机**：模拟器不能证明 EventKit、UNUserNotificationCenter、BGTaskScheduler、Keychain、文件导入导出、Live Activity 锁屏/灵动岛、上课提醒到点触发。
- **未跑学校账号**：P2 登录 → 恢复 → 读课表 → 假条同步，P3 请假深链/销假/续假/定位，全部没有真实学校站点回包；上传附件在 iOS 18.4 以下仍按设计无响应。
- **未覆盖 iOS 15/16/17**：只在 iOS 18.5 模拟器启动；iOS 15 的 `requestAccess(to:)`、iOS 16 的通知 API、iPad 分屏均未跑。
- **warning 未清零**：上述 Swift 6 并发问题当前只是 warning；若未来升级 `SWIFT_VERSION=6.0` 会变成 error。
- **App Store 审核**：ATS 例外、PrivacyInfo、4.2/5.1 口径仍未提交审核。

### 18.5 本轮踩的坑

1. **公开仓不支持 workflow 里的 `macos-14`**：实际分配到 `macos-15-intel`，Xcode 是 16.4（不是本地旧文档假设的 Xcode 15.4）。以后判断编译器版本以 artifact 里的 `env.txt` 为准。
2. **warning 统计口径**：`grep -c "warning:"` 会把同一问题的多 target/多架构重复行都算进去；本次是 19/17/9 行、去重后 8 类（7 类 Swift 诊断 + ONLY_ACTIVE_ARCH；Metadata 是正常提示），不能当「1 条」。
3. **`rc-sim` 不参与最终判定**：workflow 的模拟器步骤是 `continue-on-error`，最终「判定」只汇总 gen/check/test/build/release/device/ipa；本轮 rc-sim 恰好为 0，但不能把模拟器失败当成 CI 失败。
4. **载荷条目 58 vs 57**：`unzip -l` 把 `Payload/` 根算 1 条；`Payload/` 下实际是 57 项（51 文件 + 6 目录）。

## 第 19 轮：补齐考试字段透传（+19 行，未编译验证，2026-11-24）

起因：公开仓 v1.5.0 的 `web/school-reader.js` 已经在读课表时同源抓考试列表（`/jsxsd/xsks/xsksap_list`），但 iOS 的 `handleReadResult` 只组装 `rows/totalWeeks/semesterId/studentProfile`，网页拿不到考试数据。本轮只补原生透传，不碰考试解析与展示。

### 19.1 改动

| 文件 | 改动 |
| --- | --- |
| `ios/Jiangshui/School/SchoolReadController.swift` | +19 行：payload 组装后追加考试三字段；新增 `examErrorKinds` 五类白名单 |
| `ios/tests/exam-passthrough.test.mjs` | 新增 6 条静态回归测试（数组收窄、非空守卫、白名单归一、未知字段、写入顺序） |
| `ios/tests/index.mjs` | 引入新测试文件，`node --test ios/tests/` 从 66 项变 72 项 |
| `ios/tools/check-ios.mjs` | F8 内新增第 8 节「考试字段透传」，检查项总数仍 48 |
| 文档/CI | workflow、mac-first-run、README、AUDIT、P2 文档同步测试计数 66→72 |

### 19.2 透传规则

| 字段 | 规则 |
| --- | --- |
| `exams` | 仅当 `result.optArray("exams")` 是 JSON 数组才写入；非数组/缺失不写 |
| `examFetchedAt` | `optString` 后仅非空才写入 |
| `examError` | 仅非空才写入；必须在 `http/session/timeout/format/other` 内，白名单外归 `other` |
| `examHttpStatus` | **不透传**（读取脚本仍会带，原生有意忽略） |

失败时 `school-reader.js` 只带 `examError`（不带 `exams/examFetchedAt`），网页据此保留旧快照；原生不做业务解析。

### 19.3 本机结果

- `gen-pbxproj` 连跑两次，pbxproj sha256 均为 `b1cfa9e26a82765e555f434a8ad02e7668f3404aaad3f3503d306f98741b3d8b`（幂等）；输出主 App Swift 41 个（共享 1 个）/ 资源 3 个 / 文件引用 51 条，Widget Swift 3 个 / iOS 16.1。
- `check-ios` **48/48 ok，fail 0**；F8 第 8 节校验 payload 键集合、三字段守卫、白名单、未知字段与 persist/finish 顺序。
- `node --test ios/tests/` **72/72 pass**（新增 6 条）；`node --test tests/*.test.mjs`（web v1.5.0）**391/391 pass**。
- 共享层 manifest 仍为 186 文件，E1/E2 全绿。
- 变异：把 `if let exams = result.optArray("exams") …` 改成 `payload["exams"] = result["exams"]` 后，F8 报「exams 未用 optArray 做数组收窄后写入」、`exam-passthrough.test.mjs` 2 条失败；临时副本已清理，未改被测文件。

### 19.4 未证明

- 本轮 +19 行**尚未重新编译**（本机无 Xcode），也没有真机或学校账号数据；只能证明静态形状与回归测试。
- 考试接口的字段名、分页上限（20 条/页、最多 5 页）与失败映射来自 `web/school-reader.js` 现状，未用真实教务响应复核。
- `examError` 之外是否需要透传 `examHttpStatus` 仍待产品/前端决定；当前按有意忽略处理。

## 第 20 轮：更换原创图标（版权原因，2026-11-24）

起因：用户确认旧图标（卡通形象）有版权风险，选定 task-48 产出的原创候选 A「课表网格」。本轮只换静态资源与文档，不改 Swift / JS 逻辑；源图是 `D:/JS/work/icon-candidates/A-1024.png`（1024×1024 RGB，生成脚本同目录 `generate_icons.py`）。

### 20.1 改动

| 位置 | 改动 |
| --- | --- |
| `ios/Jiangshui/Resources/AppIcon-1024.png` | 换成 A 图 1024×1024 RGB（57,747 B），不再是从 128 放大的旧图 |
| `ios/Jiangshui/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 同上；Contents.json 未动（仍是 Xcode 15 单尺寸 1024 槽） |
| `web/assets/app-icon.png` | 128×128 RGBA 圆角磁贴（圆角约 22%，四角透明，7,193 B）；页面里 44/36/38 px 三处引用不变 |
| `android/.../drawable-nodpi/ic_launcher_foreground.png` | 432×432 RGBA 透明底，白课表卡 + 3×2 彩格；内容包围盒 204×198、对角线 284.3 px，落在 66% 安全圆（直径约 285 px）内（7,269 B） |
| `android/.../mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png` | 48/72/96/144/192 RGBA 圆角方形磁贴，四角透明，与 iOS 同构图 |
| `android/.../drawable/ic_icon_background.xml` | 自适应图标背景 `#E8F6FF` → `#0F1B2D`；`mipmap-anydpi-v26/ic_launcher.xml` 与 Manifest 未改 |
| `ios/tools/shared-layer-manifest.json` | `--write-shared-manifest` 重算，仍 186 个文件；9 个 web/android 文件的 blob 更新（含 `web/app.mjs` 旧文案替换） |
| `ios/README-iOS.md`、`docs/SHELL-NOTES.md`、`docs/MAC-RUNBOOK.md`、`docs/INTEGRATION-REPORT.md`、本文件 | 同步图标来源、尺寸、哈希与「actool 待 CI」口径 |

口径：iOS 保留方形 1024 图，由系统加圆角蒙版；web 与安卓传统图标是自带深色底的圆角磁贴；安卓自适应前景只画白色课表卡与彩格，背景由 `ic_icon_background` 提供。

### 20.2 本机结果

- `gen-pbxproj` 连跑两次，pbxproj sha256 均为 `b1cfa9e26a82765e555f434a8ad02e7668f3404aaad3f3503d306f98741b3d8b`（幂等）；输出主 App Swift 41 个（共享 1 个）/ 资源 3 个 / 文件引用 51 条，Widget Swift 3 个 / iOS 16.1。
- 图标尺寸/模式：iOS 两处 1024×1024 **RGB**；web 128×128 **RGBA**；安卓前景 432×432 **RGBA**；传统图标 48/72/96/144/192 **RGBA**，四角 alpha=0。
- `check-ios` **48/48 ok，fail 0**（退出码 0）；E1 仍 186 文件；E2 blob 一致，新聚合指纹 `79b5debd3096fad7b6f35fc22ed03cc3dbd275c55779ff5a3158e86251828c0d`（仅诊断，不参与判定）。
- `node --test ios/tests/` **72/72 pass**；`node --test tests/*.test.mjs`（web v1.5.0）**391/391 pass**。
- web 整包指纹（`find web -type f | sort | xargs sha256sum | sha256sum`）：`2d63a190d81c10ad99665eeeb916bb82bd8c55ab637ec5ff3c316bca78e54bdf`（41 个文件；旧值 `5c2648ea…8fcb1`）。
- 预览图：`D:/JS/work/icon-preview.png`（760×500；左到右 iOS 180 / Android 108 / web 44 实际尺寸，上浅底下深底）。

### 20.3 未证明 / 风险

- **未编译、未跑 actool**：本机无 Xcode；iOS 1024 RGB 图能否被 Xcode 16.4 的 actool 接受、生成的 AppIcon 槽位是否齐全，仍需 CI 首次编译确认。
- **安卓自适应蒙版**：只按「内容对角线 ≤ 285 px」保证进 66% 安全圆；圆形、squircle、圆角矩形等厂商蒙版的实际观感未在真机/模拟器看。
- **小尺寸可辨性**：48 px 传统图标与 34 dp 通知大图（`notification_expanded.xml` 引用前景）里的白卡与彩格会很小，未做视觉验收。
- **web 旧文案（已修）**：`web/app.mjs` 的旧 `alt` 称呼已改为 `alt="江水课表图标"`，主题说明里的旧称呼也已清掉；`grep` 该词在 `web/app.mjs` 无命中，web 测试 391 项全绿。
- 未 commit / push；图标源图在工作区 `D:/JS/work/icon-candidates/`，不在仓库内。

## 第 21 轮：图标改为与安卓最新版同款（2026-11-25）

起因：用户 2026-11-25 指令「图标用安卓端最新版的同款」。上一轮原创 A「课表网格」作废；本轮把 iOS 桌面图标换成公开仓 `fuwuqihmr/jiangshui-schedule` @ `c357bceb` 的 `assets/app-icon.png`（蓝发课表少女，1024×1024、alpha 全 255），同时把 `web/` 与 Android 图标恢复为公开仓字节，重算共享层基线。只改静态资源、`web/app.mjs` 两处文案与文档，不改 Swift 逻辑。

### 21.1 素材与三端字节

| 文件 | 尺寸/模式 | 字节 | sha256 |
| --- | --- | --- | --- |
| 公开仓源图 `assets/app-icon.png`（D:/JS/work/pub-icons/assets_app-icon.png） | 1024×1024 RGBA | 621,795 | `de68b9a70d23b53dfe7a29ea351bfe17d710b3f7adfb9f10f3b152527b21edba` |
| `ios/Jiangshui/Resources/AppIcon-1024.png` | 1024×1024 RGB | 570,279 | `805ead90e312f6ef3738cc1762bc6008cf7179714ef2217caf7cd4a1e1cdfbb6` |
| `ios/Jiangshui/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` | 1024×1024 RGB | 570,279 | 同上 |
| `web/assets/app-icon.png` | 128×128 RGBA | 18,059 | `09f4597d2c57b146d82735b0a2140370db858765b61aadcd8487963066562e02` |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher.png` | 48×48 RGBA | 3,526 | `c7cafd3da404b22bed2b2236387b5111a7aa1a10c9aca04e215703855e19b028` |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher.png` | 72×72 RGBA | 6,907 | `b31656d6e6c414fae898573235bec0b3e9020ec01cd1576f7356911a71195993` |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` | 96×96 RGBA | 11,039 | `ee85bb5d06d44bd572ac996dd4ee140327d98d8d9c99f5d00eca915e053be652` |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` | 144×144 RGBA | 21,870 | `1347678820ed7e76ca7e5b30937e97fbf3db0b2487d2e4c7c627dd2a1c5b085d` |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | 192×192 RGBA | 35,621 | `c9e9e2eec497a9f3ca2ea475e8536ae594d2746bc39aa9531c409d9fd2642904` |
| `android/app/src/main/res/drawable-nodpi/ic_launcher_foreground.png` | 432×432 RGBA | 70,842 | `ad7a1968298c65f3f101a0aeafe79d053657a4d4a6b20746224b75ed0221af5b` |
| `android/app/src/main/res/drawable/ic_icon_background.xml` | XML `#FFFFFF` | — | `f2da24b5778950dc702e0c3dc732e5925c7bd95aa4114f66dac2bc8eda050244` |
| `android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml` | 未改 | — | `cdd16fc95a28b1b4d2b2ceb84d5af7810c3a2dde5e91944d6abb110382399883` |
| `android/app/src/main/AndroidManifest.xml` | 未改 | — | `13440967e183603d828356b8200d3ed0f448ea61a0bb51d41499b2320d4f25a8` |

iOS 转换口径：用 Pillow `Image.open(...).convert("RGB")` 保存，**不缩放、不加圆角、不加背景色**；输出与素材目录里的 `app-icon-1024-white.png` 逐字节相同，两份 iOS 文件也相同。RGBA 源的 alpha 极值为 (255,255)，白底已含在图里。

文案回退：`web/app.mjs` 两处恢复公开仓 v1.5.0 原文——`alt="江水课表水宝宝图标"` 与「江水蓝取自水宝宝的蓝色与图标的浅蓝背景。」；`grep 水宝宝 web/app.mjs` 命中 2 处。web 整包指纹（`find web -type f | sort | xargs sha256sum | sha256sum`）恢复为 `5c2648ea908ccabdfbe5ca702ddc6f7b97fe32eb7aabce986fb108fc8e86fcb1`（41 个文件）。

共享层：`node ios/tools/check-ios.mjs --write-shared-manifest` 重写 `ios/tools/shared-layer-manifest.json`，仍 **186 个文件**；E2 聚合指纹 `fd4960f5f7d3ee778f26b81fb23f7683286e74aa55d683ddd688c84c8c61f9ce`（仅诊断，不参与判定）。

### 21.2 本机结果

- `gen-pbxproj` 连跑两次，pbxproj sha256 均为 `b1cfa9e26a82765e555f434a8ad02e7668f3404aaad3f3503d306f98741b3d8b`（幂等）；本轮没有新增/删除 .swift，输出仍为主 App Swift 41 个（共享 1 个）/ 资源 3 个 / 文件引用 51 条，Widget Swift 3 个 / iOS 16.1。
- `check-ios`：**48 项，ok 48，fail 0**（退出码 0）；E1 186 个文件，E2 blob 一致，聚合指纹见上。
- `node --test ios/tests/`：**72 tests / 72 pass / 0 fail**。
- `node --test tests/*.test.mjs`（web v1.5.0）：**391 tests / 391 pass / 0 fail**。
- 字节核对：iOS 两份均为 1024×1024 RGB、570,279 B、sha256 相同；web 128 与 Android 5 个 mipmap、fg、背景 XML 的 sha256 均等于公开仓给定值；`mipmap-anydpi-v26/ic_launcher.xml` 与 `AndroidManifest.xml` 未动。

### 21.3 未证明 / 风险

- **未编译、未跑 actool**：本机无 Xcode；iOS 1024×1024 RGB 图能否被 CI 的 actool 接受、AppIcon 槽位是否齐全，仍需 Mac/CI 首次编译确认。
- **未跑 Android 构建/真机**：只证明 7 个资源文件与公开仓字节一致，未在 Android 上实际渲染自适应/传统图标。
- **图标授权/版权**：素材按用户指令取自公开仓；公开仓素材的授权范围与本项目上架时的版权声明未在本轮复核，上架前需产品确认。
- `Resources/AppIcon-1024.png` 仍是散装副本，会随 bundle 重复打包约 0.57 MB；不影响运行。
- 未 commit / push。

## 第 22 轮：P0 页面服务自愈与登录等待修复的门禁/回归（2026-11-25，未编译验证）

本轮不改产品代码，只为两处 P0 修复补静态门禁、Node 回归与文档口径。产品侧 5 个文件已由实现方改好，工作树 diff 合计 +588/−119（相对 HEAD `6847573`）：

| 文件 | 行数 | 本轮门禁锁住的行为 |
| --- | --- | --- |
| `ios/Jiangshui/Web/LocalServer.swift` | 399 | `isHealthy` 健康判定、`generation` 代际守卫、`waitingTimeout=1.5`、`onInterrupted`、`stop()` 可重入、`.waiting` 超时换端口、`.failed/.cancelled` 先清理再恢复、`onFailure` 全文件唯一 |
| `ios/Jiangshui/Web/WebHost.swift` | 559 | `serverErrorTitle`、`retryPage()`（stop→start）、`startIfNeeded` 用 `isHealthy` 识别半死 listener、`loadIndex` 清错误 + 同端口去重、0.4s 自动重试一次、`didFinish` 清错误 |
| `ios/Jiangshui/App/RootView.swift` | 138 | 错误卡片显示 `serverErrorTitle`，重试按钮调用 `retryPage()` |
| `ios/Jiangshui/School/SchoolReadController.swift` | 1080 | `loginDeadline=180`、`loginPresentationWait=6`、0.5s 轮询、后台暂停/回前台续时、`xskb` 落点先 `leaveLogin()`、`reading` 在 start / 登录结果 / xskb 换代 / finish 四处复位 |
| `ios/Jiangshui/School/SchoolProvider.swift` | 399 | `onNeedsVisiblePresentation` 在无 host/presenter 时写 `login-present-skipped` 诊断，不再静默 |

### 22.1 新增门禁 F13/F14（48→50 项）

- **F13 页面服务自愈**：LocalServer 的健康判定/代际失效/1.5s waiting 换端口/failed·cancelled 先 `dropListenerLocked` 再 `recoverLocked`/单一 `onFailure`；WebHost 的错误遮罩、公开与私有 `retryPage`、`startIfNeeded` 的 `isHealthy` 分支、`loadIndex` 去重、`handleLoadFailure` 的 0.4s 单次自动重试、`didFinish` 清状态；RootView 标题与按钮；task-59 起三处导航回调（`didFinish/didFail/didFailProvisional`）都用 `isCurrentNavigation` 做对象身份校验，`currentNavigation` 为空或导航被替换时丢弃旧回调。
- **F14 登录时钟**：180s 活跃倒计时 + 6s 呈现窗口、0.5s 轮询、`LoginPhase` 三态、`reading` 在 start / 登录结果 / xskb 换代 / finish 四处复位、`needLogin` 不再只 `cancelDeadline`、退后台暂停并累计、回前台续跑、6s 失败诊断与文案、`xskb` 先 `leaveLogin`、`leaveLogin` 停表并挂 60s；task-58 起 `read()` 记录 `readingPageURL` 并推进 `readingToken`，注入/轮询/重试共用 `token == readingToken` 校验，`xskb` 分支按 URL 判断同一页直达或页面换代复位。
- 编号追加在 G1 之后，不重排历史项；full-suite 断言 50 项齐全。
- task-58/59 的页面换代（`readingPageURL`/`readingToken`）与旧导航身份校验（`isCurrentNavigation`）分别并入 F14/F13，不新增编号（仍 50 项）。

### 22.2 回归测试

新增 `ios/tests/p0-fixes.test.mjs` **10 条**（`ios/tests/index.mjs` 已接入）：

1. LocalServer 健康判定严格、`stop` 可重入并清干净；
2. LocalServer 失效先清理再恢复，`onFailure` 只回调一次；
3. WebHost 有错误标题，手动重试 stop→start，半死 listener 用 `isHealthy` 识别；
4. WebHost 加载失败每轮只自动重试一次，成功后清错误；
5. RootView 错误遮罩显示标题并调用 `retryPage`；
6. 登录时限常量正确，`reading` 在 start/read/登录结果/finish 复位；
7. `needLogin` 先取消旧截止，再启动 6 秒呈现轮询，可见后转 180 秒活跃倒计时；
8. 登录时钟只统计前台时间：切后台暂停，回前台续跑；
9. `xskb` 落点先 `leaveLogin` 再进 `reading` 守卫；
10. `leaveLogin` 停表并挂 60 秒，`finish` 只回一次且停掉登录观察者。

### 22.3 变异证据（临时 ios 副本，逐条改产品文件后还原）

| 变异 | 结果 |
| --- | --- |
| `isHealthy` 去掉 `&& port != nil` | F13 fail |
| `recoverLocked` 把 `onInterrupted?()` 移到清理之前 | F13 fail |
| `retryPage(autoRetry:)` 删掉 `server.stop()` | F13 fail |
| 自动重试 0.4s → 0.5s | F13 fail |
| `didFinish` 不清 `serverError` | F13 fail |
| `loginDeadline` 180 → 90 | F14 fail |
| `needLogin` 删掉 `startLoginClock()` | F14 fail |
| `xskb` 把 `guard reading == false` 挪到 `leaveLogin()` 前 | F14 fail |
| `isApplicationActive` 改判 `.background` | F14 fail |
| `isCurrentNavigation` 的 `currentNavigation` 为空改 `return true` | F13 fail |
| `read(attempt:token:)` 删掉 `token == readingToken` 守卫 | F14 fail |
| `xskb` 分支删掉 `readingPageURL = nil` / `readingToken += 1` 复位 | F14 fail |

十二条变异均使对应门禁红，且 `p0-fixes.test.mjs` 同步 fail；还原后 control 全绿。临时目录已删除。

### 22.4 本机结果

- `gen-pbxproj` 连跑两次，pbxproj sha256 前/中/后均为 `b1cfa9e26a82765e555f434a8ad02e7668f3404aaad3f3503d306f98741b3d8b`（幂等）；主 App Swift 41 个（共享 1 个）/ 资源 3 个 / 文件引用 51 条，Widget 3 个 / iOS 16.1。
- `check-ios`：**50 项，ok 50，fail 0**（退出码 0）。
- `node --test ios/tests/`：**82 tests / 82 pass / 0 fail**。
- `node --test tests/*.test.mjs`（web v1.5.0）：**391 tests / 391 pass / 0 fail**。
- 共享层 manifest 仍 186 个文件；本轮未改 `web/`、`android/`、产品 Swift 或 pbxproj。
- 未 commit / push。

### 22.5 未证明 / 风险

- **未编译**：本机无 Xcode，F13/F14 与 10 条测试只证明源码形状；`LocalServer` 的 `NWListener` 状态迁移、`WebHost` 的 WKWebView 重载需 CI 首次编译 + 模拟器/真机。
- **端口自愈必须真机/模拟器实测**：1.5s waiting 超时、端口被占用时 47851→47860 的回退、`stop→start` 后页面能否重新加载、错误卡片与重试按钮的实际交互，静态门禁不能替代。
- **登录时钟必须真机锁屏验证**：`willResignActive/didBecomeActive` 是否成对、180s 是否只累计前台时间、6s 未 present 的文案与诊断、`xskb` 落点是否不再白等，`simctl` 无法注入锁屏。
- 未 commit / push。

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
