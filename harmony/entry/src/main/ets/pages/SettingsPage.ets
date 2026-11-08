// 职责：设置页六组真实 SettingsGroup；状态/权限/课表数据全部由 Index 注入。
// 依赖：pages -> components/core viewmodel；不直接访问 AppStateHost/Kit。
// 阶段：P3 B1；待确认：ArkUI Button 内 BuilderParam 与无障碍语义。
// 新增 string 键：settings_hint_card_title
import { SettingsGroup } from '../components/SettingsGroup';
import { SettingsHintCard } from '../components/SettingsHintCard';
import { CalendarCard } from '../components/CalendarCard';
import { PermissionCard } from '../components/PermissionCard';
import { LeaveServiceCard } from '../components/LeaveServiceCard';
import { DataSyncCard } from '../components/DataSyncCard';
import { AboutCard } from '../components/AboutCard';
import { SchoolAccountCard, schoolAbsoluteText, schoolErrorText } from '../components/SchoolAccountCard';
import type { SchoolAccountState } from '../components/SchoolAccountCard';
import { WebDataClearCard } from '../components/WebDataClearCard';
import { CustomSchedulePanel } from '../features/custom/CustomSchedulePanel';
import { CustomCourseSheet } from '../features/custom/CustomCourseSheet';
import { TodayOverviewCard } from '../features/custom/TodayOverviewCard';
import { SystemIntegrationCard } from '../features/system/SystemIntegrationCard';
import { ExportPanel } from '../features/export/ExportPanel';
import { buildExportCopy } from '../features/export/ExportCopyKeys';
import { createExportFilePorts, unavailableExportFilePorts } from '../features/files/ExportFilePorts';
import type { ExportFilePortSet } from '../features/files/ExportFilePorts';
import type { ExportCopy } from '../core/export/ExportCopy';
import type { DiagnosticsSnapshot, PermissionState } from '../core/types/Common';
import type { LeaveRecord } from '../core/types/Leave';
import { defaultSettingsExpanded } from '../core/viewmodel/SettingsViewModel';
import type { SettingsGroupId } from '../core/viewmodel/SettingsViewModel';
import type { AppState, CustomCourse, DayOverride, HolidayDay, LocalMapRule, SettingsExpanded } from '../core/types/AppState';
import { createDefaultState } from '../core/types/AppState';
import { resolveDay } from '../core/timetable/TimetableCore';
import { redactText } from '../util/Redactor';
import { officeWebCapability } from '../platform/web/OfficeWebView';
import { AppStateHost } from '../platform/app/AppStateHost';

// 与 platform/school/ParserLexiconFactory 同一模式：页面只持 object，避免依赖 @kit 的 Context 类型。
interface ExportTextManager {
  getStringByNameSync(name: string): string;
}

interface ExportTextContext {
  resourceManager: ExportTextManager;
}

function readExportText(context: object, key: string): string {
  const typed: ExportTextContext = context as ExportTextContext;
  // 缺键兜底：getStringByNameSync 对不存在的资源名会抛错；返回空串可避免
  // aboutToAppear 中断，也避免 CanvasLayout.ets:636 对 notice 取 .length 时拿到非字符串。
  // 不伪造文案：缺失的导出文案留白，布局与导出流程继续。
  try {
    return typed.resourceManager.getStringByNameSync(key);
  } catch (error) {
    return '';
  }
}

@Component
export struct SettingsPage {
  @Prop @Watch('refreshExportDiagnostics') appState: AppState = createDefaultState();
  @Prop settingsExpanded: SettingsExpanded = defaultSettingsExpanded();
  @Prop calendarStatus: string = 'unavailable';
  @Prop permission: string = 'unavailable';
  @Prop sourceMode: string = 'real';
  @Prop demoMode: boolean = false;
  @Prop demoSwitchFailed: boolean = false;
  @Prop leaveCount: number = 0;
  @Prop leaveRecords: LeaveRecord[] = [];
  @Prop todayKey: string = '';
  @Prop schoolState: SchoolAccountState = 'unbound';
  @Prop schoolLastSuccessAt: number = 0;
  @Prop schoolLastAttemptAt: number = 0;
  @Prop schoolBusy: boolean = false;
  @Prop schoolProgressText: ResourceStr = '';
  @Prop schoolErrorCode: string = '';
  @Prop schoolCanLogin: boolean = false;
  @Prop customCanUndo: boolean = false;
  @Prop customCanRedo: boolean = false;
  // 教务卡只看网络能力（spec §6.1:497）。P4 静态版本没有真实网络网关，固定 granted；
  // 真机接入系统网络网关 platform/network/HttpGateway 后由网关状态驱动（HttpGatewayUnavailable 仅降级实现，不代表教务不可用）。
  @Prop schoolNetworkPermission: PermissionState = 'granted';
  onSchoolLogin: () => void = () => {};
  onSchoolRead: () => void = () => {};
  onSchoolCancel: () => void = () => {};
  onToggleGroup: (id: SettingsGroupId) => void = () => {};
  onExpandAll: () => void = () => {};
  onCollapseAll: () => void = () => {};
  onOpenWeb: (key: string) => void = () => {};
  onOpenLeaveStatus: () => void = () => {};
  onToggleDemo: (on: boolean) => void = () => {};
  onSync: () => void = () => {};
  onOpenCalendarSettings: () => void = () => {};
  onOpenPermission: (kind: string) => void = () => {};
  onOpenAgreement: () => void = () => {};
  onSaveCustomCourse: (course: CustomCourse) => Promise<void> = async () => {};
  onDeleteCustomCourse: (id: string) => Promise<void> = async () => {};
  onDeleteCustomMap: (id: string) => Promise<void> = async () => {};
  onDeleteCustomHoliday: (date: string) => Promise<void> = async () => {};
  onSaveCustomMap: (rule: LocalMapRule) => Promise<void> = async () => {};
  onSaveCustomHoliday: (day: HolidayDay) => Promise<void> = async () => {};
  onSaveCustomOverride: (item: DayOverride) => Promise<void> = async () => {};
  onDeleteCustomOverride: (id: string) => Promise<void> = async () => {};
  onUndoCustom: () => Promise<void> = async () => {};
  onRedoCustom: () => Promise<void> = async () => {};
  onToggleEveningStudy: (enabled: boolean) => Promise<void> = async () => {};
  onApplyRestoredState: (next: AppState) => Promise<boolean> = async () => false;
  @Prop isAllExpanded: boolean = false;
  @State customPanelVisible: boolean = false;
  @State customSheetVisible: boolean = false;
  @State customEditing: CustomCourse | null = null;
  @State appVersionName: string = '';
  @State appVersionCode: number = 0;
  @State exportCopy: ExportCopy = buildExportCopy((key: string): string => '');
  @State diagnostics: DiagnosticsSnapshot = { appVersion: '', systemVersion: '', apiVersion: 0, stateRevision: 0, lastSyncAt: 0, errors: [] };
  // 先用降级端口占位，aboutToAppear 里换成的真实端口；页面只传 object，不 import Kit。
  private exportPorts: ExportFilePortSet = unavailableExportFilePorts();

  aboutToAppear(): void {
    // 版本号来自应用包信息（app.json5），缺失时为空串，由关于卡隐藏版本行。
    this.appVersionName = AppStateHost.appVersionName();
    this.appVersionCode = AppStateHost.appVersionCode();
    this.exportCopy = buildExportCopy((key: string): string => readExportText(getContext(this), key));
    this.exportPorts = createExportFilePorts(getContext(this));
    this.diagnostics = this.buildDiagnostics();
  }

  private refreshExportDiagnostics(): void {
    this.diagnostics = this.buildDiagnostics();
  }

  private buildDiagnostics(): DiagnosticsSnapshot {
    const errors: string[] = [];
    if (this.appState.error !== null) { errors.push(this.appState.error); }
    return {
      appVersion: this.appVersionName,
      systemVersion: '',
      apiVersion: 0,
      stateRevision: this.appState._revision === undefined ? 0 : this.appState._revision,
      lastSyncAt: this.appState.lastSuccess,
      errors: errors
    };
  }

  private async submitCustom(course: CustomCourse): Promise<void> {
    try {
      await this.onSaveCustomCourse(course);
      this.customSheetVisible = false;
      this.customEditing = null;
    } catch (error) {}
  }

  private async deleteCustomFromSheet(id: string): Promise<void> {
    try {
      await this.onDeleteCustomCourse(id);
      this.customSheetVisible = false;
      this.customEditing = null;
    } catch (error) {}
  }

  private async deleteCustomCourse(id: string): Promise<void> {
    try { await this.onDeleteCustomCourse(id); } catch (error) {}
  }

  private async deleteCustomMap(id: string): Promise<void> {
    try { await this.onDeleteCustomMap(id); } catch (error) {}
  }

  private async deleteCustomHoliday(date: string): Promise<void> {
    try { await this.onDeleteCustomHoliday(date); } catch (error) {}
  }

  private async submitCustomMap(rule: LocalMapRule): Promise<void> {
    try { await this.onSaveCustomMap(rule); } catch (error) {}
  }

  private async submitCustomHoliday(day: HolidayDay): Promise<void> {
    try { await this.onSaveCustomHoliday(day); } catch (error) {}
  }

  private async submitCustomOverride(item: DayOverride): Promise<void> {
    try { await this.onSaveCustomOverride(item); } catch (error) {}
  }

  private async deleteCustomOverride(id: string): Promise<void> {
    try { await this.onDeleteCustomOverride(id); } catch (error) {}
  }

  private async undoCustom(): Promise<void> {
    try { await this.onUndoCustom(); } catch (error) {}
  }

  private async redoCustom(): Promise<void> {
    try { await this.onRedoCustom(); } catch (error) {}
  }

  private toggleEvening(enabled: boolean): void {
    this.onToggleEveningStudy(enabled).catch(() => {});
  }

  // 「读取学校课表」就近反馈：示例模式/读取中/登录缺失/其它错误都要有可见文案。
  // 未登录必须落到 SCHOOL_LOGIN_REQUIRED，并显示已合入的 school_login_required_hint。
  private schoolReadStatus(): ResourceStr {
    if (this.demoMode) {
      return $r('app.string.school_demo_disabled');
    }
    if (this.schoolBusy) {
      return $r('app.string.school_status_checking');
    }
    if (this.schoolErrorCode === 'SCHOOL_LOGIN_REQUIRED') {
      return $r('app.string.school_login_required_hint');
    }
    if (this.schoolErrorCode !== '') {
      return schoolErrorText(this.schoolErrorCode);
    }
    return '';
  }

  @Builder autoBody() { SettingsHintCard({ text: $r('app.string.settings_auto_hint') }) }
  @Builder displayBody() { SettingsHintCard({ text: $r('app.string.settings_display_hint') }) }
  @Builder leaveBody() {
    Column({ space: $r('app.float.float_space_16') }) {
      LeaveServiceCard({ webAvailable: officeWebCapability().available, leaveCount: this.leaveCount, statusText: $r('app.string.leave_card_title'), unavailableHint: $r('app.string.permission_unavailable_hint'), onOpen: (key: string) => { this.onOpenWeb(key); } })
      Button($r('app.string.leave_status_title')).height($r('app.float.float_touch_min')).width('100%').onClick(() => { this.onOpenLeaveStatus(); })
      SettingsHintCard({ text: $r('app.string.settings_leave_phase4') })
    }.width('100%')
  }
  @Builder courseBody() {
    Column({ space: $r('app.float.float_space_16') }) {
      PermissionCard({ notificationState: this.permission, backgroundState: this.permission, calendarState: this.calendarStatus, onOpenNotification: () => { this.onOpenPermission('notification'); }, onOpenBackground: () => { this.onOpenPermission('background'); }, onOpenCalendar: () => { this.onOpenPermission('calendar'); } })
      Row() {
        Text($r('app.string.settings_course_study')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_primary'))
        Blank()
        Toggle({ type: ToggleType.Switch, isOn: this.appState.courseSettings.showEveningStudy })
          .selectedColor($r('app.color.color_accent_button'))
          .enabled(!this.demoMode)
          .onChange((isOn: boolean) => { this.toggleEvening(isOn); })
      }.width('100%')
      Button($r('app.string.settings_course_custom'))
        .height($r('app.float.float_touch_min'))
        .width('100%')
        .enabled(!this.demoMode)
        .onClick(() => { this.customPanelVisible = !this.customPanelVisible; })
      if (this.customPanelVisible) {
        TodayOverviewCard({ state: this.appState, leaveRecords: this.leaveRecords, todayKey: this.todayKey, onOpenLeave: () => { this.onOpenLeaveStatus(); } })
        CustomSchedulePanel({
          state: this.appState,
          canUndo: this.customCanUndo,
          canRedo: this.customCanRedo,
          onAdd: () => { this.customEditing = null; this.customSheetVisible = true; },
          onEdit: (course: CustomCourse) => { this.customEditing = course; this.customSheetVisible = true; },
          onDeleteCourse: (id: string) => { this.deleteCustomCourse(id); },
          onDeleteMap: (id: string) => { this.deleteCustomMap(id); },
          onDeleteHoliday: (date: string) => { this.deleteCustomHoliday(date); },
          onSubmitMap: (rule: LocalMapRule) => { this.submitCustomMap(rule); },
          onSubmitHoliday: (day: HolidayDay) => { this.submitCustomHoliday(day); },
          onSubmitOverride: (item: DayOverride) => { this.submitCustomOverride(item); },
          onDeleteOverride: (id: string) => { this.deleteCustomOverride(id); },
          onUndo: () => { this.undoCustom(); },
          onRedo: () => { this.redoCustom(); }
        })
      }
      if (this.customSheetVisible) {
        CustomCourseSheet({
          state: this.appState,
          editing: this.customEditing,
          onSubmit: (course: CustomCourse) => { this.submitCustom(course); },
          onDelete: (id: string) => { this.deleteCustomFromSheet(id); },
          onClose: () => { this.customSheetVisible = false; this.customEditing = null; }
        })
      }
      SettingsHintCard({ text: $r('app.string.settings_course_hint') })
    }.width('100%')
  }
  @Builder dataBody() {
    Column({ space: $r('app.float.float_space_16') }) {
      SchoolAccountCard({
        state: this.schoolState,
        permission: this.schoolNetworkPermission,
        lastSuccessAt: this.schoolLastSuccessAt,
        lastAttemptAt: this.schoolLastAttemptAt,
        busy: this.schoolBusy,
        progressText: this.schoolProgressText,
        errorCode: this.schoolErrorCode,
        canLogin: this.schoolCanLogin,
        demoMode: this.demoMode,
        onLogin: () => { this.onSchoolLogin(); },
        onRead: () => { this.onSchoolRead(); },
        onCancel: () => { this.onSchoolCancel(); }
      })
      CalendarCard({ actionsEnabled: this.calendarStatus === 'granted', status: this.calendarStatus,
        lastSyncText: this.calendarStatus === 'unavailable' ? $r('app.string.calendar_last_sync_unsupported') : $r('app.string.calendar_last_sync_none'), onWrite: () => { this.onOpenCalendarSettings(); }, onRemove: () => { this.onOpenCalendarSettings(); }, onOpenCalendar: () => { this.onOpenCalendarSettings(); }, onOpenPermissionHelp: () => { this.onOpenPermission('calendar'); } })
      SystemIntegrationCard({ state: this.appState })
      DataSyncCard({
        sourceText: '',
        lastSuccessText: this.schoolLastSuccessAt > 0 ? schoolAbsoluteText(this.schoolLastSuccessAt) : '',
        mode: this.sourceMode,
        sourceLabel: this.sourceMode,
        reading: this.schoolBusy || this.demoMode,
        busy: this.schoolBusy,
        statusText: this.schoolReadStatus(),
        statusError: this.schoolErrorCode !== '',
        onModeChange: (mode: string) => { this.onToggleDemo(mode === 'demo'); },
        onSync: () => { this.onSync(); },
        onPortal: () => { this.onOpenWeb('portal'); },
        onMobile: () => { this.onOpenWeb('mobile'); },
        onSchoolLogin: () => { this.onSchoolLogin(); },
        schoolLoginRequired: this.schoolErrorCode === 'SCHOOL_LOGIN_REQUIRED',
        onRead: () => { this.onSchoolRead(); }
      })
      WebDataClearCard()
      if (this.demoSwitchFailed) {
        Text($r('app.string.system_error_generic')).fontSize($r('app.float.float_font_12'))
          .fontColor($r('app.color.color_danger')).width('100%')
          .accessibilityText($r('app.string.system_error_generic'))
      }
      ExportPanel({
        state: this.appState,
        copy: this.exportCopy,
        diagnostics: this.diagnostics,
        appVersion: this.appVersionName,
        logLines: [],
        logSources: [],
        resolve: (dateKey: string) => resolveDay(this.appState, dateKey),
        saver: this.exportPorts.saver,
        picker: this.exportPorts.picker,
        redact: (line: string) => redactText(line),
        onApplyState: (next: AppState) => this.onApplyRestoredState(next)
      })
    }.width('100%')
  }
  @Builder aboutBody() {
    AboutCard({ versionName: this.appVersionName, versionCode: this.appVersionCode, privacySummary: $r('app.string.privacy_summary'), onOpenAgreement: () => { this.onOpenAgreement(); }, onOpenSource: () => { this.onOpenAgreement(); }, onVersion: () => { this.onOpenAgreement(); } })
  }

  build() {
    Scroll() {
      Column({ space: $r('app.float.float_space_12') }) {
        Text($r('app.string.settings_title')).fontSize($r('app.float.float_font_24')).fontColor($r('app.color.color_text_primary')).width('100%')
        Text($r('app.string.settings_intro')).fontSize($r('app.float.float_font_13')).fontColor($r('app.color.color_text_secondary')).width('100%')
        Button(this.isAllExpanded ? $r('app.string.settings_collapse_all') : $r('app.string.settings_expand_all')).height($r('app.float.float_touch_min')).width('100%').fontSize($r('app.float.float_font_12')).onClick(() => { if (this.isAllExpanded) { this.onCollapseAll(); } else { this.onExpandAll(); } })
        Column({ space: $r('app.float.float_space_24') }) {
          SettingsGroup({ groupId: 'auto', order: 1, title: $r('app.string.settings_group_auto'), summary: $r('app.string.settings_summary_auto'), expanded: this.settingsExpanded.auto, onToggle: this.onToggleGroup, content: () => { this.autoBody() } })
          SettingsGroup({ groupId: 'display', order: 2, title: $r('app.string.settings_group_display'), summary: $r('app.string.settings_summary_display'), expanded: this.settingsExpanded.display, onToggle: this.onToggleGroup, content: () => { this.displayBody() } })
          SettingsGroup({ groupId: 'leave', order: 3, title: $r('app.string.settings_group_leave'), summary: $r('app.string.settings_summary_leave'), expanded: this.settingsExpanded.leave, onToggle: this.onToggleGroup, content: () => { this.leaveBody() } })
          SettingsGroup({ groupId: 'course', order: 4, title: $r('app.string.settings_group_course'), summary: $r('app.string.settings_summary_course'), expanded: this.settingsExpanded.course, onToggle: this.onToggleGroup, content: () => { this.courseBody() } })
          SettingsGroup({ groupId: 'data', order: 5, title: $r('app.string.settings_group_data'), summary: $r('app.string.settings_summary_data'), expanded: this.settingsExpanded.data, onToggle: this.onToggleGroup, content: () => { this.dataBody() } })
          SettingsGroup({ groupId: 'about', order: 6, title: $r('app.string.settings_group_about'), summary: $r('app.string.settings_summary_about'), expanded: this.settingsExpanded.about, onToggle: this.onToggleGroup, content: () => { this.aboutBody() } })
        }.width('100%')
        Blank().width('100%').height($r('app.float.float_bottom_nav'))
      }.width('100%').padding($r('app.float.float_page_padding')).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').backgroundColor($r('app.color.color_background'))
  }
}





