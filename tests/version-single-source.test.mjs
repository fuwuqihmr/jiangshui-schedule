import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 版本号单点（single source of truth）：仓库根 package.json 是唯一真源。
//   version            -> Android versionName / npm / 发布 tag（v<version>）
//   android.versionCode-> Android versionCode
// 其它消费方只允许「读取」或「断言与真源一致」，不允许再写一份需要手工同步的版本字面量。
// 本文件是行为/契约测试：直接读取真实文件，不依赖 JDK，可在干净 checkout 与 CI 中运行。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');
const pkg = JSON.parse(read('package.json'));
const pkgVersion = pkg.version;
const pkgVersionCode = pkg.android?.versionCode;

test('package.json 是版本唯一真源：version 与 android.versionCode 均存在且格式有效', () => {
  assert.match(pkgVersion, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.]*)?$/, 'version 必须是 主.次.修订 形式（不带前导 v），允许 -rcN/-betaN 预发布后缀（对齐 RELEASE-POLICY 的 rc/beta 流程）');
  assert.equal(Number.isInteger(pkgVersionCode), true, 'package.json 必须提供整数 android.versionCode');
  assert.ok(pkgVersionCode >= 1 && pkgVersionCode <= 2147483647, 'android.versionCode 必须在 1..2147483647');
});

test('package-lock.json 两个根版本字段与 package.json 一致（由 npm 生成，不得手改）', () => {
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, pkgVersion, 'package-lock.json version 漂移；运行 npm install --package-lock-only 同步');
  assert.equal(lock.packages?.['']?.version, pkgVersion, 'package-lock.json packages[""].version 漂移');
});

test('android/app/build.gradle 的字面量必须与 package.json 真源相等', () => {
  const gradle = read('android/app/build.gradle');
  const codeMatch = /\bversionCode\s+(\d+)/.exec(gradle);
  const nameMatch = /\bversionName\s+'([^']+)'/.exec(gradle);
  assert.ok(codeMatch, 'build.gradle 必须声明 versionCode');
  assert.ok(nameMatch, 'build.gradle 必须声明 versionName');
  assert.equal(Number(codeMatch[1]), pkgVersionCode, 'build.gradle versionCode 与 package.json android.versionCode 不一致');
  assert.equal(nameMatch[1], pkgVersion, 'build.gradle versionName 与 package.json version 不一致');
});

test('tools/build-android.ps1 不内置版本默认值，未传参时从 package.json 读取', () => {
  const script = read('tools/build-android.ps1');
  assert.doesNotMatch(script, /\[int\]\$VersionCode\s*=\s*[1-9]\d*/, '构建脚本不得硬编码 versionCode 默认值');
  assert.doesNotMatch(script, /\[string\]\$VersionName\s*=\s*'[^']+'/, '构建脚本不得硬编码 versionName 默认值');
  assert.match(script, /package\.json/, '构建脚本必须读取 package.json');
  assert.match(script, /android\.versionCode/, '构建脚本必须读取 package.json 的 android.versionCode');
  assert.match(script, /PSBoundParameters/, '显式传入的 -VersionCode/-VersionName 仍应覆盖真源');
});

test('CI 工作流不内置版本默认值，版本从 package.json 解析，且真跑测试与门禁', () => {
  const workflow = read('.github/workflows/android.yml');
  assert.doesNotMatch(workflow, /github\.event\.inputs/, 'CI 不得再要求/使用手工填写的版本输入');
  assert.doesNotMatch(workflow, /default:\s*'?[0-9]+\.[0-9]+\.[0-9]+'?/, 'CI 不得内置版本号默认值');
  assert.match(workflow, /package\.json/, 'CI 必须从 package.json 解析版本');
  assert.match(workflow, /android\.versionCode/, 'CI 必须读取 package.json 的 android.versionCode');
  assert.match(workflow, /node --test tests/, 'CI 必须真跑 node --test');
  assert.match(workflow, /check-upload-scope\.mjs/, 'CI 必须跑上传范围守卫');
  assert.match(workflow, /check-data-gate\.mjs --apk/, 'CI 必须跑 APK 数据门禁');
  assert.doesNotMatch(workflow, /--normalize-crlf/, 'CI 必须用严格模式，不得放宽 CRLF 差异');
});

test('README 不再复制会随发布变化的版本号字面量（版本以 package.json / Releases 为准）', () => {
  const readme = read('README.md');
  assert.equal(readme.includes(pkgVersion), false, `README 不得写死当前版本号 ${pkgVersion}（改为指向 Releases / package.json）`);
  assert.doesNotMatch(readme, new RegExp('versionCode\\s*' + pkgVersionCode + '\\b'), `README 不得写死当前 versionCode ${pkgVersionCode}`);
  assert.match(readme, /package\.json/, 'README 应指出版本号唯一真源是 package.json');
  // 历史版本（如 v1.3.4-rc1 / versionCode 52）是固定事实，不随当前版本变化，允许保留。
});
