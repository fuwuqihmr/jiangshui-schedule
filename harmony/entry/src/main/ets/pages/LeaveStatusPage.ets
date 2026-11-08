// 职责：假条状态全屏页（P3 B 块）：汇总计数、数据截至、示例标记、记录列表、空态、详情面板。
// 依赖方向：pages -> components/core/viewmodel；纯展示，不访问网络/Kit。
// 阶段：P3；导航 API 降级：用 NavDestination + 自定义返回条，hideTitleBar 待官方文档确认。
// 待确认：NavDestination 在 Navigation 外单独使用时的行为；LeaveStatusCopy 的平台工厂尚未接线，
//         故本页用 buildLeaveStatusView 注入「仅格式化、不含中文」的 copy，中文全部走 $r 资源键。
import type { LeaveRecord, LeaveStatusCache } from '../core/types/Leave';
import type { LeaveDisplayStatus, LeaveStatusCopy, LeaveStatusRowView, LeaveStatusView } from '../core/viewmodel/LeaveStatusViewModel';
import { buildLeaveStatusView, emptyLeaveStatus } from '../core/viewmodel/LeaveStatusViewModel';
import { LeaveRecordCard } from '../components/LeaveRecordCard';
import { LeaveRecordDetailSheet } from '../components/LeaveRecordDetailSheet';
import { EmptyState } from '../components/EmptyState';

// 父组件未传入 cache 时的空数据，避免 @Prop 未初始化导致渲染期取 undefined。
const EMPTY_CACHE: LeaveStatusCache = emptyLeaveStatus('');

function emptyRecord(): LeaveRecord {
  return {
    id: '',
    type: 'leave',
    status: 'unknown',
    startDate: '',
    startTime: '',
    endDate: '',
    endTime: '',
    reason: '',
    approver: '',
    comment: '',
    rawStatus: '',
    semesterId: '',
    demo: false
  };
}

function emptyView(): LeaveStatusView {
  return {
    titleKey: '',
    isSample: false,
    rows: [],
    summary: { total: 0, approved: 0, pending: 0, rejected: 0, unknown: 0, expired: 0 },
    isEmpty: true,
    errorKey: null
  };
}

// 只负责时间格式化（无中文），文案键由页面 $r 映射。
function periodText(record: LeaveRecord): string {
  if (record.startDate.length === 0) {
    return '';
  }
  return record.startDate + ' ' + record.startTime + ' - ' + record.endDate + ' ' + record.endTime;
}

function pageCopy(): LeaveStatusCopy {
  const copy: LeaveStatusCopy = {
    statusKey: (status: LeaveDisplayStatus): string => 'leave_status_' + status,
    typeKey: (type: string): string => type === 'cancel' ? 'leave_type_cancel' : type === 'renew' ? 'leave_type_renew' : 'leave_type_leave',
    formatPeriod: (record: LeaveRecord): string => periodText(record),
    titleKey: (): string => 'day_leave_status_entry',
    emptyKey: (): string => 'leave_status_empty',
    errorKey: (): string => 'leave_status_read_error'
  };
  return copy;
}

@Component
export struct LeaveStatusPage {
  @Prop @Watch('refresh') cache: LeaveStatusCache = EMPTY_CACHE;
  @Prop busy: boolean = false;
  @Prop errorKey: string = '';
  onBack: () => void = () => {};
  @State view: LeaveStatusView = emptyView();
  @State expandedId: string = '';
  @State selectedId: string = '';

  aboutToAppear(): void {
    this.refresh();
  }

  refresh(): void {
    this.view = buildLeaveStatusView(this.cache, Date.now(), pageCopy());
  }

  private findRecord(id: string): LeaveRecord {
    for (const record of this.cache.records) {
      if (record.id === id) {
        return record;
      }
    }
    return emptyRecord();
  }

  private displayStatusOf(id: string): LeaveDisplayStatus {
    for (const row of this.view.rows) {
      if (row.id === id) {
        return row.displayStatus;
      }
    }
    return 'unknown';
  }

  private hasDemo(): boolean {
    for (const record of this.cache.records) {
      if (record.demo) {
        return true;
      }
    }
    return false;
  }

  // fetchedAt 为 ISO 字符串；无法解析时原样显示，空串时整行隐藏。
  private fetchedText(): string {
    const raw: string = this.cache.fetchedAt === null ? '' : this.cache.fetchedAt;
    if (raw.length >= 16) {
      return raw.slice(0, 10) + ' ' + raw.slice(11, 16);
    }
    return raw;
  }

  private periodOf(row: LeaveStatusRowView): string {
    if (row.periodText.length > 0) {
      return row.periodText;
    }
    return periodText(this.findRecord(row.id));
  }

  build() {
    NavDestination() {
      Stack({ alignContent: Alignment.Bottom }) {
        Column() {
          Row({ space: 8 }) {
            Button($r('app.string.common_back'))
              .height($r('app.float.float_touch_min'))
              .fontSize($r('app.float.float_font_13'))
              .fontColor($r('app.color.color_link'))
              .backgroundColor($r('app.color.color_surface'))
              .borderRadius($r('app.float.float_radius_control'))
              .onClick(() => {
                this.onBack();
              })
            Text($r('app.string.day_leave_status_entry'))
              .fontSize($r('app.float.float_font_20'))
              .fontColor($r('app.color.color_text_primary'))
              .fontWeight(FontWeight.Medium)
              .layoutWeight(1)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .width('100%')
          .padding({
            left: $r('app.float.float_page_padding'),
            right: $r('app.float.float_page_padding'),
            top: $r('app.float.float_space_8'),
            bottom: $r('app.float.float_space_8')
          })

          Scroll() {
            Column({ space: 12 }) {
              this.summaryCard()
              if (this.view.isSample || this.fetchedText().length > 0) {
                this.metaRow()
              }
              if (this.view.errorKey !== null && this.view.errorKey.length > 0) {
                EmptyState({ title: $r('app.string.leave_status_read_error') })
              } else if (this.busy) {
                Text($r('app.string.leave_status_loading')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary'))
              } else if (this.view.isEmpty) {
                EmptyState({ title: $r('app.string.leave_status_empty') })
              } else {
                ForEach(this.view.rows, (row: LeaveStatusRowView) => {
                  LeaveRecordCard({
                    row: row,
                    record: this.findRecord(row.id),
                    expanded: this.expandedId === row.id,
                    onToggle: () => {
                      this.expandedId = this.expandedId === row.id ? '' : row.id;
                    },
                    onOpenDetail: () => {
                      this.selectedId = row.id;
                    }
                  })
                }, (row: LeaveStatusRowView): string => row.id)
              }
            }
            .width('100%')
            .padding({
              left: $r('app.float.float_page_padding'),
              right: $r('app.float.float_page_padding'),
              bottom: $r('app.float.float_page_padding')
            })
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .layoutWeight(1)
          .scrollBar(BarState.Off)
        }
        .width('100%')
        .height('100%')

        if (this.selectedId !== '') {
          Column() {
            LeaveRecordDetailSheet({
              record: this.findRecord(this.selectedId),
              displayStatus: this.displayStatusOf(this.selectedId),
              onClose: () => {
                this.selectedId = '';
              }
            })
          }
          .width('100%')
          .padding({
            left: $r('app.float.float_page_padding'),
            right: $r('app.float.float_page_padding'),
            bottom: $r('app.float.float_page_padding')
          })
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('app.color.color_background'))
    }
    // 待官方文档确认：NavDestination 隐藏系统标题栏的属性名与取值。
    .hideTitleBar(true)
  }

  @Builder
  summaryCard() {
    Row() {
      this.statCell(this.view.summary.total, $r('app.string.leave_status_total'))
      this.statCell(this.view.summary.approved, $r('app.string.leave_status_approved'))
      this.statCell(this.view.summary.pending, $r('app.string.leave_status_pending'))
      this.statCell(this.view.summary.expired, $r('app.string.leave_status_expired'))
      this.statCell(this.view.summary.rejected, $r('app.string.leave_status_rejected'))
    }
    .width('100%')
    .padding($r('app.float.float_card_padding'))
    .backgroundColor($r('app.color.color_surface'))
    .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_border') })
    .borderRadius($r('app.float.float_radius_card'))
  }

  @Builder
  statCell(value: number, label: Resource) {
    Column({ space: 2 }) {
      Text(value.toString())
        .fontSize($r('app.float.float_font_20'))
        .fontColor($r('app.color.color_text_primary'))
        .fontWeight(FontWeight.Medium)
      Text(label)
        .fontSize($r('app.float.float_font_11'))
        .fontColor($r('app.color.color_text_secondary'))
    }
    .layoutWeight(1)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  metaRow() {
    Row({ space: 8 }) {
      if (this.hasDemo()) {
        Text($r('app.string.sample_badge'))
          .fontSize($r('app.float.float_font_11'))
          .fontColor($r('app.color.color_pending_amber'))
          .backgroundColor($r('app.color.color_pending_amber_bg'))
          .border({ width: $r('app.float.float_stroke'), color: $r('app.color.color_pending_border') })
          .borderRadius($r('app.float.float_radius_pill'))
          .padding({ left: 8, right: 8, top: 2, bottom: 2 })
      }
      if (this.fetchedText().length > 0) {
        Text($r('app.string.leave_status_data_as_of', this.fetchedText()))
          .fontSize($r('app.float.float_font_11'))
          .fontColor($r('app.color.color_text_secondary'))
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
    }
    .width('100%')
  }
}


