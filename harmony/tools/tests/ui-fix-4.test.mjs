#!/usr/bin/env node
/**
 * 静态/纯逻辑回归（无 SDK）：课表空态、周次、横向滚动、周次选择、数据源开关、日期选择器。
 * 只读源码与资源；纯逻辑部分仅在 run-core-tests 的 HARMONY_CORE_TMP 环境下执行。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.HARMONY_ROOT || path.resolve(process.cwd());
const ETS = path.join(ROOT, 'entry/src/main/ets');
const RES = path.join(ROOT, 'entry/src/main/resources/base/element');

function read(rel) {
  return fs.readFileSync(path.join(ETS, rel), 'utf8');
}

test('无学期快照时 WeekViewModel 仍返回 7 天并标记 NO_SEMESTER', () => {
  const vm = read('core/viewmodel/WeekViewModel.ets');
  assert.ok(vm.includes('export const FALLBACK_WEEKS: number = 20'), '需要无学期时的周次上限');
  assert.ok(vm.includes('function fallbackWeekDays('), '需要生成 7 天占位表头');
  const nullStart = vm.indexOf('if (snapshot === null) {');
  const nullBlock = vm.slice(nullStart, vm.indexOf("const days: WeekDayView[] = [];", nullStart));
  assert.ok(nullBlock.includes('empty.days = fallbackWeekDays(input, deps, copy, week)'),
    'snapshot 为空时必须先写入 7 天再返回');
  assert.ok(!/if \(snapshot === null\) \{\s*empty\.errorKey = 'NO_SEMESTER';\s*return empty;/.test(vm),
    '不得保留无数据直接返回空 days 的半渲染路径');
  assert.ok(vm.includes("dayNumber: dateKey.length >= 10 ? dateKey.slice(5) : dateKey"),
    '表头日期需要 MM-DD');
});

test('周次标签无占位符时也会拼出数字', () => {
  const vm = read('core/viewmodel/WeekViewModel.ets');
  assert.ok(vm.includes('function formatWeekLabel('), '需要有占位符/无占位符统一处理');
  assert.ok(vm.includes("template.indexOf('{week}') >= 0"), '先识别占位符');
  assert.ok(vm.includes("return template + ' ' + String(week)"), '无占位符时也要带数字，不能只显示「周次」');
});

const TMP = process.env.HARMONY_CORE_TMP;
if (TMP) {
  const week = await import(pathToFileURL(path.join(TMP, 'core/viewmodel/WeekViewModel.ts')).href);
  const copy = {
    weekdays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
    weekLabel: '第{week}周', periodLabel: '第{periods}节', movedTo: '已调至 {date}',
    dayEmptyTitle: '无课', dayEmptyHint: '', sampleLabel: '示例数据',
    status: {}, tags: {}, sources: {}, changes: {}, detail: {},
    titleToday: '今天', titleTomorrow: '明天', titleYesterday: '昨天', titleSelected: '所选日期',
    a11yCourse: '', a11yMoved: '', a11yChange: ''
  };
  const deps = {
    resolveDay: () => [],
    markLeave: (rows) => rows,
    weekdayOf: (dateKey) => new Date(dateKey + 'T00:00:00Z').getUTCDay() || 7,
    addDays: (dateKey, amount) => new Date(Date.parse(dateKey + 'T00:00:00Z') + amount * 86400000).toISOString().slice(0, 10),
    weekOf: () => 1
  };
 test('无 snapshot 的纯逻辑：7 天、日期列、周次可翻', () => {
    const vm = week.buildWeekViewModel({ state: { snapshot: null }, week: 3, todayKey: '2026-08-31', selectedDateKey: '2026-08-31', leaveRecords: [] }, deps, copy);
    assert.equal(vm.errorKey, 'NO_SEMESTER');
    assert.equal(vm.week, 3);
    assert.equal(vm.days.length, 7);
    assert.equal(vm.days[0].dateKey, '2026-09-14');
    assert.equal(vm.days[0].dayNumber, '09-14');
    assert.equal(vm.days[0].weekdayLabel, '周一');
    assert.equal(vm.days[6].dateKey, '2026-09-20');
    assert.equal(vm.isEmpty, true);
  });
 test('无 snapshot 的周次上限与无占位符文案', () => {
    const vm = week.buildWeekViewModel({ state: { snapshot: null }, week: 99, todayKey: '2026-08-31', selectedDateKey: '2026-08-31', leaveRecords: [] }, deps, { ...copy, weekLabel: '周次' });
    assert.equal(vm.week, 20);
    assert.equal(vm.weekLabel, '周次 20');
  });
}

test('WeekPage 有周次选择、空态、表头始终渲染，且不再包外层横向 Scroll', () => {
  const src = read('pages/WeekPage.ets');
  assert.ok(src.includes('Select(this.weekOptions())'), '需要周次下拉');
  assert.ok(src.includes('onSelect((index: number) => { this.changeWeek(index + 1); })'), '下拉必须驱动周次');
  assert.ok(src.includes('private changeWeek('), '翻周需要统一 clamp');
  assert.ok(src.includes('FALLBACK_WEEKS'), '无学期时仍可翻 1..20');
  assert.ok(!src.includes('Scroll() {'), '横向 Scroll 已下沉到 WeekGrid，避免整页裁剪');
  assert.ok(src.includes("if (this.vm.errorKey !== null)"), '无数据必须有明确空态');
  assert.ok(src.includes("$r('app.string.data_not_read')"), '无学期空态文案走资源');
  assert.ok(src.includes("$r('app.string.status_vacant')"), '空周课表文案走资源');
  assert.ok(src.includes('WeekGrid({ vm: this.vm'), '任何状态都渲染网格表头');
  assert.ok(src.includes(".layoutWeight(1)"), '网格占满剩余高度');
});

test('WeekGrid 左侧时间列固定、右侧 7 天可横向滚，表头含日期', () => {
  const src = read('components/WeekGrid.ets');
  assert.ok(/import type \{ WeekViewModel, WeekSlot, WeekDayView \}/.test(src), '保留既有 WeekSlot 导入');
  assert.ok(src.includes('Text(day.dayNumber)'), '列头必须显示日期');
  assert.ok(src.includes(".scrollable(ScrollDirection.Horizontal)"), '仅右侧日期区横向滚动');
  assert.ok(src.includes('TIME_COLUMN_WIDTH'), '左侧时间列固定');
  assert.ok(src.includes('DAYS_WIDTH'), '内容宽度按 7 列精确计算');
  assert.ok(src.includes('GRID_HEIGHT'), '时间列高度与网格一致');
  assert.ok(!src.includes('Scroll() {\n      Scroll()'), '不得出现双层 Scroll');
});

test('完整课表紧凑卡片固定高度，只保留课程名，避免右侧文字被裁', () => {
  const src = read('components/CourseCard.ets');
  const start = src.indexOf('if (this.compact) {');
  const end = src.indexOf('} else {', start);
  assert.ok(start >= 0 && end > start, '需要 compact 分支');
  const compact = src.slice(start, end);
  assert.ok(compact.includes(".width('100%').height('100%')"), '紧凑卡片必须撑满 92×52 单元格');
  assert.ok(compact.includes('maxLines(2)'), '课程名最多两行');
  assert.ok(!compact.includes('this.model.tagLabels'), '紧凑卡片不渲染标签，避免溢出');
  assert.ok(!compact.includes('this.model.row.teacher'), '紧凑卡片不渲染教师行，避免溢出');
});

test('日期选择器真正打开 DatePickerDialog 并回传日期', () => {
  const src = read('components/DateSwitcher.ets');
  assert.ok(src.includes('onPick: (dateKey: string) => void'), 'onPick 必须接收日期');
  assert.ok(src.includes('showDatePickerDialog({'), '必须打开日期选择弹窗');
  assert.ok(src.includes('onDateAccept: (value: Date)'), '必须处理确认回调');
  assert.ok(src.includes('this.onPick(this.dateKeyOf(value))'), '选择结果必须回传页面');
  assert.ok(src.includes("String(value.getFullYear()) + '-' + monthText + '-' + dayText"), '格式化为 dateKey');
  assert.ok(!src.includes('onPick: () => {}'), '不得保留空函数');
});

test('DateSwitcher 可变字段由 @Prop 装饰，父页面传参与 prop 名一致', () => {
  const src = read('components/DateSwitcher.ets');
  assert.ok(/@Prop\s+dateKey\s*:/.test(src), 'dateKey 必须由 @Prop 装饰并随父组件更新');
  assert.ok(/@Prop\s+label\s*:/.test(src), 'label 必须由 @Prop 装饰并随父组件更新');
  const day = read('pages/DayPage.ets');
  assert.ok(day.includes('DateSwitcher({ dateKey: this.vm.dateKey, label: this.vm.title,'), 'DayPage 传参名必须与 DateSwitcher prop 一致');
});

test('DayPage appState/leaveRecords 变化都触发 refresh，两种到达顺序共用同一路径', () => {
  const src = read('pages/DayPage.ets');
  assert.ok(src.includes("@Prop @Watch('refresh') appState"), '课表到达必须刷新今日页');
  assert.ok(src.includes("@Prop @Watch('refresh') leaveRecords"), '假条后到也必须刷新今日页');
  assert.ok(src.includes('refresh(): void'), '两个 watch 复用 refresh()');
  assert.equal((src.match(/@Watch\('refresh'\)/g) || []).length, 2, '只给两个 @Prop 加 refresh watch');
  assert.ok(src.includes('private refreshing: boolean = false'), 'refresh 需要防重入标记');
  assert.ok(src.includes('if (this.refreshing) { return; }'), '重入时直接返回，避免循环 setState');
  assert.ok(src.includes('this.vm = buildDayViewModel('), 'refresh 仍是唯一 vm 重建路径');
});

test('DayPage 日期选择已接线，失败态与空态分开', () => {
  const src = read('pages/DayPage.ets');
  assert.ok(src.includes('onPick: (dateKey: string) => this.onDateChange(dateKey)'), '日期选择必须驱动 selectedDate');
  assert.ok(src.includes("if (this.vm.errorKey === 'NO_SEMESTER')"), '无学期失败态单独分支');
  assert.ok(src.includes("$r('app.string.data_not_read')"), '无学期使用未读取文案');
  assert.ok(src.includes("$r('app.string.data_sync_hint')"), '无学期使用同步提示');
  assert.ok(src.includes("} else if (this.vm.errorKey === 'INVALID_DATE')"), '无效日期失败态单独分支');
  assert.ok(src.includes("$r('app.string.school_error_unknown')"), '无效日期使用通用失败文案');
  assert.ok(src.includes("} else if (this.vm.isEmpty)"), '空态仍在最后的 else-if');
});

test('数据源开关语义与动作一致（不再反转）', () => {
  const src = read('components/DataSyncCard.ets');
  assert.ok(src.includes("@Prop @Watch('syncMode') mode"), 'mode 变化要同步开关状态');
  assert.ok(src.includes('Toggle({ type: ToggleType.Switch, isOn: this.switchOn })'), '使用开关而不是方向相反的按钮');
  assert.ok(src.includes("this.onModeChange('real')"), '关闭开关切回真实数据');
  assert.ok(src.includes('this.confirmDemo();'), '确认按钮切到示例数据');
  assert.ok(src.includes("this.onModeChange('demo')"), '确认动作只能是 demo');
  assert.ok(!src.includes("this.mode === 'demo' ? 'real' : 'demo'"), '不得保留反向三目动作');
  assert.ok(src.includes("$r('app.string.data_switch_demo')"), '保留「切换到示例数据」提示引用');
});

test('资源合并后 week_selector_* 在 string.json 且与请求文件一致', () => {
  const request = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/resource-requests/harmony-ui.json'), 'utf8'));
  const doc = JSON.parse(fs.readFileSync(path.join(RES, 'string.json'), 'utf8'));
  const map = new Map(doc.string.map((item) => [item.name, item.value]));
  assert.equal(doc.string.length, map.size, 'string.json 不得有重复键');
  assert.equal(map.get('week_selector_prefix'), '第', '周次前缀已合并');
  assert.equal(map.get('week_selector_suffix'), '周', '周次后缀已合并');
  assert.equal(map.get('week_selector_label'), request.week_selector_label, '合并值与请求文件一致');
  assert.equal(map.get('week_selector_prefix'), request.week_selector_prefix, '前缀值一致');
  assert.equal(map.get('week_selector_suffix'), request.week_selector_suffix, '后缀值一致');
});
