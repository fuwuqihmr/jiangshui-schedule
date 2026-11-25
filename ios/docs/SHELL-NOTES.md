# iOS 壳层交付说明（implementer-shell / 契约角色 A）

TASK STATE：P1 壳层 + P2/P3 追加（顶部白条、无头核对、请假深链、定位）代码与工程文件已落盘；本机 Windows 不编译。v1.5.0 已由公开仓 `ios-ci` 真实编译并在 iPhone 16 Pro / iOS 18.5 模拟器启动（见 `BUILD-LOG.md` 第 18 轮），**真机仍未验证**。本文列出 Mac 侧必须复核的项与设计取舍。

## 0. 结论

- 路线：WKWebView 壳 + Network.framework 本地只读 HTTP 服务，页面复用仓库根 web/（folder reference，不复制源码）。
- 桥：window.Android.request shim 在 .atDocumentStart 注入 → WKScriptMessageHandler(jiangshuiBridge) → BridgeDispatcher 35 个 action 全量路由 → window.onNativeResult(id, json) 回包（恰好一次）。
- 验收边界：Windows 侧只能做静态检查（括号配平 / 行数 / action 覆盖 / pbxproj 内部一致 / 幂等）；**编译、签名、真机、EventKit/UNUserNotificationCenter 实际行为、App Review 均未验证**。

## 1. 交付物清单

| 文件（相对 ios/） | 行数 | 职责 |
| --- | --- | --- |
| Jiangshui/App/JiangshuiApp.swift | 23 | @main SwiftUI App（iOS 16），默认 AppIcon/AccentColor；init 里挂 UNUserNotificationCenter.delegate |
| Jiangshui/App/NotificationPresenter.swift | 37 | 前台通知展示 delegate：willPresent → [.banner,.sound,.list]，shared 强持有（delegate 是 weak） |
| Jiangshui/App/AppEnvironment.swift | 30 | 唯一装配处：SchoolProvider() → NativeServices(presenting:school:) → WebHost(services:) |
| Jiangshui/App/RootView.swift | 118 | UIViewRepresentable 承载 WKWebView；拒绝协议/服务失败覆盖层；scenePhase、colorScheme 转发；顶部白条 A 方案（底层 shellBackgroundColor + WebView 只落底边）；左上浮动返回键已移除（见 3.10 / 4.12） |
| Jiangshui/Web/LocalServer.swift | 271 | NWListener 只绑 127.0.0.1，端口 47851→47860；只读 HTTP/1.1（GET/HEAD）；32KB 请求头上限；逐步超时；单连接即关 |
| Jiangshui/Web/WebAssets.swift | 120 | 根 = Bundle 内 web/（url(forResource:) 取不到时回退 resourceURL）；路径穿越防护；后缀→MIME 固定表；目录补 index.html |
| Jiangshui/Web/JSBridge.swift | 128 | shim 注入脚本；WKScriptMessageHandler；BridgeTransport 回包（id 去重、JSON 编码） |
| Jiangshui/Web/BridgeDispatcher.swift | 331 | 35 action 全量 switch + 4 个免同意白名单 + default → 不支持的操作；只依赖 NativeServicesProviding |
| Jiangshui/Web/WebHost.swift | 394 | WKWebView 配置/导航白名单/新窗口、启动与前台恢复、左边缘返回手势、登出清理、presenting VC 持有、白条 A 方案（clipsToBounds + jiangshuiShellTheme + 安全区样式，见 3.10） |
| Jiangshui/Resources/Info.plist | 140 | ATS、日历/定位文案、BGTask identifiers、SceneManifest 等 |
| Jiangshui/Resources/PrivacyInfo.xcprivacy | 37 | 最小隐私清单：UserDefaults CA92.1、FileTimestamp C617.1 |
| Jiangshui/Resources/Assets.xcassets/ | 3 个 json | AppIcon.appiconset、AccentColor（#6064d8） |
| Jiangshui/Resources/AppIcon-1024.png | — | 交付要求中的散装副本（2026-11-25 已改为与安卓同款，见 4.5） |
| project.yml | 62 | XcodeGen 等价工程定义（iOS 15.0 / 1.3.1 / 48 / cn.local.tomorrow） |
| Jiangshui.xcodeproj/project.pbxproj | 430 | 由 gen-pbxproj.mjs 生成的工程文件（objectVersion 56）；**工程已收录 35 个 .swift 文件**（生成器动态扫描，含 P2/P3 新增文件） |
| tools/gen-pbxproj.mjs | 248 | 扫描目录、确定性生成 pbxproj，可重复运行（Lead 已修 $(...) 引号问题） |

生成器复现：

```
C:/Users/19890/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe ios/tools/gen-pbxproj.mjs
```

生成器当前输出：Swift 35 个 / 资源 3 个 / web folder reference 1 个 / 文件引用 41 条；连续两次运行 sha256 一致。**不要引用历史哈希**：队友新增 .swift 后会变，属预期，以 `gen-pbxproj` 复跑结果为准。

## 2. 启动与请求数据流

1. JiangshuiApp → ShellModel（AppEnvironment.swift）构造 SchoolProvider、NativeServices、WebHost。
2. RootView.onAppear → host.startIfNeeded() → LocalServer.start() 顺序尝试 47851…47860。
3. 成功 → onReady(port) → loadIndex(port:) 打开 http://127.0.0.1:port/index.html。
4. web/bootstrap.mjs → consent.mjs（consentStatus）→ app.mjs；globalThis.Android 存在即启用原生区块。
5. web 调 Android.request(id, action, payload) → postMessage → JSBridge → BridgeDispatcher → 具体服务（异步时 Task）→ window.onNativeResult(id, {"value":…}) 或 {"error":中文}。

## 3. 设计取舍（含理由）

1. **本地回环 HTTP，而不是自定义 URL scheme**：type=module、顶层 fetch、localStorage、CSP default-src self 都需要真实 http(s) origin；自定义 scheme 在 WebKit 上同源 fetch 不可靠。
2. **只读 + Connection: close + 一连接一响应**：壳只需静态资源，避免 keep-alive/分块/并发带来的状态机复杂度与安全面。
3. **端口固定从 47851 起顺序尝试**：避免随机端口导致 origin 漂移；10 个都失败时上报中文错误并可重试。
4. **返回键用左边缘右划手势**（UIScreenEdgePanGestureRecognizer(edges: .left) → navigateBack()），不再叠浮动按钮：run #9 截图证明 44×44 浮层必然压住页面标题（同意页、主界面都能看到）。页面内每个可退状态本身都有按钮（假条页 data-action="leave-page-back"、弹窗 ×、底部 tab），手势是顺手补充。web 未消费时 iOS 不做 moveTaskToBack（无对应 API），只保持当前页面。
5. **shim 额外提供 window.Android.systemDarkMode()**：契约只要求 window.__jiangshuiSystemDarkMode；但 web/theme.mjs:7 读取 globalThis.Android?.systemDarkMode?.()，因此两者都给。不新增 web 字段。
6. **回包 id 用 JSONSerialization 编码，Set 去重（上限 2000）**：id 是 JS 自增字符串，必须原样回传；同一 id 只回一次，避免异步竞态重复 resolve。
7. **35 个 action 全部映射到 NativeServicesProviding 的具名协议方法**，教务 6 个路由 services.school.*；未知 action 回 {"error":"不支持的操作"}，绝不兜底成功。
8. **LogoutHandling 由 Services/NativeServices.swift 声明**（B 负责），Web 层不重复声明；dispatcher 用 services as? LogoutHandling，缺失时兜底执行 consent.revoke / classReminders.clearAll / vault.clear / state.clear 并回 {"ok":true}。
9. **登出清理时序**：dispatcher 先回包，WebHost 延迟 0.8s 清理 WKWebsiteDataStore 后 reload；不早于 handleLogout() 返回（避免清掉 B 正在读的状态）。
10. **顶部白条 A 方案（2026-10-30 取代原全屏+CSS 遮挡）**：RootView 的 `ZStack` 底层铺 `Color(uiColor: host.shellBackgroundColor).ignoresSafeArea()` 填满状态栏/灵动岛区域，`WebViewContainer` 只 `.ignoresSafeArea(.container, edges: .bottom)`，即 **WebView 顶边落在安全区下沿**，不再从 y=0 排版。WebHost 设 `isOpaque=false`、`clipsToBounds=true` 物理裁剪（内容不会溢出到状态栏），并用 `jiangshuiShellTheme` 消息 + `MutationObserver` 把页面 `--bg` 回传原生，保证白条与页面同色；主题切换时底色同步。CSS 安全区样式仍保留（`env(safe-area-inset-*)`、`.main` / `.agreement-screen` / `.leave-page-topbar`），但只作二次保护，**不用 CSS 遮挡状态栏**。共享层 `web/` 一行未改。
11. **ATS 精确放行、不用 NSAllowsArbitraryLoads**：本机回环 + 学校教务 5 个域名；审核说明见第 5 节。
12. **导航白名单只拦主框架**（2026-10-29，P2 期间修正）：`decidePolicyFor` 原先对所有 navigationAction 做白名单判定，iframe 子框架也会被 cancel，而 Android 的 `shouldOverrideUrlLoading` 只拦主框架。教务系统页面若用 iframe 承载内容会白屏，因此改为 `targetFrame?.isMainFrame == false` 时直接 allow；顶层越界照样拦住（文案「已拦截校外页面跳转」/「已拦截自动跳转到校外页面」）。
13. **P3 两条平台能力偏离（登记，不是遗漏）**：
    - **附件上传**：WKWebView 的文件选择需要 `WKUIDelegate.runOpenPanelWith`，该 API **iOS 18.4+** 才有。当前 `School/SchoolFilePicker.swift`（197 行，PHPicker + UIDocumentPicker + 5 分钟临时文件）已落盘但**没有任何调用点**，`SchoolWebViewHost` 也不实现 `runOpenPanelWith`；因此 iOS 15–18.3 上请假附件按钮无响应，其余请假流程（深链、表单、提交）不受影响。这是与 Android SAF 的能力差异，若必须支持需提高最低系统版本或改用原生表单。
    - **定位**：WKWebView 的 `requestGeolocationPermissionFor` 仅 **iOS 27+**。当前用 `WKUserScript` 在 documentStart 替换 `navigator.geolocation`，经 `jiangshuiGeo` 消息交给 `SchoolLocationPermission`（CLLocationManager）；只接受 https + `SchoolURLPolicy.isXgxtUrl` + 端口 0/443 的 origin（`allowedOrigin(message.frameInfo.securityOrigin)`），并在 `SchoolProvider` 注入、`geoBridge.host = self`。真机需验证授权弹窗、拒绝分支与回包形状。

## 4. Mac 侧待核对清单

- [x] **4.1 首编译依赖（已就绪，Mac 侧仍建议重跑生成器）**：Services/NativeServices.swift 已落盘，含 `protocol LogoutHandling { func handleLogout() -> JSONObject }` 与 `public final class NativeServices: NativeServicesProviding, LogoutHandling`，init 为 `init(presenting: @escaping () -> UIViewController?, school: SchoolProviding)`；它内部自己创建 SchoolSession 作为 vault，因此 AppEnvironment 只传 presenting + school（不传 vault）。工程已收录 **41 个 .swift**（含 P2/P3 新增 SchoolReadController / LeaveRecordsService / SchoolLeaveSessionController / SchoolGeolocationBridge / SchoolLocationPermission / SchoolFilePicker）。Mac 首编译前再跑一次 node ios/tools/gen-pbxproj.mjs（实测幂等），确认队友新增文件都在 Sources。
- [ ] **4.2 pbxproj 无共享 scheme**：提交的 Jiangshui.xcodeproj 没有 xcshareddata/xcschemes（不在交付清单内）。Mac 上首次用 Xcode 打开会自动生成 scheme，或先跑 xcodegen generate（project.yml 已配 scheme）；CI 用 xcodebuild -scheme Jiangshui 前先确认。
- [ ] **4.3 生成器与 xcodegen 二选一**：改了 project.yml 后跑 xcodegen 会重写 pbxproj；本仓库以 gen-pbxproj.mjs 产物为准（本机无法验证 xcodegen 实际输出）。新增非常规后缀资源默认进 Resources，必要时改生成器 FILETYPE 映射。
- [ ] **4.4 签名**：CODE_SIGN_STYLE = Automatic，需在 Xcode 选 Team；cn.local.tomorrow 是契约占位，上架前确认唯一性/开发者账号。
- [x] **4.5 图标尺寸与图案（2026-11-25 已改为与安卓端同款）**：用户 2026-11-25 指令「图标用安卓端最新版的同款」，上一轮原创「课表网格」A 图作废。源图是公开仓 fuwuqihmr/jiangshui-schedule @ c357bceb 的 assets/app-icon.png（1024×1024 RGBA、alpha 全 255），iOS 两份均转 RGB 去 alpha、不缩放不加圆角，570,279 B、sha256 805ead90…cdfbb6；web 128×128 与安卓 7 个资源恢复公开仓字节。**actool 是否接受该 1024 图仍需 CI 首编译确认**。另：Resources/AppIcon-1024.png 仍是散装副本（交付要求里有），会作为 bundle 资源重复打包，可删除。
- [ ] **4.6 ATS 学校域名**：Info.plist 已给 portal.juwp.edu.cn、jiaowuh5.juwp.edu.cn、jiaowu.juwp.edu.cn、eapp2.juwp.edu.cn、eapp2.nit.edu.cn 加 NSExceptionAllowsInsecureHTTPLoads=true、NSIncludesSubdomains=true、NSExceptionMinimumTLSVersion=TLSv1.2。ATS 例外按 **host** 生效，jiaowu:8080 / eapp2:9443 的端口不需要单独写；若学校 302 跳到白名单外的新域名（例如某些 CAS/xgxt 变体），需补例外。https://jiaowu.juwp.edu.cn:81、https://xgxt.juwp.edu.cn 是 https，无需例外。
- [x] **4.7 iOS 版本/API（已降级，2026-10-28）**：目标 **iOS 15.0**、`SWIFT_VERSION = 5.0`（Swift 5.5 不是合法设置值，Xcode 只认 4.0/4.2/5.0/6.0）。用到的系统 API 尽量保守（NWListener/WKWebView/Foundation）；具体不确定项见第 6 节。
- [ ] **4.8 并发/主线程**：全部 UI 操作走 DispatchQueue.main.async，未使用 @MainActor 标注（Swift 5.0 语言模式，Xcode 15 编译器默认并发检查 minimal，预计仅警告）。若 Xcode 15 开启严格并发后报错，需给 WebHost/JSBridge/BridgeDispatcher 补 @MainActor。
- [ ] **4.9 前台恢复**：scenePhase == .active 时若服务仍在运行，仅 evaluate window.onNativeResume；若被系统回收则重启服务并重新 load（端口可能变化，见 4.10）。真机验证：锁屏 5 分钟、切后台再回。
- [ ] **4.10 localStorage origin**：web/app.mjs 的课表状态走原生 saveState/loadState（不受端口影响），但 jiangshui-theme、权限引导 key、协议记录（web 侧仅非原生分支用）存 localStorage。端口若因占用顺延，origin 改变会丢失这些偏好。验证：连续两次冷启动端口是否一致；建议 P2 把上次成功端口存 UserDefaults 优先复用。
- [ ] **4.11 页面显示**：未覆盖 WKWebView.contentInsetAdjustmentBehavior（默认 automatic）；index.html 有 viewport-fit=cover，safe-area 目前只有 notifications.css 使用。若首页顶到状态栏/底部被遮挡，可在 WebHost.makeWebView() 设 .never 或调整 RootView 内边距。
- [x] **4.12 返回键遮挡（已修）**：原方案是左上角 44×44 浮层，run #9 截图确认它压住「用户协议与 Cookie 授权」和「江水课表」标题 → 改为左边缘右划手势，RootView 不再叠任何浮动按钮。真机待验手势与 WKWebView 滚动是否冲突（cancelsTouchesInView = false）。
- [ ] **4.13 新窗口/外链**：navigationDelegate 只放行 http://127.0.0.1:<port>/ 与 about:blank；WKUIDelegate.createWebViewWith 把允许的本机 URL 在当前页加载，其余忽略。web 的原生分支不会在主 WKWebView 里打开学校页面（openWebApp/openSchool 走 C 的独立 WebView）。
- [x] **4.14 权限文案**：NSCalendarsFullAccessUsageDescription / NSCalendarsWriteOnlyAccessUsageDescription / NSCalendarsUsageDescription / NSLocationWhenInUseUsageDescription 四键已核对存在且中文非空；P3 又补 NSPhotoLibraryUsageDescription / NSCameraUsageDescription / NSMicrophoneUsageDescription 三键（共 7 个用途键，均为中文非空）。需产品复核措辞；iOS 17 首次日历授权走 FullAccess 键。
- [ ] **4.15 隐私清单**：PrivacyInfo.xcprivacy 只声明 UserDefaults(CA92.1) 与 FileTimestamp(C617.1)；审核前对照实际 API（Keychain、文件属性读取等）复核 required-reason 是否齐全。
- [ ] **4.16 后台模式**：Info.plist 含 UIBackgroundModes=[fetch,processing] 与 BGTaskSchedulerPermittedIdentifiers=[cn.local.tomorrow.background-check, cn.local.tomorrow.class-reminder]；**P1 原生未注册 BGTask**（B 确认）。若审核询问后台模式对应功能，P2 补注册或暂时移除这两个键。
- [ ] **4.17 UA/平台检测**：注入 window.Android 让 web 走原生分支；未伪装 UA、未注入平台标识（web 也未使用）。若后续 web 增加 UA 分支，需同步。
- [ ] **4.18 Info.plist 其他键**：UILaunchScreen 空 dict（默认启动屏）、UIApplicationSceneManifest 仅 UIApplicationSupportsMultipleScenes=false（SwiftUI App 生命周期，Xcode 14+ 模板即如此）、CFBundleIconName=AppIcon；如 Xcode 校验报多余/缺失再按提示调整。
- [ ] **4.19 静态检查**：`node ios/tools/check-ios.mjs` 应 **48/48、0 fail**；本层自查：45 个 action 全枚举、全部 **41 个** Swift 文件括号配平、Web/* 与 App/* 无 as! / try! / 叹号强解包（桥接三文件由 C6 守住）。P3 后 SchoolReadController 715 行、SchoolWebViewHost 619 行，已不再是「全部 <400 行」。
- [ ] **4.20 真机网络**：NWListener 只绑 127.0.0.1；验证本地可访问、局域网上不可达。App Store 4.2 审核说明可强调「页面由应用内本地服务器提供 + 原生日历/通知/文件能力」，不是单纯网页壳。
- [x] **4.21 前台通知展示**：App/NotificationPresenter.swift（37 行）实现 UNUserNotificationCenterDelegate；willPresent 回 [.banner, .sound, .list]（P1 一律前台显示，预览提醒可见），didReceive 直接 completionHandler()；JiangshuiApp.init() 设置 delegate，NotificationPresenter.shared 强持有（delegate 是 weak）。B 的 ClassReminderService / SystemNotificationService 目前未设 categoryIdentifier 或 jiangshui.foreground，故 P1 不做分支；P2 接通知分类后再按标记收窄。真机需验证前台横幅与声音。
- [ ] **4.22 顶部白条 / 无头 / 请假 / 定位真机核对**：白条是否与页面 `--bg` 同色、状态栏区域有无色差；无头 WebView（`alpha=0.01`、`isUserInteractionEnabled=false`、`insertSubview(at:0)`）是否被 WebKit 降频或暂停导致读取超时；请假十步（warmup/CAS/450ms 复检/relogin/retarget）是否收敛；定位 shim 在真实 xgxt 页面的授权与回包；附件按钮在 iOS 18.4+ 的真实行为。见 `docs/P2-SCHOOL-READ.md` §11。
- [ ] **4.23 公开仓 CI 的 runner 回退（坑）**：workflow 写的是 `runs-on: macos-14`，但公开仓实际分配到 **`macos-15-intel`**，annotations 原文 `The configuration 'macos-14-arm64-us-default' is not supported`。该 runner 是 macOS 15.7.9 / Xcode **16.4** / Swift 6.1.2，不是旧文档假设的 Xcode 15.4。以后判断编译器版本以 artifact 里的 `env.txt` 为准；若必须固定，显式改 `runs-on: macos-15` 并确认公开仓标签可用。

## 5. ATS 上架说明（Lead 指定）

这 5 个学校域名的 ATS 例外是**教务系统仅支持 HTTP** 所必需；App Store 审核说明中必须写明「**学校教务系统仅支持 HTTP**」。不要改用 NSAllowsArbitraryLoads 通用放行。

## 6. 不确定 / 未验证（按风险排序）

1. **未编译**：本机无 Xcode/swiftc；以下写法需 Mac 首编译确认：NWListener(using:on:) 与 NWParameters.requiredLocalEndpoint 同时指定端口的行为、NWConnection.receive 回调签名、WKWebsiteDataStore.default().removeData(ofTypes:modifiedSince:completionHandler:) 与 allWebsiteDataTypes() 的调用形态。
2. **presenting VC 取得时机**：PresentingViewControllerHolder 在 makeUIView 后异步取 webView.window?.rootViewController?.jsjTopMost（最多重试 5×0.2s）。SwiftUI 生命周期下若首帧取不到，需改为 SceneDelegate 或 UIApplication.shared.connectedScenes 遍历。
3. **回环 HTTP 与 ATS**：已加 NSAllowsLocalNetworking 与 127.0.0.1 例外，但仍需真机确认 WKWebView 首次加载不被 ATS 拦。
4. **localStorage 与端口**：见 4.10；端口变化会换 origin。若产品要求主题/引导偏好稳定，应持久化端口。
5. **UI 细节**：返回键样式/位置、覆盖层文案、深色模式颜色仅按 web 变量取值，未做视觉验收。
6. **进程/内存**：webViewWebContentProcessDidTerminate 仅 reload()；若反复崩溃需加诊断（当前无）。
7. **图标 1024**：2026-11-25 已换成与安卓同款的 1024×1024 RGB（公开仓 assets/app-icon.png 去 alpha，见 4.5），不再是「源图过小」的已知不合规项；actool 实际接受度仍待 CI。
8. **ServiceProtocols.swift 括号计数**：内部字符串/注释含括号字符，静态括号检查会误报；非本层文件，未改。
9. **UIBackgroundModes 与 BGTask**：P1 未注册，见 4.16。
10. **AppIcon 目录格式**：Assets.xcassets/AppIcon.appiconset 用的是 Xcode 15 单尺寸格式（idiom universal / platform ios / size 1024x1024），源图现在是真 1024×1024 且已换成与安卓同款（见 4.5）。Mac 侧首编译时 actool 若报「1024x1024 缺失」或旧格式槽位不匹配，按 Xcode 提示重建 appiconset。

## 7. 未做（P1 边界，非本层遗漏）

- 教务读取 6 个 action：P1 由 C 抛桩文案；**P2（2026-10-29）已由 Lead 接真实读取**（action 17-19 走 `SchoolProvider.capture/leaveRecordSync`，24-26 同），壳层错误路径不变。见 `docs/P2-SCHOOL-READ.md`。
- BGTask 注册、通知 runtime 权限映射、autostart 真实支持由 B/C 在 P2 补。
- P3 上传（`runOpenPanelWith` 仅 iOS 18.4+）与定位（`requestGeolocationPermissionFor` 仅 iOS 27+）是登记过的平台能力偏离，当前分别采用「预留未接线」与「WKUserScript + jiangshuiGeo shim」；不是本层遗漏，详见 3.13。
- App Store 元数据、截图、TestFlight、真机回归均未做（无 Mac）。

## 8. 备注：文件归属

- 只写了 ios/project.yml、ios/Jiangshui.xcodeproj/project.pbxproj、ios/tools/gen-pbxproj.mjs、ios/Jiangshui/App、ios/Jiangshui/Web、ios/Jiangshui/Resources 下的文件，以及本文件。
- web/ 与 android/ 在 P1 未改动；2026-11-25 task-50 按用户指令把图标资源恢复为公开仓字节（见 4.5），其余未动。Services/、School/、tools/check-ios.mjs、tests/ 未写（队友负责），本层只读引用其协议/类型。
