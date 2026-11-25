import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runChecks } from './check-harmony.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-harmony.mjs');

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
    "versionCode": 48,
    "versionName": "1.3.1-rc1",
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
  write(root, 'README-Harmony.md', 'versionName: 1.3.1-rc1\nversionCode: 48\n');
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
    write(root, 'README-Harmony.md', '- versionName: `1.3.1-rc1`\n- versionCode: `48`\n');
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