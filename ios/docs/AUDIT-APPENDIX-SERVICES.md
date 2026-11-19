# iOS 服务层交付附录（B / implementer-services）

范围：ios/Jiangshui/Services/ 的 P1 原生服务；Android 同名类为行为基准。全部 Swift 未编译（本机无 Xcode/swiftc），以下为静态审阅结论，供 AUDIT 引用。task-4 已完成（completed，revision 3）。

- **SessionVault 归属**：按契约 §7.1 由 C 的 Services/SchoolSession.swift 实现，未创建 SessionVault.swift；Keychain service 为 cn.local.tomorrow.school-session（Lead 已裁定）。影响：无；P2：否。
- **诊断平台标识**：DiagnosticsService 返回 platform="ios"，但 web/diagnostics.mjs 仅识别 android/windows/browser，导出诊断会显示 browser。影响：诊断页平台文案错误；P2：是（映射或改 web 白名单，web 现不可改）。
- **通知元数据缺失**：iOS 无 channel/importance/lockVisibility/deviceLocked，status 中固定为 4/1/false，groupedCount=0，activeCount 统计当前 active 事件数。影响：提醒状态页数值不等于系统实际展示；P2：是（按 UNNotificationSettings 细化映射）。
- **通知动作/前台展示**：Services 未注册“管理提醒/查看课表”通知 category/action；前台横幅依赖 UNUserNotificationCenterDelegate，已由 Lead 派 A 新增 App/NotificationPresenter.swift。影响：通知按钮与前台可见性；P2：是（action 路由），前台部分 A 已补。
- **权限快照映射**：permissionStatus 的 notifications 为 runtime=false、systemEnabled=allowed=granted；iOS 无法区分系统通知总开关与授权状态。影响：权限页可能少提示；P2：是（细化 UN 设置映射）。
- **后台检查映射**：runtimeStatus 的 exact=backgroundRefreshStatus==available、batteryExempt 恒 true；task-31 已注册 `cn.local.tomorrow.class-reminder` 的 BGAppRefreshTask。影响：后台刷新状态可能显示可用但系统仍可能不执行；P2：真机验证调度（best-effort，可能延后/不执行）。
- **日历标识与可用性**：calendarId 用 EKCalendar.calendarIdentifier 字符串（Android 为 long），available 恒 true（EventKit 无 provider 概念）。影响：web 仅读 lastSyncAt/lastEventCount，风险低；P2：否（如需严格对齐可映射）。
- **日历性能/顺序**：removeEvents 逐条 commit（上限 5000），sync 先校验 events 后校验权限；requestAccess(to:) 在 iOS 17 弃用。影响：大量事件删除慢、错误码优先级与 Android 略有差异；P2：是（批量删除、权限优先、iOS 17 API）。
- **文件交换兼容性**：import 仅 UTType.json、上限 2MB；exportBase64 仅 image/png、application/pdf、text/plain 且 32MB 上限；文件名长度用 Swift Character 数。影响：非 JSON UTI/超大文件被拒（与 Android 语义接近）；P2：否（可选接受 public.json）。
- **登出清理差异**：未清 CheckScheduler 的 daily-check UserDefaults；WKWebsiteDataStore 为异步清理（A 的 WebHost 回包后二次清理并重载）；无 Android 的 Keystore alias/school.enc 删除（C 用 Keychain）。影响：登出后可能残留后台检查配置、缓存短暂存在；P2：是（清 daily-check；缓存由 A 兜底）。
- **同意/提醒边缘**：ConsentStoring.revoke() 非 throwing，撤回失败无法回传文案；ClassReminders.clearAll 现在会取消 scheduled + preview + posted 账本中的已投递通知，但仍不枚举系统全部通知。影响：极端情况下无错误提示或残留第三方通知；P2：是（可选增强）。
- **上课提醒预排**：task-31 起 reconcile 对 -1…7 天事件用 UNCalendarNotificationTrigger 预排（未来）或 1 秒 interval（已进窗口），identifier 为 class/date|key，先 removePending 再 add；到期用 removeDeliveredNotifications 清理。风险：iOS 同时挂起的本地通知上限为 64 条，极端情况（一周自定义课 >64 节）可能被系统丢弃；常规课表低于上限。P2：是（超限时按 showAt 取前 60 条并提示）。
- **未编译与 API 不确定性**：无 Xcode/swiftc，未跑模拟器/真机；未验证 UIApplication.openNotificationSettingsURLString（iOS 15.4+ 假定）、UIDocumentPicker 的 presentationController.delegate 覆盖、EventKit 授权 rawValue/回调线程、通知缓存冷启动回调时序（已用 whenKnown 排队但未真机验证）、Info.plist NSCalendarsUsageDescription、agreement.json 的 web/ folder reference。影响：编译/运行正确性未知；P2：是（Mac xcodebuild + 真机验证）。
