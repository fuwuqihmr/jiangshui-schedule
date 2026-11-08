#!/usr/bin/env node
/**
 * P4 79c UI 静态契约测试（无 SDK）：只读取源码与资源做结构断言，不编译、不运行 ArkUI。
 * 由 node --test 执行；run-core-tests.mjs 也会收集 tools/tests/*.test.mjs。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.HARMONY_ROOT || path.resolve(process.cwd());
const ETS = path.join(ROOT, 'entry/src/main/ets');
const STRINGS = path.join(ROOT, 'entry/src/main/resources/base/element/string.json');

function read(rel) {
  return fs.readFileSync(path.join(ETS, rel), 'utf8');
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function resources() {
  return JSON.parse(fs.readFileSync(STRINGS, 'utf8')).string;
}

const NEW_FILES = [
  'components/SchoolAccountCard.ets',
  'pages/SchoolLoginPage.ets',
  'platform/web/SchoolLoginWebView.ets',
  'platform/web/OfficeWebSessionImpl.ets'
];

const ERROR_CODES = [
  'SCHOOL_LOGIN_REQUIRED', 'SCHOOL_CAPTCHA_REQUIRED', 'SCHOOL_NETWORK_FAILED', 'SCHOOL_TIMEOUT',
  'SCHOOL_SESSION_EXPIRED', 'SCHOOL_PARSE_FAILED', 'SCHOOL_EMPTY_TIMETABLE', 'OFFICE_SESSION_REQUIRED',
  'OFFICE_UNAVAILABLE'
];

const ERROR_KEYS = [
  'school_error_login_required', 'school_error_captcha', 'school_error_network', 'school_error_timeout',
  'school_error_session_expired', 'school_error_parse', 'school_error_empty', 'office_error_session',
  'office_error_unavailable'
];

const UI_KEYS = [
  'school_error_unknown', 'school_card_title', 'school_card_intro', 'school_status_unbound',
  'school_status_checking', 'school_status_ready', 'school_status_expired', 'school_status_error',
  'school_last_success_relative', 'school_last_success_absolute', 'school_last_attempt_label', 'school_last_never',
  'school_relative_just_now', 'school_relative_minutes', 'school_relative_hours', 'school_relative_days',
  'school_progress_session', 'school_progress_page', 'school_progress_weeks', 'school_progress_rows',
  'school_progress_parse', 'school_progress_save', 'school_btn_login', 'school_btn_read', 'school_btn_retry',
  'school_permission_denied',
  'school_web_unavailable', 'school_account_accessibility', 'school_login_title', 'school_login_intro',
  'school_login_entry_label', 'school_login_copy', 'school_login_wait', 'school_login_captcha_hint',
  'school_login_load_error', 'office_leave_empty'
];

test('79c 四个 UI 文件存在', () => {
  for (const rel of NEW_FILES) {
    assert.ok(fs.existsSync(path.join(ETS, rel)), rel + ' should exist');
  }
});

test('pages 不直接依赖 @ohos/@kit 或 cookie/HUKS/http 能力', () => {
  for (const rel of ['pages/Index.ets', 'pages/SettingsPage.ets', 'pages/SchoolLoginPage.ets', 'pages/WebOfficePage.ets']) {
    const code = read(rel);
    assert.ok(!/from\s+['"]@(ohos|kit)\//.test(code), rel + ' must not import @ohos/@kit');
    assert.ok(!/WebCookieManager|HUKS|@ohos\.net\.http/.test(code), rel + ' must not use cookie/HUKS/http APIs');
  }
});

test('SchoolAccountCard 覆盖 9 个稳定错误码与兜底文案', () => {
  const code = read('components/SchoolAccountCard.ets');
  for (const token of ERROR_CODES) {
    assert.ok(code.includes("'" + token + "'"), 'missing error code ' + token);
  }
  for (const key of ERROR_KEYS) {
    assert.ok(code.includes("$r('app.string." + key + "')"), 'missing resource ' + key);
  }
  assert.ok(code.includes("$r('app.string.school_error_unknown')"));
  assert.ok(!/[\u4e00-\u9fff]/.test(stripComments(code)), 'no hard-coded Chinese literals');
  assert.ok(code.includes('float_touch_min'), '44vp touch target');
});

test('错误码只经资源键显示，不拼接服务器原文', () => {
  const card = read('components/SchoolAccountCard.ets');
  assert.ok(card.includes('schoolErrorText('));
  const loginPage = read('pages/SchoolLoginPage.ets');
  assert.ok(loginPage.includes("$r('app.string.school_login_load_error')"));
  assert.ok(!/error\s*\+\s*['"]/.test(loginPage));
});

test('SchoolLoginWebView：白名单拦截、成功判据、会话保存、cookie 不进页面 JS', () => {
  const code = read('platform/web/SchoolLoginWebView.ets');
  assert.ok(code.includes('SchoolUrlPolicy'));
  assert.ok(code.includes('isAllowed(') && code.includes('isAllowedRedirect('));
  assert.ok(code.includes('contains(JIAOWU_HTTP, SCHOOL_SESSION_COOKIE_NAME)'));
  assert.ok(code.includes('cookieHeaderFor(JIAOWU_HTTP)'));
  assert.ok(code.includes('store.save('));
  assert.ok(code.includes('ErrorCode.WEB_UNAVAILABLE'));
  assert.ok(!code.includes('LOGIN_WEB_UNAVAILABLE'));
  assert.ok(!/console\./.test(code), 'no console logging');
  assert.ok(!/runJavaScript\([^)]*cookie/i.test(code), 'cookie must not be passed into page JS');
  assert.ok(code.includes("LOGIN_HTML_SCRIPT: string = 'document.documentElement.outerHTML'"));
});

test('登录页判定顺序：isLoginPage 优先、isCaptchaPage 其次', () => {
  const code = read('platform/web/SchoolLoginWebView.ets');
  const loginAt = code.indexOf('isLoginPage(html, lexicon)');
  const captchaAt = code.indexOf('isCaptchaPage(html, lexicon)');
  assert.ok(loginAt > 0 && captchaAt > loginAt, 'login check must precede captcha check');
  assert.ok(code.includes("onPageNotice('login')"));
  assert.ok(code.includes("onPageNotice('captcha')"));
});

test('SchoolLoginPage 是 NavDestination 且无 Web 时给出可复制地址', () => {
  const code = read('pages/SchoolLoginPage.ets');
  assert.ok(code.includes('NavDestination()'));
  assert.ok(code.includes('SchoolLoginWebView({'));
  assert.ok(code.includes('copyText(this.entryUrl)'));
  assert.ok(code.includes("$r('app.string.school_web_unavailable')"));
  assert.ok(code.includes("$r('app.string.school_login_entry_label')"));
  assert.ok(code.includes('onSuccess') && code.includes('onWebError'));
});

test('OfficeWebSessionImpl：页内 fetch 只读、credentials include、失败码映射', () => {
  const code = read('platform/web/OfficeWebSessionImpl.ets');
  assert.ok(code.includes("credentials: 'include'"));
  assert.ok(code.includes('/office/data/approve/apps/forms/fore/user/list'));
  assert.ok(code.includes('slice(0, 2000000)'));
  assert.ok(code.includes('OFFICE_SCRIPT_TIMEOUT_MS: number = 15000'));
  assert.ok(!/console\./.test(code), 'no console logging of request/response');
  assert.ok(!code.includes('document.cookie'), 'script must not read cookie');
  assert.ok(code.includes('ErrorCode.OFFICE_SESSION_REQUIRED'));
  assert.ok(code.includes('ErrorCode.OFFICE_UNAVAILABLE'));
  assert.ok(code.includes("'NEED_SESSION'") && code.includes("'NEED_LOGIN'"));
  assert.ok(code.includes('implements OfficeWebSession, WebOfficeBridge'));
});

test('日志均经 Redactor.logFields 脱敏', () => {
  for (const rel of ['platform/web/SchoolLoginWebView.ets', 'platform/web/OfficeWebSessionImpl.ets']) {
    const code = read(rel);
    const loggerLines = code.split('\n').filter((line) => line.includes('Logger.'));
    for (const line of loggerLines) {
      assert.ok(line.includes('logFields('), rel + ' logger call must use logFields: ' + line.trim());
    }
  }
});

test('设置页「数据与同步」组内新增教务卡，Index 提供登录路由与读取装配', () => {
  const settings = read('pages/SettingsPage.ets');
  const dataBodyAt = settings.indexOf('dataBody()');
  const cardAt = settings.indexOf('SchoolAccountCard({');
  const calendarAt = settings.indexOf('CalendarCard({', dataBodyAt);
  assert.ok(dataBodyAt > 0 && cardAt > dataBodyAt && calendarAt > cardAt, 'card must be inside data group before CalendarCard');
  assert.ok(settings.includes('onSchoolLogin') && settings.includes('onSchoolRead') && settings.includes('onSchoolCancel'));

  const index = read('pages/Index.ets');
  assert.ok(index.includes("pushPathByName('schoolLogin'"));
  assert.ok(index.includes("name === 'schoolLogin'"));
  assert.ok(index.includes('SchoolReaderImpl'));
  assert.ok(index.includes('createSchoolLexicon(context)'));
  assert.ok(index.includes('rowsFilterLabel(context)'));
  assert.ok(index.includes('loadStoredSchoolSession(context)'));
  assert.ok(index.includes('isSchoolSessionUsable'));
});

test('45 个新增资源键存在、唯一且全部被引用', () => {
  const items = resources();
  const names = items.map((it) => it.name);
  assert.equal(new Set(names).size, names.length, 'duplicate resource keys');
  const all = ERROR_KEYS.concat(UI_KEYS);
  assert.equal(all.length, 45);
  const etsText = ['pages/Index.ets', 'pages/SettingsPage.ets', 'pages/SchoolLoginPage.ets', 'components/SchoolAccountCard.ets',
    'platform/web/SchoolLoginWebView.ets', 'platform/web/OfficeWebSessionImpl.ets', 'pages/WebOfficePage.ets']
    .map((rel) => read(rel)).join('\n');
  for (const key of all) {
    assert.ok(names.includes(key), 'missing key ' + key);
    assert.ok(etsText.includes("$r('app.string." + key + "'"), 'unreferenced key ' + key);
  }
});

test('SchoolReaderImpl 装配传学期名，避免 snapshot.name 落成学期号', () => {
  const index = read('pages/Index.ets');
  assert.ok(index.includes('schoolSemesterFallback(context)'), 'fallback semester name');
  assert.ok(index.includes('schoolSemesterDisplayName(context, result.snapshot.startDate, semesterName)'), 'derive name from start date');
  assert.ok(/schoolSourceLabel\(context\),\s*\n\s*semesterName,/.test(index), '5th ctor arg must be semesterName');
  assert.ok(!/schoolSourceLabel\(context\),\s*\n\s*undefined,/.test(index), 'must not pass undefined semester name');

  const web = read('platform/web/SchoolLoginWebView.ets');
  for (const key of ['school_semester_name', 'school_semester_year_suffix', 'school_semester_term_first', 'school_semester_term_second']) {
    assert.ok(web.includes("$r('app.string." + key + "')"), 'missing semester resource ' + key);
  }
  const items = resources();
  const names = items.map((it) => it.name);
  for (const key of ['school_semester_name', 'school_semester_year_suffix', 'school_semester_term_first', 'school_semester_term_second']) {
    assert.ok(names.includes(key), 'missing resource key ' + key);
  }
});

test('6 个读取阶段均有资源键与映射，Index 把 onProgress 传入 read 并回主线程', () => {
  const stages = [
    ['session-check', 'school_progress_session'],
    ['page-meta', 'school_progress_page'],
    ['weeks', 'school_progress_weeks'],
    ['rows', 'school_progress_rows'],
    ['parse', 'school_progress_parse'],
    ['save', 'school_progress_save']
  ];
  const card = read('components/SchoolAccountCard.ets');
  const names = resources().map((it) => it.name);
  for (const pair of stages) {
    assert.ok(card.includes("'" + pair[0] + "'"), 'missing stage ' + pair[0]);
    assert.ok(card.includes("$r('app.string." + pair[1] + "')"), 'missing resource ' + pair[1]);
    assert.ok(names.includes(pair[1]), 'resource not in string.json: ' + pair[1]);
  }

  const index = read('pages/Index.ets');
  assert.ok(/reader\.read\(session,\s*\(stage: string\)/.test(index), 'onProgress must be passed into SchoolReaderImpl.read');
  assert.ok(index.includes('this.schoolProgressStage = stage'), 'progress callback must update stage state');
  assert.ok(/setTimeout\(\(\) => \{\s*\n\s*if \(this\.schoolReadToken === token\)/.test(index),
    'progress callback must marshal to UI thread and drop stale tokens');
});

test('OfficeWebSessionImpl 已接线：能力探测非恒 false，组件装配并跟踪页面，返回时清理会话', () => {
  const view = read('platform/web/OfficeWebView.ets');
  assert.ok(view.includes("canIUse('SystemCapability.Web.Webview.Core')"), 'capability must probe canIUse');
  assert.ok(!/return \{ available: false \}/.test(view), 'capability must not be hard-coded false');
  assert.ok(view.includes('new OfficeWebSessionImpl(this.controller'), 'view must construct impl with its controller');
  assert.ok(view.includes('onSessionReady'), 'view must expose ready session');
  assert.ok(view.includes('this.session.noteUrl(event.url)'), 'view must route page starts into impl');
  assert.ok(view.includes('officeWebCapability().available'), 'fallback branch must remain');

  const page = read('pages/WebOfficePage.ets');
  assert.ok(page.includes("from '../platform/web/OfficeWebSessionImpl'"), 'page must receive impl type');
  assert.ok(page.includes('onSessionReady'), 'page must subscribe to ready session');
  assert.ok(page.includes('this.session.close()'), 'page must close session on back');
  assert.ok(!/from\s+['"]@(ohos|kit)\//.test(page), 'page must not import @ohos/@kit');
  assert.ok(!/console\./.test(view), 'no console logging');
});

test('Office 申请页加载后自动抓取一次假条：解析为 LeaveRecord[]、写状态、错误走 §4.2 资源键、cookie 不外传', () => {
  const view = read('platform/web/OfficeWebView.ets');
  assert.ok(view.includes('isOfficeApplyUrl(url)'), 'view must detect the office apply page');
  assert.ok(view.includes('session.fetchLeaveRecords(this.semesterId)'), 'view must pass the current semester id');
  assert.ok(view.includes('this.leaveFetchUrl === url'), 'same URL must only fetch once');
  assert.ok(/onPageEnd\(\(\) => \{[\s\S]*?maybeFetchLeave\(\)/.test(view), 'page end must trigger the fetch');
  assert.ok(view.includes('onLeaveRecords') && view.includes('onLeaveError'), 'view must report records/errors');
  assert.ok(view.includes('ErrorCode.OFFICE_SESSION_REQUIRED') && view.includes('ErrorCode.OFFICE_UNAVAILABLE'),
    'errors must map to the two stable office codes');
  assert.ok(!view.includes('document.cookie'), 'view must not touch cookies');
  assert.ok(!/console\./.test(view), 'no console logging');

  const page = read('pages/WebOfficePage.ets');
  assert.ok(page.includes('leaveStatusCacheFromRecords(records, this.currentSemesterId())'),
    'page must normalize fetched records through the existing view model');
  assert.ok(page.includes('AppStateHost.saveLeaveStatus('), 'page must persist the fetched records');
  assert.ok(page.includes("$r('app.string.office_leave_loaded', this.leaveCount)"), 'page must show record count');
  assert.ok(page.includes("$r('app.string.office_leave_latest', this.leaveLatest)"), 'page must show latest record');
  assert.ok(page.includes("$r('app.string.office_error_session')"), 'missing office session text');
  assert.ok(page.includes("$r('app.string.office_error_unavailable')"), 'missing office unavailable text');
  assert.ok(!/from\s+['"]@(ohos|kit)\//.test(page), 'page must not import @ohos/@kit');
  assert.ok(!/[\u4e00-\u9fff]/.test(stripComments(page)), 'no hard-coded Chinese literals');

  const impl = read('platform/web/OfficeWebSessionImpl.ets');
  assert.ok(impl.includes('parseOfficeLeave(envelope.body, this.lexicon, { semesterId: semesterId })'),
    'records must be parsed with the semester filter before returning');
  assert.ok(impl.includes('fetchLeaveRecords(semesterId?: string)'), 'fetch must accept an optional semester id');
  assert.ok(page.includes('semesterId: this.semesterFilterId()'), 'page must pass the school semester id used for filtering');
  assert.ok(page.includes('SEMESTER_MONDAY_TABLE') && page.includes('private semesterFilterId(): string'),
    'filter id must be derived from the semester calendar, not from the snapshot id');
  assert.ok(page.includes("$r('app.string.office_leave_empty')"), 'empty filtered result needs its own text');

  const names = resources().map((it) => it.name);
  for (const key of ['office_leave_loaded', 'office_leave_latest']) {
    assert.ok(names.includes(key), 'missing resource ' + key);
  }
});

test('round2：错误码归一/导入断裂修复、登录失败可重试、假条按学期过滤', () => {
  const card = read('components/SchoolAccountCard.ets');
  assert.ok(card.includes('export function normalizeSchoolErrorCode(error: Error): string'),
    'round2 P0-1: normalizeSchoolErrorCode must be exported by the card');
  const index = read('pages/Index.ets');
  assert.ok(index.includes('normalizeSchoolErrorCode, schoolProgressText'), 'Index must import the helper from the card');
  assert.ok(index.includes("import { emptyLeaveStatus } from '../core/viewmodel/LeaveStatusViewModel';"),
    'round2 P0-2: emptyLeaveStatus lives in the leave status view model');
  assert.ok(!index.includes("import { emptyLeaveStatus } from '../core/types/Leave';"), 'stale import must be gone');

  const grid = read('components/WeekGrid.ets');
  assert.ok(!grid.includes('WeekSlotView'), 'round2 P1-4: WeekSlotView must not be imported');
  assert.ok(grid.includes("import type { CourseView } from '../core/viewmodel/DayViewModel';"),
    'CourseView must come from DayViewModel');
  assert.ok(/import type \{ WeekViewModel, WeekSlot, WeekDayView \}/.test(grid), 'WeekSlot must be imported');

  const weekVm = read('core/viewmodel/WeekViewModel.ets');
  assert.ok(weekVm.includes("import type { LeaveRecord } from '../types/Leave';"), 'LeaveRecord must come from types/Leave');

  const leaveVm = read('core/viewmodel/LeaveStatusViewModel.ets');
  assert.ok(leaveVm.includes('export type LeaveDisplayStatus ='), 'LeaveDisplayStatus must be defined in the view model');
  assert.ok(!leaveVm.includes('LeaveRecord, LeaveMark, LeaveDisplayStatus'), 'view model must not import its own type');

  const leavePage = read('pages/LeaveStatusPage.ets');
  assert.ok(leavePage.includes("import type { LeaveDisplayStatus,"), 'page must import LeaveDisplayStatus from the view model');

  const login = read('pages/SchoolLoginPage.ets');
  assert.ok(login.includes("$r('app.string.school_btn_retry')"), 'round2 P2: failure state needs a retry button');
  assert.ok(/this\.webErrorCode = '';\s*\n\s*this\.notice = '';/.test(login), 'retry must clear the error state');
});

test('P1：教务卡网络能力与日历/通知权限解耦，SettingsPage 不再传 this.permission', () => {
  const settings = read('pages/SettingsPage.ets');
  const cardAt = settings.indexOf('SchoolAccountCard({');
  const calendarAt = settings.indexOf('CalendarCard({', cardAt);
  assert.ok(cardAt > 0 && calendarAt > cardAt, 'school card call block must be found');
  const block = settings.slice(cardAt, calendarAt);
  assert.ok(block.includes('permission: this.schoolNetworkPermission'),
    'school card must receive the dedicated network capability');
  assert.ok(!block.includes('permission: this.permission'),
    'school card must not receive calendar/notification state');

  const stale = settings.match(/permission:\s*this\.permission/g) || [];
  assert.equal(stale.length, 0, 'SettingsPage must not pass this.permission as a card permission');

  assert.ok(settings.includes("@Prop schoolNetworkPermission: PermissionState = 'granted';"),
    'network capability prop must default to granted in the static build');
  assert.ok(settings.includes('platform/network/HttpGateway'), 'comment must document the real gateway wiring point');

  // 权限卡仍使用日历/通知权限，不受本次解耦影响
  assert.ok(settings.includes('notificationState: this.permission') && settings.includes('backgroundState: this.permission'),
    'PermissionCard must keep calendar/notification state');
});