#!/usr/bin/env node
/**
 * 静态守护：
 * 1) 设置页 DataSyncCard 的「读取学校课表」必须接 onSchoolRead，不能再接 onSync；
 * 2) 未登录必须落到 SCHOOL_LOGIN_REQUIRED 并引用 school_login_required_hint；
 * 3) 读中/成功/失败三态要在卡片就近可见，不能只更新上方教务卡。
 * 只读源码与 string.json，不依赖 HarmonyOS SDK，不跑构建。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ETS = path.join(ROOT, 'entry/src/main/ets');
const RES = path.join(ROOT, 'entry/src/main/resources/base/element/string.json');

function read(rel) {
  return fs.readFileSync(path.join(ETS, rel), 'utf8');
}

function dataSyncBlock() {
  const text = read('pages/SettingsPage.ets');
  const at = text.indexOf('DataSyncCard({');
  assert.ok(at >= 0, 'SettingsPage must call DataSyncCard');
  const end = text.indexOf('})', at);
  assert.ok(end > at, 'DataSyncCard call block must close');
  return text.slice(at, end + 2);
}

test('DataSyncCard 的读取按钮接 onSchoolRead，不再接 onSync', () => {
  const block = dataSyncBlock();
  assert.ok(block.includes('onRead: () => { this.onSchoolRead(); }'), '读取按钮必须绑定 onSchoolRead');
  assert.equal(block.includes('onRead: () => { this.onSync(); }'), false, '读取按钮不得再绑定 onSync');
  assert.equal(read('pages/SettingsPage.ets').includes('onRead: () => { this.onSync(); }'), false, 'SettingsPage 不得残留 onSync 读取绑定');
});

test('读取三态在 DataSyncCard 就近可见：读中/成功/失败', () => {
  const block = dataSyncBlock();
  assert.ok(block.includes('reading: this.schoolBusy || this.demoMode'), '读中/示例模式必须禁用读取按钮');
  assert.ok(block.includes('busy: this.schoolBusy'), 'busy 必须来自真实读取状态');
  assert.ok(block.includes('statusText: this.schoolReadStatus()'), '读中/失败文案必须传给卡片');
  assert.ok(block.includes("statusError: this.schoolErrorCode !== ''"), '错误态必须用错误色');
  assert.ok(block.includes('lastSuccessText: this.schoolLastSuccessAt > 0 ? schoolAbsoluteText(this.schoolLastSuccessAt) :'), '成功态必须刷新最近成功时间');
  const card = read('components/DataSyncCard.ets');
  assert.ok(card.includes('@Prop statusText: ResourceStr'), 'DataSyncCard 必须有就近状态文案');
  assert.ok(card.includes('@Prop statusError: boolean'), 'DataSyncCard 必须区分错误色');
  assert.ok(card.includes('Text(this.statusText)'), 'DataSyncCard 必须渲染状态文案');
  assert.ok(card.includes(".enabled(!this.reading)"), '读取中必须禁用按钮');
});

test('未登录走 SCHOOL_LOGIN_REQUIRED 并引用 school_login_required_hint', () => {
  const settings = read('pages/SettingsPage.ets');
  const methodAt = settings.indexOf('private schoolReadStatus');
  const busyAt = settings.indexOf('if (this.schoolBusy)', methodAt);
  const loginAt = settings.indexOf("if (this.schoolErrorCode === 'SCHOOL_LOGIN_REQUIRED')", methodAt);
  const genericAt = settings.indexOf('return schoolErrorText(this.schoolErrorCode);', methodAt);
  assert.ok(methodAt >= 0, 'SettingsPage must own schoolReadStatus');
  assert.ok(busyAt > methodAt, '读取中必须先于失败态');
  assert.ok(loginAt > busyAt, '登录缺失分支必须存在且先于通用错误');
  assert.ok(genericAt > loginAt, '其它错误必须走既有 schoolErrorText 映射');
  assert.ok(settings.includes("$r('app.string.school_login_required_hint')"), '登录缺失必须显示已合入的 hint');
  assert.ok(settings.includes("$r('app.string.school_status_checking')"), '读取中必须有可见文案');

  const index = read('pages/Index.ets');
  assert.ok(index.includes('if (session === null || !isSchoolSessionUsable(session))'), '无 session/不可用必须进入登录缺失分支');
  assert.ok(index.includes("this.finishSchoolError('SCHOOL_LOGIN_REQUIRED')"), '无 session 必须落到 SCHOOL_LOGIN_REQUIRED');
  assert.ok(index.includes('this.schoolBusy = true;'), 'readSchool 必须立即进入读中态');
  const finishAt = index.indexOf('private finishSchoolError');
  const finishBlock = index.slice(finishAt, finishAt + 900);
  assert.ok(finishAt >= 0, 'finishSchoolError must exist');
  assert.ok(finishBlock.includes('this.schoolBusy = false;'), '失败必须结束读中态');
  assert.ok(finishBlock.includes('this.schoolErrorCode = code;'), '失败必须上报稳定错误码');
  assert.ok(finishBlock.includes("this.schoolState = 'expired';"), '认证类失败必须进入过期态');
});

test('school_login_required_hint 已合入且唯一', () => {
  const items = JSON.parse(fs.readFileSync(RES, 'utf8')).string;
  const hits = items.filter((item) => item.name === 'school_login_required_hint');
  assert.equal(hits.length, 1, 'school_login_required_hint 必须唯一');
  assert.ok(hits[0].value.length > 0, 'school_login_required_hint 不得为空');
});
