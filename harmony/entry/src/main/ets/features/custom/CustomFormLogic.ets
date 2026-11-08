// 职责：自定义/调课/休假/单日修改表单的纯逻辑层：复用 CustomScheduleService 的校验与构建，校验通过才触发回写回调。
// 依赖方向：features/custom -> core/custom 纯逻辑 + core/types；不引用 ArkUI，可被 Node 直接执行测试。
// 阶段：P4；组件只调用本模块并暴露 onAdd*/onEdit*/onDelete* 回调，不直接写 AppState。
import type { AppState, CourseExceptionPatch, CourseRow, CustomCourse, DayOverride, HolidayDay, LocalMapRule, SemesterSnapshot } from '../../core/types/AppState';
import type { CustomCourseDraft, LocalMapDraft } from '../../core/custom/CustomScheduleService';
import { buildCustomCourse, buildDayOverride, buildLocalMap, isValidDateKey, parseTimeToMinutes, weekNumberOf } from '../../core/custom/CustomScheduleService';

function courseIds(state: AppState): string[] {
  const ids: string[] = [];
  for (const item of state.customCourses) {
    ids.push(item.id);
  }
  return ids;
}

function mapIds(state: AppState): string[] {
  const ids: string[] = [];
  for (const item of state.localMaps) {
    ids.push(item.id);
  }
  return ids;
}

// 自定义课程：校验与构建都交给 core，成功才回调；失败返回 core 的错误码（name-required/week-invalid/...）。
export function submitCourse(draft: CustomCourseDraft, state: AppState, nowMs: number, onBuilt: (course: CustomCourse) => void): string[] {
  const built = buildCustomCourse(draft, state.snapshot, courseIds(state), nowMs);
  if (!built.ok || built.course === null) {
    return built.errors;
  }
  onBuilt(built.course);
  return [];
}

// 调课：editingId 非空表示编辑，保留原 id；其余字段由校验构建结果决定（本机口径强制 replace）。
export function submitLocalMap(draft: LocalMapDraft, state: AppState, nowMs: number, editingId: string, onBuilt: (rule: LocalMapRule) => void): string[] {
  const built = buildLocalMap(draft, nowMs, mapIds(state));
  if (!built.ok || built.rule === null) {
    return built.errors;
  }
  const rule: LocalMapRule = {
    id: editingId.length > 0 ? editingId : built.rule.id,
    date: built.rule.date,
    fromDate: built.rule.fromDate,
    mode: built.rule.mode
  };
  onBuilt(rule);
  return [];
}

// 单日休假：日期合法 + 在学期内 + 未与已有休假冲突；编辑时调用方把自身日期从 existingDates 剔除。
export function validateHolidayDate(date: string, snapshot: SemesterSnapshot | null, existingDates: string[]): string[] {
  const errors: string[] = [];
  if (!isValidDateKey(date)) {
    errors.push('date-invalid');
    return errors;
  }
  if (snapshot !== null) {
    const week = weekNumberOf(snapshot, date);
    if (week < 1 || week > snapshot.weeks) {
      errors.push('date-out-of-semester');
    }
  }
  for (const item of existingDates) {
    if (item === date) {
      errors.push('holiday-duplicate');
      break;
    }
  }
  return errors;
}

export function submitHoliday(date: string, skipStudy: boolean, snapshot: SemesterSnapshot | null, existingDates: string[], onBuilt: (day: HolidayDay) => void): string[] {
  const errors = validateHolidayDate(date, snapshot, existingDates);
  if (errors.length > 0) {
    return errors;
  }
  const day: HolidayDay = { date: date, skipStudy: skipStudy };
  onBuilt(day);
  return [];
}

// 单日修改：取消只要 cancelled；改时间/地点时时间必须合法且结束晚于开始，之后交给 buildDayOverride 定稿。
export function submitOverride(date: string, base: CourseRow, patch: CourseExceptionPatch, nowMs: number, editingId: string, onBuilt: (override: DayOverride) => void): string[] {
  const errors: string[] = [];
  if (!isValidDateKey(date)) {
    errors.push('date-invalid');
  }
  const cancel = patch.cancelled === true;
  if (!cancel) {
    let start = -1;
    let end = -1;
    if (patch.startTime !== undefined) {
      start = parseTimeToMinutes(patch.startTime);
      if (start < 0) {
        errors.push('time-invalid');
      }
    }
    if (patch.endTime !== undefined) {
      end = parseTimeToMinutes(patch.endTime);
      if (end < 0) {
        errors.push('time-invalid');
      }
    }
    if (start >= 0 && end >= 0 && end <= start) {
      errors.push('time-order');
    }
  }
  if (errors.length > 0) {
    return errors;
  }
  const built = buildDayOverride(date, base, patch, nowMs);
  if (built === null) {
    return ['override-invalid'];
  }
  const override: DayOverride = {
    id: editingId.length > 0 ? editingId : built.id,
    key: built.key,
    date: built.date,
    base: built.base,
    patch: built.patch,
    createdAt: built.createdAt
  };
  onBuilt(override);
  return [];
}
