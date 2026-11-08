import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP = process.env.HARMONY_CORE_TMP;
const imp = (p) => import(pathToFileURL(path.join(TMP, p)).href);
const settings = await imp('core/viewmodel/SettingsViewModel.ts');
const leaveVm = await imp('core/viewmodel/LeaveStatusViewModel.ts');
const web = await imp('core/viewmodel/WebEntryViewModel.ts');
const repo = await imp('data/StateRepository.ts');

const rec = (over = {}) => ({
  id: 'r1', type: 'leave', status: 'approved',
  startDate: '2026-10-05', startTime: '10:00', endDate: '2026-10-05', endTime: '11:00',
  reason: '测试', approver: '', comment: '', rawStatus: '已通过', semesterId: '2026-2027-1', demo: false,
  ...over
});
const row = (over = {}) => ({
  date: '2026-10-05', startTime: '10:15', endTime: '11:40',
  cancelled: false, vacant: false, localActivity: false, source: 'school', ...over
});
const NOW = Date.parse('2026-10-05T10:30:00+08:00');

test('settings: six groups and order', () => {
  assert.deepEqual(settings.SETTINGS_GROUPS.map((g) => g.id), ['auto', 'display', 'leave', 'course', 'data', 'about']);
  assert.deepEqual(settings.SETTINGS_GROUPS.map((g) => g.order), [0, 1, 2, 3, 4, 5]);
  assert.equal(settings.SETTINGS_GROUPS[0].titleKey, 'settings_group_auto');
  assert.equal(settings.SETTINGS_GROUPS[5].summaryKey, 'settings_summary_about');
});
test('settings: default only auto expanded', () => {
  assert.deepEqual(settings.defaultSettingsExpanded(), { auto: true, display: false, leave: false, course: false, data: false, about: false });
});
test('settings: normalize fills missing keys', () => {
  const got = settings.normalizeSettingsExpanded({ display: true });
  assert.equal(got.auto, true);
  assert.equal(got.display, true);
  assert.equal(got.leave, false);
  assert.equal(got.about, false);
});
test('settings: normalize ignores non-boolean and does not mutate', () => {
  const raw = { auto: 'yes', display: 1, leave: true };
  const got = settings.normalizeSettingsExpanded(raw);
  assert.equal(got.auto, true);
  assert.equal(got.display, false);
  assert.equal(got.leave, true);
  assert.equal(raw.auto, 'yes');
});
test('settings: toggle one group immutably', () => {
  const cur = settings.defaultSettingsExpanded();
  const next = settings.toggleSettingsGroup(cur, 'display');
  assert.equal(next.display, true);
  assert.equal(cur.display, false);
  assert.equal(settings.toggleSettingsGroup(next, 'display').display, false);
});
test('settings: expand all and collapse all', () => {
  const all = settings.expandAllSettingsGroups();
  assert.equal(Object.values(all).every((v) => v === true), true);
  assert.equal(settings.isAllSettingsExpanded(all), true);
  const none = settings.collapseAllSettingsGroups();
  assert.equal(settings.isAllSettingsExpanded(none), false);
});
test('settings: group views follow order and state', () => {
  const views = settings.buildSettingsGroupViews({ auto: false, display: true, leave: false, course: false, data: false, about: false });
  assert.deepEqual(views.map((v) => v.id), ['auto', 'display', 'leave', 'course', 'data', 'about']);
  assert.deepEqual(views.map((v) => v.expanded), [false, true, false, false, false, false]);
  assert.deepEqual(views.map((v) => v.order), [0, 1, 2, 3, 4, 5]);
});
test('leave: status normalization', () => {
  assert.equal(leaveVm.statusFromRaw('APPROVED'), 'approved');
  assert.equal(leaveVm.statusFromRaw(' pending '), 'pending');
  assert.equal(leaveVm.statusFromRaw('rejected'), 'rejected');
  assert.equal(leaveVm.statusFromRaw('已拒绝'), 'unknown');
  assert.equal(leaveVm.statusFromRaw(undefined), 'unknown');
});
test('leave: strict half-open interval and overlap boundary', () => {
  const r = rec({ startTime: '10:00', endTime: '11:00' });
  assert.equal(leaveVm.overlapsCourse(r, row({ startTime: '10:59', endTime: '11:30' })), true);
  // 课程结束恰好等于请假开始：左闭右开，不重叠
  assert.equal(leaveVm.overlapsCourse(r, row({ startTime: '09:00', endTime: '10:00' })), false);
  assert.equal(leaveVm.overlapsCourse(r, row({ startTime: '11:00', endTime: '12:00' })), false);
});
test('leave: approved wins over pending, non-markable rows excluded', () => {
  const pending = rec({ id: 'p1', status: 'pending' });
  const approved = rec({ id: 'a1' });
  const mark = leaveVm.leaveMarkForCourse([pending, approved], row(), NOW);
  assert.equal(mark.recordId, 'a1');
  assert.equal(mark.status, 'approved');
  assert.equal(leaveVm.leaveMarkForCourse([pending], row(), NOW).recordId, 'p1');
  assert.equal(leaveVm.leaveMarkForCourse([approved], row({ cancelled: true }), NOW), null);
  assert.equal(leaveVm.leaveMarkForCourse([approved], row({ vacant: true }), NOW), null);
  assert.equal(leaveVm.leaveMarkForCourse([approved], row({ localActivity: true }), NOW), null);
});
test('leave: expired pending stays pending in core status', () => {
  const r = rec({ status: 'pending', endDate: '2026-10-04', endTime: '09:00' });
  assert.equal(leaveVm.leaveDisplayStatus(r, NOW), 'expired');
  assert.equal(r.status, 'pending');
  assert.equal(leaveVm.activeForMark(r, NOW), false);
});
test('leave: records for date sorted and intersected', () => {
  const a = rec({ id: 'a', startDate: '2026-10-04', endDate: '2026-10-05', startTime: '23:00', endTime: '01:00' });
  const b = rec({ id: 'b', startTime: '09:00', endTime: '09:30' });
  const got = leaveVm.leaveRecordsForDate([b, a], '2026-10-05');
  assert.deepEqual(got.map((x) => x.id), ['a', 'b']);
});
test('leave: summarize counts display statuses', () => {
  const rs = [rec({ id: 'a', status: 'approved' }), rec({ id: 'p', status: 'pending' }), rec({ id: 'e', status: 'approved', endDate: '2026-10-01', endTime: '10:00' }), rec({ id: 'r', status: 'rejected' })];
  const s = leaveVm.summarizeLeaveStatus(rs, NOW);
  assert.deepEqual(s, { total: 4, approved: 1, pending: 1, rejected: 1, unknown: 0, expired: 1 });
});
test('leave: cache migration old array, demo filter, dedupe', () => {
  const raw = [rec({ id: 'a' }), rec({ id: 'a' }), rec({ id: 'd', demo: true })];
  const c = leaveVm.normalizeLeaveStatusCache(raw, '2026-2027-1');
  assert.equal(c.schemaVersion, 1);
  assert.equal(c.semesterId, '2026-2027-1');
  assert.deepEqual(c.records.map((r) => r.id), ['a']);
});
test('leave: cache semester mismatch and invalid records', () => {
  const c = leaveVm.normalizeLeaveStatusCache({ schemaVersion: 1, semesterId: 'other', records: [rec()] }, '2026-2027-1');
  assert.deepEqual(c.records, []);
  const bad = leaveVm.normalizeLeaveStatusCache({ schemaVersion: 1, semesterId: '2026-2027-1', records: [rec({ startDate: 'bad' })] }, '2026-2027-1');
  assert.deepEqual(bad.records, []);
});
test('leave: cache caps at 200 newest then sorts ascending', () => {
  const rs = [];
  for (let i = 0; i < 205; i++) {
    const day = String(1 + (i % 28)).padStart(2, '0');
    rs.push(rec({ id: 'x' + i, startDate: `2026-09-${day}`, endDate: `2026-09-${day}` }));
  }
  const c = leaveVm.normalizeLeaveStatusCache({ schemaVersion: 1, semesterId: '2026-2027-1', records: rs }, '2026-2027-1');
  assert.equal(c.records.length, 200);
  assert.ok(c.records[0].startDate <= c.records[199].startDate);
});
test('leave: empty status view has errorKey null and zero rows', () => {
  const copy = { statusKey: (s) => 'status_' + s, typeKey: (t) => 'type_' + t, formatPeriod: () => '10:00-11:00', titleKey: () => 'leave_status_title', emptyKey: () => 'leave_status_empty' };
  const view = leaveVm.buildLeaveStatusView(leaveVm.emptyLeaveStatus('2026-2027-1'), NOW, copy);
  assert.equal(view.errorKey, null);
  assert.equal(view.isEmpty, true);
  assert.deepEqual(view.rows, []);
  assert.equal(view.isSample, false);
});
test('leave: local source row is not filtered from mark', () => {
  const mark = leaveVm.leaveMarkForCourse([rec({ id: 'local-mark' })], row({ source: 'local' }), NOW);
  assert.equal(mark === null, false);
  assert.equal(mark.recordId, 'local-mark');
});
test('leave: malformed cache never throws and returns empty records', () => {
  const raws = [null, undefined, {}, { records: null }, { semesterId: '2026-2027-1', records: 'bad' }, { semesterId: '2026-2027-1', records: [null, 42] }, { semesterId: '2026-2027-1', records: { a: 1 } }];
  for (const raw of raws) {
    const c = leaveVm.normalizeLeaveStatusCache(raw, '2026-2027-1');
    assert.equal(c.schemaVersion, 1);
    assert.deepEqual(c.records, []);
  }
});
test('repo: settingsExpanded partial migration fills all defaults', () => {
  const st = repo.migrate(JSON.stringify({ version: 2, settingsExpanded: { display: true } }));
  assert.deepEqual(st.settingsExpanded, { auto: true, display: true, leave: false, course: false, data: false, about: false });
});
test('repo: leaveStatus schemaVersion 1 old array migrates, demo filtered', () => {
  const st = repo.migrate(JSON.stringify({ version: 1, leaveStatus: [rec({ id: 'a' }), rec({ id: 'demo', demo: true })] }));
  assert.equal(st.leaveStatus.schemaVersion, 1);
  assert.deepEqual(st.leaveStatus.records.map((r) => r.id), ['a']);
});
test('web: three service targets exact', () => {
  assert.deepEqual(web.LEAVE_SERVICES.leave, { key: 'leave', mappId: '19998425', formId: '278616', entryUrl: 'https://xgxt.juwp.edu.cn/wfw/appInter/openPcApp?mappId=19998425', titleKey: 'web_office_title_leave' });
  assert.equal(web.LEAVE_SERVICES.cancel.formId, '278615');
  assert.equal(web.LEAVE_SERVICES.cancel.titleKey, 'web_office_title_cancel');
  assert.equal(web.LEAVE_SERVICES.renew.mappId, '19998423');
  assert.equal(web.LEAVE_SERVICES.renew.titleKey, 'web_office_title_renew');
  assert.equal(web.SSO_ENTRY, 'https://xgxt.juwp.edu.cn/sfrz/login343962');
});
test('web: office params and whitelist', () => {
  assert.deepEqual(web.buildWebOfficeParam('leave'), { key: 'leave', url: web.LEAVE_SERVICES.leave.entryUrl, warmupUrl: web.SSO_ENTRY, titleKey: 'web_office_title_leave' });
  assert.equal(web.buildWebOfficeParam('cancel').titleKey, 'web_office_title_cancel');
  assert.equal(web.buildWebOfficeParam('renew').titleKey, 'web_office_title_renew');
  assert.equal(web.buildLeaveServiceTarget('cancel').mappId, '19998424');
  assert.equal(web.isAllowedWebUrl('https://xgxt.juwp.edu.cn/a'), true);
  assert.equal(web.isAllowedWebUrl('https://xgxt.juwp.edu.cn:443/a'), true);
  assert.equal(web.isAllowedWebUrl('https://eapp2.juwp.edu.cn:9443/a'), true);
  assert.equal(web.isAllowedWebUrl('https://jwgl.juwp.edu.cn/a'), false);
  assert.equal(web.isAllowedWebUrl('http://xgxt.juwp.edu.cn/a'), false);
  assert.equal(web.isAllowedWebUrl('https://xgxt.juwp.edu.cn.evil.com/a'), false);
  assert.equal(web.isAllowedWebUrl('https://user@xgxt.juwp.edu.cn/a'), false);
  assert.equal(web.isAllowedWebUrl('https://xgxt.juwp.edu.cn:8443/a'), false);
  assert.equal(web.isAllowedWebUrl('https://evil-xgxt.juwp.edu.cn/a'), false);
  assert.equal(web.isAllowedWebUrl(''), false);
});
