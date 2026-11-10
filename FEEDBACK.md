# 意见反馈（问卷星 · App 内拉起）

面向 Android 端的反馈通道：设置页里一个入口，点开后在 App 内用原生 WebView 打开问卷星收集表，不跳浏览器、不经过开发者服务器。

## 1. 用户看到什么

- 位置：**设置 → 关于与隐私 → 意见反馈**
- 点击「打开反馈问卷」→ 全屏反馈页（原生 `FeedbackActivity`）
  - 顶部：返回、标题（默认「意见反馈」）+ 当前 App 版本号、「浏览器打开」
  - 页面：问卷星问卷
  - 加载失败：显示「重新加载 / 复制问卷链接」，并提示可到浏览器或微信打开
  - 返回键：先回退网页历史，再退出反馈页
- 入口只在 `web/feedback.json` 配了**有效问卷星链接**时出现；没配就完全隐藏，不会出现死链。

> 当前已配置 `https://v.wjx.cn/vm/O6eKp8v.aspx`，入口默认可见。问卷星表单需要你的账号创建/维护，换表只改 `url` 一行。

## 2. 启用：改一行

编辑 `web/feedback.json`：

```json
{
  "enabled": true,
  "title": "意见反馈",
  "intro": "遇到问题或有建议？填一份问卷，帮我们把课表做得更稳。",
  "url": "https://www.wjx.cn/vm/你的问卷ID.aspx"
}
```

- 只改 `url` 一行就能启用；`enabled` 默认是 `true`，留空或填错会自动隐藏入口。
- 支持域名：`wjx.cn`、`wjx.top`、`sojump.com`、`wjx.com` 及其子域（如 `www.wjx.cn`、`tp.wjx.top`）。
- 只接受 `https`、默认端口、不能带账号密码；`http://`、短链跳转站、其他域名都会被拒绝。
- 原生和网页层各校验一次，配置写错不会打开任意网址。

改完重新构建 APK（见第 5 节）。运行中的 App 不会热更新这个文件。

## 3. 建一份问卷星收集表（约 5 分钟）

> 当前入口的问卷是一份完整使用反馈问卷（`O6eKp8v`）。下面是精简版反馈模板，供以后换表或另建一份短问卷时参考。

1. 登录 [问卷星](https://www.wjx.cn/) → **创建问卷** → **调查** → 空白创建。
2. 标题：`江水课表 · 意见反馈`；说明：`反馈约 1 分钟。请勿填写学校密码、学号等敏感信息。`
3. 按下面题目添加（题型和选项可直接照抄）：

| # | 题型 | 题目 | 选项 / 说明 |
| --- | --- | --- | --- |
| 1 | 单选 | 你使用的设备 | Android 手机 / Android 平板 / 其他 |
| 2 | 填空 | 手机品牌、系统版本与 App 版本（选填） | 例：小米 14 / Android 15 / v1.3.2；App 版本见反馈页标题下方 |
| 3 | 单选 | 问题出现在哪里 | 今日课程 / 周课表 / 请假与假条 / 设置 / 通知与提醒 / 桌面小组件 / 其他 |
| 4 | 多行填空（必填） | 问题描述 | 什么时候、点了什么、看到什么、你期望是什么 |
| 5 | 单选 | 能稳定复现吗 | 每次都能 / 偶尔 / 只遇到一次 |
| 6 | 图片上传（选填） | 截图或录屏 | 问卷星支持图片题；不需要可删 |
| 7 | 填空（选填） | 联系方式 | QQ / 微信 / 邮箱，方便回访 |

4. 设置建议：
   - 允许匿名填写、不强制微信登录（App 内是 WebView，不是微信）；
   - 不限制填写次数（同一个人可能反馈多个问题）；
   - 关闭「提交后抽奖」等干扰项；
   - 免费版有回收份数上限，一般反馈量通常够用；不够时在问卷星后台看升级选项。
5. 发布 → 复制**问卷链接**（形如 `https://www.wjx.cn/vm/xxxxxxxx.aspx`）→ 填进 `web/feedback.json` 的 `url`。

> 如果发布后提示「请在微信中打开」，App 里的「浏览器打开」按钮可以把当前页交给系统浏览器；也可以把问卷星的「微信内填写」限制关掉。

## 4. 实现与边界

- 网页层：`web/feedback.mjs` 负责配置校验、入口面板、调用原生；`web/app.mjs` 只在设置页插入面板并处理 `data-action="feedback"`。
- 原生层：
  - `FeedbackConfig.java` 读取 assets 里的 `feedback.json`（随 `web/` 一起打包），做 https/域名/端口/长度校验。
  - `FeedbackActivity.java` 独立 WebView：JS + DOM Storage + 第三方 Cookie；UA 用移动 Chrome，减少问卷星对 WebView 的拦截；支持问卷里的图片上传；定位/摄像头/麦克风权限一律拒绝。
  - `MainActivity` 新增 `feedbackInfo` / `openFeedback` 两个桥接动作；`openFeedback` 只在配置有效时启动，避免死链。
- 安全：
  - 反馈页不注入任何 `@JavascriptInterface`，外部页面拿不到 App 桥；
  - WebView 只允许问卷星域名留在内部，其他链接（含 `mailto:`/`tel:`）交给系统处理；
  - 不自动附带学校 Cookie、TGC、学号或课表内容；问卷里填什么由用户决定。
- 桌面端/浏览器：不显示入口（`loadFeedbackInfo()` 只在 `globalThis.Android` 下调用桥）。桌面端如需反馈，直接发问卷链接即可。

## 5. 构建与验证

```powershell
# 逻辑测试（含 feedback.test.mjs）
npm test

# 构建 APK（需要 JDK 17 + Android SDK platform 35 + build-tools 35.0.0）
powershell -ExecutionPolicy Bypass -File .\tools\build-android.ps1 `
  -OutputDirectory '..\..\build-output' -BuildDirectory '..\..\build-work-feedback'
```

验证：

```powershell
aapt2 dump badging .\build-output\TomorrowSchedule-debug.apk
apksigner verify --verbose .\build-output\TomorrowSchedule-debug.apk
```

本仓库逻辑测试：`node --test tests/*.test.mjs`（329 项，含 `feedback.test.mjs`）。本次合并没有做 Android 编译、装机或真机验证，所以「点开入口后问卷星页面能否完整渲染、图片上传是否可用」仍需在设备上点一次确认。

## 6. 签名与升级提醒

- 本仓库不提供签名密钥；构建脚本会生成新的 **debug keystore**，签出的 APK 与其他密钥签名的安装包**签名不同**。
- 用不同密钥签名的 APK 不能直接覆盖安装旧版（会提示签名不一致），需要先卸载旧版，本地数据（课表、登录、设置）会丢失。要保留升级能力，请用自己的 keystore 重新签名。
- 正式分发前请确认版本号与正式签名策略。
