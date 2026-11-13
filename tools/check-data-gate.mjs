#!/usr/bin/env node
// tools/check-data-gate.mjs
// 江水课表 Android · 发布前数据门禁
//
// 目标：确认「打进 APK 的数据文件」与「git 仓库中的同一文件（LF）」字节级一致
// （SHA-256 相等），防止发布包携带被 Windows CRLF 污染的 JSON。
//
// 映射关系：
//   android/app/build.gradle: assets.srcDirs = ['../../web']
//   => 仓库 web/data/<name>.json 打包进 APK 后为 assets/data/<name>.json
//   .gitattributes: * text=auto eol=lf => git 内文本以 LF 保存
//   Windows 工作树可能是 CRLF，本地手工构建的 APK 因此可能与 git blob 不一致。
//
// 用法：
//   node tools/check-data-gate.mjs
//       工作树模式：web/data/*.json 与 git blob 比对（默认 HEAD）
//   node tools/check-data-gate.mjs --apk <path-to.apk>
//       APK 模式：APK 内 assets/data/*.json 与 git blob 比对
//   node tools/check-data-gate.mjs --apk <apk> --normalize-crlf
//       诊断模式：实际字节先 CRLF->LF 规范化再比，仅 CRLF 差异记为 WARN 且退出码 0。
//       仅用于 Windows 本地构建诊断；CI / LF 构建应使用默认严格模式。
//   node tools/check-data-gate.mjs --rev <git-ref>    对比指定提交（默认 HEAD）
//   node tools/check-data-gate.mjs --json             机器可读输出
//
// 退出码：0 通过（含 --normalize-crlf 的 WARN）；1 数据不一致/缺失/多余；2 用法或环境错误。

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const GIT_EXE = process.env.GIT_EXE || 'git';

const USAGE = [
  '江水课表 Android · 发布前数据门禁',
  '',
  '用法：',
  '  node tools/check-data-gate.mjs                                   工作树 web/data/*.json vs git blob',
  '  node tools/check-data-gate.mjs --apk <path.apk>                  APK assets/data/*.json vs git blob',
  '  node tools/check-data-gate.mjs --apk <path.apk> --normalize-crlf 本地 Windows 诊断（CRLF 记 WARN）',
  '  node tools/check-data-gate.mjs --rev <git-ref>                   对比指定提交（默认 HEAD）',
  '  node tools/check-data-gate.mjs --json                            机器可读输出',
  '',
  '退出码：0 通过（含 --normalize-crlf 的 WARN）；1 数据不一致/缺失/多余；2 用法或环境错误。',
].join('\n');

function fail(code, message) {
  console.error('数据门禁错误：' + message);
  process.exit(code);
}

const argv = process.argv.slice(2);
let apkPath = null;
let rev = 'HEAD';
let normalizeCrlf = false;
let jsonOutput = false;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--apk') {
    apkPath = argv[++i];
    if (!apkPath) fail(2, '--apk 需要一个 APK 路径参数');
  } else if (arg === '--rev') {
    rev = argv[++i];
    if (!rev) fail(2, '--rev 需要一个 git 引用参数');
  } else if (arg === '--normalize-crlf') {
    normalizeCrlf = true;
  } else if (arg === '--json') {
    jsonOutput = true;
  } else if (arg === '--help' || arg === '-h') {
    console.log(USAGE);
    process.exit(0);
  } else {
    fail(2, '未知参数 ' + arg + '\n\n' + USAGE);
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const countCrlf = (buf) => (buf.toString('latin1').match(/\r\n/g) || []).length;
const normalizeEol = (buf) => Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
const shortSha = (value) => (value ? value.slice(0, 12) : '-');

function git(args) {
  try {
    return execFileSync(GIT_EXE, args, {
      cwd: REPO_ROOT,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const detail = error && error.stderr ? String(error.stderr).trim() : String(error && error.message ? error.message : error);
    fail(2, 'git ' + args.join(' ') + ' 失败：' + detail);
  }
}

function listExpected(ref) {
  const out = git(['ls-tree', '-r', '--name-only', ref, '--', 'web/data']).toString('utf8');
  const repoPaths = out.split('\n').map((line) => line.trim()).filter((line) => line.length > 0 && line.endsWith('.json'));
  return repoPaths.map((repoRel) => ({
    repoRel,
    entry: 'assets/' + repoRel.slice('web/'.length),
    blob: git(['cat-file', 'blob', ref + ':' + repoRel]),
  }));
}

function openZip(file) {
  const buf = readFileSync(file);
  if (buf.length < 22) fail(1, file + ' 不是有效 ZIP/APK（长度过短）');
  let eocd = -1;
  const lowest = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail(1, file + ' 不是有效 ZIP/APK：找不到 EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) fail(1, file + ' 使用 ZIP64 结构，本脚本不支持');
  const entries = new Map();
  let pointer = cdOffset;
  for (let index = 0; index < count; index++) {
    if (buf.readUInt32LE(pointer) !== 0x02014b50) fail(1, file + ' 中央目录损坏（第 ' + (index + 1) + ' 项）');
    const method = buf.readUInt16LE(pointer + 10);
    const compSize = buf.readUInt32LE(pointer + 20);
    const uncompSize = buf.readUInt32LE(pointer + 24);
    const nameLen = buf.readUInt16LE(pointer + 28);
    const extraLen = buf.readUInt16LE(pointer + 30);
    const commentLen = buf.readUInt16LE(pointer + 32);
    const localOff = buf.readUInt32LE(pointer + 42);
    const name = buf.toString('utf8', pointer + 46, pointer + 46 + nameLen);
    entries.set(name, { method, compSize, uncompSize, localOff });
    pointer += 46 + nameLen + extraLen + commentLen;
  }
  return { file, size: buf.length, buf, entries };
}

function readEntry(zip, name) {
  const meta = zip.entries.get(name);
  if (!meta) return null;
  const pointer = meta.localOff;
  if (zip.buf.readUInt32LE(pointer) !== 0x04034b50) fail(1, zip.file + ' 本地文件头损坏：' + name);
  const nameLen = zip.buf.readUInt16LE(pointer + 26);
  const extraLen = zip.buf.readUInt16LE(pointer + 28);
  const start = pointer + 30 + nameLen + extraLen;
  const raw = zip.buf.subarray(start, start + meta.compSize);
  let data;
  if (meta.method === 0) data = Buffer.from(raw);
  else if (meta.method === 8) data = inflateRawSync(raw);
  else fail(1, '不支持的 ZIP 压缩方法 ' + meta.method + '（' + name + '）');
  if (data.length !== meta.uncompSize) fail(1, '解压长度不符：' + name);
  return data;
}

const expected = listExpected(rev);
if (expected.length === 0) fail(1, 'git ' + rev + ' 的 web/data 下没有任何 .json 文件（引用或路径错误？）');

let sourceLabel;
let readActual;
let extras;
if (apkPath) {
  const resolved = path.resolve(process.cwd(), apkPath);
  if (!existsSync(resolved)) fail(2, 'APK 不存在：' + resolved);
  const zip = openZip(resolved);
  sourceLabel = 'APK ' + resolved + '（' + zip.size + ' 字节，' + zip.entries.size + ' 个 zip 条目）';
  const names = new Set();
  for (const name of zip.entries.keys()) {
    if (name.startsWith('assets/data/') && name.endsWith('.json')) names.add(name);
  }
  readActual = (entry) => readEntry(zip, entry);
  extras = [...names].filter((name) => !expected.some((item) => item.entry === name)).sort();
} else {
  const dataDir = path.join(REPO_ROOT, 'web', 'data');
  if (!existsSync(dataDir)) fail(1, '工作树缺少 web/data 目录：' + dataDir);
  const names = new Set(readdirSync(dataDir).filter((name) => name.endsWith('.json')).map((name) => 'assets/data/' + name));
  sourceLabel = '工作树 web/data（' + names.size + ' 个 .json 文件）';
  readActual = (entry) => {
    const target = path.join(REPO_ROOT, 'web', entry.slice('assets/'.length));
    return existsSync(target) ? readFileSync(target) : null;
  };
  extras = [...names].filter((name) => !expected.some((item) => item.entry === name)).sort();
}

const records = [];
for (const item of expected) {
  const actual = readActual(item.entry);
  const expectedSha256 = sha256(item.blob);
  const record = {
    file: item.entry,
    gitPath: item.repoRel,
    expectedSha256,
    expectedBytes: item.blob.length,
    actualSha256: null,
    actualBytes: null,
    crlf: null,
    normalizedMatch: false,
    verdict: 'FAIL',
    detail: '',
  };
  if (!actual) {
    record.detail = 'APK/工作树中缺少该文件';
    records.push(record);
    continue;
  }
  record.actualSha256 = sha256(actual);
  record.actualBytes = actual.length;
  record.crlf = countCrlf(actual);
  if (record.actualSha256 === expectedSha256) {
    record.verdict = 'PASS';
  } else {
    record.normalizedMatch = sha256(normalizeEol(actual)) === expectedSha256;
    if (record.normalizedMatch) {
      record.verdict = normalizeCrlf ? 'WARN-CRLF' : 'FAIL-CRLF';
      record.detail = '仅换行符不同（CRLF 规范化为 LF 后 SHA-256 一致）';
    } else {
      record.detail = '内容不同（规范化行尾后仍不一致）';
    }
  }
  records.push(record);
}

const passCount = records.filter((record) => record.verdict === 'PASS').length;
const warnCount = records.filter((record) => record.verdict === 'WARN-CRLF').length;
const failCount = records.length - passCount - warnCount;
const ok = failCount === 0 && extras.length === 0;

if (jsonOutput) {
  console.log(JSON.stringify({
    ok,
    mode: normalizeCrlf ? 'normalize-crlf' : 'strict',
    rev,
    repo: REPO_ROOT,
    source: sourceLabel,
    files: records,
    extras,
    counts: { total: records.length, pass: passCount, warn: warnCount, fail: failCount, extras: extras.length },
  }, null, 2));
} else {
  console.log('江水课表 Android · 发布前数据门禁');
  console.log('- 仓库：' + REPO_ROOT);
  console.log('- git 基线：' + rev + '（.gitattributes: * text=auto eol=lf，blob 为 LF）');
  console.log('- 数据源：' + sourceLabel);
  console.log('- 模式：' + (normalizeCrlf ? 'CRLF 规范化（诊断：仅 CRLF 差异记 WARN，不阻断）' : '严格（字节级 SHA-256 必须相等）'));
  console.log('');
  for (const record of records) {
    const mark = record.verdict === 'PASS' ? '[PASS]' : record.verdict === 'WARN-CRLF' ? '[WARN]' : '[FAIL]';
    console.log(
      mark + ' ' + record.file.padEnd(34) +
      ' 字节 ' + String(record.actualBytes === null ? '-' : record.actualBytes).padStart(7) +
      ' CRLF ' + String(record.crlf === null ? '-' : record.crlf).padStart(4) +
      ' sha256 实际 ' + shortSha(record.actualSha256) + ' / 期望 ' + shortSha(record.expectedSha256) +
      (record.detail ? '  ' + record.detail : '')
    );
  }
  for (const name of extras) {
    console.log('[FAIL] 多余文件 ' + name + '  （git 基线 web/data 中没有对应文件）');
  }
  console.log('');
  console.log('文件：共 ' + records.length + '，PASS ' + passCount + '，WARN ' + warnCount + '，FAIL ' + failCount + '，多余 ' + extras.length);
  if (ok) {
    console.log('门禁结论：PASS' + (warnCount > 0 ? '（' + warnCount + ' 个文件仅 CRLF 差异，已由 --normalize-crlf 放行；正式发布必须由 CI/LF 构建严格通过）' : ''));
  } else {
    console.log('门禁结论：FAIL');
    if (!normalizeCrlf && warnCount + failCount > 0 && records.some((record) => record.verdict === 'FAIL-CRLF')) {
      console.log('提示：存在 Windows 工作树 CRLF 导致的差异，可加 --normalize-crlf 复跑确认；正式发布包必须严格通过。');
    }
  }
}

process.exit(ok ? 0 : 1);
