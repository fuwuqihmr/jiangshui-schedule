// 职责：单条假条记录卡：状态徽标、类型、时间范围、事由/审批人摘要、展开收起、打开详情。
// 依赖：core/types/Leave 与 core/viewmodel/LeaveStatusViewModel 的行视图；纯展示，无业务逻辑。
// 阶段：P3；所有文案走 $r 资源键，颜色走 color.json；不直接使用 Kit。
import type { LeaveRecord } from '../core/types/Leave';
import type { LeaveStatusRowView } from '../core/viewmodel/LeaveStatusViewModel';

@Component
export struct LeaveRecordCard {
  @Prop row: LeaveStatusRowView;
  @Prop record: LeaveRecord;
  @Prop expanded: boolean = false;
  onToggle: () => void = () => {};
  onOpenDetail: () => void = () => {};

  private statusText(): Resource {
    switch (this.row.displayStatus) {
      case 'approved':
        return $r('app.string.leave_status_approved');
      case 'pending':
        return $r('app.string.leave_status_pending');
      case 'rejected':
        return $r('app.string.leave_status_rejected');
      case 'expired':
        return $r('app.string.leave_status_expired');
      default:
        return $r('app.string.leave_status_unknown');
    }
  }

  private typeText(): Resource {
    if (this.record.type === 'cancel') {
      return $r('app.string.leave_action_cancel');
    }
    if (this.record.type === 'renew') {
      return $r('app.string.leave_action_renew');
    }
    return $r('app.string.leave_action_leave');
  }

  private periodText(): string {
    if (this.row.periodText.length > 0) {
      return this.row.periodText;
    }
    if (this.record.startDate.length === 0) {
      return '';
    }
    return this.record.startDate + ' ' + this.record.startTime + ' - ' + this.record.endDate + ' ' + this.record.endTime;
  }

  build() {
    Column({ space: 6 }) {
      Row({ space: 6 }) {
        Text(this.statusText())
          .fontSize($r('app.float.float_font_11'))
          .fontColor(this.statusColor())
          .backgroundColor(this.statusBgColor())
          .border({ width: $r('app.float.float_stroke'), color: this.statusBorderColor() })
          .borderRadius($r('app.float.float_radius_pill'))
          .padding({ left: 8, right: 8, top: 2, bottom: 2 })
          .maxLines(1)
        Text(this.typeText())
          .fontSize($r('app.float.float_font_13'))
          .fontColor($r('app.color.color_text_primary'))
          .fontWeight(FontWeight.Medium)
          .layoutWeight(1)
          .maxLines(1)
        if (this.record.demo) {
          Text($r('app.string.sample_badge'))
            .fontSize($r('app.float.float_font_11'))
            .fontColor($r('app.color.color_pending_amber'))
            .backgroundColor($r('app.color.color_pending_amber_bg'))
            .borderRadius($r('app.float.float_radius_pill'))
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .maxLines(1)
        }
      }
      .width('100%')

      if (this.periodText().length > 0) {
        Text(this.periodText())
          .fontSize($r('app.float.float_font_13'))
          .fontColor($r('app.color.color_text_secondary'))
          .width('100%')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }

      if (this.record.reason.length > 0) {
        Text($r('app.string.leave_record_reason_summary', this.record.reason))
          .fontSize($r('app.float.float_font_11'))
          .fontColor($r('app.color.color_text_secondary'))
          .width('100%')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      if (this.record.approver.length > 0) {
        Text($r('app.string.leave_record_approver_summary', this.record.approver))
          .fontSize($r('app.float.float_font_11'))
          .fontColor($r('app.color.color_text_secondary'))
          .width('100%')
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }

      if (this.expanded) {
        Column({ space: 4 }) {
          Text($r('app.string.leave_detail_reason_label'))
            .fontSize($r('app.float.float_font_11'))
            .fontColor($r('app.color.color_text_secondary'))
          Text(this.record.reason.length > 0 ? this.record.reason : this.missingText())
            .fontSize($r('app.float.float_font_13'))
            .fontColor($r('app.color.color_text_primary'))
            .width('100%')
          if (this.record.comment.length > 0) {
            Text($r('app.string.leave_detail_comment_label'))
              .fontSize($r('app.float.float_font_11'))
              .fontColor($r('app.color.color_text_secondary'))
            Text(this.record.comment)
              .fontSize($r('app.float.float_font_13'))
              .fontColor($r('app.color.color_text_primary'))
              .width('100%')
          }
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
        .padding({ top: 4 })
      }

      Row({ space: 8 }) {
        Button(this.expanded ? $r('app.string.settings_collapse') : $r('app.string.settings_expand'))
          .height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_13'))
          .fontColor($r('app.color.color_link'))
          .backgroundColor($r('app.color.color_surface_soft'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => {
            this.onToggle();
          })
        Button($r('app.string.leave_detail_open'))
          .height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_13'))
          .fontColor($r('app.color.color_link'))
          .backgroundColor($r('app.color.color_surface_soft'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => {
            this.onOpenDetail();
          })
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
    .borderRadius($r('app.float.float_radius_card'))
    .shadow({ radius: 8, color: $r('app.color.color_shadow'), offsetX: 0, offsetY: 3 })
    .alignItems(HorizontalAlign.Start)
  }

  private missingText(): Resource {
    return $r('app.string.leave_detail_not_provided');
  }

  private statusColor(): Resource {
    switch (this.row.displayStatus) {
      case 'approved':
        return $r('app.color.color_success');
      case 'pending':
        return $r('app.color.color_pending_amber');
      case 'rejected':
        return $r('app.color.color_danger');
      case 'expired':
        return $r('app.color.color_leave_muted_text');
      default:
        return $r('app.color.color_neutral');
    }
  }

  private statusBgColor(): Resource {
    switch (this.row.displayStatus) {
      case 'approved':
        return $r('app.color.color_success_soft');
      case 'pending':
        return $r('app.color.color_pending_amber_bg');
      case 'rejected':
        return $r('app.color.color_danger_soft');
      case 'expired':
        return $r('app.color.color_leave_muted_bg');
      default:
        return $r('app.color.color_neutral_soft');
    }
  }

  private statusBorderColor(): Resource {
    switch (this.row.displayStatus) {
      case 'approved':
        return $r('app.color.color_success');
      case 'pending':
        return $r('app.color.color_pending_border');
      case 'rejected':
        return $r('app.color.color_danger_line');
      case 'expired':
        return $r('app.color.color_leave_muted_line');
      default:
        return $r('app.color.color_leave_muted_line');
    }
  }
}
