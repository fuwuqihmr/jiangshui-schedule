/*
 * School lexicon contract for the jsxsd / office parsers.
 *
 * Core parsers hold no human-readable text. Every label, status token and
 * separator is injected by platform/school/ParserLexiconFactory.ets, which
 * reads them from resources. Keep this file pure ASCII.
 */

export interface SchoolLexicon {
  /** "week" prefix and suffix, e.g. di + zhou. */
  weekPrefix: string;
  weekSuffix: string;
  /** "all weeks" marker, usually wrapped in parentheses. */
  weekAll: string;
  /** odd-week marker. */
  weekOdd: string;
  /** even-week marker. */
  weekEven: string;
  /** Seven day names, Monday first. */
  dayChars: string[];
  /** "period" prefix and suffix, e.g. di + jie. */
  periodPrefix: string;
  periodSuffix: string;
  /** Tokens meaning "time not arranged". */
  unscheduledValues: string[];
  /** Labels that may be followed by enrollment year / grade text. */
  profileLabels: string[];
  leaveType: string;
  leaveReason: string;
  leaveStart: string;
  leaveEnd: string;
  leaveSubmitted: string;
  leaveNumber: string;
  leaveDuration: string;
  statusRejected: string[];
  statusPending: string[];
  statusApproved: string[];
  /** Extra week-range separators to fold into '-'. */
  rangeSeparators: string[];
  unscheduledNoteNoTime: string;
  unscheduledNoteWeeksOnly: string;
  leaveTypeCancel: string;
  leaveTypeRenew: string;
  profileYearSuffix: string;
  profileGradePrefix: string;
}

export type JsxsdLexicon = SchoolLexicon;

export type OfficeLexicon = SchoolLexicon;
