#!/usr/bin/env node
/**
 * 鸿蒙 P1 纯逻辑 Node 测试运行器（无 SDK）。
 *
 * 用法：node harmony/tools/run-core-tests.mjs
 *
 * 把 entry/src/main/ets/{core,data}/**\/*.ets 复制到 os.tmpdir() 并改名为 .ts，
 * 再用 `node --experimental-strip-types --test harmony/tools/tests/*.test.mjs` 运行。
 * 复制前做纯逻辑门禁：出现非 type import 或装饰器 → 说明违反 P1 铁律，直接 exit 1。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const HARMONY_ROOT = path.resolve(TOOLS_DIR, '..');
const ETS_ROOT = path.join(HARMONY_ROOT, 'entry/src/main/ets');
const SOURCE_DIRS = [path.join(ETS_ROOT, 'core'), path.join(ETS_ROOT, 'data')];
const EXCLUDE_SEGMENTS = new Set(['platform', 'pages', 'entryability']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!EXCLUDE_SEGMENTS.has(ent.name)) walk(full, out);
    } else if (ent.isFile() && full.endsWith('.ets')) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(text) {
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
  return out;
}

function purityError(file, text) {
  const code = stripComments(text);
  const decorator = code.match(/^\s*@[A-Za-z_$][\w$]*/m);
  if (decorator) return `含装饰器 ${decorator[0].trim()}（非纯逻辑，不能由 Node type-strip 执行）`;
  const importRe = /^\s*import\s+(?!type\b)[\s\S]*?from\s*['"]([^'"]+)['"]/gm;
  let m;
  while ((m = importRe.exec(code)) !== null) {
    return `存在非 type import：'${m[1]}'（P1 纯逻辑只允许 import type）`;
  }
  const sideEffect = code.match(/^\s*import\s+['"]([^'"]+)['"]/m);
  if (sideEffect) return `存在副作用 import：'${sideEffect[1]}'（P1 纯逻辑只允许 import type）`;
  return null;
}

function copySources(tmpRoot) {
  const copied = [];
  for (const dir of SOURCE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const rel = path.relative(ETS_ROOT, file);
      const target = path.join(tmpRoot, rel.replace(/\.ets$/, '.ts'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
      copied.push(target);
    }
  }
  return copied;
}

function findTestFiles() {
  const dir = path.join(TOOLS_DIR, 'tests');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => path.join(dir, name));
}

function main() {
  const testFiles = findTestFiles();
  if (testFiles.length === 0) {
    console.error(`未找到测试文件：${path.join(TOOLS_DIR, 'tests')}/*.test.mjs`);
    process.exit(1);
  }
  const sources = SOURCE_DIRS.flatMap((dir) => walk(dir));
  if (sources.length === 0) {
    console.error('未找到 core/ 或 data/ 下的 .ets 文件');
    process.exit(1);
  }
  for (const file of sources) {
    const text = fs.readFileSync(file, 'utf8');
    const error = purityError(file, text);
    if (error) {
      console.error(`纯逻辑门禁失败：${path.relative(HARMONY_ROOT, file)} ${error}`);
      process.exit(1);
    }
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jiangshui-core-'));
  try {
    const copied = copySources(tmpRoot);
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types',
      '--test',
      ...testFiles,
    ], {
      cwd: HARMONY_ROOT,
      env: {
        ...process.env,
        HARMONY_CORE_TMP: tmpRoot,
        HARMONY_FIXTURES: path.join(HARMONY_ROOT, 'fixtures'),
        HARMONY_ROOT,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const tests = (stdout.match(/^# tests\s+(\d+)/m) || [])[1] || '?';
    const pass = (stdout.match(/^# pass\s+(\d+)/m) || [])[1] || '?';
    const fail = (stdout.match(/^# fail\s+(\d+)/m) || [])[1] || '?';
    const hasSummary = tests !== '?';
    const todo = (stdout.match(/^# todo\s+(\d+)/m) || [])[1] || (hasSummary ? '0' : '?');
    const skipped = (stdout.match(/^# skipped\s+(\d+)/m) || [])[1] || (hasSummary ? '0' : '?');
    const summary = '复制 ' + copied.length + ' 个纯逻辑文件，测试 ' + tests + ' 项：' + pass + ' 通过 / ' + fail + ' 失败 / ' + todo + ' todo / ' + skipped + ' 跳过';
    if (result.status !== 0) {
      console.error(summary);
      process.stderr.write(stdout);
      process.stderr.write(stderr);
      process.exit(1);
    }
    console.log(summary);
    if (stdout.includes('ExperimentalWarning')) {
      console.log('（Node 提示 --experimental-strip-types 为实验特性，仅测试用）');
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
