# iOS 上课实时活动（Live Activity）说明

本文写给维护者和验收者，说明 iOS 端“实时的上课卡片”到底能做到什么、做不到什么，以及代码在哪里。
**一句话：普通通知是到点必达的主路径；实时活动是 App 活着时的增强显示，尽力而为。**

## 1. 能力边界

| 能力 | 普通本地通知 | 实时活动（Live Activity） |
| --- | --- | --- |
| 到点提醒 | 是，由系统在 showAt 触发 | 否，苹果不允许 App 在后台“定时启动”实时活动 |
| 退到后台/锁屏显示 | 是 | 已经启动的活动会继续显示 |
| App 被杀死后启动 | 已排期的通知仍会触发 | **不能**，冷启动前不会自动出现 |
| 用户手动清除 | 可清除通知 | iOS 16.2+ 可长按结束；结束后同一节课不再补起 |
| 自动结束 | 到期后从通知中心移除 | 通过 dismissalPolicy: .after 在“上课开始 + 10 分钟”自动结束 |
| 关闭入口 | 系统通知中心可清除 | App 内不提供关闭/删除按钮 |

因此：

- 到点提醒以通知为准；实时活动失败绝不能影响通知。
- 实时活动只在 App 进程活着时启动：前台到点由 Timer 启动；从后台/冷启动回到前台时，由 reconcile 对“当前活跃提醒窗口内”的课程补启动。
- “活跃提醒窗口”沿用 ClassReminderService 的定义：showAt <= now < expiresAt（expiresAt = 上课开始 + afterStartMinutes，默认 5 分钟）。
- 活动在“上课开始 + 10 分钟”自动删除；如果用户长按结束，或系统清理，App 不会在同一节课再次强行启动（已启动账本会保留到 expiresAt + 3 天）。

## 2. 触发与结束流程

1. ClassReminderService.reconcile 计算未来窗口事件，按 showAt 升序过滤、排序。
2. 最多保留 60 条候选（见第 4 节）；调用 ClassActivityController.shared.reconcile(events:now:log:)。
3. Controller 检查 ActivityAuthorizationInfo().areActivitiesEnabled；用户关闭“实时活动”就直接返回，通知路径不受影响。
4. 对 active 事件立即 start；对 future 事件用主线程 Timer 等到 showAt 再 start（App 在前台/进程活着才可靠）。
5. start 检查“是否已启动过”；未启动则 Activity.request(...)，成功后立即 activity.end(using: state, dismissalPolicy: .after(start + 10 分钟))。
6. 注销/清空提醒时 clearAll 调用 controller.endAll()：取消 Timer、结束本 App 的全部活动、清空已启动账本。

> 说明：在 request 之后立即 end、把 dismissalPolicy 设为 T+10，是为了不依赖 App 在 T+10 还活着。活动仍会显示到 T+10，但系统会按这个时间移除。

> 注意：iOS 16.1 的 `request(attributes:contentState:pushType:)` 是**同步 throws**（不是 async），`end` 才是 async。该签名自 iOS 16.2 起标记弃用；为保持 16.1 可用性仍使用它，编译时会有 deprecation 警告（不是错误）。

## 3. 代码位置

| 文件 | 作用 |
| --- | --- |
| `ios/Jiangshui/Services/ClassActivityController.swift` | ActivityKit 封装：可用性判断、Timer 预排、request/update/end、失败诊断、endAll |
| `ios/Jiangshui/Services/ClassReminderService.swift` | 课程事件计算、通知排期、60 条上限、调用 controller |
| `ios/JiangshuiWidgets/Shared/ClassActivityAttributes.swift` | 主 App 与 Widget 共用的 ActivityAttributes/ContentState |
| `ios/JiangshuiWidgets/ClassActivityWidget.swift` | 锁屏/灵动岛界面；没有关闭按钮 |
| `ios/Jiangshui/Resources/Info.plist` | NSSupportsLiveActivities=true（已有，未重复添加） |

## 4. 60 条 pending 通知上限

iOS 对每个 App 的待处理本地通知有系统上限（约 64 条），超过后新通知会被丢弃。reconcile 现在：

- 只取 expiresAt > now 且未关闭的事件；
- 按 showAt 升序排序；
- 最多遍历前 60 条；
- 超过 60 条时写一条白名单格式诊断：`import-error kind=other http-status=0`（不新增 kind，避免诊断导出被 web/diagnostics.mjs 过滤）。

这 60 条同时是实时活动的候选来源；被截断的课程仍有课表，只是不排通知/不启动活动，直到后续窗口滚动后再次进入候选。

## 5. 回退与失败策略

- iOS < 16.1：ClassReminderService 的调用点用 `if #available(iOS 16.1, *)` 包住，运行时完全不走 ActivityKit，只有普通通知。
- 用户关闭“实时活动”开关：Controller 直接 return，不写失败日志，不影响通知。
- Activity.request 抛错（权限、系统限流、请求过频等）：只写 `import-error kind=other http-status=0`，绝不抛到桥接、绝不影响通知排期。
- 实时活动界面没有关闭入口；用户仍可在 iOS 16.2+ 长按活动主动结束。

## 6. 与 Android 的差异

| 项 | Android | iOS |
| --- | --- | --- |
| 提醒通道 | NotificationChannel | 无 channel；权限由 UNUserNotificationCenter 管理 |
| 展示形态 | 通知/悬浮提醒 | 普通通知 + 实时活动（锁屏/灵动岛） |
| 精确闹钟 | AlarmManager/精确闹钟权限 | 无等价；用本地通知 + BGTaskScheduler（P2） |
| 活动启动时机 | 可在后台/定时任务中发通知 | 实时活动只能在 App 进程活着时 request |
| 活动删除 | 通知可设 timeoutAfter/autoCancel | dismissalPolicy .after(T+10)；用户也可长按结束 |
| 关闭入口 | 通知动作/删除 | App 内无，系统层面可清除 |

## 7. 已知风险与未验证项（重要）

本机 Windows，无 Xcode/swiftc，**以下全部未编译、未真机验证**：

1. ActivityKit 的 `Activity.request`、`Activity.activities`、`update(using:)`、`end(using:dismissalPolicy:)`、`.after(_:)` 仅按 iOS 16.1 API 书写，未在 Xcode 下编译。
2. 主 App 的 deployment target 是 iOS 15.0，而 `ClassActivityAttributes.swift` 与 `ClassActivityController.swift` 使用 iOS 16.1 的 ActivityKit。文件已加 `@available(iOS 16.1, *)`；但 `import ActivityKit` 是否会在 target 15.0 下触发“module minimum 16.1”警告/错误，需要 Xcode 15.4 首次编译确认。不要在未验证前擅自改 deployment target。
3. Widget Extension（.appex）在免费 Apple ID 侧载时通常需要单独签名，可能失败；这是签名问题，不是业务逻辑问题。
4. 苹果不保证实时活动一定显示：系统可能因数量、频率、低电量、用户设置拒绝 request；失败只记录诊断。
5. App 被杀后无法启动实时活动；到点提醒仍由已排期的本地通知负责。
6. 用户长按结束后，同一节课不会自动补起；只有清除账本（注销/clearAll）后才会重新开始。
7. clearAll 会结束活动；但用户在课表里关闭“提醒”开关不会调用 endAll，已经显示的活动会自然到 T+10 结束。
8. 灵动岛只在支持的设备上显示；锁屏样式与系统版本有关，本机无法截图验证。
9. `.after(T+10)` 的精确移除时间由系统调度，可能因系统负载略有延迟；不能承诺“10 分钟整点消失”。

## 8. 门禁与测试

- `ios/tools/check-ios.mjs` 新增 **G1**：检查 16.1 可用性、ActivityAuthorizationInfo、request/update/end(.after)、T+10、失败诊断、60 条上限、endAll、NSSupportsLiveActivities。
- `ios/tests/live-activity.test.mjs`：上述源码断言 + Widget 无关闭按钮 + ClassReminderService 行数 <400。
- `ios/tests/full-suite.test.mjs`：检查项总数 48，编号 A1–A11、B1–B7、C1–C8、D1–D7、E1–E2、F1–F12、G1。
- 当前本机结果（2026-11-03）：check-ios **48/48**，ios/tests **64 pass**，根 tests **282 pass**，E1/E2 **182 文件 / 1ea23688…18cbdd**。

## 9. 真机/CI 复验清单

- [ ] Xcode 15.4 编译通过（尤其 ActivityKit 在 target 15.0 的可用性）。
- [ ] 真机开启“实时活动”后，到 showAt 出现锁屏卡片/灵动岛。
- [ ] 活动在“上课开始 + 10 分钟”自动消失。
- [ ] 用户长按结束后，同一节课不回前台补起。
- [ ] 关闭“实时活动”开关时只有通知，无崩溃/无重复。
- [ ] App 退后台/被杀后，通知仍按 showAt 触发；实时活动不出现（预期）。
- [ ] 免费签名侧载 .appex 的签名结果。
