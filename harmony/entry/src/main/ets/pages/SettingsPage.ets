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
import { defaultSettingsExpanded } from '../core/viewmodel/SettingsViewModel';
import type { SettingsGroupId } from '../core/viewmodel/SettingsViewModel';
import type { AppState, SettingsExpanded } from '../core/types/AppState';
import { createDefaultState } from '../core/types/AppState';
import { officeWebCapability } from '../platform/web/OfficeWebView';

const APP_VERSION_NAME: string = '1.0.0';
const APP_VERSION_CODE: number = 1;

@Component
export struct SettingsPage {
  @Prop appState: AppState = createDefaultState();
  @Prop settingsExpanded: SettingsExpanded = defaultSettingsExpanded();
  @Prop calendarStatus: string = 'unavailable';
  @Prop permission: string = 'unavailable';
  @Prop sourceMode: string = 'real';
  @Prop leaveCount: number = 0;
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
  isAllExpanded: boolean = false;

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
      SettingsHintCard({ text: $r('app.string.settings_course_hint') })
    }.width('100%')
  }
  @Builder dataBody() {
    Column({ space: $r('app.float.float_space_16') }) {
      CalendarCard({ enabled: this.calendarStatus === 'granted', status: this.calendarStatus,
        lastSyncText: this.calendarStatus === 'unavailable' ? $r('app.string.calendar_last_sync_unsupported') : $r('app.string.calendar_last_sync_none'), onWrite: () => { this.onOpenCalendarSettings(); }, onRemove: () => { this.onOpenCalendarSettings(); }, onOpenCalendar: () => { this.onOpenCalendarSettings(); }, onOpenPermissionHelp: () => { this.onOpenPermission('calendar'); } })
      DataSyncCard({ sourceText: '', lastSuccessText: '', mode: this.sourceMode, sourceLabel: this.sourceMode, busy: false, onModeChange: (mode: string) => { this.onToggleDemo(mode === 'demo'); }, onSync: () => { this.onSync(); }, onPortal: () => { this.onOpenWeb('portal'); }, onMobile: () => { this.onOpenWeb('mobile'); }, onRead: () => { this.onSync(); } })
    }.width('100%')
  }
  @Builder aboutBody() {
    AboutCard({ versionName: APP_VERSION_NAME, versionCode: APP_VERSION_CODE, privacySummary: $r('app.string.privacy_summary'), onOpenAgreement: () => { this.onOpenAgreement(); }, onOpenSource: () => { this.onOpenAgreement(); }, onVersion: () => { this.onOpenAgreement(); } })
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
      }.width('100%').padding($r('app.float.float_page_padding')).alignItems(HorizontalAlign.Start)
    }.width('100%').height('100%').backgroundColor($r('app.color.color_background'))
  }
}







