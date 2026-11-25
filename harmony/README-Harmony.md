# 江水课表 HarmonyOS 工程骨架（P0）

本目录是独立的 HarmonyOS NEXT（Stage 模型）工程，**不改动** `web/`、`android/`、`desktop/`、`tests/`。
当前仅 P0 骨架：未安装 HarmonyOS SDK、未编译、未运行；静态检查通过不代表可编译。

## 目录约定

- `AppScope/`：bundleName、版本、应用级资源。
- `entry/src/main/ets/core/`：纯 ArkTS 类型与契约，禁止 import `pages/`、`platform/` 或 Kit。
- `entry/src/main/ets/data/`：状态仓库接口与 P1 实现入口。
- `entry/src/main/ets/platform/`：Kit 适配层；P0 只提供 `*Unavailable` 降级实现。
- `entry/src/main/ets/pages/`：ArkUI 页面壳；只组合 UI，不直接做 IO。
- `entry/src/main/ets/theme/`、`util/`：主题 token 与脱敏日志。
- `entry/src/main/resources/`：全部中文文案与颜色/尺寸资源。

依赖方向固定为：`core -> data -> platform -> pages`，禁止反向 import。

## Kit 白名单口径（P0）

- 允许：`@kit.AbilityKit`、`@kit.ArkUI`（仅 EntryAbility/页面壳使用）。
- `EntryAbility` 已移除 `@kit.BasicServicesKit`；其余 Kit 只在 `platform/` 对应阶段引入。
- 未接入能力的平台服务在 P0 一律返回 `*_UNAVAILABLE`，不崩溃、不静默改行为。

## 构建分支 A/B

### 分支 B（当前默认，只能静态检查）

本机没有官方 HarmonyOS SDK/DevEco，禁止声称“已编译/已运行”。可用 Node 静态检查工具（由 tester 提供）：

```bash
node tools/check-harmony.mjs
```

### 分支 A（取得官方 command-line-tools + SDK 后）

在 DevEco 或官方 hvigor 环境中执行：

```bash
ohpm install
hvigorw clean
hvigorw --mode module -p product=default assembleHap
hvigorw test
```

产物、签名与真机安装另行验收；本 P0 目录不伪造构建结果。

## 版本与配置

- bundleName：`cn.local.tomorrow`
- versionName: `1.0.0`
- versionCode: `1`（鸿蒙线独立版本，不沿用 Android）
- 单 HAP、单 UIAbility、API 12
- 仅声明 `ohos.permission.INTERNET`；日历、通知、后台权限留到 P3/P6 按需申请

## 待确认（不猜 API）

- Calendar Kit / Reminder Agent Kit / PDF Kit / WorkScheduler 在 API 12 的能力与导入名。
- UIAbility 生命周期、`windowStage.loadContent`、`Navigation` + `NavPathStack` 的最终写法。
- Web 组件 Cookie/CAS 重定向与 `JavaScriptProxy` 细节。
- 应用图标、签名、DevEco 工程模板字段。

> 说明：`.json` 资源文件受 JSON 语法限制不能写注释；职责说明放在本 README 与对应 `.ets/.json5` 文件头中。
