# 版本更新规则（2026-10-18 用户确认）

版本号结构：`主版本.次版本.修订[-betaN | -rcN]`，例如 `1.2.0`、`1.2.1-rc1`、`1.3.0-beta2`。

| 变更类型 | 编号规则 | 示例 |
| --- | --- | --- |
| **主版本**（第一位） | **只有用户明确提出时才更新**，日常开发不得自行进位 | `1.x` → `2.0.0`（用户要求才做） |
| **较大体量功能** | **次版本** +1 | `1.2.0` → `1.3.0` |
| **小功能** | **修订** +1 | `1.2.0` → `1.2.1` |
| **小修补 / 修复** | 用 `-rc1`、`-rc2`、`-rc3`… 递增，确认后转正式 | `1.2.1-rc1` → `1.2.1-rc2` → `1.2.1` |
| **某项功能的测试开发** | 用 `-beta1`、`-beta2`… 递增 | `1.3.0-beta1` → `1.3.0-beta2` → `1.3.0` |

补充约定：

- 判断顺序：先看是不是新功能（是 → 小功能进修订位、较大功能进次版本位），再看是不是修 bug（是 → `-rcN`），最后看是不是「某项功能还在测试开发」（是 → `-betaN`）。
- 正式版不带后缀；`beta` / `rc` 序号只在对应阶段内递增，进入下一阶段重新从 1 开始。
- `versionCode` 每次交付都递增，与版本名无关，保证覆盖安装。
- APK 文件名、npm 版本、更新说明、README、增量清单统一使用完整版本字符串。
- **版本号唯一真源**：仓库根 `package.json` —— `version` 即 versionName / npm 版本 / 发布 tag（`v<version>`），`android.versionCode` 即 versionCode。`android/app/build.gradle` 保留 Gradle 路径所需的字面量，但测试断言它必须与真源相等；`tools/build-android.ps1` 与 CI 工作流直接读取 `package.json`；README 不再重复记录当前版本号。改版本只改 `package.json`（`package-lock.json` 由 npm 同步），一致性由 `tests/version-single-source.test.mjs` 在 `npm test` 与 CI 中守门。
- 本规则自 2026-10-18 起执行；1.2.0 预发布序列（beta1–beta10、rc1–rc3）为历史，不再追改。

## 当前状态

- 当前版本 **1.5.2**（versionCode **69**，发布 tag `v1.5.2`）：正式版（实验课上课表：读取与解析、今日/完整课表亮蓝卡片展示、冲突双卡实验优先，仅应用内；小组件/导出/日历暂未接入），由 CI 构建并用固定证书签名；GitHub Release 发布为正式版（占用 latest）。
- 版本号唯一真源为仓库根 `package.json`：`version=1.5.2`、`android.versionCode=69`；Gradle、构建脚本、CI、README 与测试均从该文件读取或断言一致，不再各写一份需要手工同步的字面量。
- 历史版本状态（1.3.0 / 1.3.1 系列与 1.4.0 预发布序列）见 `DECISIONS.md` 与 `ANDROID-CHANGELOG.md`；本文件只保留版本规则与当前状态。
- 下一版本号由维护者按修订单点递增，交付时只改 `package.json`（`android.versionCode` 同步 +1）。