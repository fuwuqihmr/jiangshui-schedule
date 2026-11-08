// Purpose: platform-side lexicon adapter for the pure core parsers.
// Dependency: core/parser/SchoolLexicon only; all human-readable text comes
// from string resources (school_lex_*), never from string literals in core.
// Phase: P4-a.
import { ErrorCode } from '../../core/types/Common';
import type { JsxsdLexicon, OfficeLexicon, SchoolLexicon } from '../../core/parser/SchoolLexicon';

interface LexiconResourceManager {
  getStringByNameSync(name: string): string;
}

interface LexiconContext {
  resourceManager: LexiconResourceManager;
}

function readText(context: object, name: string): string {
  const typed: LexiconContext = context as LexiconContext;
  return typed.resourceManager.getStringByNameSync(name);
}

// Platform degradation code: a missing string resource falls back to an
// explicit FORMAT_UNAVAILABLE error instead of throwing into pure core.
export function lexiconUnavailableCode(): string {
  return ErrorCode.FORMAT_UNAVAILABLE;
}

function splitTokens(value: string): string[] {
  const tokens: string[] = [];
  for (const part of value.split('|')) {
    const token: string = part.trim();
    if (token.length > 0) {
      tokens.push(token);
    }
  }
  return tokens;
}

function buildLexicon(context: object): SchoolLexicon {
  const dayChars: string[] = [
    readText(context, 'school_lex_day_1'),
    readText(context, 'school_lex_day_2'),
    readText(context, 'school_lex_day_3'),
    readText(context, 'school_lex_day_4'),
    readText(context, 'school_lex_day_5'),
    readText(context, 'school_lex_day_6'),
    readText(context, 'school_lex_day_7')
  ];
  const unscheduledValues: string[] = [];
  for (const token of splitTokens(readText(context, 'school_lex_unscheduled_1'))) {
    unscheduledValues.push(token);
  }
  for (const token of splitTokens(readText(context, 'school_lex_unscheduled_2'))) {
    unscheduledValues.push(token);
  }
  for (const token of splitTokens(readText(context, 'school_lex_unscheduled_3'))) {
    unscheduledValues.push(token);
  }
  unscheduledValues.push('');
  const profileLabels: string[] = [
    readText(context, 'school_lex_profile_1'),
    readText(context, 'school_lex_profile_2'),
    readText(context, 'school_lex_profile_3'),
    readText(context, 'school_lex_profile_4'),
    readText(context, 'school_lex_profile_5'),
    readText(context, 'school_lex_profile_6')
  ];
  const statusRejected: string[] = [];
  for (const token of splitTokens(readText(context, 'school_lex_status_rejected_1'))) {
    statusRejected.push(token);
  }
  for (const token of splitTokens(readText(context, 'school_lex_status_rejected_2'))) {
    statusRejected.push(token);
  }
  const statusPending: string[] = [];
  for (const token of splitTokens(readText(context, 'school_lex_status_pending_1'))) {
    statusPending.push(token);
  }
  for (const token of splitTokens(readText(context, 'school_lex_status_pending_2'))) {
    statusPending.push(token);
  }
  const statusApproved: string[] = [];
  for (const token of splitTokens(readText(context, 'school_lex_status_approved_1'))) {
    statusApproved.push(token);
  }
  for (const token of splitTokens(readText(context, 'school_lex_status_approved_2'))) {
    statusApproved.push(token);
  }
  const rangeSeparators: string[] = [
    '-',
    '－',
    '–',
    '—',
    '~',
    '～',
    readText(context, 'school_lex_range_separator')
  ];
  return {
    weekPrefix: readText(context, 'school_lex_week_prefix'),
    weekSuffix: readText(context, 'school_lex_week_suffix'),
    weekAll: readText(context, 'school_lex_week_all'),
    weekOdd: readText(context, 'school_lex_week_odd'),
    weekEven: readText(context, 'school_lex_week_even'),
    dayChars: dayChars,
    periodPrefix: readText(context, 'school_lex_period_prefix'),
    periodSuffix: readText(context, 'school_lex_period_suffix'),
    unscheduledValues: unscheduledValues,
    profileLabels: profileLabels,
    leaveType: readText(context, 'school_lex_leave_type'),
    leaveReason: readText(context, 'school_lex_leave_reason'),
    leaveStart: readText(context, 'school_lex_leave_start'),
    leaveEnd: readText(context, 'school_lex_leave_end'),
    leaveSubmitted: readText(context, 'school_lex_leave_submitted'),
    leaveNumber: readText(context, 'school_lex_leave_number'),
    leaveDuration: readText(context, 'school_lex_leave_duration'),
    statusRejected: statusRejected,
    statusPending: statusPending,
    statusApproved: statusApproved,
    rangeSeparators: rangeSeparators,
    unscheduledNoteNoTime: readText(context, 'school_lex_unscheduled_note_no_time'),
    unscheduledNoteWeeksOnly: readText(context, 'school_lex_unscheduled_note'),
    leaveTypeCancel: readText(context, 'school_lex_leave_type_cancel'),
    leaveTypeRenew: readText(context, 'school_lex_leave_type_renew'),
    profileYearSuffix: readText(context, 'school_lex_profile_year_suffix'),
    profileGradePrefix: readText(context, 'school_lex_profile_grade_prefix')
  };
}

export function createJsxsdLexicon(context: object): JsxsdLexicon {
  return buildLexicon(context);
}

export function createOfficeLexicon(context: object): OfficeLexicon {
  return buildLexicon(context);
}

export function createSchoolLexicon(context: object): SchoolLexicon {
  return buildLexicon(context);
}

export function rowsFilterLabel(context: object): string {
  return readText(context, 'school_lex_rows_filter');
}

export function schoolSourceLabel(context: object): string {
  return readText(context, 'school_lex_source_label');
}
