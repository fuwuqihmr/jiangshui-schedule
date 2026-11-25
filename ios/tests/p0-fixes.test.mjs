import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT, readText, stripSwift, matchBalanced } from '../tools/check-ios.mjs';

const readIos = (rel) => readText(path.join(ROOT, 'ios', rel));

const server = readIos('Jiangshui/Web/LocalServer.swift');
const webhost = readIos('Jiangshui/Web/WebHost.swift');
const rootView = readIos('Jiangshui/App/RootView.swift');
const controller = readIos('Jiangshui/School/SchoolReadController.swift');

// 从原文里按函数/闭包起点切出完整花括号块，避免正则截到第一个内层 }。
function branchAt(source, regex) {
  const stripped = stripSwift(source);
  const match = regex.exec(stripped);
  if (!match) return { raw: '', code: '' };
  const open = stripped.indexOf('{', match.index);
  if (open < 0) return { raw: '', code: '' };
  const close = matchBalanced(stripped, open);
  if (close <= open) return { raw: '', code: '' };
  return { raw: source.slice(open, close + 1), code: stripped.slice(open, close + 1) };
}

function body(source, name) {
  return branchAt(source, new RegExp('func\\s+' + name + '\\s*\\('));
}

function order(text, ...needles) {
  let last = -1;
  for (const needle of needles) {
    const at = text.indexOf(needle);
    assert.ok(at >= 0, '缺少片段：' + needle);
    assert.ok(at > last, '顺序错误：' + needle);
    last = at;
  }
}

test('LocalServer 健康判定严格、stop 可重入并清干净', () => {
  assert.match(server, /static let waitingTimeout:\s*TimeInterval\s*=\s*1\.5/);
  assert.match(server, /var isRunning:\s*Bool\s*\{\s*return shouldRun\s*\}/);
  assert.match(server, /var isHealthy:\s*Bool\s*\{\s*return shouldRun && listener != nil && port != nil\s*\}/);

  const start = body(server, 'start').code;
  assert.match(start, /guard\s*!shouldRun,\s*!starting,\s*listener == nil\s*else\s*\{\s*return\s*\}/);
  assert.match(start, /generation\s*&\+=\s*1/);
  assert.match(start, /startLocked\(from:\s*LocalServer\.firstPort\)/);

  const stop = body(server, 'stop').code;
  assert.ok(stop.length > 0, '无法定位 LocalServer.stop');
  assert.match(stop, /^\{\s*shouldRun\s*=\s*false/, 'stop 必须直接复位 shouldRun，不能有前置 guard');
  assert.doesNotMatch(stop, /guard\s+shouldRun/, 'stop 不能被 shouldRun 守卫挡住（必须可重入）');
  assert.match(stop, /generation\s*&\+=\s*1/);
  assert.match(stop, /listener\.cancel\(\)/);
  assert.match(stop, /self\.listener\s*=\s*nil/);
  assert.match(stop, /port\s*=\s*nil/);
  assert.match(stop, /connections\.removeAll\(\)/);
});

test('LocalServer 失效先清理再恢复，onFailure 只回调一次', () => {
  const state = body(server, 'handleStateLocked').code;
  assert.match(state, /case \.failed[\s\S]{0,300}?recoverLocked\(listener:\s*listener,\s*candidate:\s*candidate\)/);
  assert.match(state, /case \.cancelled:\s*if shouldRun \{[\s\S]{0,300}?recoverLocked\(listener:\s*listener,\s*candidate:\s*candidate\)[\s\S]{0,200}?\}\s*else\s*\{[\s\S]{0,150}?dropListenerLocked\(listener:\s*listener\)/);

  const waiting = body(server, 'scheduleWaitingTimeoutLocked').code;
  order(waiting, 'dropListenerLocked(listener: listener)', 'onInterrupted?()', 'startLocked(from: hadPort ? LocalServer.firstPort : candidate + 1)');
  assert.match(waiting, /\.now\(\) \+ LocalServer\.waitingTimeout/);

  const recover = body(server, 'recoverLocked').code;
  order(recover, 'dropListenerLocked(listener: listener)', 'onInterrupted?()', 'startLocked(from: hadPort ? LocalServer.firstPort : candidate + 1)');
  assert.match(recover, /guard shouldRun else \{ return \}/);

  const drop = body(server, 'dropListenerLocked').code;
  assert.match(drop, /self\.listener\s*=\s*nil/);
  assert.match(drop, /port\s*=\s*nil/);
  assert.match(drop, /generation\s*&\+=\s*1/);

  assert.equal((server.match(/onFailure\?\(/g) || []).length, 1, 'onFailure 必须只有 failLocked 一处调用');
  assert.match(server, /本机端口 47851–47860 均被占用/);
  assert.match(server, /NWEndpoint\.hostPort\(host:\s*"127\.0\.0\.1",\s*port:\s*nwPort\)/);
  assert.doesNotMatch(server, /0\.0\.0\.0/);
});

test('WebHost 有错误标题，手动重试 stop→start，半死监听器用 isHealthy 识别', () => {
  assert.match(webhost, /@Published private\(set\) var serverErrorTitle:\s*String\s*=\s*"页面服务未启动"/);

  const pub = body(webhost, 'retryPage').code;
  assert.match(pub, /retryPage\s*\(\s*autoRetry:\s*false\s*\)/);

  const auto = branchAt(webhost, /private\s+func\s+retryPage\s*\(\s*autoRetry\s*:\s*Bool\s*\)/).code;
  assert.ok(auto.length > 0, '无法定位 retryPage(autoRetry:)');
  order(auto, 'autoRetryWorkItem?.cancel()', 'server.stop()', 'server.start()');
  assert.match(auto, /serverError\s*=\s*nil/);
  assert.match(auto, /currentNavigation\s*=\s*nil/);

  const startIf = body(webhost, 'startIfNeeded').code;
  assert.match(startIf, /guard\s+server\.isHealthy\s+else\s*\{[\s\S]{0,120}?retryPage\(\)[\s\S]{0,120}?return/);
  assert.match(startIf, /if\s+server\.isRunning\s*\{\s*return\s*\}/);
  assert.match(startIf, /server\.start\(\)/);

  const current = body(webhost, 'isCurrentNavigation').code;
  assert.ok(current.length > 0, '无法定位 isCurrentNavigation');
  assert.match(current, /guard let current = currentNavigation else \{ return false \}/);
  assert.match(current, /guard let navigation = navigation else \{ return true \}/);
  assert.match(current, /return current === navigation/);
  assert.equal((webhost.match(/isCurrentNavigation\(navigation\)/g) || []).length, 3, 'didFinish/didFail/didFailProvisional 都要走身份校验');
});

test('WebHost 加载失败每轮只自动重试一次，成功后清错误', () => {
  const failBody = body(webhost, 'handleLoadFailure');
  const fail = failBody.code;
  assert.match(fail, /NSURLErrorCancelled/);
  assert.match(fail, /autoRetryUsed/);
  assert.match(fail, /\.now\(\)\s*\+\s*0\.4/);
  assert.match(fail, /retryPage\s*\(\s*autoRetry:\s*true\s*\)/);
  assert.match(failBody.raw, /serverErrorTitle\s*=\s*"页面加载失败"/);
  assert.match(failBody.raw, /无法连接服务器。/);
  assert.doesNotMatch(fail, /autoRetryUsed\s*=\s*false/, '自动重试分支不能重置计数');

  const finish = branchAt(webhost, /func\s+webView\s*\([^)]*didFinish\s+navigation\s*:\s*WKNavigation\?[^)]*\)/).code;
  assert.ok(finish.length > 0, '无法定位 webView(didFinish:)');
  assert.match(finish, /serverError\s*=\s*nil/);
  assert.match(finish, /autoRetryUsed\s*=\s*false/);
  assert.match(finish, /pageLoaded\s*=\s*true/);
});

test('RootView 错误遮罩显示标题并调用 retryPage', () => {
  assert.match(rootView, /Text\s*\(\s*host\.serverErrorTitle\s*\)/);
  assert.match(rootView, /Button\s*\(\s*"重试"\s*\)\s*\{\s*host\.retryPage\(\)\s*\}/);
});

test('登录时限常量正确，reading 在 start/read/login 结果/finish 复位', () => {
  assert.match(controller, /private static let loginDeadline:\s*TimeInterval\s*=\s*180/);
  assert.match(controller, /private static let loginPresentationWait:\s*TimeInterval\s*=\s*6/);
  assert.match(controller, /private static let loginPresentationPollInterval:\s*TimeInterval\s*=\s*0\.5/);
  assert.match(controller, /private enum LoginPhase\s*\{[\s\S]{0,120}?case idle[\s\S]{0,80}?case presenting[\s\S]{0,80}?case waiting/);
  assert.match(controller, /private var isApplicationActive\s*:\s*Bool\s*\{[\s\S]{0,200}?applicationState\s*==\s*\.active/);
  assert.match(controller, /private var readingPageURL\s*:\s*String\?/);
  assert.match(controller, /private var readingToken\s*=\s*0/);

  const start = body(controller, 'start').code;
  assert.match(start, /stopLoginClock\(\)/);
  assert.match(start, /reading\s*=\s*false/);
  assert.match(start, /readingPageURL\s*=\s*nil/);
  assert.match(start, /readingToken\s*\+=\s*1/);

  const read = body(controller, 'read').code;
  assert.match(read, /guard reading == false else \{ return \}/);
  assert.match(read, /reading\s*=\s*true/);
  assert.match(read, /readingPageURL\s*=\s*host\?\.currentURLString/);
  assert.match(read, /readingToken\s*\+=\s*1/);
  assert.match(read, /read\(attempt: 1, token: token\)/);

  const attempt = branchAt(controller, /private func read\(attempt: Int, token: Int\)/).code;
  assert.ok(attempt.length > 0, '无法定位 read(attempt:token:)');
  assert.match(attempt, /token == readingToken/);
  assert.ok((controller.match(/token == (?:self\.)?readingToken/g) || []).length >= 4, '旧注入/轮询回调都要校验代次');

  const result = body(controller, 'handleReadResult').raw;
  assert.match(result, /if result\.optBool\("login", false\)\s*\{[\s\S]{0,300}?reading\s*=\s*false/);

  const finish = body(controller, 'finish').code;
  assert.match(finish, /reading\s*=\s*false/);
  assert.match(finish, /stopLoginClock\(\)/);
  assert.match(finish, /awaitingLogin\s*=\s*false/);
});

test('needLogin 先取消旧截止，再启动 6 秒呈现轮询，可见后转 180 秒活跃倒计时', () => {
  const needBody = body(controller, 'needLogin');
  order(needBody.code, 'cancelDeadline()', 'startLoginClock()', 'loginRequestPresentation = requestPresentation', 'requestPresentation()', 'pollLoginPresentation(generation: generation)');
  assert.match(needBody.code, /onNeedsVisiblePresentation\?\(\)/);
  assert.match(needBody.raw, /isApplicationActive \? "请在学校页面完成登录" : "请回到江水课表完成登录"/);

  const pollBody = body(controller, 'pollLoginPresentation');
  assert.match(pollBody.code, /guard isApplicationActive else \{ return \}/);
  assert.match(pollBody.code, /if host\?\.isUserVisible == true \{[\s\S]{0,120}?beginLoginDeadline\(\)/);
  assert.match(pollBody.code, /currentLoginPhaseElapsed\(\) >= Self\.loginPresentationWait/);
  assert.match(pollBody.raw, /login-present-ignored reason=/);
  assert.match(pollBody.raw, /学校登录页暂时无法打开，请回到江水课表后重试/);
  assert.match(pollBody.code, /scheduleLoginPoll\(generation: expectedGeneration\)/);

  const deadlineBody = body(controller, 'scheduleLoginDeadline');
  assert.match(deadlineBody.code, /guard isRunning, awaitingLogin, loginPhase == \.waiting, isApplicationActive else \{ return \}/);
  assert.match(deadlineBody.code, /Self\.loginDeadline - currentLoginPhaseElapsed\(\)/);
  assert.match(deadlineBody.raw, /等待学校登录超时，保留上次课表/);
  assert.match(deadlineBody.code, /\.now\(\) \+ remaining/);
});

test('登录时钟只统计前台时间：切后台暂停，回前台续跑', () => {
  const clock = body(controller, 'startLoginClock').code;
  assert.match(clock, /loginPhase = \.presenting/);
  assert.match(clock, /loginPhaseElapsed = 0/);
  assert.match(clock, /willResignActiveNotification/);
  assert.match(clock, /didBecomeActiveNotification/);
  assert.match(clock, /\[weak self\]/);
  assert.match(clock, /loginObserverTokens = \[resign, becomeActive\]/);

  const pause = body(controller, 'pauseLoginClock').code;
  assert.match(pause, /loginPhaseElapsed \+= Date\(\)\.timeIntervalSince\(startedAt\)/);
  assert.match(pause, /loginSegmentStartedAt = nil/);
  assert.match(pause, /loginPollWork\?\.cancel\(\)/);
  assert.match(pause, /loginDeadlineWork\?\.cancel\(\)/);

  const resume = body(controller, 'resumeLoginClock').code;
  assert.match(resume, /guard loginPhase != \.idle else \{ return \}/);
  assert.match(resume, /case \.presenting:[\s\S]{0,120}?pollLoginPresentation\(generation: generation\)/);
  assert.match(resume, /case \.waiting:[\s\S]{0,120}?scheduleLoginDeadline\(\)/);

  const stop = body(controller, 'stopLoginClock').code;
  assert.match(stop, /loginPhase = \.idle/);
  assert.match(stop, /NotificationCenter\.default\.removeObserver\(token\)/);
  assert.match(stop, /loginObserverTokens\.removeAll\(\)/);

  const resignBody = body(controller, 'handleApplicationResignActive');
  assert.match(resignBody.code, /pauseLoginClock\(\)/);
  assert.match(resignBody.raw, /请回到江水课表完成登录/);
  const activeBody = body(controller, 'handleApplicationDidBecomeActive');
  assert.match(activeBody.code, /resumeLoginClock\(\)/);
  assert.match(activeBody.code, /if isRunning, awaitingLogin, host\?\.isUserVisible == true/);
  assert.match(activeBody.raw, /请在学校页面完成登录/);
});

test('xskb 落点先 leaveLogin 再进 reading 守卫，避免白等 180 秒', () => {
  const code = stripSwift(controller);
  const at = controller.indexOf('if path.hasPrefix("/jsxsd/xskb/")');
  assert.ok(at >= 0, '无法定位 xskb 落点分支');
  const open = code.indexOf('{', at);
  const close = matchBalanced(code, open);
  const branch = code.slice(open, close + 1);
  order(branch, 'if awaitingLogin { leaveLogin() }', 'guard reading == false', 'read()');
  assert.match(branch, /if awaitingLogin \{ leaveLogin\(\) \}/);
  assert.match(branch, /guard reading == false else \{ return \}/);
  assert.match(branch, /inspectAcademicLogin \{ \[weak self\] in self\?\.read\(\) \}/);
  assert.match(branch, /if reading \{/);
  assert.match(branch, /if let current = readingPageURL, current == rawURL \{\s*return\s*\}/);
  assert.match(branch, /reading = false[\s\S]{0,120}?readingPageURL = nil[\s\S]{0,120}?readingToken \+= 1/);
});

test('leaveLogin 停表并挂 60 秒，finish 只回一次且停掉登录观察者', () => {
  const leave = body(controller, 'leaveLogin').code;
  assert.match(leave, /guard awaitingLogin else \{ return \}/);
  assert.match(leave, /awaitingLogin\s*=\s*false/);
  order(leave, 'stopLoginClock()', 'scheduleDeadline(Self.leaveLoginDeadline)');

  const finish = body(controller, 'finish').code;
  assert.match(finish, /guard finished == false else \{ return \}/);
  assert.match(finish, /finished\s*=\s*true/);
  assert.match(finish, /completion\s*=\s*nil/);
  assert.match(finish, /callback\?\(result\)/);
});

test('WebHost 回前台开启新加载会话，自动重试轮不清零，进程回收合并同端口加载', () => {
  const begin = body(webhost, 'beginLoadSession').code;
  assert.ok(begin.length > 0, '无法定位 beginLoadSession');
  assert.match(begin, /autoRetryUsed\s*=\s*false/);
  assert.match(begin, /isAutoRetryRound\s*=\s*false/);
  assert.match(begin, /autoRetryWorkItem\?\.cancel\(\)/);
  assert.match(begin, /autoRetryWorkItem\s*=\s*nil/);

  const scene = body(webhost, 'scenePhaseChanged').code;
  const active = /case\s+\.active\s*:([\s\S]*?)default\s*:/.exec(scene);
  assert.ok(active, 'scenePhaseChanged 缺 case .active');
  order(active[1], 'beginLoadSession()', 'startIfNeeded()', 'resumePageIfReady()');

  const auto = branchAt(webhost, /private\s+func\s+retryPage\s*\(\s*autoRetry\s*:\s*Bool\s*\)/).code;
  assert.ok(auto.length > 0, '无法定位 retryPage(autoRetry:)');
  assert.match(auto, /if\s+!autoRetry\s*\{[\s\S]{0,400}?autoRetryUsed\s*=\s*false[\s\S]{0,400}?isAutoRetryRound\s*=\s*false/);
  assert.match(auto, /else\s*\{[\s\S]{0,300}?autoRetryUsed\s*=\s*true[\s\S]{0,300}?isAutoRetryRound\s*=\s*true/);

  const load = body(webhost, 'loadIndex').code;
  assert.match(load, /let\s+autoRound\s*=\s*isAutoRetryRound/);
  const autoAt = load.indexOf('if autoRound');
  const elseAt = autoAt < 0 ? -1 : load.indexOf('} else {', autoAt);
  assert.ok(autoAt >= 0 && elseAt > autoAt, 'loadIndex 未按 isAutoRetryRound 区分新加载/自动重试轮');
  const autoBranch = load.slice(autoAt, elseAt);
  const elseBranch = load.slice(elseAt);
  assert.match(autoBranch, /isAutoRetryRound\s*=\s*false/);
  assert.doesNotMatch(autoBranch, /beginLoadSession\(\)/, '自动重试轮不能开启新会话，否则会无限重试');
  assert.match(elseBranch, /beginLoadSession\(\)/);
  assert.equal((load.match(/beginLoadSession\(\)/g) || []).length, 1, 'loadIndex 只允许新加载分支调用一次 beginLoadSession');

  assert.match(webhost, /if\s+self\.isAutoRetryRound\s*\{\s*self\.services\.state\.log\("page-load-retry port=/);
  assert.match(webhost, /services\.state\.log\("page-load-start port=[^"]*force=[^"]*auto=[^"]*"\)/);
  assert.match(webhost, /services\.state\.log\("page-load-failed code=[^"]*retry=[^"]*"\)/);
  assert.match(webhost, /services\.state\.log\("page-loaded port=[^"]*"\)/);

  const termBody = body(webhost, 'webViewWebContentProcessDidTerminate');
  const term = termBody.code;
  assert.ok(term.length > 0, '无法定位 webViewWebContentProcessDidTerminate');
  assert.match(term, /guard\s+webViewStorage\s*===\s*webView\s+else\s*\{\s*return\s*\}/);
  assert.match(termBody.raw, /page-terminate/);
  assert.match(term, /if\s+let\s+port\s*=\s*server\.port,\s*isLoading,\s*currentLoadPort\s*==\s*port\s*\{\s*return\s*\}/);
  assert.match(term, /startIfNeeded\(\)/);
  assert.doesNotMatch(term, /reloadFromServer\(\)/, '进程回收不应直接 reloadFromServer，否则会取消在飞导航');

  const termRaw = termBody.raw;
  const pendingAt = termRaw.indexOf('let pendingNavigation = currentNavigation');
  const watchAt = pendingAt < 0 ? -1 : termRaw.indexOf('if let port = server.port, isLoading, currentLoadPort == port {', pendingAt);
  const earlyAt = pendingAt < 0 ? -1 : termRaw.indexOf('if let port = server.port, isLoading, currentLoadPort == port { return }', pendingAt);
  assert.ok(pendingAt >= 0, '进程回收未捕获 pendingNavigation');
  assert.ok(watchAt > pendingAt, '进程回收未在 early-return 前安排看门狗');
  assert.ok(earlyAt > watchAt, '原 early-return 必须保留在看门狗之后');

  const open = termRaw.indexOf('{', watchAt);
  const close = open < 0 ? -1 : matchBalanced(termRaw, open);
  assert.ok(close > open, '无法切出进程回收看门狗代码块');
  const watchdog = termRaw.slice(open, close + 1);
  assert.match(watchdog, /DispatchWorkItem/);
  assert.match(watchdog, /asyncAfter\(deadline: \.now\(\) \+ 1\.5, execute: work\)/);
  assert.match(watchdog, /guard self\.pageLoaded == false,[\s\S]*?self\.isLoading,[\s\S]*?self\.currentLoadPort == port,[\s\S]*?self\.currentNavigation === pendingNavigation else \{ return \}/);
  assert.match(watchdog, /self\.isLoading = false/);
  assert.match(watchdog, /page-terminate-recover port=/);
  assert.match(watchdog, /loadIndex\(port: port, force: true\)/);
  assert.equal((termRaw.match(/asyncAfter\(deadline: \.now\(\) \+ 1\.5/g) || []).length, 1, '只允许安排一次 1.5s 看门狗');
});
