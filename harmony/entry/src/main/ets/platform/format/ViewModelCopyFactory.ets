// 职责：资源字符串 -> ViewModelCopy 的平台工厂，页面不出现中文。
// 依赖方向：platform -> core/viewmodel 类型 + ArkUI 资源系统。
// 阶段：P2；只做 $r 映射，不含业务逻辑。
// 待确认：getStringSync 在 API 12 的签名以官方文档为准。

import type { common } from '@kit.AbilityKit';
import type { ErrorCode } from '../../core/types/Common';
import type { ViewModelCopy, StatusCopy, TagCopy, SourceCopy, ChangeCopy, DetailCopy } from '../../core/viewmodel/ViewModelCopy';

export const FORMAT_UNAVAILABLE: ErrorCode = 'FORMAT_UNAVAILABLE' as ErrorCode;

export function webTitle(titleKey: string): Resource {
  if (titleKey === 'portal') { return $r('app.string.web_portal_title'); }
  if (titleKey === 'mobile') { return $r('app.string.web_mobile_title'); }
  if (titleKey === 'cancel') { return $r('app.string.web_office_title_cancel'); }
  if (titleKey === 'renew') { return $r('app.string.web_office_title_renew'); }
  return $r('app.string.web_office_title_leave');
}

function text(context: common.UIAbilityContext, resource: Resource): string {
  return context.resourceManager.getStringSync(resource.id);
}

export function createViewModelCopy(context: object): ViewModelCopy {
  const ability: common.UIAbilityContext = context as common.UIAbilityContext;
  const status: StatusCopy = {
    normal: text(ability, $r('app.string.status_normal')),
    leaveApproved: text(ability, $r('app.string.status_leave_approved')),
    leavePending: text(ability, $r('app.string.status_leave_pending')),
    moved: text(ability, $r('app.string.status_moved')),
    vacant: text(ability, $r('app.string.status_vacant')),
    study: text(ability, $r('app.string.status_study')),
    cancelled: text(ability, $r('app.string.status_cancelled'))
  };
  const tags: TagCopy = {
    custom: text(ability, $r('app.string.tag_custom')),
    makeup: text(ability, $r('app.string.tag_makeup')),
    modified: text(ability, $r('app.string.tag_modified')),
    conflict: text(ability, $r('app.string.tag_conflict')),
    overlap: text(ability, $r('app.string.tag_overlap'))
  };
  const sources: SourceCopy = {
    school: text(ability, $r('app.string.source_school')),
    custom: text(ability, $r('app.string.source_custom')),
    study: text(ability, $r('app.string.source_study')),
    local: text(ability, $r('app.string.source_local'))
  };
  const changes: ChangeCopy = {
    today: text(ability, $r('app.string.change_today')),
    earlier: text(ability, $r('app.string.change_earlier')),
    emptyTitle: text(ability, $r('app.string.change_empty_title')),
    emptyHint: text(ability, $r('app.string.change_empty_hint')),
    allRead: text(ability, $r('app.string.change_all_read')),
    openDay: text(ability, $r('app.string.change_open_day')),
    markRead: text(ability, $r('app.string.change_mark_read')),
    typeAdd: text(ability, $r('app.string.change_type_add')),
    typeRemove: text(ability, $r('app.string.change_type_remove')),
    typeUpdate: text(ability, $r('app.string.change_type_update')),
    typeTime: text(ability, $r('app.string.change_type_time')),
    typeRoom: text(ability, $r('app.string.change_type_room')),
    typeTeacher: text(ability, $r('app.string.change_type_teacher')),
    unread: text(ability, $r('app.string.change_unread'))
  };
  const detail: DetailCopy = {
    title: text(ability, $r('app.string.detail_title')),
    time: text(ability, $r('app.string.detail_time')),
    room: text(ability, $r('app.string.detail_room')),
    teacher: text(ability, $r('app.string.detail_teacher')),
    source: text(ability, $r('app.string.detail_source')),
    status: text(ability, $r('app.string.detail_status')),
    moved: text(ability, $r('app.string.detail_moved')),
    leave: text(ability, $r('app.string.detail_leave')),
    close: text(ability, $r('app.string.detail_close'))
  };
  return {
    weekdays: [
      text(ability, $r('app.string.weekday_mon')), text(ability, $r('app.string.weekday_tue')),
      text(ability, $r('app.string.weekday_wed')), text(ability, $r('app.string.weekday_thu')),
      text(ability, $r('app.string.weekday_fri')), text(ability, $r('app.string.weekday_sat')),
      text(ability, $r('app.string.weekday_sun'))
    ],
    titleToday: text(ability, $r('app.string.day_title_today')),
    titleTomorrow: text(ability, $r('app.string.day_title_tomorrow')),
    titleYesterday: text(ability, $r('app.string.day_title_yesterday')),
    titleSelected: text(ability, $r('app.string.day_title_selected')),
    weekLabel: text(ability, $r('app.string.week_label')),
    periodLabel: text(ability, $r('app.string.period_label')),
    movedTo: text(ability, $r('app.string.moved_to')),
    dayEmptyTitle: text(ability, $r('app.string.day_empty_title')),
    dayEmptyHint: text(ability, $r('app.string.day_empty_hint')),
    sampleLabel: text(ability, $r('app.string.sample_badge')),
    status: status,
    tags: tags,
    sources: sources,
    changes: changes,
    detail: detail,
    a11yCourse: text(ability, $r('app.string.a11y_course')),
    a11yMoved: text(ability, $r('app.string.a11y_moved')),
    a11yChange: text(ability, $r('app.string.a11y_change'))
  };
}




