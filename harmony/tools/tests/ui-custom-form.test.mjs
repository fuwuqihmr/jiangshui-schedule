import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
const fixtures = process.env.HARMONY_FIXTURES;
const harmonyRoot = process.env.HARMONY_ROOT;
if (!tmp || !fixtures || !harmonyRoot) throw new Error('HARMONY_CORE_TMP/HARMONY_FIXTURES/HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');

const FEATURE_DIR = path.join(harmonyRoot, 'entry/src/main/ets/features/custom');
const sourceFile = path.join(FEATURE_DIR, 'CustomFormLogic.ets');
const targetFile = path.join(tmp, 'features/custom/CustomFormLogic.ts');
fs.mkdirSync(path.dirname(targetFile), { recursive: true });
// ArkTS 的运行时 import 不带扩展名；Node ESM（type-strip）必须显式 .ts，复制时补上，
// 这样测的还是同一份逻辑源码，只是让 Node 能解析服务模块。
const logicSource = fs.readFileSync(sourceFile, 'utf8')
  .replaceAll("from '../../core/custom/CustomScheduleService'", "from '../../core/custom/CustomScheduleService.ts'");
fs.writeFileSync(targetFile, logicSource);

const logic = await import(pathToFileURL(targetFile).href);
const custom = await import(pathToFileURL(path.join(tmp, 'core/custom/CustomScheduleService.ts')).href);
const edge = JSON.parse(fs.readFileSync(path.join(fixtures, 'edge-state.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const state = () => clone(edge);

const BASE_ROW = {
  key: 'row-2026-09-07-1',
  date: '2026-09-07',
  startTime: '08:30',
  endTime: '09:55',
  periods: [1, 2],
  name: '高等数学',
  teacher: '李老师',
  room: 'A101',
  cancelled: false,
  vacant: false,
  localActivity: false,
  customCourse: false,
  remapId: '',
  conflict: false,
  overlap: false,
  source: 'school',
  originDate: '2026-09-07'
};

function weeklyDraft(overrides = {}) {
  return {
    mode: 'weekly',
    name: '自习',
    teacher: '自己',
    room: '图书馆',
    startTime: '18:00',
    endTime: '18:45',
    dayOfWeek: 2,
    startWeek: 5,
    endWeek: 9,
    weekPattern: 'odd',
    date: '',
    customCourseId: '',
    ...overrides
  };
}

function mapDraft(overrides = {}) {
  return { fromDate: '2026-09-07', date: '2026-09-10', mode: 'replace', ...overrides };
}

function overridePatch(overrides = {}) {
  return { startTime: '10:15', endTime: '11:40', room: 'B203', ...overrides };
}

function counter() {
  const calls = [];
  return { calls, fn: (value) => { calls.push(value); } };
}

test('1) 课程表单拒绝路径：空名称/非法周次/时间倒序都不触发回写', () => {
  const empty = counter();
  const noName = logic.submitCourse(weeklyDraft({ name: '   ' }), state(), 1790000000000, empty.fn);
  assert.deepEqual(noName, ['name-required']);
  assert.equal(empty.calls.length, 0);

  const badWeek = counter();
  const weekErrors = logic.submitCourse(weeklyDraft({ startWeek: 0 }), state(), 1790000000000, badWeek.fn);
  assert.ok(weekErrors.includes('week-invalid'), '周次 0 应报 week-invalid');
  assert.equal(badWeek.calls.length, 0);

  const tooLate = counter();
  const rangeErrors = logic.submitCourse(weeklyDraft({ startWeek: 20, endWeek: 30 }), state(), 1790000000000, tooLate.fn);
  assert.ok(rangeErrors.includes('week-out-of-range'), '超出学期 18 周应报 week-out-of-range');
  assert.equal(tooLate.calls.length, 0);

  const badTime = counter();
  const timeErrors = logic.submitCourse(weeklyDraft({ startTime: '19:00', endTime: '18:00' }), state(), 1790000000000, badTime.fn);
  assert.ok(timeErrors.includes('time-order'), '结束早于开始应报 time-order');
  assert.equal(badTime.calls.length, 0);
});

test('2) 课程表单成功：只回调一次并带上学期标记', () => {
  const spy = counter();
  const errors = logic.submitCourse(weeklyDraft({ name: '补课' }), state(), 1790000000000, spy.fn);
  assert.deepEqual(errors, []);
  assert.equal(spy.calls.length, 1);
  const course = spy.calls[0];
  assert.equal(course.name, '补课');
  assert.equal(course.semesterId, edge.snapshot.id);
  assert.equal(course.semesterStartDate, edge.snapshot.startDate);
  assert.equal(course.mode, 'weekly');
  assert.equal(course.startWeek, 5);
  assert.equal(course.endWeek, 9);
  assert.equal(course.weekPattern, 'odd');
});

test('3) 调课表单：空/非法/同日拒绝，成功回调且编辑保留 id', () => {
  const empty = counter();
  const emptyErrors = logic.submitLocalMap(mapDraft({ fromDate: '', date: '' }), state(), 1790000000000, '', empty.fn);
  assert.ok(emptyErrors.includes('from-date-invalid'));
  assert.ok(emptyErrors.includes('date-invalid'));
  assert.equal(empty.calls.length, 0);

  const invalid = counter();
  const invalidErrors = logic.submitLocalMap(mapDraft({ date: '2026-13-01' }), state(), 1790000000000, '', invalid.fn);
  assert.ok(invalidErrors.includes('date-invalid'));
  assert.equal(invalid.calls.length, 0);

  const same = counter();
  const sameErrors = logic.submitLocalMap(mapDraft({ date: '2026-09-07' }), state(), 1790000000000, '', same.fn);
  assert.ok(sameErrors.includes('same-date'));
  assert.equal(same.calls.length, 0);

  const ok = counter();
  const okErrors = logic.submitLocalMap(mapDraft(), state(), 1790000000000, '', ok.fn);
  assert.deepEqual(okErrors, []);
  assert.equal(ok.calls.length, 1);
  assert.equal(ok.calls[0].mode, 'replace');
  assert.equal(ok.calls[0].fromDate, '2026-09-07');
  assert.equal(ok.calls[0].date, '2026-09-10');
  assert.ok(ok.calls[0].id.length > 0);

  const editing = counter();
  const editErrors = logic.submitLocalMap(mapDraft(), state(), 1790000000000, 'local-map-keep', editing.fn);
  assert.deepEqual(editErrors, []);
  assert.equal(editing.calls[0].id, 'local-map-keep', '编辑时保留原 id');
});

test('4) 单日休假：空/非法/学期外/重复日期拒绝，成功回调 skipStudy', () => {
  const empty = counter();
  assert.deepEqual(logic.submitHoliday('', true, edge.snapshot, [], empty.fn), ['date-invalid']);
  assert.equal(empty.calls.length, 0);

  const invalid = counter();
  assert.deepEqual(logic.submitHoliday('2026-13-01', true, edge.snapshot, [], invalid.fn), ['date-invalid']);
  assert.equal(invalid.calls.length, 0);

  const outside = counter();
  const outsideErrors = logic.submitHoliday('2027-09-01', true, edge.snapshot, [], outside.fn);
  assert.ok(outsideErrors.includes('date-out-of-semester'));
  assert.equal(outside.calls.length, 0);

  const duplicate = counter();
  const duplicateErrors = logic.submitHoliday('2026-10-01', true, edge.snapshot, ['2026-10-01'], duplicate.fn);
  assert.ok(duplicateErrors.includes('holiday-duplicate'));
  assert.equal(duplicate.calls.length, 0);

  const ok = counter();
  assert.deepEqual(logic.submitHoliday('2026-09-07', true, edge.snapshot, ['2026-10-01'], ok.fn), []);
  assert.equal(ok.calls.length, 1);
  assert.deepEqual(ok.calls[0], { date: '2026-09-07', skipStudy: true });
});

test('5) 单日修改：非法日期/非法时间/时间倒序拒绝，取消与改时间地点成功回调', () => {
  const badDate = counter();
  const dateErrors = logic.submitOverride('2026-13-01', BASE_ROW, overridePatch(), 1790000000000, '', badDate.fn);
  assert.ok(dateErrors.includes('date-invalid'));
  assert.equal(badDate.calls.length, 0);

  const badTime = counter();
  const timeErrors = logic.submitOverride('2026-09-07', BASE_ROW, overridePatch({ startTime: '25:00' }), 1790000000000, '', badTime.fn);
  assert.ok(timeErrors.includes('time-invalid'));
  assert.equal(badTime.calls.length, 0);

  const order = counter();
  const orderErrors = logic.submitOverride('2026-09-07', BASE_ROW, overridePatch({ startTime: '10:15', endTime: '10:15' }), 1790000000000, '', order.fn);
  assert.ok(orderErrors.includes('time-order'));
  assert.equal(order.calls.length, 0);

  const cancel = counter();
  assert.deepEqual(logic.submitOverride('2026-09-07', BASE_ROW, { cancelled: true }, 1790000000000, '', cancel.fn), []);
  assert.equal(cancel.calls.length, 1);
  assert.equal(cancel.calls[0].patch.cancelled, true);
  assert.equal(cancel.calls[0].date, '2026-09-07');

  const change = counter();
  assert.deepEqual(logic.submitOverride('2026-09-07', BASE_ROW, overridePatch(), 1790000000000, '', change.fn), []);
  assert.equal(change.calls.length, 1);
  assert.equal(change.calls[0].patch.startTime, '10:15');
  assert.equal(change.calls[0].patch.endTime, '11:40');
  assert.equal(change.calls[0].patch.room, 'B203');
  assert.equal(change.calls[0].base.name, '高等数学');

  const editing = counter();
  assert.deepEqual(logic.submitOverride('2026-09-07', BASE_ROW, overridePatch(), 1790000000000, 'override-keep', editing.fn), []);
  assert.equal(editing.calls[0].id, 'override-keep');
});

test('6) 组件只发回调：表单逻辑不依赖状态宿主，sheet 统一走 CustomFormLogic', () => {
  const logicSource = fs.readFileSync(sourceFile, 'utf8');
  assert.ok(!logicSource.includes('AppStateHost'), '表单逻辑不得引用 AppStateHost');
  assert.ok(!logicSource.includes('@ohos'), '表单逻辑不得引用 @ohos');
  assert.ok(!logicSource.includes('@kit'), '表单逻辑不得引用 @kit');

  const sheets = ['CustomCourseSheet.ets', 'LocalMapSheet.ets', 'HolidayDaySheet.ets', 'DayOverrideSheet.ets'];
  for (const name of sheets) {
    const source = fs.readFileSync(path.join(FEATURE_DIR, name), 'utf8');
    assert.ok(source.includes("from './CustomFormLogic'"), name + ' 应复用 CustomFormLogic');
    assert.ok(!source.includes('AppStateHost'), name + ' 不得直接写状态宿主');
    assert.ok(source.includes('onSubmit'), name + ' 应有 onSubmit 回调');
  }
  assert.ok(fs.readFileSync(path.join(FEATURE_DIR, 'LocalMapSheet.ets'), 'utf8').includes('submitLocalMap'));
  assert.ok(fs.readFileSync(path.join(FEATURE_DIR, 'HolidayDaySheet.ets'), 'utf8').includes('submitHoliday'));
  assert.ok(fs.readFileSync(path.join(FEATURE_DIR, 'DayOverrideSheet.ets'), 'utf8').includes('submitOverride'));
});

test('7) 面板回调契约：保留旧回调并新增 onAdd*/onEdit*/onDelete*', () => {
  const source = fs.readFileSync(path.join(FEATURE_DIR, 'CustomSchedulePanel.ets'), 'utf8');
  const required = [
    'onAdd', 'onEdit', 'onDeleteCourse', 'onDeleteMap', 'onDeleteHoliday',
    'onAddMap', 'onEditMap', 'onAddHoliday', 'onEditHoliday',
    'onAddOverride', 'onEditOverride', 'onDeleteOverride', 'onUndo', 'onRedo'
  ];
  for (const name of required) {
    assert.ok(source.includes(name + ':'), '缺少回调 ' + name);
  }
  assert.ok(!source.includes('AppStateHost'), '面板不得直接写状态宿主');
  assert.ok(source.includes('custom_section_override'), '面板应有单日修改分区');
});

test('8) 资源与文案门禁：$r 键全部登记，表单不硬编码中文文案', () => {
  const keyFiles = [path.join(harmonyRoot, 'entry/src/main/resources/base/element/string.json')];
  const requestDir = path.join(harmonyRoot, 'tools/resource-requests');
  for (const name of fs.readdirSync(requestDir).filter((item) => item.endsWith('.json'))) {
    keyFiles.push(path.join(requestDir, name));
  }
  const registered = new Set();
  for (const file of keyFiles) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = Array.isArray(parsed['string']) ? parsed['string'] : Object.keys(parsed).map((key) => ({ name: key, value: parsed[key] }));
    for (const entry of list) {
      if (entry && typeof entry.name === 'string') registered.add(entry.name);
    }
  }
  const files = fs.readdirSync(FEATURE_DIR).filter((name) => name.endsWith('.ets'));
  const missing = [];
  let literalChinese = 0;
  for (const name of files) {
    const source = fs.readFileSync(path.join(FEATURE_DIR, name), 'utf8');
    for (const match of source.matchAll(/\$r\('app\.string\.([A-Za-z0-9_]+)'\)/g)) {
      if (!registered.has(match[1])) missing.push(name + ':' + match[1]);
    }
    const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const literal of noComments.matchAll(/'([^'\n]*)'/g)) {
      if (/[\u4e00-\u9fff]/.test(literal[1])) literalChinese += 1;
    }
  }
  assert.deepEqual(missing, [], '存在未登记的资源键：' + missing.join(', '));
  assert.equal(literalChinese, 0, 'features/custom 不得在字符串字面量里硬编码中文');
});
