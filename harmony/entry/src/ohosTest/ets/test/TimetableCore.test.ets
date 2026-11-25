// 职责：TimetableCore 的 ohosTest 用例（P1 门禁，SDK 可用时编译运行）。
// 依赖方向：仅测试代码；通过相对路径 import 业务纯逻辑，不写业务实现。
// 待确认：Hypium 版本与 ohosTest 执行器以 Harmony SDK 模板为准。

import { describe, it, expect } from '@ohos/hypium';
import { resolveDay, markLeave } from '../../../main/ets/core/timetable/TimetableCore';
import { createDefaultState } from '../../../main/ets/core/types/AppState';
import type { AppState, CourseRow, LeaveRecord, LocalMapRule } from '../../../main/ets/core/types/AppState';

function stateForWeeks(weeks: number, ruleWeeks: number[]): AppState {
  const state = createDefaultState();
  state.snapshot = {
    id: 'test-semester',
    name: '测试学期',
    startDate: '2026-08-31',
    weeks,
    source: { kind: 'sample', label: 'ohosTest' },
    rules: [{
      id: 'r-math', name: '高等数学', teacher: '李老师', room: 'A101',
      dayOfWeek: 1, weekday: 1, startPeriod: 1, endPeriod: 2, periods: [1, 2],
      weeks: ruleWeeks, startTime: '08:30', endTime: '09:55', cancelled: false, source: 'school'
    }]
  };
  return state;
}

function row(key: string, startTime: string, endTime: string): CourseRow {
  return {
    key, date: '2026-09-01', startTime, endTime, periods: [5, 6],
    name: '课', teacher: '师', room: '室', cancelled: false, vacant: false, localActivity: false,
    customCourse: false, remapId: null, conflict: false, overlap: false, source: 'school', originDate: '2026-09-01'
  };
}

export default function timetableCoreTest() {
  describe('TimetableCore', () => {
    it('single-week rule only resolves in selected week', 0, () => {
      const state = stateForWeeks(2, [1]);
      expect(resolveDay(state, '2026-08-31').length).assertEqual(1);
      expect(resolveDay(state, '2026-09-07').length).assertEqual(0);
    });

    it('markLeave uses half-open interval and ignores cancel type', 0, () => {
      const target = row('k1', '14:00', '15:25');
      const approved: LeaveRecord = {
        id: 'a1', type: 'leave', status: 'approved', startDate: '2026-09-01', startTime: '14:10',
        endDate: '2026-09-01', endTime: '15:00', reason: '', approver: '', comment: '',
        rawStatus: '', semesterId: 's1', demo: false
      };
      const marked = markLeave([target], [approved]);
      expect(marked[0].leave).assertEqual(true);

      const boundary: LeaveRecord = Object.assign({}, approved, { startTime: '15:25', endTime: '16:00' });
      expect(markLeave([target], [boundary])[0].leave).assertEqual(false);

      const cancel: LeaveRecord = Object.assign({}, approved, { id: 'c1', type: 'cancel' });
      expect(markLeave([target], [cancel])[0].leave).assertEqual(false);
    });

    it('localMaps target day shows origin course, source day is moved placeholder', 0, () => {
      const state = stateForWeeks(4, [1, 2, 3, 4]);
      state.localMaps = [{ id: 'm1', date: '2026-09-11', fromDate: '2026-09-07', mode: 'replace' } as LocalMapRule];
      const target = resolveDay(state, '2026-09-11');
      expect(target.length).assertEqual(1);
      expect(target[0].originDate).assertEqual('2026-09-07');
      const source = resolveDay(state, '2026-09-07');
      expect(source.length).assertEqual(1);
      expect(source[0].vacant).assertEqual(true);
      expect(source[0].cancelled).assertEqual(true);
    });
  });
}
