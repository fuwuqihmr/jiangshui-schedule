// 职责：日期切换控件。
// 依赖方向：components -> ArkUI only。
// 阶段：P2；日期选择使用 UIContext.showDatePickerDialog（API 26）。
@Component
export struct DateSwitcher {
  @Prop dateKey: string = '';
  @Prop label: string = '';
  onPrev: () => void = () => {};
  onNext: () => void = () => {};
  onPick: (dateKey: string) => void = () => {};

  private selectedDate(): Date {
    const parts: string[] = this.dateKey.split('-');
    if (parts.length === 3) {
      const year: number = Number(parts[0]);
      const month: number = Number(parts[1]);
      const day: number = Number(parts[2]);
      if (year > 0 && month > 0 && day > 0) {
        return new Date(year, month - 1, day);
      }
    }
    return new Date();
  }

  private dateKeyOf(value: Date): string {
    const month: number = value.getMonth() + 1;
    const day: number = value.getDate();
    const monthText: string = month < 10 ? '0' + String(month) : String(month);
    const dayText: string = day < 10 ? '0' + String(day) : String(day);
    return String(value.getFullYear()) + '-' + monthText + '-' + dayText;
  }

  private openPicker(): void {
    this.getUIContext().showDatePickerDialog({
      selected: this.selectedDate(),
      onDateAccept: (value: Date) => {
        this.onPick(this.dateKeyOf(value));
      }
    });
  }

  build() {
    Row({ space: 8 }) {
      Button($r('app.string.prev_day')).height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
        .backgroundColor($r('app.color.color_surface'))
        .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => this.onPrev())
      Button(this.label + ' ' + this.dateKey).height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
        .backgroundColor($r('app.color.color_surface'))
        .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => this.openPicker())
      Button($r('app.string.next_day')).height($r('app.float.float_touch_min'))
        .fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
        .backgroundColor($r('app.color.color_surface'))
        .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_control_border') })
        .borderRadius($r('app.float.float_radius_control'))
        .onClick(() => this.onNext())
    }.width('100%').justifyContent(FlexAlign.SpaceBetween)
  }
}
