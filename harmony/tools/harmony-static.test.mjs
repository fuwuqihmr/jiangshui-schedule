import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runChecks } from './check-harmony.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-harmony.mjs');
const BUILD_GATE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-gate.mjs');

// 72x72 白色 PNG；仅用于夹具，验证 icon magic/尺寸。
const PNG_72 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAYAAABV7bNHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACiSURBVHhe7dChAQAgDMCw/f806CHoA4ms7By+5g1sBgWDgkHBoGBQMCgYFAwKBgWDgkHBoGBQMCgYFAwKBgWDgkHBoGBQMCgYFAwKBgWDgkHBoGBQMCgYFAwKBgWDgkHBoGBQMCgYFAwKBgWDgkHBoGBQMCgYFAwKBgWDgkHBoGBQMCgYFAwKBgWDgkHBoGBQMCgYFAwKBgWDgkHBoGBQMChcmgCzscT4br8AAAAASUVORK5CYII=', 'base64');

const CONTRACTS = `
export interface CalendarEvent {
  key: string; title: string; location: string; description: string;
  startMillis: number; endMillis: number; startDate: string;
  startTime: string; endTime: string; source: string;
}
export interface CalendarSyncResult {
  ok: boolean; written: number; deleted: number; failed: number;
  skipped: number; calendarId: string; lastSyncAt: number;
  lastEventCount: number; remainingEventIds?: number[];
}
export interface AppState {
  version: number; snapshot: SemesterSnapshot | null; events: unknown[];
  overrides: Map<string, unknown>; localMaps: Map<string, string>;
  holidaySettings: unknown | null; courseSettings: unknown;
  customCourses: unknown[]; theme: string; showDayOverview: boolean;
  settingsExpanded: unknown; calendarOptions: unknown;
  notificationEnabled: boolean; classReminders: unknown;
  autoCheckEnabled: boolean; lastSuccess: number; lastAttempt: number;
  error: string | null;
}
export interface SemesterSnapshot {
  id: string; name: string; startDate: string; weeks: number;
  rules: unknown[]; source: unknown;
}
export interface CourseRow {
  key: string; date: string; startTime: string; endTime: string;
  periods: number[]; name: string; teacher: string; room: string;
  cancelled: boolean; vacant: boolean; localActivity: boolean;
  customCourse: boolean; remapId: string | null; conflict: boolean;
  overlap: boolean; source: string; originDate: string | null;
}
export interface LeaveRecord {
  id: string; type: string; status: string; startDate: string;
  startTime: string; endDate: string; endTime: string; reason: string;
  approver: string; comment: string; rawStatus: string;
  semesterId: string; demo: boolean;
}
export interface ExportResult {
  uri: string; mime: string; bytes: number; pages: number;
}
`;

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony-static-'));
  write(root, 'AppScope/app.json5', `{
  "app": {
    "bundleName": "cn.local.tomorrow",
    "versionCode": 49,
    "versionName": "1.3.1-rc2",
    "icon": "$media:app_icon"
  }
}`);
  write(root, 'AppScope/resources/base/element/string.json', JSON.stringify({ string: [{ name: 'app_name', value: '江水课表' }, { name: 'permission_internet_reason', value: '用于读取学校课表' }] }));
  write(root, 'build-profile.json5', `{ "app": { "products": [{ "name": "default" }] } }`);
  write(root, 'oh-package.json5', `{ "name": "course-change", "version": "1.0.0", "dependencies": {} }`);
  write(root, 'entry/build-profile.json5', `{ "app": { "apiType": "stageMode", "products": [{ "name": "default" }] } }`);
  write(root, 'entry/oh-package.json5', `{ "name": "entry", "version": "1.0.0", "dependencies": {} }`);
  write(root, 'entry/src/main/module.json5', `{
  "module": {
    "name": "entry",
    "type": "entry",
    "pages": "$profile:main_pages",
    "abilities": [
      { "name": "EntryAbility", "srcEntry": "./ets/entryability/EntryAbility.ets", "icon": "$media:app_icon", "startWindowIcon": "$media:app_icon" }
    ],
    "requestPermissions": [
      { "name": "ohos.permission.INTERNET", "reason": "$string:permission_internet_reason" }
    ]
  }
}`);
  write(root, 'entry/src/main/ets/entryability/EntryAbility.ets', `export default class EntryAbility {}\n`);
  write(root, 'entry/src/main/ets/pages/Index.ets', `@Entry
@Component
struct Index {
  build() {
    Column() {
      Text($r('app.string.app_name'))
    }
  }
}
`);
  write(root, 'entry/src/main/ets/pages/SettingsPage.ets', `@Component
struct SettingsPage {
  build() {
    Column() {
      Text($r('app.string.app_name'))
    }
  }
}
`);
  write(root, 'entry/src/main/ets/core/types/contracts.ets', CONTRACTS);
  write(root, 'entry/src/main/ets/core/types/Common.ets', `export enum ErrorCode {
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  CALENDAR_UNAVAILABLE = 'CALENDAR_UNAVAILABLE',
  BACKGROUND_UNAVAILABLE = 'BACKGROUND_UNAVAILABLE',
  DIAGNOSTICS_UNAVAILABLE = 'DIAGNOSTICS_UNAVAILABLE',
  EXPORT_UNAVAILABLE = 'EXPORT_UNAVAILABLE',
  STATE_WRITE_FAILED = 'STATE_WRITE_FAILED',
  WEB_UNAVAILABLE = 'WEB_UNAVAILABLE'
}
`);
  write(root, 'entry/src/main/ets/core/types/Services.ets', `export interface PermissionService {
  status(): Promise<unknown>;
  requestCalendar(): Promise<unknown>;
  requestNotification(): Promise<unknown>;
  openSystemSettings(kind: string): Promise<void>;
}
export interface DiagnosticsService {
  snapshot(): Promise<unknown>;
  exportText(): Promise<unknown>;
}
export interface PreferencesStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
`);
  write(root, 'entry/src/main/ets/core/.keep', '');
  write(root, 'entry/src/main/ets/data/.keep', '');
  write(root, 'entry/src/main/ets/platform/.keep', '');
  write(root, 'entry/src/main/resources/base/element/string.json', JSON.stringify([
    { name: 'app_name', value: '江水课表' },
  ]));
  write(root, 'entry/src/main/resources/base/element/color.json', JSON.stringify([
    { name: 'bg', value: '#ffffff' },
  ]));
  write(root, 'entry/src/main/resources/base/element/float.json', JSON.stringify([
    { name: 'gap', value: '8vp' },
  ]));
  write(root, 'entry/src/main/resources/dark/element/color.json', JSON.stringify([
    { name: 'bg', value: '#000000' },
  ]));
  write(root, 'entry/src/main/resources/base/media/.keep', '');
  fs.writeFileSync(path.join(root, 'entry/src/main/resources/base/media/app_icon.png'), PNG_72);
  write(root, 'entry/src/main/resources/base/profile/main_pages.json', JSON.stringify({
    src: ['pages/Index'],
  }));
  write(root, 'README-Harmony.md', 'versionName: 1.3.1-rc2\nversionCode: 49\n');
  return root;
}

function cleanup(root) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
}

function failMessages(result) {
  return result.items.filter((x) => x.severity === 'FAIL').map((x) => `${x.check}: ${x.message}`);
}

test('1) 结构齐备的最小工程通过（exit 0）', () => {
  const root = makeFixture();
  try {
    const result = runChecks(root);
    assert.equal(result.counts.fail, 0, failMessages(result).join('\n'));
    assert.equal(result.exitCode, 0);
  } finally { cleanup(root); }
});

test('2) 缺 app.json5 → 失败', () => {
  const root = makeFixture();
  try {
    fs.rmSync(path.join(root, 'AppScope/app.json5'));
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('app.json5')));
  } finally { cleanup(root); }
});

test('3) 引用不存在的 string 键 → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/pages/Index.ets', `@Entry
@Component
struct Index {
  build() {
    Column() {
      Text($r('app.string.not_defined'))
    }
  }
}
`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('not_defined')));
  } finally { cleanup(root); }
});

test('4) 页面中文硬编码 → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/pages/Index.ets', `@Entry
@Component
struct Index {
  build() {
    Column() {
      Text('你好')
    }
  }
}
`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('中文')));
  } finally { cleanup(root); }
});

test('5) any → 失败；同行 static-check-allow 放行', () => {
  const root = makeFixture();
  try {
    const bad = path.join(root, 'entry/src/main/ets/core/AnyBad.ets');
    write(root, 'entry/src/main/ets/core/AnyBad.ets', 'const value: any = 1;\n');
    let result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('any')));

    fs.writeFileSync(bad, 'const value: any = 1; // static-check-allow\n', 'utf8');
    result = runChecks(root);
    assert.equal(result.items.filter((x) => x.severity === 'FAIL' && x.check === 'redlines').length, 0);
  } finally { cleanup(root); }
});

test('6) core import pages → 依赖方向失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/core/leak.ets', `import Index from '../pages/Index';\nexport const x = Index;\n`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('core') && m.includes('pages')));
  } finally { cleanup(root); }
});

test('7) 权限缺 reason → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/module.json5', `{
  "module": {
    "name": "entry",
    "type": "entry",
    "requestPermissions": [
      { "name": "ohos.permission.INTERNET" }
    ]
  }
}`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('reason')));
  } finally { cleanup(root); }
});

test('8) --json 输出可解析且 exit 0', () => {
  const root = makeFixture();
  try {
    const out = spawnSync(process.execPath, [SCRIPT, '--root', root, '--json'], {
      encoding: 'utf8',
    });
    assert.equal(out.status, 0, out.stderr || out.stdout);
    const parsed = JSON.parse(out.stdout);
    assert.equal(parsed.staticOnly, true);
    assert.equal(parsed.compiled, false);
    assert.equal(parsed.counts.fail, 0);
    assert.ok(Array.isArray(parsed.checkedCategories));
    assert.equal(parsed.checkedCategories.length, 12);
  } finally { cleanup(root); }
});

test('9) 图标引用缺 media 文件 → 失败', () => {
  const root = makeFixture();
  try {
    fs.rmSync(path.join(root, 'entry/src/main/resources/base/media/app_icon.png'));
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('图标') || m.includes('app_icon')));
  } finally { cleanup(root); }
});

test('10) platform 出现 NOT_IMPLEMENTED → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/calendar/BadGateway.ets', `export class BadGateway {
  run(): Promise<void> {
    return Promise.reject(new Error(ErrorCode.NOT_IMPLEMENTED));
  }
}
`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('NOT_IMPLEMENTED')));
  } finally { cleanup(root); }
});

test('11) pages 直接 import Kit → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/pages/Index.ets', `import { UIAbility } from '@kit.AbilityKit';
export const ability = UIAbility;
`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('kit') && m.includes('不得直接 import')));
  } finally { cleanup(root); }
});

test('12) platform 使用白名单外 Kit → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/bad/BadKit.ets', `import { thing } from '@kit.UnknownKit';
export const value = thing;
`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('白名单') && m.includes('UnknownKit')));
  } finally { cleanup(root); }
});

test('13) 契约方法返回 any/Object/object[] → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/bad/BadReturn.ets', `export class BadReturn {
  load(): any {
    return 1;
  }
}
`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('返回类型') && m.includes('any')));
  } finally { cleanup(root); }
});

test('14) README 反引号包裹版本号不误报', () => {
  const root = makeFixture();
  try {
    write(root, 'README-Harmony.md', '- versionName: `1.3.1-rc2`\n- versionCode: `49`\n');
    const result = runChecks(root);
    assert.equal(result.counts.fail, 0, failMessages(result).join('\n'));
    assert.equal(result.items.filter((x) => x.check === 'version' && x.severity === 'WARN').length, 0);
  } finally { cleanup(root); }
});

test('15) ability srcEntry 指向不存在的文件 → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/module.json5', `{
  "module": {
    "name": "entry", "type": "entry", "pages": "$profile:main_pages",
    "abilities": [{ "name": "EntryAbility", "srcEntry": "./ets/entryability/Missing.ets" }]
  }
}`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('srcEntry') && m.includes('不存在')));
  } finally { cleanup(root); }
});

test('16) main_pages 指向不存在的页面 → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/resources/base/profile/main_pages.json', JSON.stringify({ src: ['pages/Index', 'pages/Missing'] }));
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('main_pages') && m.includes('不存在')));
  } finally { cleanup(root); }
});

test('17) entryability import 非 AbilityKit/ArkUI → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/entryability/EntryAbility.ets', `import { Calendar } from '@kit.CalendarKit';
export const value = Calendar;
`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('entryability') && m.includes('CalendarKit')));
  } finally { cleanup(root); }
});

test('18) platform 手写拼错 *_UNAVAILABLE（不在 Common 集合）→ 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/bad/BadCode.ets', `export class BadCode {
  run(): Promise<void> {
    return Promise.reject(new Error(ErrorCode.CALNDAR_UNAVAILABLE));
  }
}
`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('CALNDAR_UNAVAILABLE') && m.includes('Common')));
  } finally { cleanup(root); }
});

test('19) 图标 PNG magic 不合法 → 失败', () => {
  const root = makeFixture();
  try {
    fs.writeFileSync(path.join(root, 'entry/src/main/resources/base/media/app_icon.png'), 'not-a-png');
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('PNG') && m.includes('magic')));
  } finally { cleanup(root); }
});

test('20) 图标尺寸非 72x72 → 警告', () => {
  const root = makeFixture();
  try {
    const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    fs.writeFileSync(path.join(root, 'entry/src/main/resources/base/media/app_icon.png'), png1);
    const result = runChecks(root);
    assert.equal(result.counts.fail, 0, failMessages(result).join('\n'));
    assert.ok(result.items.some((x) => x.check === 'icons' && x.severity === 'WARN' && x.message.includes('1x1')));
  } finally { cleanup(root); }
});

test('21) 缺少新服务契约 PermissionService → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/core/types/Services.ets', `export interface DiagnosticsService {
  snapshot(): Promise<unknown>;
  exportText(): Promise<unknown>;
}
export interface PreferencesStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
`);
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('PermissionService')));
  } finally { cleanup(root); }
});

test('22) ohosTest 的 @ohos/hypium 与中文用例标题不误报', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/ohosTest/ets/test/Sample.test.ets', `import { describe, it, expect } from '@ohos/hypium';
export default function sampleTest() {
  describe('示例', () => {
    it('中文用例标题', 0, () => { expect(1).assertEqual(1); });
  });
}
`);
    const result = runChecks(root);
    assert.equal(result.counts.fail, 0, failMessages(result).join('\n'));
  } finally { cleanup(root); }
});

test('23) 降级码回归：字面量常量（值合法）→ 通过', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/codes/Codes.ets', 'const LOGIN_WEB_UNAVAILABLE: string = \'WEB_UNAVAILABLE\';\nexport class Codes {\n  run(): Promise<void> {\n    return Promise.reject(new Error(LOGIN_WEB_UNAVAILABLE));\n  }\n}\n');
    const result = runChecks(root);
    assert.equal(result.counts.fail, 0, failMessages(result).join('\n'));
    assert.equal(result.items.filter((x) => x.severity === 'FAIL' && x.check === 'degraded').length, 0);
  } finally { cleanup(root); }
});

test('24) 降级码回归：常量值是 enum 成员但不以 _UNAVAILABLE 结尾 → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/codes/Codes.ets', 'const LOGIN_WEB_UNAVAILABLE: string = \'STATE_WRITE_FAILED\';\nexport class Codes {\n  run(): Promise<void> {\n    return Promise.reject(new Error(LOGIN_WEB_UNAVAILABLE));\n  }\n}\n');
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('STATE_WRITE_FAILED') && m.includes('_UNAVAILABLE')));
  } finally { cleanup(root); }
});

test('25) 降级码回归：常量别名引用 enum 成员（含链式别名）→ 通过', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/codes/Codes.ets', 'const BASE_CODE: string = ErrorCode.WEB_UNAVAILABLE;\nconst ALIAS_CODE_UNAVAILABLE = BASE_CODE;\nexport class Codes {\n  run(): Promise<void> {\n    return Promise.reject(new Error(ALIAS_CODE_UNAVAILABLE));\n  }\n}\n');
    const result = runChecks(root);
    assert.equal(result.counts.fail, 0, failMessages(result).join('\n'));
  } finally { cleanup(root); }
});

test('26) 降级码回归：无声明且不在 enum 的 token → 失败', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/codes/Codes.ets', 'export class Codes {\n  run(): Promise<void> {\n    return Promise.reject(new Error(ErrorCode.NOPE_UNAVAILABLE));\n  }\n}\n');
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('NOPE_UNAVAILABLE') && m.includes('Common')));
  } finally { cleanup(root); }
});

function dependencyFails(result) {
  return result.items.filter((x) => x.severity === 'FAIL' && x.check === 'dependencies');
}

test('27) import/export 回归：named import 目标未导出 → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/codes/Good.ets', 'export const GOOD = 1;\n');
    write(root, 'entry/src/main/ets/platform/codes/BadNamed.ets', "import { MissingThing } from './Good';\nexport const X = 1;\n");
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(dependencyFails(result).some((x) => x.message.includes('MissingThing') && x.message.includes('./Good')));
  } finally { cleanup(root); }
});

test('28) import/export 回归：相对 import 目标文件不存在 → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/codes/BadFile.ets', "import { X } from './Nope';\nexport const Y = 1;\n");
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(dependencyFails(result).some((x) => x.message.includes('目标文件不存在') && x.message.includes('./Nope')));
  } finally { cleanup(root); }
});

test('29) import/export 回归：default import 但目标无 default 导出 → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/codes/Good.ets', 'export const GOOD = 1;\n');
    write(root, 'entry/src/main/ets/platform/codes/BadDefault.ets', "import NotThere from './Good';\nexport const X = 1;\n");
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(dependencyFails(result).some((x) => x.message.includes('default') && x.message.includes('./Good')));
  } finally { cleanup(root); }
});

test('30) import/export 回归：re-export 的名字目标未导出 → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/codes/Good.ets', 'export const GOOD = 1;\n');
    write(root, 'entry/src/main/ets/platform/codes/BadReexport.ets', "export { Nope } from './Good';\n");
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(dependencyFails(result).some((x) => x.message.includes('Nope') && x.message.includes('re-export')));
  } finally { cleanup(root); }
});

test('31) import/export 回归：合法 named/default/struct 导入 → 通过（防误报）', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/platform/codes/Good.ets', 'export interface GoodShape { x: number }\nexport struct GoodView {\n  build() {}\n}\nexport const GOOD = 1;\nexport const GOOD_UNAVAILABLE: string = ErrorCode.WEB_UNAVAILABLE;\nexport default class GoodDefault {}\n');
    write(root, 'entry/src/main/ets/platform/codes/OkImports.ets', "import GoodDefault, { GoodShape, GoodView, GOOD } from './Good';\nimport type { GoodShape as Alias } from './Good';\nexport type Use = GoodShape | Alias;\nexport const N = GOOD;\nexport const OK_UNAVAILABLE: string = ErrorCode.WEB_UNAVAILABLE;\n");
    const result = runChecks(root);
    assert.equal(result.counts.fail, 0, failMessages(result).join('\n'));
  } finally { cleanup(root); }
});
test('32) resource-requests 请求键未合入 string.json → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'tools/resource-requests/harmony-guard.json', JSON.stringify({ req_missing: '请求值' }));
    const result = runChecks(root, { strict: true });
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('未合入') && m.includes('req_missing')));
  } finally { cleanup(root); }
});

test('33) resource-requests 已合入且值一致 → 通过', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/resources/base/element/string.json', JSON.stringify([
      { name: 'app_name', value: '江水课表' },
      { name: 'req_ok', value: '请求值' },
    ]));
    write(root, 'tools/resource-requests/harmony-guard.json', JSON.stringify({ req_ok: '请求值' }));
    const result = runChecks(root);
    assert.equal(result.counts.fail, 0, failMessages(result).join('\n'));
  } finally { cleanup(root); }
});

test('34) resource-requests 跨文件重复请求键 → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/resources/base/element/string.json', JSON.stringify([
      { name: 'app_name', value: '江水课表' },
      { name: 'dup_key', value: '重复' },
    ]));
    write(root, 'tools/resource-requests/a.json', JSON.stringify({ dup_key: '重复' }));
    write(root, 'tools/resource-requests/b.json', JSON.stringify({ dup_key: '重复' }));
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('重复请求资源键') && m.includes('dup_key')));
  } finally { cleanup(root); }
});

test('35) resource-requests JSON 非法 → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'tools/resource-requests/bad.json', '{ not valid json ');
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('resource-requests 文件 JSON 解析失败')));
  } finally { cleanup(root); }
});

test('36) 权限 reason 的 $string 键未定义 → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/module.json5', JSON.stringify({
      module: {
        name: 'entry',
        type: 'entry',
        pages: '$profile:main_pages',
        abilities: [{ name: 'EntryAbility', srcEntry: './ets/entryability/EntryAbility.ets' }],
        requestPermissions: [{ name: 'ohos.permission.INTERNET', reason: '$string:missing_reason' }],
      },
    }, null, 2));
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('reason 资源键') && m.includes('missing_reason')));
  } finally { cleanup(root); }
});

test('37) features 孤儿文件 → FAIL；被 pages import 后通过', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/ets/features/Orphan.ets', 'export const Orphan = 1;\n');
    write(root, 'entry/src/main/ets/features/Used.ets', 'export const Used = 1;\n');
    write(root, 'entry/src/main/ets/pages/Index.ets', "import { Used } from '../features/Used';\n@Entry\n@Component\nstruct Index {\n  build() {\n    Column() {\n      Text($r('app.string.app_name'))\n      Text(String(Used))\n    }\n  }\n}\n");
    let result = runChecks(root, { strict: true });
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('features') && m.includes('孤儿') && m.includes('Orphan.ets')));
    assert.ok(!failMessages(result).some((m) => m.includes('Used.ets')));
    fs.rmSync(path.join(root, 'entry/src/main/ets/features/Orphan.ets'));
    result = runChecks(root);
    assert.equal(result.counts.fail, 0, failMessages(result).join('\n'));
  } finally { cleanup(root); }
});

test('38) string.json 非法 JSON → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'entry/src/main/resources/base/element/string.json', '{ invalid');
    const result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('string.json JSON 解析失败')));
  } finally { cleanup(root); }
});

test('39) 开发模式默认降级：未合并资源请求与 features 孤儿为 WARN（含数量与清单），strict 仍 FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'tools/resource-requests/harmony-guard.json', JSON.stringify({ req_a: '值 A', req_b: '值 B' }));
    write(root, 'entry/src/main/ets/features/Orphan.ets', 'export const Orphan = 1;\n');
    let result = runChecks(root);
    assert.equal(result.exitCode, 0, failMessages(result).join('\n'));
    assert.equal(result.strict, false);
    assert.equal(result.mode, 'dev');
    const warns = result.items.filter((x) => x.severity === 'WARN').map((x) => x.check + ': ' + x.message);
    assert.ok(warns.some((m) => m.includes('2 个键未合入') && m.includes('req_a') && m.includes('req_b') && m.includes('harmony-guard.json')), warns.join('\n'));
    assert.ok(warns.some((m) => m.includes('1 个孤儿文件') && m.includes('features/Orphan.ets')), warns.join('\n'));

    result = runChecks(root, { strict: true });
    assert.equal(result.exitCode, 1);
    assert.equal(result.strict, true);
    assert.equal(result.mode, 'strict');
    assert.ok(failMessages(result).some((m) => m.includes('未合入') && m.includes('req_a')));
    assert.ok(failMessages(result).some((m) => m.includes('孤儿') && m.includes('Orphan.ets')));
  } finally { cleanup(root); }
});

test('40) CLI 开关：默认开发模式 exit 0，--strict 与 HARMONY_STRICT=1 均 exit 1，usage 含开关', () => {
  const root = makeFixture();
  try {
    write(root, 'tools/resource-requests/harmony-guard.json', JSON.stringify({ req_cli: '值' }));
    write(root, 'entry/src/main/ets/features/Orphan.ets', 'export const Orphan = 1;\n');
    const cleanEnv = { ...process.env };
    delete cleanEnv.HARMONY_STRICT;
    const base = [SCRIPT, '--root', root, '--json'];

    let r = spawnSync(process.execPath, base, { encoding: 'utf8', env: cleanEnv });
    assert.equal(r.status, 0, r.stderr);
    let payload = JSON.parse(r.stdout);
    assert.equal(payload.strict, false);
    assert.equal(payload.mode, 'dev');
    assert.ok(payload.counts.warn >= 2, JSON.stringify(payload.counts));

    r = spawnSync(process.execPath, [...base, '--strict'], { encoding: 'utf8', env: cleanEnv });
    assert.equal(r.status, 1, r.stderr);
    payload = JSON.parse(r.stdout);
    assert.equal(payload.strict, true);
    assert.ok(payload.counts.fail >= 2, JSON.stringify(payload.counts));

    r = spawnSync(process.execPath, base, { encoding: 'utf8', env: { ...cleanEnv, HARMONY_STRICT: '1' } });
    assert.equal(r.status, 1, r.stderr);
    payload = JSON.parse(r.stdout);
    assert.equal(payload.strict, true);
    assert.ok(payload.counts.fail >= 2, JSON.stringify(payload.counts));

    r = spawnSync(process.execPath, [SCRIPT, '--help'], { encoding: 'utf8', env: cleanEnv });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('--strict'));
    assert.ok(r.stdout.includes('HARMONY_STRICT'));
  } finally { cleanup(root); }
});

test('41) 开发模式：$r 引用已登记未合并键 → WARN；未登记键 → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'tools/resource-requests/harmony-guard.json', JSON.stringify({ req_registered: '登记值' }));
    write(root, 'entry/src/main/ets/pages/ResourceUse.ets', "export const REGISTERED = $r('app.string.req_registered');\n");
    let result = runChecks(root);
    assert.equal(result.exitCode, 0, failMessages(result).join('\n'));
    const warns = result.items.filter((x) => x.severity === 'WARN').map((x) => x.check + ': ' + x.message);
    assert.ok(warns.some((m) => m.includes('引用了尚未合入 string.json 的资源键') && m.includes('string.req_registered') && m.includes('共 1 个')), warns.join('\n'));

    write(root, 'entry/src/main/ets/pages/ResourceMissing.ets', "export const MISSING = $r('app.string.req_unregistered');\n");
    result = runChecks(root);
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('引用了不存在的资源键 string.req_unregistered')));
    assert.ok(!failMessages(result).some((m) => m.includes('string.req_registered')), failMessages(result).join('\n'));
  } finally { cleanup(root); }
});

test('42) 严格模式：$r 引用已登记但未合入 string.json 的键 → FAIL', () => {
  const root = makeFixture();
  try {
    write(root, 'tools/resource-requests/harmony-guard.json', JSON.stringify({ req_registered: '登记值' }));
    write(root, 'entry/src/main/ets/pages/ResourceUse.ets', "export const REGISTERED = $r('app.string.req_registered');\n");
    const result = runChecks(root, { strict: true });
    assert.equal(result.exitCode, 1);
    assert.ok(failMessages(result).some((m) => m.includes('引用了不存在的资源键 string.req_registered')));
    assert.ok(!result.items.some((x) => x.severity === 'WARN' && x.message.includes('尚未合入 string.json')));
  } finally { cleanup(root); }
});

function sha256Of(data) {
  return createHash('sha256').update(data).digest('hex');
}

// 只用 store 方式手工拼一个 zip：中心目录/EOCD 足够 build-gate 解析，不依赖压缩库。
function makeStoreZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(Buffer.concat([local, nameBuf, data]));
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

test('43) --hap-manifest：zip store 解析、目录跳过、清单排序与 sha256，缺文件 exit 4', () => {
  const root = makeFixture();
  try {
    const hap = path.join(root, 'sample.hap');
    fs.writeFileSync(hap, makeStoreZip([
      ['b.txt', 'B'],
      ['sub/', ''],
      ['sub/a.txt', 'A'],
    ]));
    const r = spawnSync(process.execPath, [BUILD_GATE, '--hap-manifest', hap], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    // 清单比较必须与行顺序无关：解析成 path -> sha256 映射逐项核对，
    // 再用按路径排序后的规范文本核对内容；不允许依赖 localeCompare/输出顺序，
    // 否则不同 ICU/locale 或实现排序变化会造成门禁抖动（reviewer 曾报 42/1）。
    const actualText = fs.readFileSync(hap + '.manifest.txt', 'utf8');
    const actualLines = actualText.split('\n').filter((line) => line.length > 0);
    const actualEntries = actualLines.map((line) => {
      const m = /^([0-9a-f]{64})  (.+)$/.exec(line);
      assert.ok(m, '清单行格式应为 <sha256>  <path>：' + line);
      return [m[2], m[1]];
    });
    const expectedEntries = [
      ['b.txt', sha256Of(Buffer.from('B'))],
      ['sub/a.txt', sha256Of(Buffer.from('A'))],
    ];
    assert.deepEqual(new Map(actualEntries), new Map(expectedEntries));
    const canonical = (entries) => entries
      .slice()
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([name, hash]) => hash + '  ' + name)
      .join('\n') + '\n';
    assert.equal(canonical(actualEntries), canonical(expectedEntries));
    assert.ok(r.stdout.includes('包内文件：2 个'));
    // 构建端报告的清单哈希必须等于其实际写出文本的哈希（自洽即可，不依赖行序）。
    assert.ok(r.stdout.includes('包内清单 sha256：' + sha256Of(Buffer.from(actualText))));

    const missing = spawnSync(process.execPath, [BUILD_GATE, '--hap-manifest', path.join(root, 'nope.hap')], { encoding: 'utf8' });
    assert.equal(missing.status, 4);
    assert.ok(missing.stderr.includes('HAP 不存在'));
  } finally { cleanup(root); }
});

test('44) build-gate --precheck-only：白名单不可达计入完整性，未登记孤儿仍 exit 6', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony-precheck-'));
  try {
    write(root, 'hvigorw.bat', '@echo off\n');
    write(root, 'entry/src/main/ets/entryability/EntryAbility.ets', 'export default class EntryAbility {}\n');
    write(root, 'entry/src/main/ets/pages/Index.ets', 'export default class Index {}\n');
    write(root, 'entry/src/main/ets/platform/system/SystemWorkAbility.ets', 'export default class SystemWorkAbility {}\n');
    write(root, 'entry/src/main/ets/platform/foo/Orphan.ets', 'export class Orphan {}\n');
    const precheck = () => spawnSync(process.execPath, [BUILD_GATE, '--root', root, '--precheck-only', '--strict'], { encoding: 'utf8' });

    // 白名单缺失：必须拦住。
    let r = precheck();
    assert.equal(r.status, 6, r.stderr);
    assert.ok(r.stderr.includes('缺少不可达白名单'));

    // 白名单只登记 Orphan，另一个不可达未登记：仍必须拦住。
    write(root, 'entry/src/main/ets/platform/foo/Other.ets', 'export class Other {}\n');
    write(root, 'tools/unreachable-allowlist.json', JSON.stringify({
      version: 1,
      entries: [{
        path: 'entry/src/main/ets/platform/foo/Orphan.ets',
        reason: '测试夹具中的旧桩，无 import 引用',
        decision: 'lead-approved-2026-10-30',
        disposition: 'next-round-cleanup',
      }],
    }, null, 2) + '\n');
    r = precheck();
    assert.equal(r.status, 6, r.stderr);
    assert.ok(r.stderr.includes('未登记白名单'));

    // 两条都登记：允许进入（不复制、不构建）。
    write(root, 'tools/unreachable-allowlist.json', JSON.stringify({
      version: 1,
      entries: [
        { path: 'platform/foo/Orphan.ets', reason: '测试夹具中的旧桩，无 import 引用', decision: 'lead-approved-2026-10-30', disposition: 'next-round-cleanup' },
        { path: 'platform/foo/Other.ets', reason: '测试夹具中的另一个旧桩，无 import 引用', decision: 'lead-approved-2026-10-30', disposition: 'next-round-cleanup' },
      ],
    }, null, 2) + '\n');
    r = precheck();
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes('白名单不可达=2'));

    // 白名单条目缺 Lead 批准标记：必须失败。
    write(root, 'tools/unreachable-allowlist.json', JSON.stringify({
      version: 1,
      entries: [{ path: 'platform/foo/Orphan.ets', reason: '理由够长但未批准', decision: 'self-approved', disposition: 'next-round-cleanup' }],
    }, null, 2) + '\n');
    r = precheck();
    assert.equal(r.status, 6, r.stderr);
    assert.ok(r.stderr.includes('不可达白名单校验失败'));

    // 白名单路径已可达（stale）：必须失败。
    write(root, 'entry/src/main/ets/pages/Index.ets', "import { Orphan } from '../platform/foo/Orphan';\nexport default class Index {}\n");
    write(root, 'tools/unreachable-allowlist.json', JSON.stringify({
      version: 1,
      entries: [{ path: 'platform/foo/Orphan.ets', reason: '已被 Index 引用，属过期白名单', decision: 'lead-approved-2026-10-30', disposition: 'next-round-cleanup' }],
    }, null, 2) + '\n');
    r = precheck();
    assert.equal(r.status, 6, r.stderr);
    assert.ok(r.stderr.includes('白名单路径已可达'));
  } finally { cleanup(root); }
});
