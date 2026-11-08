#!/usr/bin/env node
/**
 * HarmonyOS 工程静态检查（分支 B：无 SDK，仅静态）
 *
 * 用法：
 *   node tools/check-harmony.mjs [--root <harmony 工程根>] [--json] [--strict]
 *
 * 模式：
 *   默认（开发模式）：resource-requests 未合并键、features/** 未接线孤儿文件降级为 WARN
 *                     （仍打印数量与文件清单），其余规则照常 FAIL。
 *   --strict 或 HARMONY_STRICT=1：上述两类按 FAIL 处理，供交付/全量回归/构建使用。
 *
 * 退出码：0 = 无 FAIL；1 = 有 FAIL 或参数/读取错误。
 * 只依赖 Node 内置模块；不解析完整 ArkTS 语法，静态通过 != 可编译。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECK_CATEGORIES = [
  'structure',
  'json5',
  'resources',
  'icons',
  'hardcoded',
  'redlines',
  'degraded',
  'kit',
  'dependencies',
  'permissions',
  'contracts',
  'version',
];

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IGNORE_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'oh_modules', '.hvigor', '.preview']);

export class Report {
  constructor(root) {
    this.root = root;
    this.items = [];
  }
  add(severity, check, message, file = null, line = null) {
    this.items.push({ severity, check, message, file, line });
  }
  fail(check, message, file = null, line = null) {
    this.add('FAIL', check, message, file, line);
  }
  warn(check, message, file = null, line = null) {
    this.add('WARN', check, message, file, line);
  }
  info(check, message, file = null, line = null) {
    this.add('INFO', check, message, file, line);
  }
  counts() {
    const c = { fail: 0, warn: 0, info: 0 };
    for (const it of this.items) {
      if (it.severity === 'FAIL') c.fail++;
      else if (it.severity === 'WARN') c.warn++;
      else c.info++;
    }
    return c;
  }
}

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function readTextSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function walkFiles(root, out = []) {
  const st = statSafe(root);
  if (!st) return out;
  if (st.isFile()) { out.push(root); return out; }
  if (!st.isDirectory()) return out;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    if (IGNORE_DIRS.has(ent.name)) continue;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) walkFiles(full, out);
    else if (ent.isFile()) out.push(full);
  }
  return out;
}

function rel(root, p) {
  return path.relative(root, p).split(path.sep).join('/');
}

function lineAt(text, index) {
  if (index == null || index < 0) return null;
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

/** 去掉 JSON5 的 // 与 /* *\/ 注释（保留字符串内容），并去掉末尾逗号。 */
export function stripJson5Comments(text) {
  let out = '';
  let i = 0;
  let quote = null;
  let escaped = false;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i++; continue; }
    if (ch === '/' && next === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  // 去尾逗号：只在字符串外处理
  let cleaned = '';
  quote = null;
  escaped = false;
  for (let j = 0; j < out.length; j++) {
    const ch = out[j];
    if (quote) {
      cleaned += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cleaned += ch; continue; }
    if (ch === ',') {
      let k = j + 1;
      while (k < out.length && /\s/.test(out[k])) k++;
      if (out[k] === '}' || out[k] === ']') continue;
    }
    cleaned += ch;
  }
  return cleaned;
}

export function parseJson5Text(text) {
  return JSON.parse(stripJson5Comments(text));
}

function parseJson5File(report, absFile, label) {
  const text = readTextSafe(absFile);
  if (text == null) {
    report.fail('json5', `${label} 无法读取`, rel(report.root, absFile));
    return null;
  }
  try {
    return parseJson5Text(text);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    const m = msg.match(/position (\d+)/i);
    report.fail('json5', `${label} JSON5 解析失败：${msg}`, rel(report.root, absFile), m ? lineAt(text, Number(m[1])) : null);
    return null;
  }
}

function isCjkString(s) {
  return typeof s === 'string' && /[\u3400-\u9fff]/.test(s);
}

function stripLineComment(line) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
  }
  return line;
}

function stripAllowed(line) {
  return line.includes('static-check-allow');
}

function checkStructure(root, report) {
  const required = [
    'AppScope/app.json5',
    'AppScope/resources/base/element/string.json',
    'build-profile.json5',
    'oh-package.json5',
    'entry/build-profile.json5',
    'entry/oh-package.json5',
    'entry/src/main/module.json5',
    'entry/src/main/ets/entryability/EntryAbility.ets',
    'entry/src/main/ets/pages/Index.ets',
    'entry/src/main/ets/pages/SettingsPage.ets',
    'entry/src/main/resources/base/element',
    'entry/src/main/resources/dark/element',
    'entry/src/main/resources/base/media',
    'entry/src/main/resources/base/profile/main_pages.json',
  ];
  for (const r of required) {
    const abs = path.join(root, r);
    if (!exists(abs)) report.fail('structure', `缺少必需路径：${r}`, r);
  }
  const dirs = [
    'entry/src/main/ets/core',
    'entry/src/main/ets/data',
    'entry/src/main/ets/platform',
  ];
  for (const d of dirs) {
    if (!exists(path.join(root, d))) report.warn('structure', `缺少建议目录：${d}`, d);
  }
}

function checkEntryPages(root, report) {
  const moduleFile = path.join(root, 'entry/src/main/module.json5');
  const moduleData = exists(moduleFile) ? parseJson5File(report, moduleFile, 'module.json5') : null;
  if (!moduleData) return;
  const mod = moduleData.module || moduleData;
  const abilities = Array.isArray(mod.abilities) ? mod.abilities : [];
  for (const ability of abilities) {
    if (!ability || typeof ability !== 'object') continue;
    const name = typeof ability.name === 'string' ? ability.name : '(未命名)';
    if (typeof ability.srcEntry !== 'string' || !ability.srcEntry.trim()) {
      report.fail('structure', `ability ${name} 缺少 srcEntry`, 'entry/src/main/module.json5');
      continue;
    }
    const entryPath = path.resolve(path.join(root, 'entry/src/main'), ability.srcEntry);
    if (!exists(entryPath)) {
      report.fail('structure', `ability ${name} 的 srcEntry 不存在：${ability.srcEntry}`, 'entry/src/main/module.json5');
    }
  }
  if (typeof mod.pages !== 'string' || !mod.pages.startsWith('$profile:')) {
    report.fail('structure', 'module.pages 必须指向 $profile:main_pages 等 profile 文件', 'entry/src/main/module.json5');
    return;
  }
  const profileName = mod.pages.slice('$profile:'.length);
  const profilePath = path.join(root, 'entry/src/main/resources/base/profile', `${profileName}.json`);
  if (!exists(profilePath)) {
    report.fail('structure', `main_pages profile 不存在：${mod.pages}`, 'entry/src/main/module.json5');
    return;
  }
  let pagesData;
  try {
    pagesData = JSON.parse(readTextSafe(profilePath));
  } catch (err) {
    report.fail('structure', `main_pages 解析失败：${String(err.message || err)}`, rel(root, profilePath));
    return;
  }
  const src = Array.isArray(pagesData && pagesData.src) ? pagesData.src : null;
  if (!src) {
    report.fail('structure', 'main_pages.json 缺少 src 数组', rel(root, profilePath));
    return;
  }
  for (const page of src) {
    if (typeof page !== 'string') {
      report.fail('structure', 'main_pages.src 含非字符串条目', rel(root, profilePath));
      continue;
    }
    const pageFile = path.join(root, 'entry/src/main/ets', `${page}.ets`);
    if (!exists(pageFile)) {
      report.fail('structure', `main_pages 指向的页面不存在：${page}.ets`, rel(root, profilePath));
    }
  }
}

function checkJson5Files(root, report) {
  const files = walkFiles(root).filter((f) => f.endsWith('.json5'));
  if (files.length === 0) {
    report.fail('json5', '未找到任何 .json5 配置文件');
    return;
  }
  for (const f of files) parseJson5File(report, f, rel(root, f));
}

function collectResourceKeys(root, report) {
  const keys = new Map(); // key -> file
  const resourceRoots = [
    path.join(root, 'entry/src/main/resources'),
    path.join(root, 'AppScope/resources'),
  ];
  const files = [];
  for (const rr of resourceRoots) {
    for (const f of walkFiles(rr)) {
      if (!f.endsWith('.json')) continue;
      const parts = rel(root, f).split('/');
      if (!parts.includes('element')) continue;
      files.push(f);
      const type = path.basename(f, '.json');
      const text = readTextSafe(f);
      if (text == null) { report.fail('resources', '资源文件无法读取', rel(root, f)); continue; }
      let data;
      try { data = JSON.parse(text); } catch (err) {
        report.fail('resources', `资源 JSON 解析失败：${String(err.message || err)}`, rel(root, f));
        continue;
      }
      let entries = [];
      if (Array.isArray(data)) {
        entries = data;
      } else if (data && typeof data === 'object') {
        for (const group of Object.values(data)) {
          if (Array.isArray(group)) entries = entries.concat(group);
        }
      }
      if (!entries.length) report.warn('resources', '资源文件没有可识别的数组条目', rel(root, f));
      for (const item of entries) {
        if (item && typeof item.name === 'string') keys.set(`${type}.${item.name}`, rel(root, f));
      }
    }
  }
  return { keys, files };
}

function collectRequestedResourceKeys(root) {
  const keys = new Set();
  const dir = path.join(root, 'tools/resource-requests');
  if (!exists(dir)) return keys;
  for (const file of walkFiles(dir).filter((f) => f.endsWith('.json'))) {
    const text = readTextSafe(file);
    if (text == null) continue;
    let data;
    try { data = JSON.parse(text); } catch { continue; }
    for (const entry of requestEntriesFrom(data)) {
      if (entry.invalid !== undefined || !entry.key) continue;
      keys.add(entry.type + '.' + entry.key);
    }
  }
  return keys;
}

function checkResources(root, report, strict) {
  const { keys } = collectResourceKeys(root, report);
  const requested = strict ? new Set() : collectRequestedResourceKeys(root);
  const pending = new Map();
  const etsFiles = walkFiles(root).filter((f) => f.endsWith('.ets'));
  const refRe = /\$r\(\s*['"](?:app\.)?(string|color|float)\.([A-Za-z0-9_.]+)['"]\s*\)/g;
  const referenced = new Set();
  let missing = 0;
  for (const f of etsFiles) {
    const text = readTextSafe(f);
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (inBlock) {
        const end = line.indexOf('*/');
        if (end < 0) continue;
        line = line.slice(end + 2);
        inBlock = false;
      }
      const startBlock = line.indexOf('/*');
      if (startBlock >= 0) {
        const endBlock = line.indexOf('*/', startBlock + 2);
        if (endBlock < 0) { inBlock = true; line = line.slice(0, startBlock); }
        else line = line.slice(0, startBlock) + line.slice(endBlock + 2);
      }
      line = stripLineComment(line);
      refRe.lastIndex = 0;
      let m;
      while ((m = refRe.exec(line)) !== null) {
        const key = `${m[1]}.${m[2]}`;
        referenced.add(key);
        if (!keys.has(key)) {
          if (requested.has(key)) {
            if (!pending.has(key)) pending.set(key, { file: rel(root, f), line: i + 1 });
            continue;
          }
          missing++;
          if (missing <= 50) report.fail('resources', `引用了不存在的资源键 ${key}`, rel(root, f), i + 1);
        }
      }
    }
  }
  for (const cfg of [path.join(root, 'entry/src/main/module.json5'), path.join(root, 'AppScope/app.json5')]) {
    const text = readTextSafe(cfg);
    if (text == null) continue;
    const cfgRefRe = /\$(string|color|float):([A-Za-z0-9_.]+)/g;
    let cm;
    while ((cm = cfgRefRe.exec(text)) !== null) referenced.add(`${cm[1]}.${cm[2]}`);
  }
  if (missing > 50) report.info('resources', `另有 ${missing - 50} 处缺失资源引用未列出`);
  if (pending.size > 0) {
    const detail = [...pending.entries()].map(([key, at]) => key + '（' + at.file + ':' + at.line + '）').join('、');
    report.warn('resources', '引用了尚未合入 string.json 的资源键（已在 resource-requests 登记，开发模式降级为 WARN；最终必须合并）：' + detail + '（共 ' + pending.size + ' 个）');
  }
  let unreferenced = 0;
  for (const [key, file] of keys) {
    if (!referenced.has(key)) {
      unreferenced++;
      if (unreferenced <= 30) report.warn('resources', `资源已定义但未引用：${key}`, file);
    }
  }
  if (unreferenced > 30) report.info('resources', `另有 ${unreferenced - 30} 个未引用资源键未列出`);
}

function normalizeRequestKey(raw, typeHint) {
  let key = String(raw == null ? '' : raw).trim();
  let type = typeHint ? String(typeHint).trim() : 'string';
  if (!key) return { type, key: '' };
  if (key.startsWith('app.')) key = key.slice(4);
  const typed = key.match(/^(string|color|float)\.([A-Za-z0-9_.]+)$/);
  if (typed) { type = typed[1]; key = typed[2]; }
  return { type, key };
}

function requestEntriesFrom(data) {
  const out = [];
  const push = (type, name, value) => {
    const norm = normalizeRequestKey(name, type);
    out.push({ type: norm.type, key: norm.key, value });
  };
  const pushList = (list) => {
    for (const item of list) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { out.push({ invalid: item }); continue; }
      const name = typeof item.name === 'string' ? item.name : (typeof item.key === 'string' ? item.key : '');
      if (!name) { out.push({ invalid: item }); continue; }
      push(item.type, name, item.value);
    }
  };
  if (Array.isArray(data)) { pushList(data); return out; }
  if (!data || typeof data !== 'object') { out.push({ invalid: data }); return out; }
  for (const [k, v] of Object.entries(data)) {
    if (k === 'resources' || k === 'keys' || k === 'strings') {
      if (Array.isArray(v)) { pushList(v); }
      else if (v && typeof v === 'object') {
        for (const [name, value] of Object.entries(v)) {
          if (typeof value === 'string') push('string', name, value);
          else out.push({ invalid: { [name]: value } });
        }
      } else out.push({ invalid: { [k]: v } });
      continue;
    }
    if (typeof v === 'string') push('string', k, v);
    else out.push({ invalid: { [k]: v } });
  }
  return out;
}

function loadBaseStringJson(root, report) {
  const file = path.join(root, 'entry/src/main/resources/base/element/string.json');
  const relFile = rel(root, file);
  if (!exists(file)) {
    report.fail('resources', '缺少 entry/src/main/resources/base/element/string.json', relFile);
    return null;
  }
  const text = readTextSafe(file);
  if (text == null) { report.fail('resources', 'string.json 无法读取', relFile); return null; }
  let data;
  try { data = JSON.parse(text); } catch (err) {
    report.fail('resources', 'string.json JSON 解析失败：' + String(err && err.message ? err.message : err), relFile);
    return null;
  }
  const entries = Array.isArray(data) ? data : Object.values(data || {}).filter(Array.isArray).flat();
  const map = new Map();
  const dup = new Set();
  for (const item of entries) {
    if (!item || typeof item.name !== 'string') continue;
    if (map.has(item.name)) dup.add(item.name);
    map.set(item.name, typeof item.value === 'string' ? item.value : String(item.value == null ? '' : item.value));
  }
  for (const name of dup) report.fail('resources', 'string.json 存在重复资源键：' + name, relFile);
  return { file: relFile, map };
}

function checkResourceRequests(root, report, strict) {
  const strings = loadBaseStringJson(root, report);
  const dir = path.join(root, 'tools/resource-requests');
  if (!exists(dir)) {
    report.info('resources', '未发现 tools/resource-requests 目录，跳过资源请求一致性检查');
    return;
  }
  const files = walkFiles(dir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    report.info('resources', 'tools/resource-requests 下暂无 .json 请求文件');
    return;
  }
  const requested = new Map();
  const keyOwners = new Map();
  for (const file of files) {
    const relFile = rel(root, file);
    const text = readTextSafe(file);
    if (text == null) { report.fail('resources', 'resource-requests 文件无法读取', relFile); continue; }
    let data;
    try { data = JSON.parse(text); } catch (err) {
      report.fail('resources', 'resource-requests 文件 JSON 解析失败：' + String(err && err.message ? err.message : err), relFile);
      continue;
    }
    const flat = data && typeof data === 'object' && !Array.isArray(data)
      && Object.values(data).every((v) => typeof v === 'string');
    if (flat) {
      const seen = new Set();
      const dup = new Set();
      const nameRe = /^\s*"([^"]+)"\s*:/gm;
      let nm;
      while ((nm = nameRe.exec(text)) !== null) {
        if (seen.has(nm[1])) dup.add(nm[1]);
        seen.add(nm[1]);
      }
      for (const name of dup) report.fail('resources', 'resource-requests 文件内重复资源键：' + name, relFile);
    }
    const entries = requestEntriesFrom(data);
    const localMap = new Map();
    for (const entry of entries) {
      if (entry.invalid !== undefined) {
        report.fail('resources', 'resource-requests 含无法识别的条目：' + JSON.stringify(entry.invalid), relFile);
        continue;
      }
      if (!entry.key) { report.fail('resources', 'resource-requests 含空资源键', relFile); continue; }
      if (typeof entry.value !== 'string') {
        report.fail('resources', 'resource-requests 键 ' + entry.key + ' 的值必须是字符串', relFile);
        continue;
      }
      if (localMap.has(entry.key)) {
        report.fail('resources', 'resource-requests 文件内重复资源键：' + entry.key, relFile);
        continue;
      }
      localMap.set(entry.key, entry.value);
      if (keyOwners.has(entry.key)) {
        report.fail('resources', 'resource-requests 多个文件重复请求资源键：' + entry.key + '（' + keyOwners.get(entry.key) + ', ' + relFile + '）', relFile);
        continue;
      }
      keyOwners.set(entry.key, relFile);
      if (entry.type === 'string') requested.set(entry.key, { value: entry.value, file: relFile });
      else report.info('resources', 'resource-requests 键 ' + entry.type + '.' + entry.key + ' 非 string 资源，未做合并校验', relFile);
    }
  }
  if (!strings) return;
  const unmerged = [];
  for (const [key, req] of requested) {
    if (!strings.map.has(key)) {
      unmerged.push({ key, file: req.file });
      continue;
    }
    if (strings.map.get(key) !== req.value) {
      report.warn('resources', 'resource-requests 请求值与 string.json 不一致：' + key, req.file);
    }
  }
  if (unmerged.length === 0) return;
  if (strict) {
    for (const item of unmerged) {
      report.fail('resources', 'resource-requests 请求的键未合入 string.json：' + item.key + '（来源 ' + item.file + '）', item.file);
    }
    return;
  }
  const detail = unmerged.map((item) => item.key + '（' + item.file + '）').join('、');
  report.warn('resources', 'resource-requests 有 ' + unmerged.length + ' 个键未合入 string.json（开发模式降级为 WARN；最终必须合并）：' + detail);
}

function checkFeaturesOrphans(root, report, strict) {
  const etsRoot = path.join(root, 'entry/src/main/ets');
  const featuresDir = path.join(etsRoot, 'features');
  if (!exists(featuresDir)) {
    report.info('dependencies', '未发现 entry/src/main/ets/features 目录，跳过孤儿文件检查');
    return;
  }
  const all = walkFiles(etsRoot).filter((f) => f.endsWith('.ets'));
  if (all.length === 0) return;
  const featureSet = new Set(all.filter((f) => f === featuresDir || f.startsWith(featuresDir + path.sep)));
  if (featureSet.size === 0) {
    report.info('dependencies', 'features 目录下暂无 .ets 文件');
    return;
  }
  const importRe = /^\s*(?:import|export)\b[\s\S]*?from\s*['"]([^'"]+)['"]/gm;
  const edges = new Map();
  for (const f of featureSet) edges.set(f, []);
  const roots = new Set();
  for (const f of all) {
    const text = readTextSafe(f);
    if (text == null) continue;
    importRe.lastIndex = 0;
    let m;
    while ((m = importRe.exec(text)) !== null) {
      const target = m[1];
      if (!target.startsWith('.')) continue;
      const resolved = resolveImport(f, target);
      if (!resolved || !featureSet.has(resolved)) continue;
      if (featureSet.has(f)) edges.get(f).push(resolved);
      else roots.add(resolved);
    }
  }
  const reached = new Set();
  const queue = [...roots];
  while (queue.length) {
    const cur = queue.shift();
    if (reached.has(cur)) continue;
    reached.add(cur);
    for (const next of edges.get(cur) || []) if (!reached.has(next)) queue.push(next);
  }
  const orphans = [...featureSet].filter((f) => !reached.has(f)).sort();
  if (orphans.length === 0) return;
  if (strict) {
    for (const f of orphans) {
      report.fail('dependencies', 'features 存在孤儿文件（无 import 引用可达）：' + rel(root, f), rel(root, f));
    }
    return;
  }
  const detail = orphans.map((f) => rel(root, f)).join('、');
  report.warn('dependencies', 'features 存在 ' + orphans.length + ' 个孤儿文件（无 import 引用可达，开发模式降级为 WARN；最终必须接线）：' + detail);
}

function checkIcons(root, report) {
  const refs = [];
  const appFile = path.join(root, 'AppScope/app.json5');
  const moduleFile = path.join(root, 'entry/src/main/module.json5');
  const appData = exists(appFile) ? parseJson5File(report, appFile, 'app.json5') : null;
  const app = appData ? (appData.app || appData) : null;
  if (app && typeof app.icon === 'string') refs.push({ ref: app.icon, where: 'AppScope/app.json5' });
  const moduleData = exists(moduleFile) ? parseJson5File(report, moduleFile, 'module.json5') : null;
  const mod = moduleData ? (moduleData.module || moduleData) : null;
  if (mod && Array.isArray(mod.abilities)) {
    for (const ability of mod.abilities) {
      if (!ability || typeof ability !== 'object') continue;
      for (const field of ['icon', 'startWindowIcon']) {
        if (typeof ability[field] === 'string') refs.push({ ref: ability[field], where: 'entry/src/main/module.json5' });
      }
    }
  }
  if (!refs.length) {
    report.info('icons', '未发现 $media: 图标引用，跳过图标文件存在性检查');
    return;
  }
  const mediaRoots = [
    path.join(root, 'entry/src/main/resources'),
    path.join(root, 'AppScope/resources'),
  ];
  const mediaFiles = new Map();
  for (const mr of mediaRoots) {
    for (const f of walkFiles(mr)) {
      if (!rel(root, f).split('/').includes('media')) continue;
      if (/\.(png|webp|svg)$/i.test(f)) mediaFiles.set(path.basename(f), f);
    }
  }
  const seen = new Set();
  for (const item of refs) {
    const m = item.ref.match(/^\$media:([A-Za-z0-9_]+)$/);
    if (!m) {
      report.fail('icons', `图标引用格式不合法：${item.ref}`, item.where);
      continue;
    }
    const found = ['png', 'webp', 'svg'].map((ext) => mediaFiles.get(`${m[1]}.${ext}`)).find(Boolean);
    if (!found && !seen.has(m[1])) {
      seen.add(m[1]);
      report.fail('icons', `缺少图标资源：${m[1]}.png/.webp/.svg（media/ 下未找到）`, item.where);
      continue;
    }
    if (found && found.toLowerCase().endsWith('.png')) {
      const buffer = fs.readFileSync(found);
      const magic = buffer.subarray(0, 8);
      const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      if (!magic.equals(pngMagic)) {
        report.fail('icons', `图标不是合法 PNG（magic 不符）：${rel(root, found)}`, item.where);
        continue;
      }
      if (buffer.length >= 24 && buffer.toString('ascii', 12, 16) === 'IHDR') {
        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);
        if (width !== 72 || height !== 72) {
          report.warn('icons', `图标尺寸为 ${width}x${height}，建议 72x72；如为设计特例请在 README 注明`, rel(root, found));
        }
      }
    }
  }
}

function loadCommonErrorCodes(root) {
  const common = path.join(root, 'entry/src/main/ets/core/types/Common.ets');
  const text = readTextSafe(common);
  if (text == null) return null;
  const m = text.match(/export\s+enum\s+ErrorCode\s*\{([\s\S]*?)\}/);
  if (!m) return null;
  const codes = new Set();
  const re = /([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/g;
  let item;
  while ((item = re.exec(m[1])) !== null) codes.add(item[1]);
  return codes;
}

// 读取 token 的声明值：字面量 -> 返回值；枚举成员引用（ErrorCode.WEB_UNAVAILABLE / WEB_UNAVAILABLE）
// -> 返回被引用的成员名；其它形态返回 null（视为无法解析）。
function readDeclaredValue(text, token) {
  const re = new RegExp('\\b' + token + '\\b\\s*(?::\\s*[^=;]*)?=\\s*([^;]+);');
  const m = text.match(re);
  if (!m) return null;
  const expr = m[1].trim();
  const literal = expr.match(/^(['"])([A-Za-z0-9_]+)\1/);
  if (literal) return literal[2];
  const alias = expr.match(/^(?:[A-Za-z_$][A-Za-z0-9_$]*\.)?([A-Z][A-Z0-9_]*)\s*$/);
  return alias ? alias[1] : null;
}

// 平台文件常把降级码存进常量（如 const LOGIN_WEB_UNAVAILABLE = 'WEB_UNAVAILABLE'）或引用枚举成员
// （const LOGIN_WEB_UNAVAILABLE = ErrorCode.WEB_UNAVAILABLE）。这里递归展开别名，返回最终取值与别名链；
// 无声明时退回 token 本身（保持严格：未声明且不是 enum 成员仍会失败）。
function resolveDegradedCode(text, token) {
  const chain = [token];
  let current = token;
  const seen = new Set();
  for (let depth = 0; depth < 8; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    const next = readDeclaredValue(text, current);
    if (next === null || next === current) break;
    chain.push(next);
    current = next;
  }
  return { value: current, chain };
}

function checkDegraded(root, report) {
  const dir = path.join(root, 'entry/src/main/ets/platform');
  if (!exists(dir)) {
    report.info('degraded', 'platform/ 不存在，跳过降级码检查');
    return;
  }
  const knownCodes = loadCommonErrorCodes(root);
  if (knownCodes === null) {
    report.warn('degraded', '未找到 Common.ets/ErrorCode，无法校验 *_UNAVAILABLE 是否已定义');
  }
  const files = walkFiles(dir).filter((f) => f.endsWith('.ets'));
  let bad = 0;
  for (const f of files) {
    const text = readTextSafe(f);
    if (!text) continue;
    const code = stripJson5Comments(text);
    if (/NOT_IMPLEMENTED/.test(code)) {
      bad++;
      report.fail('degraded', 'platform/ 出现 NOT_IMPLEMENTED；平台不可用必须返回 *_UNAVAILABLE 降级码', rel(root, f));
      continue;
    }
    const codes = code.match(/\b[A-Z][A-Z0-9_]*_UNAVAILABLE\b/g) || [];
    if (!codes.length) {
      bad++;
      report.fail('degraded', 'platform 网关缺少 *_UNAVAILABLE 降级码', rel(root, f));
      continue;
    }
    if (knownCodes) {
      for (const token of new Set(codes)) {
        const resolved = resolveDegradedCode(code, token);
        const value = resolved.value;
        const suffixOk = /_UNAVAILABLE$/.test(value);
        const defined = knownCodes.has(value);
        if (suffixOk && defined) continue;
        bad++;
        const via = resolved.chain.length > 1 ? `（${resolved.chain.join(' → ')}）` : '';
        if (!suffixOk) {
          report.fail('degraded', `降级码 ${value} 不以 _UNAVAILABLE 结尾${via}；平台不可用必须返回 *_UNAVAILABLE 降级码`, rel(root, f));
        } else {
          report.fail('degraded', `降级码 ${value} 未在 Common.ets ErrorCode 中定义${via}（疑似拼错）`, rel(root, f));
        }
      }
    }
  }
  if (files.length && !bad) report.info('degraded', `已检查 ${files.length} 个 platform 文件，降级码正常`);
}

const KIT_ALIASES = new Set([
  'AbilityKit', 'ArkUI', 'BasicServicesKit', 'CalendarKit', 'NotificationKit',
  'ReminderAgentKit', 'BackgroundTasksKit', 'WebKit', 'CoreFileKit', 'PreferencesKit',
  'PDFKit', 'MediaKit', 'ImageKit', 'NetworkKit', 'AssetStoreKit', 'HUKS',
]);
const OHOS_ALLOWED = [
  /^data\.(preferences|relationalStore)$/,
  /^web\.webview$/,
  /^net\.http$/,
  /^file\.(picker|fs)$/,
  /^multimedia\.image$/,
  /^calendarManager$/,
  /^notificationManager$/,
  /^reminderAgentManager$/,
  /^resourceschedule\.workScheduler$/,
  /^security\.asset$/,
  /^huks$/,
  /^(ability|app|window|display|image|graphics|common|util)\./,
];

function checkKitImports(root, report) {
  const files = walkFiles(root).filter((f) => f.endsWith('.ets') && !rel(root, f).startsWith('AppScope/'));
  let count = 0;
  for (const f of files) {
    const relPath = rel(root, f);
    const text = readTextSafe(f);
    if (!text) continue;
    const code = stripJson5Comments(text);
    const re = /import\s+(?:[^'";]*?\s+from\s+)?['"](@kit\.[A-Za-z0-9_]+|@ohos\.[A-Za-z0-9_.]+)['"]/g;
    let m;
    while ((m = re.exec(code)) !== null) {
      count++;
      const spec = m[1];
      if (relPath.startsWith('entry/src/ohosTest/') && spec === '@ohos/hypium') {
        continue;
      }
      const allowedLoc = relPath.includes('/platform/') || relPath.includes('/entryability/');
      if (!allowedLoc) {
        report.fail('kit', `${relPath} 不得直接 import ${spec}；Kit 只能出现在 platform/ 或 entryability/`, relPath);
        continue;
      }
      if (relPath.includes('/entryability/')) {
        const entryAllowed = new Set(['AbilityKit', 'ArkUI']);
        if (!spec.startsWith('@kit.')) {
          report.fail('kit', `entryability 只允许 @kit.AbilityKit/@kit.ArkUI，不允许 ${spec}`, relPath);
          continue;
        }
        const entryAlias = spec.slice('@kit.'.length);
        if (!entryAllowed.has(entryAlias)) {
          report.fail('kit', `entryability 只允许 AbilityKit/ArkUI，实际 ${entryAlias}`, relPath);
        }
        continue;
      }
      if (spec.startsWith('@kit.')) {
        const alias = spec.slice('@kit.'.length);
        if (!KIT_ALIASES.has(alias)) {
          report.fail('kit', `Kit 别名不在白名单：${alias}（新增 Kit 需 lead 确认）`, relPath);
        }
      } else {
        const mod = spec.slice('@ohos.'.length);
        if (!OHOS_ALLOWED.some((rx) => rx.test(mod))) {
          report.fail('kit', `@ohos 模块不在白名单：${mod}（新增能力需 lead 确认）`, relPath);
        }
      }
    }
  }
  if (!count) report.info('kit', '未发现 @kit/@ohos import');
}

function checkHardcoded(root, report) {
  const files = walkFiles(root).filter((f) => f.endsWith('.ets') && !rel(root, f).startsWith('entry/src/ohosTest/'));
  const literalRe = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;
  const colorRe = /#[0-9a-fA-F]{3,8}\b/g;
  let chineseCount = 0;
  let colorCount = 0;
  for (const f of files) {
    const text = readTextSafe(f);
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      if (stripAllowed(rawLine)) continue;
      let line = rawLine;
      if (inBlock) {
        const end = line.indexOf('*/');
        if (end < 0) continue;
        line = line.slice(end + 2);
        inBlock = false;
      }
      const startBlock = line.indexOf('/*');
      if (startBlock >= 0) {
        const endBlock = line.indexOf('*/', startBlock + 2);
        if (endBlock < 0) { inBlock = true; line = line.slice(0, startBlock); }
        else line = line.slice(0, startBlock) + line.slice(endBlock + 2);
      }
      line = stripLineComment(line);
      const withoutResource = line.replace(/\$r\([^)]*\)/g, '');
      literalRe.lastIndex = 0;
      let m;
      while ((m = literalRe.exec(withoutResource)) !== null) {
        if (isCjkString(m[0])) {
          chineseCount++;
          if (chineseCount <= 20) report.fail('hardcoded', `页面/组件出现中文字符串字面量：${m[0].slice(0, 40)}`, rel(root, f), i + 1);
        }
      }
      colorRe.lastIndex = 0;
      while ((m = colorRe.exec(withoutResource)) !== null) {
        colorCount++;
        if (colorCount <= 20) report.fail('hardcoded', `出现硬编码颜色：${m[0]}`, rel(root, f), i + 1);
      }
    }
  }
  if (chineseCount > 20) report.info('hardcoded', `另有 ${chineseCount - 20} 处中文硬编码未列出`);
  if (colorCount > 20) report.info('hardcoded', `另有 ${colorCount - 20} 处硬编码颜色未列出`);
}

// P0-2 复发防线（§10 风险2）：core 禁止用 unicode 转义写中文来绕过 CJK 字面量检查。
// 只拦 CJK 表意文字（含扩展 A 与兼容表意），不拦控制字符或全角标点这类合法转义。
const CJK_ESCAPE_RE = /\\u([0-9a-fA-F]{4})/g;
function isCjkIdeograph(codePoint) {
  return (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff);
}
function checkCjkEscapes(root, report) {
  const files = walkFiles(root).filter((f) => f.endsWith('.ets') && rel(root, f).startsWith('entry/src/main/ets/core/'));
  for (const f of files) {
    const text = readTextSafe(f);
    if (text == null) continue;
    const rows = text.split(/\r?\n/);
    for (let i = 0; i < rows.length; i++) {
      CJK_ESCAPE_RE.lastIndex = 0;
      let m;
      while ((m = CJK_ESCAPE_RE.exec(rows[i])) !== null) {
        if (!isCjkIdeograph(parseInt(m[1], 16))) continue;
        report.fail('hardcoded', 'core 出现 CJK 的 unicode 转义（禁止绕开中文检查）：' + m[0], rel(root, f), i + 1);
      }
    }
  }
}

function checkRedlines(root, report) {
  const rules = [
    { name: 'any', re: /(^|[^\w$])any([^\w$]|$)/, message: '使用了 any（需显式类型或 // static-check-allow）' },
    { name: 'eval', re: /\beval\s*\(/, message: '使用了 eval(' },
    { name: 'globalThis', re: /\bglobalThis\b/, message: '使用了 globalThis' },
    { name: 'new Function', re: /\bnew\s+Function\s*\(/, message: '使用了 new Function' },
    { name: 'Proxy', re: /\bProxy\s*\(/, message: '使用了 Proxy(' },
    { name: 'as unknown', re: /\bas\s+unknown\b/, message: '使用了 as unknown 绕过类型' },
    { name: 'dynamic-property', re: /\[\s*['"][A-Za-z_][\w]*['"]\s*\]\s*=/, message: '使用了动态属性赋值 obj["x"] = ...' },
  ];
  const files = walkFiles(root).filter((f) => f.endsWith('.ets'));
  for (const f of files) {
    const text = readTextSafe(f);
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      if (stripAllowed(rawLine)) continue;
      let line = rawLine;
      if (inBlock) {
        const end = line.indexOf('*/');
        if (end < 0) continue;
        line = line.slice(end + 2);
        inBlock = false;
      }
      const startBlock = line.indexOf('/*');
      if (startBlock >= 0) {
        const endBlock = line.indexOf('*/', startBlock + 2);
        if (endBlock < 0) { inBlock = true; line = line.slice(0, startBlock); }
        else line = line.slice(0, startBlock) + line.slice(endBlock + 2);
      }
      line = stripLineComment(line);
      for (const rule of rules) {
        if (rule.re.test(line)) report.fail('redlines', rule.message, rel(root, f), i + 1);
      }
    }
  }
}

function resolveImport(fromFile, target) {
  const base = path.resolve(path.dirname(fromFile), target);
  const candidates = [base, `${base}.ets`, path.join(base, 'index.ets')];
  for (const c of candidates) if (exists(c) && statSafe(c)?.isFile()) return c;
  return null;
}

function moduleClass(file, etsRoot) {
  const r = path.relative(etsRoot, file).split(path.sep);
  return r.length > 1 ? r[0] : '';
}


const EXPORT_NAME = '[A-Za-z_$][A-Za-z0-9_$]*';

function collectExportedNames(text) {
  const names = new Set();
  let hasDefault = false;
  const declRe = new RegExp('export\\s+(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:interface|type|const|let|var|function|class|enum|struct)\\s+(' + EXPORT_NAME + ')', 'g');
  for (const m of text.matchAll(declRe)) {
    if (/^export\s+default\b/.test(m[0])) hasDefault = true;
    names.add(m[1]);
  }
  if (/export\s+default\b/.test(text)) hasDefault = true;
  const listRe = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  for (const m of text.matchAll(listRe)) {
    for (const raw of m[1].split(',')) {
      let s = raw.trim();
      if (!s) continue;
      s = s.replace(/^type\s+/, '');
      const asMatch = s.match(/\s+as\s+(.+)$/);
      const exported = (asMatch ? asMatch[1] : s).trim();
      if (new RegExp('^' + EXPORT_NAME + '$').test(exported)) names.add(exported);
    }
  }
  return { names, hasDefault };
}

function parseImportBindings(text) {
  const out = [];
  const push = (kind, names, target, index) => out.push({ kind, names, target, index });
  for (const m of text.matchAll(/import\s+(?:type\s+)?(?:[A-Za-z_$][A-Za-z0-9_$]*\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter((s) => new RegExp('^' + EXPORT_NAME + '$').test(s));
    push('named', names, m[2], m.index);
  }
  for (const m of text.matchAll(/import\s+(?:type\s+)?\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*\s*from\s*['"]([^'"]+)['"]/g)) push('star', [], m[1], m.index);
  for (const m of text.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s*['"]([^'"]+)['"]/g)) push('default', [], m[2], m.index);
  for (const m of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter((s) => new RegExp('^' + EXPORT_NAME + '$').test(s));
    push('reexport', names, m[2], m.index);
  }
  return out;
}

function checkImportExports(root, files, texts, report) {
  const exportsCache = new Map();
  const exportsOf = (file) => {
    if (!exportsCache.has(file)) exportsCache.set(file, collectExportedNames(texts.get(file) ?? readTextSafe(file) ?? ''));
    return exportsCache.get(file);
  };
  for (const f of files) {
    const text = texts.get(f);
    if (text == null) continue;
    const relFile = rel(root, f);
    for (const imp of parseImportBindings(text)) {
      const { target, kind } = imp;
      if (!target.startsWith('.')) continue;
      const line = lineAt(text, imp.index);
      const resolved = resolveImport(f, target);
      if (!resolved) {
        report.fail('dependencies', '相对 import 目标文件不存在：' + target, relFile, line);
        continue;
      }
      const exp = exportsOf(resolved);
      if (kind === 'default') {
        if (!exp.hasDefault) report.fail('dependencies', 'import default 但 ' + target + ' 未导出 default', relFile, line);
      } else if (kind === 'named' || kind === 'reexport') {
        for (const name of imp.names) {
          if (!exp.names.has(name)) {
            const verb = kind === 'reexport' ? 're-export' : 'import';
            report.fail('dependencies', verb + ' 的 ' + name + ' 未在 ' + target + ' 导出（编译将报 TS2305）', relFile, line);
          }
        }
      }
    }
  }
}

function checkDependencies(root, report) {
  const etsRoot = path.join(root, 'entry/src/main/ets');
  const files = walkFiles(etsRoot).filter((f) => f.endsWith('.ets'));
  if (files.length === 0) {
    report.warn('dependencies', 'entry/src/main/ets 下暂无 .ets 文件');
    return;
  }
  const blocked = {
    core: ['pages', 'platform', 'data', 'export'],
    data: ['pages'],
    platform: ['pages'],
  };
  const importRe = /^\s*(?:import|export)\b[\s\S]*?from\s*['"]([^'"]+)['"]/gm;
  const edges = [];
  const graph = new Map();
  const texts = new Map();
  for (const f of files) graph.set(f, []);
  for (const f of files) {
    const text = readTextSafe(f);
    if (text == null) continue;
    texts.set(f, text);
    const lines = text.split(/\r?\n/);
    importRe.lastIndex = 0;
    let m;
    while ((m = importRe.exec(text)) !== null) {
      const target = m[1];
      const line = lineAt(text, m.index);
      const fromClass = moduleClass(f, etsRoot);
      if (target.startsWith('.')) {
        const resolved = resolveImport(f, target);
        if (!resolved) continue; // 存在性与导出名统一由 checkImportExports 报 FAIL
        const toClass = moduleClass(resolved, etsRoot);
        edges.push({ from: f, to: resolved, target, line });
        if (graph.has(resolved)) graph.get(f).push(resolved);
        if (blocked[fromClass] && blocked[fromClass].includes(toClass)) {
          report.fail('dependencies', `${fromClass} 不得 import ${toClass}（${target}）`, rel(root, f), line);
        }
        if (fromClass === 'core' && (target.startsWith('@kit.') || target.startsWith('@ohos.'))) {
          report.warn('dependencies', `core 不应依赖 Kit：${target}`, rel(root, f), line);
        }
      } else if (target.startsWith('@kit.') || target.startsWith('@ohos.')) {
        if (fromClass === 'core') report.warn('dependencies', `core 不应依赖 Kit：${target}`, rel(root, f), line);
      }
    }
  }
  checkImportExports(root, files, texts, report);
  // 循环依赖 DFS
  const color = new Map();
  const stack = [];
  const cycles = new Set();
  function dfs(node) {
    color.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      if (!graph.has(next)) continue;
      if (color.get(next) === 1) {
        const idx = stack.indexOf(next);
        if (idx >= 0) {
          const cycle = stack.slice(idx).concat([next]).map((x) => path.basename(x)).join(' -> ');
          cycles.add(cycle);
        }
      } else if (!color.get(next)) {
        dfs(next);
      }
    }
    stack.pop();
    color.set(node, 2);
  }
  for (const f of files) if (!color.get(f)) dfs(f);
  for (const cyc of cycles) report.fail('dependencies', `存在循环依赖：${cyc}`);
}

function permissionAllowed(name) {
  const suffix = name.split('.').pop();
  const exact = new Set([
    'INTERNET', 'READ_CALENDAR', 'WRITE_CALENDAR', 'PUBLISH_AGENT_REMINDER',
    'NOTIFICATION_CONTROLLER', 'NOTIFICATION_AGENT_CONTROLLER', 'KEEP_BACKGROUND_RUNNING',
    'WORK_SCHEDULER', 'RUNNING_STATE', 'GET_NETWORK_INFO',
  ]);
  if (exact.has(suffix)) return true;
  return /NOTIFICATION|REMINDER|BACKGROUND|WORK_SCHEDULER/.test(suffix);
}

function collectResourceStrings(root) {
  const values = new Map();
  for (const rr of [path.join(root, 'entry/src/main/resources'), path.join(root, 'AppScope/resources')]) {
    for (const f of walkFiles(rr)) {
      if (!f.endsWith('.json')) continue;
      if (!rel(root, f).split('/').includes('element')) continue;
      const text = readTextSafe(f);
      if (text == null) continue;
      let data;
      try { data = JSON.parse(text); } catch { continue; }
      const entries = Array.isArray(data)
        ? data
        : Object.values(data || {}).filter(Array.isArray).flat();
      for (const item of entries) {
        if (item && typeof item.name === 'string' && typeof item.value === 'string') values.set(item.name, item.value);
      }
    }
  }
  return values;
}

function checkPermissions(root, report) {
  const moduleFile = path.join(root, 'entry/src/main/module.json5');
  if (!exists(moduleFile)) {
    report.fail('permissions', 'module.json5 不存在，无法检查权限', 'entry/src/main/module.json5');
    return;
  }
  const data = parseJson5File(report, moduleFile, 'module.json5');
  if (!data) return;
  const mod = data.module || data;
  const perms = mod.requestPermissions;
  if (perms == null) {
    report.info('permissions', '未声明 requestPermissions');
    return;
  }
  if (!Array.isArray(perms)) {
    report.fail('permissions', 'requestPermissions 必须是数组', 'entry/src/main/module.json5');
    return;
  }
  const resourceStrings = collectResourceStrings(root);
  for (let i = 0; i < perms.length; i++) {
    const p = perms[i] || {};
    const name = typeof p.name === 'string' ? p.name : '';
    if (!name) {
      report.fail('permissions', `requestPermissions[${i}] 缺少 name`, 'entry/src/main/module.json5');
      continue;
    }
    let reason = typeof p.reason === 'string' ? p.reason : '';
    let reasonKeyMissing = false;
    const ref = reason.match(/^\$string:([A-Za-z0-9_.]+)$/);
    if (ref) {
      if (!resourceStrings.has(ref[1])) {
        reasonKeyMissing = true;
        report.fail('permissions', '权限 ' + name + ' 的 reason 资源键 $string:' + ref[1] + ' 未定义', 'entry/src/main/module.json5');
      } else {
        reason = resourceStrings.get(ref[1]) || '';
      }
    }
    if (!reasonKeyMissing && !isCjkString(reason)) {
      report.fail('permissions', '权限 ' + name + ' 缺少中文 reason', 'entry/src/main/module.json5');
    }
    if (!permissionAllowed(name)) {
      report.fail('permissions', `权限 ${name} 不在白名单内；新增权限需 lead 确认`, 'entry/src/main/module.json5');
    }
  }
}

const REQUIRED_CONTRACTS = {
  CalendarEvent: ['key', 'title', 'location', 'description', 'startMillis', 'endMillis', 'startDate', 'startTime', 'endTime', 'source'],
  CalendarSyncResult: ['ok', 'written', 'deleted', 'failed', 'skipped', 'calendarId', 'lastSyncAt', 'lastEventCount'],
  AppState: ['version', 'snapshot', 'events', 'overrides', 'localMaps', 'holidaySettings', 'courseSettings', 'customCourses', 'theme', 'showDayOverview', 'settingsExpanded', 'calendarOptions', 'notificationEnabled', 'classReminders', 'autoCheckEnabled', 'lastSuccess', 'lastAttempt', 'error'],
  SemesterSnapshot: ['id', 'name', 'startDate', 'weeks', 'rules', 'source'],
  CourseRow: ['key', 'date', 'startTime', 'endTime', 'periods', 'name', 'teacher', 'room', 'cancelled', 'vacant', 'localActivity', 'customCourse', 'remapId', 'conflict', 'overlap', 'source', 'originDate'],
  LeaveRecord: ['id', 'type', 'status', 'startDate', 'startTime', 'endDate', 'endTime', 'reason', 'approver', 'comment', 'rawStatus', 'semesterId', 'demo'],
  ExportResult: ['uri', 'mime', 'bytes', 'pages'],
  PermissionService: ['status', 'requestCalendar', 'requestNotification', 'openSystemSettings'],
  DiagnosticsService: ['snapshot', 'exportText'],
  PreferencesStore: ['get', 'set', 'delete'],
};

function extractInterfaces(text) {
  const result = new Map();
  const re = /export\s+interface\s+([A-Za-z_$][\w$]*)[^{]*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
    }
    const body = text.slice(re.lastIndex, i - 1);
    const fields = new Set();
    const fieldRe = /([A-Za-z_$][\w$]*)\s*\??\s*:/g;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) fields.add(fm[1]);
    const methodRe = /([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*:/g;
    while ((fm = methodRe.exec(body)) !== null) fields.add(fm[1]);
    result.set(name, fields);
  }
  return result;
}

function checkContracts(root, report) {
  const typesDir = path.join(root, 'entry/src/main/ets/core/types');
  const files = walkFiles(typesDir).filter((f) => f.endsWith('.ets'));
  if (files.length === 0) {
    report.fail('contracts', '缺少 core/types/*.ets，无法检查接口契约', 'entry/src/main/ets/core/types');
    return;
  }
  const interfaces = new Map();
  for (const f of files) {
    const text = readTextSafe(f);
    if (!text) continue;
    const found = extractInterfaces(text);
    for (const [name, fields] of found) interfaces.set(name, fields);
  }
  for (const [name, required] of Object.entries(REQUIRED_CONTRACTS)) {
    const fields = interfaces.get(name);
    if (!fields) {
      report.fail('contracts', `缺少接口 ${name}`, 'entry/src/main/ets/core/types');
      continue;
    }
    const missing = required.filter((x) => !fields.has(x));
    if (missing.length) {
      report.fail('contracts', `接口 ${name} 缺少字段：${missing.join(', ')}`, 'entry/src/main/ets/core/types');
    }
  }
  const scanDirs = [
    path.join(root, 'entry/src/main/ets/core/types'),
    path.join(root, 'entry/src/main/ets/platform'),
  ];
  for (const dir of scanDirs) {
    if (!exists(dir)) continue;
    for (const f of walkFiles(dir).filter((x) => x.endsWith('.ets'))) {
      const text = readTextSafe(f);
      if (!text) continue;
      const code = stripJson5Comments(text);
      const retRe = /\)\s*:\s*(?:Promise<\s*)?(object\[\]|any|Object)\b/g;
      let rm;
      while ((rm = retRe.exec(code)) !== null) {
        report.fail('contracts', `返回类型不能是 ${rm[1]}（契约禁止 any/Object/object[]）`, rel(root, f));
      }
    }
  }
}

function checkVersion(root, report) {
  const appFile = path.join(root, 'AppScope/app.json5');
  if (!exists(appFile)) return;
  const data = parseJson5File(report, appFile, 'app.json5');
  if (!data) return;
  const app = data.app || data;
  if (app.bundleName !== 'cn.local.tomorrow') {
    report.fail('version', `bundleName 必须为 cn.local.tomorrow，实际 ${String(app.bundleName)}`, 'AppScope/app.json5');
  }
  if (app.versionName == null) report.fail('version', 'app.json5 缺少 versionName', 'AppScope/app.json5');
  if (app.versionCode == null) report.fail('version', 'app.json5 缺少 versionCode', 'AppScope/app.json5');
  const readme = path.join(root, 'README-Harmony.md');
  if (!exists(readme)) {
    report.warn('version', 'README-Harmony.md 不存在，跳过版本一致性检查');
    return;
  }
  const text = readTextSafe(readme) || '';
  const codeMatch = text.match(/(?:versionCode|版本代码)\s*[:：=]?\s*`?\s*(\d+)/i);
  const nameMatch = text.match(/(?:versionName|版本名|版本号)\s*[:：=]?\s*`?\s*([0-9][0-9A-Za-z.\-]*)/i);
  if (!codeMatch && !nameMatch) {
    report.warn('version', 'README-Harmony.md 未找到 versionName/versionCode 声明');
    return;
  }
  if (nameMatch && app.versionName != null && nameMatch[1] !== String(app.versionName)) {
    report.fail('version', `README versionName=${nameMatch[1]} 与 app.json5 ${app.versionName} 不一致`, 'README-Harmony.md');
  }
  if (codeMatch && app.versionCode != null && Number(codeMatch[1]) !== Number(app.versionCode)) {
    report.fail('version', `README versionCode=${codeMatch[1]} 与 app.json5 ${app.versionCode} 不一致`, 'README-Harmony.md');
  }
}

export function runChecks(root = DEFAULT_ROOT, options = {}) {
  const absRoot = path.resolve(root);
  const strict = options.strict === true;
  const mode = strict ? 'strict' : 'dev';
  const report = new Report(absRoot);
  if (!exists(absRoot) || !statSafe(absRoot)?.isDirectory()) {
    report.fail('structure', `工程根不存在或不是目录：${absRoot}`);
    return { root: absRoot, strict, mode, items: report.items, counts: report.counts(), exitCode: 1 };
  }
  checkStructure(absRoot, report);
  checkEntryPages(absRoot, report);
  checkJson5Files(absRoot, report);
  checkResources(absRoot, report, strict);
  checkResourceRequests(absRoot, report, strict);
  checkIcons(absRoot, report);
  checkHardcoded(absRoot, report);
  checkCjkEscapes(absRoot, report);
  checkRedlines(absRoot, report);
  checkDegraded(absRoot, report);
  checkKitImports(absRoot, report);
  checkDependencies(absRoot, report);
  checkFeaturesOrphans(absRoot, report, strict);
  checkPermissions(absRoot, report);
  checkContracts(absRoot, report);
  checkVersion(absRoot, report);
  const counts = report.counts();
  return { root: absRoot, strict, mode, items: report.items, counts, exitCode: counts.fail > 0 ? 1 : 0 };
}

export function formatResult(result) {
  const lines = [];
  const order = { FAIL: 0, WARN: 1, INFO: 2 };
  const items = [...result.items].sort((a, b) => (order[a.severity] - order[b.severity]));
  for (const it of items) {
    const loc = it.file ? `${it.file}${it.line ? `:${it.line}` : ''}` : '-';
    lines.push(`[${it.severity}] (${it.check}) ${loc} ${it.message}`);
  }
  lines.push(`静态检查：${result.counts.fail} 项失败 / ${result.counts.warn} 项警告`);
  return lines.join('\n');
}

function envStrict() {
  const raw = String(process.env.HARMONY_STRICT == null ? '' : process.env.HARMONY_STRICT).trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function main(argv) {
  let root = DEFAULT_ROOT;
  let json = false;
  let strict = envStrict();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--strict') strict = true;
    else if (a === '--root') { root = argv[++i]; }
    else if (a === '--help' || a === '-h') {
      console.log('用法：node tools/check-harmony.mjs [--root <harmony 工程根>] [--json] [--strict]');
      console.log('  --strict / HARMONY_STRICT=1：resource-requests 未合并键、features 孤儿文件按 FAIL 处理');
      console.log('  默认开发模式：上述两类降级为 WARN（仍打印数量与文件清单），其余规则照常 FAIL');
      process.exit(0);
    } else if (!a.startsWith('-')) root = a;
  }
  const result = runChecks(root, { strict });
  if (json) {
    const payload = {
      ...result,
      compiled: false,
      staticOnly: true,
      checkedCategories: CHECK_CATEGORIES,
      note: '未编译，仅静态检查；静态通过不等于可编译',
    };
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`工程根：${result.root}`);
    console.log(`模式：${result.mode === 'strict' ? '严格（--strict，交付/回归/构建）' : '开发（未合并资源请求与 features 孤儿降级为 WARN；交付前请用 --strict）'}`);
    console.log(formatResult(result));
    console.log('说明：未编译，仅静态检查；静态通过 != 可编译。');
  }
  process.exit(result.exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
