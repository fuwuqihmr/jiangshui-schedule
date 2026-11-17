// 考试安排 → 课表条目（纯函数模块，不 import 任何仓库模块，避免 core.mjs ↔ jsxsd.mjs 循环依赖）。
// 设计：work/docs/exam-timetable-2026-11-17/设计-考试时间上课表.md §3/§5。
// 数据来源：school-reader.js 在已登录教务同源页面内 GET /jsxsd/xsks/xsksap_list 得到的原始 data 数组；
// 规范化（字段映射、时间→节次、周次、去重、稳定 id）全部在本模块完成，渲染仍走普通课程路径。
// 只读：本模块不发请求、不写 DOM、不接触 cookie。

export const EXAM_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay() || 7;
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const weekOf = (startDate, date) => Math.floor(daysBetween(startDate, date) / 7) + 1;

// '2026-12-21 19:00~20:25' → {date,startTime,endTime}；实测分隔符为 ~，容忍 ～、全角空格与首尾空白。
export function parseExamTime(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/\u3000/g, ' ').trim();
  const m = /^(\d{4}-\d{2}-\d{2})\s+([01]\d|2[0-3]):([0-5]\d)\s*[~～\-–—]\s*([01]\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!m) return null;
  const date = m[1], startTime = m[2] + ':' + m[3], endTime = m[4] + ':' + m[5];
  if (!validDate(date) || endTime <= startTime) return null;
  return { date, startTime, endTime };
}

// 时间区间 → 节次区间：与教务处第 1–11 节作息求交集。
// exact=true 表示起止恰好落在节次边界（实测 8 条考试全部 exact）；非整点仍保留实际起止时间。
export function timeToPeriods(startTime, endTime, periodTimes) {
  if (!TIME.test(String(startTime)) || !TIME.test(String(endTime)) || endTime <= startTime) return null;
  if (!periodTimes || typeof periodTimes !== 'object') return null;
  const periods = Object.keys(periodTimes).map(Number).filter((p) => Number.isInteger(p) && p > 0).sort((a, b) => a - b);
  const overlapping = periods.filter((p) => {
    const slot = periodTimes[p];
    return Array.isArray(slot) && slot[0] < endTime && slot[1] > startTime;
  });
  if (!overlapping.length) return null;
  const first = Math.min(...overlapping), last = Math.max(...overlapping);
  const exact = periodTimes[first][0] === startTime && periodTimes[last][1] === endTime;
  return { first, last, periods: Array.from({ length: last - first + 1 }, (_, i) => first + i), exact };
}

const text = (value, max = 80) => { const clean = String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim(); return clean.slice(0, max); };

// payload = 考试接口 JSON：{code:0,count,data:[...]}；返回 snapshot.exams 形状。
// 失败（HTML 外壳/字段改名/code!==0）只写 error 类别，不抛异常、不阻断课表读取。
export function normalizeExamList(payload, { semesterId, semesterStartDate, totalWeeks, periodTimes, fetchedAt } = {}) {
  const out = { semesterId, semesterStartDate, fetchedAt, error: null, source: 'school', items: [], skipped: [] };
  if (!payload || payload.code !== 0 || !Array.isArray(payload.data)) return { ...out, error: 'format' };
  const ids = new Set();
  for (const row of payload.data) {
    if (!row || typeof row !== 'object') { out.skipped.push({ reason: 'time' }); continue; }
    const parsed = parseExamTime(row.kssj);
    if (!parsed) { out.skipped.push({ reason: 'time' }); continue; }
    const week = weekOf(semesterStartDate, parsed.date);
    if (!Number.isInteger(week) || week < 0) { out.skipped.push({ reason: 'week' }); continue; }
    const slot = timeToPeriods(parsed.startTime, parsed.endTime, periodTimes);
    if (!slot) { out.skipped.push({ reason: 'period' }); continue; }
    const name = text(row.kskcmc, 80);
    if (!name) { out.skipped.push({ reason: 'name' }); continue; }
    const courseCode = text(row.kch, 32);
    const session = text(row.ksccmc, 32);
    const id = [courseCode || name, session, parsed.date, parsed.startTime].join('|');
    if (ids.has(id)) { out.skipped.push({ reason: 'duplicate' }); continue; }
    ids.add(id);
    out.items.push({
      id,
      name,
      teacher: text(row.jsxm, 80) || '—',
      room: text(row.js_mc, 80) || '—',
      seat: row.zwh == null || String(row.zwh).trim() === '' ? null : text(row.zwh, 16),
      campus: text(row.ksxq || row.xqmc, 40) || null,
      session: session || null,
      date: parsed.date,
      startTime: parsed.startTime,
      endTime: parsed.endTime,
      periods: slot.periods,
      first: slot.first,
      last: slot.last,
      exact: slot.exact,
      week,
      weekday: weekday(parsed.date),
    });
  }
  // 本轮结果只要有任何行被 skip 就视为不完整（字段改名/异常行）：调用方保留旧数据并通过 UI
  // 显示失败，不能用部分列表静默覆盖（T15 第二轮 P2-R2-3）；data 为空仍是合法的"暂无考试"。
  if (out.skipped.length) out.error = 'format';
  // 周次越界（week<1 或 week>教学周）按设计 §3.2-5 仍保留条目：日课表按日期可见，
  // 周课表只在 1..semester.weeks 内展示；此处不丢弃，避免把真实考试静默隐藏。
  // totalWeeks 仅参与语义校验（调用方传入当前快照周数），不用于过滤条目。
  out.items.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id));
  return out;
}

// snapshot.exams → 指定日期的课表条目（与普通课程同形状，由 core.effectiveDay / Java resolver 注入）。
// 学期校验是双保险：学期切换后旧考试数据即使残留也不会显示到新学期。
export function examDay(snapshot, date) {
  const exams = snapshot && snapshot.exams;
  if (!exams || !Array.isArray(exams.items) || !validDate(date)) return [];
  if (exams.semesterId !== snapshot.semester?.id || exams.semesterStartDate !== snapshot.semester?.startDate) return [];
  return exams.items
    .filter((item) => item && item.date === date)
    .map((item) => ({
      exam: true,
      examId: item.id,
      ruleId: 'exam-' + item.id,
      key: date + '/exam-' + item.id,
      date,
      originDate: date,
      name: item.name,
      teacher: item.teacher,
      room: item.room,
      seat: item.seat,
      campus: item.campus,
      weekday: item.weekday,
      periods: Array.isArray(item.periods) ? [...item.periods] : [],
      weeks: [item.week],
      startTime: item.startTime,
      endTime: item.endTime,
      source: 'school',
      sourceLabel: '考试安排',
      cancelled: false,
    }))
    .sort((a, b) => a.startTime.localeCompare(b.startTime) || a.key.localeCompare(b.key));
}

// 读取失败时保留旧考试数据：仅同学期保留（记录 lastAttempt/error），跨学期一律丢弃。
// fresh 为成功规范化结果时直接挂载；fresh 为空表示本次考试段失败，用 error 类别标记但不阻断课表。
export function withExamFallback(snapshot, fresh, previous, { now, error } = {}) {
  if (!snapshot) return snapshot;
  const semesterId = snapshot.semester?.id, startDate = snapshot.semester?.startDate;
  const sameSemester = (value) => !!value && value.semesterId === semesterId && value.semesterStartDate === startDate;
  if (fresh && !fresh.error && Array.isArray(fresh.items)) return { ...snapshot, exams: { ...fresh, lastAttempt: now ?? null } };
  if (sameSemester(previous)) return { ...snapshot, exams: { ...previous, lastAttempt: now ?? null, error: error || fresh?.error || 'other' } };
  return snapshot;
}

// 设置页/读取完成提示用的摘要（只含计数、时间戳与错误类别，不含课程内容）。
export function examSummary(exams) {
  const items = Array.isArray(exams?.items) ? exams.items : [];
  const fetchedAt = typeof exams?.fetchedAt === 'string' && Number.isFinite(Date.parse(exams.fetchedAt)) ? exams.fetchedAt : null;
  const age = fetchedAt ? Date.now() - Date.parse(fetchedAt) : NaN;
  return { count: items.length, fetchedAt, stale: !Number.isFinite(age) || age > EXAM_CACHE_TTL_MS, error: typeof exams?.error === 'string' ? exams.error : null };
}

// 把 reader/Java 返回的考试 payload 挂到快照（app.mjs / background.mjs 共用，避免重复实现）：
// - exams 数组：规范化后全量替换；规范化失败或全部行被 skip 时保留旧数据并写 error/lastAttempt；
// - examError：考试段失败类别，保留同学期旧数据并写入可见失败标记；
// - 两者都没有（旧原生版本不带该字段）：不动快照，交由 core.applySnapshot 保留旧 exams。
// previousExams 必须是旧的 snapshot.exams（不是 snapshot 本身）。
export function attachExamPayload(snapshot, payload, previousExams, { periodTimes, now } = {}) {
  if (!snapshot) return snapshot;
  const at = now || new Date().toISOString();
  if (Array.isArray(payload?.exams)) {
    const exams = normalizeExamList({ code: 0, data: payload.exams }, {
      semesterId: snapshot.semester?.id,
      semesterStartDate: snapshot.semester?.startDate,
      totalWeeks: snapshot.semester?.weeks,
      periodTimes,
      fetchedAt: payload.examFetchedAt || at,
    });
    if (!exams.error) return { ...snapshot, exams: { ...exams, lastAttempt: at } };
    const kept = withExamFallback(snapshot, exams, previousExams, { now: at, error: exams.error });
    // 没有可保留的旧数据（首次读取即失败）时只挂错误标记，保证设置页/读取提示可见失败。
    return kept.exams ? kept : { ...snapshot, exams: { ...exams, lastAttempt: at } };
  }
  if (payload?.examError === undefined && payload?.exams === undefined) return snapshot;
  const error = String(payload?.examError || 'other');
  const fallback = withExamFallback(snapshot, null, previousExams, { now: at, error });
  if (fallback.exams) return fallback;
  // 没有可保留的旧数据（首次读取即失败或跨学期）：挂只含错误标记的 exams，保证 UI/诊断可见失败。
  return { ...snapshot, exams: { semesterId: snapshot.semester?.id, semesterStartDate: snapshot.semester?.startDate, fetchedAt: null, lastAttempt: at, error, source: 'school', items: [], skipped: [] } };
}

// 考试变更记录（D4）：新增/时间变更/考场变更/取消，形状与 core.diffSnapshots 的事件一致，
// 复用现有变更记录/通知链路。过去场次不生成（与 diffSnapshots 一致）。
const EXAM_FIELDS = ['name', 'teacher', 'room', 'seat', 'startTime', 'endTime'];
const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function examEventType(fields) {
  if (fields.includes('startTime') || fields.includes('endTime')) return '改时间';
  if (fields.includes('room')) return '换考场';
  // 仅座位号变化单独成类，避免出现"换考场"但展示文本相同的事件（T15 P2-5）。
  if (fields.includes('seat')) return '换座位';
  if (fields.includes('teacher')) return '换教师';
  if (fields.includes('name')) return '课程调整';
  return '考试调整';
}
export function diffExamSnapshots(before, after, now = new Date().toISOString()) {
  if (!after || !Array.isArray(after.items) || !before || !Array.isArray(before.items)) return [];
  // 首次获得数据（此前无基线，或此前只有失败标记的空列表）不生成「新增」事件，避免首次成功
  // 就合成一次批量变更通知；从第二次成功读取起才 diff（T15 第二轮 P2-R2-4）。
  if (!before.items.length) return [];
  if (before.semesterId && after.semesterId && before.semesterId !== after.semesterId) return [];
  if (before.semesterStartDate && after.semesterStartDate && before.semesterStartDate !== after.semesterStartDate) return [];
  const oldMap = new Map(before.items.map((item) => [item.id, item]));
  const newMap = new Map(after.items.map((item) => [item.id, item]));
  const result = [];
  for (const id of new Set([...oldMap.keys(), ...newMap.keys()])) {
    const a = oldMap.get(id), b = newMap.get(id), r = b || a;
    if (!r || !validDate(r.date)) continue;
    if (Date.parse(r.date + 'T' + r.endTime + ':00+08:00') <= Date.parse(now)) continue;
    const fields = EXAM_FIELDS.filter((field) => !equal(a?.[field], b?.[field]));
    if (!fields.length) continue;
    const key = r.date + '/exam-' + id;
    result.push({ id: now + '/' + key, key, date: r.date, name: r.name || '考试安排', before: a || null, after: b || null, fields, type: !a ? '新增' : !b ? '考试取消' : examEventType(fields), source: 'school', exam: true, read: false, notifiedAt: null, detectedAt: now });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}
