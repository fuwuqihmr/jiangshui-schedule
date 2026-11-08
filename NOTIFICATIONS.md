# 小米通知与锁屏（1.2.0-beta8）

正式提醒不再使用class-reminder-updates静默组，也不随15秒状态轮询重新发送。ClassReminderPlan.fingerprint记录内容和状态版本；实际通知丢失、内容变化、上课/结课边界或焦点权限改变时才更新。系统时间改变时清除渲染指纹，使倒计时重新对齐。
NotificationCards.lesson提供公开锁屏替代版本；全局隐藏通知、分类重要程度及厂商通知过滤由系统控制，软件不会修改这些用户选择。

XiaomiFocus只按官方接口检查能力与权限。查询在后台执行，不阻塞页面；系统尚未允许时，不附加焦点参数。官方模板以及审核依赖见XIAOMI-NOTIFICATIONS.md。
设置提供通知分类、锁屏/横幅设置入口及延迟5秒的示例锁屏测试。诊断只导出权限、数量、协议版本等固定字段，不导出课程信息。

---

# Android 系统通知卡片历史说明（1.2.0-beta7）

原生 `NotificationCards.java` 为上课、课表变更、检查运行及异常通知提供统一卡片。
`notification_compact.xml`、`notification_expanded.xml`、`notification_heads_up.xml` 分别对应收起、展开和顶部弹出横幅；使用 Android 装饰通知样式保留系统应用身份和展开控件。
颜色资源使用 `values/notification_colors.xml` 与 `values-night/notification_colors.xml`，外层背景和圆角由系统宿主处理。

上课提醒显示时间、地点、课程、老师；课前由系统计时器运行倒计时，原生闹钟负责在开课和结课边界更新状态。正式提醒保持常驻及静默恢复，卡片按钮只打开应用，关闭仍在首页经过二次确认。课表变更通知打开变更记录。
设置与数据的上课提醒卡片提供“预览通知卡片”，临时示例保留60秒，与真实课程/关闭记录分离；无需悬浮窗权限。

先构建APK，再运行验证；如指定BuildDirectory，请将ANDROID_BUILD设为同一路径。验证入口：`node tools/notification-cards-check.cjs` 检查通知数据、三个XML的控件目标和单调时钟基准；这项JVM检查不验证Android系统实际渲染。`node tools/class-reminders-ui-check.cjs` 验证应用内卡片与二次确认。

---

# 通用悬浮提示

由 `web/notifications.mjs` 管理，`web/notifications.css` 提供样式；容器独立于主页面，页面重绘不重置计时。

```js
import {showNotice, dismissNotice} from './notifications.mjs';
const id = showNotice('课表核对完成', {
  detail: '已确认无变化',
  tone: 'success',
  duration: 4200,
  // 可选：开发者设置颜色，没有用户颜色设置入口。
  background: '#e8f7ee',
  textColor: '#165b39',
  barColor: '#20a162'
});
// 需要提前关闭时：
dismissNotice(id);
```

`tone` 支持 info、success、warning、error、neutral，默认 info。默认保留 4200 毫秒；核对失败由调用方指定 6500 毫秒。倒计时结束后向左退出，退出动画 240 毫秒。最多三条，新提示在上，第四条立即移除最旧提示。

首条提示距顶部副标题下沿 8px，避开标志和标题。容器为 fixed，不占内容高度；随窗口变化、字体加载、页面重绘及滚动更新位置。系统减少动态效果时省略位移动画。

调用方传入文字通过 textContent 渲染。提示底部为纯色倒计时条，不显示数字。提示支持手动关闭；页面切换后仍按原计时自动关闭。

定向检查：`node tools/notifications-ui-check.cjs`。使用手机尺寸界面和模拟原生接口，不依赖用户数据或已连接安卓设备。
