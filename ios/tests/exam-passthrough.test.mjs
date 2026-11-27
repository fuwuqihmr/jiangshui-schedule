// 考试字段透传（S 档）回归测试。
// 背景：web/school-reader.js 已抓取考试列表/时间/失败类别，iOS 只负责把三个字段原样透传给网页：
//   exams（数组）、examFetchedAt（非空字符串）、examError（非空字符串，五类白名单，白名单外归 other）。
// 本机没有 Xcode/swiftc，不能执行 Swift；这里对 SchoolReadController.swift 做结构+语义静态断言，
// 并用 JSONCompat.swift 的类型收窄实现证明「非数组 / 空串 / 未知类别」在进入 payload 前就被挡住。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOT, loadSwiftFiles, stripSwift, matchBalanced } from '../tools/check-ios.mjs';

const files = loadSwiftFiles(ROOT);
const controller = files['Jiangshui/School/SchoolReadController.swift'];
const jsonCompat = files['Jiangshui/Services/JSONCompat.swift'];
const code = controller ? stripSwift(controller) : '';

/** 按函数名截取原始函数体（在去字符串/注释的代码上配平花括号，再按偏移回切原文）。 */
function functionBody(name) {
  if (!controller) return '';
  const match = new RegExp('func\\s+' + name + '\\s*\\(').exec(code);
  if (!match) return '';
  const open = code.indexOf('{', match.index);
  if (open < 0) return '';
  const close = matchBalanced(code, open);
  return close > open ? controller.slice(open, close + 1) : '';
}

const body = functionBody('handleReadResult');
const EXPECTED_KINDS = ['http', 'session', 'timeout', 'format', 'other'];
const EXAM_KEYS = ['exams', 'examFetchedAt', 'examError'];

/** handleReadResult 里对 payload["key"] 的赋值键（不含 payload 的初始化字面量）。 */
function assignedPayloadKeys() {
  return [...body.matchAll(/payload\s*\[\s*"([^"]+)"\s*\]\s*=/g)].map((item) => item[1]);
}

function countKey(key) {
  return assignedPayloadKeys().filter((item) => item === key).length;
}

test('exams 只有真正的 JSON 数组才透传，非数组/缺失不写入', () => {
  assert.ok(controller, '缺少 ios/Jiangshui/School/SchoolReadController.swift');
  assert.ok(jsonCompat, '缺少 ios/Jiangshui/Services/JSONCompat.swift');
  assert.match(
    body,
    /if\s+let\s+exams\s*=\s*result\.optArray\s*\(\s*"exams"\s*\)\s*\{\s*payload\s*\[\s*"exams"\s*\]\s*=\s*exams\s*\}/,
    'exams 必须用 result.optArray("exams") 做类型收窄后再写入'
  );
  assert.equal(countKey('exams'), 1, 'payload["exams"] 必须恰好写入一次');
  assert.ok(!/payload\s*\[\s*"exams"\s*\]\s*=\s*result\b/.test(body), '不得把整个 result 塞进 exams');
  // JSONCompat.array 是唯一入口：非数组/NSNull 返回 nil；optArray 直接转调它。
  assert.match(jsonCompat, /static\s+func\s+array\s*\([^)]*\)\s*->\s*\[Any\]\?/);
  assert.match(jsonCompat, /return\s+value\s+as\?\s*\[Any\]/);
  assert.match(jsonCompat, /func\s+optArray\s*\([^)]*\)\s*->\s*\[Any\]\?/);
  assert.match(jsonCompat, /JSONCompat\.array\s*\(\s*self\s*\[\s*key\s*\]\s*\)/);
});

test('examFetchedAt 只有非空字符串才透传，空串/缺失不写入', () => {
  assert.match(
    body,
    /let\s+examFetchedAt\s*=\s*result\.optString\s*\(\s*"examFetchedAt"\s*\)\s*if\s+examFetchedAt\.isEmpty\s*==\s*false\s*\{\s*payload\s*\[\s*"examFetchedAt"\s*\]\s*=\s*examFetchedAt\s*\}/,
    'examFetchedAt 必须先判空再写入'
  );
  assert.equal(countKey('examFetchedAt'), 1, 'payload["examFetchedAt"] 必须恰好写入一次');
  assert.match(jsonCompat, /func\s+optString\s*\([^)]*fallback\s*:\s*String\s*=\s*""\s*\)/, 'optString 缺失时应回落空串');
});

test('examError 只有非空值才透传，白名单固定为 http/session/timeout/format/other', () => {
  assert.match(
    body,
    /var\s+examError\s*=\s*result\.optString\s*\(\s*"examError"\s*\)\s*if\s+examError\.isEmpty\s*==\s*false\s*\{/,
    'examError 必须先判空再进入白名单'
  );
  assert.match(body, /Self\.examErrorKinds\.contains\s*\(\s*examError\s*\)/, '白名单校验必须使用 examErrorKinds');
  assert.equal(countKey('examError'), 1, 'payload["examError"] 必须恰好写入一次');
  const match = /private\s+static\s+let\s+examErrorKinds\s*:\s*Set<String>\s*=\s*\[([\s\S]*?)\]/.exec(controller);
  assert.ok(match, '缺少 examErrorKinds 白名单声明');
  const kinds = [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
  assert.deepEqual([...kinds].sort(), [...EXPECTED_KINDS].sort(), '白名单必须恰好五类且不多不少');
});

test('examError 白名单外的值归为 other，不允许原样透传', () => {
  assert.match(
    body,
    /if\s+Self\.examErrorKinds\.contains\s*\(\s*examError\s*\)\s*==\s*false\s*\{\s*examError\s*=\s*"other"\s*\}/,
    '白名单外必须归一为 other'
  );
  const fallback = body.match(/examError\s*=\s*"other"/g) || [];
  assert.equal(fallback.length, 1, '只允许一处把 examError 归一为 other');
});

test('未知字段不会进入 payload，rows/totalWeeks/semesterId 的原有组装不受影响', () => {
  assert.match(
    body,
    /var\s+payload\s*:\s*JSONObject\s*=\s*\[[\s\S]{0,260}?"rows"\s*:\s*rows[\s\S]{0,140}?"totalWeeks"\s*:\s*weeks[\s\S]{0,140}?"semesterId"\s*:\s*semesterId/,
    'payload 必须先用 rows/totalWeeks/semesterId 组装'
  );
  const assigned = assignedPayloadKeys();
  const allowed = new Set(['studentProfile', 'exams', 'examFetchedAt', 'examError', 'labHtml', 'labFetchedAt', 'labError', 'labHttpStatus']);
  const unknown = assigned.filter((key) => !allowed.has(key));
  assert.deepEqual(unknown, [], 'payload 出现未登记键：' + unknown.join('/'));
  for (const key of EXAM_KEYS) {
    assert.equal(countKey(key), 1, 'payload["' + key + '"] 必须恰好写入一次');
  }
  assert.ok(!/payload\s*=\s*result\b/.test(body), '不得整体赋值 payload = result');
  assert.ok(!/payload\s*\.\s*merge\s*\(/.test(body), '不得 payload.merge(result)');
  assert.ok(!/payload\s*\.\s*updateValue\s*\(/.test(body), '不得把 result 的未知键 updateValue 进 payload');
  assert.ok(!/for\s*\([^)]*\)\s*in\s+result\b/.test(body), '不得遍历 result 把所有字段拷进 payload');
});

test('考试三字段在 payload 初始组装之后、持久化与成功回调之前写入', () => {
  const base = body.indexOf('var payload: JSONObject =');
  const exams = body.indexOf('if let exams = result.optArray("exams")');
  const fetchedAt = body.indexOf('let examFetchedAt = result.optString("examFetchedAt")');
  const examError = body.indexOf('var examError = result.optString("examError")');
  const persist = body.indexOf('persistSessionCookies()');
  const finish = body.indexOf('finish(.success(payload))');
  assert.ok(base >= 0 && exams >= 0 && fetchedAt >= 0 && examError >= 0 && persist >= 0 && finish >= 0, '考试透传链路存在缺环');
  assert.ok(base < exams, 'exams 必须在 payload 初始组装之后');
  assert.ok(exams < fetchedAt && fetchedAt < examError, '考试三字段顺序必须稳定（exams → examFetchedAt → examError）');
  assert.ok(examError < persist, '考试字段必须在 persistSessionCookies 之前写入');
  assert.ok(persist < finish, 'persistSessionCookies 必须在成功回调之前');
  assert.equal((body.match(/persistSessionCookies\s*\(\s*\)/g) || []).length, 1, 'persistSessionCookies 只应调用一次');
  assert.equal((body.match(/finish\s*\(\s*\.success\s*\(\s*payload\s*\)\s*\)/g) || []).length, 1, '成功回调只应调用一次');
});
