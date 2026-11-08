// 职责：Calendar Kit 日历写入网关（platform 适配层），实现 CalendarGateway 契约。
// 依赖方向：platform -> core（类型与纯逻辑）；页面只经 features/system 调用。
// 阶段：P6 系统日历；按 description 里的稳定 key 先删过期再补新增，重复同步幂等。
// 已知限制：identifier 字段不可由第三方设置，因此幂等键写在 description 前缀（jiangshui:<key>|teacher）。

import { calendarManager } from '@kit.CalendarKit';
import { abilityAccessCtrl } from '@kit.AbilityKit';
import type { common, Permissions } from '@kit.AbilityKit';
import type { CalendarEvent, CalendarGateway, CalendarStatus, CalendarSyncRequest, CalendarSyncResult } from '../../core/types/Calendar';
import { ErrorCode } from '../../core/types/Common';
import { diffCalendarKeys, keyFromDescription } from '../../core/system/CalendarPlanner';

const READ_CALENDAR: Permissions = 'ohos.permission.READ_CALENDAR';
const WRITE_CALENDAR: Permissions = 'ohos.permission.WRITE_CALENDAR';
const SETTINGS_BUNDLE = 'com.huawei.hmos.settings';
const SETTINGS_ABILITY = 'com.huawei.hmos.settings.MainAbility';
const SEARCH_START = 946684800000;
const SEARCH_END = 4102444800000;

export class CalendarKitGateway implements CalendarGateway {
  private context: common.UIAbilityContext;

  constructor(context: object) {
    this.context = context as common.UIAbilityContext;
  }

  private hasCalendarPermission(): boolean {
    try {
      const manager = abilityAccessCtrl.createAtManager();
      const tokenId = this.context.applicationInfo.accessTokenId;
      const read = manager.checkAccessTokenSync(tokenId, READ_CALENDAR);
      const write = manager.checkAccessTokenSync(tokenId, WRITE_CALENDAR);
      return read === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED
        && write === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED;
    } catch (error) {
      return false;
    }
  }

  private async ensurePermission(): Promise<boolean> {
    if (this.hasCalendarPermission()) {
      return true;
    }
    try {
      const manager = abilityAccessCtrl.createAtManager();
      const result = await manager.requestPermissionsFromUser(this.context, [READ_CALENDAR, WRITE_CALENDAR]);
      return result.authResults.length >= 2 && result.authResults[0] === 0 && result.authResults[1] === 0;
    } catch (error) {
      return false;
    }
  }

  private openCalendar(): Promise<calendarManager.Calendar> {
    const manager = calendarManager.getCalendarManager(this.context);
    return manager.getCalendar();
  }

  private toSystemEvent(event: CalendarEvent): calendarManager.Event {
    const location: calendarManager.Location = { location: event.location };
    const value: calendarManager.Event = {
      type: calendarManager.EventType.NORMAL,
      title: event.title,
      startTime: event.startMillis,
      endTime: event.endMillis,
      description: event.description,
      location: location
    };
    return value;
  }

  private async readExisting(calendar: calendarManager.Calendar): Promise<calendarManager.Event[]> {
    const keys: (keyof calendarManager.Event)[] = ['id', 'title', 'description', 'startTime', 'endTime'];
    const filter = calendarManager.EventFilter.filterByTime(SEARCH_START, SEARCH_END);
    const all = await calendar.getEvents(filter, keys);
    const mine: calendarManager.Event[] = [];
    for (let i = 0; i < all.length; i++) {
      const rawDescription: string | undefined = all[i].description;
      const description: string = typeof rawDescription === 'string' ? rawDescription : '';
      if (keyFromDescription(description) !== '') {
        mine.push(all[i]);
      }
    }
    return mine;
  }

  private async apply(events: CalendarEvent[]): Promise<CalendarSyncResult> {
    const value: CalendarSyncResult = {
      ok: false,
      written: 0,
      deleted: 0,
      failed: 0,
      skipped: events.length,
      calendarId: '',
      lastSyncAt: 0,
      lastEventCount: 0
    };
    if (!(await this.ensurePermission())) {
      return value;
    }
    let calendar: calendarManager.Calendar;
    try {
      calendar = await this.openCalendar();
    } catch (error) {
      return value;
    }
    let existing: calendarManager.Event[] = [];
    try {
      existing = await this.readExisting(calendar);
    } catch (error) {
      return value;
    }
    const existingKeys: string[] = [];
    const idByKey = new Map<string, number>();
    for (let i = 0; i < existing.length; i++) {
      const rawExisting: string | undefined = existing[i].description;
      const existingDescription: string = typeof rawExisting === 'string' ? rawExisting : '';
      const key = keyFromDescription(existingDescription);
      const id = existing[i].id;
      if (key !== '' && typeof id === 'number' && !idByKey.has(key)) {
        existingKeys.push(key);
        idByKey.set(key, id);
      }
    }
    const diff = diffCalendarKeys(events, existingKeys);
    const toAdd: calendarManager.Event[] = [];
    for (let i = 0; i < diff.add.length; i++) {
      toAdd.push(this.toSystemEvent(diff.add[i]));
    }
    let written = 0;
    let failed = 0;
    let deleted = 0;
    if (toAdd.length > 0) {
      try {
        await calendar.addEvents(toAdd);
        written = toAdd.length;
      } catch (error) {
        failed += toAdd.length;
      }
    }
    for (let i = 0; i < diff.removeKeys.length; i++) {
      const id = idByKey.get(diff.removeKeys[i]);
      if (typeof id !== 'number') {
        failed++;
        continue;
      }
      try {
        await calendar.deleteEvent(id);
        deleted++;
      } catch (error) {
        failed++;
      }
    }
    value.ok = failed === 0;
    value.written = written;
    value.deleted = deleted;
    value.failed = failed;
    value.skipped = diff.keep;
    value.lastEventCount = events.length;
    value.lastSyncAt = Date.now();
    return value;
  }

  async status(): Promise<CalendarStatus> {
    const granted = this.hasCalendarPermission();
    const value: CalendarStatus = {
      available: false,
      writable: false,
      permission: granted ? 'granted' : 'prompt',
      lastSyncAt: 0,
      lastEventCount: 0,
      lastSemesterId: '',
      calendarId: '',
      error: ErrorCode.CALENDAR_UNAVAILABLE
    };
    if (!granted) {
      return value;
    }
    try {
      await this.openCalendar();
    } catch (error) {
      return value;
    }
    const ready: CalendarStatus = {
      available: true,
      writable: true,
      permission: 'granted',
      lastSyncAt: 0,
      lastEventCount: 0,
      lastSemesterId: '',
      calendarId: ''
    };
    return ready;
  }

  sync(request: CalendarSyncRequest): Promise<CalendarSyncResult> {
    return this.apply(request.events);
  }

  remove(): Promise<CalendarSyncResult> {
    return this.apply([]);
  }

  openSettings(): Promise<void> {
    return this.context.startAbility({ bundleName: SETTINGS_BUNDLE, abilityName: SETTINGS_ABILITY })
      .catch((): void => {
        throw new Error(ErrorCode.CALENDAR_UNAVAILABLE);
      });
  }
}
