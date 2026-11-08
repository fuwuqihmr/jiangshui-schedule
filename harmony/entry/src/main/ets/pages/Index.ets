// 职责：一级 Tabs + Navigation 路由（今日/完整课表/变更记录/设置，以及请假状态/Web）。
// 依赖方向：pages -> components/core/types/platform；页面不直接 new 路由页。
// 阶段：P3；待官方文档确认 NavPathStack/NavDestination API。
// 待确认：Navigation 嵌套 Tabs 与页面返回时的 pop 行为。
import { SettingsPage } from './SettingsPage';
import { DayPage } from './DayPage';
import { WeekPage } from './WeekPage';
import { ChangesPage } from './ChangesPage';
import { LeaveStatusPage } from './LeaveStatusPage';
import { WebOfficePage } from './WebOfficePage';
import { SchoolLoginPage } from './SchoolLoginPage';
import { normalizeSchoolErrorCode, schoolProgressText } from '../components/SchoolAccountCard';
import type { SchoolAccountState } from '../components/SchoolAccountCard';
import { CustomStateController } from '../features/custom/CustomStateController';
import { createDefaultState } from '../core/types/AppState';
import type { AppState, ChangeRecord, CustomCourse, DayOverride, HolidayDay, LocalMapRule, SettingsExpanded } from '../core/types/AppState';
import type { LeaveRecord, LeaveStatusCache, SchoolReadResult, SchoolSession } from '../core/types/Leave';
import { emptyLeaveStatus } from '../core/viewmodel/LeaveStatusViewModel';
import { isSchoolSessionUsable } from '../data/SchoolSessionStore';
import { SchoolReaderImpl } from '../platform/school/SchoolReader';
import { NetworkHttpGateway } from '../platform/network/HttpGateway';
import { PlatformWebCookieStore } from '../platform/web/WebCookieStore';
import { createSchoolLexicon, rowsFilterLabel, schoolSourceLabel } from '../platform/school/ParserLexiconFactory';
import { loadStoredSchoolSession, clearStoredSchoolSession, schoolSemesterDisplayName, schoolSemesterFallback, schoolSsoEntryUrl, schoolWebAvailable } from '../platform/web/SchoolLoginWebView';
import type { WebOfficeParam } from '../core/viewmodel/WebEntryViewModel';
import { buildWebOfficeParam, buildPortalWebParam, buildMobileWebParam } from '../core/viewmodel/WebEntryViewModel';
import { AppStateHost } from '../platform/app/AppStateHost';
import { CalendarGatewayUnavailable } from '../platform/calendar/CalendarGateway';
import { SystemPermissionService } from '../platform/system/SystemPermissionService';
import { SystemIntegrationService } from '../features/system/SystemIntegrationService';
import type { NotificationView, SystemActionView } from '../features/system/SystemIntegrationService';
import type { PermissionSnapshot } from '../core/types/Common';
import type { CalendarStatus } from '../core/types/Calendar';
import { toggleSettingsGroup, expandAllSettingsGroups, collapseAllSettingsGroups } from '../core/viewmodel/SettingsViewModel';
import { diffState, weekOf } from '../core/timetable/TimetableCore';
import { applyChangeRecords } from '../core/custom/CustomScheduleService';
import { validateRestoreState } from '../core/export/Backup';

function todayDateKey(): string {
  const now: Date = new Date();
  const month: string = (now.getMonth() + 1).toString().padStart(2, '0');
  const day: string = now.getDate().toString().padStart(2, '0');
  return now.getFullYear().toString() + '-' + month + '-' + day;
}

// 读盘/保存失败时不能污染内存里的旧快照，因此写入前复制一份 AppState。
function copyAppState(base: AppState): AppState {
  const copy: AppState = {
    version: base.version,
    snapshot: base.snapshot,
    events: base.events,
    changeRecords: base.changeRecords,
    overrides: base.overrides,
    localMaps: base.localMaps,
    holidaySettings: base.holidaySettings,
    courseSettings: base.courseSettings,
    customCourses: base.customCourses,
    theme: base.theme,
    showDayOverview: base.showDayOverview,
    settingsExpanded: base.settingsExpanded,
    leaveStatus: base.leaveStatus,
    demoMode: base.demoMode,
    calendarOptions: base.calendarOptions,
    notificationEnabled: base.notificationEnabled,
    classReminders: base.classReminders,
    autoCheckEnabled: base.autoCheckEnabled,
    lastSuccess: base.lastSuccess,
    lastAttempt: base.lastAttempt,
    error: base.error,
    _revision: base._revision
  };
  return copy;
}

@Entry
@Component
struct Index {
  @State activeTab: number = 0;
  @State appState: AppState = createDefaultState();
  @State leaveRecords: LeaveRecord[] = [];
  @State selectedDate: string = '';
  @State selectedWeek: number = 1;
  @State todayKey: string = todayDateKey();
  @State pathStack: NavPathStack = new NavPathStack();
  // 通知状态（'granted'|'prompt'|'denied'|'unavailable'|'unverified'）；unverified 表示系统开关读不出真值。
  @State permission: string = 'prompt';
  @State calendarStatus: string = 'unavailable';
  @State permissionHintVisible: boolean = false;
  @State calendarHintVisible: boolean = false;
  @State schoolState: SchoolAccountState = 'unbound';
  @State schoolLastSuccessAt: number = 0;
  @State schoolLastAttemptAt: number = 0;
  @State schoolBusy: boolean = false;
  @State schoolProgressStage: string = 'session-check';
  @State schoolErrorCode: string = '';
  @State schoolWeb: boolean = false;
  @State demoSwitchFailed: boolean = false;
  private schoolReadToken: number = 0;
  // 当前一轮读取的 HTTP 网关（P1-6）：取消/页面销毁时用它中断在途请求，避免 Promise 悬挂后继续跑。
  private schoolGateway: NetworkHttpGateway | null = null;
  private customController: CustomStateController = new CustomStateController();
  private hasAppeared: boolean = false;

  async aboutToAppear(): Promise<void> {
    AppStateHost.initialize(getContext(this));
    try { await AppStateHost.load(); } catch (error) { this.appState = createDefaultState(); }
    this.appState = AppStateHost.currentPretty();
    this.selectedDate = this.todayKey;
    this.selectedWeek = this.appState.snapshot === null ? 1 : Math.max(1, weekOf(this.appState.snapshot, this.todayKey));
    this.leaveRecords = this.leaveCache().records;
    this.schoolWeb = schoolWebAvailable();
    this.schoolLastSuccessAt = this.appState.lastSuccess;
    this.schoolLastAttemptAt = this.appState.lastAttempt;
    this.customController.reset(this.appState);
    this.hasAppeared = true;
    try { await this.refreshPermissionStates(); } catch (error) {}
    try {
      const stored: SchoolSession | null = await loadStoredSchoolSession(getContext(this));
      if (stored !== null && isSchoolSessionUsable(stored)) {
        this.schoolState = 'ready';
      } else if (this.appState.lastAttempt > 0 && this.appState.error !== null) {
        this.schoolErrorCode = this.appState.error;
        this.schoolState = 'error';
      }
    } catch (error) {}
  }

  // 从其他路由返回时重新同步宿主状态；首次进入由 aboutToAppear 负责，避免重复读盘。
  async onPageShow(): Promise<void> {
    if (!this.hasAppeared) {
      this.customController.reset(this.appState);
      return;
    }
    try { await AppStateHost.load(); } catch (error) {}
    this.appState = AppStateHost.currentPretty();
    this.leaveRecords = this.leaveCache().records;
    this.customController.reset(this.appState);
    // 从系统设置返回时重新取证：真机开关可能刚被用户改过。
    try { await this.refreshPermissionStates(); } catch (error) {}
  }

  private leaveCache(): LeaveStatusCache {
    const raw: object | undefined = this.appState.leaveStatus;
    if (raw === undefined || raw === null) { return emptyLeaveStatus(''); }
    return raw as LeaveStatusCache;
  }

  // 请假服务页关闭后把宿主状态（含页内抓取写入的假条）同步回内存，再进设置页即显示最新条数。
  private refreshLeaveFromHost(): void {
    this.appState = AppStateHost.currentPretty();
    this.leaveRecords = this.leaveCache().records;
  }

  private async persistSettings(next: SettingsExpanded): Promise<void> {
    const state: AppState = this.appState;
    state.settingsExpanded = next;
    // demo 预览不写盘，避免示例状态覆盖真实课表。
    if (AppStateHost.demoMode()) { this.appState = state; return; }
    try { await AppStateHost.save(state); this.appState = state; } catch (error) {}
  }
  private async saveRead(next: AppState): Promise<void> {
    if (AppStateHost.demoMode()) { this.appState = next; return; }
    const previous: AppState = this.appState;
    try { await AppStateHost.save(next); this.appState = next; } catch (error) { this.appState = previous; }
  }

  // 备份恢复：只有写盘成功才替换内存状态；demo 开关以备份为准（恢复整体替换）。
  private async applyRestoredState(next: AppState): Promise<boolean> {
    // 恢复前校验：非法状态不写盘、不替换内存，旧课表原样保留。
    if (validateRestoreState(next) !== '') { return false; }
    const wasDemo: boolean = AppStateHost.demoMode();
    // 备份写的是示例数据就留在示例模式；写的是真实数据就退出示例模式。
    const backupDemo: boolean = next.demoMode === true;
    next.demoMode = backupDemo;
    // demo 预览不是持久态；diff 的基线始终取持久状态，避免把示例课表差异灌进 changeRecords。
    const base: AppState = wasDemo ? AppStateHost.current() : this.appState;
    const fresh: ChangeRecord[] = diffState(base, next);
    next.changeRecords = applyChangeRecords(next, fresh).changeRecords;
    try { await AppStateHost.restore(next); } catch (error) { return false; }
    this.appState = AppStateHost.currentPretty();
    this.selectedDate = this.todayKey;
    this.selectedWeek = this.appState.snapshot === null ? 1 : Math.max(1, weekOf(this.appState.snapshot, this.todayKey));
    this.leaveRecords = this.leaveCache().records;
    this.schoolLastSuccessAt = this.appState.lastSuccess;
    this.schoolLastAttemptAt = this.appState.lastAttempt;
    this.customController.reset(this.appState);
    return true;
  }

  private markChangeRead(id: string): void {
    const next: AppState = this.appState;
    next.changeRecords = next.changeRecords.map((item: ChangeRecord) => item.id === id ? {
      id: item.id, key: item.key, kind: item.kind, stableKey: item.stableKey, date: item.date,
      title: item.title, detail: item.detail, before: item.before, after: item.after, fields: item.fields,
      type: item.type, source: item.source, read: true, notifiedAt: item.notifiedAt, detectedAt: item.detectedAt, at: item.at
    } : item);
    this.saveRead(next);
  }

  private markAllChangeRead(): void {
    const next: AppState = this.appState;
    next.changeRecords = next.changeRecords.map((item: ChangeRecord) => {
      const copy: ChangeRecord = { id: item.id, key: item.key, kind: item.kind, stableKey: item.stableKey, date: item.date, title: item.title, detail: item.detail, before: item.before, after: item.after, fields: item.fields, type: item.type, source: item.source, read: true, notifiedAt: item.notifiedAt, detectedAt: item.detectedAt, at: item.at };
      return copy;
    });
    this.saveRead(next);
  }

  // 通知状态映射：不可证即不声称——除 unavailable/denied 外一律「无法确认」。
  // 不允许把任何查询结果映射回 granted/prompt（prompt 会被读成「待授权」，与真实原因不符）。
  private notificationStateOf(view: NotificationView): string {
    if (view.permission === 'unavailable') { return 'unavailable'; }
    if (view.permission === 'denied') { return 'denied'; }
    return 'unverified';
  }

  // 从平台读取真实权限状态：通知走发布探针交叉验证，后台/日历走 token 检查。
  private async refreshPermissionStates(): Promise<void> {
    const context = getContext(this);
    try {
      const permissions = new SystemPermissionService(context);
      const snapshot: PermissionSnapshot = await permissions.status();
      this.calendarStatus = snapshot.calendar;
    } catch (error) {}
    try {
      const view: NotificationView = await SystemIntegrationService.notificationView(context);
      this.permission = this.notificationStateOf(view);
    } catch (error) {}
  }

  // 权限入口：通知先真调系统授权，申请无效立刻转通知设置；日历弹系统授权；后台跳电池设置。
  private async openPermission(kind: string): Promise<void> {
    const context = getContext(this);
    try {
      if (kind === 'notification') {
        const applied: SystemActionView = await SystemIntegrationService.enableNotifications(context);
        // 入口取证：申请链路最终是否成功、停在哪个码，真机 hilog 可直接定位。
        console.info('permission-entry kind=notification entry=permission-card ok=' +
          (applied.ok ? 'on' : 'off') + ' code=' + applied.code);
        if (applied.ok) {
          this.permissionHintVisible = false;
        } else {
          // 真机不弹框/用户拒绝/系统不再弹框时，直接把用户送到通知设置，不允许「点了没反应」。
          const opened: SystemActionView = await SystemIntegrationService.openNotificationSettings(context);
          this.permissionHintVisible = !opened.ok;
        }
      } else if (kind === 'calendar') {
        const permissions = new SystemPermissionService(context);
        const result = await permissions.requestCalendar();
        this.permissionHintVisible = !result.granted;
      } else {
        const permissions = new SystemPermissionService(context);
        await permissions.openSystemSettings('battery');
        this.permissionHintVisible = false;
      }
    } catch (error) {
      this.permissionHintVisible = true;
    }
    await this.refreshPermissionStates();
  }

  // 静态版本日历网关：openSettings 会 reject CALENDAR_UNAVAILABLE，提示用户后续版本接入。
  private async openCalendarSettings(): Promise<void> {
    const gateway: CalendarGatewayUnavailable = new CalendarGatewayUnavailable();
    try {
      await gateway.openSettings();
      const status: CalendarStatus = await gateway.status();
      this.calendarStatus = status.available ? 'granted' : 'unavailable';
    } catch (error) {
      this.calendarStatus = 'unavailable';
      this.calendarHintVisible = true;
    }
  }

  private async toggleDemo(enabled: boolean): Promise<void> {
    this.demoSwitchFailed = false;
    try {
      await AppStateHost.setDemoMode(enabled);
    } catch (error) {
      this.demoSwitchFailed = true;
      // 保存失败时保留旧状态并给出可见提示，不能把失败的切换当成成功刷新。
      this.appState = AppStateHost.currentPretty();
      this.leaveRecords = this.leaveCache().records;
      return;
    }
    this.appState = AppStateHost.currentPretty();
    this.leaveRecords = this.leaveCache().records;
  }

  // 学校课表读取装配（页面只装配平台门面与映射状态；解析/网络细节在 platform 层）。
  private async readSchool(): Promise<void> {
    if (this.schoolBusy) { return; }
    if (AppStateHost.demoMode()) { return; }
    const token: number = this.schoolReadToken + 1;
    this.schoolReadToken = token;
    this.schoolBusy = true;
    this.schoolErrorCode = '';
    this.schoolProgressStage = 'session-check';
    const context: object = getContext(this);
    const gateway: NetworkHttpGateway = new NetworkHttpGateway();
    this.schoolGateway = gateway;
    try {
      const session: SchoolSession | null = await loadStoredSchoolSession(context);
      if (this.schoolReadToken !== token) { return; }
      if (session === null || !isSchoolSessionUsable(session)) {
        this.finishSchoolError('SCHOOL_LOGIN_REQUIRED');
        return;
      }
      // 学期名：优先沿用快照里的中文名，首读用资源兜底；读取成功后按开学周一再校正，避免显示学期号。
      const priorName: string = this.appState.snapshot === null ? '' : this.appState.snapshot.name;
      const semesterName: string = priorName.length > 0 ? priorName : schoolSemesterFallback(context);
      const reader: SchoolReaderImpl = new SchoolReaderImpl(
        gateway,
        new PlatformWebCookieStore(),
        createSchoolLexicon(context),
        schoolSourceLabel(context),
        semesterName,
        rowsFilterLabel(context)
      );
      const result: SchoolReadResult = await reader.read(session, (stage: string) => {
        // 回调不保证在 UI 线程：经 setTimeout 回主线程再改 @State；token 失效（取消/新一轮）后丢弃旧进度。
        setTimeout(() => {
          if (this.schoolReadToken === token) { this.schoolProgressStage = stage; }
        }, 0);
      });
      if (this.schoolReadToken !== token) { return; }
      const displayName: string = schoolSemesterDisplayName(context, result.snapshot.startDate, semesterName);
      if (displayName.length > 0) { result.snapshot.name = displayName; }
      const now: number = Date.now();
      const next: AppState = copyAppState(this.appState);
      next.snapshot = result.snapshot;
      next.lastSuccess = now;
      next.lastAttempt = now;
      next.error = null;
      // 快照落地前生成真实变更记录（read=false，供变更页未读红点使用）。
      const fresh: ChangeRecord[] = diffState(this.appState, next);
      next.changeRecords = applyChangeRecords(next, fresh).changeRecords;
      // demo 模式只内存展示，不覆盖真实课表（与 persistSettings 一致）。
      if (!AppStateHost.demoMode()) {
        await AppStateHost.save(next);
      }
      if (this.schoolReadToken !== token) { return; }
      this.appState = next;
      this.schoolState = 'ready';
      this.schoolLastSuccessAt = now;
      this.schoolLastAttemptAt = now;
      this.schoolBusy = false;
    } catch (error) {
      // 取消后 token 已递增：中性收敛，不写 snapshot/lastSuccess，也不再改错误态。
      if (this.schoolReadToken !== token) { return; }
      const code: string = error instanceof Error ? normalizeSchoolErrorCode(error) : 'ERROR_UNKNOWN';
      this.finishSchoolError(code);
    } finally {
      if (this.schoolGateway === gateway) { this.schoolGateway = null; }
    }
  }

  // 失败只更新 error/lastAttempt，保留旧 snapshot（§6.1：失败不覆盖旧课表）。
  private finishSchoolError(code: string): void {
    const now: number = Date.now();
    this.schoolBusy = false;
    this.schoolLastAttemptAt = now;
    this.schoolErrorCode = code;
    if (code === 'SCHOOL_LOGIN_REQUIRED' || code === 'SCHOOL_CAPTCHA_REQUIRED' || code === 'SCHOOL_SESSION_EXPIRED') {
      this.schoolState = 'expired';
    } else {
      this.schoolState = 'error';
    }
    // P1-1/P1-B：最终认证类错误（登录/验证码/会话过期）统一清掉本地学校会话与教务 cookie，
    // 避免下一轮继续拿死票；非认证类错误（网络/超时/解析/空课表）不清，保留已保存会话可重试。
    // 静默重登由编排器负责（SchoolReadOrchestrator.runWithRelogin，最多 1 次）；
    // 页面只负责「清理 + 置过期态 + 提供去登录」，不在这里再做重试，杜绝循环。
    if (code === 'SCHOOL_SESSION_EXPIRED' || code === 'SCHOOL_LOGIN_REQUIRED' || code === 'SCHOOL_CAPTCHA_REQUIRED') {
      this.clearSchoolSession();
    }
    const next: AppState = copyAppState(this.appState);
    next.lastAttempt = now;
    next.error = code;
    this.saveRead(next);
  }

  // 只清教务域：会话存储 + jiaowu 的 bzb_jsxsd，学工（xgxt）会话与假条缓存不动。
  private async clearSchoolSession(): Promise<void> {
    try {
      await new PlatformWebCookieStore().clearSchoolCookies();
    } catch (error) {
      // 清 cookie 失败不阻断错误态展示，下轮读取会再判定一次。
    }
    try {
      await clearStoredSchoolSession(getContext(this));
    } catch (error) {
      // 同上：清理失败只影响「已登录」提示，不影响错误展示。
    }
  }

  // 取消读取（P1-6）：先递增 token 让旧 Promise 的中性结果被丢弃，再中断在途 HTTP。
  private cancelSchoolRead(): void {
    this.schoolReadToken = this.schoolReadToken + 1;
    const gateway: NetworkHttpGateway | null = this.schoolGateway;
    this.schoolGateway = null;
    if (gateway !== null) {
      gateway.abortAll();
    }
    this.schoolBusy = false;
    this.schoolProgressStage = 'session-check';
  }

  private openSchoolLogin(): void {
    this.pathStack.pushPathByName('schoolLogin', null);
  }

  // 页面销毁时中断在途读取：token 失效 + 断开 HTTP，避免后台 Promise 继续跑（P1-6）。
  aboutToDisappear(): void {
    this.cancelSchoolRead();
  }

  private onSchoolLoginSuccess(): void {
    this.schoolState = 'ready';
    this.schoolErrorCode = '';
    this.readSchool();
  }

  // 自定义/调休写入口：页面只调用 feature 控制器，持久化与变更记录由控制器负责。
  private refreshCustomState(): void {
    this.appState = AppStateHost.currentPretty();
    this.leaveRecords = this.leaveCache().records;
  }

  private async saveCustomCourse(course: CustomCourse): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.saveCourse(course);
    this.refreshCustomState();
  }

  private async removeCustomCourse(id: string): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.removeCourse(id);
    this.refreshCustomState();
  }

  private async removeCustomMap(id: string): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.removeLocalMap(id);
    this.refreshCustomState();
  }

  private async removeCustomHoliday(date: string): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.removeHoliday(date);
    this.refreshCustomState();
  }

  private async saveCustomMap(rule: LocalMapRule): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.saveLocalMap(rule);
    this.refreshCustomState();
  }

  private async saveCustomHoliday(day: HolidayDay): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.addHoliday(day);
    this.refreshCustomState();
  }

  private async saveCustomOverride(item: DayOverride): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.saveOverride(item);
    this.refreshCustomState();
  }

  private async removeCustomOverride(id: string): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.removeOverride(id);
    this.refreshCustomState();
  }

  private async undoCustom(): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.undo();
    this.refreshCustomState();
  }

  private async redoCustom(): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.redo();
    this.refreshCustomState();
  }

  private async toggleEveningStudy(enabled: boolean): Promise<void> {
    if (AppStateHost.demoMode()) { return; }
    await this.customController.changeEveningStudy(enabled);
    this.refreshCustomState();
  }

  @Builder
  pageMap(name: string, param: object) {
    if (name === 'schoolLogin') {
      SchoolLoginPage({
        entryUrl: schoolSsoEntryUrl(),
        webAvailable: this.schoolWeb,
        onSuccess: () => { this.pathStack.pop(); this.onSchoolLoginSuccess(); },
        onCancel: () => { this.pathStack.pop(); },
        onWebError: (code: string) => {
          this.schoolErrorCode = code;
          this.schoolState = 'error';
          this.schoolLastAttemptAt = Date.now();
        }
      })
    } else if (name === 'leaveStatus') {
      LeaveStatusPage({ cache: this.leaveCache(), onBack: () => { this.pathStack.pop(); } })
    } else if (name === 'web') {
      WebOfficePage({ param: param as WebOfficeParam, onBack: () => { this.refreshLeaveFromHost(); this.pathStack.pop(); } })
    }
  }

  build() {
    Navigation(this.pathStack) {
      Tabs({ barPosition: BarPosition.End, index: this.activeTab }) {
        TabContent() {
          DayPage({ appState: this.appState, leaveRecords: this.leaveRecords, selectedDate: this.selectedDate,
            todayKey: this.todayKey, onDateChange: (d: string) => { this.selectedDate = d; },
            onOpenLeaveStatus: () => { this.pathStack.pushPathByName('leaveStatus', null); } })
        }.tabBar($r('app.string.tab_today'))
        TabContent() {
          WeekPage({ appState: this.appState, leaveRecords: this.leaveRecords, selectedWeek: this.selectedWeek,
            selectedDate: this.selectedDate, todayKey: this.todayKey,
            onWeekChange: (w: number) => { this.selectedWeek = w; }, onSelectDate: (d: string) => { this.selectedDate = d; } })
        }.tabBar($r('app.string.tab_full'))
        TabContent() {
          ChangesPage({ records: this.appState.changeRecords, todayKey: this.todayKey,
            onRead: (id: string) => { this.markChangeRead(id); }, onReadAll: () => { this.markAllChangeRead(); },
            onOpenDay: (date: string) => { this.selectedDate = date; this.activeTab = 0; } })
        }.tabBar($r('app.string.tab_changes'))
        TabContent() {
          Column() {
            Column() {
              SettingsPage({ appState: this.appState, settingsExpanded: this.appState.settingsExpanded,
                calendarStatus: this.calendarStatus, permission: this.permission, sourceMode: AppStateHost.demoMode() ? 'demo' : 'real',
                demoMode: AppStateHost.demoMode(),
                leaveCount: this.leaveRecords.filter((r: LeaveRecord) => r.status === 'pending').length,
                leaveRecords: this.leaveRecords,
                todayKey: this.todayKey,
                schoolState: this.schoolState,
                schoolLastSuccessAt: this.schoolLastSuccessAt,
                schoolLastAttemptAt: this.schoolLastAttemptAt,
                schoolBusy: this.schoolBusy,
                schoolProgressText: schoolProgressText(this.schoolProgressStage),
                schoolErrorCode: this.schoolErrorCode,
                schoolCanLogin: this.schoolWeb,
                onSchoolLogin: () => { this.openSchoolLogin(); },
                onSchoolRead: () => { this.readSchool(); },
                onSchoolCancel: () => { this.cancelSchoolRead(); },
                customCanUndo: this.customController.canUndoNow(),
                customCanRedo: this.customController.canRedoNow(),
                onSaveCustomCourse: (course: CustomCourse) => this.saveCustomCourse(course),
                onDeleteCustomCourse: (id: string) => this.removeCustomCourse(id),
                onDeleteCustomMap: (id: string) => this.removeCustomMap(id),
                onDeleteCustomHoliday: (date: string) => this.removeCustomHoliday(date),
                onSaveCustomMap: (rule: LocalMapRule) => this.saveCustomMap(rule),
                onSaveCustomHoliday: (day: HolidayDay) => this.saveCustomHoliday(day),
                onSaveCustomOverride: (item: DayOverride) => this.saveCustomOverride(item),
                onDeleteCustomOverride: (id: string) => this.removeCustomOverride(id),
                onUndoCustom: () => this.undoCustom(),
                onRedoCustom: () => this.redoCustom(),
                onToggleEveningStudy: (on: boolean) => this.toggleEveningStudy(on),
                isAllExpanded: this.appState.settingsExpanded.auto && this.appState.settingsExpanded.display && this.appState.settingsExpanded.leave && this.appState.settingsExpanded.course && this.appState.settingsExpanded.data && this.appState.settingsExpanded.about,
                onToggleGroup: (id) => { this.persistSettings(toggleSettingsGroup(this.appState.settingsExpanded, id)); },
                onExpandAll: () => { this.persistSettings(expandAllSettingsGroups()); },
                onCollapseAll: () => { this.persistSettings(collapseAllSettingsGroups()); },
                onOpenLeaveStatus: () => { this.pathStack.pushPathByName('leaveStatus', null); },
                onToggleDemo: (on: boolean) => { this.toggleDemo(on); },
                onSync: () => { this.leaveRecords = this.leaveCache().records; },
                onOpenWeb: (key: string) => {
                  if (key === 'portal') { this.pathStack.pushPathByName('web', buildPortalWebParam()); }
                  else if (key === 'mobile') { this.pathStack.pushPathByName('web', buildMobileWebParam()); }
                  else { this.pathStack.pushPathByName('web', buildWebOfficeParam(key as 'leave' | 'cancel' | 'renew')); }
                },
                onOpenCalendarSettings: () => { this.openCalendarSettings(); },
                onOpenPermission: (kind: string) => { this.openPermission(kind); },
                onApplyRestoredState: (next: AppState) => this.applyRestoredState(next),
                demoSwitchFailed: this.demoSwitchFailed })
            }.width('100%').layoutWeight(1)
            if (this.permissionHintVisible) {
              Text($r('app.string.permission_unavailable_hint')).fontSize($r('app.float.float_font_12'))
                .fontColor($r('app.color.color_text_secondary')).width('100%')
                .padding({ left: $r('app.float.float_page_padding'), right: $r('app.float.float_page_padding'), top: $r('app.float.float_space_8'), bottom: $r('app.float.float_space_8') })
                .backgroundColor($r('app.color.color_surface'))
            }
            if (this.calendarHintVisible) {
              Text($r('app.string.calendar_unavailable_hint')).fontSize($r('app.float.float_font_12'))
                .fontColor($r('app.color.color_text_secondary')).width('100%')
                .padding({ left: $r('app.float.float_page_padding'), right: $r('app.float.float_page_padding'), top: $r('app.float.float_space_8'), bottom: $r('app.float.float_space_8') })
                .backgroundColor($r('app.color.color_surface'))
            }
          }.width('100%').height('100%')
        }.tabBar($r('app.string.tab_settings'))
      }.width('100%').height('100%').onChange((index: number) => { this.activeTab = index; })
    }
    .navDestination(this.pageMap)
    .mode(NavigationMode.Stack)
    .hideTitleBar(true)
    .width('100%').height('100%')
  }
}


