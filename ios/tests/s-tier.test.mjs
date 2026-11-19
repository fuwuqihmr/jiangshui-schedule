// S 档（1.5.0）回归测试：可选 action 的诚实降级、考试三字段透传、两个 native→web 回调。
// 目标：把“iOS 追平 1.4.x”的四个 S 项钉在静态检查上，防止以后有人把它们删回“不支持的操作”。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, loadSwiftFiles, parseSwiftCases } from '../tools/check-ios.mjs';

const files = loadSwiftFiles(ROOT);

const dispatcher = files['Jiangshui/Web/BridgeDispatcher.swift'];
const optional = files['Jiangshui/Web/OptionalBridgeActions.swift'];
const jsbridge = files['Jiangshui/Web/JSBridge.swift'];
const webhost = files['Jiangshui/Web/WebHost.swift'];
const controller = files['Jiangshui/School/SchoolReadController.swift'];
const provider = files['Jiangshui/School/SchoolProvider.swift'];
const env = files['Jiangshui/App/AppEnvironment.swift'];

// 9 个 S 档降级 action：与 platform-reconnect §5.5-S1 清单逐字一致。
const S_ACTIONS = [
  'cancelRecordSync',
  'feedbackInfo',
  'openFeedback',
  'updateInfo',
  'updateSettings',
  'updateCheck',
  'updateDownload',
  'updateCancel',
  'updateSkip'
];

/** 找到包含 action 的 case 语句（支持 case "a", "b": 合并写法），返回语句起点与冒号后位置。 */
function caseStatement(source, action) {
  const re = /case\s+([^:\n]+):/g;
  let match;
  while ((match = re.exec(source))) {
    const names = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    if (names.includes(action)) return { start: match.index, end: re.lastIndex };
  }
  return null;
}

/** 截取某个 action 的分支体（到下一个 case 之前）。 */
function actionBlock(source, action) {
  const statement = caseStatement(source, action);
  if (!statement) return '';
  const rest = source.slice(statement.end);
  const next = rest.search(/\n\s*case\s+/);
  return next < 0 ? rest : rest.slice(0, next);
}

test('S 档不改变 MUST 契约：BridgeDispatcher 主 switch 仍是 35 个 action', () => {
  const parsed = parseSwiftCases(dispatcher);
  assert.equal(parsed.cases.length, 35);
  assert.equal(new Set(parsed.cases).size, 35);
  for (const action of S_ACTIONS) {
    assert.ok(!parsed.cases.includes(action), '可选 action 不应提前进 MUST switch：' + action);
  }
});

test('未知 action 仍先问可选降级路由，再回「不支持的操作」', () => {
  const parsed = parseSwiftCases(dispatcher);
  assert.equal(parsed.hasDefault, true);
  const handleIndex = parsed.defaultText.indexOf('OptionalBridgeActions.handle');
  assert.ok(handleIndex >= 0, 'default 未调用 OptionalBridgeActions.handle');
  const replyIndex = parsed.defaultText.search(/replyFailure\s*\(\s*id,\s*message:\s*"不支持的操作"\)/);
  assert.ok(replyIndex >= 0, 'default 未回「不支持的操作」');
  assert.ok(replyIndex > handleIndex, '「不支持的操作」必须在降级路由之后');
  assert.ok(!/(^|[^A-Za-z])reply\s*\(/.test(parsed.defaultText), 'default 不得出现成功回包 reply(');
});

test('9 个可选 action 全部登记在 OptionalBridgeActions', () => {
  assert.ok(optional, '缺少 Jiangshui/Web/OptionalBridgeActions.swift');
  for (const action of S_ACTIONS) {
    assert.ok(caseStatement(optional, action), action + ' 未登记');
  }
  // 降级层只允许诚实失败/能力不可用，不允许任何 ok:true 值回包。
  assert.ok(!/"ok"\s*:\s*true/.test(optional), '降级层不得回 {"ok":true}');
});

test('updateCheck / updateDownload 回 {ok:false,errorCode:"unsupported"} 而不是假故障', () => {
  for (const action of ['updateCheck', 'updateDownload']) {
    const block = actionBlock(optional, action);
    assert.ok(block, action + ' 未登记');
    assert.ok(/"ok"\s*:\s*false/.test(block), action + ' 必须回 ok:false');
    assert.ok(/"errorCode"\s*:\s*"unsupported"/.test(block), action + ' 必须回 errorCode=unsupported');
    assert.ok(/"message"/.test(block), action + ' 必须带可直接展示的中文 message');
  }
});

test('updateCancel / updateSkip / openFeedback / updateSettings 走失败信封（不得假装成功）', () => {
  for (const action of ['updateCancel', 'updateSkip', 'openFeedback', 'updateSettings']) {
    const block = actionBlock(optional, action);
    assert.ok(block, action + ' 未登记');
    assert.ok(/replyFailure\s*\(/.test(block), action + ' 必须走 replyFailure');
    assert.ok(!/transport\.reply\s*\(\s*id/.test(block), action + ' 不得回成功值');
  }
});

test('feedbackInfo / updateInfo 回 enabled:false；cancelRecordSync 回明确的平台缺口', () => {
  for (const action of ['feedbackInfo', 'updateInfo']) {
    const block = actionBlock(optional, action);
    assert.ok(/"enabled"\s*:\s*false/.test(block), action + ' 必须回 enabled:false');
  }
  const cancelBlock = actionBlock(optional, 'cancelRecordSync');
  assert.ok(/"ok"\s*:\s*false/.test(cancelBlock));
  assert.ok(/"code"\s*:\s*"UNSUPPORTED_PLATFORM"/.test(cancelBlock));
  assert.ok(/unsupportedCancelRecord/.test(cancelBlock));
  // 不能再用「不支持的操作」当失败文案：web 会把它误判成“未登录”。
  assert.ok(!/replyFailure\s*\([^)]*不支持的操作/.test(optional), '降级层不得回「不支持的操作」');
});

test('考试三字段透传：handleReadResult 带 exams / examFetchedAt / examError，并做 5 类白名单', () => {
  const start = controller.indexOf('private func handleReadResult');
  assert.ok(start >= 0);
  const next = controller.indexOf('\n    private func ', start + 10);
  const body = controller.slice(start, next < 0 ? controller.length : next);
  assert.ok(/payload\["exams"\]\s*=\s*exams/.test(body), '缺 exams 透传');
  assert.ok(/payload\["examFetchedAt"\]/.test(body), '缺 examFetchedAt 透传');
  assert.ok(/payload\["examError"\]/.test(body), '缺 examError 透传');
  assert.ok(/examErrorKinds/.test(controller), '缺考试失败类别白名单');
  for (const kind of ['http', 'session', 'timeout', 'format', 'other']) {
    assert.ok(new RegExp('"' + kind + '"').test(controller), '白名单缺 ' + kind);
  }
});

test('onNativeProgress：读取阶段文案带请求 id 转发给网页', () => {
  assert.ok(/var onProgress: \(\(String\) -> Void\)\?/.test(controller), 'SchoolReadController 缺 onProgress');
  assert.ok(/onProgress\?\(text\)/.test(controller), 'note() 未转发 onProgress');
  assert.ok(/func runSchoolRead\(/.test(dispatcher), 'BridgeDispatcher 缺 runSchoolRead');
  assert.ok(/sendReadProgress\(id: requestId, text: text\)/.test(dispatcher), 'Dispatcher 未按请求 id 转发进度');
  assert.ok(/SchoolReadProgressReporting/.test(provider), 'SchoolProvider 未接入进度协议');
  assert.ok(/func sendReadProgress\(id: String, text: String\)/.test(jsbridge), 'JSBridge 缺 sendReadProgress');
  assert.ok(/window\.onNativeProgress&&window\.onNativeProgress/.test(jsbridge), '事件脚本不是 onNativeProgress');
});

test('onLeaveServiceReturn：请假页关闭时通知网页刷新假条', () => {
  assert.ok(/var onLeaveServiceReturn: \(\(\) -> Void\)\?/.test(provider), 'SchoolProvider 缺 onLeaveServiceReturn');
  assert.ok(/onLeaveServiceReturn\?\(\)/.test(provider), '请假页关闭未触发回调');
  assert.ok(/notifyLeaveServiceReturnIfVisible/.test(provider), '缺少可见性判断（避免注销时误发）');
  assert.ok(/suppressLeaveServiceReturn/.test(provider), '缺少注销抑制标记');
  assert.ok(/func sendLeaveServiceReturn\(\)/.test(jsbridge), 'JSBridge 缺 sendLeaveServiceReturn');
  assert.ok(/func notifyLeaveServiceReturn\(\)/.test(webhost), 'WebHost 缺 notifyLeaveServiceReturn');
  assert.ok(/window\.onLeaveServiceReturn&&window\.onLeaveServiceReturn/.test(jsbridge), '事件脚本不是 onLeaveServiceReturn');
  assert.ok(/school\.onLeaveServiceReturn\s*=/.test(env), 'AppEnvironment 未把 SchoolProvider 接到 WebHost');
  assert.ok(/host\?\.notifyLeaveServiceReturn\(\)/.test(env), 'AppEnvironment 未调用 WebHost.notifyLeaveServiceReturn');
});
