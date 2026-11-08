#!/usr/bin/env node
/**
 * 静态守护：
 * 1) 教务（读取课表）与学工（请假/门户）入口分开命名，且分别绑定 schoolLogin / web 路由；
 * 2) 未登录读取提示指向教务登录入口，并提供可直接跳转的按钮；
 * 3) 清除网页数据按钮绑定 clearWebBrowsingData，三项结果与密码保险箱 hint 可见；
 * 4) 4 个 session 请求键已合并到 harmony-ui.json 与 string.json，并被源码引用。
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

function dataSyncBlock() {
  const text = read('pages/SettingsPage.ets');
  const at = text.indexOf('DataSyncCard({');
  assert.ok(at >= 0, 'SettingsPage 必须调用 DataSyncCard');
  const end = text.indexOf('})', at);
  assert.ok(end > at, 'DataSyncCard 调用块必须闭合');
  return text.slice(at, end + 2);
}

test('教务与学工入口文案分开，且分别绑定 schoolLogin / web 路由', () => {
  const schoolLabel = resourceValue('data_sync_school_label');
  const officeLabel = resourceValue('data_sync_office_label');
  const portalAction = resourceValue('data_action_portal');
  const mobileAction = resourceValue('data_action_mobile');
  const portalTitle = resourceValue('web_portal_title');
  const mobileTitle = resourceValue('web_mobile_title');

  assert.ok(schoolLabel.includes('教务'), '教务入口必须标为教务');
  assert.ok(officeLabel.includes('学工'), '学工入口必须标为学工');
  assert.ok(portalAction.includes('学工'), '门户按钮必须明确是学工');
  assert.ok(mobileAction.includes('学工'), '移动入口必须明确是学工');
  assert.ok(portalTitle.includes('学工'), '门户 Web 标题必须明确是学工');
  assert.ok(mobileTitle.includes('学工'), '移动 Web 标题必须明确是学工');
  assert.notEqual(schoolLabel, officeLabel, '两个入口文案必须不同');

  const block = dataSyncBlock();
  assert.ok(block.includes("onSchoolLogin: () => { this.onSchoolLogin(); }"), '教务入口必须走 onSchoolLogin');
  assert.ok(block.includes("onPortal: () => { this.onOpenWeb('portal'); }"), '学工门户必须走 portal 路由');
  assert.ok(block.includes("onMobile: () => { this.onOpenWeb('mobile'); }"), '学工移动必须走 mobile 路由');
  assert.ok(block.includes("onRead: () => { this.onSchoolRead(); }"), '读取课表必须走 onSchoolRead');

  const index = read('pages/Index.ets');
  assert.ok(index.includes("this.pathStack.pushPathByName('schoolLogin', null);"), '教务登录必须独立 NavDestination');
  assert.ok(index.includes("if (name === 'schoolLogin')"), 'Index 必须提供 schoolLogin 路由');
  assert.ok(index.includes('entryUrl: schoolSsoEntryUrl()'), '教务登录入口必须来自 schoolSsoEntryUrl');
  assert.ok(index.includes("if (key === 'portal') { this.pathStack.pushPathByName('web', buildPortalWebParam()); }"), 'portal 必须走学工 Web 参数');
  assert.ok(index.includes("else if (key === 'mobile') { this.pathStack.pushPathByName('web', buildMobileWebParam()); }"), 'mobile 必须走学工移动参数');

  const schoolUrls = read('core/parser/SchoolUrls.ets');
  const webEntry = read('core/viewmodel/WebEntryViewModel.ets');
  assert.ok(schoolUrls.includes("JIAOWU_HTTPS + '/sso.jsp'"), '教务入口必须是 jiaowu sso.jsp');
  assert.ok(webEntry.includes("XGXT_ORIGIN + '/sfrz/login343962'"), '学工入口必须是 xgxt 登录页');
  assert.equal(schoolUrls.includes('xgxt'), false, '教务入口文件不得指向学工');
});

test('未登录提示指向教务登录入口，且可直接跳转', () => {
  const hint = resourceValue('school_login_required_hint');
  const action = resourceValue('school_login_required_action');
  assert.ok(hint.includes('登录教务系统'), '未登录提示必须指向教务登录');
  assert.equal(hint.includes('登录学校门户'), false, '未登录提示不得再写模糊的学校门户');
  assert.equal(action, '登录教务系统', '跳转按钮必须明确是教务登录');

  const block = dataSyncBlock();
  assert.ok(block.includes("schoolLoginRequired: this.schoolErrorCode === 'SCHOOL_LOGIN_REQUIRED'"), '未登录态必须传给 DataSyncCard');
  assert.equal(block.includes("$r('app.string.school_login_required_action')"), false, '资源引用在卡片组件内，不在调用块');
  const card = read('components/DataSyncCard.ets');
  assert.ok(card.includes("$r('app.string.school_login_required_action')"), 'DataSyncCard 必须有登录跳转按钮');
  assert.ok(card.includes('this.onSchoolLogin();'), '按钮必须调用 onSchoolLogin');
  assert.ok(read('pages/SettingsPage.ets').includes('onSchoolLogin: () => { this.onSchoolLogin(); }'), 'SettingsPage 必须接上 onSchoolLogin');
});

test('清除网页数据卡调用 WebDataCleaner，并逐项展示三项结果', () => {
  const card = read('components/WebDataClearCard.ets');
  assert.ok(card.includes("import { clearWebBrowsingData } from '../platform/web/WebDataCleaner';"), '必须复用 WebDataCleaner');
  assert.ok(card.includes('clearWebBrowsingData()'), '按钮必须真正调用 clearWebBrowsingData');
  assert.ok(card.includes('this.clearAll();'), '按钮必须绑定 clearAll');
  assert.ok(card.includes(".enabled(!this.busy)"), '清理中必须禁用按钮');
  assert.ok(card.includes("$r('app.string.web_credential_cookies_label')"), '必须展示 Cookie 结果');
  assert.ok(card.includes("$r('app.string.web_credential_storage_label')"), '必须展示网页存储结果');
  assert.ok(card.includes("$r('app.string.web_credential_httpauth_label')"), '必须展示 HTTP 认证结果');
  assert.ok(card.includes("$r('app.string.web_credential_cleared')"), '必须展示已清理');
  assert.ok(card.includes("$r('app.string.web_credential_clear_failed')"), '必须展示未清理');
  assert.ok(read('pages/SettingsPage.ets').includes('WebDataClearCard()'), '设置页必须渲染清除网页数据卡');

  const hint = resourceValue('web_credential_clear_hint');
  assert.ok(hint.includes('系统设置'), 'hint 必须指向系统设置');
  assert.ok(hint.includes('密码保险箱'), 'hint 必须提到密码保险箱');
  assert.equal(hint.includes('应用已删除'), false, '不得声称应用删除了系统密码');
  assert.equal(card.includes('已删除系统密码'), false, '组件不得声称删除系统密码');
});

test('4 个 session 请求键已合并、落库并被引用', () => {
  const keys = ['web_credential_clear_action', 'web_credential_clear_hint', 'school_error_web_page_error', 'office_error_page'];
  const items = resourceItems();
  const names = new Set(items.map((item) => item.name));
  const ui = JSON.parse(fs.readFileSync(UI_REQUEST, 'utf8'));
  const session = JSON.parse(fs.readFileSync(SESSION_REQUEST, 'utf8'));
  for (const key of keys) {
    assert.ok(names.has(key), key + ' 必须存在于 string.json');
    assert.ok(ui[key], key + ' 必须登记在 harmony-ui.json');
    assert.equal(session[key], undefined, key + ' 不得继续留在 harmony-session.json（已合并）');
  }

  assert.ok(read('components/WebDataClearCard.ets').includes("$r('app.string.web_credential_clear_action')"), 'clear action 必须被引用');
  assert.ok(read('components/WebDataClearCard.ets').includes("$r('app.string.web_credential_clear_hint')"), 'clear hint 必须被引用');
  const login = read('pages/SchoolLoginPage.ets');
  assert.ok(login.includes("$r('app.string.school_error_web_page_error')"), '登录页错误必须引用新键');
  assert.ok(login.includes("$r('app.string.school_login_load_error')"), '登录页仍保留兜底文案');
  assert.ok(read('pages/WebOfficePage.ets').includes("$r('app.string.office_error_page')"), '请假页错误必须引用新键');
  assert.equal(session.school_login_required_hint, resourceValue('school_login_required_hint'), 'session 请求值必须与 string.json 一致');
});

test('页面不再出现“登录学校门户”模糊文案', () => {
  const files = [
    'pages/SettingsPage.ets',
    'pages/Index.ets',
    'pages/SchoolLoginPage.ets',
    'pages/WebOfficePage.ets',
    'components/DataSyncCard.ets',
    'components/SchoolAccountCard.ets',
    'components/LeaveServiceCard.ets',
    'components/WebDataClearCard.ets'
  ];
  for (const file of files) {
    assert.equal(read(file).includes('登录学校门户'), false, file + ' 不得残留模糊文案');
  }
  const values = resourceItems().map((item) => item.value);
  assert.equal(values.includes('登录学校门户'), false, 'string.json 不得残留模糊文案');
});
