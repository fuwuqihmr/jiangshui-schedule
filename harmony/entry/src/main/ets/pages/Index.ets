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
import { createDefaultState } from '../core/types/AppState';
import type { AppState, ChangeRecord, SettingsExpanded } from '../core/types/AppState';
import type { LeaveRecord, LeaveStatusCache } from '../core/types/Leave';
import { emptyLeaveStatus } from '../core/types/Leave';
import type { WebOfficeParam } from '../core/viewmodel/WebEntryViewModel';
import { buildWebOfficeParam, buildPortalWebParam, buildMobileWebParam } from '../core/viewmodel/WebEntryViewModel';
import { AppStateHost } from '../platform/app/AppStateHost';
import { PermissionServiceUnavailable } from '../platform/permission/PermissionServiceUnavailable';
import { CalendarGatewayUnavailable } from '../platform/calendar/CalendarGateway';
import type { PermissionSnapshot } from '../core/types/Common';
import type { CalendarStatus } from '../core/types/Calendar';
import { toggleSettingsGroup, expandAllSettingsGroups, collapseAllSettingsGroups } from '../core/viewmodel/SettingsViewModel';
import { weekOf } from '../core/timetable/TimetableCore';

function todayDateKey(): string {
  const now: Date = new Date();
  const month: string = (now.getMonth() + 1).toString().padStart(2, '0');
  const day: string = now.getDate().toString().padStart(2, '0');
  return now.getFullYear().toString() + '-' + month + '-' + day;
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
  @State permission: string = 'prompt';
  @State calendarStatus: string = 'unavailable';
  @State permissionHintVisible: boolean = false;
  @State calendarHintVisible: boolean = false;

  async aboutToAppear(): Promise<void> {
    AppStateHost.initialize(getContext(this));
    try { await AppStateHost.load(); } catch (error) { this.appState = createDefaultState(); }
    this.appState = AppStateHost.currentPretty();
    this.selectedDate = this.todayKey;
    this.selectedWeek = this.appState.semester === null ? 1 : Math.max(1, weekOf(this.appState.semester, this.todayKey));
    this.leaveRecords = this.leaveCache().records;
  }

  private leaveCache(): LeaveStatusCache {
    const raw: object | undefined = this.appState.leaveStatus;
    if (raw === undefined || raw === null) { return emptyLeaveStatus(''); }
    return raw as LeaveStatusCache;
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

  private mapPermission(snapshot: PermissionSnapshot): string {
    if (snapshot.calendar === 'unavailable' && snapshot.notification === 'unavailable') { return 'unavailable'; }
    if (snapshot.calendar === 'granted' || snapshot.notification === 'granted') { return 'granted'; }
    return 'denied';
  }

  // 静态版本权限服务：status 可读，request* 一律 reject；入口用于展示真实降级态。
  private async openPermission(kind: string): Promise<void> {
    const service: PermissionServiceUnavailable = new PermissionServiceUnavailable();
    try {
      const snapshot: PermissionSnapshot = await service.status();
      this.permission = this.mapPermission(snapshot);
      if (kind === 'notification') { await service.requestNotification(); } else { await service.requestCalendar(); }
      this.permissionHintVisible = false;
    } catch (error) {
      this.permissionHintVisible = true;
    }
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
    try { await AppStateHost.setDemoMode(enabled); } catch (error) {}
    this.appState = AppStateHost.currentPretty();
    this.leaveRecords = this.leaveCache().records;
  }

  @Builder
  pageMap(name: string, param: object) {
    if (name === 'leaveStatus') {
      LeaveStatusPage({ cache: this.leaveCache(), onBack: () => { this.pathStack.pop(); } })
    } else if (name === 'web') {
      WebOfficePage({ param: param as WebOfficeParam, onBack: () => { this.pathStack.pop(); } })
    }
  }

  build() {
    Navigation(this.pathStack) {
      Tabs({ barPosition: BarPosition.End }) {
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
                leaveCount: this.leaveRecords.filter((r: LeaveRecord) => r.status === 'pending').length,
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
                onOpenPermission: (kind: string) => { this.openPermission(kind); } })
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


