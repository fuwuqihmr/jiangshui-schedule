#!/usr/bin/env node
/**
 * 真实编译门禁：干净副本 + hvigor assembleHap + 日志解析。
 *
 * 用法：
 *   node tools/build-gate.mjs [--root <harmony>] [--dest <path>] [--label <名>]
 *                             [--timeout-ms <毫秒>] [--keep] [--no-prewarm]
 *                             [--strict] [--precheck-only]
 *   node tools/build-gate.mjs --parse-log <已有日志>
 *   node tools/build-gate.mjs --hap-manifest <已有 HAP>
 *
 * 退出码：
 *   0  编译成功（ERROR=0 且找到 HAP）
 *   2  编译失败且解析到 >=1 个 ERROR
 *   3  构建失败但未解析到 ERROR（依赖/环境/签名等）
 *   4  复制、缓存、进程或 IO 准备失败
 *   5  报告成功但 HAP 缺失
 *   6  --strict 可达性门禁失败（features/** 有孤儿，或 platform/其他有未登记在白名单的不可达）
 *   7  --strict 编译完整性失败（进入编译的 .ets + 白名单不可达 != 全树，或 HAP 包内清单不可计算）
 *   64 参数错误
 *   124 构建超时
 *
 * 说明：脚本只复制当前工作树，不做任何源码合并；副本默认位于
 * <系统临时目录>/jiangshui-build/work-guard-<yyyyMMdd-HHmm>（可用
 * JIANGSHUI_BUILD_ROOT 覆盖），构建前删除 build/.hvigor/oh_modules 等生成目录；
 * 本机开发环境路径一律由环境变量注入，不写死任何机器布局。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(TOOLS_DIR, '..');
// 全部本机路径由环境变量注入；未设置时落在系统临时目录，不假设任何开发机布局。
const DEFAULT_BUILD_ROOT = process.env.JIANGSHUI_BUILD_ROOT || path.join(os.tmpdir(), 'jiangshui-build');
const DEFAULT_CLI_HOME = process.env.DEVECO_CLI_HOME || '';
const DEFAULT_HVIGOR_HOME = process.env.HVIGOR_USER_HOME || path.join(DEFAULT_BUILD_ROOT, 'hvigor-home');
const DEFAULT_JAVA_HOME = process.env.JAVA_HOME || '';
const DEFAULT_ENV_HOME = process.env.JIANGSHUI_DEV_HOME || path.join(DEFAULT_BUILD_ROOT, 'env');
const DEFAULT_LOG_ROOT = path.join(DEFAULT_BUILD_ROOT, 'logs');
const HAP_HINT = 'entry/build/default/outputs/default/entry-default-unsigned.hap';
const EXIT = { ok: 0, compileError: 2, buildFailed: 3, setup: 4, noHap: 5, reachability: 6, coverage: 7, usage: 64, timeout: 124 };

function usage() {
  return [
    '真实编译门禁（干净副本，不使用本地临时合并）',
    '',
    '用法：',
    '  node tools/build-gate.mjs [选项]',
    '  node tools/build-gate.mjs --parse-log <日志文件>',
    '',
    '选项：',
    '  --root <dir>        项目 harmony 目录（默认脚本上一级）',
    '  --dest <dir>        指定构建副本目录（默认 <build-root>/work-guard-<stamp>）',
    '  --label <name>      追加到默认副本目录名的标签',
    '  --timeout-ms <n>    构建超时，默认 900000',
    '  --keep              成功也保留副本（失败默认保留）',
    '  --no-prewarm        不预建 hvigor project_caches junction',
    '  --strict            构建前断言 features/** 0 孤儿、platform/其他不可达均在',
    '                      tools/unreachable-allowlist.json 白名单内；构建后断言',
    '                      进入编译的 .ets + 白名单不可达 = 全树 .ets，否则退出 6/7',
    '  --precheck-only     只跑可达性预检，不复制、不构建',
    '  --parse-log <file>  只解析已有日志，不执行构建',
    '  --hap-manifest <hap> 只计算已有 HAP 的包内文件清单哈希，不执行构建',
    '  --help              显示本帮助',
    '',
    '退出码：0 成功 / 2 编译 ERROR / 3 构建失败未解析出 ERROR / 4 环境失败 /',
    '        5 成功但无 HAP / 6 可达性门禁失败 / 7 编译完整性失败 /',
    '        64 参数错误 / 124 超时',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    root: DEFAULT_ROOT,
    dest: null,
    label: '',
    timeoutMs: 900000,
    keep: false,
    prewarm: true,
    strict: false,
    precheckOnly: false,
    parseLog: null,
    hapManifest: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const take = (name) => {
      if (i + 1 >= argv.length) throw new Error(name + ' 缺少参数');
      i += 1;
      return argv[i];
    };
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--root') opts.root = path.resolve(take('--root'));
    else if (arg.startsWith('--root=')) opts.root = path.resolve(arg.slice('--root='.length));
    else if (arg === '--dest') opts.dest = path.resolve(take('--dest'));
    else if (arg.startsWith('--dest=')) opts.dest = path.resolve(arg.slice('--dest='.length));
    else if (arg === '--label') opts.label = take('--label');
    else if (arg.startsWith('--label=')) opts.label = arg.slice('--label='.length);
    else if (arg === '--timeout-ms') opts.timeoutMs = Number(take('--timeout-ms'));
    else if (arg.startsWith('--timeout-ms=')) opts.timeoutMs = Number(arg.slice('--timeout-ms='.length));
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--no-prewarm') opts.prewarm = false;
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--precheck-only') opts.precheckOnly = true;
    else if (arg === '--parse-log') opts.parseLog = path.resolve(take('--parse-log'));
    else if (arg.startsWith('--parse-log=')) opts.parseLog = path.resolve(arg.slice('--parse-log='.length));
    else if (arg === '--hap-manifest') opts.hapManifest = path.resolve(take('--hap-manifest'));
    else if (arg.startsWith('--hap-manifest=')) opts.hapManifest = path.resolve(arg.slice('--hap-manifest='.length));
    else throw new Error('未知参数：' + arg);
  }
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs < 10000) throw new Error('--timeout-ms 必须 >= 10000');
  if (opts.label && /[\\/:*?"<>|]/.test(opts.label)) throw new Error('--label 不能包含路径分隔符或 Windows 非法字符');
  return opts;
}

function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return String(date.getFullYear()) + p(date.getMonth() + 1) + p(date.getDate()) + '-' + p(date.getHours()) + p(date.getMinutes());
}
function fullStamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return stamp(date) + '-' + p(date.getSeconds());
}
function stripAnsi(text) {
  return String(text)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\r/g, '');
}
function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
function sha256File(file) {
  return sha256(fs.readFileSync(file));
}
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
function relOf(base, file) {
  return path.relative(base, file).split(path.sep).join('/');
}
const GENERATED_TOP = new Set(['.hvigor', 'oh_modules', 'node_modules', 'build', '.git']);
function isGenerated(base, file) {
  const rel = path.relative(base, file);
  const parts = rel.split(path.sep);
  if (GENERATED_TOP.has(parts[0])) return true;
  if (parts[0] === 'entry' && parts[1] === 'build') return true;
  return false;
}
// ---- 可达性预检（编译门禁前置） ----
// 只有被真实编译入口 import 到的 features/** 与 platform/** 才会进编译；
// 孤儿文件不参与编译，编译通过也不能证明它们可编译（的教训）。
const ETS_SUBDIR = path.join('entry', 'src', 'main', 'ets');
const BUILD_ROOTS = [
  'entryability/EntryAbility.ets',
  'pages/Index.ets',
  'platform/system/SystemWorkAbility.ets',
];
const IMPORT_RE = /^[ \t]*(import|export)[ \t]+([^;'"]*?)\bfrom[ \t]+['"]([^'"]+)['"]|^[ \t]*import[ \t]*['"]([^'"]+)['"]/gm;

// ---- 不可达白名单（Lead 2026-10-30 裁定） ----
// 本轮不清理旧桩/重复实现，但 --strict 的完整性等式必须成立：
//   进入编译的 .ets + 白名单不可达 = 全树 .ets
// 每条必须带理由、Lead 批准日期与处置；test-only 只允许测试引用，其余必须零 import/测试引用。
const ALLOWLIST_REL = path.join('tools', 'unreachable-allowlist.json');
const ALLOWLIST_DECISION = 'lead-approved-2026-10-30';
const ALLOWLIST_DISPOSITIONS = new Set(['next-round-cleanup', 'test-only']);

function normalizeAllowlistPath(raw) {
  let rel = String(raw || '').replace(/\\/g, '/').trim();
  if (rel.startsWith('./')) rel = rel.slice(2);
  const marker = 'entry/src/main/ets/';
  if (rel.startsWith(marker)) rel = rel.slice(marker.length);
  return rel;
}

function loadUnreachableAllowlist(root) {
  const file = path.join(root, ALLOWLIST_REL);
  const errors = [];
  const byPath = new Map();
  if (!fs.existsSync(file)) {
    errors.push('缺少不可达白名单：' + relOf(root, file));
    return { file, entries: [], byPath, errors };
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push('不可达白名单 JSON 解析失败：' + error.message);
    return { file, entries: [], byPath, errors };
  }
  if (!data || !Array.isArray(data.entries)) {
    errors.push('不可达白名单缺少 entries 数组');
    return { file, entries: [], byPath, errors };
  }
  for (let index = 0; index < data.entries.length; index += 1) {
    const entry = data.entries[index];
    const where = '#' + (index + 1) + '（' + (entry && entry.path ? entry.path : '无 path') + '）';
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push('白名单条目不是对象：' + where);
      continue;
    }
    const rel = normalizeAllowlistPath(entry.path);
    if (!rel || rel.startsWith('..') || path.posix.isAbsolute(rel) || !rel.endsWith('.ets')) {
      errors.push('白名单 path 非法（应为 entry/src/main/ets 下的相对 .ets 路径）：' + where);
      continue;
    }
    if (byPath.has(rel)) {
      errors.push('白名单 path 重复：' + rel);
      continue;
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 8) {
      errors.push('白名单条目缺少可读 reason：' + where);
      continue;
    }
    if (entry.decision !== ALLOWLIST_DECISION) {
      errors.push('白名单 decision 必须为 ' + ALLOWLIST_DECISION + '：' + rel);
      continue;
    }
    if (!ALLOWLIST_DISPOSITIONS.has(entry.disposition)) {
      errors.push('白名单 disposition 必须为 next-round-cleanup 或 test-only：' + rel);
      continue;
    }
    byPath.set(rel, { ...entry, path: rel });
  }
  return { file, entries: [...byPath.values()], byPath, errors };
}

function testReferenceFiles(root, rel) {
  const needle = rel.replace(/\.ets$/, '');
  const dirs = [path.join(root, 'tools', 'tests'), path.join(root, 'entry', 'src', 'ohosTest')];
  const hits = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      if (!/\.(mjs|ets|ts)$/.test(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      if (text.includes(needle)) hits.push(relOf(root, file));
    }
  }
  return [...new Set(hits)].sort();
}

function listEtsFiles(root) {
  const etsRoot = path.join(root, ETS_SUBDIR);
  if (!fs.existsSync(etsRoot)) throw new Error('缺少 ETS 目录：' + etsRoot);
  return walk(etsRoot)
    .filter((file) => file.endsWith('.ets'))
    .map((file) => path.relative(etsRoot, file).split(path.sep).join('/'))
    .sort();
}

function resolveRelEtsImport(fromRel, spec, fileSet) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  if (base.startsWith('..') || path.posix.isAbsolute(base)) return null;
  for (const candidate of [base, base + '.ets', path.posix.join(base, 'index.ets')]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function collectExportKinds(text) {
  const kinds = new Map();
  for (const match of text.matchAll(/^[ \t]*export[ \t]+(?:default[ \t]+)?(interface|type|class|const|let|var|function|enum|struct|namespace)[ \t]+([A-Za-z_$][\w$]*)/gm)) {
    kinds.set(match[2], match[1]);
  }
  if (/^[ \t]*export[ \t]+default[ \t]+(?!interface\b|type\b)/m.test(text)) kinds.set('default', 'class');
  return kinds;
}

function importedRuntimeBindings(clause, targetExports) {
  const text = String(clause || '').trim();
  if (!text) return true; // side-effect import
  if (/^type\b/.test(text)) return false;
  const names = [];
  const brace = text.indexOf('{');
  if (brace < 0) {
    if (/^\*/.test(text)) return true;
    const first = text.split(',')[0].trim();
    if (first && !/^type\b/.test(first)) names.push('default');
  } else {
    const before = text.slice(0, brace).replace(/,$/, '').trim();
    if (before && !/^type\b/.test(before)) names.push('default');
    const inside = text.slice(brace + 1, text.lastIndexOf('}'));
    for (const part of inside.split(',')) {
      const entry = part.trim();
      if (!entry || /^type\b/.test(entry)) continue;
      const name = entry.split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  if (!names.length) return false;
  if (!targetExports) return true;
  return names.some((name) => {
    if (name === '*') return true;
    const kind = targetExports.get(name);
    if (!kind) return true;
    return kind !== 'interface' && kind !== 'type';
  });
}

function isTypeOnlyModule(text) {
  const kinds = [...text.matchAll(/^[ \t]*export[ \t]+(?:default[ \t]+)?(interface|type|class|const|let|var|function|enum|struct|namespace)\b/gm)].map((m) => m[1]);
  return kinds.length > 0 && kinds.every((kind) => kind === 'interface' || kind === 'type');
}

function reachableFrom(roots, graph) {
  const reached = new Set();
  const queue = [...roots];
  while (queue.length) {
    const rel = queue.shift();
    if (reached.has(rel)) continue;
    reached.add(rel);
    for (const next of graph.get(rel) || []) if (!reached.has(next)) queue.push(next);
  }
  return reached;
}

function analyzeBuildReachability(root) {
  const etsRoot = path.join(root, ETS_SUBDIR);
  const allFiles = listEtsFiles(root);
  const fileSet = new Set(allFiles);
  const texts = new Map();
  const typeOnlyModules = new Set();
  const exportsByFile = new Map();
  for (const rel of allFiles) {
    const text = fs.readFileSync(path.join(etsRoot, rel), 'utf8');
    texts.set(rel, text);
    exportsByFile.set(rel, collectExportKinds(text));
    if (isTypeOnlyModule(text)) typeOnlyModules.add(rel);
  }
  const allGraph = new Map();
  const runtimeGraph = new Map();
  for (const rel of allFiles) {
    const text = texts.get(rel);
    const allTargets = new Set();
    const runtimeTargets = new Set();
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[3] || match[4];
      if (!spec) continue;
      const target = resolveRelEtsImport(rel, spec, fileSet);
      if (!target) continue;
      allTargets.add(target);
      // `import type` / `export type` 边、以及只含 interface/type 的目标模块都不产生运行时模块；隔离后才能与 sourceMaps 对账。
      const explicitTypeEdge = /^[ \t]*type\b/.test(match[2] || '');
      const runtimeBinding = importedRuntimeBindings(match[2], exportsByFile.get(target));
      if (!explicitTypeEdge && !typeOnlyModules.has(target) && runtimeBinding) runtimeTargets.add(target);
    }
    allGraph.set(rel, [...allTargets]);
    runtimeGraph.set(rel, typeOnlyModules.has(rel) ? [] : [...runtimeTargets]);
  }
  const roots = BUILD_ROOTS.filter((rel) => fileSet.has(rel));
  const missingRoots = BUILD_ROOTS.filter((rel) => !fileSet.has(rel));
  const allReached = reachableFrom(roots, allGraph);
  const runtimeReached = reachableFrom(roots, runtimeGraph);
  const unreachable = allFiles.filter((rel) => !allReached.has(rel));
  const typeOnlyReachable = [...allReached].filter((rel) => !runtimeReached.has(rel)).sort();
  const allowlist = loadUnreachableAllowlist(root);
  const allowlistErrors = [...allowlist.errors];
  for (const entry of allowlist.entries) {
    if (!fileSet.has(entry.path)) {
      allowlistErrors.push('白名单路径不在全树：' + entry.path);
      continue;
    }
    if (allReached.has(entry.path)) {
      allowlistErrors.push('白名单路径已可达（应移出白名单）：' + entry.path);
      continue;
    }
    const refs = testReferenceFiles(root, entry.path);
    entry.testReferences = refs;
    if (entry.disposition !== 'test-only' && refs.length > 0) {
      allowlistErrors.push('白名单 next-round-cleanup 文件存在测试引用：' + entry.path + '（' + refs.join('、') + '；仅 test-only 允许测试引用）');
    }
  }
  const featureOrphans = unreachable.filter((rel) => rel.startsWith('features/'));
  const platformOrphans = unreachable.filter((rel) => rel.startsWith('platform/'));
  const otherUnreachable = unreachable.filter((rel) => !rel.startsWith('features/') && !rel.startsWith('platform/'));
  const allowlistedUnreachable = unreachable.filter((rel) => allowlist.byPath.has(rel));
  const allowlistedSet = new Set(allowlistedUnreachable);
  const unallowlistedUnreachable = unreachable.filter((rel) => !allowlistedSet.has(rel));
  const domainOrphans = unallowlistedUnreachable.filter((rel) => rel.startsWith('features/') || rel.startsWith('platform/'));
  return {
    roots,
    missingRoots,
    total: allFiles.length,
    reached: allReached.size,
    runtimeReached: [...runtimeReached].sort(),
    allReached: [...allReached].sort(),
    typeOnlyReachable,
    unreachable,
    featureOrphans,
    platformOrphans,
    otherUnreachable,
    allowlistedUnreachable,
    unallowlistedUnreachable,
    allowlist: {
      file: relOf(root, allowlist.file),
      decision: ALLOWLIST_DECISION,
      entries: allowlist.entries,
    },
    allowlistErrors,
    domainOrphans: domainOrphans.sort(),
  };
}

function printReachability(reach) {
  console.log('可达性预检：根入口=' + reach.roots.join(', '));
  if (reach.missingRoots.length) console.log('  缺少编译入口：' + reach.missingRoots.join(', '));
  console.log('  可达 .ets=' + reach.reached + ' / 全树 ' + reach.total + '（运行时 ' + reach.runtimeReached.length + ' + 仅类型 ' + reach.typeOnlyReachable.length + '）');
  const allowlisted = reach.allowlistedUnreachable || [];
  const allowListedPlatform = allowlisted.filter((rel) => rel.startsWith('platform/')).length;
  const allowListedOther = allowlisted.length - allowListedPlatform;
  console.log('  features 孤儿=' + reach.featureOrphans.length + '，platform 孤儿=' + reach.platformOrphans.length + '（白名单 ' + allowListedPlatform + '），其他不可达=' + (reach.otherUnreachable || []).length + '（白名单 ' + allowListedOther + '）');
  if (allowlisted.length) {
    console.log('  白名单不可达=' + allowlisted.length + ' 条（完整性等式右侧；逐条理由见 ' + (reach.allowlist ? reach.allowlist.file : ALLOWLIST_REL) + '）：');
    for (const entry of (reach.allowlist ? reach.allowlist.entries : [])) {
      const refs = entry.testReferences && entry.testReferences.length ? '；测试引用：' + entry.testReferences.join('、') : '';
      console.log('    - ' + entry.path + '（' + entry.disposition + '）' + refs);
    }
  }
  for (const rel of reach.domainOrphans.slice(0, 40)) console.log('    - 未登记孤儿 ' + rel);
  if (reach.domainOrphans.length > 40) console.log('    …还有 ' + (reach.domainOrphans.length - 40) + ' 个');
}

function collectCompiledEts(workDir) {
  const mapPath = path.join(workDir, 'entry', 'build', 'default', 'intermediates', 'loader_out', 'default', 'ets', 'sourceMaps.map');
  if (!fs.existsSync(mapPath)) return { available: false, mapPath, files: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  } catch (error) {
    return { available: false, mapPath, files: [], error: 'sourceMaps.map 解析失败：' + error.message };
  }
  const files = new Set();
  for (const value of Object.values(data)) {
    for (const source of (value && value.sources) || []) {
      const normalized = String(source).replace(/\\/g, '/');
      const marker = 'entry/src/main/ets/';
      const index = normalized.indexOf(marker);
      if (index >= 0) files.add(normalized.slice(index + marker.length));
    }
  }
  return { available: true, mapPath, files: [...files].sort() };
}

function buildIntegrity(root, workDir, reach) {
  const sourceFiles = listEtsFiles(root);
  const compiled = collectCompiledEts(workDir);
  const compiledSet = new Set(compiled.files);
  const runtimeReached = new Set(reach ? reach.runtimeReached : []);
  const allowlisted = reach ? (reach.allowlistedUnreachable || []) : [];
  const allowlistedSet = new Set(allowlisted);
  const orphans = reach ? reach.unreachable.filter((rel) => !allowlistedSet.has(rel)) : [];
  const missingRuntime = [...runtimeReached].filter((rel) => !compiledSet.has(rel)).sort();
  const typeOnlyEts = reach ? reach.typeOnlyReachable.filter((rel) => !compiledSet.has(rel)).sort() : [];
  const unexpected = compiled.files.filter((rel) => !sourceFiles.includes(rel));
  // sourceMaps 只记录运行时会发射的模块；仅类型文件不发射但参与类型检查，必须单独计入“进入编译”。
  const enteringBuild = compiled.available ? compiled.files.length + typeOnlyEts.length : null;
  // Lead 裁定后的完整性等式：进入编译的 .ets + 白名单不可达 = 全树 .ets。
  const equation = compiled.available ? enteringBuild + allowlisted.length === sourceFiles.length : null;
  return {
    sourceEts: sourceFiles.length,
    compiledEts: compiled.available ? compiled.files.length : null,
    runtimeReachable: runtimeReached.size,
    typeOnlyEts: typeOnlyEts.length,
    enteringBuild,
    allowlisted,
    allowlistedCount: allowlisted.length,
    allowlistErrors: reach ? (reach.allowlistErrors || []) : [],
    equation,
    missingRuntime,
    orphans,
    extra: unexpected,
    available: compiled.available,
    mapPath: compiled.mapPath,
    error: compiled.error || null,
  };
}

function buildManifest(root, label) {
  const files = [];
  let bytes = 0;
  for (const file of walk(root)) {
    if (isGenerated(root, file)) continue;
    const size = fs.statSync(file).size;
    bytes += size;
    files.push({ path: relOf(root, file), bytes: size, sha256: sha256File(file) });
  }
  return { label, root, fileCount: files.length, bytes, files };
}
function manifestDigest(manifest) {
  return sha256(JSON.stringify(manifest.files.map((f) => f.path + ':' + f.sha256)));
}
function copyProject(source, dest) {
  fs.cpSync(source, dest, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (src) => !isGenerated(source, src),
  });
  for (const rel of ['.hvigor', 'build', 'oh_modules', 'node_modules', path.join('entry', 'build')]) {
    fs.rmSync(path.join(dest, rel), { recursive: true, force: true });
  }
}
function cacheHash(workDir) {
  return sha256(path.resolve(workDir) + ':6.26.8').slice(0, 32);
}
function ensureCacheJunctions(workDir, cliHome, prewarm) {
  const hash = cacheHash(workDir);
  const workspace = path.join(DEFAULT_HVIGOR_HOME, 'project_caches', hash, 'workspace');
  const ohos = path.join(workspace, 'node_modules', '@ohos');
  ensureDir(ohos);
  const result = { hash, workspace, prewarm, created: [], copied: [], problems: [] };
  if (!prewarm) return result;
  for (const name of ['hvigor', 'hvigor-ohos-plugin']) {
    const src = path.join(cliHome, 'hvigor', name);
    const dst = path.join(ohos, name);
    if (!fs.existsSync(src)) {
      result.problems.push('CLI 缺少 ' + src);
      continue;
    }
    let exists = false;
    try {
      const st = fs.lstatSync(dst);
      exists = st.isSymbolicLink() || st.isDirectory();
    } catch (_) {
      exists = false;
    }
    if (exists) continue;
    try {
      fs.symlinkSync(src, dst, 'junction');
      result.created.push(name + ' -> ' + src);
    } catch (error) {
      try {
        fs.cpSync(src, dst, { recursive: true });
        result.copied.push(name + '（junction 失败，已复制：' + error.message + '）');
      } catch (copyError) {
        result.problems.push(name + ' 预建失败：' + copyError.message);
      }
    }
  }
  return result;
}
function buildEnv(cliHome) {
  const env = { ...process.env };
  const javaHome = process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME) ? process.env.JAVA_HOME : DEFAULT_JAVA_HOME;
  if (!javaHome) throw new Error('未设置 JAVA_HOME：请安装 JDK 17 并把 JAVA_HOME 指向其安装目录');
  const nodeDir = path.join(cliHome, 'tool', 'node');
  env.TEMP = path.join(DEFAULT_ENV_HOME, 'tmp');
  env.TMP = env.TEMP;
  env.USERPROFILE = path.join(DEFAULT_ENV_HOME, 'home');
  env.HOME = env.USERPROFILE;
  env.LOCALAPPDATA = path.join(env.USERPROFILE, 'AppData', 'Local');
  env.APPDATA = path.join(env.USERPROFILE, 'AppData', 'Roaming');
  env.npm_config_cache = path.join(DEFAULT_ENV_HOME, 'npm-cache');
  env.HVIGOR_USER_HOME = DEFAULT_HVIGOR_HOME;
  env.JAVA_HOME = javaHome;
  env.DEVECO_CLI_HOME = cliHome;
  env.DEVECO_NODE_HOME = nodeDir;
  env.DEVECO_SDK_HOME = path.join(cliHome, 'sdk');
  env.PATH = [path.join(javaHome, 'bin'), nodeDir, path.join(cliHome, 'bin'), env.PATH || ''].join(';');
  for (const dir of [env.TEMP, env.USERPROFILE, env.LOCALAPPDATA, env.APPDATA, env.npm_config_cache, env.HVIGOR_USER_HOME]) ensureDir(dir);
  return env;
}
function runBuild(workDir, env, logPath, timeoutMs) {
  const cliHome = env.DEVECO_CLI_HOME;
  const bat = path.join(cliHome, 'bin', 'hvigorw.bat');
  if (!fs.existsSync(bat)) return { error: '找不到 hvigorw.bat：' + bat, code: null, timedOut: false, output: '' };
  const args = ['assembleHap', '--mode', 'module', '-p', 'product=default', '-p', 'module=entry@default', '-p', 'buildMode=debug', '--no-daemon'];
  const quote = (value) => (/\s/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value);
  const cmdLine = [quote(bat), ...args.map(quote)].join(' ');
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', cmdLine], {
      cwd: workDir,
      env,
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    const chunks = [];
    const errChunks = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    }, timeoutMs);
    child.stdout.on('data', (data) => {
      chunks.push(data);
      process.stdout.write(data);
    });
    child.stderr.on('data', (data) => {
      errChunks.push(data);
      process.stderr.write(data);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ error: '启动构建进程失败：' + error.message, code: null, timedOut, output: Buffer.concat(chunks).toString('utf8') });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString('utf8') + (errChunks.length ? '\n[stderr]\n' + Buffer.concat(errChunks).toString('utf8') : '');
      resolve({ error: null, code, signal, timedOut, output, durationMs: Date.now() - started });
    });
  });
}
function parseBuildLog(text) {
  const clean = stripAnsi(text);
  const lines = clean.split(/\n/);
  const summary = {
    compileResult: null,
    errorCount: 0,
    warnCount: 0,
    reportedErrorCount: null,
    reportedWarnCount: null,
    parsedErrorCount: 0,
    parsedWarnCount: 0,
    errors: [],
    warnings: [],
    topWarnings: [],
    buildSuccess: false,
    buildFailed: false,
    rawLineCount: lines.length,
  };
  let pending = null;
  let pendingKind = null;
  const applyAtFile = (entry) => {
    const at = entry.message.match(/^(.*?)\s+At File:\s*(.+):(\d+):(\d+)\s*$/);
    if (!at) return;
    entry.message = at[1].trim();
    entry.file = at[2];
    entry.line = Number(at[3]);
    entry.column = Number(at[4]);
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const cr = line.match(/COMPILE RESULT:(SUCCESS|FAIL)\s*\{ERROR:(\d+)\s+WARN:(\d+)\}/i);
    if (cr) {
      summary.compileResult = cr[1].toUpperCase();
      summary.reportedErrorCount = Number(cr[2]);
      summary.reportedWarnCount = Number(cr[3]);
      summary.errorCount = Number(cr[2]);
      summary.warnCount = Number(cr[3]);
      continue;
    }
    if (/BUILD SUCCESSFUL/i.test(line)) summary.buildSuccess = true;
    if (/BUILD FAILED/i.test(line)) summary.buildFailed = true;
    const err = line.match(/^\s*(\d+)\s+ERROR:\s*(\d+)\s+(.*?)\s*$/);
    if (err) {
      pending = { index: Number(err[1]), code: err[2], kind: err[3].trim(), message: '', file: null, line: null, column: null };
      summary.errors.push(pending);
      pendingKind = 'error';
      continue;
    }
    const kitErr = line.match(/^\s*(\d+)\s+ERROR:\s*ArkTS:ERROR\s+File:\s*(.+):(\d+):(\d+)\s*$/);
    if (kitErr) {
      pending = { index: Number(kitErr[1]), code: '', kind: 'ArkTS', message: '', file: kitErr[2], line: Number(kitErr[3]), column: Number(kitErr[4]) };
      summary.errors.push(pending);
      pendingKind = 'error';
      continue;
    }
    const errCode = line.match(/^\s*ERROR Code:\s*(\d+)/);
    if (errCode && pending && pendingKind === 'error') {
      pending.code = errCode[1];
      continue;
    }
    const msg = line.match(/Error Message:\s*(.*)$/);
    if (msg && pending && pendingKind === 'error') {
      pending.message = msg[1].trim();
      applyAtFile(pending);
      continue;
    }
    if (pending && pendingKind === 'error' && !pending.file) {
      const trimmed = line.trim();
      const continuation = trimmed !== '' && !/^\d+\s+(WARN|ERROR):/.test(trimmed) && !/^(?:>\s*)?(?:Try:|FAILURE|BUILD |COMPILE RESULT)/i.test(trimmed) && (/^\s{2,}\S/.test(line) || /At File:/.test(trimmed));
      if (continuation) {
        pending.message = (pending.message + ' ' + trimmed).trim();
        applyAtFile(pending);
        continue;
      }
    }
    const warn = line.match(/^\s*(\d+)\s+WARN:\s*(.*?)\s*$/);
    if (warn && /ArkTS:WARN/i.test(warn[2])) {
      const head = warn[2].match(/ArkTS:WARN(?:\s+File:\s*(.+):(\d+):(\d+))?\s*$/);
      pending = {
        index: Number(warn[1]),
        message: '',
        file: head && head[1] ? head[1] : null,
        line: head && head[2] ? Number(head[2]) : null,
        column: head && head[3] ? Number(head[3]) : null,
        kind: 'arkts',
      };
      summary.warnings.push(pending);
      pendingKind = 'warning';
      continue;
    }
    if (pending && pendingKind === 'warning' && pending.message === '' && line.trim() !== '' && !/^\s*\d+\s+(WARN|ERROR):/.test(line) && !/^-+$/.test(line.trim())) {
      pending.message = line.trim();
      continue;
    }
    if (/^>?\s*hvigor\s+WARN:/i.test(line) || /^\s*WARN:\s+/.test(line)) {
      summary.topWarnings.push(line.trim());
    }
    if (/ArkTS:ERROR/i.test(line) && !/^\s*\d+\s+ERROR:/.test(line)) {
      summary.errors.push({ index: summary.errors.length + 1, code: '', kind: 'ArkTS', message: line.trim(), file: null, line: null, column: null });
    }
  }
  summary.parsedErrorCount = summary.errors.length;
  summary.parsedWarnCount = summary.warnings.length;
  if (summary.errorCount === 0) summary.errorCount = summary.errors.length;
  if (summary.warnCount === 0) summary.warnCount = summary.warnings.length;
  for (const warning of summary.warnings) warning.category = classifyWarning(warning.message);
  summary.warningCategories = countBy(summary.warnings, (w) => w.category);
  summary.errorFileCounts = countBy(summary.errors, (e) => (e.file ? path.basename(e.file) : '(无文件)'));
  summary.errorKinds = countBy(summary.errors, (e) => e.kind || '(未知)');
  summary.countMismatch = {
    errors: summary.errors.length !== summary.errorCount,
    warnings: summary.warnings.length !== summary.warnCount,
  };
  summary.verdict = summary.buildSuccess && summary.errorCount === 0 ? 'SUCCESS' : summary.errorCount > 0 ? 'COMPILE_ERROR' : summary.buildFailed ? 'BUILD_FAILED' : 'UNKNOWN';
  return { clean, summary };
}
function classifyWarning(message) {
  const text = message || '';
  if (/deprecated/i.test(text)) return 'deprecated-api';
  if (/may throw|exceptions?/i.test(text)) return 'exception-contract';
  if (/arkts|syntax/i.test(text)) return 'arkts-syntax';
  if (/targetSdkVersion|app_name|conflict|signing|签名|skip sign/i.test(text)) return 'build-config';
  return 'other';
}
function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}
function findHaps(workDir, logRoot, stampValue) {
  const outputs = path.join(workDir, 'entry', 'build', 'default', 'outputs');
  const roots = fs.existsSync(outputs) ? [outputs] : [workDir];
  const result = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      if (!file.endsWith('.hap')) continue;
      const entry = { path: relOf(workDir, file), bytes: fs.statSync(file).size, sha256: sha256File(file) };
      try {
        const manifest = hapPackageManifest(file);
        const manifestPath = path.join(logRoot, 'build-gate-' + stampValue + '-hap-' + String(result.length + 1) + '-manifest.txt');
        fs.writeFileSync(manifestPath, manifest.text);
        entry.entries = manifest.entries;
        entry.manifestSha256 = manifest.manifestSha256;
        entry.manifestPath = manifestPath;
      } catch (error) {
        entry.manifestError = error.message;
      }
      result.push(entry);
    }
  }
  result.sort((a, b) => (a.path === HAP_HINT ? -1 : b.path === HAP_HINT ? 1 : a.path.localeCompare(b.path)));
  return result;
}

function readZipEntries(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 缺 EOCD 尾记录（文件不是合法 zip）');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new Error('ZIP64 包暂不支持（请人工核对）');
  if (cdOffset + cdSize > buf.length) throw new Error('ZIP 中央目录越界');
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 中央目录条目损坏（第 ' + (i + 1) + ' 项）');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLen > buf.length) throw new Error('ZIP 条目名越界（第 ' + (i + 1) + ' 项）');
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP 本地头损坏：' + name);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > buf.length) throw new Error('ZIP 数据越界：' + name);
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error('ZIP 不支持的压缩方法 ' + method + '：' + name);
    if (data.length !== uncompressedSize) throw new Error('ZIP 解压长度不一致：' + name);
    if (!name.endsWith('/')) entries.push({ path: name, bytes: uncompressedSize, sha256: sha256(data) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

function hapPackageManifest(file) {
  const entries = readZipEntries(file);
  const text = entries.map((entry) => entry.sha256 + '  ' + entry.path).join('\n') + (entries.length ? '\n' : '');
  return { entries: entries.length, manifestSha256: sha256(text), text };
}
function writeSummary(logRoot, stampValue, payload) {
  const file = path.join(logRoot, 'build-gate-' + stampValue + '.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n');
  return file;
}
function printSummary(summary, extra) {
  console.log('');
  console.log('===== 编译门禁结果 =====');
  console.log('模式：' + (extra.mode || 'build'));
  console.log('工程：' + (extra.sourceRoot || '-'));
  console.log('副本：' + (extra.workDir || '-'));
  console.log('日志：' + (extra.logPath || '-'));
  console.log('命令：' + (extra.command || '-'));
  console.log('退出码：' + (extra.processCode === null ? 'null' : extra.processCode) + (extra.timedOut ? '（超时）' : ''));
  console.log('COMPILE RESULT：' + (summary.compileResult || '未出现') + ' | ERROR 计数=' + summary.errorCount + ' WARN 计数=' + summary.warnCount);
  const errorGap = summary.reportedErrorCount !== null && summary.reportedErrorCount !== summary.errors.length ? '（账实差 ' + (summary.reportedErrorCount - summary.errors.length) + ' 块）' : '';
  const warnGap = summary.reportedWarnCount !== null && summary.reportedWarnCount !== summary.warnings.length ? '（账实差 ' + (summary.reportedWarnCount - summary.warnings.length) + ' 块）' : '';
  console.log('解析：错误块=' + summary.errors.length + errorGap + ' 告警块=' + summary.warnings.length + warnGap + ' 顶层告警=' + summary.topWarnings.length);
  console.log('判定：' + summary.verdict + ' | HAP=' + (extra.haps && extra.haps.length ? extra.haps.length + ' 个' : '无'));
  if (summary.errors.length) {
    console.log('错误清单（最多 20 条）：');
    for (const error of summary.errors.slice(0, 20)) {
      console.log('  - [' + (error.code || error.kind) + '] ' + error.message + (error.file ? ' @ ' + error.file + ':' + error.line + ':' + error.column : ''));
    }
  }
  if (extra.reachability) {
    console.log('可达性：features 孤儿=' + extra.reachability.featureOrphans.length + ' platform 孤儿=' + extra.reachability.platformOrphans.length + '（白名单不可达 ' + (extra.reachability.allowlistedUnreachable || []).length + '，decision=' + (extra.reachability.allowlist ? extra.reachability.allowlist.decision : '-') + '；根入口 ' + extra.reachability.roots.join(', ') + '）');
    if ((extra.reachability.allowlistErrors || []).length) console.log('  白名单校验错误=' + extra.reachability.allowlistErrors.length + '：' + extra.reachability.allowlistErrors.slice(0, 5).join('；'));
  }
  if (extra.integrity) {
    if (extra.integrity.available) {
      console.log('编译参与 .ets：进入编译 ' + extra.integrity.enteringBuild + ' + 白名单不可达 ' + extra.integrity.allowlistedCount + ' = 全树 ' + extra.integrity.sourceEts + '（等式 ' + (extra.integrity.equation ? '成立' : '不成立') + '；运行时发射 ' + extra.integrity.compiledEts + ' + 仅类型 ' + extra.integrity.typeOnlyEts + '；未登记孤儿 ' + extra.integrity.orphans.length + '）');
      if (extra.integrity.missingRuntime.length) {
        console.log('  运行时可达但未参与编译=' + extra.integrity.missingRuntime.length + '：' + extra.integrity.missingRuntime.slice(0, 10).join('、'));
      }
      for (const rel of extra.integrity.orphans.slice(0, 20)) console.log('  - 未进入编译（孤儿）：' + rel);
      if (extra.integrity.orphans.length > 20) console.log('  …还有 ' + (extra.integrity.orphans.length - 20) + ' 个');
    } else {
      console.log('编译参与 .ets：无 sourceMaps.map（编译失败或未产出），无法对账' + (extra.integrity.error ? '：' + extra.integrity.error : ''));
    }
  }
  if (Object.keys(summary.warningCategories).length) console.log('告警分类：' + JSON.stringify(summary.warningCategories));
  if (extra.haps && extra.haps.length) {
    for (const hap of extra.haps) {
      console.log('  HAP：' + hap.path + ' ' + hap.bytes + ' B sha256=' + hap.sha256);
      if (hap.manifestSha256) console.log('       包内清单：' + hap.entries + ' 个文件，清单 sha256=' + hap.manifestSha256 + '（' + hap.manifestPath + '）');
      else console.log('       包内清单：计算失败（' + (hap.manifestError || '未知原因') + '）');
    }
  }
  console.log('========================');
}
async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error('参数错误：' + error.message);
    console.error(usage());
    process.exit(EXIT.usage);
  }
  if (opts.help) {
    console.log(usage());
    return;
  }
  if (opts.parseLog) {
    if (!fs.existsSync(opts.parseLog)) {
      console.error('日志不存在：' + opts.parseLog);
      process.exit(EXIT.setup);
    }
    const parsed = parseBuildLog(fs.readFileSync(opts.parseLog, 'utf8'));
    printSummary(parsed.summary, { mode: 'parse-log', logPath: opts.parseLog, workDir: '-', sourceRoot: '-', command: '-', processCode: null, timedOut: false, haps: [] });
    return;
  }
  if (opts.hapManifest) {
    if (!fs.existsSync(opts.hapManifest)) {
      console.error('HAP 不存在：' + opts.hapManifest);
      process.exit(EXIT.setup);
    }
    let manifest;
    try {
      manifest = hapPackageManifest(opts.hapManifest);
    } catch (error) {
      console.error('包内清单计算失败：' + error.message);
      process.exit(EXIT.setup);
    }
    const outPath = opts.hapManifest + '.manifest.txt';
    fs.writeFileSync(outPath, manifest.text);
    console.log('HAP：' + opts.hapManifest);
    console.log('字节数：' + fs.statSync(opts.hapManifest).size);
    console.log('包内文件：' + manifest.entries + ' 个');
    console.log('包内清单 sha256：' + manifest.manifestSha256);
    console.log('明细：' + outPath);
    return;
  }
  const sourceRoot = opts.root;
  if (!sourceRoot || !fs.existsSync(path.join(sourceRoot, 'hvigorw.bat'))) {
    console.error('工程目录无效（缺 hvigorw.bat）：' + sourceRoot);
    process.exit(EXIT.setup);
  }
  const startedAt = new Date().toISOString();
  let reachability;
  try {
    reachability = analyzeBuildReachability(sourceRoot);
  } catch (error) {
    console.error('可达性预检失败：' + error.message);
    process.exit(EXIT.setup);
  }
  printReachability(reachability);
  if (opts.precheckOnly) {
    if (reachability.allowlistErrors.length) {
      console.error('门禁失败：不可达白名单校验失败（' + reachability.allowlistErrors.length + ' 条）：' + reachability.allowlistErrors.slice(0, 10).join('；'));
      process.exit(EXIT.reachability);
    }
    if (reachability.domainOrphans.length) {
      console.error('门禁失败：features/** 或 platform/** 存在 ' + reachability.domainOrphans.length + ' 个未登记白名单的不可达文件，先接线或在 tools/unreachable-allowlist.json 登记。');
      process.exit(EXIT.reachability);
    }
    console.log('门禁通过：无可达性缺口；白名单不可达 ' + reachability.allowlistedUnreachable.length + ' 条（decision=' + ALLOWLIST_DECISION + '）。');
    return;
  }
  if (opts.strict && reachability.allowlistErrors.length) {
    console.error('门禁失败（--strict）：不可达白名单校验失败（' + reachability.allowlistErrors.length + ' 条）：' + reachability.allowlistErrors.slice(0, 10).join('；'));
    process.exit(EXIT.reachability);
  }
  if (opts.strict && reachability.domainOrphans.length) {
    console.error('门禁失败（--strict）：features/** 或 platform/** 存在 ' + reachability.domainOrphans.length + ' 个未登记白名单的不可达文件，拒绝进入编译。');
    process.exit(EXIT.reachability);
  }
  if (!opts.strict && reachability.allowlistErrors.length) {
    console.log('开发模式告警：不可达白名单有 ' + reachability.allowlistErrors.length + ' 条校验错误；交付/全量回归请加 --strict。');
  }
  if (!opts.strict && reachability.domainOrphans.length) {
    console.log('开发模式告警：features/platform 存在 ' + reachability.domainOrphans.length + ' 个未登记白名单的不可达文件；交付/全量回归请加 --strict。');
  }
  const cliHome = process.env.DEVECO_CLI_HOME || DEFAULT_CLI_HOME;
  if (!cliHome || !fs.existsSync(path.join(cliHome, 'bin', 'hvigorw.bat'))) {
    console.error('找不到 HarmonyOS 命令行工具：' + String(cliHome));
    process.exit(EXIT.setup);
  }
  const logRoot = DEFAULT_LOG_ROOT;
  ensureDir(logRoot);
  let stampValue = stamp();
  let baseName = 'work-guard-' + stampValue + (opts.label ? '-' + opts.label : '');
  let workDir = opts.dest || path.join(DEFAULT_BUILD_ROOT, baseName);
  if (fs.existsSync(workDir)) {
    stampValue = fullStamp();
    if (!opts.dest) workDir = path.join(DEFAULT_BUILD_ROOT, 'work-guard-' + stampValue + (opts.label ? '-' + opts.label : ''));
    else {
      console.error('目标目录已存在：' + workDir);
      process.exit(EXIT.setup);
    }
  }
  const logPath = path.join(logRoot, 'build-gate-' + stampValue + '.log');
  const rawLogPath = path.join(logRoot, 'build-gate-' + stampValue + '.raw.log');
  const summaryPath = path.join(logRoot, 'build-gate-' + stampValue + '.json');
  const manifestPath = path.join(logRoot, 'build-gate-' + stampValue + '-manifest.json');
  let keep = opts.keep;
  let setupError = null;
  let cache = null;
  let sourceManifest = null;
  let copyManifest = null;
  let build = null;
  let parsed = null;
  let haps = [];
  let integrity = null;
  try {
    console.log('复制工作树：' + sourceRoot + ' -> ' + workDir);
    sourceManifest = buildManifest(sourceRoot, 'source');
    ensureDir(path.dirname(workDir));
    copyProject(sourceRoot, workDir);
    copyManifest = buildManifest(workDir, 'copy');
    fs.writeFileSync(manifestPath, JSON.stringify({ source: sourceManifest, copy: copyManifest, equal: manifestDigest(sourceManifest) === manifestDigest(copyManifest) }, null, 2) + '\n');
    if (manifestDigest(sourceManifest) !== manifestDigest(copyManifest)) setupError = '副本与源树 sha256 清单不一致，拒绝构建';
    if (!setupError) {
      cache = ensureCacheJunctions(workDir, cliHome, opts.prewarm);
      if (cache.problems.length) console.log('缓存预建告警：' + cache.problems.join('；'));
    }
    const env = buildEnv(cliHome);
    if (!setupError) {
      console.log('开始构建（超时 ' + opts.timeoutMs + ' ms）...');
      build = await runBuild(workDir, env, logPath, opts.timeoutMs);
      if (build.error) setupError = build.error;
    }
    const rawText = build ? build.output : '';
    const clean = stripAnsi(rawText);
    fs.writeFileSync(logPath, clean);
    fs.writeFileSync(rawLogPath, rawText);
    parsed = parseBuildLog(rawText);
    haps = fs.existsSync(workDir) ? findHaps(workDir, logRoot, stampValue) : [];
    try {
      integrity = buildIntegrity(sourceRoot, workDir, reachability);
    } catch (error) {
      integrity = { sourceEts: null, compiledEts: null, runtimeReachable: null, typeOnlyEts: null, enteringBuild: null, allowlisted: [], allowlistedCount: 0, allowlistErrors: reachability ? (reachability.allowlistErrors || []) : [], equation: null, missingRuntime: [], orphans: [], extra: [], available: false, error: error.message };
    }
  } catch (error) {
    setupError = setupError || error.message;
    if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '门禁准备失败：' + error.stack + '\n');
  }
  const summary = parsed ? parsed.summary : { compileResult: null, errorCount: 0, warnCount: 0, errors: [], warnings: [], topWarnings: [], buildSuccess: false, buildFailed: false, warningCategories: {}, errorFileCounts: {}, errorKinds: {}, countMismatch: {}, verdict: 'SETUP_ERROR' };
  const result = {
    schema: 'build-gate/1',
    stamp: stampValue,
    mode: 'build',
    strict: opts.strict,
    startedAt,
    sourceRoot,
    workDir,
    kept: keep,
    logPath,
    rawLogPath,
    summaryPath,
    manifestPath,
    sourceFiles: sourceManifest ? sourceManifest.fileCount : 0,
    sourceBytes: sourceManifest ? sourceManifest.bytes : 0,
    sourceDigest: sourceManifest ? manifestDigest(sourceManifest) : null,
    logSha256: fs.existsSync(logPath) ? sha256(fs.readFileSync(logPath)) : null,
    cache,
    setupError,
    command: 'hvigorw.bat assembleHap --mode module -p product=default -p module=entry@default -p buildMode=debug --no-daemon',
    processCode: build ? build.code : null,
    timedOut: build ? Boolean(build.timedOut) : false,
    durationMs: build ? build.durationMs : null,
    reachability,
    integrity,
    haps,
    build: summary,
  };
  fs.writeFileSync(summaryPath, JSON.stringify(result, null, 2) + '\n');
  printSummary(summary, { mode: 'build', sourceRoot, workDir, logPath, command: result.command, processCode: result.processCode, timedOut: result.timedOut, haps, reachability, integrity });
  if (setupError) {
    console.error('环境/复制失败：' + setupError);
    if (!keep && fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
    process.exit(EXIT.setup);
  }
  if (build && build.timedOut) {
    keep = true;
    process.exit(EXIT.timeout);
  }
  if (summary.errorCount > 0) {
    keep = true;
    process.exit(EXIT.compileError);
  }
  if (!summary.buildSuccess) {
    keep = true;
    process.exit(EXIT.buildFailed);
  }
  if (haps.length === 0) {
    keep = true;
    process.exit(EXIT.noHap);
  }
  if (opts.strict) {
    const missingManifest = haps.filter((hap) => !hap.manifestSha256);
    if (missingManifest.length > 0) {
      keep = true;
      console.error('门禁失败（--strict）：' + missingManifest.length + ' 个 HAP 无法计算包内文件清单哈希：' + missingManifest[0].manifestError);
      process.exit(EXIT.coverage);
    }
    if (!integrity || !integrity.available) {
      keep = true;
      console.error('门禁失败（--strict）：构建成功但无 sourceMaps.map，无法核对参与编译的 .ets 数。');
      process.exit(EXIT.coverage);
    }
    if (integrity.missingRuntime.length > 0) {
      keep = true;
      console.error('门禁失败（--strict）：' + integrity.missingRuntime.length + ' 个运行时可达的 .ets 未参与编译：' + integrity.missingRuntime.slice(0, 10).join('、'));
      process.exit(EXIT.coverage);
    }
    if (integrity.allowlistErrors.length > 0) {
      keep = true;
      console.error('门禁失败（--strict）：不可达白名单校验失败（' + integrity.allowlistErrors.length + ' 条）：' + integrity.allowlistErrors.slice(0, 10).join('；'));
      process.exit(EXIT.coverage);
    }
    if (integrity.orphans.length > 0) {
      keep = true;
      console.error('门禁失败（--strict）：' + integrity.orphans.length + ' 个 .ets 未进入编译且未登记白名单（孤儿），全树未对账：' + integrity.orphans.slice(0, 10).join('、'));
      process.exit(EXIT.coverage);
    }
    if (integrity.extra.length > 0) {
      keep = true;
      console.error('门禁失败（--strict）：' + integrity.extra.length + ' 个参与编译的 .ets 不在源树全树清单中：' + integrity.extra.slice(0, 10).join('、'));
      process.exit(EXIT.coverage);
    }
    if (integrity.equation !== true) {
      keep = true;
      console.error('门禁失败（--strict）：完整性等式不成立：进入编译 ' + integrity.enteringBuild + ' + 白名单不可达 ' + integrity.allowlistedCount + ' != 全树 ' + integrity.sourceEts);
      process.exit(EXIT.coverage);
    }
  } else if (integrity && integrity.available) {
    if (integrity.allowlistedCount > 0) console.log('开发模式：白名单不可达 ' + integrity.allowlistedCount + ' 条已计入完整性等式（test-only 不等于被产品使用）。');
    if (integrity.missingRuntime.length > 0) console.log('开发模式告警：' + integrity.missingRuntime.length + ' 个运行时可达的 .ets 未参与编译（交付请加 --strict）。');
    if (integrity.orphans.length > 0) console.log('开发模式告警：' + integrity.orphans.length + ' 个 .ets 未进入编译且未登记白名单（交付请加 --strict）。');
    if (integrity.equation !== true) console.log('开发模式告警：完整性等式不成立（进入编译 ' + integrity.enteringBuild + ' + 白名单 ' + integrity.allowlistedCount + ' != 全树 ' + integrity.sourceEts + '）。');
  }
  if (!keep && fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
  return;
}
main().catch((error) => {
  console.error('未捕获异常：' + (error && error.stack ? error.stack : error));
  process.exit(EXIT.setup);
});
