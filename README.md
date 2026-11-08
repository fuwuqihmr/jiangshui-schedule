# 江水课表

> JiangShui Schedule —— 本机优先的课表客户端：只读学校教务系统，把课表、变更和提醒留在这台设备上。

江水课表读取你在学校教务系统里已有的课表，展示今天的课和这一周的安排，并比较前后两次读取的差异，在本机提醒你上课与课表变化。它有两个客户端形态：Android 原生应用（Java 外壳 + WebView 加载的前端）和 HarmonyOS NEXT 应用（ArkTS 独立实现）。

项目**没有服务器**：不运营后台，不提供账号体系、云同步或远程推送。数据留在你自己的设备上，换设备就是重新登录、重新读取。

- 许可：GPL-3.0-or-later，全文见 [LICENSE](LICENSE)
- 第三方组件、名称与图标说明：[NOTICE](NOTICE)
- 安全与隐私说明、问题上报渠道：[SECURITY.md](SECURITY.md)
- 本项目是**个人项目，不是学校官方应用**。

## 目录

- [红线与边界](#红线与边界)
- [功能概览](#功能概览)
- [平台与实现](#平台与实现)
- [目录结构](#目录结构)
- [自己构建](#自己构建)
- [测试](#测试)
- [隐私与数据](#隐私与数据)
- [许可与分发](#许可与分发)
- [免责声明](#免责声明)
- [如何参与](#如何参与)
- [相关文档](#相关文档)

## 红线与边界

这几条是项目的设计前提，也是使用前应当知道的部分：

| 原则 | 具体做法 |
| --- | --- |
| **只读学校系统** | 客户端只向学校系统发起读取：登录页、课表页面、请假记录页面。课表变化只在本机比较，不回写学校、不改动学校数据。请假 / 销假 / 续假是在学校自己的网页里由你点击完成，客户端不代为提交。 |
| **不保存学校账号与密码** | 登录发生在你操作的学校页面会话里。应用不读取、不存储、不记录用户名或密码；会话凭据只用于保持登录和读取课表。 |
| **Cookie / TGC 不进入页面 JS** | 教务会话 Cookie 与统一身份认证票据由原生层（Java / ArkTS）持有。页面脚本既不接收这些值，也不会把它们写进日志或导出文件；Android 版把静默恢复用的副本用 Android Keystore 加密后存放在应用私有目录。 |
| **不上第三方云、不装统计 SDK** | 没有分析、崩溃上报、广告或推送 SDK。网络访问只指向学校系统。 |
| **非官方** | 与学校、教务处及教务系统厂商没有隶属或授权关系，没有获得任何官方认证或背书。 |

## 功能概览

- **今日课表**：今天的课、时间、地点、老师；可选顶部概览卡片；晚自习与当天假条一起显示。
- **完整课表**：整周网格；支持单双周、调休、停课、单日课程修改与自定义课程；跨节课程按实际起止时间显示。
- **变更记录**：每次读取后与上一次比较，列出新增、取消以及时间 / 地点变化；本机的手动修改可在记录里一键撤销。
- **上课提醒**：课前倒计时与系统通知卡片（Android）；通知内容在本机生成，可整体关闭。
- **每日自动检查**：默认每天 22:00（北京时间）在本机检查一次，时间可改；到点无法执行时顺延重试，不会反复触发。
- **桌面小组件**（Android）：小、高、宽与横屏布局的课表小组件。
- **导出课表**：三种形式——每周一页的 PDF、整学期一张 PNG 总览、教务风格的纯文本。
- **写入系统日历**（Android）：写进一个专用的本地日历，逐日单次事件；再次写入为覆盖更新，也可整体移除；不写其他日历、不加课程提醒。
- **请假服务入口**（Android，实验性）：打开学校学工系统的请假 / 销假 / 续假页面（独立 WebView，域名白名单）；打开过的请假记录会同步到本机，在「假条状态」里与当天课程联动标记。
- **多主题**：黑白、江水蓝、紫色，或跟随系统。
- **示例模式**：随时切到内置示例课表查看界面，不影响你本人的课表与修改。
- **排查日志**：导出的是固定字段（版本、读取阶段、计数、节次），不含账号、密码、Cookie 或课程内容，也不会上传。

界面文本为中文，时间按北京时间（Asia/Shanghai）计算。

## 平台与实现

| 平台 | 状态 | 实现 |
| --- | --- | --- |
| Android（minSdk 26 / targetSdk 35） | 主要维护目标 | Java 外壳 + WebView 加载 `web/` 的 ES Module 前端；不使用 AndroidX 与第三方 UI 库 |
| HarmonyOS NEXT（API 26） | 独立实现，功能持续补齐，与 Android 版不完全对等 | ArkTS（Stage 模型），工程在 `harmony/` |
| Windows 桌面 | 已停止维护，仅保留源码 | Electron 外壳，`desktop/` |

前端 `web/` 没有打包器，也没有前端框架：`index.html` 直接加载 `bootstrap.mjs`，其余是原生 ES Module、CSS 变量主题和一条严格的 CSP（`script-src 'self'`）。Android 与鸿蒙各自在自己的原生层实现读取、会话、通知、组件与系统集成，前端只通过一层很小的桥接调用它们。

## 目录结构

```
web/        前端页面逻辑（ES Module，无打包器、无框架）：解析、周次、变更、提醒、导出、主题
web/data/   合成示例数据：示例课表、调休、节假日（不是任何人的真实课表）
android/    原生外壳：WebView 与会话保险库、通知卡片、桌面小组件、日历同步、每日检查
harmony/    HarmonyOS NEXT 工程（ArkTS，Stage 模型）
desktop/    Electron 桌面外壳（历史，不再维护）
tests/      纯逻辑回归测试（Node 内置 test runner）
tools/      构建、图标导出、清单校验与上传范围守卫脚本
assets/     应用图标源文件
```

## 自己构建

### 准备

- **Node.js**：开发与测试使用 Node.js 22，更低版本未验证。
- **Android**：JDK 17、Android SDK（build-tools 35.0.0、platform android-35）、Python 3。
- **HarmonyOS**：HarmonyOS SDK（DevEco Studio 或官方命令行工具，API 26 / SDK 26.0.0）。
- **Windows 桌面**：Node.js，且能访问网络（Electron 需要下载二进制）。

### 前端

```bash
npm test        # 纯逻辑测试，不需要安装任何依赖
npx serve web   # 用任意静态服务器打开 web/ 即可
```

`web/` 用的是 ES Module，浏览器不允许从 `file://` 加载模块，所以直接双击 `index.html` 打不开，需要用静态服务器访问 `web/`。在普通浏览器里，通知、小组件、日历等 Android 专属入口会显示「仅 Android 可用」。

### Android

**方式 A：仓库自带脚本（不依赖 Gradle）**

```powershell
powershell -ExecutionPolicy Bypass -File tools/build-android.ps1
```

脚本用 aapt2 / javac / d8 / zipalign / apksigner 直接产出 APK，可选参数 `-OutputDirectory`、`-BuildDirectory`、`-XiaomiAppId`（小米聚焦通知需要开发者平台签发的 AppId；不填则只使用系统标准通知）。它默认从**仓库上一级目录**的 `toolchain/android-sdk` 读取 SDK，如果你的 SDK 不在这里，请改脚本顶部的 `sdkRoot`。

这个脚本内部会调用 `tools/package-apk.py`：由后者把 `web/` 里的前端资源与编译出的 dex 一起打进 `unsigned.apk`。两个文件需要一起保留，缺一个都会构建失败。

签名：脚本会在本机生成一个调试用密钥给 APK 签名。**仓库里没有任何签名密钥**；要发布或长期分发请换成你自己的密钥并妥善保管——换密钥后旧版本无法覆盖安装。

**方式 B：Gradle / Android Studio**

`android/` 内有 AGP 8.7.3 的构建脚本，但没有 Gradle wrapper。用 Android Studio 打开 `android/`，或本机装 Gradle 8.x 后自行执行 `assembleDebug`。前端通过 `android/app/build.gradle` 里的 `assets.srcDirs = ['../../web']` 打进 APK，所以改前端不用改 Android 工程。

### HarmonyOS

用 DevEco Studio 打开 `harmony/`，或在已安装官方命令行工具的终端里执行：

```bash
cd harmony
hvigorw assembleHap --mode module -p product=default -p module=entry@default -p buildMode=debug
```

产物是未签名 HAP；签名证书与安装到设备需要你自己准备（`harmony/build-profile.json5` 的 `signingConfigs` 留空）。没有 SDK 时可以做静态检查：

```bash
node harmony/tools/check-harmony.mjs
```

它只检查工程结构与引用关系，通过不等于能编译。

### Windows 桌面（历史）

```bash
npm install
npm start
```

安装包脚本 `tools/build-windows-installer.ps1` 需要 Inno Setup 6.5 及以上。也可以用 `npm run package:win` 打出免安装目录（等价于 `node tools/package-windows.cjs`，需先装好 devDependencies）。桌面端已停止维护，保留源码仅作参考。

## 测试

```bash
npm test
```

`tests/` 下的测试直接跑 Node 内置的 test runner，只依赖 `node:` 模块和 `web/` 里的纯逻辑模块，**不需要安装依赖**。覆盖课表解析、周次与节次、跨节课程、变更判定、提醒、导出、请假状态与本地存储等纯逻辑部分。

原生部分另有静态检查（例如上文的 `harmony/tools/check-harmony.mjs`），它们在编译前跑，**不替代设备上的验证**；涉及系统通知、组件、日历、WebView 会话的行为仍需在设备上确认。

归档校验另有一个可选脚本 `tools/verify-manifest.ps1`：按增量清单逐项核对文件的字节数与 SHA-256，用来确认拿到的归档与交付时一致。

## 隐私与数据

- 课表、变更记录、自定义课程、提醒与设置都保存在本机。「注销并删除本机数据」或卸载应用会清除它们。
- 学校会话凭据只用于保持登录和读取课表；Android 版用 Android Keystore 加密后存在应用私有目录。
- 没有账号体系，也没有云端备份。
- 完整说明、本地存储边界与已知限制见 [SECURITY.md](SECURITY.md)。

## 许可与分发

本项目以 **GPL-3.0-or-later**（GNU 通用公共许可证第 3 版或更高版本）发布，全文见 [LICENSE](LICENSE)，原文取自 GNU 官方发布文本。

分发衍生版本时请：

- 保留 LICENSE 与版权声明，并说明代码来源；
- 按 GPL 的要求向接收者提供对应源代码；
- 改用你自己的应用名称与图标，不要用「江水课表」的名称与图标作为衍生版本的名义，也不要暗示学校或原作者为你的版本背书（详见 [NOTICE](NOTICE)）。

## 免责声明

- 本项目与学校、教务处及教务系统厂商**没有任何隶属或授权关系**，不是学校官方应用。
- 仓库内的示例与测试数据是**合成的**：`web/data/`、`harmony/fixtures/` 里的课表、教师、教室、请假记录均为占位内容，只用于演示与测试，不是任何人的真实课表。
- 应用图标由仓库内的脚本 `tools/export-client-icons.cjs` 生成；早期设计曾参考一份不在本仓库中的形象素材，其来源与授权尚未确认，详见 [NOTICE](NOTICE)。
- 课表、提醒、导出与假条状态只作个人参考；与教务系统或班级通知不一致时，以学校系统为准。
- 软件按「现状」提供，不附带任何明示或默示担保（GPL 第 15、16 条）。

## 如何参与

- **缺陷与建议**：开 Issue 说明现象、系统版本与复现步骤。不要贴真实课表、账号、Cookie、票据、校内页面截图或抓包内容。
- **安全问题**：不要开公开 Issue，请按 [SECURITY.md](SECURITY.md) 里的渠道私下报告。
- **Pull Request**：一次只做一件事；改前端逻辑时请在 `tests/` 补对应断言；新增功能需保持「无第三方运行时依赖、不上报数据、不加统计 SDK、不写回学校系统」；PR 里不需要改版本号，版本由维护者统一发布。
- **提交前自检**：`node tools/check-upload-scope.mjs` 会按白名单检查待提交文件；也不要提交任何 keystore、密码或构建产物。

## 相关文档

- [NOTIFICATIONS.md](NOTIFICATIONS.md)：Android 通知与锁屏卡片的实现说明
- [XIAOMI-NOTIFICATIONS.md](XIAOMI-NOTIFICATIONS.md)：小米聚焦通知的接入说明
- [SECURITY.md](SECURITY.md)：安全与隐私说明、漏洞上报
- [LICENSE](LICENSE)：GPL-3.0 全文；[NOTICE](NOTICE)：来源、名称、图标与第三方组件
