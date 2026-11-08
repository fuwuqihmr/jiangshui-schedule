# 小米焦点通知接入说明 · 江水课表 1.2.0-beta8

当前已完成：标准通知去除静默分组与重复发送；公开锁屏版本；官方OS2/OS3焦点卡片模板与后台权限查询；设置检查和锁屏测试入口。

焦点大卡片有外部前提：小米系统必须允许cn.local.tomorrow使用焦点通知。官方接入流程包括设计方案及权限开通；仅在代码中写入模板，并不能替代平台授权。软件显示“本机暂未允许”时，仍按普通通知工作。普通通知的默认展开和小米“更多通知”过滤无法由应用强制控制。

技术依据：
- 小米超级岛开发文档：https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2131
- 小米焦点通知接入流程：https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2132
- OS2/OS3通用模板，baseInfo type=2、picInfo type=1、hintInfo type=1；param_island必须放入param_v2。
- 协议版本：Settings.System.getInt(contentResolver,"notification_focus_protocol",0)。
- 权限查询：content://miui.statusbar.notification.public，方法canShowFocus，参数Bundle中的package为cn.local.tomorrow。
- 不通过更换channel覆盖用户设置，不使用悬浮窗、全屏来电或媒体播放身份模拟课程提醒。

开通申请资料草稿（尚未提交）：
应用名称：江水课表
Android包名：cn.local.tomorrow
当前版本：1.2.0-beta8 / versionCode31
应用AppID与开发者账号：待项目持有人提供
用途：用户主动启用的本地上课提醒，展示时间、地点、课程、老师及课前倒计时；进入相应日期课表查看并二次确认关闭。无广告营销，不上传Cookie或个人课表。
拟适配场景：通知栏焦点大卡片、锁屏/息屏提示；OS3超级岛倒计时。
样式：采用官方模板组合，浅色深色分别设置颜色；卡片按钮打开课表，不直接执行系统免打扰或关闭课程提醒。
待补材料：平台要求的完整设计图、真机演示、AppID及申请主体信息。
这份资料只是本地草稿，没有发送邮件或提交平台。

OS3还要求应用清单配置正式分配的com.xiaomi.xms.APP_ID，并按所用签名选择com.xiaomi.xms.BUILD_TYPE_DEBUG。当前没有AppID，不填占位值，也不声称已获得焦点展示资格。
拿到平台AppID后，可使用构建脚本的-XiaomiAppId参数配置。当前脚本使用项目原有测试签名，因此BUILD_TYPE_DEBUG为true；正式签名发布时需同步改为false并配置对应证书。
param_v2.timeout单位为分钟，按本次提醒剩余时间计算；param_island.islandTimeout单位为秒。模板字符串保持在3072字节以内。
常见Q&A：https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2146
