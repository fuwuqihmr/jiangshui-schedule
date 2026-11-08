// 职责：假条详情面板（页内条件渲染，非 bindSheet）：状态、起止、原因、提交时间、审批人、审批意见、来源。
// 依赖：core/types/Leave；纯展示，不访问网络/Kit。
// 阶段：P3；待确认：LeaveRecord 当前无 submittedAt/source 字段，提交时间显示「未提供」、来源显示学校教务；
//         若后续类型扩展需由类型负责人补充，本组件不自行改类型。
import type { LeaveRecord } from '../core/types/Leave';
import type { LeaveDisplayStatus } from '../core/viewmodel/LeaveStatusViewModel';

@Component
export struct LeaveRecordDetailSheet {
  @Prop record: LeaveRecord;
  // 展示状态由调用方用 leaveDisplayStatus 计算（含「已过期」），组件不自行推导时间。
  @Prop displayStatus: LeaveDisplayStatus = 'unknown';
  onClose: () => void = () => {};

  private statusText(): Resource {
    switch (this.displayStatus) {
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
    if (this.record.startDate.length === 0) {
      return '';
    }
    return this.record.startDate + ' ' + this.record.startTime + ' - ' + this.record.endDate + ' ' + this.record.endTime;
  }

  build() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        Text($r('app.string.leave_detail_title'))
          .fontSize($r('app.float.float_font_16'))
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
        }
        Button($r('app.string.detail_close'))
          .height($r('app.float.float_touch_min'))
          .fontSize($r('app.float.float_font_11'))
          .fontColor($r('app.color.color_link'))
          .backgroundColor($r('app.color.color_surface'))
          .borderRadius($r('app.float.float_radius_control'))
          .onClick(() => {
            this.onClose();
          })
      }
      .width('100%')

      Row({ space: 6 }) {
        Text(this.statusText())
          .fontSize($r('app.float.float_font_11'))
          .fontColor(this.statusColor())
          .backgroundColor(this.statusBgColor())
          .border({ width: $r('app.float.float_stroke'), color: this.statusBorderColor() })
          .borderRadius($r('app.float.float_radius_pill'))
          .padding({ left: 8, right: 8, top: 2, bottom: 2 })
        Text(this.typeText())
          .fontSize($r('app.float.float_font_13'))
          .fontColor($r('app.color.color_text_primary'))
          .maxLines(1)
      }
      .width('100%')

      Scroll() {
        Column({ space: 8 }) {
          this.field($r('app.string.leave_detail_period_label'), this.periodText())
          this.field($r('app.string.leave_detail_reason_label'), this.record.reason)
          this.field($r('app.string.leave_detail_submitted_label'), '')
          this.field($r('app.string.leave_detail_approver_label'), this.record.approver)
          this.field($r('app.string.leave_detail_comment_label'), this.record.comment)
          Row({ space: 8 }) {
            Text($r('app.string.detail_source'))
              .fontSize($r('app.float.float_font_11'))
              .fontColor($r('app.color.color_text_secondary'))
              .width(72)
              .maxLines(1)
            Text($r('app.string.source_school'))
              .fontSize($r('app.float.float_font_13'))
              .fontColor($r('app.color.color_text_primary'))
              .layoutWeight(1)
              .maxLines(2)
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
      .width('100%')
      .constraintSize({ maxHeight: 320 })
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
    .borderRadius($r('app.float.float_radius_panel'))
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  field(label: Resource, value: string) {
    Row({ space: 8 }) {
      Text(label)
        .fontSize($r('app.float.float_font_11'))
        .fontColor($r('app.color.color_text_secondary'))
        .width(72)
        .maxLines(1)
      Text(value.length > 0 ? value : $r('app.string.leave_detail_not_provided'))
        .fontSize($r('app.float.float_font_13'))
        .fontColor($r('app.color.color_text_primary'))
        .layoutWeight(1)
        .maxLines(3)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
    .alignItems(VerticalAlign.Top)
  }

  private statusColor(): Resource {
    switch (this.displayStatus) {
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
    switch (this.displayStatus) {
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
    switch (this.displayStatus) {
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


