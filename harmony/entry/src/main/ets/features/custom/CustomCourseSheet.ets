// 职责：自定义课程新增/编辑表单（每周课与单次课两种模式，校验后交父页面写状态）。
// 依赖方向：features/custom -> core/custom 纯逻辑 + core/types + ArkUI 资源。
// 阶段：P4；错误文案走 custom_error_* 资源键，父页面负责持久化与变更记录。
import type { AppState, CustomCourse } from '../../core/types/AppState';
import type { CustomCourseDraft } from '../../core/custom/CustomScheduleService';
import { submitCourse } from './CustomFormLogic';
import { customFormErrorText } from './CustomFormErrorText';

const WEEK_DAYS: number[] = [1, 2, 3, 4, 5, 6, 7];

@Component
export struct CustomCourseSheet {
  @Prop state: AppState;
  @Prop editing: CustomCourse | null = null;
  onSubmit: (course: CustomCourse) => void = () => {};
  onDelete: (id: string) => void = () => {};
  onClose: () => void = () => {};
  @State mode: string = 'weekly';
  @State name: string = '';
  @State teacher: string = '';
  @State room: string = '';
  @State startTime: string = '18:00';
  @State endTime: string = '18:45';
  @State dayOfWeek: number = 1;
  @State startWeek: number = 1;
  @State endWeek: number = 16;
  @State weekPattern: string = 'every';
  @State date: string = '';
  @State errors: string[] = [];

  aboutToAppear(): void {
    const course = this.editing;
    if (course === null) {
      return;
    }
    this.mode = course.mode;
    this.name = course.name;
    this.teacher = course.teacher;
    this.room = course.room;
    this.startTime = course.startTime;
    this.endTime = course.endTime;
    this.dayOfWeek = course.dayOfWeek === undefined ? 1 : course.dayOfWeek;
    this.startWeek = course.startWeek === undefined ? 1 : course.startWeek;
    this.endWeek = course.endWeek === undefined ? 16 : course.endWeek;
    this.weekPattern = course.weekPattern === undefined ? 'every' : course.weekPattern;
    this.date = course.date === undefined ? '' : course.date;
  }

  private readInt(value: string, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.trunc(parsed);
  }

  private save(): void {
    const mode: 'weekly' | 'once' = this.mode === 'once' ? 'once' : 'weekly';
    const pattern: 'every' | 'odd' | 'even' = this.weekPattern === 'odd' ? 'odd'
      : (this.weekPattern === 'even' ? 'even' : 'every');
    const draft: CustomCourseDraft = {
      mode: mode,
      name: this.name,
      teacher: this.teacher,
      room: this.room,
      startTime: this.startTime,
      endTime: this.endTime,
      dayOfWeek: this.dayOfWeek,
      startWeek: this.startWeek,
      endWeek: this.endWeek,
      weekPattern: pattern,
      date: this.date,
      customCourseId: this.editing === null ? '' : this.editing.id
    };
    const errors = submitCourse(draft, this.state, Date.now(), (course: CustomCourse) => {
      this.onSubmit(course);
    });
    this.errors = errors;
  }

  build() {
    Column({ space: 10 }) {
      Row() {
        Text(this.editing === null ? $r('app.string.custom_sheet_title_add') : $r('app.string.custom_sheet_title_edit'))
          .fontSize(16).fontWeight(FontWeight.Medium)
        Blank()
        Text($r('app.string.custom_action_cancel')).fontSize(14).onClick(() => { this.onClose(); })
      }.width('100%')
      Row({ space: 8 }) {
        Text($r('app.string.custom_mode_weekly')).fontSize(13)
          .fontWeight(this.mode === 'weekly' ? FontWeight.Medium : FontWeight.Normal)
          .onClick(() => { this.mode = 'weekly'; })
        Text($r('app.string.custom_mode_once')).fontSize(13)
          .fontWeight(this.mode === 'once' ? FontWeight.Medium : FontWeight.Normal)
          .onClick(() => { this.mode = 'once'; })
      }.width('100%')
      Column({ space: 4 }) {
        Text($r('app.string.custom_field_name')).fontSize(12)
        TextInput({ text: this.name, placeholder: $r('app.string.custom_field_name') }).fontSize(14)
          .onChange((value: string) => { this.name = value; })
      }.alignItems(HorizontalAlign.Start).width('100%')
      Column({ space: 4 }) {
        Text($r('app.string.custom_field_teacher')).fontSize(12)
        TextInput({ text: this.teacher, placeholder: $r('app.string.custom_field_teacher') }).fontSize(14)
          .onChange((value: string) => { this.teacher = value; })
      }.alignItems(HorizontalAlign.Start).width('100%')
      Column({ space: 4 }) {
        Text($r('app.string.custom_field_room')).fontSize(12)
        TextInput({ text: this.room, placeholder: $r('app.string.custom_field_room') }).fontSize(14)
          .onChange((value: string) => { this.room = value; })
      }.alignItems(HorizontalAlign.Start).width('100%')
      Row({ space: 8 }) {
        Column({ space: 4 }) {
          Text($r('app.string.custom_field_start')).fontSize(12)
          TextInput({ text: this.startTime }).fontSize(14).onChange((value: string) => { this.startTime = value; })
        }.layoutWeight(1)
        Column({ space: 4 }) {
          Text($r('app.string.custom_field_end')).fontSize(12)
          TextInput({ text: this.endTime }).fontSize(14).onChange((value: string) => { this.endTime = value; })
        }.layoutWeight(1)
      }.width('100%')
      if (this.mode === 'weekly') {
        Column({ space: 4 }) {
          Text($r('app.string.custom_field_day')).fontSize(12)
          Row({ space: 6 }) {
            ForEach(WEEK_DAYS, (day: number) => {
              Text(String(day)).fontSize(13)
                .fontWeight(this.dayOfWeek === day ? FontWeight.Medium : FontWeight.Normal)
                .onClick(() => { this.dayOfWeek = day; })
            }, (day: number) => String(day))
          }.width('100%')
        }.alignItems(HorizontalAlign.Start).width('100%')
        Row({ space: 8 }) {
          Column({ space: 4 }) {
            Text($r('app.string.custom_field_start_week')).fontSize(12)
            TextInput({ text: String(this.startWeek) }).type(InputType.Number).fontSize(14)
              .onChange((value: string) => { this.startWeek = this.readInt(value, 0); })
          }.layoutWeight(1)
          Column({ space: 4 }) {
            Text($r('app.string.custom_field_end_week')).fontSize(12)
            TextInput({ text: String(this.endWeek) }).type(InputType.Number).fontSize(14)
              .onChange((value: string) => { this.endWeek = this.readInt(value, 0); })
          }.layoutWeight(1)
        }.width('100%')
        Column({ space: 4 }) {
          Text($r('app.string.custom_field_week_pattern')).fontSize(12)
          Row({ space: 8 }) {
            Text($r('app.string.custom_pattern_every')).fontSize(13)
              .fontWeight(this.weekPattern === 'every' ? FontWeight.Medium : FontWeight.Normal)
              .onClick(() => { this.weekPattern = 'every'; })
            Text($r('app.string.custom_pattern_odd')).fontSize(13)
              .fontWeight(this.weekPattern === 'odd' ? FontWeight.Medium : FontWeight.Normal)
              .onClick(() => { this.weekPattern = 'odd'; })
            Text($r('app.string.custom_pattern_even')).fontSize(13)
              .fontWeight(this.weekPattern === 'even' ? FontWeight.Medium : FontWeight.Normal)
              .onClick(() => { this.weekPattern = 'even'; })
          }.width('100%')
        }.alignItems(HorizontalAlign.Start).width('100%')
      } else {
        Column({ space: 4 }) {
          Text($r('app.string.custom_field_date')).fontSize(12)
          TextInput({ text: this.date, placeholder: $r('app.string.custom_field_date') }).fontSize(14)
            .onChange((value: string) => { this.date = value; })
        }.alignItems(HorizontalAlign.Start).width('100%')
      }
      if (this.errors.length > 0) {
        Column({ space: 2 }) {
          ForEach(this.errors, (code: string) => {
            Text(customFormErrorText(code)).fontSize(11)
          }, (code: string) => code)
        }.alignItems(HorizontalAlign.Start).width('100%')
      }
      Row({ space: 8 }) {
        Text($r('app.string.custom_action_save')).fontSize(14).fontWeight(FontWeight.Medium)
          .onClick(() => { this.save(); })
        Blank()
        if (this.editing !== null) {
          Text($r('app.string.custom_action_delete')).fontSize(14)
            .onClick(() => {
              const course = this.editing;
              if (course !== null) {
                this.onDelete(course.id);
              }
            })
        }
      }.width('100%')
    }
    .padding(16)
    .width('100%')
  }
}