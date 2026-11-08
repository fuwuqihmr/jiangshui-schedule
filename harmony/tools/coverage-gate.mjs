#!/usr/bin/env node
// 职责：新增域（features / files / core 追加能力）的测试覆盖门禁，输出 runtime / static-only / none 三档清单。
// 口径沿用 2026-10-29 gates.md：A=测试真正 import 执行该 .ets；B=只有源码字符串/结构断言；C=完全无测试引用。
// 注意：本机无 DevEco/SDK，UI 组件无法 runtime 执行；features 域允许 B 档静态契约兜底，但域内必须有至少一条测试引用。
//
// 用法：
//   node tools/coverage-gate.mjs             # 域缺口 -> exit 1；文件缺口只报告
//   node tools/coverage-gate.mjs --strict    # 文件缺口也 -> exit 1
//   node tools/coverage-gate.mjs --json
//   node tools/coverage-gate.mjs --help

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(TOOLS_DIR, '..');
const ETS = 'entry/src/main/ets';

const DOMAINS = [
  { id: 'features/custom', label: 'features/custom（UI 组件）', dirs: ['features/custom'], ext: '.ets' },
  { id: 'features/export', label: 'features/export（UI 组件）', dirs: ['features/export'], ext: '.ets' },
  { id: 'features/system', label: 'features/system（UI 组件）', dirs: ['features/system'], ext: '.ets' },
  { id: 'features/files', label: 'features/files（端口装配）', dirs: ['features/files'], ext: '.ets' },
  { id: 'files', label: 'files（platform/files + core/files）', dirs: ['platform/files', 'core/files'], ext: '.ets' },
  { id: 'core/custom', label: 'core/custom（自定义课表纯逻辑）', dirs: ['core/custom'], ext: '.ets' },
  { id: 'core/export', label: 'core/export（导出纯逻辑）', dirs: ['core/export'], ext: '.ets' },
  { id: 'core/system', label: 'system（core/system + platform/system）', dirs: ['core/system', 'platform/system'], ext: '.ets' },
  { id: 'timetable-append', label: 'timetable append 归一（TimetableCore + StateRepository）', files: ['core/timetable/TimetableCore.ets', 'data/StateRepository.ets'] },
  { id: 'school-relogin', label: '学校静默重登（orchestrator + relogin 端口）', files: ['data/SchoolReadOrchestrator.ets', 'platform/school/SchoolRelogin.ets'] },
];

function usage() {
  console.log('用法：node tools/coverage-gate.mjs [--root <harmony 目录>] [--strict] [--json]');
  console.log('  --strict  文件级缺口（C 档）也判失败；默认只判域级缺口');
  console.log('  --json    输出机器可读 JSON');
  console.log('  --help    显示本说明');
}

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, strict: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--strict') opts.strict = true;
    else if (arg === '--json') opts.json = true;
    else if (arg === '--root') {
      const value = argv[++i];
      if (!value) throw new Error('--root 需要目录参数');
      opts.root = path.resolve(value);
    } else throw new Error('无法识别的参数：' + arg);
  }
  return opts;
}

function walk(dir, suffix, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, suffix, out);
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
}

function listDomainFiles(root, domain) {
  const out = [];
  for (const rel of domain.files || []) {
    const full = path.join(root, ETS, rel);
    if (fs.existsSync(full)) out.push(path.relative(path.join(root, ETS), full).split(path.sep).join('/'));
  }
  for (const dirRel of domain.dirs || []) {
    const dir = path.join(root, ETS, dirRel);
    const files = [];
    walk(dir, domain.ext || '.ets', files);
    for (const full of files) out.push(path.relative(path.join(root, ETS), full).split(path.sep).join('/'));
  }
  return [...new Set(out)].sort();
}

function readTests(root) {
  const dir = path.join(root, 'tools', 'tests');
  if (!fs.existsSync(dir)) throw new Error('测试目录不存在：' + dir);
  const tests = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.test.mjs')) continue;
    tests.push({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') });
  }
  return tests;
}

function quoted(text, value) {
  return text.includes("'" + value + "'") || text.includes('"' + value + '"');
}

// 测试如果按目录扫描（readdirSync(FEATURES)），目录内每个文件都算 B 档静态覆盖。
// 只认“变量绑定到该目录后 readdirSync(变量)”或直接 readdirSync(path.join(..., '目录'))，
// 避免把 !source.includes('features/system') 这类否定断言误判成覆盖。
function directoryScanEvidence(tests, dirRel) {
  const escaped = dirRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const varRe = new RegExp("const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*path\\.join\\([^;\\n]*['\"]" + escaped + "['\"][^;\\n]*\\)", 'g');
  const directRe = new RegExp("readdirSync\\(\\s*path\\.join\\([^;\\n]*['\"]" + escaped + "['\"][^;\\n]*\\)\\s*\\)");
  const hits = [];
  for (const test of tests) {
    let hit = directRe.test(test.text);
    let match;
    varRe.lastIndex = 0;
    while (!hit && (match = varRe.exec(test.text)) !== null) {
      const useRe = new RegExp('readdirSync\\s*\\(\\s*' + match[1] + '\\s*\\)');
      if (useRe.test(test.text)) hit = true;
    }
    if (hit) hits.push(test.name);
  }
  return hits;
}

function directEvidence(tests, rel) {
  const modPath = rel.replace(/\.ets$/, '');
  const base = path.basename(rel, '.ets');
  const runtime = [];
  const staticRef = [];
  for (const test of tests) {
    if (quoted(test.text, modPath + '.ts')) runtime.push(test.name);
    else if (test.text.includes(rel) || test.text.includes(modPath) || test.text.includes(base)) staticRef.push(test.name);
  }
  return { runtime, staticRef };
}

function parseImports(root, rel) {
  const full = path.join(root, ETS, rel);
  if (!fs.existsSync(full)) return [];
  const text = fs.readFileSync(full, 'utf8');
  const result = [];
  const re = /^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    if (target.startsWith('..')) continue;
    result.push(target.endsWith('.ets') ? target : target + '.ets');
  }
  return result;
}

function buildReport(root, opts) {
  const tests = readTests(root);
  const domainFiles = new Map();
  for (const domain of DOMAINS) domainFiles.set(domain.id, listDomainFiles(root, domain));

  // 1) 先收集测试中直接出现的 .ts 导入（runtime 种子）与静态引用。
  const allFiles = [...new Set([...domainFiles.values()].flat())].sort();
  const info = new Map();
  for (const rel of allFiles) info.set(rel, { runtime: [], staticRef: [], via: [] });
  for (const [rel, entry] of info) {
    const direct = directEvidence(tests, rel);
    entry.runtime.push(...direct.runtime);
    entry.staticRef.push(...direct.staticRef);
  }

  // 2) 目录扫描兜底：features 等 UI 文件无法被 import，按目录扫描算 static-only。
  for (const domain of DOMAINS) {
    for (const dirRel of domain.dirs || []) {
      const scans = directoryScanEvidence(tests, dirRel);
      if (scans.length === 0) continue;
      for (const rel of domainFiles.get(domain.id)) {
        if (!rel.startsWith(dirRel + '/')) continue;
        const entry = info.get(rel);
        for (const name of scans) if (!entry.staticRef.includes(name)) entry.staticRef.push(name);
      }
    }
  }

  // 3) runtime 传递闭包：测试加载的模块 import 的 .ets 也真正执行。
  const queue = [];
  for (const [rel, entry] of info) if (entry.runtime.length) queue.push(rel);
  const seen = new Set(queue);
  const importCache = new Map();
  while (queue.length) {
    const rel = queue.shift();
    if (!importCache.has(rel)) importCache.set(rel, parseImports(root, rel));
    for (const target of importCache.get(rel)) {
      if (!info.has(target)) continue;
      const entry = info.get(target);
      const via = 'transitive:' + rel;
      if (!entry.via.includes(via)) entry.via.push(via);
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
    }
  }

  const rows = [];
  for (const domain of DOMAINS) {
    const files = domainFiles.get(domain.id).map((rel) => {
      const entry = info.get(rel);
      const status = entry.runtime.length ? 'runtime' : entry.staticRef.length ? 'static-only' : 'none';
      return { rel, status, runtime: entry.runtime, staticRef: entry.staticRef, via: entry.via };
    });
    const counts = { runtime: 0, 'static-only': 0, none: 0 };
    for (const file of files) counts[file.status]++;
    const domainStatus = counts.runtime > 0 ? 'runtime' : counts['static-only'] > 0 ? 'static-only' : 'none';
    rows.push({ id: domain.id, label: domain.label, status: domainStatus, counts, files });
  }

  const domainGaps = rows.filter((row) => row.status === 'none');
  const fileGaps = rows.flatMap((row) => row.files.filter((file) => file.status === 'none').map((file) => ({ domain: row.id, rel: file.rel })));
  return { root, strict: opts.strict, rows, domainGaps, fileGaps, testFiles: tests.map((test) => test.name) };
}

function printText(report) {
  console.log('覆盖门禁（三档：runtime / static-only / none）');
  console.log('工程：' + report.root);
  console.log('测试文件：' + report.testFiles.length + ' 个');
  console.log('');
  for (const row of report.rows) {
    const verdict = row.status === 'none' ? 'FAIL' : 'PASS';
    console.log('[' + verdict + '] ' + row.id + '  ' + row.label);
    console.log('       runtime=' + row.counts.runtime + ' static-only=' + row.counts['static-only'] + ' none=' + row.counts.none);
    for (const file of row.files) {
      if (file.status === 'none') continue;
      const evidence = file.status === 'runtime' ? file.runtime.concat(file.via) : file.staticRef;
      console.log('       - ' + file.status + '  ' + file.rel + '  <= ' + evidence.join(', '));
    }
    for (const file of row.files) {
      if (file.status !== 'none') continue;
      console.log('       - none      ' + file.rel);
    }
  }
  console.log('');
  // rel 已经是相对 entry/src/main/ets 的工程路径，不能再拼 domain 前缀（否则出现 files/platform/files 之类重复）。
  const qualify = (_domain, rel) => rel;
  const staticOnly = report.rows.flatMap((row) => row.files.filter((file) => file.status === 'static-only').map((file) => qualify(row.id, file.rel)));
  console.log('三档汇总：runtime 文件 ' + report.rows.reduce((n, row) => n + row.counts.runtime, 0)
    + '，static-only 文件 ' + staticOnly.length
    + '，none 文件 ' + report.fileGaps.length);
  if (staticOnly.length) {
    console.log('');
    console.log('仅静态断言（B 档，注释掉实现也可能过）：');
    for (const item of staticOnly) console.log('  - ' + item);
  }
  if (report.fileGaps.length) {
    console.log('');
    console.log('完全无测试引用（C 档）：');
    for (const item of report.fileGaps) console.log('  - ' + qualify(item.domain, item.rel));
  }
  if (report.domainGaps.length) {
    console.log('');
    console.log('域级缺口（必须补可执行逻辑测试或明确静态契约）：');
    for (const row of report.domainGaps) console.log('  - ' + row.id);
  }
  console.log('');
  if (report.domainGaps.length) console.log('结论：覆盖门禁失败（域缺口 ' + report.domainGaps.length + ' 个）。');
  else if (report.strict && report.fileGaps.length) console.log('结论：覆盖门禁失败（--strict 下文件缺口 ' + report.fileGaps.length + ' 个）。');
  else console.log('结论：覆盖门禁通过。');
}

function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 64; return; }
  if (opts.help) { usage(); return; }
  let report;
  try { report = buildReport(opts.root, opts); }
  catch (error) { console.error('覆盖门禁无法运行：' + error.message); process.exitCode = 2; return; }
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else printText(report);
  const failed = report.domainGaps.length > 0 || (opts.strict && report.fileGaps.length > 0);
  process.exitCode = failed ? 1 : 0;
}

main();
