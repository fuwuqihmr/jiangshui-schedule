#!/usr/bin/env node
// ios/tools/check-ios.mjs
// 江水课表 iOS 静态校验（纯 Node，零第三方依赖，可在 Windows 重复运行）。
// 用法：node ios/tools/check-ios.mjs
// 退出码：0 = 全部通过；1 = 存在 fail 项。
// 边界：本机无 Xcode/swiftc，此脚本只做静态检查，不编译、不签名、不跑真机。

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ACTION_COUNT = 35;
export const BUNDLE_ID = 'cn.local.tomorrow';
export const MARKETING_VERSION = '1.3.1';
export const CURRENT_PROJECT_VERSION = '48';
export const LOOPBACK_FIRST = 47851;
export const LOOPBACK_LAST = 47860;
export const HANDLER_NAME = 'jiangshuiBridge';
export const CONSENT_FREE_ACTIONS = ['consentStatus', 'acceptConsent', 'declineConsent', 'setTheme'];
export const BG_TASK_IDS = ['cn.local.tomorrow.background-check', 'cn.local.tomorrow.class-reminder'];
export const SCHOOL_DOMAINS = ['portal.juwp.edu.cn', 'jiaowuh5.juwp.edu.cn', 'jiaowu.juwp.edu.cn', 'eapp2.juwp.edu.cn', 'eapp2.nit.edu.cn'];
export const ATS_DOMAINS = ['127.0.0.1', 'localhost'].concat(SCHOOL_DOMAINS);
export const EXPECTED_BASELINE = '1ea23688954ba6631a98c31aca4c62b593815da5052965434bd057ac6718cbdd';
export const EXPECTED_BASELINE_COUNT = 182;
export const SWIFT_IMPORT_ALLOWLIST = new Set([
  'Foundation', 'UIKit', 'PhotosUI', 'WebKit', 'Network', 'SwiftUI', 'EventKit', 'UserNotifications',
  'UniformTypeIdentifiers', 'Security', 'CryptoKit', 'BackgroundTasks', 'CoreGraphics', 'CoreLocation', 'os',
  'ActivityKit', 'WidgetKit'
]);

// ===== 基础工具 =====

export function readText(file) {
  return readFileSync(file, 'utf8');
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function walkDir(dir, onFile) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, onFile);
    else if (entry.isFile()) onFile(full);
  }
}

export function collapseWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

export function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

export function matchBalanced(text, openIndex) {
  const pairs = { '{': '}', '(': ')', '[': ']' };
  const open = text[openIndex];
  const close = pairs[open];
  if (!close) return -1;
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function splitTopLevel(text, separator) {
  const sep = separator || ',';
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth = Math.max(0, depth - 1);
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

export function truncateList(items, limit) {
  const max = limit || 10;
  if (items.length <= max) return items.join('；');
  return items.slice(0, max).join('；') + '；…（共 ' + items.length + ' 项）';
}

// ===== Swift / Java 去字符串、去注释（保留长度与换行，便于用偏移回切原文） =====

export function stripSwift(source) {
  const out = source.split('');
  const n = source.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  const skipString = (from) => {
    let j = from;
    if (source.startsWith('"""', j)) {
      j += 3;
      while (j < n) {
        if (source[j] === '\\') { j += 2; continue; }
        if (source.startsWith('"""', j)) return j + 3;
        j++;
      }
      return n;
    }
    j += 1;
    while (j < n) {
      if (source[j] === '\\') { j += 2; continue; }
      if (source[j] === '"') return j + 1;
      j++;
    }
    return n;
  };
  const skipRawString = (from, hashes) => {
    let j = from + hashes;
    const multiline = source.startsWith('"""', j);
    j += multiline ? 3 : 1;
    const closing = (multiline ? '"""' : '"') + '#'.repeat(hashes);
    const found = source.indexOf(closing, j);
    return found < 0 ? n : found + closing.length;
  };
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      const start = i;
      while (i < n && source[i] !== '\n') i++;
      blank(start, i);
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const start = i;
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (source[i] === '/' && source[i + 1] === '*') { depth++; i += 2; continue; }
        if (source[i] === '*' && source[i + 1] === '/') { depth--; i += 2; continue; }
        i++;
      }
      blank(start, i);
      continue;
    }
    if (c === '"') {
      const start = i;
      i = skipString(i);
      blank(start, i);
      continue;
    }
    if (c === '#') {
      let hashes = 0;
      while (source[i + hashes] === '#') hashes++;
      if (source[i + hashes] === '"') {
        const start = i;
        i = skipRawString(i, hashes);
        blank(start, i);
        continue;
      }
    }
    i++;
  }
  return out.join('');
}

export function stripJava(source) {
  const out = source.split('');
  const n = source.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      const start = i;
      while (i < n && source[i] !== '\n') i++;
      blank(start, i);
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i = Math.min(i + 2, n);
      blank(start, i);
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      const quote = c;
      i++;
      while (i < n) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      blank(start, i);
      continue;
    }
    i++;
  }
  return out.join('');
}

// ===== OpenStep plist 解析（project.pbxproj）；对未加引号的 $(...) 故意宽容，交给 A10 报） =====

export function parseOpenStep(text) {
  let i = 0;
  const n = text.length;
  const fail = (message) => {
    throw new Error('OpenStep 解析失败（偏移 ' + i + '）：' + message);
  };
  const skip = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++;
        continue;
      }
      if (text[i] === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i = Math.min(i + 2, n);
        continue;
      }
      return;
    }
  };
  const parseQuoted = () => {
    i++;
    let out = '';
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        const e = text[i + 1];
        if (e === 'n') out += '\n';
        else if (e === 't') out += '\t';
        else if (e === 'r') out += '\r';
        else out += e;
        i += 2;
        continue;
      }
      if (c === '"') { i++; return out; }
      out += c;
      i++;
    }
    return fail('字符串未闭合');
  };
  const parseUnquoted = () => {
    const start = i;
    if (text[i] === '$' && text[i + 1] === '(') {
      let depth = 0;
      while (i < n) {
        if (text[i] === '$' && text[i + 1] === '(') { depth++; i += 2; continue; }
        if (text[i] === ')') { depth--; i++; if (depth === 0) break; continue; }
        if (depth >= 1 && (text[i] === ';' || text[i] === ',' || text[i] === '}')) break;
        i++;
      }
      return text.slice(start, i);
    }
    while (i < n && !/[\s{}()=;,"]/.test(text[i])) i++;
    if (i === start) fail('遇到无法识别的字符 ' + JSON.stringify(text[i] || 'EOF'));
    if (text[i] === '(') fail('未加引号的字符串包含 "("');
    return text.slice(start, i);
  };
  const parseArray = () => {
    i++;
    const arr = [];
    for (;;) {
      skip();
      if (i >= n) fail('数组未闭合');
      if (text[i] === ')') { i++; return arr; }
      arr.push(parseValue());
      skip();
      if (text[i] === ',') { i++; continue; }
      if (text[i] === ')') { i++; return arr; }
      fail('数组元素后缺少 , 或 )');
    }
  };
  const parseDict = () => {
    i++;
    const obj = {};
    for (;;) {
      skip();
      if (i >= n) fail('字典未闭合');
      if (text[i] === '}') { i++; return obj; }
      const key = parseValue();
      if (typeof key !== 'string') fail('字典键必须是字符串');
      skip();
      if (text[i] !== '=') fail('字典键后缺少 =');
      i++;
      obj[key] = parseValue();
      skip();
      if (text[i] === ';') { i++; continue; }
      if (text[i] === '}') { i++; return obj; }
      fail('字典项后缺少 ; 或 }');
    }
  };
  const parseValue = () => {
    skip();
    if (i >= n) return fail('意外结束');
    const c = text[i];
    if (c === '{') return parseDict();
    if (c === '(') return parseArray();
    if (c === '"') return parseQuoted();
    return parseUnquoted();
  };
  skip();
  if (text[i] !== '{') fail('顶层必须是字典');
  const result = parseDict();
  skip();
  if (i !== n) fail('顶层字典之后还有内容');
  return result;
}

export function parsePbxproj(text) {
  const raw = parseOpenStep(text);
  return { raw, objects: raw.objects || {}, rootObject: raw.rootObject, project: (raw.objects || {})[raw.rootObject] };
}

// ===== XML plist 解析（Info.plist / PrivacyInfo.xcprivacy） =====

export function parseXmlPlist(xml) {
  let i = 0;
  const n = xml.length;
  const stack = [];
  let root;
  let hasRoot = false;
  const fail = (message) => {
    throw new Error('plist XML 解析失败（偏移 ' + i + '）：' + message);
  };
  const decode = (value) => value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
  const attach = (value) => {
    if (!stack.length) {
      if (hasRoot) fail('出现多个根值');
      root = value;
      hasRoot = true;
      return;
    }
    const frame = stack[stack.length - 1];
    if (frame.kind === 'array') { frame.value.push(value); return; }
    if (frame.pendingKey === null) fail('字典缺少 key');
    frame.value[frame.pendingKey] = value;
    frame.pendingKey = null;
  };
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    if (xml.startsWith('<!--', i)) {
      const e = xml.indexOf('-->', i + 4);
      if (e < 0) fail('注释未闭合');
      i = e + 3;
      continue;
    }
    if (xml.startsWith('<?', i)) {
      const e = xml.indexOf('?>', i + 2);
      if (e < 0) fail('处理指令未闭合');
      i = e + 2;
      continue;
    }
    if (xml.startsWith('<!', i)) {
      const e = xml.indexOf('>', i + 2);
      if (e < 0) fail('声明未闭合');
      i = e + 1;
      continue;
    }
    const m = /^<(\/?)([A-Za-z0-9_]+)((?:\s+[^>]*?)?)(\/?)>/.exec(xml.slice(i, i + 512));
    if (!m) fail('无法识别的标签');
    const whole = m[0];
    const closing = m[1] === '/';
    const tag = m[2];
    const selfClosing = m[4] === '/';
    i += whole.length;
    if (closing) {
      if (tag === 'plist') continue;
      const frame = stack.pop();
      if (!frame || frame.kind !== tag) fail('闭合标签 </' + tag + '> 不匹配');
      attach(frame.value);
      continue;
    }
    if (tag === 'plist') continue;
    if (tag === 'dict' || tag === 'array') {
      if (selfClosing) { attach(tag === 'dict' ? {} : []); continue; }
      stack.push({ kind: tag, value: tag === 'dict' ? {} : [], pendingKey: null });
      continue;
    }
    if (tag === 'true' || tag === 'false') { attach(tag === 'true'); continue; }
    if (tag === 'string' || tag === 'key' || tag === 'integer' || tag === 'real' || tag === 'date' || tag === 'data') {
      let raw = '';
      if (!selfClosing) {
        const closeTag = '</' + tag + '>';
        const e = xml.indexOf(closeTag, i);
        if (e < 0) fail('缺少闭合标签 ' + closeTag);
        raw = xml.slice(i, e);
        i = e + closeTag.length;
      }
      const value = decode(raw);
      if (tag === 'key') {
        if (!stack.length || stack[stack.length - 1].kind !== 'dict') fail('<key> 不在字典内');
        if (stack[stack.length - 1].pendingKey !== null) fail('字典出现连续 key');
        stack[stack.length - 1].pendingKey = value;
        continue;
      }
      if (tag === 'integer' || tag === 'real') {
        const num = Number(value);
        attach(Number.isFinite(num) ? num : value);
        continue;
      }
      attach(value);
      continue;
    }
    fail('未知标签 <' + tag + '>');
  }
  if (stack.length) fail('仍有未闭合容器');
  if (!hasRoot) fail('没有根值');
  return root;
}

// ===== 契约 / Android / iOS action 解析 =====

export function parseContractActions(markdown) {
  const start = markdown.search(/^##\s*3\b/m);
  if (start < 0) throw new Error('契约中未找到 ## 3 action 全表');
  const rest = markdown.slice(start + 1);
  const endRel = rest.search(/^##\s*4\b/m);
  const body = endRel < 0 ? markdown.slice(start) : rest.slice(0, endRel);
  const actions = [];
  const numbers = [];
  for (const line of body.split('\n')) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 3) continue;
    if (!/^\d+(?:\s*-\s*\d+)?$/.test(cells[1])) continue;
    const ids = cells[2]
      .split('/')
      .map((part) => part.replace(/["'\u0060]/g, '').trim())
      .filter((part) => /^[a-z][A-Za-z0-9]*$/.test(part));
    if (!ids.length) continue;
    numbers.push(cells[1]);
    for (const id of ids) actions.push(id);
  }
  return { actions, numbers, count: actions.length };
}

export function expandNumberRanges(numbers) {
  const out = [];
  for (const item of numbers) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(item);
    if (m) {
      for (let k = Number(m[1]); k <= Number(m[2]); k++) out.push(k);
    } else {
      out.push(Number(item));
    }
  }
  return out;
}

export function parseAndroidActions(source) {
  const masked = stripJava(source);
  const sw = /switch\s*\(\s*action\s*\)/.exec(masked);
  if (!sw) throw new Error('MainActivity 中未找到 switch (action)');
  const open = masked.indexOf('{', sw.index + sw[0].length);
  if (open < 0) throw new Error('switch (action) 后没有 {');
  const close = matchBalanced(masked, open);
  if (close < 0) throw new Error('switch (action) 花括号不配平');
  const block = source.slice(open, close + 1);
  const cases = [];
  const re = /(?:^|\n)\s*case\s+"([^"]+)"\s*:/g;
  let m;
  while ((m = re.exec(block))) cases.push(m[1]);
  const def = /(?:^|\n)\s*default\s*:/.exec(block);
  return {
    cases,
    block,
    hasDefault: !!def,
    defaultText: def ? block.slice(def.index, Math.min(block.length, def.index + 300)) : ''
  };
}

export function parseSwiftCases(source) {
  const masked = stripSwift(source);
  const sw = /switch\s+action\s*\{/.exec(masked);
  if (!sw) throw new Error('BridgeDispatcher 中未找到 switch action {');
  const open = masked.indexOf('{', sw.index);
  const close = matchBalanced(masked, open);
  if (close < 0) throw new Error('switch action 花括号不配平');
  const block = source.slice(open, close + 1);
  const cases = [];
  const re = /(?:^|\n)\s*case\s+"([^"]+)"\s*:/g;
  let m;
  while ((m = re.exec(block))) cases.push(m[1]);
  const def = /(?:^|\n)\s*default\s*:/.exec(block);
  return {
    cases,
    block,
    hasDefault: !!def,
    defaultText: def ? block.slice(def.index, Math.min(block.length, def.index + 300)) : ''
  };
}

// ===== 协议 / conformance / 服务调用解析 =====

export function parseProtocolParamLabels(paramsText) {
  const cleaned = paramsText.trim();
  if (!cleaned) return [];
  const labels = [];
  for (const segment of splitTopLevel(cleaned, ',')) {
    const text = segment.trim();
    if (!text) continue;
    const colon = text.indexOf(':');
    if (colon < 0) { labels.push('?'); continue; }
    const left = collapseWhitespace(text.slice(0, colon));
    const tokens = left.split(' ').filter(Boolean);
    if (!tokens.length) labels.push('?');
    else if (tokens[0] === '_') labels.push('_');
    else if (/^@\w+$/.test(tokens[0])) labels.push('?');
    else labels.push(tokens[0]);
  }
  return labels;
}

export function parseCallLabels(argsText) {
  const cleaned = argsText.trim();
  if (!cleaned) return [];
  const labels = [];
  for (const segment of splitTopLevel(cleaned, ',')) {
    const text = segment.trim();
    if (!text) continue;
    const m = /^([A-Za-z_]\w*)\s*:/.exec(text);
    labels.push(m ? m[1] : '_');
  }
  return labels;
}

export function parseProtocols(source) {
  const masked = stripSwift(source);
  const protocols = {};
  const re = /(?:^|\n)\s*(?:public\s+|internal\s+)?protocol\s+([A-Za-z_]\w*)\s*(?::\s*[^{]+)?\{/g;
  let m;
  while ((m = re.exec(masked))) {
    const name = m[1];
    const open = masked.indexOf('{', m.index);
    const close = matchBalanced(masked, open);
    if (close < 0) throw new Error('协议 ' + name + ' 花括号不配平');
    const body = masked.slice(open + 1, close);
    const methods = {};
    const funcRe = /\bfunc\s+([A-Za-z_]\w*)\s*\(/g;
    let fm;
    while ((fm = funcRe.exec(body))) {
      const po = body.indexOf('(', fm.index);
      const pc = matchBalanced(body, po);
      if (pc < 0) throw new Error('协议 ' + name + ' 方法 ' + fm[1] + ' 参数括号不配平');
      methods[fm[1]] = {
        labels: parseProtocolParamLabels(body.slice(po + 1, pc)),
        signature: collapseWhitespace(body.slice(fm.index, pc + 1))
      };
    }
    const vars = {};
    const varRe = /\bvar\s+([A-Za-z_]\w*)\s*:\s*([^{}\n]+?)\s*\{\s*get\s*\}/g;
    let vm;
    while ((vm = varRe.exec(body))) vars[vm[1]] = collapseWhitespace(vm[2]);
    protocols[name] = { name, methods, vars };
  }
  return protocols;
}

export function findConformances(files) {
  const result = {};
  const declRe = /(?:^|\n)\s*(?:(?:public|internal|private|fileprivate|open|final|@\w+)\s+)*(class|struct|enum|extension)\s+([A-Za-z_]\w*)\s*:\s*([^{]+)\{/g;
  for (const key of Object.keys(files)) {
    const masked = stripSwift(files[key]);
    let m;
    declRe.lastIndex = 0;
    while ((m = declRe.exec(masked))) {
      const kind = m[1];
      const type = m[2];
      const items = m[3].split(',').map((part) => collapseWhitespace(part)).filter(Boolean);
      for (const item of items) {
        const simple = item.replace(/<.*$/, '').trim();
        if (!/^[A-Za-z_]\w*$/.test(simple)) continue;
        if (!result[simple]) result[simple] = [];
        result[simple].push({ type, kind, file: key });
      }
    }
  }
  return result;
}

export function extractServiceCalls(masked) {
  const calls = [];
  const re = /services\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(masked))) {
    const po = masked.indexOf('(', m.index + m[0].length - 1);
    const pc = matchBalanced(masked, po);
    if (pc < 0) throw new Error('调用 ' + m[1] + '.' + m[2] + ' 参数括号不配平');
    calls.push({
      member: m[1],
      method: m[2],
      labels: parseCallLabels(masked.slice(po + 1, pc)),
      line: lineOf(masked, m.index)
    });
    re.lastIndex = pc + 1;
  }
  return calls;
}

export function parsePublicVars(source) {
  const masked = stripSwift(source);
  const vars = {};
  const re = /(?:^|\n)\s*public\s+var\s+([A-Za-z_]\w*)\s*:\s*([^{}\n]+?)\s*\{/g;
  let m;
  while ((m = re.exec(masked))) vars[m[1]] = collapseWhitespace(m[2]);
  return vars;
}

export function loadSwiftFiles(root) {
  const base = path.join(root, 'ios');
  const files = {};
  // 主 App 与 Widget extension 各有一份源码目录；widget 目录不存在时 walkDir 会安全返回。
  for (const folder of ['Jiangshui', 'JiangshuiWidgets']) {
    walkDir(path.join(base, folder), (file) => {
      if (!file.endsWith('.swift')) return;
      const rel = path.relative(base, file).split(path.sep).join('/');
      files[rel] = readFileSync(file, 'utf8');
    });
  }
  return files;
}

// ===== 领域校验：permissionStatus / ATS / PrivacyInfo / 注入 shim =====

export function checkPermissionSnapshotShape(snapshot) {
  const problems = [];
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return ['permissionStatus 必须是对象'];
  const allowedTop = ['notifications', 'exactAlarm', 'battery', 'autostart'];
  for (const key of Object.keys(snapshot)) {
    if (allowedTop.indexOf(key) < 0) problems.push('未登记的顶层字段：' + key);
  }
  const objectOf = (name) => {
    const value = snapshot[name];
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      problems.push(name + ' 必须是对象');
      return null;
    }
    return value;
  };
  const notifications = objectOf('notifications');
  if (notifications) {
    for (const key of ['runtime', 'granted', 'systemEnabled', 'allowed']) {
      if (typeof notifications[key] !== 'boolean') problems.push('notifications.' + key + ' 必须是布尔值');
    }
    for (const key of Object.keys(notifications)) {
      if (['runtime', 'granted', 'systemEnabled', 'allowed'].indexOf(key) < 0) problems.push('notifications 未登记字段：' + key);
    }
    if (typeof notifications.granted === 'boolean' && typeof notifications.systemEnabled === 'boolean' && typeof notifications.allowed === 'boolean') {
      const expected = notifications.granted && notifications.systemEnabled;
      if (notifications.allowed !== expected) problems.push('notifications.allowed 必须等于 granted && systemEnabled');
    }
  }
  const exactAlarm = objectOf('exactAlarm');
  if (exactAlarm) {
    for (const key of ['required', 'allowed']) if (typeof exactAlarm[key] !== 'boolean') problems.push('exactAlarm.' + key + ' 必须是布尔值');
    // supported 是可选能力标记：iOS 返回 false 时 web 端整行不渲染（iOS 没有精确闹钟概念）；Android 不返回该字段。
    if ('supported' in exactAlarm && typeof exactAlarm.supported !== 'boolean') problems.push('exactAlarm.supported 必须是布尔值');
    for (const key of Object.keys(exactAlarm)) if (['required', 'allowed', 'supported'].indexOf(key) < 0) problems.push('exactAlarm 未登记字段：' + key);
  }
  const battery = objectOf('battery');
  if (battery) {
    if (typeof battery.exempt !== 'boolean') problems.push('battery.exempt 必须是布尔值');
    // supported 是可选能力标记：iOS 返回 false 时 web 端整行不渲染；Android 不返回该字段。
    if ('supported' in battery && typeof battery.supported !== 'boolean') problems.push('battery.supported 必须是布尔值');
    for (const key of Object.keys(battery)) if (['exempt', 'supported'].indexOf(key) < 0) problems.push('battery 未登记字段：' + key);
  }
  const autostart = objectOf('autostart');
  if (autostart) {
    if (typeof autostart.supported !== 'boolean') problems.push('autostart.supported 必须是布尔值');
    if (typeof autostart.known !== 'boolean') problems.push('autostart.known 必须是布尔值');
    if (typeof autostart.oem !== 'string') problems.push('autostart.oem 必须是字符串');
    if (typeof autostart.openedAt !== 'number' || !Number.isInteger(autostart.openedAt) || autostart.openedAt < 0) problems.push('autostart.openedAt 必须是非负整数');
    for (const key of Object.keys(autostart)) if (['supported', 'known', 'oem', 'openedAt'].indexOf(key) < 0) problems.push('autostart 未登记字段：' + key);
  }
  return problems;
}

export function checkPermissionReporterSource(source) {
  const compact = source.replace(/\s+/g, '');
  const problems = [];
  const required = [
    ['notifications.runtime 固定 false', 'notifications["runtime"]=false'],
    ['notifications.granted', 'notifications["granted"]=granted'],
    ['notifications.systemEnabled 复用 granted', 'notifications["systemEnabled"]=granted'],
    ['notifications.allowed', 'notifications["allowed"]=granted'],
    ['exactAlarm 形状', 'exactAlarm:JSONObject=["required":false,"allowed":true,"supported":false]'],
    ['battery 形状', 'battery:JSONObject=["exempt":true,"supported":false]'],
    ['autostart 形状', 'autostart:JSONObject=["supported":false,"known":false,"oem":"","openedAt":0]'],
    ['snapshot 顶层四组', 'return["notifications":notifications,"exactAlarm":exactAlarm,"battery":battery,"autostart":autostart]']
  ];
  for (const item of required) {
    if (compact.indexOf(item[1]) < 0) problems.push('PermissionReporter 缺少 ' + item[0]);
  }
  return problems;
}

export function checkAts(plist) {
  const problems = [];
  const ats = plist ? plist.NSAppTransportSecurity : null;
  if (!ats || typeof ats !== 'object' || Array.isArray(ats)) return ['缺少 NSAppTransportSecurity 字典'];
  if (Object.prototype.hasOwnProperty.call(ats, 'NSAllowsArbitraryLoads')) problems.push('禁止出现 NSAllowsArbitraryLoads');
  if (ats.NSAllowsLocalNetworking !== true) problems.push('NSAllowsLocalNetworking 必须为 true');
  const domains = ats.NSExceptionDomains;
  if (!domains || typeof domains !== 'object' || Array.isArray(domains)) return problems.concat(['缺少 NSExceptionDomains 字典']);
  for (const key of Object.keys(domains)) {
    if (ATS_DOMAINS.indexOf(key) < 0) problems.push('多余的 ATS 域：' + key);
  }
  for (const domain of ATS_DOMAINS) {
    const value = domains[domain];
    if (!value || typeof value !== 'object') { problems.push('缺少 ATS 域：' + domain); continue; }
    if (value.NSExceptionAllowsInsecureHTTPLoads !== true) problems.push(domain + ' 缺少 NSExceptionAllowsInsecureHTTPLoads=true');
    if (value.NSIncludesSubdomains !== true) problems.push(domain + ' 缺少 NSIncludesSubdomains=true');
  }
  for (const domain of SCHOOL_DOMAINS) {
    const value = domains[domain];
    if (value && value.NSExceptionMinimumTLSVersion !== 'TLSv1.2') problems.push(domain + ' 缺少 NSExceptionMinimumTLSVersion=TLSv1.2');
  }
  return problems;
}

export function checkInfoPlistCore(plist) {
  const problems = [];
  if (!plist || typeof plist !== 'object' || Array.isArray(plist)) return ['Info.plist 根节点必须是字典'];
  const macro = {
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)',
    CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleShortVersionString: '$(MARKETING_VERSION)',
    CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
    CFBundleIconName: 'AppIcon'
  };
  for (const key of Object.keys(macro)) {
    if (plist[key] !== macro[key]) problems.push(key + ' 必须为 ' + macro[key] + '（实际：' + JSON.stringify(plist[key]) + '）');
  }
  if (typeof plist.CFBundleDisplayName !== 'string' || !plist.CFBundleDisplayName.trim()) problems.push('CFBundleDisplayName 必须非空');
  if (plist.LSRequiresIPhoneOS !== true) problems.push('LSRequiresIPhoneOS 必须为 true');
  if (!plist.UILaunchScreen || typeof plist.UILaunchScreen !== 'object' || Array.isArray(plist.UILaunchScreen)) problems.push('UILaunchScreen 必须是字典');
  const scene = plist.UIApplicationSceneManifest;
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) problems.push('UIApplicationSceneManifest 必须是字典');
  else if (scene.UIApplicationSupportsMultipleScenes !== false) problems.push('UIApplicationSupportsMultipleScenes 必须为 false');
  return problems;
}

export function checkBackground(plist) {
  const problems = [];
  const modes = plist ? plist.UIBackgroundModes : null;
  if (!Array.isArray(modes)) problems.push('UIBackgroundModes 必须是数组');
  else {
    for (const mode of ['fetch', 'processing']) if (modes.indexOf(mode) < 0) problems.push('UIBackgroundModes 缺少 ' + mode);
  }
  const ids = plist ? plist.BGTaskSchedulerPermittedIdentifiers : null;
  if (!Array.isArray(ids)) problems.push('BGTaskSchedulerPermittedIdentifiers 必须是数组');
  else {
    for (const id of BG_TASK_IDS) if (ids.indexOf(id) < 0) problems.push('BGTask 缺少 ' + id);
    for (const id of ids) if (BG_TASK_IDS.indexOf(id) < 0) problems.push('BGTask 未登记 id：' + String(id));
    if (ids.length !== BG_TASK_IDS.length) problems.push('BGTask id 数量应为 ' + BG_TASK_IDS.length + '（实际 ' + ids.length + '）');
  }
  return problems;
}

export function checkUsageDescriptions(plist) {
  const problems = [];
  const keys = ['NSCalendarsFullAccessUsageDescription', 'NSCalendarsWriteOnlyAccessUsageDescription', 'NSCalendarsUsageDescription', 'NSLocationWhenInUseUsageDescription'];
  for (const key of keys) {
    const value = plist ? plist[key] : null;
    if (typeof value !== 'string' || !value.trim()) problems.push(key + ' 必须是非空字符串');
    else if (!/[\u4e00-\u9fff]/.test(value)) problems.push(key + ' 必须是中文文案');
  }
  return problems;
}

export function checkPrivacyManifest(manifest) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return ['PrivacyInfo 根节点必须是字典'];
  const allowedTop = ['NSPrivacyTracking', 'NSPrivacyTrackingDomains', 'NSPrivacyCollectedDataTypes', 'NSPrivacyAccessedAPITypes'];
  for (const key of Object.keys(manifest)) if (allowedTop.indexOf(key) < 0) problems.push('未登记的顶层键：' + key);
  if (manifest.NSPrivacyTracking !== false) problems.push('NSPrivacyTracking 必须为 false');
  if (!Array.isArray(manifest.NSPrivacyTrackingDomains) || manifest.NSPrivacyTrackingDomains.length) problems.push('NSPrivacyTrackingDomains 必须为空数组');
  if (!Array.isArray(manifest.NSPrivacyCollectedDataTypes) || manifest.NSPrivacyCollectedDataTypes.length) problems.push('NSPrivacyCollectedDataTypes 必须为空数组');
  const apis = manifest.NSPrivacyAccessedAPITypes;
  if (!Array.isArray(apis)) return problems.concat(['NSPrivacyAccessedAPITypes 必须是数组']);
  const knownReasons = {
    NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1', '1C8F.1', 'C56D.1', 'AC6B.1'],
    NSPrivacyAccessedAPICategoryFileTimestamp: ['C617.1', '3B52.1', '0A2A.1'],
    NSPrivacyAccessedAPICategorySystemBootTime: ['35F9.1', '8FFB.1'],
    NSPrivacyAccessedAPICategoryDiskSpace: ['E174.1', '85F4.1']
  };
  const seen = new Set();
  for (const entry of apis) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { problems.push('NSPrivacyAccessedAPITypes 元素必须是字典'); continue; }
    const type = entry.NSPrivacyAccessedAPIType;
    if (typeof type !== 'string' || !type) { problems.push('NSPrivacyAccessedAPIType 缺失'); continue; }
    seen.add(type);
    const reasons = entry.NSPrivacyAccessedAPITypeReasons;
    if (!Array.isArray(reasons) || !reasons.length) { problems.push(type + ' 缺少 NSPrivacyAccessedAPITypeReasons'); continue; }
    if (!knownReasons[type]) { problems.push('未登记的 Required Reason API：' + type); continue; }
    for (const reason of reasons) {
      if (knownReasons[type].indexOf(reason) < 0) problems.push(type + ' 的 reason 非法：' + String(reason));
    }
  }
  for (const required of ['NSPrivacyAccessedAPICategoryUserDefaults', 'NSPrivacyAccessedAPICategoryFileTimestamp']) {
    if (!seen.has(required)) problems.push('缺少 Required Reason API：' + required);
  }
  return problems;
}

export function analyzeShim(source) {
  const problems = [];
  const fnIndex = source.indexOf('static func userScript');
  if (fnIndex < 0) return ['JSBridge 缺少 static func userScript'];
  const start = source.indexOf('"""', fnIndex);
  if (start < 0) return ['userScript 未使用多行字符串'];
  const end = source.indexOf('"""', start + 3);
  if (end < 0) return ['userScript 多行字符串未闭合'];
  const shim = collapseWhitespace(source.slice(start + 3, end));
  const required = [
    ['window.__jiangshuiDark 赋值', 'window.__jiangshuiDark ='],
    ['window.Android.request', 'window.Android = { request: function (id, action, payload) {'],
    ['messageHandlers.jiangshuiBridge.postMessage', 'window.webkit.messageHandlers.jiangshuiBridge.postMessage({'],
    ['id: String(id)', 'id: String(id)'],
    ['action: String(action)', 'action: String(action)'],
    ['payload: String(payload)', 'payload: String(payload)'],
    ['systemDarkMode 函数', 'window.Android.systemDarkMode = function () { return window.__jiangshuiDark === true; };'],
    ['__jiangshuiSystemDarkMode 函数', 'window.__jiangshuiSystemDarkMode = function () { return window.__jiangshuiDark === true; };'],
    ['IIFE 开始', '(function () {'],
    ['IIFE 结束', '})();']
  ];
  for (const item of required) if (shim.indexOf(item[1]) < 0) problems.push('注入脚本缺少 ' + item[0]);
  if (!/injectionTime:\s*\.atDocumentStart/.test(source)) problems.push('WKUserScript 未使用 .atDocumentStart');
  if (!/forMainFrameOnly:\s*true/.test(source)) problems.push('WKUserScript 未设置 forMainFrameOnly: true');
  return problems;
}

export function findForceUnwraps(masked) {
  const hits = [];
  const lines = masked.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const kinds = [];
    if (/\btry\s*!/.test(line)) kinds.push('try!');
    if (/\bas\s*!/.test(line)) kinds.push('as!');
    if (/\b(fatalError|preconditionFailure|assertionFailure)\s*\(/.test(line)) kinds.push('fatalError');
    if (/([A-Za-z0-9_)\]])\!(?!=)/.test(line)) kinds.push('强制解包');
    if (kinds.length) hits.push({ line: index + 1, kinds: Array.from(new Set(kinds)), text: line.trim() });
  }
  return hits;
}

// ===== 禁改基线 =====

// 基线只统计入库源码：.apk/.zip 是 Android 本地构建产物，不入库也不该参与基线，
// 否则 CI 的 git checkout（只有入库文件）与本地工作树（含产物）永远对不上。
const BASELINE_ARTIFACT = /\.(apk|zip)$/i;

export function collectBaselineFiles(root) {
  const baseRoot = root || ROOT;
  const files = [];
  for (const dir of ['web', 'android']) {
    const abs = path.join(baseRoot, dir);
    if (!existsSync(abs)) continue;
    walkDir(abs, (file) => {
      if (BASELINE_ARTIFACT.test(file)) return;
      files.push(path.relative(baseRoot, file).split(path.sep).join('/'));
    });
  }
  files.sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
  return files;
}

export function computeBaseline(root) {
  const baseRoot = root || ROOT;
  const files = collectBaselineFiles(baseRoot);
  const lines = files.map((rel) => sha256(readFileSync(path.join(baseRoot, rel))) + ' *' + rel);
  const textLines = files.map((rel) => sha256(readFileSync(path.join(baseRoot, rel))) + '  ' + rel);
  return {
    files,
    count: files.length,
    hash: sha256(lines.join('\n') + '\n'),
    textHash: sha256(textLines.join('\n') + '\n')
  };
}

// ===== 汇总检查 =====

export function runChecks(root) {
  const baseRoot = root || ROOT;
  const results = [];
  const memo = (fn) => {
    let done = false;
    let value;
    let error;
    return () => {
      if (!done) {
        done = true;
        try { value = fn(); } catch (e) { error = e; }
      }
      if (error) throw error;
      return value;
    };
  };
  const pass = (detail) => ({ ok: true, detail: detail || '' });
  const fail = (detail) => ({ ok: false, detail: detail || '' });
  const add = (id, title, fn) => {
    let ok = false;
    let detail = '';
    try {
      const value = fn();
      if (value === undefined || value === true) ok = true;
      else if (value === false) { ok = false; detail = '检查返回 false'; }
      else { ok = !!value.ok; detail = value.detail || ''; }
    } catch (e) {
      ok = false;
      detail = '检查异常：' + (e && e.message ? e.message : String(e));
    }
    results.push({ id, title, ok, detail });
  };

  const pbxText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui.xcodeproj', 'project.pbxproj')));
  const pbx = memo(() => parsePbxproj(pbxText()));
  const objects = memo(() => pbx().objects);
  const swiftFiles = memo(() => loadSwiftFiles(baseRoot));
  const dispatcherText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui', 'Web', 'BridgeDispatcher.swift')));
  const dispatcherMasked = memo(() => stripSwift(dispatcherText()));
  const jsbridgeText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui', 'Web', 'JSBridge.swift')));
  const webhostText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui', 'Web', 'WebHost.swift')));
  const rootViewText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui', 'App', 'RootView.swift')));
  const localserverText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui', 'Web', 'LocalServer.swift')));
  const consentText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui', 'Services', 'ConsentStore.swift')));
  const permissionText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui', 'Services', 'PermissionReporter.swift')));
  const schoolText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui', 'School', 'SchoolProvider.swift')));
  const projectYml = memo(() => readText(path.join(baseRoot, 'ios', 'project.yml')));
  const androidMain = memo(() => readText(path.join(baseRoot, 'android', 'app', 'src', 'main', 'java', 'cn', 'local', 'tomorrow', 'MainActivity.java')));
  const contractMd = memo(() => readText(path.join(baseRoot, 'ios', 'docs', 'IOS-PORT-CONTRACT.md')));
  const infoPlistText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui', 'Resources', 'Info.plist')));
  const privacyText = memo(() => readText(path.join(baseRoot, 'ios', 'Jiangshui', 'Resources', 'PrivacyInfo.xcprivacy')));
  const protocols = memo(() => parseProtocols(swiftFiles()['Jiangshui/Services/ServiceProtocols.swift']));
  const conformances = memo(() => findConformances(swiftFiles()));
  const infoPlist = memo(() => parseXmlPlist(infoPlistText()));
  const privacyManifest = memo(() => parseXmlPlist(privacyText()));
  const contractActions = memo(() => parseContractActions(contractMd()));
  const androidActions = memo(() => parseAndroidActions(androidMain()));
  const iosActions = memo(() => parseSwiftCases(dispatcherText()));
  const baseline = memo(() => computeBaseline(baseRoot));
  const groupWalk = memo(() => walkProjectGroups(baseRoot, pbx(), objects()));

  // A. pbxproj 与磁盘一致性
  add('A1', 'pbxproj 可解析且版本字段合法', () => {
    const text = pbxText();
    const raw = pbx().raw;
    const project = pbx().project;
    const problems = [];
    if (!text.startsWith('// !$*UTF8*$!')) problems.push('文件头缺少 // !$*UTF8*$!');
    if (String(raw.archiveVersion) !== '1') problems.push('archiveVersion 应为 1（实际 ' + raw.archiveVersion + '）');
    if (String(raw.objectVersion) !== '56') problems.push('objectVersion 应为 56（实际 ' + raw.objectVersion + '）');
    if (!project || project.isa !== 'PBXProject') problems.push('rootObject 不是 PBXProject');
    else if (project.compatibilityVersion !== 'Xcode 14.0') problems.push('compatibilityVersion 应为 Xcode 14.0（实际 ' + project.compatibilityVersion + '）');
    if (!/^[0-9A-F]{24}$/.test(String(raw.rootObject))) problems.push('rootObject 不是 24 位 UUID');
    if (!objects()[raw.rootObject]) problems.push('rootObject 指向的对象不存在');
    if (Object.keys(objects()).length < 60) problems.push('objects 数量异常偏少：' + Object.keys(objects()).length);
    return problems.length ? fail(truncateList(problems)) : pass('objectVersion=56，objects=' + Object.keys(objects()).length);
  });

  add('A2', 'pbxproj 所有 UUID 引用均有定义', () => {
    const refs = new Set();
    collectHexRefs(pbx().raw, refs);
    const missing = [];
    for (const ref of refs) if (!objects()[ref]) missing.push(ref);
    return missing.length ? fail('悬空引用：' + truncateList(missing)) : pass('引用 ' + refs.size + ' 个 UUID，全部有定义');
  });

  add('A3', 'pbxproj 无重复对象 UUID', () => {
    const text = pbxText();
    const marker = text.indexOf('objects = {');
    if (marker < 0) return fail('未找到 objects 段');
    const open = text.indexOf('{', marker);
    const close = matchBalanced(text, open);
    if (close < 0) return fail('objects 段括号不配平');
    const body = text.slice(open + 1, close);
    const seen = new Map();
    let depth = 0;
    let lineNo = lineOf(text, open + 1);
    for (const line of body.split('\n')) {
      if (depth === 0) {
        const hit = /^[ \t]*([0-9A-F]{24})\b[^\n=]*=[ \t]*\{/.exec(line);
        if (hit) {
          const id = hit[1];
          if (seen.has(id)) seen.get(id).push(lineNo);
          else seen.set(id, [lineNo]);
        }
      }
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') depth = Math.max(0, depth - 1);
      }
      lineNo++;
    }
    const dup = [];
    for (const [id, lines] of seen) if (lines.length > 1) dup.push(id + '@' + lines.join(',') + '行');
    return dup.length ? fail('重复定义：' + truncateList(dup)) : pass('对象定义 ' + seen.size + ' 个，UUID 唯一');
  });

  add('A4', 'pbxproj 文件引用按 group 路径在磁盘存在', () => {
    const walk = groupWalk();
    const problems = walk.errors.concat(walk.missing.map((item) => '磁盘缺失：' + item.rel + '（' + item.id + '）'));
    const refIds = new Set(walk.refs.map((ref) => ref.id));
    for (const id of Object.keys(objects())) {
      const obj = objects()[id];
      if (obj.isa !== 'PBXFileReference') continue;
      if (obj.sourceTree === 'BUILT_PRODUCTS_DIR' || obj.sourceTree === 'SDKROOT') continue;
      if (!refIds.has(id)) problems.push('文件引用未挂到任何 group：' + id + '（' + (obj.path || obj.name || '?') + '）');
    }
    return problems.length ? fail(truncateList(problems)) : pass('文件引用 ' + walk.refs.length + ' 个，路径全部存在');
  });

  add('A5', '主 App 与 Widget 的 Sources 分别按 target 对应磁盘 .swift', () => {
    const disk = Object.keys(swiftFiles()).sort();
    const main = nativeTargets(objects()).find((obj) => obj.name === 'Jiangshui');
    const widget = nativeTargets(objects()).find((obj) => obj.productType === 'com.apple.product-type.app-extension');
    if (!main) return fail('未找到主 target Jiangshui');
    if (!widget) return fail('未找到 Widget app-extension target');
    const mainCompiled = swiftRefsForTarget(objects(), groupWalk(), main).sort();
    const widgetCompiled = swiftRefsForTarget(objects(), groupWalk(), widget).sort();
    const mainDisk = disk.filter((rel) => rel.indexOf('Jiangshui/') === 0);
    const widgetDisk = disk.filter((rel) => rel.indexOf('JiangshuiWidgets/') === 0);
    // 只允许 JiangshuiWidgets/Shared/ 下的契约文件同时进两个 target；widget 专属视图不得进主 App。
    const sharedDisk = widgetDisk.filter((rel) => rel.indexOf('JiangshuiWidgets/Shared/') === 0);
    const problems = [];
    const duplicateMain = Array.from(new Set(mainCompiled.filter((rel, index, all) => all.indexOf(rel) !== index)));
    const duplicateWidget = Array.from(new Set(widgetCompiled.filter((rel, index, all) => all.indexOf(rel) !== index)));
    const missingMain = mainDisk.filter((rel) => mainCompiled.indexOf(rel) < 0);
    const missingWidget = widgetDisk.filter((rel) => widgetCompiled.indexOf(rel) < 0);
    const uncompiled = disk.filter((rel) => mainCompiled.indexOf(rel) < 0 && widgetCompiled.indexOf(rel) < 0);
    const compiledNoDisk = Array.from(new Set(mainCompiled.concat(widgetCompiled))).filter((rel) => disk.indexOf(rel) < 0);
    const unexpectedMain = mainCompiled.filter((rel) => mainDisk.indexOf(rel) < 0 && sharedDisk.indexOf(rel) < 0);
    const sharedNotMain = sharedDisk.filter((rel) => mainCompiled.indexOf(rel) < 0);
    const sharedNotWidget = sharedDisk.filter((rel) => widgetCompiled.indexOf(rel) < 0);
    if (duplicateMain.length) problems.push('主 App Sources 重复编译：' + truncateList(duplicateMain, 6));
    if (duplicateWidget.length) problems.push('Widget Sources 重复编译：' + truncateList(duplicateWidget, 6));
    if (missingMain.length) problems.push('主 App 磁盘有但未编译：' + truncateList(missingMain, 8));
    if (missingWidget.length) problems.push('Widget 磁盘有但未编译：' + truncateList(missingWidget, 8));
    if (uncompiled.length) problems.push('两个 target 都未编译：' + truncateList(uncompiled, 8));
    if (compiledNoDisk.length) problems.push('编译但磁盘没有：' + truncateList(compiledNoDisk, 8));
    if (unexpectedMain.length) problems.push('主 App 编译了非共享的 Widget 专属文件：' + truncateList(unexpectedMain, 6));
    if (sharedNotMain.length) problems.push('Shared 文件未进主 App：' + truncateList(sharedNotMain, 6));
    if (sharedNotWidget.length) problems.push('Shared 文件未进 Widget：' + truncateList(sharedNotWidget, 6));
    if (problems.length) return fail(truncateList(problems));
    return pass('主 App 磁盘 ' + mainDisk.length + ' 个 / 编译 ' + mainCompiled.length + ' 个；Widget 磁盘 ' + widgetDisk.length + ' 个 / 编译 ' + widgetCompiled.length + ' 个；Shared 双 target ' + sharedDisk.length + ' 个');
  });

  add('A6', '主 App 的 Sources 阶段引用完整且只含 .swift', () => {
    const main = nativeTargets(objects()).find((obj) => obj.name === 'Jiangshui');
    if (!main) return fail('未找到主 target Jiangshui');
    const phases = targetPhases(objects(), main, 'PBXSourcesBuildPhase');
    const problems = [];
    if (phases.length !== 1) problems.push('主 App 的 PBXSourcesBuildPhase 数量应为 1（实际 ' + phases.length + '）');
    let total = 0;
    for (const phase of phases) {
      const seen = new Set();
      for (const buildId of phase.files || []) {
        total++;
        const build = objects()[buildId];
        if (!build || build.isa !== 'PBXBuildFile') { problems.push('buildFile 未定义：' + buildId); continue; }
        if (!build.fileRef || !objects()[build.fileRef]) { problems.push('buildFile 缺 fileRef：' + buildId); continue; }
        if (seen.has(build.fileRef)) problems.push('同一 Sources 阶段重复编译：' + build.fileRef);
        seen.add(build.fileRef);
        const ref = objects()[build.fileRef];
        const name = ref.path || ref.name || '';
        if (!String(name).endsWith('.swift')) problems.push('Sources 含非 .swift 文件：' + name);
      }
    }
    return problems.length ? fail(truncateList(problems)) : pass('主 App Sources 阶段 1 个，buildFile ' + total + ' 个，引用完整');
  });

  add('A7', 'Resources 阶段含 web/PrivacyInfo/Assets/AppIcon', () => {
    const target = Object.values(objects()).find((obj) => obj.isa === 'PBXNativeTarget' && obj.name === 'Jiangshui');
    if (!target) return fail('未找到主 target Jiangshui');
    const phases = (target.buildPhases || []).map((id) => objects()[id]).filter((obj) => obj && obj.isa === 'PBXResourcesBuildPhase');
    const problems = [];
    if (phases.length !== 1) problems.push('主 target 的 PBXResourcesBuildPhase 数量应为 1（实际 ' + phases.length + '）');
    const walk = groupWalk();
    const refsById = new Map(walk.refs.map((ref) => [ref.id, ref]));
    const resources = [];
    const fileIds = phases.length ? (phases[0].files || []) : [];
    for (const buildId of fileIds) {
      const build = objects()[buildId];
      if (!build || !build.fileRef) { problems.push('Resources buildFile 无效：' + buildId); continue; }
      const ref = refsById.get(build.fileRef);
      if (!ref) { problems.push('Resources 引用的文件不在 group 链中：' + build.fileRef); continue; }
      resources.push(ref);
    }
    const expected = [
      'Jiangshui/Resources/PrivacyInfo.xcprivacy',
      'Jiangshui/Resources/Assets.xcassets',
      'Jiangshui/Resources/AppIcon-1024.png'
    ];
    for (const rel of expected) if (!resources.some((ref) => ref.rel === rel)) problems.push('Resources 缺少 ' + rel);
    const web = resources.find((ref) => ref.ref.name === 'web' || ref.rel === '../web');
    if (!web) problems.push('Resources 缺少 web folder reference');
    else {
      if (web.ref.lastKnownFileType !== 'folder') problems.push('web 必须是 folder reference');
      const webAbs = path.resolve(baseRoot, 'ios', web.rel);
      if (!existsSync(webAbs) || !statSync(webAbs).isDirectory()) problems.push('web 目录不存在：' + web.rel);
    }
    return problems.length ? fail(truncateList(problems)) : pass('Resources ' + resources.length + ' 项，含 web folder reference');
  });

  add('A8', 'Debug/Release 构建设置符合版本与 bundle 常量', () => {
    const target = Object.values(objects()).find((obj) => obj.isa === 'PBXNativeTarget' && obj.name === 'Jiangshui');
    if (!target) return fail('未找到主 target Jiangshui');
    const list = objects()[target.buildConfigurationList];
    if (!list || !Array.isArray(list.buildConfigurations)) return fail('target 缺 buildConfigurationList');
    const expected = {
      PRODUCT_BUNDLE_IDENTIFIER: BUNDLE_ID,
      MARKETING_VERSION: MARKETING_VERSION,
      CURRENT_PROJECT_VERSION: CURRENT_PROJECT_VERSION,
      INFOPLIST_FILE: 'Jiangshui/Resources/Info.plist',
      GENERATE_INFOPLIST_FILE: 'NO',
      SWIFT_VERSION: '5.0',
      IPHONEOS_DEPLOYMENT_TARGET: '15.0',
      TARGETED_DEVICE_FAMILY: '1,2',
      ASSETCATALOG_COMPILER_APPICON_NAME: 'AppIcon',
      PRODUCT_NAME: '$(TARGET_NAME)'
    };
    const problems = [];
    const names = [];
    for (const configId of list.buildConfigurations) {
      const config = objects()[configId];
      if (!config) { problems.push('buildConfiguration 未定义：' + configId); continue; }
      names.push(config.name);
      const settings = config.buildSettings || {};
      for (const key of Object.keys(expected)) {
        if (String(settings[key]) !== expected[key]) problems.push(String(config.name) + ' 的 ' + key + ' 应为 ' + expected[key] + '（实际 ' + settings[key] + '）');
      }
    }
    for (const name of ['Debug', 'Release']) if (names.indexOf(name) < 0) problems.push('缺 ' + name + ' 配置');
    return problems.length ? fail(truncateList(problems)) : pass('Debug/Release 10 项设置全部匹配');
  });

  add('A9', 'Info.plist 未被编译或作为资源打包', () => {
    const walk = groupWalk();
    const info = walk.refs.find((ref) => ref.rel === 'Jiangshui/Resources/Info.plist');
    if (!info) return fail('未找到 Info.plist 的 PBXFileReference');
    const problems = [];
    for (const obj of Object.values(objects())) {
      if (obj.isa !== 'PBXSourcesBuildPhase' && obj.isa !== 'PBXResourcesBuildPhase') continue;
      for (const buildId of obj.files || []) {
        const build = objects()[buildId];
        if (build && build.fileRef === info.id) problems.push('Info.plist 出现在 ' + obj.isa + ' 中');
      }
    }
    return problems.length ? fail(truncateList(problems)) : pass('Info.plist 仅作为文件引用存在');
  });

  add('A10', 'pbxproj 中的 $(...) 必须加双引号', () => {
    const text = pbxText();
    const lines = text.split('\n');
    const problems = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const occurrences = (line.match(/\$\(/g) || []).length;
      if (!occurrences) continue;
      const quoted = (line.match(/"\$\([^"]*\)"/g) || []).length;
      if (quoted < occurrences) {
        problems.push('第 ' + (index + 1) + ' 行：' + line.trim() + '（应写成 "$(X)"）');
      }
    }
    if (problems.length) {
      return fail(truncateList(problems) + '；修复：gen-pbxproj.mjs 的 Q() 对含 "$(" 的值强制加引号后重新生成');
    }
    return pass('所有 $(...) 均已加双引号');
  });

  add('A11', 'Widget 扩展结构：依赖/嵌入/Info.plist/16.1/ActivityConfiguration', () => {
    const targets = nativeTargets(objects());
    const main = targets.find((obj) => obj.name === 'Jiangshui');
    const widget = targets.find((obj) => obj.productType === 'com.apple.product-type.app-extension');
    if (!main) return fail('未找到主 target Jiangshui');
    if (!widget) return fail('未找到 Widget app-extension target');
    if (targets.length < 2) return fail('PBXNativeTarget 少于 2 个');
    const problems = [];
    const objIds = Object.keys(objects());
    const mainId = objIds.find((id) => objects()[id] === main);
    const widgetId = objIds.find((id) => objects()[id] === widget);
    if (widget.name !== 'JiangshuiWidgetsExtension') problems.push('Widget target 名称应为 JiangshuiWidgetsExtension（实际 ' + widget.name + '）');

    const product = objects()[widget.productReference];
    if (!product || product.isa !== 'PBXFileReference') problems.push('Widget target 缺 PBXFileReference productReference');
    else {
      if (!String(product.path || '').endsWith('.appex')) problems.push('Widget product 路径应以 .appex 结尾（实际 ' + product.path + '）');
      if (product.explicitFileType !== 'wrapper.app-extension') problems.push('Widget product explicitFileType 应为 wrapper.app-extension（实际 ' + product.explicitFileType + '）');
    }

    const deps = (main.dependencies || []).map((id) => objects()[id]).filter(Boolean);
    const dep = deps.find((item) => item.isa === 'PBXTargetDependency' && item.target === widgetId);
    if (!dep) problems.push('主 target 缺指向 Widget 的 PBXTargetDependency');
    else {
      const proxy = objects()[dep.targetProxy];
      if (!proxy || proxy.isa !== 'PBXContainerItemProxy') problems.push('PBXTargetDependency 缺 PBXContainerItemProxy');
      else {
        if (proxy.containerPortal !== pbx().rootObject) problems.push('PBXContainerItemProxy containerPortal 应指向工程 rootObject');
        if (Number(proxy.proxyType) !== 1) problems.push('PBXContainerItemProxy proxyType 应为 1（实际 ' + proxy.proxyType + '）');
        if (proxy.remoteGlobalIDString !== widgetId) problems.push('PBXContainerItemProxy remoteGlobalIDString 应指向 Widget target');
      }
    }

    const mainPhases = (main.buildPhases || []).map((id) => objects()[id]).filter(Boolean);
    const embedPhases = mainPhases.filter((phase) => phase.isa === 'PBXCopyFilesBuildPhase' && Number(phase.dstSubfolderSpec) === 13);
    if (embedPhases.length !== 1) problems.push('主 target 应有 1 个 dstSubfolderSpec=13 的 PBXCopyFilesBuildPhase（实际 ' + embedPhases.length + '）');
    else {
      const refs = (embedPhases[0].files || []).map((id) => {
        const build = objects()[id];
        return build && build.fileRef;
      }).filter(Boolean);
      if (refs.indexOf(widget.productReference) < 0) problems.push('嵌入阶段未包含 Widget .appex buildFile');
    }

    const configIds = (objects()[widget.buildConfigurationList] || {}).buildConfigurations || [];
    const configNames = [];
    for (const configId of configIds) {
      const config = objects()[configId];
      if (!config) { problems.push('Widget buildConfiguration 未定义：' + configId); continue; }
      configNames.push(config.name);
      const settings = config.buildSettings || {};
      const deployment = Number(settings.IPHONEOS_DEPLOYMENT_TARGET);
      if (!(deployment >= 16.1)) problems.push(String(config.name) + ' 的 Widget deployment target 应 ≥16.1（实际 ' + settings.IPHONEOS_DEPLOYMENT_TARGET + '）');
      if (String(settings.INFOPLIST_FILE) !== 'JiangshuiWidgets/Info.plist') problems.push(String(config.name) + ' 的 INFOPLIST_FILE 应为 JiangshuiWidgets/Info.plist（实际 ' + settings.INFOPLIST_FILE + '）');
      const bundle = String(settings.PRODUCT_BUNDLE_IDENTIFIER || '');
      if (!bundle.startsWith(BUNDLE_ID + '.')) problems.push(String(config.name) + ' 的 Widget bundle id 应以 ' + BUNDLE_ID + '. 开头（实际 ' + bundle + '）');
      if (bundle === BUNDLE_ID) problems.push('Widget bundle id 不得与主 App 相同');
    }
    for (const name of ['Debug', 'Release']) if (configNames.indexOf(name) < 0) problems.push('Widget target 缺 ' + name + ' 配置');

    const widgetInfo = path.join(baseRoot, 'ios', 'JiangshuiWidgets', 'Info.plist');
    if (!existsSync(widgetInfo)) problems.push('缺 JiangshuiWidgets/Info.plist');
    else {
      try {
        const plist = parseXmlPlist(readText(widgetInfo));
        const extension = plist.NSExtension;
        if (!extension || typeof extension !== 'object') problems.push('Widget Info.plist 缺 NSExtension');
        else if (extension.NSExtensionPointIdentifier !== 'com.apple.widgetkit-extension') problems.push('Widget NSExtensionPointIdentifier 应为 com.apple.widgetkit-extension（实际 ' + extension.NSExtensionPointIdentifier + '）');
      } catch (e) {
        problems.push('Widget Info.plist 解析失败：' + (e && e.message ? e.message : String(e)));
      }
    }

    const widgetDisk = Object.keys(swiftFiles()).filter((rel) => rel.indexOf('JiangshuiWidgets/') === 0).sort();
    const widgetCompiled = swiftRefsForTarget(objects(), groupWalk(), widget).sort();
    if (!widgetDisk.length) problems.push('Widget 扩展没有 .swift 源码');
    const widgetPhases = targetPhases(objects(), widget, 'PBXSourcesBuildPhase');
    if (widgetPhases.length !== 1) problems.push('Widget target 的 PBXSourcesBuildPhase 数量应为 1（实际 ' + widgetPhases.length + '）');
    const widgetCode = widgetDisk.map((rel) => stripSwift(swiftFiles()[rel])).join('\n');
    if (!/@main\b/.test(widgetCode)) problems.push('Widget 源码缺 @main');
    if (!/\bWidgetBundle\b/.test(widgetCode)) problems.push('Widget 源码缺 WidgetBundle');
    if (!/\bActivityConfiguration\s*\(/.test(widgetCode)) problems.push('Widget 源码缺 ActivityConfiguration(');

    const sharedFiles = widgetDisk.filter((rel) => rel.indexOf('JiangshuiWidgets/Shared/') === 0);
    if (!sharedFiles.length) problems.push('缺共享 ActivityAttributes（JiangshuiWidgets/Shared/）');
    const attrRel = sharedFiles.find((rel) => /ClassActivityAttributes\.swift$/.test(rel));
    if (!attrRel) problems.push('缺 ClassActivityAttributes.swift');
    else {
      const attrCode = stripSwift(swiftFiles()[attrRel]);
      if (!/@available\s*\(\s*iOS\s+16\.1\s*,\s*\*\s*\)/.test(attrCode)) problems.push('ClassActivityAttributes 缺 @available(iOS 16.1, *)');
      if (!/\bActivityAttributes\b/.test(attrCode)) problems.push('ClassActivityAttributes 未声明 ActivityAttributes');
      if (widgetCompiled.indexOf(attrRel) < 0) problems.push('ClassActivityAttributes 未进 Widget target');
      const mainCompiled = swiftRefsForTarget(objects(), groupWalk(), main);
      if (mainCompiled.indexOf(attrRel) < 0) problems.push('ClassActivityAttributes 未进主 App target');
    }

    return problems.length ? fail(truncateList(problems)) : pass('依赖/嵌入/扩展 plist/16.1/WidgetBundle/ActivityConfiguration/共享 Attributes 均在位');
  });

  // B. action 三向对齐与同意门
  add('B1', '契约 §3 解析出 35 个 action 且编号 1..35 连续', () => {
    const parsed = contractActions();
    const problems = [];
    if (parsed.count !== ACTION_COUNT) problems.push('action 数量 ' + parsed.count + '，应为 ' + ACTION_COUNT);
    if (new Set(parsed.actions).size !== parsed.actions.length) problems.push('action 有重复');
    const numbers = expandNumberRanges(parsed.numbers);
    if (numbers.length !== ACTION_COUNT) problems.push('编号覆盖 ' + numbers.length + ' 行，应为 ' + ACTION_COUNT);
    for (let k = 0; k < ACTION_COUNT; k++) if (numbers[k] !== k + 1) { problems.push('编号不连续：第 ' + (k + 1) + ' 个是 ' + numbers[k]); break; }
    for (const action of parsed.actions) if (!/^[a-z][A-Za-z0-9]*$/.test(action)) problems.push('非法 action：' + action);
    return problems.length ? fail(truncateList(problems)) : pass('35 个 action，编号连续');
  });

  add('B2', 'Android switch 解析出 35 个 case', () => {
    const parsed = androidActions();
    const problems = [];
    if (parsed.cases.length !== ACTION_COUNT) problems.push('case 数量 ' + parsed.cases.length + '，应为 ' + ACTION_COUNT);
    if (new Set(parsed.cases).size !== parsed.cases.length) problems.push('case 有重复');
    return problems.length ? fail(truncateList(problems)) : pass('MainActivity switch case=35');
  });

  add('B3', 'BridgeDispatcher switch 解析出 35 个 case', () => {
    const parsed = iosActions();
    const problems = [];
    if (parsed.cases.length !== ACTION_COUNT) problems.push('case 数量 ' + parsed.cases.length + '，应为 ' + ACTION_COUNT);
    if (new Set(parsed.cases).size !== parsed.cases.length) problems.push('case 有重复');
    return problems.length ? fail(truncateList(problems)) : pass('BridgeDispatcher switch case=35');
  });

  add('B4', '契约/Android/iOS action 集合完全一致', () => {
    const sets = { contract: contractActions().actions, android: androidActions().cases, ios: iosActions().cases };
    const problems = [];
    for (const name of Object.keys(sets)) {
      if (new Set(sets[name]).size !== sets[name].length) problems.push(name + ' 内部有重复');
    }
    for (const action of sets.contract) {
      if (sets.android.indexOf(action) < 0) problems.push('Android 缺 ' + action);
      if (sets.ios.indexOf(action) < 0) problems.push('iOS 缺 ' + action);
    }
    for (const action of sets.android) if (sets.contract.indexOf(action) < 0) problems.push('Android 多 ' + action);
    for (const action of sets.ios) if (sets.contract.indexOf(action) < 0) problems.push('iOS 多 ' + action);
    return problems.length ? fail(truncateList(problems)) : pass('三向集合一致，共 ' + ACTION_COUNT + ' 个');
  });

  add('B5', '契约/Android/iOS action 顺序完全一致', () => {
    const contract = contractActions().actions;
    const android = androidActions().cases;
    const ios = iosActions().cases;
    const problems = [];
    const compare = (name, list) => {
      if (list.length !== contract.length) { problems.push(name + ' 数量 ' + list.length + ' 与契约 ' + contract.length + ' 不同'); return; }
      for (let k = 0; k < contract.length; k++) if (list[k] !== contract[k]) { problems.push(name + ' 第 ' + (k + 1) + ' 个是 ' + list[k] + '，契约是 ' + contract[k]); return; }
    };
    compare('Android', android);
    compare('iOS', ios);
    return problems.length ? fail(truncateList(problems)) : pass('三向顺序一致');
  });

  add('B6', '未知 action 走 default 返回「不支持的操作」', () => {
    const iosParsed = iosActions();
    const androidParsed = androidActions();
    const problems = [];
    if (!iosParsed.hasDefault) problems.push('iOS switch 缺 default');
    if (iosParsed.defaultText.indexOf('不支持的操作') < 0) problems.push('iOS default 文案不是「不支持的操作」');
    if (!/replyFailure\s*\(/.test(iosParsed.defaultText)) problems.push('iOS default 未调用 replyFailure');
    if (/(^|[^A-Za-z])reply\s*\(/.test(iosParsed.defaultText)) problems.push('iOS default 出现成功回包 reply(');
    if (!androidParsed.hasDefault) problems.push('Android switch 缺 default');
    if (androidParsed.defaultText.indexOf('不支持的操作') < 0) problems.push('Android default 文案不是「不支持的操作」');
    if (!/failure\s*\(/.test(androidParsed.defaultText)) problems.push('Android default 未调用 failure');
    const iosDefaults = (iosParsed.block.match(/(?:^|\n)\s*default\s*:/g) || []).length;
    if (iosDefaults !== 1) problems.push('iOS default 分支数量应为 1（实际 ' + iosDefaults + '）');
    const androidDefaults = (androidParsed.block.match(/(?:^|\n)\s*default\s*:/g) || []).length;
    if (androidDefaults !== 1) problems.push('Android default 分支数量应为 1（实际 ' + androidDefaults + '）');
    return problems.length ? fail(truncateList(problems)) : pass('两端 default 均失败返回「不支持的操作」，无静默成功');
  });

  add('B7', '4 个免同意白名单真实绕过 requireAgreed（三处一致）', () => {
    const text = dispatcherText();
    const masked = dispatcherMasked();
    const problems = [];
    const m = /consentFreeActions\s*:\s*Set<String>\s*=\s*\[([\s\S]*?)\]/.exec(text);
    if (!m) return fail('未找到 consentFreeActions 声明');
    const swiftList = [];
    const listRe = /"([^"]+)"/g;
    let lm;
    while ((lm = listRe.exec(m[1]))) swiftList.push(lm[1]);
    const expected = CONSENT_FREE_ACTIONS.slice().sort();
    const actual = swiftList.slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push('iOS 白名单为 ' + actual.join(',') + '，应为 ' + expected.join(','));
    const guard = /if\s*!\s*BridgeDispatcher\.consentFreeActions\.contains\(action\)\s*\{[\s\S]{0,300}?try\s+services\.consent\.requireAgreed\(\)/.exec(masked);
    if (!guard) problems.push('requireAgreed 未被 !consentFreeActions.contains(action) 保护');
    const requireCount = (masked.match(/requireAgreed\s*\(/g) || []).length;
    if (requireCount !== 1) problems.push('requireAgreed 调用点应只有 1 处（实际 ' + requireCount + '）');
    const guardIndex = masked.indexOf('requireAgreed(');
    const switchIndex = masked.indexOf('switch action');
    if (guardIndex < 0 || switchIndex < 0 || guardIndex > switchIndex) problems.push('requireAgreed 必须位于 switch action 之前');
    const androidSource = androidMain();
    const androidMasked = stripJava(androidSource);
    const requireIndex = androidSource.indexOf('UserConsent.require');
    let whitelistRaw = '';
    const androidListRe = /Arrays\.asList\(([^)]*)\)/g;
    let listMatch;
    while ((listMatch = androidListRe.exec(androidSource))) {
      if (requireIndex >= 0 && listMatch.index < requireIndex && listMatch[1].indexOf('consentStatus') >= 0) whitelistRaw = listMatch[1];
    }
    if (!whitelistRaw) problems.push('Android 未找到同意白名单 Arrays.asList');
    else {
      const androidList = [];
      const are = /"([^"]+)"/g;
      let ar;
      while ((ar = are.exec(whitelistRaw))) androidList.push(ar[1]);
      if (JSON.stringify(androidList.slice().sort()) !== JSON.stringify(expected)) problems.push('Android 白名单为 ' + androidList.join(',') + '，应为 ' + expected.join(','));
    }
    const requireCall = androidMasked.search(/UserConsent\.require\s*\(/);
    const aswitch = androidMasked.search(/switch\s*\(\s*action\s*\)/);
    if (requireCall < 0) problems.push('Android 未调用 UserConsent.require');
    else if (aswitch < 0 || requireCall > aswitch) problems.push('Android 同意校验必须位于 switch 之前');
    return problems.length ? fail(truncateList(problems)) : pass('白名单 4 项一致，两端均先校验后 switch');
  });

  // C. Swift 静态闭合
  add('C1', 'Swift import 仅使用系统框架', () => {
    const problems = [];
    const seen = new Set();
    for (const rel of Object.keys(swiftFiles())) {
      const masked = stripSwift(swiftFiles()[rel]);
      const re = /^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)/gm;
      let m;
      while ((m = re.exec(masked))) {
        const moduleName = m[1];
        seen.add(moduleName);
        if (!SWIFT_IMPORT_ALLOWLIST.has(moduleName)) problems.push(rel + ': ' + moduleName);
      }
    }
    return problems.length ? fail('非系统框架 import：' + truncateList(problems)) : pass('import 模块：' + Array.from(seen).sort().join(', '));
  });

  add('C2', 'ServiceProtocols 每个协议都有实现且 SessionVaulting 唯一', () => {
    const problems = [];
    const names = Object.keys(protocols());
    if (names.length !== 15) problems.push('协议数量应为 15（实际 ' + names.length + '）');
    for (const name of names) {
      const impls = conformances()[name] || [];
      if (!impls.length) problems.push('协议 ' + name + ' 没有 conformance');
    }
    const vault = conformances().SessionVaulting || [];
    if (vault.length !== 1) problems.push('SessionVaulting 实现数量应为 1（实际 ' + vault.length + '）');
    else if (vault[0].file !== 'Jiangshui/Services/SchoolSession.swift') problems.push('SessionVaulting 唯一实现应在 Services/SchoolSession.swift（实际 ' + vault[0].file + '）');
    return problems.length ? fail(truncateList(problems)) : pass('15 个协议均有实现；SessionVaulting 唯一实现在 SchoolSession.swift');
  });

  add('C3', 'NativeServices 的 13 个成员与协议声明名称/类型一致', () => {
    const expected = protocols().NativeServicesProviding ? protocols().NativeServicesProviding.vars : {};
    const actual = parsePublicVars(swiftFiles()['Jiangshui/Services/NativeServices.swift'] || '');
    const problems = [];
    for (const key of Object.keys(expected)) {
      if (!(key in actual)) problems.push('NativeServices 缺 ' + key);
      else if (actual[key] !== expected[key]) problems.push(key + ' 类型 ' + actual[key] + '，应为 ' + expected[key]);
    }
    for (const key of Object.keys(actual)) if (!(key in expected)) problems.push('NativeServices 多出 ' + key);
    if (Object.keys(expected).length !== 13) problems.push('协议成员数应为 13（实际 ' + Object.keys(expected).length + '）');
    return problems.length ? fail(truncateList(problems)) : pass('13 个成员名称与类型完全一致');
  });

  add('C4', 'BridgeDispatcher 只访问 NativeServicesProviding 声明的成员', () => {
    const expected = protocols().NativeServicesProviding ? protocols().NativeServicesProviding.vars : {};
    const used = new Set();
    const re = /services\.([A-Za-z_]\w*)/g;
    let m;
    while ((m = re.exec(dispatcherMasked()))) used.add(m[1]);
    const problems = [];
    for (const member of used) if (!(member in expected)) problems.push('未声明成员 services.' + member);
    const unused = Object.keys(expected).filter((key) => !used.has(key));
    return problems.length ? fail(truncateList(problems)) : pass('使用 ' + used.size + ' 个成员' + (unused.length ? '，未使用：' + unused.join(',') : ''));
  });

  add('C5', 'services.<成员>.<方法> 均在协议声明且参数标签一致', () => {
    const expected = protocols().NativeServicesProviding ? protocols().NativeServicesProviding.vars : {};
    const calls = extractServiceCalls(dispatcherMasked());
    const problems = [];
    for (const call of calls) {
      const protocolName = expected[call.member];
      if (!protocolName) { problems.push('第 ' + call.line + ' 行：成员 ' + call.member + ' 未声明'); continue; }
      const protocol = protocols()[protocolName];
      if (!protocol) { problems.push('第 ' + call.line + ' 行：协议 ' + protocolName + ' 未声明'); continue; }
      const method = protocol.methods[call.method];
      if (!method) { problems.push('第 ' + call.line + ' 行：' + protocolName + '.' + call.method + ' 未声明'); continue; }
      if (method.labels.join(',') !== call.labels.join(',')) problems.push('第 ' + call.line + ' 行：' + call.member + '.' + call.method + ' 标签 [' + call.labels.join(',') + ']，协议为 [' + method.labels.join(',') + ']');
    }
    return problems.length ? fail(truncateList(problems)) : pass('检查 ' + calls.length + ' 个服务调用点，协议与标签全部匹配');
  });

  add('C6', '桥接三文件无强解包 / fatalError', () => {
    const targets = ['Jiangshui/Web/JSBridge.swift', 'Jiangshui/Web/WebHost.swift', 'Jiangshui/Web/BridgeDispatcher.swift'];
    const problems = [];
    for (const rel of targets) {
      const text = swiftFiles()[rel];
      if (!text) { problems.push('文件缺失：' + rel); continue; }
      const hits = findForceUnwraps(stripSwift(text));
      for (const hit of hits) problems.push(rel + ':' + hit.line + ' [' + hit.kinds.join('+') + '] ' + hit.text);
    }
    return problems.length ? fail(truncateList(problems, 12)) : pass('3 个桥接文件无 ! / try! / as! / fatalError');
  });

  add('C7', 'Swift 文件括号配平且 import 位于声明之前', () => {
    const problems = [];
    for (const rel of Object.keys(swiftFiles())) {
      const text = swiftFiles()[rel];
      const masked = stripSwift(text);
      const counts = { brace: 0, paren: 0, bracket: 0 };
      const pairs = { '{': 'brace', '}': 'brace', '(': 'paren', ')': 'paren', '[': 'bracket', ']': 'bracket' };
      let negative = '';
      for (const ch of masked) {
        if (!pairs[ch]) continue;
        counts[pairs[ch]] += (ch === '{' || ch === '(' || ch === '[') ? 1 : -1;
        if (!negative && (counts.brace < 0 || counts.paren < 0 || counts.bracket < 0)) negative = ch;
      }
      if (negative) problems.push(rel + ' 括号提前闭合（' + negative + '）');
      else if (counts.brace || counts.paren || counts.bracket) problems.push(rel + ' 括号不配平 {=' + counts.brace + ' (= ' + counts.paren + ' [=' + counts.bracket);
      const lines = text.split('\n');
      let firstDecl = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*(?:(?:public|internal|private|fileprivate|open|final|@\w+)\s+)*(?:class|struct|enum|extension|protocol|func|let|var|typealias)\s+/.test(lines[i])) { firstDecl = i; break; }
      }
      for (let i = 0; i < lines.length; i++) {
        if (/^\s*import\s+/.test(lines[i]) && firstDecl >= 0 && i > firstDecl) {
          problems.push(rel + ' 第 ' + (i + 1) + ' 行 import 在声明之后');
          break;
        }
      }
    }
    return problems.length ? fail(truncateList(problems, 12)) : pass('全部 ' + Object.keys(swiftFiles()).length + ' 个 Swift 文件括号配平、import 位置正确');
  });

  add('C8', 'ScheduleDayResolver 依赖的 JSONCompat 辅助均已声明', () => {
    const resolver = swiftFiles()['Jiangshui/Services/ScheduleDayResolver.swift'];
    const compat = swiftFiles()['Jiangshui/Services/JSONCompat.swift'];
    if (!resolver || !compat) return fail('ScheduleDayResolver.swift 或 JSONCompat.swift 缺失');
    const maskedResolver = stripSwift(resolver);
    const maskedCompat = stripSwift(compat);
    const used = new Set();
    let m;
    const staticRe = /JSONCompat\.([A-Za-z_]\w*)/g;
    while ((m = staticRe.exec(maskedResolver))) used.add(m[1]);
    const methodRe = /\.(opt[A-Za-z]+|hasKey)\s*\(/g;
    while ((m = methodRe.exec(maskedResolver))) used.add(m[1]);
    const problems = [];
    for (const name of used) {
      const declared = new RegExp('\\b(?:func|static\\s+func)\\s+' + name + '\\s*\\(').test(maskedCompat);
      if (!declared) problems.push('JSONCompat 缺 ' + name);
    }
    return problems.length ? fail(truncateList(problems)) : pass('引用 ' + Array.from(used).sort().join(', ') + ' 均有声明');
  });

  // D. Info.plist / PrivacyInfo
  add('D1', 'Info.plist / PrivacyInfo / 3 个 Assets JSON 均可解析', () => {
    const problems = [];
    try { if (!infoPlist() || typeof infoPlist() !== 'object') problems.push('Info.plist 根节点无效'); } catch (e) { problems.push('Info.plist: ' + e.message); }
    try { if (!privacyManifest() || typeof privacyManifest() !== 'object') problems.push('PrivacyInfo 根节点无效'); } catch (e) { problems.push('PrivacyInfo: ' + e.message); }
    const assets = [
      'Jiangshui/Resources/Assets.xcassets/Contents.json',
      'Jiangshui/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json',
      'Jiangshui/Resources/Assets.xcassets/AccentColor.colorset/Contents.json'
    ];
    for (const rel of assets) {
      try {
        const parsed = JSON.parse(readText(path.join(baseRoot, 'ios', rel)));
        if (!parsed || typeof parsed !== 'object') problems.push(rel + ' 根节点无效');
      } catch (e) {
        problems.push(rel + ': ' + e.message);
      }
    }
    try {
      const icon = JSON.parse(readText(path.join(baseRoot, 'ios', assets[1])));
      if (!icon.images || !icon.images.length || icon.images[0].filename !== 'AppIcon-1024.png') problems.push('AppIcon Contents.json 未指向 AppIcon-1024.png');
      if (!existsSync(path.join(baseRoot, 'ios', 'Jiangshui/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png'))) problems.push('AppIcon-1024.png 不存在');
    } catch (e) {
      if (problems.indexOf(e.message) < 0) problems.push('AppIcon: ' + e.message);
    }
    return problems.length ? fail(truncateList(problems)) : pass('Info.plist / PrivacyInfo / 3 个 Assets JSON 解析合法');
  });

  add('D2', 'Info.plist 版本宏、bundle 显示名与启动屏键正确', () => {
    const problems = checkInfoPlistCore(infoPlist());
    return problems.length ? fail(truncateList(problems)) : pass('版本宏、CFBundleDisplayName、UILaunchScreen、SceneManifest 均正确');
  });

  add('D3', 'ATS：本地网络 + 7 个域 + 5 教务域 insecure，无 ArbitraryLoads', () => {
    const problems = checkAts(infoPlist());
    return problems.length ? fail(truncateList(problems)) : pass('7 个 ATS 域配置完整，未开启 NSAllowsArbitraryLoads');
  });

  add('D4', 'BGTask 两个登记 id + 主 App 注册/预排/到期清理代码在位', () => {
    const problems = checkBackground(infoPlist()).filter((item) => item.indexOf('UIBackgroundModes') < 0);
    const app = swiftFiles()['Jiangshui/App/JiangshuiApp.swift'] || '';
    const appCode = stripSwift(app);
    const reminder = swiftFiles()['Jiangshui/Services/ClassReminderService.swift'] || '';
    const reminderCode = stripSwift(reminder);
    const need = (ok, message) => { if (!ok) problems.push(message); };
    need(/static\s+let\s+taskIdentifier\s*=\s*"cn\.local\.tomorrow\.class-reminder"/.test(app), '主 App 未登记 class-reminder 任务 id');
    need(/BGTaskScheduler\.shared\.register\s*\([\s\S]{0,160}?forTaskWithIdentifier\s*:\s*BackgroundReminderScheduler\.taskIdentifier/.test(appCode), '主 App 未调用 BGTaskScheduler.register');
    need(appCode.indexOf('BGAppRefreshTask') >= 0, '后台任务未转成 BGAppRefreshTask');
    need(appCode.indexOf('expirationHandler') >= 0, '后台任务缺 expirationHandler');
    need(appCode.indexOf('setTaskCompleted') >= 0, '后台任务缺 setTaskCompleted');
    need(reminderCode.indexOf('UNCalendarNotificationTrigger') >= 0, '上课提醒未使用 UNCalendarNotificationTrigger 预排');
    need(reminderCode.indexOf('removeDeliveredNotifications') >= 0, '上课提醒缺 removeDeliveredNotifications 到期清理');
    need(reminderCode.indexOf('cleanupExpiredDelivered') >= 0, '上课提醒缺 cleanupExpiredDelivered 入口');
    need(/let\s+candidates\s*=\s*plan\.filter[\s\S]{0,200}?\.sorted\s*\{\s*\$0\.showAt\s*<\s*\$1\.showAt\s*\}/.test(reminderCode), 'reconcile 未按 showAt 升序筛选未来窗口内的事件');
    need(/for\s+event\s+in\s+candidates\.prefix\(60\)/.test(reminderCode), 'reconcile 未遍历候选事件（≤60 条）');
    need(/var\s+leadMinutes\s*=\s*30/.test(reminderCode) && /var\s+afterStartMinutes\s*=\s*5/.test(reminderCode), '默认提前量不是 lead 30 / afterStart 5');
    return problems.length ? fail(truncateList(problems)) : pass('两个 BGTask id 已登记；注册、预排、到期清理代码在位');
  });

  add('D5', 'UIBackgroundModes 含 fetch 与 processing', () => {
    const modes = infoPlist().UIBackgroundModes;
    const problems = [];
    if (!Array.isArray(modes)) problems.push('UIBackgroundModes 必须是数组');
    else for (const mode of ['fetch', 'processing']) if (modes.indexOf(mode) < 0) problems.push('缺少 ' + mode);
    return problems.length ? fail(truncateList(problems)) : pass('UIBackgroundModes=' + JSON.stringify(modes));
  });

  add('D6', '日历/定位权限文案为中文且非空', () => {
    const problems = checkUsageDescriptions(infoPlist());
    return problems.length ? fail(truncateList(problems)) : pass('4 条用途文案均为中文非空');
  });

  add('D7', 'PrivacyInfo.xcprivacy 结构与 Required Reason 合法', () => {
    const problems = checkPrivacyManifest(privacyManifest());
    return problems.length ? fail(truncateList(problems)) : pass('tracking=false、无采集、2 类 Required Reason API 合法');
  });

  // E. 禁改基线
  add('E1', 'web/ + android/ 入库源码文件数仍为 182（不含 apk/zip 构建产物）', () => {
    const data = baseline();
    if (data.count !== EXPECTED_BASELINE_COUNT) {
      return fail('文件数 ' + data.count + '，应为 ' + EXPECTED_BASELINE_COUNT + '；共享层可能被改动');
    }
    return pass('文件数 ' + data.count);
  });

  add('E2', 'web/ + android/ 基线哈希未变', () => {
    const data = baseline();
    if (data.hash !== EXPECTED_BASELINE) {
      return fail('哈希 ' + data.hash + '，应为 ' + EXPECTED_BASELINE + '（文本模式参考值 ' + data.textHash + '）');
    }
    return pass('sha256=' + data.hash);
  });

  // F. 常量与桥接协议逐字
  add('F1', 'loopback 端口 47851..47860 且只监听 127.0.0.1', () => {
    const text = localserverText();
    const problems = [];
    if (!/firstPort\s*:\s*UInt16\s*=\s*47851/.test(text)) problems.push('firstPort 不是 47851');
    if (!/lastPort(?:\s*:\s*UInt16)?\s*=\s*47860/.test(text)) problems.push('lastPort 不是 47860');
    if (text.indexOf('0.0.0.0') >= 0) problems.push('出现 0.0.0.0');
    if (!/host:\s*"127\.0\.0\.1"/.test(text)) problems.push('NWEndpoint 未使用 127.0.0.1');
    if (text.indexOf('http://127.0.0.1:') < 0 && webhostText().indexOf('http://127.0.0.1:') < 0) problems.push('WebHost 未使用 127.0.0.1 本地地址');
    return problems.length ? fail(truncateList(problems)) : pass('47851..47860，仅监听 127.0.0.1');
  });

  add('F2', 'WKScriptMessageHandler 名称为 jiangshuiBridge 且 WebHost 使用 JSBridge.handlerName', () => {
    const problems = [];
    if (!/static let handlerName\s*=\s*"jiangshuiBridge"/.test(jsbridgeText())) problems.push('JSBridge.handlerName 不是 jiangshuiBridge');
    if (!/controller\.add\([^,]+,\s*name:\s*JSBridge\.handlerName\)/.test(webhostText())) problems.push('WebHost 未用 JSBridge.handlerName 注册 handler');
    return problems.length ? fail(truncateList(problems)) : pass('handlerName=jiangshuiBridge，注册处引用同一常量');
  });

  add('F3', '注入 shim 逐字符合契约（window.Android.request + systemDarkMode）', () => {
    const problems = analyzeShim(jsbridgeText());
    return problems.length ? fail(truncateList(problems)) : pass('shim 逐字片段齐全，atDocumentStart + mainFrameOnly');
  });

  add('F4', 'onNativeResult 回包形状与去重', () => {
    const text = jsbridgeText();
    const problems = [];
    if (text.indexOf('window.onNativeResult(') < 0) problems.push('缺少 window.onNativeResult(');
    if (!/\["value"\s*:\s*payload\]/.test(text)) problems.push('成功回包不是 ["value": payload]');
    if (!/\["error"\s*:/.test(text)) problems.push('失败回包不是 ["error": ...]');
    if (text.indexOf('isValidJSONObject') < 0) problems.push('回包未校验 isValidJSONObject');
    if (text.indexOf('markAnswered') < 0) problems.push('缺少 markAnswered 去重');
    if (!/answeredLimit\s*=\s*2000/.test(text)) problems.push('去重上限不是 2000');
    if (text.indexOf('"操作失败"') < 0) problems.push('缺少兜底文案「操作失败」');
    return problems.length ? fail(truncateList(problems)) : pass('{value}/{error} 形状、去重与兜底文案齐全');
  });

  add('F5', '返回键：__dsjOnBack 表达式逐字 + 左边缘手势替代浮动按钮', () => {
    const expected = '(function(){try{return window.__dsjOnBack?window.__dsjOnBack()===true:false}catch(e){return false}})()';
    const text = webhostText();
    const problems = [];
    if (text.indexOf(expected) < 0) problems.push('WebHost 未包含契约要求的逐字表达式：' + expected);
    if (!/UIScreenEdgePanGestureRecognizer\s*\(target:\s*self/.test(text)) problems.push('WebHost 未安装 UIScreenEdgePanGestureRecognizer');
    if (!/edgePan\.edges\s*=\s*\.left/.test(text)) problems.push('边缘手势未限定为左边缘');
    if (!/handleEdgePan/.test(text)) problems.push('缺少 handleEdgePan 手势回调');
    // run #9 截图问题：浮动返回按钮压在页面标题上，已改为边缘手势；这里防止回归。
    const view = rootViewText();
    if (/backButton|chevron\.left/.test(view)) problems.push('RootView 又出现浮动返回按钮（会压住页面标题）');
    return problems.length ? fail(truncateList(problems)) : pass('返回表达式逐字匹配，改用左边缘右划手势');
  });

  add('F6', '前台恢复调用 window.onNativeResume', () => {
    if (webhostText().indexOf('window.onNativeResume&&window.onNativeResume()') < 0) return fail('缺少 window.onNativeResume&&window.onNativeResume()');
    return pass('onNativeResume 调用存在');
  });

  add('F7', '同意门三句文案与 agreement.json 动态版本读取', () => {
    const text = consentText();
    const problems = [];
    for (const message of ['请先阅读并同意用户协议', '协议已更新，请重新打开应用确认', '协议确认无法保存，请重试']) {
      if (text.indexOf(message) < 0) problems.push('缺少文案：' + message);
    }
    if (!/forResource:\s*"agreement"/.test(text) || !/subdirectory:\s*"web"/.test(text)) problems.push('agreement.json 必须从 bundle 的 web/ 目录读取');
    if (text.indexOf('"1.3.1"') >= 0) problems.push('协议版本疑似硬编码');
    return problems.length ? fail(truncateList(problems)) : pass('三句文案齐全，版本来自 web/agreement.json');
  });

  add('F8', 'P2 教务真实读取：状态机四阶段 + 假条直连同步（无残留桩）', () => {
    const problems = [];
    const provider = schoolText();
    const providerCode = stripSwift(provider);
    const controller = swiftFiles()['Jiangshui/School/SchoolReadController.swift'] || '';
    const leave = swiftFiles()['Jiangshui/School/LeaveRecordsService.swift'] || '';
    const schoolHost = swiftFiles()['Jiangshui/School/SchoolWebViewHost.swift'] || '';
    if (!controller) problems.push('缺少 Jiangshui/School/SchoolReadController.swift');
    if (!leave) problems.push('缺少 Jiangshui/School/LeaveRecordsService.swift');
    // 按函数名截取函数体（在去字符串/注释的代码上配平花括号，再按同偏移回切原文），
    // 这样断言不会跨函数误命中，也不依赖调用点的 self./await/空白写法。
    const bodyOf = (name) => {
      const m = new RegExp('func\\s+' + name + '\\s*\\(').exec(providerCode);
      if (!m) return '';
      const open = providerCode.indexOf('{', m.index);
      if (open < 0) return '';
      const close = matchBalanced(providerCode, open);
      return close > open ? provider.slice(open, close + 1) : '';
    };
    // 桩必须真的拆掉：P1 的两个方法都抛 readUnavailableMessage。
    if (/throw\s+BridgeFailure\.message\(\s*(SchoolProvider\.)?readUnavailableMessage\s*\)/.test(provider)) {
      problems.push('leaveRecordSync / capture 仍在抛 P1 桩文案');
    }
    // 语义断言：capture 必须把 host 交给 SchoolReadController.start；不锁 self. 前缀与空格。
    if (!/controller\.start\s*\(\s*host\s*:/.test(bodyOf('capture'))) {
      problems.push('capture 未驱动 SchoolReadController.start(host:)');
    }
    // 语义断言：leaveRecordSync 必须直连 LeaveRecordsService.fetch；不锁 await/self. 写法。
    if (!/leaveRecords\.fetch\s*\(\s*\)/.test(bodyOf('leaveRecordSync'))) {
      problems.push('leaveRecordSync 未直连 LeaveRecordsService.fetch()');
    }
    // 语义断言：openSchool 成功必须返回 ok:true；允许 ["ok":true] 这类空白差异。
    if (!/["']ok["']\s*:\s*true/.test(bodyOf('openSchool'))) {
      problems.push('openSchool 未返回 {ok:true}');
    }
    if (!/func\s+clearLeaveSession\s*\(\s*\)/.test(providerCode)) {
      problems.push('未提供 clearLeaveSession（注销要清请假会话参数）');
    }
    // 状态机必须覆盖 restore → sso → portal/profile → read 四段与全部用户可见文案。
    const needles = [
      ['/jsxsd/framework/xsMainV.htmlx', '教务首页地址'],
      ['/jsxsd/xskb/xskb_list.do?viweType=1', '课表页地址'],
      ['schoolSSOEntryURL', 'SSO 恢复入口'],
      ['school-reader', '课表读取脚本'],
      ['profile-reader', '年级读取脚本'],
      ['正在检查学校会话', '恢复阶段提示'],
      ['正在使用已保存的学校登录状态恢复教务会话', 'SSO 阶段提示'],
      ['请在学校页面完成登录', '登录阶段提示'],
      ['学校会话自动恢复未成功，原课表已保留', 'SSO 退化失败文案'],
      ['学校课表不完整，保留上次课表', '课表不完整文案'],
      ['已取消读取，保留原课表', '取消文案'],
      ['needLogin', '登录等待状态'],
      ['isAwaitingLogin', '登录等待对外暴露'],
    ];
    for (const [needle, label] of needles) {
      if (controller.indexOf(needle) < 0) problems.push('状态机缺 ' + label + '（' + needle + '）');
    }
    // P2 真机首跑修复（2026-10-30）：四条运行期回归门禁，全部挂在 F8 内，不新增检查编号。
    const runtimeNeedles = [
      ['cancelDeadline()', 'needLogin 取消死线'],
      ['leaveLoginDeadline', '登录后 60s 兜底常量'],
      ['scheduleDeadline(Self.totalDeadline)', 'SSO 重挂 90s 总时限'],
      ['expiresDate', '教务 cookie 过期判断'],
      ['inspectAcademicLogin', '教务登录页检测'],
      [';0;', '异步读取脚本返回值可序列化'],
      ['isSSOEntryURL', 'SSO 入口页识别'],
    ];
    for (const [needle, label] of runtimeNeedles) {
      if (controller.indexOf(needle) < 0) problems.push('P2 运行期修复缺 ' + label + '（' + needle + '）');
    }
    if (!/if\s+awaitingLogin\s*\{\s*return\s*\}/.test(controller)) {
      problems.push('P2 运行期修复缺登录期导航失败守卫（if awaitingLogin { return }）');
    }
    // onDismissed 语义断言（2026-10-30 放宽）：不再要求 self?.controller.cancel() 字面量。
    // 拦的回归：关闭学校容器时必须取消进行中的教务读取；请假模式必须关闭请假容器。
    // 支持 created.onDismissed = { ... } 内联闭包，或先声明 let dismissed: () -> Void = { ... } 再赋值；
    // 捕获写法允许 self?. / self. / guard let self 三种，避免下次重构又误报。
    const dismissedBlock = (() => {
      const assign = /\.onDismissed\s*=\s*/.exec(providerCode);
      if (!assign) return '';
      const rhs = assign.index + assign[0].length;
      const brace = providerCode.indexOf('{', rhs);
      if (brace >= 0 && providerCode.slice(rhs, brace).trim() === '') {
        const close = matchBalanced(providerCode, brace);
        if (close > brace) return providerCode.slice(brace, close + 1);
      }
      const ident = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(providerCode.slice(rhs, rhs + 160));
      if (!ident) return '';
      const decl = new RegExp('(?:let|var)\\s+' + ident[1] + '\\s*(?::[^=\\n]+)?=\\s*\\{');
      const from = Math.max(0, assign.index - 5000);
      const m = decl.exec(providerCode.slice(from, assign.index));
      if (!m) return '';
      const open = from + m.index + m[0].lastIndexOf('{');
      const close = matchBalanced(providerCode, open);
      return close > open ? providerCode.slice(open, close + 1) : '';
    })();
    if (!dismissedBlock) {
      problems.push('无法定位 onDismissed 处理块（需 created.onDismissed = { … } 或赋给闭包变量）');
    } else {
      if (!/controller\.cancel\s*\(\s*\)/.test(dismissedBlock)) problems.push('onDismissed 未取消进行中的学校读取');
      if (!/leaveController\.close\s*\(\s*\)/.test(dismissedBlock)) problems.push('onDismissed 请假模式未关闭请假容器');
      if (!/\.leaveApp\b/.test(dismissedBlock)) problems.push('onDismissed 未区分请假模式（缺少 .leaveApp 分支）');
    }
    if ((providerCode.match(/rememberSession\s*\(/g) || []).length < 2) {
      problems.push('P2 运行期修复缺 onPageFinished 再次 rememberSession');
    }
    // 假条同步：字段顺序/头/cookie 来源必须与 Android 一致。
    const leaveNeedles = [
      ['SchoolURLPolicy.leaveFormID', '表单 id 常量'],
      ['X-Requested-With', 'XHR 头'],
      ['application/x-www-form-urlencoded', 'Content-Type'],
      ['httpCookieAcceptPolicy', '禁用 URLSession 自带 cookie 管理'],
      ['formsUserList', '响应解析路径'],
      ['fetchedAt', '毫秒时间戳'],
      ['NEED_LOGIN', '登录缺失错误码'],
      ['NEED_SESSION', '会话参数缺失错误码'],
      ['TIMEOUT', '超时错误码'],
    ];
    for (const [needle, label] of leaveNeedles) {
      if (leave.indexOf(needle) < 0) problems.push('假条同步缺 ' + label + '（' + needle + '）');
    }
    // 容器不再提示「下一阶段提供」，且桥接把 mobile=false 的 openSchool 也当读取。
    if (schoolHost.indexOf('下一阶段提供') >= 0) problems.push('学校容器仍有 P1 桩文案');
    // 按 case 块切分后做语义断言：不锁取值辅助函数名（flag/optBool/text 均可），
    // 只拦「openSchool 没读 mobile 参数」和「mobile=false 分支没复用 capture()」两类回归。
    const dispatcher = dispatcherText();
    const caseBlock = (name) => {
      const start = dispatcher.indexOf('case "' + name + '":');
      if (start < 0) return '';
      const next = dispatcher.indexOf('case "', start + 8);
      return dispatcher.slice(start, next < 0 ? dispatcher.length : next);
    };
    const openSchoolBlock = caseBlock('openSchool');
    if (!openSchoolBlock) {
      problems.push('BridgeDispatcher 缺少 openSchool case');
    } else {
      if (!/payload\["mobile"\]/.test(openSchoolBlock)) problems.push('openSchool 未读取 mobile 参数');
      if (!/\.capture\s*\(/.test(openSchoolBlock)) problems.push('openSchool(mobile=false) 未走 capture()');
    }
    if (!/\.capture\s*\(/.test(caseBlock('sync'))) problems.push('sync action 未复用 capture()');
    // task-15 的显式解包只是防御，不是保存死循环根因；这里锁住写法，避免将来 reply 形参改成 Any 时回包被装箱成 Optional。
    if (!/case\s+"loadState":[\s\S]{0,900}?if\s+let\s+saved\s*=\s*services\.state\.load\(\)[\s\S]{0,300}?reply\(id,\s*saved\)[\s\S]{0,300}?else[\s\S]{0,200}?reply\(id,\s*NSNull\(\)\)/.test(dispatcherText())) {
      problems.push('loadState 未显式区分 state.load() 的 nil（必须 if let saved … else 回 NSNull）');
    }
    return problems.length ? fail(truncateList(problems)) : pass('四阶段状态机齐全，P2 运行期修复与 loadState 显式回包均在位');
  });

  add('F9', 'project.yml 与 pbxproj 常量一致', () => {
    const yml = projectYml();
    const problems = [];
    const check = (label, re) => { if (!re.test(yml)) problems.push('project.yml 缺 ' + label); };
    check('MARKETING_VERSION 1.3.1', /MARKETING_VERSION:\s*"?1\.3\.1"?/);
    check('CURRENT_PROJECT_VERSION 48', /CURRENT_PROJECT_VERSION:\s*"?48"?/);
    check('IPHONEOS_DEPLOYMENT_TARGET 15.0', /IPHONEOS_DEPLOYMENT_TARGET:\s*"?15\.0"?/);
    check('PRODUCT_BUNDLE_IDENTIFIER ' + BUNDLE_ID, new RegExp('PRODUCT_BUNDLE_IDENTIFIER:\\s*' + BUNDLE_ID.replace(/\./g, '\\.')));
    check('INFOPLIST_FILE', /INFOPLIST_FILE:\s*Jiangshui\/Resources\/Info\.plist/);
    check('GENERATE_INFOPLIST_FILE NO', /GENERATE_INFOPLIST_FILE:\s*NO/);
    check('web folder reference', /path:\s*\.\.\/web/);
    check('web type folder', /type:\s*folder/);
    if (yml.indexOf('MARKETING_VERSION: "1.3.1"') < 0 && yml.indexOf('MARKETING_VERSION: 1.3.1') < 0) problems.push('project.yml MARKETING_VERSION 写法不明确');
    return problems.length ? fail(truncateList(problems)) : pass('project.yml 版本/部署目标/bundle id/web 引用与 pbxproj 一致');
  });

  add('F10', '安全区：注入 env(safe-area-inset-*) 样式，顶部不被状态栏遮挡', () => {
    const text = webhostText();
    const problems = [];
    if (text.indexOf('safeAreaUserScript') < 0) problems.push('缺少 safeAreaUserScript');
    if (text.indexOf('env(safe-area-inset-top)') < 0) problems.push('样式没有用到 env(safe-area-inset-top)');
    if (text.indexOf('.main{padding-top:calc(27px') < 0) problems.push('缺少 .main 顶部安全区内边距');
    if (text.indexOf('.agreement-screen{') < 0) problems.push('缺少同意页安全区适配');
    if (text.indexOf('.leave-page-topbar{') < 0) problems.push('缺少假条页顶栏安全区适配');
    if (text.indexOf('installUserScripts(on:') < 0) problems.push('没有统一的脚本安装入口（重新加载会丢样式）');
    if (!/loadIndex[\s\S]{0,1200}?installUserScripts\(on:/.test(text)) problems.push('loadIndex 未重新安装用户脚本');
    if (text.indexOf('forMainFrameOnly: true') < 0) problems.push('用户脚本应只作用于主框架');
    // 白条 A 方案的静态锁：WebView 只忽略底部安全区，顶部从安全区下沿开始；
    // 状态栏区域由 RootView 底层的 shellBackgroundColor 填充，WebView 用 clipsToBounds 物理裁剪。
    // 不锁缩进/换行，只锁结构和语义，避免下次 SwiftUI 重构时误报。
    const root = rootViewText();
    if (!/Color\s*\(\s*uiColor\s*:\s*host\.shellBackgroundColor\s*\)\s*\.\s*ignoresSafeArea\s*\(\s*\)/.test(root)) {
      problems.push('RootView 缺少填充状态栏的 shellBackgroundColor 底层');
    }
    if (!/WebViewContainer\s*\(\s*host\s*:\s*host\s*\)\s*\.\s*ignoresSafeArea\s*\(\s*\.container\s*,\s*edges\s*:\s*\.bottom\s*\)/.test(root)) {
      problems.push('WebView 必须只忽略底部安全区（顶部要落在安全区下沿）');
    }
    if (/WebViewContainer[\s\S]{0,120}?\.ignoresSafeArea\s*\(\s*\)/.test(root)) {
      problems.push('WebView 不得整体 ignoresSafeArea()（会重新压到状态栏）');
    }
    if (text.indexOf('clipsToBounds = true') < 0) problems.push('WebView 缺少 clipsToBounds=true（滚动内容会画进顶部色条）');
    if (text.indexOf('shellThemeUserScript') < 0) problems.push('缺少 shellThemeUserScript（顶部色条不跟随主题）');
    if (text.indexOf('"jiangshuiShellTheme"') < 0) problems.push('缺少 ShellThemeHandler 名称 jiangshuiShellTheme');
    if (!/add\s*\(\s*shellThemeHandler\s*,\s*name\s*:\s*ShellThemeHandler\.name\s*\)/.test(text)) {
      problems.push('WebHost 未注册 ShellThemeHandler');
    }
    if (!/controller\.addUserScript\s*\(\s*Self\.shellThemeUserScript\s*\(\s*\)\s*\)/.test(text)) {
      problems.push('installUserScripts 未安装 shellThemeUserScript');
    }
    return problems.length ? fail(truncateList(problems)) : pass('安全区样式在 documentStart 注入，顶部白条 A 方案（WebView 只落底边 + clipsToBounds）在位');
  });

  add('F11', 'P2 无头核对：容器不可见不可点，capture 不强制展示，仅 needLogin 转可见', () => {
    const problems = [];
    const swift = swiftFiles();
    const hostSource = swift['Jiangshui/School/SchoolWebViewHost.swift'] || '';
    const hostCode = stripSwift(hostSource);
    const controllerSource = swift['Jiangshui/School/SchoolReadController.swift'] || '';
    const controllerCode = stripSwift(controllerSource);
    const providerCode = stripSwift(schoolText());
    const bodyOf = (source, code, name) => {
      const m = new RegExp('func\\s+' + name + '\\s*\\(').exec(code);
      if (!m) return '';
      const open = code.indexOf('{', m.index);
      if (open < 0) return '';
      const close = matchBalanced(code, open);
      return close > open ? source.slice(open, close + 1) : '';
    };

    const headless = bodyOf(hostSource, hostCode, 'attachHeadlessOnMain');
    if (!headless) {
      problems.push('无法定位 SchoolWebViewHost.attachHeadlessOnMain');
    } else {
      // 无头挂载有两条路径：首次挂成 child（parent == nil）和复用已挂载的 child（else）。
      // 两条路径都必须把容器恢复到不可见/不可点；只锁其中一条会让另一条在真机上白屏或可点穿。
      const branchesOf = (body) => {
        const m = /if\s+parent\s*==\s*nil\s*\{/.exec(body);
        if (!m) return null;
        const open = body.indexOf('{', m.index);
        const close = open < 0 ? -1 : matchBalanced(body, open);
        if (close < 0) return null;
        const rest = body.slice(close + 1);
        const em = /^\s*else\s*\{/.exec(rest);
        if (!em) return null;
        const eOpen = rest.indexOf('{', em.index);
        const eClose = eOpen < 0 ? -1 : matchBalanced(rest, eOpen);
        if (eClose < 0) return null;
        return { attach: body.slice(open, close + 1), reuse: rest.slice(eOpen, eClose + 1) };
      };
      const branches = branchesOf(headless);
      if (!branches) {
        problems.push('无法定位 attachHeadlessOnMain 的 parent == nil / else 两条挂载分支');
      } else {
        const labels = { attach: '首次挂载分支', reuse: '复用已挂载分支' };
        for (const key of ['attach', 'reuse']) {
          const chunk = branches[key];
          if (!/\.alpha\s*=\s*0\.01/.test(chunk)) problems.push(labels[key] + '未设 alpha=0.01（WebKit 会把完全透明的页面当后台冻结）');
          if (!/\.isUserInteractionEnabled\s*=\s*false/.test(chunk)) problems.push(labels[key] + '未禁用交互（用户可能点到看不见的页面）');
          if (!/\.accessibilityElementsHidden\s*=\s*true/.test(chunk)) problems.push(labels[key] + '未对辅助功能隐藏');
        }
        if (!/\.insertSubview\s*\(\s*view\s*,\s*at\s*:\s*0\s*\)/.test(branches.attach)) problems.push('首次挂载分支未把无头容器作为最底层 child 插入（window 为空会被 WebKit 降频）');
      }
      // A1（task-22 复核）：dismiss 动画窗口内不能再静默 return，否则 provider 会拿着未挂载的
      // WKWebView 启动状态机，WebKit 挂起 JS，最终只剩 90s 总超时。attachHeadless 必须把
      // 「没挂上」告诉调用方；provider 的 startCapture 负责 0.4s 重试一次并给明确错误。
      if (!/@discardableResult[\s\S]{0,160}?func\s+attachHeadless\s*\([^)]*\)\s*->\s*Bool/.test(hostCode)) {
        problems.push('attachHeadless 必须返回 Bool（@discardableResult），让 provider 能识别未挂载');
      }
      if (!/return\s+false/.test(headless)) problems.push('attachHeadlessOnMain 在 presenting/dismissing 时必须 return false');
      if (!/return\s+true/.test(headless)) problems.push('attachHeadlessOnMain 成功挂载后必须 return true');
    }

    const capture = bodyOf(schoolText(), providerCode, 'capture');
    const prepare = bodyOf(schoolText(), providerCode, 'prepareHostForRead');
    if (!capture) {
      problems.push('无法定位 SchoolProvider.capture');
    } else if (/presentForUser(?:Visible)?/.test(capture + '\n' + prepare)) {
      problems.push('capture 路径调用了 presentForUser（自动核对不应强制弹出学校页面）');
    }
    if (!/startCapture\s*\(/.test(capture)) {
      problems.push('capture 未走 startCapture（A1 的挂载失败重试入口）');
    }
    if (!/attached\s*==\s*false\s*\{\s*return\s+nil/.test(prepare)) {
      problems.push('prepareHostForRead 未把 attachHeadless 返回 false 转成 nil');
    }
    const startCapture = bodyOf(schoolText(), providerCode, 'startCapture');
    if (!startCapture) {
      problems.push('无法定位 SchoolProvider.startCapture');
    } else {
      if (!/asyncAfter\s*\(\s*deadline:\s*\.now\(\)\s*\+\s*0\.4\s*\)/.test(startCapture)) {
        problems.push('startCapture 未在挂载失败后 0.4s 重试一次');
      }
      if (!/allowRetry:\s*false/.test(startCapture)) problems.push('startCapture 的重试必须只允许一次（allowRetry:false）');
      if (!/学校页面正在关闭，请稍后再试/.test(startCapture)) {
        problems.push('startCapture 重试仍失败时缺明确错误「学校页面正在关闭，请稍后再试」');
      }
    }
    const ensure = bodyOf(schoolText(), providerCode, 'ensureHost');
    if (!/\.onNeedsVisiblePresentation\s*=/.test(ensure) || !/\.presentForUser\s*\(/.test(ensure)) {
      problems.push('ensureHost 未把 presentForUser 挂到 onNeedsVisiblePresentation 回调');
    }

    // A3（task-22 复核）：后台时 UIKit 会忽略 present，若先置 isUserVisible=true 会永久卡住，
    // onDismissed 不回调、请假状态机残留。必须前台才 present，且以 present 完成后的实际状态为准。
    const present = bodyOf(hostSource, hostCode, 'presentForUser');
    if (!present) {
      problems.push('无法定位 SchoolWebViewHost.presentForUser');
    } else {
      if (!/applicationState\s*==\s*\.active/.test(present)) {
        problems.push('presentForUser 未检查 applicationState == .active（后台 present 会被 UIKit 忽略）');
      }
      const pidx = present.indexOf('presenter.present(self');
      if (pidx < 0) {
        problems.push('presentForUser 未调用 presenter.present(self,...)');
      } else {
        const open = present.indexOf('{', pidx);
        const close = open < 0 ? -1 : matchBalanced(present, open);
        const completion = close > open ? present.slice(open, close + 1) : '';
        if (!/isUserVisible\s*=\s*true/.test(completion)) {
          problems.push('isUserVisible 必须在 present completion 内以实际结果置 true（不能在 present 前抢跑）');
        }
      }
    }

    const needLogin = bodyOf(controllerSource, controllerCode, 'needLogin');
    const calls = controllerCode.match(/onNeedsVisiblePresentation\s*\?\s*\(\s*\)/g) || [];
    if (!needLogin) {
      problems.push('无法定位 SchoolReadController.needLogin');
    } else if (calls.length !== 1) {
      problems.push('onNeedsVisiblePresentation 必须恰好有一个调用点（实际 ' + calls.length + ' 个）');
    } else if (!/onNeedsVisiblePresentation\s*\?\s*\(\s*\)/.test(needLogin)) {
      problems.push('onNeedsVisiblePresentation 必须在 needLogin 分支内调用（只有登录页需要用户看见）');
    }
    return problems.length ? fail(truncateList(problems)) : pass('无头容器双分支 alpha=0.01 / 禁止交互 / 无障碍隐藏均在位，attachHeadless 返回挂载结果并 0.4s 重试，capture 不强制展示，仅 needLogin 转可见且前台 guard + completion 置 isUserVisible');
  });

  add('F12', 'P3 请假深链 + 上传/定位资产：用途文案齐全、定位 origin 白名单、文件选择器未接线', () => {
    const problems = [];
    const info = infoPlist();
    const usageKeys = [
      ['NSLocationWhenInUseUsageDescription', '定位'],
      ['NSPhotoLibraryUsageDescription', '相册'],
      ['NSCameraUsageDescription', '相机'],
      ['NSMicrophoneUsageDescription', '麦克风'],
    ];
    for (const [key, label] of usageKeys) {
      const value = info[key];
      if (typeof value !== 'string' || value.trim() === '') problems.push('Info.plist 缺 ' + label + ' 用途文案（' + key + '）');
      else if (!/[\u4e00-\u9fff]/.test(value)) problems.push('Info.plist ' + label + ' 用途文案不是中文（' + key + '）');
    }

    const swift = swiftFiles();
    const geoSource = swift['Jiangshui/School/SchoolGeolocationBridge.swift'] || '';
    const geoCode = stripSwift(geoSource);
    const hostSource = swift['Jiangshui/School/SchoolWebViewHost.swift'] || '';
    const hostCode = stripSwift(hostSource);
    if (!geoSource) {
      problems.push('缺少 Jiangshui/School/SchoolGeolocationBridge.swift');
    } else {
      if (!/static\s+let\s+handlerName\s*=\s*"jiangshuiGeo"/.test(geoSource)) problems.push('定位桥 handlerName 必须为 jiangshuiGeo');
      if (!/allowedOrigin\s*\(\s*message\.frameInfo\.securityOrigin\s*\)/.test(geoCode)) problems.push('定位桥未校验 message.frameInfo.securityOrigin');
      if (!/func\s+allowedOrigin\s*\(\s*_\s+origin\s*:\s*WKSecurityOrigin\s*\)/.test(geoCode)) problems.push('定位桥缺少 WKSecurityOrigin 白名单函数');
      if (!/origin\.`protocol`/.test(geoCode) || !/isXgxtUrl/.test(geoCode)) problems.push('定位 origin 白名单必须限定 https + xgxt');
      // A2（task-22 复核）：shim 注入到所有 frame，但原生只在主 frame 求值回填。
      // 同源 iframe 必须把 callbacks/入口挂到 window.top，否则主 frame 找不到 entry，只能超时。
      // 跨域访问 top 会抛 SecurityError，代码必须 try/catch 退化为自身 window（已知限制见 P2 文档）。
      if (!/window\.top/.test(geoSource)) problems.push('定位 shim 未把 window.top 作为同源 iframe 的回填根');
      if (!/__jiangshuiGeoCallbacks/.test(geoSource)) problems.push('定位 shim 未共享 __jiangshuiGeoCallbacks（iframe 回填会丢）');
      if (!/callbacks\s*=\s*root\.__jiangshuiGeoCallbacks/.test(geoSource)) problems.push('定位 shim 必须把 root.__jiangshuiGeoCallbacks 作为唯一注册表（主 frame 与 iframe 共用）');
      if (/candidate\.__jiangshuiGeoCallbacks/.test(geoSource)) problems.push('定位 shim 仍在用 candidate 的独立注册表（主 frame 回填会查不到）');
      if (!/__jiangshuiGeoSeq/.test(geoSource)) problems.push('定位 shim 未用 top 上的 __jiangshuiGeoSeq 生成全局唯一 id');
      if (!/try\s*\{[\s\S]{0,400}?window\.top[\s\S]{0,400}?\}\s*catch\s*\(/.test(geoSource)) {
        problems.push('定位 shim 访问 window.top 必须 try/catch（跨域 iframe 要退化为自身）');
      }
    }
    if (!/add\s*\(\s*geoBridge\s*,\s*name\s*:\s*SchoolGeolocationBridge\.handlerName\s*\)/.test(hostCode)) {
      problems.push('SchoolWebViewHost 未注册 jiangshuiGeo handler');
    }
    if (!/SchoolGeolocationBridge\.injectionScript/.test(hostCode)) problems.push('SchoolWebViewHost 未注入定位 shim');
    if (/\brunOpenPanelWith\b/.test(hostCode)) problems.push('SchoolWebViewHost 不应实现 runOpenPanelWith（iOS 18.4 才有，Xcode 15.4 会编译失败）');

    const pickerKey = 'Jiangshui/School/SchoolFilePicker.swift';
    if (!swift[pickerKey]) {
      problems.push('缺少预留的 SchoolFilePicker.swift');
    } else {
      const callers = Object.keys(swift).filter((rel) => rel !== pickerKey && /\bSchoolFilePicker\b/.test(stripSwift(swift[rel])));
      if (callers.length) {
        problems.push('SchoolFilePicker 已被接线（' + truncateList(callers) + '）；若开始使用请同步门禁与 P3 文档');
      }
    }
    return problems.length ? fail(truncateList(problems)) : pass('四项用途文案齐全，定位 handler=jiangshuiGeo、校验 xgxt https origin 且 shim 挂 window.top，SchoolFilePicker 保持未接线');
  });

  add('G1', '实时活动：iOS 16.1 门槛、request/update/end + T+10 自动结束、通知回退与 NSSupportsLiveActivities', () => {
    const problems = [];
    const swift = swiftFiles();
    const source = swift['Jiangshui/Services/ClassActivityController.swift'] || '';
    const code = stripSwift(source);
    const reminder = swift['Jiangshui/Services/ClassReminderService.swift'] || '';
    const reminderCode = stripSwift(reminder);
    const need = (ok, message) => { if (!ok) problems.push(message); };
    if (!source) problems.push('缺少 Jiangshui/Services/ClassActivityController.swift');
    need(/@available\(iOS 16\.1, \*\)/.test(source), 'ClassActivityController 未标注 iOS 16.1 可用性');
    need(/ActivityAuthorizationInfo\(\)\.areActivitiesEnabled/.test(code), '未检查实时活动系统开关');
    need(/Activity(?:<ClassActivityAttributes>)?\.request\(attributes:/.test(code), '未调用 Activity.request');
    need(/activity\.update\(using:/.test(code), '未调用 activity.update');
    need(/activity\.end\(using:\s*state,\s*dismissalPolicy:\s*\.after\(dismissal\)\)/.test(code), '实时活动未用 dismissalPolicy .after 在 T+10 结束');
    need(/startDate\.addingTimeInterval\(600\)/.test(code), 'T+10 结束时间不是开始 + 600 秒');
    need(/func\s+endAll\(\)/.test(code), '缺少 endAll 注销清理');
    need(/catch[\s\S]{0,200}?import-error kind=other http-status=0/.test(source), '实时活动失败未写白名单诊断');
    need(/if #available\(iOS 16\.1, \*\) \{ ClassActivityController\.shared\.reconcile/.test(reminderCode), 'ClassReminderService 未在 16.1 门槛内调用实时活动');
    need(/candidates\.prefix\(60\)/.test(reminderCode) && /candidates\.count > 60/.test(reminderCode), 'pending 通知未限制 60 条并记截断诊断');
    need(/ClassActivityController\.shared\.endAll\(\)/.test(reminderCode), 'clearAll 未结束实时活动');
    need(infoPlist().NSSupportsLiveActivities === true, 'Info.plist 未声明 NSSupportsLiveActivities=true');
    return problems.length ? fail(truncateList(problems)) : pass('16.1 门槛、request/update/.after(T+10)、失败回退、60 条上限与 NSSupportsLiveActivities 均在位');
  });

  return results;
}

function collectHexRefs(value, out) {
  if (typeof value === 'string') {
    if (/^[0-9A-F]{24}$/.test(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHexRefs(item, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) collectHexRefs(value[key], out);
  }
}

function walkProjectGroups(root, parsed, objects) {
  const result = { refs: [], errors: [], missing: [] };
  const project = objects[String(parsed.rootObject)];
  if (!project || !project.mainGroup) {
    result.errors.push('PBXProject 缺 mainGroup');
    return result;
  }
  const visit = (groupId, dir) => {
    const group = objects[groupId];
    if (!group) { result.errors.push('group 未定义：' + groupId); return; }
    const groupPath = group.path ? String(group.path) : '';
    const current = groupPath ? path.posix.join(dir, groupPath) : dir;
    for (const childId of group.children || []) {
      const child = objects[childId];
      if (!child) { result.errors.push('group ' + groupId + ' 的 child 未定义：' + childId); continue; }
      if (child.isa === 'PBXGroup' || child.isa === 'PBXVariantGroup') { visit(childId, current); continue; }
      if (child.isa !== 'PBXFileReference') { result.errors.push('未知 child 类型 ' + child.isa + '：' + childId); continue; }
      const sourceTree = child.sourceTree || '<group>';
      if (sourceTree === 'BUILT_PRODUCTS_DIR' || sourceTree === 'SDKROOT' || sourceTree === '<absolute>') continue;
      const base = sourceTree === 'SOURCE_ROOT' ? '' : current;
      const rawPath = String(child.path || child.name || '');
      if (!rawPath) { result.errors.push('文件引用缺 path/name：' + childId); continue; }
      const rel = path.posix.normalize(path.posix.join(base, rawPath));
      const abs = path.resolve(root, 'ios', rel);
      if (!existsSync(abs)) result.missing.push({ id: childId, rel });
      result.refs.push({ id: childId, rel, ref: child });
    }
  };
  visit(String(project.mainGroup), '');
  return result;
}

function nativeTargets(objects) {
  return Object.values(objects).filter((obj) => obj && obj.isa === 'PBXNativeTarget');
}

function targetPhases(objects, target, isa) {
  if (!target) return [];
  return (target.buildPhases || []).map((id) => objects[id]).filter((obj) => obj && obj.isa === isa);
}

function swiftRefsForTarget(objects, walk, target) {
  const relById = new Map(walk.refs.map((ref) => [ref.id, ref.rel]));
  const out = [];
  for (const phase of targetPhases(objects, target, 'PBXSourcesBuildPhase')) {
    for (const buildId of phase.files || []) {
      const build = objects[buildId];
      if (!build || !build.fileRef) continue;
      const rel = relById.get(build.fileRef);
      if (!rel) continue;
      if (rel.endsWith('.swift')) out.push(rel);
    }
  }
  return out;
}

export function formatResults(results) {
  const failures = results.filter((item) => !item.ok);
  const lines = [];
  for (const item of results) {
    lines.push('[' + (item.ok ? 'ok' : 'fail') + '] ' + item.id + ' ' + item.title);
    if (item.detail) {
      const detail = String(item.detail).split('\n').join('\n        ');
      lines.push('        ' + detail);
    }
  }
  lines.push('');
  lines.push('汇总：' + results.length + ' 项，ok ' + (results.length - failures.length) + '，fail ' + failures.length);
  if (failures.length) {
    lines.push('失败项：');
    for (const item of failures) lines.push(' - ' + item.id + ' ' + item.title);
    lines.push('退出码：1');
  } else {
    lines.push('全绿，退出码：0');
  }
  return lines.join('\n');
}

export function main() {
  const results = runChecks(ROOT);
  const header = '江水课表 iOS 静态校验  root=' + ROOT;
  console.log(header);
  console.log('时间：' + new Date().toISOString());
  console.log('');
  console.log(formatResults(results));
  const failures = results.filter((item) => !item.ok).length;
  process.exitCode = failures ? 1 : 0;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = fileURLToPath(import.meta.url);
if (entry && entry.toLowerCase() === self.toLowerCase()) {
  main();
}
