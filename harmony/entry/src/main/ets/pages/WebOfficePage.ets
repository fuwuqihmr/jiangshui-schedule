// 职责：教务/学工 Web 入口全屏页，只承载 platform/web/OfficeWebView 并把白名单 URL 透传。
// 依赖方向：pages -> platform/web -> core/viewmodel；本页不得直接拼 cookie、不直接调用网络或 Kit。
// 阶段：P3/P4；NavDestination 的 hideTitleBar 等导航属性待官方文档确认（已用自定义返回条降级）。
// 增补：假条结果写入本地失败必须可见（saveError + 重试），并给标题栏“刷新”重新抓取；
//              刷新通过 refreshToken 交给 OfficeWebView 重载页面后自动重抓，不导出任何 cookie。
import { buildWebOfficeParam } from '../core/viewmodel/WebEntryViewModel';
import { webTitle } from '../platform/format/ViewModelCopyFactory';
import type { WebOfficeParam } from '../core/viewmodel/WebEntryViewModel';
import { OfficeWebView } from '../platform/web/OfficeWebView';
import type { OfficeWebSessionImpl } from '../platform/web/OfficeWebSessionImpl';
import type { AppState } from '../core/types/AppState';
import type { LeaveRecord, LeaveStatusCache } from '../core/types/Leave';
import { leaveStatusCacheFromRecords } from '../core/viewmodel/LeaveStatusViewModel';
import { SEMESTER_MONDAY_TABLE } from '../data/SchoolReadOrchestrator';
import { AppStateHost } from '../platform/app/AppStateHost';

// 假条抓取失败文案：只暴露 §4.2 两个稳定码，服务器原文不拼给用户。
function officeLeaveErrorText(code: string): Resource {
  if (code === 'OFFICE_SESSION_REQUIRED') { return $r('app.string.office_error_session'); }
  if (code === 'OFFICE_PAGE_ERROR') { return $r('app.string.office_error_page'); }
  return $r('app.string.office_error_unavailable');
}

@Component
export struct WebOfficePage {
  param: WebOfficeParam = buildWebOfficeParam('leave');
  onBack: () => void = () => {};
  // WebOfficeView 装配好的页内会话；返回时清空（不改变 P3 展示，仅释放页内会话状态）。
  private session: OfficeWebSessionImpl | null = null;
  // 申请页加载完成后自动抓取的假条结果：页面只做显示与写既有状态仓库，解析已由实现完成。
  @State leaveLoaded: boolean = false;
  @State leaveCount: number = 0;
  @State leaveLatest: string = '';
  @State leaveErrorCode: string = '';
  // 写入本地失败（AppStateHost.saveLeaveStatus reject）时的可见状态：只提示，不覆盖已显示的数据。
  @State saveError: boolean = false;
  // 手动刷新信号：自增后由 OfficeWebView 的 @Watch 重载页面并重新抓取。
  @State refreshToken: number = 0;
  // 最近一次成功解析、但可能尚未写入本地的缓存：重试保存时直接复用，不重复抓取。
  private pendingCache: LeaveStatusCache | null = null;

  private titleText(): Resource { return webTitle(this.param.key); }

  private currentSemesterId(): string {
    const state: AppState = AppStateHost.current();
    return state.snapshot === null ? '' : state.snapshot.id;
  }

  // 假条过滤用学校教务学期号（如 2026-2027-1）；快照 id 是 jsxsd-起始日，不能直接当学期号。
  // 学期表未收录时返回空串（不过滤），避免把全部记录误判成其它学期。
  private semesterFilterId(): string {
    const state: AppState = AppStateHost.current();
    if (state.snapshot === null) { return ''; }
    const startDate: string = state.snapshot.startDate;
    for (const entry of SEMESTER_MONDAY_TABLE) {
      if (entry.monday === startDate) { return entry.semesterId; }
    }
    return '';
  }

  // 成功：交给既有 ViewModel 归一后写状态仓库；demo 模式只显示不落盘。
  private applyLeaveRecords(records: LeaveRecord[]): void {
    this.leaveLoaded = true;
    this.leaveErrorCode = '';
    const cache: LeaveStatusCache = leaveStatusCacheFromRecords(records, this.currentSemesterId());
    this.leaveCount = cache.records.length;
    this.leaveLatest = cache.records.length === 0 ? '' : cache.records[cache.records.length - 1].startDate;
    if (AppStateHost.demoMode()) { return; }
    cache.provider = 'school';
    cache.fetchedAt = new Date().toISOString();
    this.persistLeave(cache);
  }

  // 写入本地：失败必须上抛到 UI（保存失败提示 + 重试），不再静默吞掉。
  private persistLeave(cache: LeaveStatusCache): void {
    this.pendingCache = cache;
    AppStateHost.saveLeaveStatus(cache).then(() => {
      this.saveError = false;
    }).catch((error: Error) => {
      this.saveError = true;
    });
  }

  // 重试保存：只重放最近一次解析结果，不再访问学校网络。
  private retrySave(): void {
    const cache: LeaveStatusCache | null = this.pendingCache;
    if (cache === null) { return; }
    this.persistLeave(cache);
  }

  // 手动刷新：清空本页显示与错误，再让 OfficeWebView 重载申请页并重新抓取假条。
  private refreshLeave(): void {
    this.leaveLoaded = false;
    this.leaveCount = 0;
    this.leaveLatest = '';
    this.leaveErrorCode = '';
    this.saveError = false;
    this.pendingCache = null;
    this.refreshToken = this.refreshToken + 1;
  }

  private onLeaveFetchError(code: string): void {
    this.leaveErrorCode = code;
    this.leaveLoaded = false;
    this.leaveCount = 0;
    this.leaveLatest = '';
  }

  // Web 页面本身加载/重载失败也要有可见反馈：归一到 OFFICE_UNAVAILABLE 文案，不显示服务器原文。
  private onWebStateChange(state: string): void {
    if (state === 'error') {
      this.onLeaveFetchError('OFFICE_PAGE_ERROR');
    }
  }

  build() {
    NavDestination() {
      Column() {
        Row({ space: 8 }) {
          Button($r('app.string.common_back'))
            .height($r('app.float.float_touch_min'))
            .fontSize($r('app.float.float_font_13'))
            .fontColor($r('app.color.color_link'))
            .backgroundColor($r('app.color.color_surface'))
            .borderRadius($r('app.float.float_radius_control'))
            .onClick(() => {
              if (this.session !== null) { this.session.close().catch(() => {}); }
              this.onBack();
            })
          Text(this.titleText())
            .fontSize($r('app.float.float_font_20'))
            .fontColor($r('app.color.color_text_primary'))
            .fontWeight(FontWeight.Medium)
            .layoutWeight(1)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Button($r('app.string.web_office_refresh'))
            .height($r('app.float.float_touch_min'))
            .fontSize($r('app.float.float_font_13'))
            .fontColor($r('app.color.color_link'))
            .backgroundColor($r('app.color.color_surface'))
            .borderRadius($r('app.float.float_radius_control'))
            .onClick(() => { this.refreshLeave(); })
        }
        .width('100%')
        .padding({
          left: $r('app.float.float_page_padding'),
          right: $r('app.float.float_page_padding'),
          top: $r('app.float.float_space_8'),
          bottom: $r('app.float.float_space_8')
        })
        .backgroundColor($r('app.color.color_background'))

        if (this.saveError) {
          Row({ space: $r('app.float.float_space_8') }) {
            Text($r('app.string.web_office_save_failed'))
              .fontSize($r('app.float.float_font_12'))
              .fontColor($r('app.color.color_danger'))
              .layoutWeight(1)
            Button($r('app.string.school_btn_retry'))
              .height($r('app.float.float_touch_min'))
              .fontSize($r('app.float.float_font_12'))
              .fontColor($r('app.color.color_link'))
              .backgroundColor($r('app.color.color_surface'))
              .borderRadius($r('app.float.float_radius_control'))
              .onClick(() => { this.retrySave(); })
          }
          .width('100%')
          .padding({
            left: $r('app.float.float_page_padding'),
            right: $r('app.float.float_page_padding'),
            bottom: $r('app.float.float_space_8')
          })
        }

        if (this.leaveErrorCode.length > 0) {
          Text(officeLeaveErrorText(this.leaveErrorCode))
            .width('100%')
            .fontSize($r('app.float.float_font_12'))
            .fontColor($r('app.color.color_danger'))
            .padding({
              left: $r('app.float.float_page_padding'),
              right: $r('app.float.float_page_padding'),
              bottom: $r('app.float.float_space_8')
            })
        } else if (this.leaveLoaded) {
          if (this.leaveCount === 0) {
            Text($r('app.string.office_leave_empty'))
              .fontSize($r('app.float.float_font_12'))
              .fontColor($r('app.color.color_text_secondary'))
              .width('100%')
              .padding({
                left: $r('app.float.float_page_padding'),
                right: $r('app.float.float_page_padding'),
                bottom: $r('app.float.float_space_8')
              })
          } else {
            Row({ space: $r('app.float.float_space_8') }) {
              Text($r('app.string.office_leave_loaded', this.leaveCount))
                .fontSize($r('app.float.float_font_12'))
                .fontColor($r('app.color.color_text_secondary'))
              if (this.leaveLatest.length > 0) {
                Text($r('app.string.office_leave_latest', this.leaveLatest))
                  .fontSize($r('app.float.float_font_12'))
                  .fontColor($r('app.color.color_text_secondary'))
                  .layoutWeight(1)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
              }
            }
            .width('100%')
            .padding({
              left: $r('app.float.float_page_padding'),
              right: $r('app.float.float_page_padding'),
              bottom: $r('app.float.float_space_8')
            })
          }
        }

        Column() {
          OfficeWebView({ url: this.param.url, warmupUrl: this.param.warmupUrl, semesterId: this.semesterFilterId(),
            refreshToken: this.refreshToken,
            onStateChange: (state: string) => { this.onWebStateChange(state); }, closed: () => { this.onBack(); },
            onSessionReady: (session: OfficeWebSessionImpl) => { this.session = session; },
            onLeaveRecords: (records: LeaveRecord[]) => { this.applyLeaveRecords(records); },
            onLeaveError: (code: string) => { this.onLeaveFetchError(code); } })
        }
        .width('100%')
        .layoutWeight(1)
      }
      .width('100%')
      .height('100%')
      .backgroundColor($r('app.color.color_background'))
    }
    // 待官方文档确认：NavDestination 隐藏系统标题栏的属性名与取值。
    .hideTitleBar(true)
  }
}


