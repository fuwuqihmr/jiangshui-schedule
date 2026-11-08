/*
 * Office (OA) leave parser.
 *
 * Pure logic: leave field labels, status words and leave-type words are all
 * injected through SchoolLexicon. This file must stay ASCII-only and must
 * only use `import type`.
 *
 * Unlike JsxsdParser this parser never throws for payload problems: it returns
 * a flat result with `error` set to OFFICE_UNAVAILABLE / OFFICE_SESSION_REQUIRED
 * so the caller can degrade gracefully.
 */
import type { LeaveRecord, LeaveStatus, LeaveType } from '../types/Leave';
import type { SchoolLexicon } from './SchoolLexicon';

const MAX_INPUT: number = 2 * 1024 * 1024;
const MAX_RECORDS: number = 200;

const CODE_UNAVAILABLE: string = 'OFFICE_UNAVAILABLE';
const CODE_SESSION_REQUIRED: string = 'OFFICE_SESSION_REQUIRED';

export interface OfficeParseResult {
  error: string | null;
  records: LeaveRecord[];
  skipped: number;
}

export type OfficeLeaveParseResult = OfficeParseResult;

export interface OfficeParseOptions {
  semesterId?: string;
}

interface OfficeFieldValue {
  val?: string;
  text?: string;
}

interface OfficeField {
  label?: string;
  name?: string;
  values?: OfficeFieldValue[];
}

interface OfficeBlock {
  fields?: OfficeField[];
}

interface OfficeFormData {
  blocks?: OfficeBlock[];
}

interface OfficeApprover {
  name?: string;
  userName?: string;
}

interface OfficeForm {
  id?: string;
  autoId?: string;
  aprvStatusType?: string;
  aprvStatusTypeId?: string;
  inserttime?: number | string;
  startAt?: string;
  endAt?: string;
  semesterId?: string;
  allAprvUserList?: OfficeApprover[] | string;
  formData?: OfficeFormData | string;
}

interface OfficeData {
  formsUserList?: OfficeForm[];
}

interface OfficePayload {
  data?: OfficeData | OfficeForm[];
  formsUserList?: OfficeForm[];
}

interface Moment {
  /** ISO date, yyyy-mm-dd. */
  date: string;
  /** HH:mm, or empty for a date-only value. */
  time: string;
}

function result(error: string | null, records: LeaveRecord[], skipped: number): OfficeParseResult {
  return { error: error, records: records, skipped: skipped };
}

function textOf(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return value.trim();
}

function fieldText(form: OfficeForm, label: string): string {
  const data: OfficeFormData | string | undefined = form.formData;
  if (typeof data === 'string' || data === undefined || data === null) {
    return '';
  }
  const blocks: OfficeBlock[] | undefined = data.blocks;
  if (!Array.isArray(blocks)) {
    return '';
  }
  for (const block of blocks) {
    const fields: OfficeField[] | undefined = block.fields;
    if (!Array.isArray(fields)) {
      continue;
    }
    for (const field of fields) {
      const fieldLabel: string = textOf(field.label !== undefined ? field.label : field.name);
      if (fieldLabel !== label) {
        continue;
      }
      const values: OfficeFieldValue[] | undefined = field.values;
      if (!Array.isArray(values)) {
        return '';
      }
      for (const value of values) {
        const candidate: string = textOf(value.val !== undefined ? value.val : value.text);
        if (candidate.length > 0) {
          return candidate;
        }
      }
      return '';
    }
  }
  return '';
}

function parseMoment(value: string): Moment | null {
  const pattern: RegExp = new RegExp('^(\\d{4})-(\\d{2})-(\\d{2})(?:[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?$');
  const match: RegExpMatchArray | null = value.trim().match(pattern);
  if (match === null) {
    return null;
  }
  const year: number = parseInt(match[1], 10);
  const month: number = parseInt(match[2], 10);
  const day: number = parseInt(match[3], 10);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  let time: string = '';
  if (match[4] !== undefined) {
    const hour: number = parseInt(match[4], 10);
    const minute: number = parseInt(match[5], 10);
    if (hour > 23 || minute > 59) {
      return null;
    }
    const hourText: string = hour < 10 ? '0' + hour : '' + hour;
    const minuteText: string = minute < 10 ? '0' + minute : '' + minute;
    time = hourText + ':' + minuteText;
  }
  return { date: match[1] + '-' + match[2] + '-' + match[3], time: time };
}

function startMoment(value: string): Moment | null {
  const moment: Moment | null = parseMoment(value);
  if (moment === null) {
    return null;
  }
  if (moment.time.length === 0) {
    moment.time = '00:00';
  }
  return moment;
}

function endMoment(value: string): Moment | null {
  const moment: Moment | null = parseMoment(value);
  if (moment === null) {
    return null;
  }
  if (moment.time.length === 0) {
    moment.time = '23:59';
  }
  return moment;
}

function statusOf(rawStatus: string, typeId: string, lexicon: SchoolLexicon): LeaveStatus {
  const value: string = rawStatus.trim();
  for (const token of lexicon.statusRejected) {
    if (token.length > 0 && value.indexOf(token) >= 0) {
      return 'rejected';
    }
  }
  for (const token of lexicon.statusPending) {
    if (token.length > 0 && value.indexOf(token) >= 0) {
      return 'pending';
    }
  }
  for (const token of lexicon.statusApproved) {
    if (token.length > 0 && value.indexOf(token) >= 0) {
      return 'approved';
    }
  }
  // spec:312 / 文本非空一律以文本为准，未识别文本（如“未审核”）→ unknown，绝不回落 id；
  // 只有文本为空且 aprvStatusTypeId === '2' 时才回退 approved（既有的唯一 id 回退）。
  if (value.length === 0 && typeId.trim() === '2') {
    return 'approved';
  }
  return 'unknown';
}

function typeOf(value: string, lexicon: SchoolLexicon): LeaveType {
  if (lexicon.leaveTypeCancel.length > 0 && value.indexOf(lexicon.leaveTypeCancel) >= 0) {
    return 'cancel';
  }
  if (lexicon.leaveTypeRenew.length > 0 && value.indexOf(lexicon.leaveTypeRenew) >= 0) {
    return 'renew';
  }
  return 'leave';
}

function approverOf(form: OfficeForm): string {
  const list: OfficeApprover[] | string | undefined = form.allAprvUserList;
  if (typeof list === 'string') {
    return list.trim();
  }
  if (!Array.isArray(list)) {
    return '';
  }
  const names: string[] = [];
  for (const item of list) {
    const name: string = textOf(item.name !== undefined ? item.name : item.userName);
    if (name.length > 0) {
      names.push(name);
    }
  }
  return names.join(',');
}

function submittedAtOf(form: OfficeForm, lexicon: SchoolLexicon): string | undefined {
  const field: string = fieldText(form, lexicon.leaveSubmitted);
  if (field.length > 0) {
    const moment: Moment | null = parseMoment(field);
    if (moment !== null) {
      if (moment.time.length > 0) {
        return moment.date + 'T' + moment.time + ':00Z';
      }
      return moment.date + 'T00:00:00';
    }
  }
  const inserttime: number | string | undefined = form.inserttime;
  if (typeof inserttime === 'number' && inserttime > 0) {
    return new Date(inserttime).toISOString();
  }
  if (typeof inserttime === 'string') {
    const numeric: number = parseInt(inserttime, 10);
    if (!isNaN(numeric) && numeric > 0) {
      return new Date(numeric).toISOString();
    }
  }
  return undefined;
}

/**
 * Resolve a stable record id. Real OA payloads use either `id` or `autoId`
 * (form level, or as a field inside formData). A record without any id is
 * skipped by the caller (spec: missing id counts as skipped); no id is synthesized.
 */
function idOf(form: OfficeForm): string {
  const direct: string = textOf(form.id);
  if (direct.length > 0) {
    return direct;
  }
  const auto: string = textOf(form.autoId);
  if (auto.length > 0) {
    return auto;
  }
  const nested: string = fieldText(form, 'autoId');
  if (nested.length > 0) {
    return nested;
  }
  return '';
}

function recordOf(form: OfficeForm, lexicon: SchoolLexicon): LeaveRecord | null {
  const id: string = idOf(form);
  if (id.length === 0) {
    return null;
  }
  const rawStart: string = fieldText(form, lexicon.leaveStart).length > 0
    ? fieldText(form, lexicon.leaveStart)
    : textOf(form.startAt);
  const rawEnd: string = fieldText(form, lexicon.leaveEnd).length > 0
    ? fieldText(form, lexicon.leaveEnd)
    : textOf(form.endAt);
  const start: Moment | null = startMoment(rawStart);
  const end: Moment | null = endMoment(rawEnd);
  if (start === null || end === null) {
    return null;
  }
  if (start.date + 'T' + start.time >= end.date + 'T' + end.time) {
    return null;
  }
  let typeText: string = fieldText(form, lexicon.leaveType);
  let reason: string = fieldText(form, lexicon.leaveReason);
  const formData: OfficeFormData | string | undefined = form.formData;
  if (typeof formData === 'string') {
    if (typeText.length === 0) {
      typeText = formData;
    }
    if (reason.length === 0) {
      reason = formData;
    }
  }
  const rawStatus: string = textOf(form.aprvStatusType);
  const typeId: string = textOf(form.aprvStatusTypeId);
  const record: LeaveRecord = {
    id: id,
    type: typeOf(typeText, lexicon),
    status: statusOf(rawStatus, typeId, lexicon),
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    reason: reason,
    approver: approverOf(form),
    comment: '',
    rawStatus: rawStatus,
    semesterId: '',
    demo: false
  };
  const submittedAt: string | undefined = submittedAtOf(form, lexicon);
  if (submittedAt !== undefined) {
    record.submittedAt = submittedAt;
  }
  return record;
}

function sourceSemester(form: OfficeForm): string {
  return textOf(form.semesterId);
}

/**
 * Parse the OA leave JSON body. Never throws for malformed payloads; returns
 * `error` instead so the caller can show a degraded state.
 */
export function parseOfficeLeave(
  json: string,
  lexicon: SchoolLexicon,
  options?: OfficeParseOptions
): OfficeParseResult {
  if (json.length === 0) {
    return result(CODE_UNAVAILABLE, [], 0);
  }
  if (json.length > MAX_INPUT) {
    return result(CODE_UNAVAILABLE, [], 0);
  }
  const head: string = json.trim();
  if (head.length === 0) {
    return result(CODE_UNAVAILABLE, [], 0);
  }
  if (head.charAt(0) === '<') {
    return result(CODE_SESSION_REQUIRED, [], 0);
  }

  let payload: OfficePayload | null = null;
  try {
    payload = JSON.parse(json) as OfficePayload;
  } catch (error) {
    payload = null;
  }
  if (payload === null) {
    return result(CODE_UNAVAILABLE, [], 0);
  }
  const parsed: OfficePayload = payload as OfficePayload;
  const data: OfficeData | OfficeForm[] | undefined = parsed.data;
  let forms: OfficeForm[] | undefined = parsed.formsUserList;
  if (forms === undefined && data !== undefined && data !== null && !Array.isArray(data)) {
    forms = data.formsUserList;
  }
  if (!Array.isArray(forms)) {
    return result(CODE_UNAVAILABLE, [], 0);
  }

  const semesterId: string = options !== undefined && options.semesterId !== undefined ? options.semesterId : '';
  const records: LeaveRecord[] = [];
  const seenIds: string[] = [];
  let skipped: number = 0;

  for (let formIndex: number = 0; formIndex < forms.length; formIndex++) {
    if (records.length >= MAX_RECORDS) {
      break;
    }
    const form: OfficeForm = forms[formIndex];
    if (semesterId.length > 0) {
      const source: string = sourceSemester(form);
      if (source.length > 0 && source !== semesterId) {
        skipped++;
        continue;
      }
    }
    const record: LeaveRecord | null = recordOf(form, lexicon);
    if (record === null) {
      skipped++;
      continue;
    }
    if (seenIds.indexOf(record.id) >= 0) {
      // The same leave may appear more than once when pages are merged; keep one.
      continue;
    }
    seenIds.push(record.id);
    record.semesterId = semesterId;
    records.push(record);
  }

  return result(null, records, skipped);
}
