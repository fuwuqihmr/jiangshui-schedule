// 职责：表单错误码 -> 资源键的显式映射（避免动态 $r 绕过资源门禁）。
// 依赖方向：features/custom -> ArkUI 资源；纯展示函数，不读写状态。
export function customFormErrorText(code: string): Resource {
  if (code === 'name-required') { return $r('app.string.custom_error_name_required'); }
  if (code === 'time-invalid') { return $r('app.string.custom_error_time_invalid'); }
  if (code === 'time-order') { return $r('app.string.custom_error_time_order'); }
  if (code === 'day-invalid') { return $r('app.string.custom_error_day_invalid'); }
  if (code === 'week-invalid') { return $r('app.string.custom_error_week_invalid'); }
  if (code === 'week-out-of-range') { return $r('app.string.custom_error_week_out_of_range'); }
  if (code === 'week-pattern-invalid') { return $r('app.string.custom_error_week_pattern_invalid'); }
  if (code === 'date-invalid') { return $r('app.string.custom_error_date_invalid'); }
  if (code === 'date-out-of-semester') { return $r('app.string.custom_error_date_out_of_semester'); }
  if (code === 'semester-missing') { return $r('app.string.custom_error_semester_missing'); }
  if (code === 'course-missing') { return $r('app.string.custom_error_course_missing'); }
  if (code === 'from-date-invalid') { return $r('app.string.custom_error_from_date_invalid'); }
  if (code === 'same-date') { return $r('app.string.custom_error_same_date'); }
  if (code === 'holiday-duplicate') { return $r('app.string.custom_error_holiday_duplicate'); }
  if (code === 'override-invalid') { return $r('app.string.custom_error_override_invalid'); }
  if (code === 'override-base-required') { return $r('app.string.custom_error_override_base_required'); }
  return $r('app.string.custom_error_mode_invalid');
}
