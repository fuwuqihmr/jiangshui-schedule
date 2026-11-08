import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ETS = path.join(ROOT, 'entry/src/main/ets');
const read = (rel) => fs.readFileSync(path.join(ETS, rel), 'utf8');
const strings = JSON.parse(fs.readFileSync(path.join(ROOT, 'entry/src/main/resources/base/element/string.json'), 'utf8'));

test('P1-3 WeekPage.leaveRecords 可被父组件更新，且变化后重建 vm', () => {
  const page = read('pages/WeekPage.ets');
  assert.match(page, /@Prop\s+@Watch\('refresh'\)\s+leaveRecords:\s*LeaveRecord\[\]/);
  assert.ok(page.includes('buildWeekViewModel('));
  assert.match(page, /leaveRecords:\s*this\.leaveRecords/);
  assert.ok(page.includes('private refreshing: boolean = false;'));
  assert.ok(page.includes('if (this.refreshing) { return; }'));
});

test('P1-4 CourseCard.model 随父组件 ForEach 更新', () => {
  const card = read('components/CourseCard.ets');
  assert.match(card, /@Prop\s+model:\s*CourseView\s*=\s*\{\}\s+as\s+CourseView/);
});

test('P1-5 toggleDemo 失败有可见提示，AppStateHost 只在 save 成功后提交共享状态', () => {
  const index = read('pages/Index.ets');
  const start = index.indexOf('private async toggleDemo(');
  assert.ok(start >= 0);
  const body = index.slice(start, index.indexOf('\n  }', start) + 4);
  assert.ok(body.includes('catch (error)'));
  assert.ok(body.includes('this.demoSwitchFailed = true;'));
  assert.ok(body.includes('return;'));

  const settings = read('pages/SettingsPage.ets');
  assert.ok(settings.includes('@Prop demoSwitchFailed: boolean = false;'));
  assert.ok(settings.includes("if (this.demoSwitchFailed)"));
  assert.ok(settings.includes("$r('app.string.system_error_generic')"));
  assert.ok(strings.string.some((item) => item.name === 'system_error_generic'));

  const host = read('platform/app/AppStateHost.ets');
  const hostStart = host.indexOf('static async setDemoMode(');
  const hostBody = host.slice(hostStart, host.indexOf('\n  }', hostStart) + 4);
  const savePos = hostBody.indexOf('AppStateHost.save(');
  const assignPos = hostBody.indexOf('demoMode = enabled');
  assert.ok(savePos >= 0 && assignPos >= 0 && savePos < assignPos);
  assert.ok(hostBody.includes('copyAppState(AppStateHost.state)'));
  assert.ok(!hostBody.includes('const next: AppState = AppStateHost.state;'));
});
