// 职责：课程卡（今日/完整课表共用）。
// 依赖方向：components -> core/viewmodel 类型 only。
// 阶段：P2；状态色由 status/colorKey 映射 ThemeTokens。
import type { CourseView } from '../core/viewmodel/DayViewModel';

@Component
export struct CourseCard {
  @Prop model: CourseView = {} as CourseView;
  compact: boolean = false;
  onOpen: () => void = () => {};

  private isPending(): boolean {
    return this.model.status === 'leave-pending';
  }

  private isMuted(): boolean {
    const status: string = this.model.status;
    return status === 'leave-approved' || status === 'moved' || status === 'vacant' || status === 'cancelled';
  }

  private isStudy(): boolean {
    return this.model.status === 'study';
  }

  private surfaceColor(): ResourceColor {
    if (this.isPending()) return $r('app.color.color_pending_amber_bg');
    if (this.isMuted()) return $r('app.color.color_leave_muted_bg');
    if (this.isStudy()) return $r('app.color.color_course_1_bg');
    return $r('app.color.color_surface');
  }

  private titleColor(): ResourceColor {
    if (this.isPending()) return $r('app.color.color_pending_amber');
    if (this.isMuted()) return $r('app.color.color_leave_muted_text');
    if (this.isStudy()) return $r('app.color.color_course_1_ink');
    return $r('app.color.color_text_primary');
  }

  private metaColor(): ResourceColor {
    if (this.isPending()) return $r('app.color.color_pending_amber');
    if (this.isMuted()) return $r('app.color.color_leave_muted_text');
    if (this.isStudy()) return $r('app.color.color_course_1_ink');
    return $r('app.color.color_text_secondary');
  }

  private cardBorderColor(): ResourceColor {
    if (this.isPending()) return $r('app.color.color_pending_border');
    if (this.isMuted()) return $r('app.color.color_leave_muted_line');
    if (this.isStudy()) return $r('app.color.color_course_1_accent');
    return $r('app.color.color_border');
  }

  private badgeSurfaceColor(): ResourceColor {
    if (this.isStudy()) return $r('app.color.color_accent_soft');
    return $r('app.color.color_surface');
  }

  private badgeTextColor(): ResourceColor {
    if (this.isPending()) return $r('app.color.color_pending_amber');
    if (this.isMuted()) return $r('app.color.color_leave_muted_text');
    if (this.isStudy()) return $r('app.color.color_accent');
    return $r('app.color.color_text_secondary');
  }

  build() {
    if (this.compact) {
      // 周网格单格 92×52：只保留课程名与状态底色，避免内容溢出后被横向 Scroll 裁掉。
      Column() {
        Text(this.model.row.name)
          .fontSize($r('app.float.float_font_11'))
          .fontColor(this.titleColor())
          .fontWeight(FontWeight.Medium)
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .decoration({
            type: (this.model.status === 'leave-approved' || this.model.status === 'cancelled')
              ? TextDecorationType.LineThrough : TextDecorationType.None,
            color: $r('app.color.color_leave_muted_line')
          })
        Text(this.model.a11yText).fontSize($r('app.float.float_font_11')).visibility(Visibility.None)
      }.width('100%').height('100%').justifyContent(FlexAlign.Center).alignItems(HorizontalAlign.Start)
        .padding(4)
        .backgroundColor(this.surfaceColor())
        .border({ width: 1, color: this.cardBorderColor(), style: this.isPending() ? BorderStyle.Dashed : BorderStyle.Solid })
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => this.onOpen())
    } else {
      Row({ space: 8 }) {
        Column() {
          Text(this.model.timeText).fontSize($r('app.float.float_font_11')).fontColor(this.metaColor())
          Text(this.model.periodText).fontSize($r('app.float.float_font_11')).fontColor(this.metaColor())
        }.width(64)
        Column({ space: 4 }) {
          Text(this.model.row.name)
            .fontSize($r('app.float.float_font_16'))
            .fontColor(this.titleColor())
            .fontWeight(FontWeight.Medium)
            .maxLines(3)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .decoration({
              type: (this.model.status === 'leave-approved' || this.model.status === 'cancelled')
                ? TextDecorationType.LineThrough : TextDecorationType.None,
              color: $r('app.color.color_leave_muted_line')
            })
          Text(this.model.row.teacher + ' ' + this.model.row.room)
            .fontSize($r('app.float.float_font_12')).fontColor(this.metaColor())
            .maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          ForEach(this.model.tagLabels, (tag: string) => {
            Text(tag).fontSize($r('app.float.float_font_11')).fontColor(this.badgeTextColor())
          }, (tag: string) => tag)
          Text(this.model.a11yText).fontSize($r('app.float.float_font_11')).visibility(Visibility.None)
          Text(this.model.statusLabel)
            .fontSize($r('app.float.float_font_11')).fontColor(this.badgeTextColor())
            .backgroundColor(this.badgeSurfaceColor())
            .padding({ left: 6, right: 6, top: 2, bottom: 2 })
            .border({ width: 1, color: this.cardBorderColor(), style: this.isPending() ? BorderStyle.Dashed : BorderStyle.Solid })
            .borderRadius($r('app.float.float_radius_pill'))
            .visibility(this.model.status === 'normal' ? Visibility.None : Visibility.Visible)
        }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      }.width('100%')
        .padding($r('app.float.float_space_16'))
        .backgroundColor(this.surfaceColor())
        .border({ width: 1, color: this.cardBorderColor(), style: this.isPending() ? BorderStyle.Dashed : BorderStyle.Solid })
        .borderRadius($r('app.float.float_radius_card'))
        .onClick(() => this.onOpen())
    }
  }
}
