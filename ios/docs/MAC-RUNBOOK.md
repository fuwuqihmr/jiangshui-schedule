# Mac 首跑手册（拿到 MacBook 后按顺序做）

> 写于 2026-10-28。当前仓库状态：**P1 静态交付完成，但一行 Swift 都没有编译过**（此前只有 Windows）。
> 这份手册的唯一目标：在你的 MacBook 上，把「未编译」变成「能编译 + 能跑 + 有真实错误清单」。
> 任何一条没做，就不要对外说「能运行」。

---

## 0. 先看你现在拥有什么

| 有 | 能做什么 |
| --- | --- |
| Windows 上的完整源码（`D:/JS/pkg/02-项目源码/course-change/`） | 已通过 46 项静态门禁、52 项测试（P2 已由 CI 编译；P3 仍未编译） |
| MacBook | 能装 Xcode、能编译、能跑模拟器（**这才是真正的第一道门**） |
| 没有 Apple 开发者账号 | 模拟器随便跑；真机只能免费签名（7 天过期、最多 3 个 App） |
| 没有 iPhone（如果有更好） | 日历写入/通知/后台刷新这四项最终只有真机能定 |

---

## 1. 第 0 步：把代码搬到 Mac（三选一）

**A. 用我做好的交付包（最简单）**
`jiangshui-ios-handoff-2026-10-28.zip` → AirDrop / U 盘 / 网盘 到 Mac → 双击解压 → 得到 `jiangshui-ios/`，里面有 `ios/` 和 `web/` 两个并列目录（**必须保持并列**，工程用 `../web` 相对路径引用资源）。

**B. 自己在 Windows 打包**
```powershell
Compress-Archive -Path "D:/JS/pkg/02-项目源码/course-change/ios","D:/JS/pkg/02-项目源码/course-change/web" -DestinationPath "$env:USERPROFILE/Desktop/jiangshui-ios.zip"
```

**C. 用 git（推荐长期做法）**
```bash
cd "D:/JS/pkg/02-项目源码/course-change"
git init && git add -A && git commit -m "ios P1 handoff"
# 推到 GitHub 私有仓库，然后在 Mac 上 clone
```
> 这个项目**原本没有 git**，所以从现在开始用 git 管理是个好时机：后面每次改 Swift 都能 diff。

---

## 2. 第 1 步：装 Xcode（约 40–60 分钟，取决于网速）

1. App Store 搜 **Xcode** → 安装（当前约 12GB 下载 / 解压后 30–40GB）。
2. 首次启动，同意许可 → 输入管理员密码。
3. 终端里做三件事：
```bash
sudo xcodebuild -license accept
xcode-select -p                      # 应输出 /Applications/Xcode.app/Contents/Developer
xcodebuild -version                  # 看版本，记下来
```
4. 装 iOS 模拟器运行时（Xcode 15+ 默认可能不自带）：
```bash
xcodebuild -downloadPlatform iOS
```
或者在 Xcode → Settings → Components 里点下载。

> Xcode 版本决定 Swift 语言版本和 API 可用性。**如果你是 Xcode 16+，注意 Swift 6 并发检查会变严**——这也是我预计出现最多编译错误的地方，见第 3 步。

---

## 3. 第 2 步：跑自动引导脚本（一条命令）

```bash
cd ~/jiangshui-ios            # 你解压出来的目录
bash ios/tools/mac-first-run.sh
```

这个脚本会依次做：
1. 打印环境摘要（macOS 版本 / Xcode 路径 / Xcode 版本 / node 版本）
2. 检查工程与 `web/` 的相对位置是否对（`../web` 存在）
3. 用 Node 重新生成 `ios/Jiangshui.xcodeproj/project.pbxproj`（幂等）
4. 跑静态门禁 `ios/tools/check-ios.mjs`（46 项）
5. 跑校验器自测 `node --test ios/tests/`（52 项）
6. 用 `xcodebuild` 编译模拟器版本，把完整日志存到 `ios/build-out/first-run-*.log`
7. 从日志里抽出所有 `error:` 行去重打印

**注意：脚本需要 Node。** 如果 Mac 上没有：
```bash
brew install node
```
（没装 Homebrew 就先装：`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`）
没有 Node 也能编译——脚本会跳过第 3/4/5 步，直接用已提交的 pbxproj；但**新增 Swift 文件后必须重新生成**，否则文件不进工程。

---

## 4. 第 3 步：看编译错误（预计 10–60 个，分四类）

把 `ios/build-out/first-run-*.log` 里第一屏错误发给我，我按类修。我的预判（按概率排序）：

| 类别 | 典型报错 | 大概原因 |
| --- | --- | --- |
| **A. Swift 6 并发/Sendable** | `Capture of 'self' with non-sendable type`、`Call to main actor-isolated ... in a synchronous nonisolated context` | Xcode 16 默认 Swift 6 语言模式；我们的服务层按 Swift 5 写的 |
| **B. WKWebView / 委托签名** | `does not conform to protocol WKNavigationDelegate`、`ambiguous use of` | 手写 delegate 方法签名与 SDK 有细微差异 |
| **C. EventKit / UserNotifications** | `value of type ... has no member`、`cannot find 'X' in scope` | API 名称在 iOS 17+ 有变动（我按 iOS 16 保守写法） |
| **D. Network.framework / NWListener** | `'NWListener' cannot be constructed because it has no accessible initializers` | 初始化方式或参数类型不对 |

**如果报的是 A 类**：优先选择改 **Build Setting → Swift Language Version = 5**（而不是逐个改代码）。这不影响功能，只是关闭 Swift 6 的严格并发检查。我的建议是先这么干，把功能跑起来，再决定要不要迁移 Swift 6。

---

## 5. 第 4 步：模拟器跑通（三个必看的点）

```bash
# 脚本已经编好了 .app，也可以直接在 Xcode 里 Run
open ios/Jiangshui.xcodeproj
```
Xcode 里选 `iPhone 15`（或任意 iOS 17+）模拟器 → ▶ Run。

跑起来后**必须确认三件事**，否则后面全是白费：
1. **页面能出来**（说明 loopback HTTP 服务 + `index.html` 正常；如果白屏，先看 Xcode 控制台有没有 `NWListener` 绑定失败）
2. **`typeof window.Android === "object"`**（说明 shim 注入成功；在 Safari 远程调试里看：Safari → 开发 → 模拟器 → 页面 → 控制台）
3. **点「设置」能读出权限三行**（说明 `permissionStatus` action 通了、回包 `onNativeResult` 正常）

---

## 6. 第 5 步：P1 功能手验清单（模拟器能验的）

- [ ] 主题切换（浅色/深色/跟随系统）→ 重启 App 后仍保持
- [ ] 保存课表 → 刷新页面不丢
- [ ] 通知权限请求（允许/拒绝两条路径）
- [ ] 预览上课提醒（前台应出现横幅）
- [ ] 导出 .txt / 导出诊断日志（`江水课表-排查日志-*.txt`）
- [ ] 导入 JSON（取消时应回空对象、不报错）
- [ ] 登出 → 回到同意页，所有状态清空
- [ ] 返回键行为（页面内弹层时先关弹层）

## 7. 第 6 步：真机（有 iPhone 再做）

1. Xcode → Signing & Capabilities → 勾 `Automatically manage signing` → Team 选你的 Apple ID（免费账号即可）
2. Bundle ID `cn.local.tomorrow` 若冲突，改成 `cn.local.tomorrow.<你的后缀>`，同时改 `ios/project.yml` 并重跑生成
3. iPhone 连 Mac → 信任设备 → Run → iPhone 设置里信任开发者证书
4. 免费签名 7 天过期，到期重装即可；上架必须付费账号（¥688/年）
5. 真机专验：系统日历写入（EventKit）、本地通知在锁屏/后台的表现、杀进程后提醒是否还在、教务处网页登录

## 8. 第 7 步：要上架时（现在别做）

- 图标已是 1024×1024 与安卓最新版同款（公开仓 assets/app-icon.png，2026-11-25，见 `docs/BUILD-LOG.md` 第 21 轮）；`actool` 实际接受度待 CI 首编译确认
- 隐私清单 `PrivacyInfo.xcprivacy` 核对
- 审核说明写清楚：「学校教务系统仅支持 HTTP，故对该域配置 ATS 例外」
- 开发者账号 → App Store Connect → 创建 App（Bundle ID 不能用 `cn.local.tomorrow` 这类可能被占用的？我们已用它，若冲突改）

---

## 9. 出错时怎么把信息给我

最有用的是**完整日志**，不是截图：
```bash
cd ~/jiangshui-ios
bash ios/tools/mac-first-run.sh 2>&1 | tee ~/Desktop/first-run.log
# 然后把 ~/Desktop/first-run.log 发我
```
或者只发错误行：
```bash
grep -E "error:" ios/build-out/first-run-*.log | sort -u | head -50
```

## 10. 预期工时

| 阶段 | 预计 |
| --- | --- |
| 装 Xcode + 模拟器 runtime | 1–2 小时（看网速） |
| 首次编译 + 修错误 | 0.5–1 天（如果 Xcode 16 + Swift 6，可能更久） |
| 模拟器跑通三件事 | 0.5 天 |
| 真机（有 iPhone） | 0.5 天 |
| 上架材料 + 审核 | 1–2 周（含苹果审核） |

> 一句话：**Mac 到手后第一件事不是跑 App，而是拿到第一份编译错误清单。** 那份清单决定后面所有工作。
