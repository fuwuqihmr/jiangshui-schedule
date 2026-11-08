// 职责：把自定义/调休/休假/单日修改写回 AppStateHost，同时维护撤销重做历史与真实变更 diff。
// 依赖方向：features/custom -> core 纯逻辑 + platform/app 状态宿主（features 内唯一写入口）。
// 阶段：P4；页面接线见 NAV.md，Index 只调用本类，不直接调 AppStateHost.save。
import type { AppState, CustomCourse, DayOverride, HolidayDay, LocalMapRule } from '../../core/types/AppState';
import { AppStateHost } from '../../platform/app/AppStateHost';
import { diffState } from '../../core/timetable/TimetableCore';
import {
  applyChangeRecords,
  commitHistory,
  createHistory,
  deleteCustomCourse,
  deleteLocalMap,
  deleteOverride,
  upsertCustomCourse,
  upsertLocalMap,
  upsertOverride,
  addHolidayDay,
  removeHolidayDay,
  setEveningStudy,
  undoHistory,
  redoHistory,
  canUndo,
  canRedo
} from '../../core/custom/CustomScheduleService';
import type { EditHistory } from '../../core/custom/CustomScheduleService';

export class CustomStateController {
  private history: EditHistory = createHistory(AppStateHost.current());

  current(): AppState {
    return AppStateHost.current();
  }

  canUndoNow(): boolean {
    return canUndo(this.history);
  }

  canRedoNow(): boolean {
    return canRedo(this.history);
  }

  // 把一份完整状态落盘：先 diff 出真实变更记录并合并，再写 revision，最后提交历史。
  async apply(next: AppState): Promise<number> {
    const prev = AppStateHost.current();
    const fresh = diffState(prev, next);
    const merged = applyChangeRecords(next, fresh);
    const revision = await AppStateHost.save(merged);
    this.history = commitHistory(this.history, merged);
    return revision;
  }

  async undo(): Promise<number | null> {
    if (!canUndo(this.history)) {
      return null;
    }
    const restored = undoHistory(this.history);
    const saved = await this.persist(restored.present);
    this.history = restored;
    return saved;
  }

  async redo(): Promise<number | null> {
    if (!canRedo(this.history)) {
      return null;
    }
    const restored = redoHistory(this.history);
    const saved = await this.persist(restored.present);
    this.history = restored;
    return saved;
  }

  // 历史中的状态对象带着旧 revision，落盘前必须对齐当前 revision，否则触发 STATE_REVISION_CONFLICT。
  private async persist(target: AppState): Promise<number> {
    const current = AppStateHost.current();
    target._revision = current._revision === undefined ? 0 : current._revision;
    return await AppStateHost.save(target);
  }

  reset(state: AppState): void {
    this.history = createHistory(state);
  }

  async saveCourse(course: CustomCourse): Promise<number> {
    return this.apply(upsertCustomCourse(AppStateHost.current(), course));
  }

  async removeCourse(id: string): Promise<number> {
    return this.apply(deleteCustomCourse(AppStateHost.current(), id));
  }

  async saveLocalMap(rule: LocalMapRule): Promise<number> {
    return this.apply(upsertLocalMap(AppStateHost.current(), rule));
  }

  async removeLocalMap(id: string): Promise<number> {
    return this.apply(deleteLocalMap(AppStateHost.current(), id));
  }

  async addHoliday(day: HolidayDay): Promise<number> {
    return this.apply(addHolidayDay(AppStateHost.current(), day));
  }

  async removeHoliday(date: string): Promise<number> {
    return this.apply(removeHolidayDay(AppStateHost.current(), date));
  }

  async changeEveningStudy(enabled: boolean): Promise<number> {
    return this.apply(setEveningStudy(AppStateHost.current(), enabled));
  }

  async saveOverride(override: DayOverride): Promise<number> {
    return this.apply(upsertOverride(AppStateHost.current(), override));
  }

  async removeOverride(id: string): Promise<number> {
    return this.apply(deleteOverride(AppStateHost.current(), id));
  }
}
