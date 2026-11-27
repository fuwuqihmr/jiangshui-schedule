// 实验课上课表 → 课表条目（纯函数模块，不 import 任何仓库模块，不使用 DOMParser）。
// 设计：work/docs/lab-timetable-2026-11-25/设计-实验课上课表.md §2.1/§2.3/§2.4。
// 数据来源：school-reader.js 在已登录教务同源页面内 GET /jsxsd/syjx/toXskb.do 得到的整页 HTML；
// 只读：本模块不发请求、不写 DOM、不接触 cookie。

export const LAB_TIMETABLE_URL = '/jsxsd/syjx/toXskb.do';
export const LAB_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const SECTION = /^([1-7])((?:\d{2})+)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAY_TEXT = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
const LAB_FIELDS = ['name', 'room', 'startTime', 'endTime'];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const failedResult = (code) => ({ ok: false, items: [], skipped: [], weeks: [], error: code });

function decodeEntities(value) {
  return String(value == null ? '' : value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function textOf(value, max = 80) {
  const plain = decodeEntities(String(value == null ? '' : value).replace(/<[^>]*>/g, ' '))
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.slice(0, max);
}

function validDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const weekdayOf = (date) => new Date(date + 'T00:00:00Z').getUTCDay() || 7;
const weekOf = (startDate, date) => Math.floor(Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) / 86400000) / 7) + 1;

function labDate(startDate, week, weekday) {
  if (!validDate(startDate) || !Number.isInteger(week) || !Number.isInteger(weekday)) return null;
  const time = Date.parse(startDate + 'T00:00:00Z') + ((week - 1) * 7 + (weekday - 1)) * 86400000;
  if (!Number.isFinite(time)) return null;
  const date = new Date(time);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

// 节次编码是权威来源：<星期 1-7><两位节次>...，如 60102030405060708 = 周六 1-8 节。
export function parseSectionCode(code) {
  if (typeof code !== 'string') return null;
  const m = SECTION.exec(code.trim());
  if (!m) return null;
  const weekday = Number(m[1]);
  const periods = [];
  for (let i = 0; i < m[2].length; i += 2) {
    const period = Number(m[2].slice(i, i + 2));
    if (period < 1 || period > 11) return null;
    if (periods.indexOf(period) < 0) periods.push(period);
  }
  return periods.length ? { weekday, periods } : null;
}

function sectionFrom(record) {
  if (record && record.sectionCode != null) {
    const code = String(record.sectionCode).replace(/\s+/g, '');
    const parsed = parseSectionCode(code);
    if (parsed) return { code, weekday: parsed.weekday, periods: parsed.periods };
    return null;
  }
  // 兼容已经规范化过的条目（payload/快照回灌），sectionCode 缺失时按 periods + weekday 复原。
  if (record && Array.isArray(record.periods) && record.periods.length) {
    const periods = Array.from(new Set(record.periods.map(Number).filter((p) => Number.isInteger(p) && p >= 1 && p <= 11))).sort((a, b) => a - b);
    const weekday = Number(record.weekday);
    if (periods.length && Number.isInteger(weekday) && weekday >= 1 && weekday <= 7) return { code: record.sectionCode == null ? '' : String(record.sectionCode), weekday, periods };
  }
  return null;
}

function classText(value) {
  const clean = textOf(value, 120).replace(/[0-9]{6,}.*$/, '').trim();
  return clean || null;
}

function recordToItem(record, periodTimes, totalWeeks, skipped) {
  const week = Number(record && record.week);
  if (!Number.isInteger(week) || week < 1) { skipped.push({ reason: 'week' }); return null; }
  if (Number.isInteger(totalWeeks) && totalWeeks > 0 && week > totalWeeks) { skipped.push({ reason: 'week' }); return null; }
  const name = textOf(record && record.name, 80);
  if (!name) { skipped.push({ reason: 'name' }); return null; }
  const section = sectionFrom(record);
  if (!section) { skipped.push({ reason: 'section' }); return null; }
  if (!periodTimes || typeof periodTimes !== 'object') { skipped.push({ reason: 'section' }); return null; }
  const periods = section.periods.slice().sort((a, b) => a - b);
  if (periods.some((period) => !Array.isArray(periodTimes[period]))) { skipped.push({ reason: 'section' }); return null; }
  const first = periods[0];
  const last = periods[periods.length - 1];
  const startTime = periodTimes[first][0];
  const endTime = periodTimes[last][1];
  if (typeof startTime !== 'string' || typeof endTime !== 'string' || endTime <= startTime) { skipped.push({ reason: 'section' }); return null; }
  const courseCode = textOf(record && record.courseCode, 32);
  const className = classText(record && record.className);
  const room = textOf(record && record.room, 80) || '—';
  const id = [courseCode || name, week, section.weekday, section.code].join('|');
  const item = {
    id,
    week,
    weekday: section.weekday,
    name,
    courseCode,
    room,
    sectionCode: section.code,
    periods,
    first,
    last,
    startTime,
    endTime,
    exact: periods.length === last - first + 1,
    lab: true,
    sourceLabel: '实验课',
  };
  if (className) item.className = className;
  return item;
}

// 规范化原始记录（HTML 解析结果或原生回传的 labs 数组）；不合法条目记 skipped，不抛异常。
export function normalizeLabList(raw, { periodTimes, totalWeeks } = {}) {
  const records = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.items)
      ? raw.items
      : raw && raw.labs && Array.isArray(raw.labs.items)
        ? raw.labs.items
        : [];
  const items = [];
  const skipped = [];
  const weeks = new Set();
  const seen = new Set();
  for (const record of records) {
    const item = recordToItem(record, periodTimes, totalWeeks, skipped);
    if (!item) continue;
    const dedupe = [item.week, item.name, item.room, item.sectionCode].join('|');
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    items.push(item);
    weeks.add(item.week);
  }
  items.sort((a, b) => a.week - b.week || a.weekday - b.weekday || cmp(a.startTime, b.startTime) || cmp(a.id, b.id));
  const ok = !(items.length === 0 && skipped.length > 0);
  return { ok, items, skipped, weeks: Array.from(weeks).sort((a, b) => a - b), error: ok ? null : 'format' };
}

function cellsOf(rowHtml) {
  const cells = [];
  const re = /<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(rowHtml))) {
    const attrs = m[2];
    const rowspanMatch = /rowspan\s*=\s*["']?(\d+)/i.exec(attrs);
    const classMatch = /\bclass\s*=\s*["']([^"']*)["']/i.exec(attrs);
    const html = m[3];
    cells.push({
      rowspan: Math.max(1, Number(rowspanMatch ? rowspanMatch[1] : 1) || 1),
      class: classMatch ? classMatch[1] : '',
      html,
      text: textOf(html, 200),
    });
  }
  return cells;
}

function layoutRow(rowHtml, width, carries) {
  const row = new Array(width).fill(null);
  for (let col = 0; col < width; col++) {
    const carry = carries[col];
    if (!carry) continue;
    row[col] = { text: carry.text, class: carry.class, html: carry.html };
    carry.left -= 1;
    if (carry.left <= 0) carries[col] = null;
  }
  let col = 0;
  for (const cell of cellsOf(rowHtml)) {
    while (col < width && row[col] !== null) col++;
    if (col >= width) break;
    row[col] = cell;
    if (cell.rowspan > 1) carries[col] = { left: cell.rowspan - 1, text: cell.text, class: cell.class, html: cell.html };
    col++;
  }
  return row;
}

function titleOf(html) {
  const m = /<[a-zA-Z0-9]+\b[^>]*class\s*=\s*["'][^"']*qz-hasCourse-title[^"']*["'][^>]*>([\s\S]*?)<\/[a-zA-Z0-9]+>/i.exec(html);
  return m ? textOf(m[1], 80) : '';
}

function listItemsOf(html) {
  const found = [];
  const re = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html))) {
    const text = textOf(m[2], 500);
    if (/qz-toolitiplists/i.test(m[1]) || /(课程编号|节次)\s*[：:]/.test(text)) found.push(text);
  }
  if (!found.length) {
    const text = textOf(html, 500);
    if (/课程编号\s*[：:]/.test(text)) found.push(text);
  }
  return found;
}

function fieldOf(text, label) {
  const re = new RegExp(label + '\\s*[：:]\\s*([\\s\\S]*?)(?=\\s*(?:课程编号|班级|地址|节次|课程名称)\\s*[：:]|$)');
  const m = re.exec(text);
  return m ? m[1].trim().slice(0, 120) : '';
}

// 整页 HTML → 条目；表头存在但全部条目失败才是 format 错误，0 条有课格是合法空结果。
export function parseLabTimetable(html, { periodTimes, totalWeeks } = {}) {
  const source = String(html == null ? '' : html);
  const rows = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(source))) rows.push(rowMatch[1]);

  let headerIndex = -1;
  let headerCells = null;
  for (let i = 0; i < rows.length; i++) {
    const cells = cellsOf(rows[i]);
    const texts = cells.map((cell) => cell.text);
    if (texts.some((text) => text.indexOf('周次') >= 0) && texts.some((text) => text.indexOf('节次') >= 0) && texts.some((text) => text.indexOf('星期') >= 0)) {
      headerIndex = i;
      headerCells = cells;
      break;
    }
  }
  if (headerIndex < 0) {
    if (/用户登录|统一身份认证|请输入验证码|login/i.test(source)) return failedResult('session');
    return failedResult('format');
  }

  if (headerCells.length < 9) return failedResult('format');
  const width = headerCells.length;
  let weekCol = -1;
  const dayCols = [];
  headerCells.forEach((cell, index) => {
    if (weekCol < 0 && cell.text.indexOf('周次') >= 0) weekCol = index;
    const m = /星期([一二三四五六日天])/.exec(cell.text);
    if (m) dayCols.push([index, WEEKDAY_TEXT[m[1]]]);
  });
  const weekdaySet = new Set(dayCols.map((pair) => pair[1]));
  if (weekCol < 0 || dayCols.length !== 7 || weekdaySet.size !== 7) return failedResult('format');
  for (let weekday = 1; weekday <= 7; weekday++) {
    if (!weekdaySet.has(weekday)) return failedResult('format');
  }

  const carries = new Array(width).fill(null);
  const records = [];
  const skipped = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = layoutRow(rows[i], width, carries);
    const weekMatch = /(\d{1,2})/.exec(row[weekCol] ? row[weekCol].text : '');
    const week = weekMatch ? Number(weekMatch[1]) : NaN;
    for (const pair of dayCols) {
      const cell = row[pair[0]];
      if (!cell) continue;
      if (!/qz-hasCourse/i.test(cell.class) && !/qz-hasCourse-title/i.test(cell.html)) continue;
      if (!Number.isInteger(week) || week < 1) { skipped.push({ reason: 'week' }); continue; }
      const title = titleOf(cell.html);
      const lists = listItemsOf(cell.html);
      if (!lists.length) {
        records.push({ week, name: title, courseCode: '', className: '', room: '', sectionCode: '' });
        continue;
      }
      for (const detail of lists) {
        records.push({
          week,
          name: title || fieldOf(detail, '课程名称'),
          courseCode: fieldOf(detail, '课程编号'),
          className: fieldOf(detail, '班级'),
          room: fieldOf(detail, '地址'),
          sectionCode: fieldOf(detail, '节次'),
        });
      }
    }
  }

  const normalized = normalizeLabList(records, { periodTimes, totalWeeks });
  const allSkipped = skipped.concat(normalized.skipped);
  const failed = normalized.items.length === 0 && allSkipped.length > 0;
  return { ok: !failed, items: normalized.items, skipped: allSkipped, weeks: normalized.weeks, error: failed ? 'format' : null };
}

// 按教学周 → 星期分组；只接受合法条目，组内按开始时间与 id 稳定排序。
export function groupByWeekDay(items) {
  const list = Array.isArray(items) ? items : items && Array.isArray(items.items) ? items.items : [];
  const byWeek = new Map();
  for (const item of list) {
    if (!item || !Number.isInteger(item.week) || !Number.isInteger(item.weekday)) continue;
    if (!byWeek.has(item.week)) byWeek.set(item.week, new Map());
    const byDay = byWeek.get(item.week);
    if (!byDay.has(item.weekday)) byDay.set(item.weekday, []);
    byDay.get(item.weekday).push(item);
  }
  for (const byDay of byWeek.values()) {
    for (const entries of byDay.values()) entries.sort((a, b) => cmp(a.startTime, b.startTime) || cmp(a.id, b.id));
  }
  return byWeek;
}

// snapshot.labs → 指定日期的课表条目（与 examDay 同形，由 core.effectiveDay 注入）。
export function labDay(snapshot, date) {
  const labs = snapshot && snapshot.labs;
  if (!labs || !Array.isArray(labs.items) || !validDate(date)) return [];
  if (labs.semesterId !== snapshot.semester?.id || labs.semesterStartDate !== snapshot.semester?.startDate) return [];
  const startDate = snapshot.semester.startDate;
  if (!validDate(startDate)) return [];
  const week = weekOf(startDate, date);
  if (!Number.isInteger(week) || week < 1) return [];
  const weekday = weekdayOf(date);
  return labs.items
    .filter((item) => item && item.week === week && item.weekday === weekday)
    .map((item) => ({
      lab: true,
      labId: item.id,
      ruleId: 'lab-' + item.id,
      key: date + '/lab-' + item.id,
      date,
      originDate: date,
      name: item.name,
      courseCode: item.courseCode || null,
      className: item.className || null,
      room: item.room,
      sectionCode: item.sectionCode,
      weekday: item.weekday,
      periods: Array.isArray(item.periods) ? item.periods.slice() : [],
      weeks: [item.week],
      startTime: item.startTime,
      endTime: item.endTime,
      source: 'school',
      sourceLabel: '实验课',
      cancelled: false,
    }))
    .sort((a, b) => cmp(a.startTime, b.startTime) || cmp(a.key, b.key));
}

// 失败时保留同学期旧数据并记录 lastAttempt/error/本轮 skipped；跨学期一律丢弃。
export function withLabFallback(previous, next, { now, error, skipped, semesterId, semesterStartDate } = {}) {
  const targetId = semesterId === undefined ? next?.semesterId : semesterId;
  const targetStart = semesterStartDate === undefined ? next?.semesterStartDate : semesterStartDate;
  const sameSemester = (value) => !!value
    && (targetId === undefined || value.semesterId === targetId)
    && (targetStart === undefined || value.semesterStartDate === targetStart);
  if (next && !next.error && Array.isArray(next.items)) return { ...next, lastAttempt: now ?? null, lastSkipped: null };
  if (sameSemester(previous)) {
    const lastSkipped = Array.isArray(skipped) ? skipped : Array.isArray(next?.skipped) ? next.skipped : [];
    return { ...previous, lastAttempt: now ?? null, error: error || next?.error || 'other', lastSkipped };
  }
  return null;
}

// 把 reader/Java 回传的 labs / labHtml / labError 挂到快照：
// - labs 数组或 labHtml：解析成功全量替换；失败保留同学期旧数据并写 error/lastAttempt/lastSkipped；
// - labError：失败类别，保留旧数据；
// - 两者都没有（旧原生版本不带该字段）：不动快照，交由 core.applySnapshot 保留旧 labs。
export function attachLabPayload(snapshot, payload, previousLabs, { periodTimes, now } = {}) {
  if (!snapshot) return snapshot;
  const at = now || new Date().toISOString();
  const semesterId = snapshot.semester?.id;
  const semesterStartDate = snapshot.semester?.startDate;
  const totalWeeks = snapshot.semester?.weeks;
  let fresh = null;
  let error = null;
  let skipped = null;
  if (Array.isArray(payload?.labs)) {
    const normalized = normalizeLabList(payload.labs, { periodTimes, totalWeeks });
    fresh = {
      semesterId,
      semesterStartDate,
      fetchedAt: payload.labFetchedAt || at,
      error: normalized.error,
      source: 'school',
      items: normalized.items,
      skipped: normalized.skipped,
    };
    if (normalized.error) { error = normalized.error; skipped = normalized.skipped; }
  } else if (typeof payload?.labHtml === 'string') {
    const parsed = parseLabTimetable(payload.labHtml, { periodTimes, totalWeeks });
    if (parsed.ok) {
      fresh = {
        semesterId,
        semesterStartDate,
        fetchedAt: payload.labFetchedAt || at,
        error: null,
        source: 'school',
        items: parsed.items,
        skipped: parsed.skipped,
      };
    } else {
      error = parsed.error || 'format';
      skipped = parsed.skipped;
    }
  } else if (payload?.labError !== undefined || payload?.labs !== undefined) {
    error = String(payload?.labError || 'other');
  }
  if (fresh && !fresh.error) return { ...snapshot, labs: { ...fresh, lastAttempt: at, lastSkipped: null } };
  if (error) {
    const kept = withLabFallback(previousLabs, null, { now: at, error, skipped, semesterId, semesterStartDate });
    if (kept) return { ...snapshot, labs: kept };
    return {
      ...snapshot,
      labs: {
        semesterId,
        semesterStartDate,
        fetchedAt: null,
        lastAttempt: at,
        error,
        source: 'school',
        items: [],
        skipped: [],
        lastSkipped: Array.isArray(skipped) ? skipped : [],
      },
    };
  }
  return snapshot;
}

// 设置页/读取完成提示用的摘要（只含计数、时间戳与错误类别，不含课程内容）。
export function labSummary(labs) {
  const items = Array.isArray(labs?.items) ? labs.items : [];
  const fetchedAt = typeof labs?.fetchedAt === 'string' && Number.isFinite(Date.parse(labs.fetchedAt)) ? labs.fetchedAt : null;
  const age = fetchedAt ? Date.now() - Date.parse(fetchedAt) : NaN;
  return { count: items.length, fetchedAt, stale: !Number.isFinite(age) || age > LAB_CACHE_TTL_MS, error: typeof labs?.error === 'string' ? labs.error : null };
}

// 实验课变更记录：新增/取消/改时间/改地点/实验调整；首次无基线不生成「新增」。
export function diffLabSnapshots(before, after, now = new Date().toISOString()) {
  if (!after || !Array.isArray(after.items) || !before || !Array.isArray(before.items)) return [];
  if (!before.items.length) return [];
  if (before.semesterId && after.semesterId && before.semesterId !== after.semesterId) return [];
  if (before.semesterStartDate && after.semesterStartDate && before.semesterStartDate !== after.semesterStartDate) return [];
  const startDate = after.semesterStartDate || before.semesterStartDate;
  const oldMap = new Map(before.items.map((item) => [item.id, item]));
  const newMap = new Map(after.items.map((item) => [item.id, item]));
  const result = [];
  for (const id of new Set([...oldMap.keys(), ...newMap.keys()])) {
    const a = oldMap.get(id);
    const b = newMap.get(id);
    const row = b || a;
    if (!row) continue;
    const date = labDate(startDate, row.week, row.weekday);
    if (!date) continue;
    const ended = Date.parse(date + 'T' + row.endTime + ':00+08:00');
    if (Number.isFinite(ended) && ended <= Date.parse(now)) continue;
    const fields = LAB_FIELDS.filter((field) => !equalValue(a?.[field], b?.[field]));
    if (!fields.length) continue;
    const key = date + '/lab-' + id;
    const type = !a ? '新增实验课' : !b ? '取消实验课' : fields.includes('startTime') || fields.includes('endTime') ? '改时间' : fields.includes('room') ? '改地点' : '实验调整';
    result.push({
      id: now + '/' + key,
      key,
      date,
      name: row.name || '实验课',
      before: a || null,
      after: b || null,
      fields,
      type,
      source: 'school',
      lab: true,
      read: false,
      notifiedAt: null,
      detectedAt: now,
    });
  }
  return result.sort((a, b) => cmp(a.date, b.date) || cmp(a.key, b.key));
}

function equalValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const LAB_ERROR_TEXT = {
  session: '登录已过期，请重新登录后同步',
  http: '教务系统暂时无法访问',
  timeout: '读取实验课表超时',
  format: '实验课表格式无法识别',
  other: '读取实验课表失败',
};

export function labErrorText(code) {
  return LAB_ERROR_TEXT[code] || LAB_ERROR_TEXT.other;
}
