#!/usr/bin/env node
/**
 * 静态守护：
 * 1) 设置页清理卡同时提供「清除网页数据」与「清除登录会话数据」两个动作，分别绑定清理函数；
 * 2) 登录会话清理走 clearLoginSessionData，清学校会话文件、CAS 票据与网页数据；
 * 3) 口径：不声称删除系统密码保险箱密码、不声称退出学校服务器登录，hint 指向系统设置；
 * 4) 资源键已落库并登记在请求文件，值一致。
 * 只读源码与资源，不依赖 HarmonyOS SDK，不跑构建。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ETS = path.join(ROOT, 'entry/src/main/ets');
const RES = path.join(ROOT, 'entry/src/main/resources/base/element/string.json');
const UI_REQUEST = path.join(ROOT, 'tools/resource-requests/harmony-ui.json');
const SESSION_REQUEST = path.join(ROOT, 'tools/resource-requests/harmony-session.json');

function read(rel) {
  return fs.readFileSync(path.join(ETS, rel), 'utf8');
}

function resourceItems() {
  return JSON.parse(fs.readFileSync(RES, 'utf8')).string;
}

function resourceValue(name) {
  const hits = resourceItems().filter((item) => item.name === name);
  assert.equal(hits.length, 1, name + ' 必须唯一');
  return hits[0].value;
}

test('清理卡并列提供网页数据与登录会话两个动作', () => {
  const card = read('components/WebDataClearCard.ets');
  assert.ok(card.includes("import { clearWebBrowsingData } from '../platform/web/WebDataCleaner';"), '保留网页数据 import');
  assert.ok(card.includes("import { clearLoginSessionData } from '../platform/web/WebDataCleaner';"), '新增登录会话 import');
  assert.ok(card.includes('clearWebBrowsingData()'), '网页数据动作必须调用 clearWebBrowsingData');
  assert.ok(card.includes('clearLoginSessionData(getContext(this))'), '登录会话动作必须调用 clearLoginSessionData');
  assert.ok(card.includes('this.clearAll();'), '网页数据按钮必须绑定 clearAll');
  assert.ok(card.includes('this.clearLogin();'), '登录会话按钮必须绑定 clearLogin');
  assert.ok(card.includes("$r('app.string.web_credential_clear_action')"), '必须渲染网页数据动作');
  assert.ok(card.includes("$r('app.string.login_session_clear_action')"), '必须渲染登录会话动作');
  assert.ok(card.includes("$r('app.string.login_session_clear_session_label')"), '必须展示学校会话结果');
  assert.ok(card.includes("$r('app.string.login_session_clear_ticket_label')"), '必须展示 CAS 票据结果');
  assert.ok(card.includes('.enabled(!this.busy)'), '网页数据清理中禁用按钮');
  assert.ok(card.includes('.enabled(!this.loginBusy)'), '登录会话清理中禁用按钮');
  assert.ok(read('pages/SettingsPage.ets').includes('WebDataClearCard()'), '设置页必须渲染清理卡');
});

test('登录会话清理实际清除 session、ticket 与网页数据', () => {
  const cleaner = read('platform/web/WebDataCleaner.ets');
  assert.ok(cleaner.includes('export async function clearLoginSessionData(context: object)'), 'context 用 object 接收，避免页面 import @kit');
  assert.ok(cleaner.includes('const abilityContext: common.UIAbilityContext = context as common.UIAbilityContext;'), '内部收窄为 UIAbilityContext');
  assert.ok(cleaner.includes('createSchoolSessionStore(abilityContext)'), '必须创建学校会话存储');
  assert.ok(cleaner.includes('sessionStore.clear()'), '必须清学校会话文件');
  assert.ok(cleaner.includes('createSchoolTicketStore(abilityContext)'), '必须创建 CAS 票据存储');
  assert.ok(cleaner.includes('ticketStore.clear()'), '必须清 CAS 票据');
  assert.ok(cleaner.includes('clearWebBrowsingData()'), '必须同时清网页数据');
  assert.equal(cleaner.includes('console.'), false, '清理器不得打印日志或 cookie');
  assert.equal(cleaner.includes('cookieHeaderFor'), false, '清理器不得读取 cookie 头');
});

test('两个清理动作文案不同，登录会话成功文案说明需重新登录', () => {
  const webAction = resourceValue('web_credential_clear_action');
  const loginAction = resourceValue('login_session_clear_action');
  const success = resourceValue('login_session_clear_success');
  assert.notEqual(webAction, loginAction, '两个清理动作文案必须不同');
  assert.ok(loginAction.includes('登录会话'), '登录会话动作文案必须可识别');
  assert.ok(success.includes('本地'), '成功文案必须限定只清本机');
  assert.ok(success.includes('重新登录'), '成功文案必须说明下次需重新登录');
});

test('隐私口径：只清本机、不声称删除密码、不声称退出学校服务器', () => {
  const hint = resourceValue('login_session_clear_hint');
  assert.ok(hint.includes('密码保险箱'), 'hint 必须指向系统密码保险箱');
  assert.ok(hint.includes('系统设置'), 'hint 必须指向系统设置');
  assert.ok(hint.includes('只清理本机'), 'hint 必须说明只清本机');
  assert.ok(hint.includes('不会退出学校服务器'), 'hint 必须说明不退出学校服务器');
  assert.equal(hint.includes('已删除密码'), false, '不得声称已删除系统密码');
  assert.equal(hint.includes('应用已删除'), false, '不得声称应用删除了密码');
  assert.equal(hint.includes('已退出学校'), false, '不得声称已退出学校服务器');
  const card = read('components/WebDataClearCard.ets');
  assert.equal(card.includes('已删除系统密码'), false, '组件不得声称删除系统密码');
  assert.equal(card.includes('已退出学校服务器'), false, '组件不得声称退出学校服务器');
});

test('登录会话清理资源键已落库并登记', () => {
  const items = resourceItems();
  const names = new Set(items.map((item) => item.name));
  const keys = [
    'login_session_clear_action',
    'login_session_clear_hint',
    'login_session_clear_success',
    'login_session_clear_failed',
    'login_session_clear_session_label',
    'login_session_clear_ticket_label'
  ];
  for (const key of keys) {
    assert.ok(names.has(key), key + ' 必须存在于 string.json');
  }
  const ui = JSON.parse(fs.readFileSync(UI_REQUEST, 'utf8'));
  const session = JSON.parse(fs.readFileSync(SESSION_REQUEST, 'utf8'));
  assert.ok(ui.login_session_clear_session_label, '学校会话标签必须登记在 harmony-ui.json');
  assert.ok(ui.login_session_clear_ticket_label, 'CAS 票据标签必须登记在 harmony-ui.json');
  for (const key of ['login_session_clear_action', 'login_session_clear_hint', 'login_session_clear_success', 'login_session_clear_failed']) {
    assert.ok(session[key], key + ' 必须登记在 harmony-session.json');
    assert.equal(session[key], resourceValue(key), key + ' 请求值必须与 string.json 一致');
  }
  assert.equal(resourceValue('login_session_clear_action'), '清除登录会话数据');
  assert.equal(resourceValue('login_session_clear_session_label'), '学校会话');
  assert.equal(resourceValue('login_session_clear_ticket_label'), 'CAS 票据');
});
