// 三端桥（web↔原生）action 契约护栏。
// 契约真源：tests/fixtures/bridge-actions.json（机器可读，供三端 CI 共同引用；JSON 是语言无关的
// 契约制品，未来可直接给 iOS/Harmony 门禁消费，故不内联进测试文件）。
// 本文件只做静态校验，不改 web/native 生产代码。
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = new URL('../', import.meta.url);
const WEB = new URL('../web/', import.meta.url);
const DOCS = new URL('../../../docs/', import.meta.url);
const FIXTURE = new URL('./fixtures/bridge-actions.json', import.meta.url);
const LEVELS = ['MUST', 'OPTIONAL', 'PLATFORM'];
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const contract = JSON.parse(readFileSync(FIXTURE, 'utf8'));

// ---------- 契约表结构校验 ----------
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertUniqueStringArray(value, label, allowEmpty = true) {
  assert.ok(Array.isArray(value), label + ' 必须是数组');
  if (!allowEmpty) assert.ok(value.length > 0, label + ' 不能为空');
  assert.equal(new Set(value).size, value.length, label + ' 不能有重复字段');
  for (const item of value) assert.ok(isNonEmptyString(item), label + ' 字段名必须是非空字符串');
}

const RESPONSE_KEYS = new Set(['kind', 'required', 'optional', 'variants', 'nested', 'opaque', 'notes']);

function validateResponseSpec(name, spec) {
  assert.ok(spec && typeof spec === 'object' && !Array.isArray(spec), name + ': response 回包最小形状缺失');
  for (const key of Object.keys(spec)) assert.ok(RESPONSE_KEYS.has(key), name + ': response 出现未定义字段 ' + key);
  assert.ok(spec.kind === 'object' || spec.kind === 'object-or-null', name + ': response.kind 必须是 object / object-or-null');
  if (spec.notes !== undefined) assert.ok(isNonEmptyString(spec.notes), name + ': response.notes 不能为空');
  if (spec.required !== undefined) assertUniqueStringArray(spec.required, name + ': response.required');
  if (spec.optional !== undefined) assertUniqueStringArray(spec.optional, name + ': response.optional');
  const topFields = [...(spec.required || []), ...(spec.optional || [])];
  if (spec.variants !== undefined) {
    assert.ok(Array.isArray(spec.variants) && spec.variants.length > 0, name + ': response.variants 不能为空');
    assert.equal(spec.required, undefined, name + ': 有 variants 时不要再写顶层 required，避免两种口径并存');
    let nonEmptyVariant = false;
    for (const variant of spec.variants) {
      assert.ok(isNonEmptyString(variant.case), name + ': variant.case 不能为空');
      assertUniqueStringArray(variant.required, name + ': variant.required');
      if (variant.optional !== undefined) assertUniqueStringArray(variant.optional, name + ': variant.optional');
      for (const key of Object.keys(variant)) assert.ok(['case', 'required', 'optional', 'allowEmpty', 'notes'].includes(key), name + ': variant 出现未定义字段 ' + key);
      if (variant.required.length === 0) {
        assert.equal(variant.allowEmpty, true, name + ': 空的 variant.required 必须显式 allowEmpty:true（表示 {} 也是合法回包）');
      } else {
        nonEmptyVariant = true;
      }
    }
    assert.ok(nonEmptyVariant, name + ': 至少有一种回包形状要给出最小字段');
  } else if (spec.opaque === true) {
    assert.ok(spec.required !== undefined, name + ': opaque 回包也要显式写 required:[] 表示字段未冻结');
    assert.ok(isNonEmptyString(spec.notes), name + ': opaque 回包必须在 notes 里说明冻结来源');
  } else {
    assertUniqueStringArray(spec.required, name + ': response.required', false);
  }
  if (spec.nested !== undefined) {
    assert.ok(spec.nested && typeof spec.nested === 'object' && !Array.isArray(spec.nested), name + ': response.nested 必须是对象');
    const variantFields = (spec.variants || []).flatMap(variant => [...variant.required, ...(variant.optional || [])]);
    const parentFields = new Set([...topFields, ...variantFields]);
    for (const [field, nested] of Object.entries(spec.nested)) {
      assert.ok(parentFields.has(field), name + ': nested 字段 ' + field + ' 不在回包字段里');
      assertUniqueStringArray(nested.required, name + '.' + field + '.required', false);
      if (nested.optional !== undefined) assertUniqueStringArray(nested.optional, name + '.' + field + '.optional');
    }
  }
}

const PAYLOAD_KEYS = new Set(['required', 'optional', 'fields', 'notes']);
const FIELD_TYPES = ['string', 'integer', 'number', 'boolean', 'object', 'array'];

function validatePayloadSpec(name, spec) {
  assert.ok(spec && typeof spec === 'object' && !Array.isArray(spec), name + ': payload 必须登记为对象');
  for (const key of Object.keys(spec)) assert.ok(PAYLOAD_KEYS.has(key), name + ': payload 出现未定义字段 ' + key);
  assertUniqueStringArray(spec.required, name + ': payload.required');
  if (spec.optional !== undefined) assertUniqueStringArray(spec.optional, name + ': payload.optional');
  const fields = [...spec.required, ...(spec.optional || [])];
  assert.ok(fields.length > 0, name + ': payload 至少要有 required 或 optional 字段');
  if (spec.notes !== undefined) assert.ok(isNonEmptyString(spec.notes), name + ': payload.notes 不能为空');
  if (spec.fields !== undefined) {
    assert.ok(spec.fields && typeof spec.fields === 'object' && !Array.isArray(spec.fields), name + ': payload.fields 必须是对象');
    for (const [field, def] of Object.entries(spec.fields)) {
      assert.ok(fields.includes(field), name + ': payload.fields.' + field + ' 不在 payload 字段里');
      assert.ok(def && typeof def === 'object', name + ': payload.fields.' + field + ' 必须是对象');
      if (def.type !== undefined) assert.ok(FIELD_TYPES.includes(def.type), name + ': payload.fields.' + field + '.type 非法');
      if (def.enum !== undefined) assertUniqueStringArray(def.enum, name + ': payload.fields.' + field + '.enum', false);
      if (def.min !== undefined) assert.ok(Number.isFinite(def.min), name + ': payload.fields.' + field + '.min 必须是数字');
      if (def.max !== undefined) assert.ok(Number.isFinite(def.max), name + ': payload.fields.' + field + '.max 必须是数字');
      if (def.min !== undefined && def.max !== undefined) assert.ok(def.min <= def.max, name + ': payload.fields.' + field + ' 的 min 不能大于 max');
      if (def.maxLength !== undefined) assert.ok(Number.isInteger(def.maxLength) && def.maxLength > 0, name + ': payload.fields.' + field + '.maxLength 必须是正整数');
      if (def.pattern !== undefined) assert.doesNotThrow(() => new RegExp(def.pattern), name + ': payload.fields.' + field + '.pattern 不是合法正则');
    }
  }
}

function validateContract(doc) {
  assert.equal(doc.schemaVersion, 1, 'schemaVersion 必须为 1');
  assert.ok(/^v\d+-\d{4}-\d{2}-\d{2}$/.test(doc.contractVersion), 'contractVersion 必须形如 v0-2026-11-18');
  for (const key of ['repoBaseline', 'intent']) assert.ok(isNonEmptyString(doc[key]), key + ' 不能为空');
  assert.deepEqual(Object.keys(doc.levels), LEVELS, 'levels 必须定义 MUST/OPTIONAL/PLATFORM 三级且顺序固定');
  for (const level of LEVELS) assert.ok(isNonEmptyString(doc.levels[level]), 'levels.' + level + ' 定义不能为空');
  assert.ok(Array.isArray(doc.sources) && doc.sources.length >= 3, 'sources 至少登记 3 份来源文档');
  for (const source of doc.sources) {
    assert.ok(isNonEmptyString(source.path), 'sources.path 不能为空');
    assert.ok(isNonEmptyString(source.role), 'sources.role 不能为空');
  }
  assert.ok(doc.actions && typeof doc.actions === 'object', 'actions 必须是对象');
  const names = Object.keys(doc.actions);
  assert.ok(names.length > 0, 'actions 不能为空');
  for (const name of names) {
    assert.ok(/^[a-z][A-Za-z0-9]*$/.test(name), 'action 名必须小驼峰: ' + name);
    const entry = doc.actions[name];
    assert.ok(LEVELS.includes(entry.level), name + ': level 必须是 MUST/OPTIONAL/PLATFORM，实际 ' + entry.level);
    assert.ok(entry.webUsage === 'active' || entry.webUsage === 'dead', name + ': webUsage 必须是 active / dead');
    if (entry.webUsage === 'dead') assert.ok(isNonEmptyString(entry.deadReason), name + ': dead action 必须写 deadReason');
    if (entry.payload !== undefined) validatePayloadSpec(name, entry.payload);
    validateResponseSpec(name, entry.response);
    if (entry.notes !== undefined) assert.ok(isNonEmptyString(entry.notes), name + ': notes 不能为空');
  }
  const actionStats = {MUST: 0, OPTIONAL: 0, PLATFORM: 0, total: names.length};
  for (const name of names) actionStats[doc.actions[name].level] += 1;
  assert.deepEqual(doc.levelStats.actions, actionStats, 'levelStats.actions 必须与逐条统计一致');
  assert.ok(Array.isArray(doc.callbacks) && doc.callbacks.length > 0, 'callbacks 必须是数组');
  for (const callback of doc.callbacks) {
    assert.ok(isNonEmptyString(callback.name), 'callback.name 不能为空');
    assert.ok(LEVELS.includes(callback.level), callback.name + ': callback level 非法');
    assert.ok(callback.direction === 'native→web' || callback.direction === 'web→native', callback.name + ': direction 非法');
    assert.ok(isNonEmptyString(callback.signature), callback.name + ': signature 不能为空');
    if (callback.web !== undefined && callback.web !== null) {
      assert.ok(isNonEmptyString(callback.web.file), callback.name + ': web.file 不能为空');
      assert.ok(isNonEmptyString(callback.web.contains), callback.name + ': web.contains 不能为空');
    }
  }
  const callbackStats = {MUST: 0, OPTIONAL: 0, PLATFORM: 0, total: doc.callbacks.length};
  for (const callback of doc.callbacks) callbackStats[callback.level] += 1;
  assert.deepEqual(doc.levelStats.callbacks, callbackStats, 'levelStats.callbacks 必须与逐条统计一致');
  assert.ok(Array.isArray(doc.platformInterfaces), 'platformInterfaces 必须是数组');
  for (const item of doc.platformInterfaces) {
    assert.ok(isNonEmptyString(item.name), 'platformInterface.name 不能为空');
    assert.ok(LEVELS.includes(item.level), item.name + ': level 非法');
    assert.ok(isNonEmptyString(item.signature), item.name + ': signature 不能为空');
    if (item.web === null) {
      assert.ok(isNonEmptyString(item.status), item.name + ': 无 web 实现时必须登记 status');
      assert.ok(isNonEmptyString(item.notes), item.name + ': 无 web 实现时必须在 notes 说明原因');
    } else {
      assert.ok(isNonEmptyString(item.web.file) && isNonEmptyString(item.web.contains), item.name + ': web 证据必须是 file+contains');
    }
  }
  const interfaceStats = {MUST: 0, OPTIONAL: 0, PLATFORM: 0, total: doc.platformInterfaces.length};
  for (const item of doc.platformInterfaces) interfaceStats[item.level] += 1;
  assert.deepEqual(doc.levelStats.platformInterfaces, interfaceStats, 'levelStats.platformInterfaces 必须与逐条统计一致');
  assert.ok(Array.isArray(doc.dynamicCallSites) && doc.dynamicCallSites.length > 0, 'dynamicCallSites 不能为空');
  for (const site of doc.dynamicCallSites) {
    assert.ok(isNonEmptyString(site.file) && site.file.startsWith('web/'), '动态调用点必须在 web/ 下: ' + site.file);
    assert.ok(isNonEmptyString(site.expression), site.file + ': 动态调用点必须登记 expression');
    assert.ok(isNonEmptyString(site.arg), site.file + ': 动态调用点必须登记参数表达式 arg');
    assert.ok(site.resolution && typeof site.resolution === 'object', site.file + ': 动态调用点必须登记 resolution');
    assert.ok(isNonEmptyString(site.resolution.callee), site.file + ': resolution.callee 不能为空');
    assert.ok(isNonEmptyString(site.resolution.param), site.file + ': resolution.param 不能为空');
    assert.ok(isNonEmptyString(site.resolution.defaultAction), site.file + ': resolution.defaultAction 不能为空');
  }
  assert.ok(Array.isArray(doc.proposals), 'proposals 必须是数组');
  for (const proposal of doc.proposals) {
    assert.ok(!(proposal.action in doc.actions), proposal.action + ': 提案 action 不得同时直接登记，落地后要删掉提案');
    assert.ok(LEVELS.includes(proposal.level), proposal.action + ': proposal level 非法');
    validateResponseSpec(proposal.action, proposal.response);
  }
  assert.ok(Array.isArray(doc.openQuestions) && doc.openQuestions.length > 0, 'openQuestions 必须记录待确认口径');
  assert.ok(doc.transport && Array.isArray(doc.transport.frozenSnippets) && doc.transport.frozenSnippets.length > 0, 'transport.frozenSnippets 不能为空');
  for (const snippet of doc.transport.frozenSnippets) {
    assert.ok(isNonEmptyString(snippet.file) && isNonEmptyString(snippet.contains), 'transport.frozenSnippets 必须是 file+contains');
  }
  assert.ok(doc.androidDispatcher && isNonEmptyString(doc.androidDispatcher.file), 'androidDispatcher.file 不能为空');
  assert.ok(Number.isInteger(doc.androidDispatcher.baselineCaseCount) && doc.androidDispatcher.baselineCaseCount > 0, 'androidDispatcher.baselineCaseCount 必须是正整数');
  assert.ok(Array.isArray(doc.androidDispatcher.removedInV141), 'androidDispatcher.removedInV141 必须是数组');
  return doc;
}

// ---------- web 调用点静态扫描 ----------
const BRIDGE_IMPORT = /import\s*\{[^}]*\bcall\b[^}]*\}\s*from\s*['"][^'"]*bridge\.mjs['"]/;
const CALL_PARAM = /function[^(]*\([^)]*\bcall\b[^)]*\)/;
const PROPERTY_CALL = /\bbridge\??\.call\s*\(/g;
const BARE_CALL = /(?<![\w.$])call\s*\(/g;
const BARE_CALL_TEST = /(?<![\w.$])call\s*\(/;

function listWebSources(dir = fileURLToPath(WEB), relPrefix = 'web/', out = []) {
  for (const entry of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    const rel = relPrefix + entry.name;
    if (entry.isDirectory()) listWebSources(full, rel + '/', out);
    else if (/\.(mjs|js|html)$/.test(entry.name)) out.push({path: rel, text: readFileSync(full, 'utf8')});
  }
  return out;
}

function parseCallArgument(line, start) {
  const rest = line.slice(start).replace(/^\s+/, '');
  const literal = /^(['"])([A-Za-z][A-Za-z0-9]*)\1/.exec(rest);
  if (literal) return {kind: 'literal', action: literal[2], arg: ''};
  let depth = 0;
  let end = rest.length;
  for (let index = 0; index < rest.length; index += 1) {
    const ch = rest[index];
    if (ch === '(' || ch === '[' || ch === '{') { depth += 1; continue; }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) { end = index; break; }
      depth -= 1;
      continue;
    }
    if (ch === ',' && depth === 0) { end = index; break; }
  }
  return {kind: 'dynamic', action: null, arg: rest.slice(0, end).trim()};
}

function analyzeWebBridgeCalls(sources = listWebSources()) {
  const literal = [];
  const dynamic = [];
  const unresolved = [];
  const bridgeModules = [];
  for (const source of sources) {
    const imported = BRIDGE_IMPORT.test(source.text);
    const paramDeclared = CALL_PARAM.test(source.text);
    const propertyCall = /\bbridge\??\.call\s*\(/.test(source.text);
    if (imported || paramDeclared || propertyCall) bridgeModules.push(source.path);
    const lines = source.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const scan = re => {
        re.lastIndex = 0;
        let match;
        while ((match = re.exec(line)) !== null) {
          const parsed = parseCallArgument(line, match.index + match[0].length);
          if (parsed.kind === 'literal') literal.push({file: source.path, line: index + 1, action: parsed.action});
          else dynamic.push({file: source.path, line: index + 1, arg: parsed.arg});
        }
      };
      scan(PROPERTY_CALL);
      if (imported || paramDeclared) scan(BARE_CALL);
      else if (BARE_CALL_TEST.test(line)) unresolved.push({file: source.path, line: index + 1, text: line.trim().slice(0, 120)});
    }
  }
  return {literal, dynamic, unresolved, bridgeModules};
}

function resolveDynamicActions(site, sources = listWebSources()) {
  const source = sources.find(item => item.path === site.file);
  assert.ok(source, '动态调用点文件不存在: ' + site.file);
  const callee = site.resolution.callee;
  const declaration = new RegExp('function\\s+' + callee + '\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*=\\s*[\'\"]([^\'\"]*)[\'\"]').exec(source.text);
  assert.ok(declaration, site.file + ': 找不到 ' + callee + ' 的带默认值参数声明');
  assert.equal(declaration[1], site.resolution.param, site.file + ': ' + callee + ' 参数名与登记不一致');
  assert.equal(declaration[2], site.resolution.defaultAction, site.file + ': ' + callee + ' 默认 action 与登记不一致');
  const actions = [];
  const callRe = new RegExp('(?<!function\\s)\\b' + callee + '\\s*\\(([^)]*)\\)', 'g');
  let match;
  while ((match = callRe.exec(source.text)) !== null) {
    const raw = match[1].trim();
    if (raw === '') { actions.push(site.resolution.defaultAction); continue; }
    const literal = /^(['"])([A-Za-z][A-Za-z0-9]*)\1$/.exec(raw);
    assert.ok(literal, site.file + ': ' + callee + ' 存在无法静态解析的调用参数: ' + raw);
    actions.push(literal[2]);
  }
  assert.ok(actions.length > 0, site.file + ': ' + callee + ' 没有任何调用点');
  return [...new Set(actions)];
}

function detectedWebActions(analysis = analyzeWebBridgeCalls()) {
  const found = new Set(analysis.literal.map(site => site.action));
  for (const site of contract.dynamicCallSites) for (const action of resolveDynamicActions(site)) found.add(action);
  return found;
}

function docFile(relativePath) {
  try {
    const url = new URL(relativePath, DOCS);
    return existsSync(fileURLToPath(url)) ? url : null;
  } catch {
    return null;
  }
}

function parseSpecActionLevels(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => /^### 6\.2 action 契约表/.test(line));
  const end = lines.findIndex((line, index) => index > start && /^### 6\.3/.test(line));
  assert.ok(start >= 0 && end > start, '源报告缺少 §6.2 action 契约表');
  const splitRow = line => line.replace(/\\\|/g, '\u0001').split('|').slice(1, -1).map(cell => cell.trim().replace(/\u0001/g, '|'));
  const result = new Map();
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (!/^\|/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length !== 5) continue;
    if (cells[0] === 'action' || /^[-: ]+$/.test(cells[0])) continue;
    const name = cells[0].replace(/\*\*/g, '').replace(/（[^）]*）/g, '').trim();
    const levelText = cells[3];
    const level = /^\*{0,2}M/.test(levelText) ? 'MUST' : /^\*{0,2}O/.test(levelText) ? 'OPTIONAL' : /^\*{0,2}P/.test(levelText) ? 'PLATFORM' : null;
    if (isNonEmptyString(name) && level) result.set(name, level);
  }
  return result;
}

// ---------- 测试 ----------

test('契约表结构合法：每条 action 有分级与回包最小形状，统计自洽', () => {
  validateContract(contract);
  for (const [name, entry] of Object.entries(contract.actions)) {
    assert.ok(LEVELS.includes(entry.level), name + ': 缺 MUST/OPTIONAL/PLATFORM 分级');
    assert.ok(entry.response && entry.response.kind, name + ': 缺回包最小形状');
  }
});

test('等级统计与契约 v0 口径一致：MUST 35 / OPTIONAL 10 / 合计 45', () => {
  const entries = Object.values(contract.actions);
  assert.equal(entries.length, 45, '契约表必须登记 45 条 action（45 行对照表）');
  assert.equal(entries.filter(entry => entry.level === 'MUST').length, 35, 'MUST 条数必须与源报告 §6.2 的 35 条 M 级一致');
  assert.equal(entries.filter(entry => entry.level === 'OPTIONAL').length, 10, 'OPTIONAL 条数必须与源报告 §6.2 的 10 条 O 级一致');
  assert.equal(entries.filter(entry => entry.level === 'PLATFORM').length, 0, '45 条桥内 action 均不是平台特有项（平台特有项在 platformInterfaces）');
  const openQuestion = contract.openQuestions.find(item => item.id === 'LEVEL-MUST-31-VS-35');
  assert.ok(openQuestion, 'D3 的 MUST(31) 与 §6.2 的 35 条差异必须作为待确认项登记');
  assert.match(openQuestion.detail, /31/);
  assert.match(openQuestion.detail, /35/);
  assert.ok(contract.proposals.some(item => item.action === 'platformInfo'), 'platformInfo 必须保留为提案（v0 新增、三端未实现）');
});

test('契约表与 45 行 action 对照表一致（外部文档可选）', t => {
  const file = docFile('platform-reconnect-2026-11-17/tables/action-matrix.csv');
  if (!file) return t.skip('外部契约文档不在当前检出（三端 CI 可跳过本项）');
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
  const lines = text.split(/\r?\n/);
  const header = lines[0].split(',').map(cell => cell.trim());
  assert.equal(lines.length - 1, 45, 'action-matrix.csv 必须仍有 45 行 action');
  const rows = lines.slice(1).map(line => {
    const cells = line.split(',');
    while (cells.length < header.length) cells.push('');
    return cells;
  });
  const actionIndex = header.indexOf('action');
  const deadIndex = header.indexOf('dead_no_web_caller');
  assert.ok(actionIndex >= 0 && deadIndex >= 0, 'CSV 表头缺 action / dead_no_web_caller 列');
  const csvActions = rows.map(cells => cells[actionIndex].trim()).sort();
  assert.deepEqual(Object.keys(contract.actions).sort(), csvActions, '契约表 action 集合必须与 action-matrix.csv 完全一致');
  const csvDead = rows.filter(cells => (cells[deadIndex] || '').trim() === 'Y').map(cells => cells[actionIndex].trim()).sort();
  const contractDead = Object.entries(contract.actions).filter(([, entry]) => entry.webUsage === 'dead').map(([name]) => name).sort();
  assert.deepEqual(contractDead, csvDead, '死 API 标记必须与 action-matrix.csv 的 dead_no_web_caller 列一致');
});

test('契约表分级与源报告 §6.2 表逐条一致（外部文档可选）', t => {
  const file = docFile('platform-reconnect-2026-11-17/平台契约对齐与iOS追平清单.md');
  if (!file) return t.skip('外部契约文档不在当前检出（三端 CI 可跳过本项）');
  const levels = parseSpecActionLevels(readFileSync(file, 'utf8'));
  assert.equal(levels.size, 46, '源报告 §6.2 应解析出 45 条 action + 1 条 platformInfo 提案');
  for (const [name, level] of levels) {
    if (name === 'platformInfo') {
      const proposal = contract.proposals.find(item => item.action === name);
      assert.ok(proposal, 'platformInfo 必须继续登记为提案');
      assert.equal(proposal.level, level, 'platformInfo 提案分级与源报告不一致');
      continue;
    }
    assert.ok(contract.actions[name], '源报告登记了契约表缺失的 action: ' + name);
    assert.equal(contract.actions[name].level, level, name + ' 分级与源报告 §6.2 不一致');
  }
  for (const name of Object.keys(contract.actions)) assert.ok(levels.has(name), '契约表出现源报告没有的 action: ' + name);
});

test('web 实际 action 调用集合 ⊆ 契约表（新增未登记 action 直接失败）', () => {
  const analysis = analyzeWebBridgeCalls();
  assert.deepEqual(analysis.unresolved, [], '存在无法判断归属的 call(...) 调用点：未接入 bridge 的模块必须显式登记');
  assert.ok(analysis.bridgeModules.length >= 5, '扫描应覆盖所有接入 bridge 的 web 模块，实际: ' + analysis.bridgeModules.join(', '));
  const found = detectedWebActions(analysis);
  assert.ok(found.size > 0, 'web 调用点扫描结果不能为空（否则护栏空转）');
  const unknown = [...found].filter(action => !(action in contract.actions)).sort();
  assert.deepEqual(unknown, [], 'web 调用了未登记 action，请先登记 tests/fixtures/bridge-actions.json: ' + unknown.join(', '));
});

test('web 调用集合与契约表 active 集合完全一致（43 条；防漏登/防死 API 复活）', () => {
  const analysis = analyzeWebBridgeCalls();
  const found = [...detectedWebActions(analysis)].sort();
  const declared = Object.entries(contract.actions)
    .filter(([, entry]) => entry.webUsage === 'active')
    .map(([name]) => name)
    .sort();
  assert.equal(declared.length, 43, '契约表 active 集应恰好是 43 条（45 减去 2 条死 API）');
  assert.deepEqual(found, declared, 'web 实际调用集合与契约表不一致：新增/删除调用或 webUsage 标记都要同步更新契约表');
  const dead = Object.entries(contract.actions).filter(([, entry]) => entry.webUsage === 'dead').map(([name]) => name).sort();
  assert.deepEqual(dead, ['runtimeStatus', 'updateInstall'], '死 API 必须与 action-matrix.csv 的 dead_no_web_caller 一致');
});

test('动态调用点必须显式登记且可静态解析（call(action) → readSchool 三别名）', () => {
  const analysis = analyzeWebBridgeCalls();
  const found = analysis.dynamic.map(site => site.file + '#' + site.arg).sort();
  const declared = contract.dynamicCallSites.map(site => site.file + '#' + site.arg).sort();
  assert.deepEqual(found, declared, '出现未登记/失效的动态调用点：call(...) 第一参非字符串时必须在 dynamicCallSites 登记');
  for (const site of contract.dynamicCallSites) {
    const actions = resolveDynamicActions(site);
    assert.ok(actions.length > 0, site.file + ': 动态调度没有解析出 action');
    for (const action of actions) assert.ok(action in contract.actions, site.file + ': 动态调度传入未登记 action: ' + action);
  }
});

test('防漂移自检：新增未登记 action 会被扫描器捕获', () => {
  const fake = [{
    path: 'web/__drift__.mjs',
    text: [
      "import {call} from './bridge.mjs';",
      "await call('brandNewAction');",
      'await call(action);',
    ].join('\n'),
  }];
  const analysis = analyzeWebBridgeCalls(fake);
  assert.deepEqual(analysis.literal.map(site => site.action), ['brandNewAction'], '新增字面量 action 必须被扫描到');
  assert.deepEqual(analysis.dynamic.map(site => site.arg), ['action'], '新增动态调用点必须被扫描到');
  const unknown = analysis.literal.map(site => site.action).filter(action => !(action in contract.actions));
  assert.deepEqual(unknown, ['brandNewAction'], '未登记 action 必须被识别（上层断言据此直接失败）');
  const indirect = analyzeWebBridgeCalls([{path: 'web/__drift_bypass__.mjs', text: "call('saveState');"}]);
  assert.equal(indirect.unresolved.length, 1, '未接入 bridge 的 call(...) 必须报不可解析，避免静默漏扫');
});

test('桥传输协议面冻结：bridge.mjs 协议字面量未变（D2）', () => {
  assert.ok(contract.transport.frozenSnippets.length >= 3, '协议冻结字面量至少登记 3 条');
  for (const snippet of contract.transport.frozenSnippets) {
    assert.ok(read(snippet.file).includes(snippet.contains), snippet.file + ' 缺少协议片段: ' + snippet.contains);
  }
});

test('回调契约：M 级回调在 web 侧均有注册点（D2 协议冻结）', () => {
  const mustCallbacks = contract.callbacks.filter(callback => callback.level === 'MUST');
  assert.ok(mustCallbacks.length >= 7, 'M 级回调数量不足，检查 §6.3 契约表');
  for (const callback of mustCallbacks) {
    assert.ok(callback.web && callback.web.file && callback.web.contains, callback.name + ': M 级回调必须登记 web 注册证据');
    assert.ok(read(callback.web.file).includes(callback.web.contains), callback.name + ' 未在 ' + callback.web.file + ' 找到注册点: ' + callback.web.contains);
  }
  for (const callback of contract.callbacks.filter(item => item.level === 'OPTIONAL')) {
    assert.ok(callback.web && read(callback.web.file).includes(callback.web.contains), callback.name + ': 已登记 web 消费点就必须可静态核实');
  }
});

test('平台接口分级：Android.post 为 PLATFORM 且当前 web 无实现（记录 v1.4.1 静态不一致）', () => {
  const post = contract.platformInterfaces.find(item => item.name === 'Android.post');
  assert.ok(post, '必须登记 Android.post 平台接口');
  assert.equal(post.level, 'PLATFORM');
  assert.equal(post.web, null);
  assert.equal(post.status, 'removed-in-v1.4.1');
  assert.match(post.notes, /BackgroundCheck\.java/);
  const users = listWebSources().filter(source => source.text.includes('Android.post')).map(source => source.path);
  assert.deepEqual(users, [], '当前 web 已无 Android.post 使用；若恢复 web/background.html 必须同步升级本契约条目');
  assert.ok(contract.platformInterfaces.some(item => item.level === 'PLATFORM'), 'PLATFORM 级至少要有一条平台接口记录');
});

test('Android 分发器：分支全部登记，MUST 级 web 调用均有原生分支（附加护栏）', () => {
  const java = read(contract.androidDispatcher.file);
  const cases = [...new Set([...java.matchAll(/case\s+"([A-Za-z][A-Za-z0-9]*)"\s*:/g)].map(match => match[1]))].sort();
  assert.equal(cases.length, contract.androidDispatcher.baselineCaseCount, 'Android 分发器分支数与契约基线不一致（新增/删除 action 必须同步契约表）');
  for (const action of cases) assert.ok(action in contract.actions, 'Android 分发器出现未登记 action: ' + action);
  const missing = Object.keys(contract.actions).filter(action => !cases.includes(action)).sort();
  assert.deepEqual(missing, [...contract.androidDispatcher.removedInV141].sort(), '契约 action 与 Android 分支的差集必须等于登记的 removedInV141');
  const mustActive = Object.entries(contract.actions)
    .filter(([, entry]) => entry.level === 'MUST' && entry.webUsage === 'active')
    .map(([name]) => name);
  const gaps = mustActive.filter(action => !cases.includes(action)).sort();
  assert.deepEqual(gaps, [], 'MUST 级且 web 实际调用的 action 必须有 Android 原生分支，否则线上回「不支持的操作」');
});

test('契约表校验器本身有效：非法等级/空回包/统计不一致都会抛错', () => {
  const clone = () => JSON.parse(JSON.stringify(contract));
  const badLevel = clone();
  badLevel.actions.consentStatus.level = 'CORE';
  assert.throws(() => validateContract(badLevel), /level/);
  const badResponse = clone();
  delete badResponse.actions.consentStatus.response;
  assert.throws(() => validateContract(badResponse), /response/);
  const badRequired = clone();
  badRequired.actions.consentStatus.response.required = [];
  assert.throws(() => validateContract(badRequired), /required/);
  const badStats = clone();
  badStats.levelStats.actions.total = 44;
  assert.throws(() => validateContract(badStats), /levelStats/);
  const badNested = clone();
  badNested.actions.classReminderStatus.response.nested.unknownGroup = {required: ['x']};
  assert.throws(() => validateContract(badNested), /nested/);
});
