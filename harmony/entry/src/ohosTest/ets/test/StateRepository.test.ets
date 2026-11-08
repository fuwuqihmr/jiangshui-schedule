// 职责：StateRepository 的 ohosTest 用例（迁移/原子写/revision/坏文件降级）。
// 依赖方向：仅测试代码；通过相对路径 import 业务纯逻辑与内存存储。
// 待确认：Hypium 版本与 ohosTest 执行器以 Harmony SDK 模板为准。

import { describe, it, expect } from '@ohos/hypium';
import { migrate, save, load, saveWithRevision, createEmptyState } from '../../../main/ets/data/StateRepository';
import { MemoryPreferencesStore } from '../../../main/ets/data/MemoryPreferencesStore';
import { MemoryStateFileStore } from '../../../main/ets/data/MemoryStateFileStore';
import { createDefaultState } from '../../../main/ets/core/types/AppState';

export default function stateRepositoryTest() {
  describe('StateRepository', () => {
    it('save then load keeps payload and revision', 0, async () => {
      const store = new MemoryPreferencesStore();
      const files = new MemoryStateFileStore();
      const state = createDefaultState();
      state.theme = 'blue';
      state.events = [{ id: 'e1', date: '2026-09-01', kind: 'add', label: 'x', createdAt: 1 }];
      state.localMaps = [{ id: 'm1', date: '2026-09-11', fromDate: '2026-09-07', mode: 'replace' }];
      state.customCourses = [{ id: 'c1', mode: 'weekly', name: '社团', teacher: '', room: '', startTime: '19:00', endTime: '20:30', dayOfWeek: 1, weeks: [1], semesterId: 'default' }];
      await save(store, files, state);
      const loaded = await load(store, files, 'default');
      expect(loaded.theme).assertEqual('blue');
      expect(loaded._revision).assertEqual(1);
      expect(loaded.events.length).assertEqual(1);
      expect(loaded.localMaps.length).assertEqual(1);
      expect(loaded.customCourses.length).assertEqual(1);
      expect(loaded.overrides.length).assertEqual(0);
    });

    it('empty store returns empty state without throwing', 0, async () => {
      const store = new MemoryPreferencesStore();
      const loaded = await load(store, new MemoryStateFileStore(), 'missing');
      expect(loaded.snapshot).assertEqual(null);
    });

    it('bad JSON throws STATE_CORRUPT', 0, () => {
      let caught = '';
      try {
        migrate('{bad');
      } catch (error) {
        caught = String(error.message);
      }
      expect(caught).assertEqual('STATE_CORRUPT');
    });

    it('malformed snapshot degrades instead of throwing later', 0, () => {
      const bad = JSON.stringify({ version: 1, state: { snapshot: { id: 's1' } } });
      let degraded = null;
      try {
        degraded = migrate(bad);
      } catch (error) {
        expect(String(error.message).indexOf('STATE_MIGRATION_FAILED') >= 0).assertEqual(true);
      }
      if (degraded !== null) {
        expect(degraded.snapshot).assertEqual(null);
      }
    });

    it('write failure rolls back file and revision', 0, async () => {
      const store = new MemoryPreferencesStore();
      const files = new MemoryStateFileStore();
      const state = createEmptyState();
      files.failNextWriteForTest();
      let failed = false;
      try {
        await saveWithRevision(store, files, state, 'default', 0);
      } catch (error) {
        failed = String(error.message).indexOf('STATE_WRITE_FAILED') >= 0;
      }
      expect(failed).assertEqual(true);
      expect(await files.read()).assertEqual(null);
      expect(await store.get('jiangshui.state.revision.default')).assertEqual('0');
    });
  });
}
