#!/usr/bin/env node
/**
 * HarmonyOS 工程静态检查（分支 B：无 SDK，仅静态）
 *
 * 用法：
 *   node tools/check-harmony.mjs [--root <harmony 工程根>] [--json]
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

function checkResources(root, report) {
  const { keys } = collectResourceKeys(root, report);
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
  let unreferenced = 0;
  for (const [key, file] of keys) {
    if (!referenced.has(key)) {
      unreferenced++;
      if (unreferenced <= 30) report.warn('resources', `资源已定义但未引用：${key}`, file);
    }
  }
  if (unreferenced > 30) report.info('resources', `另有 ${unreferenced - 30} 个未引用资源键未列出`);
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
        if (!knownCodes.has(token)) {
          bad++;
          report.fail('degraded', `降级码 ${token} 未在 Common.ets ErrorCode 中定义（疑似拼错）`, rel(root, f));
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
  for (const f of files) graph.set(f, []);
  for (const f of files) {
    const text = readTextSafe(f);
    if (text == null) continue;
    const lines = text.split(/\r?\n/);
    importRe.lastIndex = 0;
    let m;
    while ((m = importRe.exec(text)) !== null) {
      const target = m[1];
      const line = lineAt(text, m.index);
      const fromClass = moduleClass(f, etsRoot);
      if (target.startsWith('.')) {
        const resolved = resolveImport(f, target);
        if (!resolved) {
          report.warn('dependencies', `无法解析相对 import：${target}`, rel(root, f), line);
          continue;
        }
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
    const ref = reason.match(/^\$string:([A-Za-z0-9_.]+)$/);
    if (ref) reason = resourceStrings.get(ref[1]) || '';
    if (!isCjkString(reason)) {
      report.fail('permissions', `权限 ${name} 缺少中文 reason`, 'entry/src/main/module.json5');
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

export function runChecks(root = DEFAULT_ROOT) {
  const absRoot = path.resolve(root);
  const report = new Report(absRoot);
  if (!exists(absRoot) || !statSafe(absRoot)?.isDirectory()) {
    report.fail('structure', `工程根不存在或不是目录：${absRoot}`);
    return { root: absRoot, items: report.items, counts: report.counts(), exitCode: 1 };
  }
  checkStructure(absRoot, report);
  checkEntryPages(absRoot, report);
  checkJson5Files(absRoot, report);
  checkResources(absRoot, report);
  checkIcons(absRoot, report);
  checkHardcoded(absRoot, report);
  checkRedlines(absRoot, report);
  checkDegraded(absRoot, report);
  checkKitImports(absRoot, report);
  checkDependencies(absRoot, report);
  checkPermissions(absRoot, report);
  checkContracts(absRoot, report);
  checkVersion(absRoot, report);
  const counts = report.counts();
  return { root: absRoot, items: report.items, counts, exitCode: counts.fail > 0 ? 1 : 0 };
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

function main(argv) {
  let root = DEFAULT_ROOT;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--root') { root = argv[++i]; }
    else if (a === '--help' || a === '-h') {
      console.log('用法：node tools/check-harmony.mjs [--root <harmony 工程根>] [--json]');
      process.exit(0);
    } else if (!a.startsWith('-')) root = a;
  }
  const result = runChecks(root);
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
    console.log(formatResult(result));
    console.log('说明：未编译，仅静态检查；静态通过 != 可编译。');
  }
  process.exit(result.exitCode);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
