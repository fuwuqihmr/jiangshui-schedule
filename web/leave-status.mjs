// 假条状态：本地数据模型、状态映射、时间交集和示例 provider。
// 本模块不读取 Cookie/TGC/账号密码，也不发起任何网络请求。
import {addDays, today, validDate, timetableDay} from './core.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const MAX_SPAN_MS = 90 * 86400000;
const LEAVE_TYPES = new Set(['leave', 'cancel', 'renew']);
const LEAVE_STATUSES = new Set(['approved', 'pending', 'rejected', 'unknown']);
const STATUS_ORDER = {approved: 0, pending: 1, rejected: 2, unknown: 3};

function cleanText(value, max) {
  return String(value ?? '').replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function timeToMinutes(value) {
  if (!TIME_RE.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(total) {
  const value = Math.max(0, Math.min(23 * 60 + 59, total));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function shiftTime(value, delta) {
  const minutes = timeToMinutes(value);
  return minutes === null ? null : minutesToTime(minutes + delta);
}

function toMs(date, time) {
  if (!validDate(date) || !TIME_RE.test(time)) return null;
  const value = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isFinite(value) ? value : null;
}

function intervalFrom(startDate, startTime, endDate, endTime) {
  const start = toMs(startDate, startTime);
  const end = toMs(endDate, endTime);
  if (start === null || end === null || end <= start) return null;
  return {start, end};
}

/** 单条假条状态映射；已归一化的枚举原样返回。 */
export function statusFromRaw(raw) {
  const value = String(raw ?? '').trim();
  if (LEAVE_STATUSES.has(value)) return value;
  if (!value) return 'unknown';
  // 先判驳回，避免“未通过”被后面的“通过”误判为已批准。
  if (/驳回|退回|未通过|不通过|未批准|未同意|未审核通过|未获通过|不予通过|拒绝|不同意/.test(value)) return 'rejected';
  if (/待审批|审批中|待审核|审核中|处理中|已提交/.test(value)) return 'pending';
  if (/已通过|审批通过|已批准|已批|通过|同意|已完成/.test(value)) return 'approved';
  return 'unknown';
}

/**
 * 原生 status 与原生文本冲突时取保守值：只有文本也明确“已通过”才允许 approved；
 * statusId 不参与推断，文本缺失且记录带原生文本字段时一律 unknown。
 */
function conservativeStatus(raw) {
  const native = String(raw?.status ?? '').trim();
  const text = String(raw?.rawStatus ?? raw?.statusText ?? '').trim();
  const hasNativeText = Object.prototype.hasOwnProperty.call(raw || {}, 'rawStatus') || Object.prototype.hasOwnProperty.call(raw || {}, 'statusText');
  if (!text) return hasNativeText ? 'unknown' : (LEAVE_STATUSES.has(native) ? native : statusFromRaw(native));
  const fromText = statusFromRaw(text);
  if (!LEAVE_STATUSES.has(native)) return fromText;
  if (native === 'approved') return fromText === 'approved' ? 'approved' : fromText;
  return native;
}

/** after-leave 刷新闸门：请假同步换代或示例模式下不发销假请求。 */
export function shouldRefreshCancelAfterLeave(epoch, currentEpoch, sample) {
  return !sample && epoch === currentEpoch;
}

export function leaveStatusLabel(status) {
  return {approved: '已批准', pending: '待审批', rejected: '已驳回', unknown: '状态未知'}[status] || '状态未知';
}

export function leaveTypeLabel(type) {
  return {leave: '请假', cancel: '销假', renew: '续假'}[type] || '请假';
}

export const CANCEL_COPY = Object.freeze({
  approved: '已销假',
  pending: '销假审批中',
  needsCancel: '待销假',
  unknown: '销假状态未知',
  pendingSync: '销假状态待同步',
  saveFailed: '销假状态已读取，但本地保存失败',
  button: '销假',
  timeUnknown: '时间未提供',
  confirmed: '系统已确认',
  manual: '已销假（手动标记）',
  manualAction: '手动销假',
  manualUndo: '取消手动销假标记',
  manualNotice: '本机标记，学校系统状态以学校为准',
  markedAt: '本机标记于',
  manualConfirmTitle: '手动销假？',
  manualConfirmBody: '仅在本机标记为已销假，不会提交到学校系统。学校系统状态以学校为准。',
  manualConfirmAction: '确认标记',
  manualUndoTitle: '取消手动销假标记？',
  manualUndoBody: '取消后，若学校仍未销假且请假已结束，会重新显示为待销假。',
  manualUndoAction: '确认取消',
  manualSaved: '已标记为手动销假',
  manualRemoved: '已取消手动销假标记',
  manualSaveFailed: '手动销假标记未能保存，请重试',
  manualMissingNumber: '该假条缺少编号，无法手动销假',
  manualNotAvailable: '该假条当前不能手动销假',
  manualRecordMissing: '该假条已不在当前列表中，请刷新后重试',
  exportNotice: '手动销假标记会随课表快照导出，不会带入提醒通知或排查日志。'
});

/** 销假记录自己的状态标签；请假记录仍用 leaveStatusLabel。 */
export function cancelStatusLabel(status) {
  if (status === 'approved') return CANCEL_COPY.approved;
  if (status === 'pending') return CANCEL_COPY.pending;
  return leaveStatusLabel(status);
}

/**
 * 列表只展示请假/续假；销假记录只作为请假编号对应的状态徽标，不能单独占一行。
 * @param {Array} records
 * @returns {Array}
 */
export function visibleLeaveRecords(records = []) {
  return (Array.isArray(records) ? records : []).filter(record => record && typeof record === 'object' && record.type !== 'cancel');
}

/**
 * 请假记录对应的销假状态。关联键是请假编号；只有已通过的销假才算已销假。
 * fresh=false 表示本次没有拿到销假数据：不得据此推断“未销假”，只显示待同步。
 * @returns {{state:string,label:string,canCancel:boolean,record?:object}|null}
 */
export function leaveCancelState(record, records = [], opts = {}) {
  if (!record || typeof record !== 'object' || record.type !== 'leave' || record.status !== 'approved') return null;
  const number = cleanText(record.number, 60);
  const cancels = (Array.isArray(records) ? records : []).filter(item => item?.type === 'cancel' && number && cleanText(item.number, 60) === number);
  const approved = cancels.find(item => item.status === 'approved');
  if (approved) return {state: 'cancelled', label: CANCEL_COPY.approved, canCancel: false, record: approved};
  const pending = cancels.find(item => item.status === 'pending');
  if (pending) return {state: 'canceling', label: CANCEL_COPY.pending, canCancel: false, record: pending};
  const interval = leaveInterval(record);
  const expired = !!interval && interval.end <= (opts.now ?? Date.now());
  if (!expired) return null;
  if (opts.fresh === false) return {state: 'unknown', label: CANCEL_COPY.pendingSync, canCancel: false};
  if (!number) return {state: 'unknown', label: CANCEL_COPY.unknown, canCancel: false};
  return {state: 'needs-cancel', label: CANCEL_COPY.needsCancel, canCancel: true};
}

/**
 * 本机“手动销假”标记。只保存请假编号和标记时间，不保存学校状态；
 * 编号已不在学校列表里的孤儿标记也保留，避免学校短暂漏返回时丢掉本机操作。
 * @param {unknown} value
 * @returns {{schemaVersion:number,marks:Array<{number:string,markedAt:string}>}}
 */
export function normalizeManualCancelMarks(value) {
  const raw = Array.isArray(value) ? value : value && typeof value === 'object' && Array.isArray(value.marks) ? value.marks : [];
  const marks = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const number = cleanText(item.number, 60);
    const at = Date.parse(String(item.markedAt ?? ''));
    if (!number || !Number.isFinite(at) || seen.has(number)) continue;
    seen.add(number);
    marks.push({number, markedAt: new Date(at).toISOString()});
  }
  marks.sort((a, b) => a.number.localeCompare(b.number));
  return {schemaVersion: 1, marks};
}

/** 查本机标记；没有编号或没有标记时返回 null。 */
export function manualCancelMark(value, number) {
  const key = cleanText(number, 60);
  if (!key) return null;
  return normalizeManualCancelMarks(value).marks.find(mark => mark.number === key) || null;
}

/** 同编号重复标记幂等：已存在时保留原 markedAt。 */
export function markManualCancel(value, number, markedAt = new Date().toISOString()) {
  const normalized = normalizeManualCancelMarks(value);
  const key = cleanText(number, 60);
  const at = Date.parse(String(markedAt ?? ''));
  if (!key || !Number.isFinite(at) || normalized.marks.some(mark => mark.number === key)) return normalized;
  const marks = [...normalized.marks, {number: key, markedAt: new Date(at).toISOString()}].sort((a, b) => a.number.localeCompare(b.number));
  return {schemaVersion: 1, marks};
}

export function unmarkManualCancel(value, number) {
  const normalized = normalizeManualCancelMarks(value);
  const key = cleanText(number, 60);
  return {schemaVersion: 1, marks: key ? normalized.marks.filter(mark => mark.number !== key) : normalized.marks};
}

/** 本机 markedAt 的“上海日期”，与学校时间无关。 */
export function manualCancelDateLabel(value) {
  const at = Date.parse(String(value ?? ''));
  if (!Number.isFinite(at)) return '';
  return new Date(at + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 把本机手动销假合并到学校销假状态。优先级：
 * 学校已通过（有本机标记时显示“系统已确认”）> 学校审批中 > 本机手动 > 待销假/未知。
 * @param {object|null} base leaveCancelState 的学校结果
 * @param {object} record 请假记录
 * @param {object} manual normalizeManualCancelMarks 的结果
 */
export function applyManualCancel(base, record, manual) {
  if (!base || !record || record.type !== 'leave' || record.status !== 'approved') return base;
  if (base.state === 'canceling') return base;
  if (base.state === 'cancelled') {
    const mark = manualCancelMark(manual, record.number);
    return mark ? {...base, state: 'confirmed', label: CANCEL_COPY.confirmed, canCancel: false, manual: true, markedAt: mark.markedAt} : base;
  }
  if (base.state === 'confirmed' || base.state === 'manual') return base;
  const mark = manualCancelMark(manual, record.number);
  if (!mark) return base;
  return {state: 'manual', label: CANCEL_COPY.manual, canCancel: false, manual: true, markedAt: mark.markedAt};
}

/**
 * 规范化单条记录；无法安全展示时返回 null，绝不让脏数据进入 UI。
 * @param {object} raw
 * @param {{semesterId?:string}} [opts]
 */
export function normalizeLeaveRecord(raw, opts = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = cleanText(raw.id, 120);
  const type = cleanText(raw.type, 20);
  if (!id || !LEAVE_TYPES.has(type)) return null;

  let startDate = cleanText(raw.startDate, 10);
  let endDate = raw.endDate == null || raw.endDate === '' ? startDate : cleanText(raw.endDate, 10);
  let startTime = raw.startTime == null || raw.startTime === '' ? '00:00' : cleanText(raw.startTime, 5);
  let endTime = raw.endTime == null || raw.endTime === '' ? '23:59' : cleanText(raw.endTime, 5);

  if (type === 'cancel') {
    // 销假记录可能没有请假起止时间；缺区间只影响展示，不得丢掉整条销假记录。
    const valid = DATE_RE.test(startDate) && validDate(startDate) && DATE_RE.test(endDate) && validDate(endDate) && TIME_RE.test(startTime) && TIME_RE.test(endTime);
    const start = valid ? toMs(startDate, startTime) : null;
    const end = valid ? toMs(endDate, endTime) : null;
    if (start === null || end === null || end <= start || end - start > MAX_SPAN_MS) {
      startDate = '';
      startTime = '';
      endDate = '';
      endTime = '';
    }
  } else {
    if (!DATE_RE.test(startDate) || !validDate(startDate)) return null;
    if (!DATE_RE.test(endDate) || !validDate(endDate)) return null;
    if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return null;
    const start = toMs(startDate, startTime);
    const end = toMs(endDate, endTime);
    if (start === null || end === null || end <= start || end - start > MAX_SPAN_MS) return null;
  }

  const submitted = raw.submittedAt == null || raw.submittedAt === '' ? null : Date.parse(String(raw.submittedAt));
  return {
    id,
    type,
    number: cleanText(raw.number, 60),
    status: conservativeStatus(raw),
    startDate,
    startTime,
    endDate,
    endTime,
    reason: cleanText(raw.reason, 500),
    submittedAt: Number.isFinite(submitted) ? new Date(submitted).toISOString() : null,
    approver: cleanText(raw.approver, 200),
    comment: cleanText(raw.comment, 200),
    rawStatus: cleanText(raw.rawStatus ?? raw.statusText ?? raw.status, 60),
    semesterId: cleanText(raw.semesterId ?? opts.semesterId, 80) || null,
    demo: raw.demo === true
  };
}

/** 批量规范化；保持输入顺序，重复 id 保留首条。 */
export function normalizeLeaveRecords(rawList, opts = {}) {
  if (!Array.isArray(rawList)) return {records: [], skipped: 0};
  const records = [];
  const seen = new Set();
  let skipped = 0;
  for (const raw of rawList) {
    const record = normalizeLeaveRecord(raw, opts);
    if (!record || seen.has(record.id)) {
      skipped += 1;
      continue;
    }
    seen.add(record.id);
    records.push(record);
  }
  return {records, skipped};
}

export function emptyLeaveStatus(semesterId = null) {
  return {schemaVersion: 1, provider: 'school', semesterId: cleanText(semesterId, 80) || null, fetchedAt: null, records: []};
}

/** 迁移缓存：旧裸数组、坏对象、旧学期和示例记录都不展示。 */
export function normalizeLeaveStatusCache(value, semesterId = null) {
  const empty = emptyLeaveStatus(semesterId);
  if (Array.isArray(value)) value = {schemaVersion: 1, provider: 'school', semesterId, fetchedAt: null, records: value};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;
  if (value.semesterId && semesterId && value.semesterId !== semesterId) return empty;

  const {records, skipped} = normalizeLeaveRecords(Array.isArray(value.records) ? value.records : [], {semesterId});
  const real = records.filter(record => !record.demo);
  real.sort((a, b) => {
    const startA = leaveInterval(a)?.start ?? Number.MAX_SAFE_INTEGER;
    const startB = leaveInterval(b)?.start ?? Number.MAX_SAFE_INTEGER;
    if (startA !== startB) return startA - startB;
    return a.id.localeCompare(b.id);
  });
  // 200 条上限优先保留销假记录（它们是销假关联的证据），再按时间保留其余记录。
  const cancelRecords = real.filter(record => record.type === 'cancel').slice(-200);
  const regularRecords = real.filter(record => record.type !== 'cancel');
  const room = 200 - cancelRecords.length;
  const limited = [...(room > 0 ? regularRecords.slice(-room) : []), ...cancelRecords].sort((a, b) => {
    const startA = leaveInterval(a)?.start ?? Number.MAX_SAFE_INTEGER;
    const startB = leaveInterval(b)?.start ?? Number.MAX_SAFE_INTEGER;
    if (startA !== startB) return startA - startB;
    return a.id.localeCompare(b.id);
  });
  const fetched = value.fetchedAt == null ? null : Date.parse(String(value.fetchedAt));
  return {
    schemaVersion: 1,
    provider: value.provider === 'sample' ? null : 'school',
    semesterId: cleanText(semesterId ?? value.semesterId, 80) || null,
    fetchedAt: Number.isFinite(fetched) ? new Date(fetched).toISOString() : null,
    records: limited,
    skipped
  };
}

export function leaveStatusSummary(records = []) {
  const summary = {approved: 0, pending: 0, rejected: 0, unknown: 0, total: 0};
  for (const record of Array.isArray(records) ? records : []) {
    const status = LEAVE_STATUSES.has(record?.status) ? record.status : 'unknown';
    summary[status] += 1;
    summary.total += 1;
  }
  return summary;
}

/** 单条假条区间（+08:00 毫秒）；缺省时间按 00:00/23:59。 */
export function leaveInterval(record) {
  if (!record || typeof record !== 'object') return null;
  const startDate = record.startDate || record.date;
  const endDate = record.endDate || startDate;
  return intervalFrom(
    cleanText(startDate, 10),
    record.startTime == null || record.startTime === '' ? '00:00' : cleanText(record.startTime, 5),
    cleanText(endDate, 10),
    record.endTime == null || record.endTime === '' ? '23:59' : cleanText(record.endTime, 5)
  );
}

/** 课程区间；缺字段或非法时间返回 null。 */
export function courseInterval(course) {
  if (!course || typeof course !== 'object') return null;
  return intervalFrom(
    cleanText(course.date, 10),
    cleanText(course.startTime, 5),
    cleanText(course.date, 10),
    cleanText(course.endTime, 5)
  );
}

/** 左闭右开、严格重叠；首尾相接不算。 */
export function overlapsCourse(record, course) {
  const leave = leaveInterval(record);
  const lesson = courseInterval(course);
  return !!leave && !!lesson && lesson.start < leave.end && leave.start < lesson.end;
}

/**
 * 课程上的假条标记。approved 优先 pending；驳回/未知/销假不产生标记。
 * 晚自习、停课和灰色空闲不参与联动。
 */
export function leaveMarkForCourse(course, records, options = {}) {
  if (!course || course.cancelled || course.vacant || course.localActivity) return null;
  const matched = [];
  for (const record of Array.isArray(records) ? records : []) {
    if (record?.type !== 'leave' && record?.type !== 'renew') continue;
    if (record.status !== 'approved' && record.status !== 'pending') continue;
    if (overlapsCourse(record, course)) matched.push(record);
  }
  if (!matched.length) return null;
  const approvedCount = matched.filter(record => record.status === 'approved').length;
  const pendingCount = matched.filter(record => record.status === 'pending').length;
  return {status: approvedCount > 0 ? 'approved' : 'pending', records: matched, approvedCount, pendingCount};
}

/** 返回 Map<course.key, LeaveMark>；同一门课的多条记录会合并。 */
export function matchLeaveMarks(courses, records, options = {}) {
  const marks = new Map();
  for (const course of Array.isArray(courses) ? courses : []) {
    if (!course?.key) continue;
    const mark = leaveMarkForCourse(course, records, options);
    if (mark) marks.set(course.key, mark);
  }
  return marks;
}

/** 某天有交集的记录（按天左闭右开，跨天按真实区间）。 */
export function leaveRecordsForDate(records, date) {
  if (!validDate(date)) return [];
  const dayStart = toMs(date, '00:00');
  const nextDate = addDays(date, 1);
  const dayEnd = toMs(nextDate, '00:00');
  if (dayStart === null || dayEnd === null) return [];
  return (Array.isArray(records) ? records : []).filter(record => {
    const interval = leaveInterval(record);
    return !!interval && interval.start < dayEnd && dayStart < interval.end;
  });
}

/** 已批准 → 待审批 → 已驳回 → 未知，再按开始时间。 */
export function sortLeaveRecords(records = []) {
  return [...(Array.isArray(records) ? records : [])].sort((a, b) => {
    const statusA = STATUS_ORDER[a?.status] ?? STATUS_ORDER.unknown;
    const statusB = STATUS_ORDER[b?.status] ?? STATUS_ORDER.unknown;
    if (statusA !== statusB) return statusA - statusB;
    const startA = leaveInterval(a)?.start ?? Number.MAX_SAFE_INTEGER;
    const startB = leaveInterval(b)?.start ?? Number.MAX_SAFE_INTEGER;
    if (startA !== startB) return startA - startB;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

function demoRange(course, date, semesterId, suffix, status, type, rawStatus, reason) {
  const startTime = shiftTime(course.startTime, -10) || '00:00';
  const endTime = shiftTime(course.endTime, 10) || '23:59';
  return {
    id: `demo-${date}-${suffix}`,
    type,
    status,
    rawStatus,
    startDate: date,
    startTime,
    endDate: date,
    endTime,
    reason,
    submittedAt: `${date}T18:30:00+08:00`,
    approver: '辅导员（示例）',
    comment: status === 'approved' ? '同意（示例）' : '',
    semesterId,
    demo: true
  };
}

/**
 * 基于当天最终生效课表生成稳定示例假条。
 * approved 必定命中第一门课；没有课程时返回空数组。
 */
export function sampleLeaveRecords(state, date = today()) {
  if (!state?.snapshot || !validDate(date)) return [];
  let courses = [];
  try {
    courses = timetableDay(
      state.snapshot,
      date,
      state.overrides,
      state.localMaps,
      state.courseSettings,
      state.customCourses,
      state.holidaySettings
    );
  } catch {
    return [];
  }
  courses = courses
    .filter(course => course && !course.cancelled && !course.vacant && !course.localActivity && course.startTime < course.endTime)
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || String(a.key).localeCompare(String(b.key)));
  if (!courses.length) return [];

  const distinct = [];
  for (const course of courses) {
    if (!distinct.some(other => other.startTime < course.endTime && course.startTime < other.endTime)) distinct.push(course);
  }
  const semesterId = state.snapshot.semester.id;
  const first = courses[0];
  const pendingCourse = distinct[1] || first;
  const third = distinct[2];
  const raw = [
    demoRange(first, date, semesterId, 'leave-approved', 'approved', 'leave', '审批通过', '身体不适（示例）'),
    demoRange(pendingCourse, date, semesterId, 'leave-pending', 'pending', 'leave', '待审批', '参加活动（示例）'),
    third
      ? demoRange(third, date, semesterId, 'leave-rejected', 'rejected', 'leave', '未通过', '事由不充分（示例）')
      : {
          id: `demo-${date}-leave-rejected`,
          type: 'leave',
          status: 'rejected',
          rawStatus: '未通过',
          startDate: date,
          startTime: '12:00',
          endDate: date,
          endTime: '12:30',
          reason: '事由不充分（示例）',
          submittedAt: `${date}T18:30:00+08:00`,
          approver: '辅导员（示例）',
          comment: '',
          semesterId,
          demo: true
        },
    {
      id: `demo-${date}-leave-cancel`,
      type: 'cancel',
      status: 'approved',
      rawStatus: '已通过',
      startDate: date,
      startTime: '18:00',
      endDate: date,
      endTime: '18:30',
      reason: '提前销假（示例）',
      submittedAt: `${date}T18:30:00+08:00`,
      approver: '辅导员（示例）',
      comment: '',
      semesterId,
      demo: true
    }
  ];
  return normalizeLeaveRecords(raw, {semesterId}).records;
}

export const LEAVE_PROVIDER_MODE = 'sample';

function providerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function aborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('读取已取消');
  error.name = 'AbortError';
  throw error;
}

export const sampleLeaveRecordsProvider = {
  id: 'sample',
  async list({state, signal, now = Date.now()} = {}) {
    aborted(signal);
    const date = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date(now));
    const records = sampleLeaveRecords(state, date);
    aborted(signal);
    return {records, fetchedAt: new Date(now).toISOString(), source: 'sample', skipped: 0};
  }
};

export const schoolLeaveRecordsProvider = {
  id: 'school',
  async list() {
    throw providerError('LEAVE_PROVIDER_UNAVAILABLE', '学校假条数据尚未接入');
  }
};

/** 原生接口状态：只信文本；statusId 不单独推断已通过，空文本一律 unknown。 */
export function statusFromSchool(statusText, statusId) {
  const text = String(statusText ?? '').trim();
  return text ? statusFromRaw(text) : 'unknown';
}

export function schoolLeaveErrorMessage(code) {
  if (code === 'NEED_LOGIN') return '请先打开一次请假服务完成登录';
  if (code === 'NEED_SESSION') return '请先在请假服务里打开一次请假页面';
  if (code === 'NEED_CANCEL_SESSION') return '请先在销假服务里打开一次销假页面';
  if (code === 'TIMEOUT') return '读取超时，请稍后重试';
  return '学校服务暂时不可用，稍后再试';
}

function schoolDateTime(value) {
  const match = String(value ?? '').trim().match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?/);
  if (!match) return null;
  return {date: match[1], time: match[2] ? `${match[2]}:${match[3]}` : '00:00'};
}

function schoolRecord(raw, semesterId) {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type === 'cancel' ? 'cancel' : raw.type === 'renew' ? 'renew' : 'leave';
  const start = schoolDateTime(raw.startAt);
  const end = schoolDateTime(raw.endAt);
  // 销假记录缺区间也必须保留；请假/续假仍要求完整区间，避免脏数据进入课表联动。
  if (type !== 'cancel' && (!start || !end)) return null;
  const hasInterval = !!(start && end);
  // 只信原生文本；statusId 和已归一化 status 都不能单独把记录提升为 approved。
  const status = statusFromSchool(raw.statusText, raw.statusId);
  return {
    id: String(raw.id ?? ''),
    type,
    number: String(raw.number ?? ''),
    status,
    rawStatus: String(raw.statusText ?? '').trim(),
    startDate: hasInterval ? start.date : '',
    startTime: hasInterval ? start.time : '',
    endDate: hasInterval ? end.date : '',
    endTime: hasInterval ? end.time : '',
    reason: raw.reason ?? '',
    submittedAt: raw.submittedAt ?? null,
    approver: raw.approver ?? '',
    comment: '',
    semesterId
  };
}

/** 真实学校数据 provider；request 由 app 注入（Android bridge: leaveRecordSync）。 */
export function createSchoolRecordsProvider({request} = {}) {
  if (typeof request !== 'function') throw new TypeError('request 必须是函数');
  return {
    id: 'school',
    async list({state, signal} = {}) {
      aborted(signal);
      let response;
      try {
        response = await request({});
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        const unsupported = /不支持的操作/.test(String(error?.message ?? ''));
        const code = unsupported ? 'NEED_LOGIN' : (error?.code || 'NETWORK');
        throw providerError(code, schoolLeaveErrorMessage(code));
      }
      aborted(signal);
      if (!response) throw providerError('NEED_LOGIN', schoolLeaveErrorMessage('NEED_LOGIN'));
      if (response.ok !== true) {
        const code = response.code || 'NETWORK';
        throw providerError(code, schoolLeaveErrorMessage(code));
      }
      if (!Array.isArray(response.records)) throw providerError('PARSE', schoolLeaveErrorMessage('PARSE'));
      const semesterId = state?.snapshot?.semester?.id ?? null;
      const normalized = normalizeLeaveRecords(response.records.map(record => schoolRecord(record, semesterId)), {semesterId});
      const fetchedAt = Number.isFinite(Number(response.fetchedAt)) && Number(response.fetchedAt) > 0
        ? new Date(Number(response.fetchedAt)).toISOString()
        : new Date().toISOString();
      return {
        records: normalized.records,
        fetchedAt,
        source: 'school',
        skipped: normalized.skipped
      };
    }
  };
}

export function getLeaveRecordsProvider(mode = LEAVE_PROVIDER_MODE) {
  if (mode === 'school') return schoolLeaveRecordsProvider;
  return sampleLeaveRecordsProvider;
}
