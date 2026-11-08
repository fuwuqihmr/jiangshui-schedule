#!/usr/bin/env node
/**
 * tools/check-upload-scope.mjs
 *
 * 公开仓库上传范围守卫（白名单模式）：
 *   1. 收集候选文件：已跟踪 + 已暂存 + 未跟踪且未被 .gitignore 忽略；
 *   2. 逐个对照 tools/upload-allowlist.txt，未列入者拒绝；
 *   3. 额外硬性拒绝构建产物/签名材料/环境文件（即使白名单误放行）；
 *   4. 用一组哨兵路径反向验证 .gitignore 仍然生效（防止忽略规则被改坏）；
 *   5. 任一文件超过 10 MiB 视为异常（可用 MAX_FILE_MB 调整）。
 *
 * 用法：
 *   node tools/check-upload-scope.mjs                 # 检查全部候选（默认）
 *   node tools/check-upload-scope.mjs --staged-only   # 只检查已暂存文件
 *   node tools/check-upload-scope.mjs --list          # 列出放行清单
 *   node tools/check-upload-scope.mjs --json          # 机器可读结果
 *
 * 退出码：0 = 通过；1 = 发现越界/超限文件；2 = 环境或用法错误。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ALLOWLIST_PATH = path.join(SCRIPT_DIR, 'upload-allowlist.txt');
const GIT_EXE = process.env.GIT_EXE || 'git';

const MAX_FILE_MB = Number(process.env.MAX_FILE_MB || 10);

const HARD_DENY_DIRS = new Set([
  '.git', '.gradle', '.hvigor', '.idea', '.vscode', 'build', 'dist',
  'release', 'coverage', 'node_modules', 'oh_modules', 'output', 'tmp',
]);
const HARD_DENY_EXT = new Set([
  '.apk', '.aab', '.hap', '.har', '.hsp', '.zip', '.7z', '.rar', '.gz',
  '.exe', '.dll', '.so', '.class', '.jar', '.aar', '.msi', '.iso', '.img',
  '.jks', '.keystore', '.p12', '.pfx', '.pem', '.key', '.log',
]);
const HARD_DENY_NAMES = new Set([
  'thumbs.db', 'desktop.ini', '.ds_store', 'local.properties',
  'id_rsa', 'id_ed25519',
]);

// 必须被 .gitignore 排除的哨兵（规则失效即报错）
const MUST_IGNORE = [
  'node_modules/left-pad/index.js',
  'output/manifest.json',
  'output/JiangShui-Pack.zip',
  'android/app/build/outputs/apk/debug/app-debug.apk',
  'android/local.properties',
  'android/widget-test/custom-fixtures.json',
  'harmony/entry/build/default/outputs/default/entry-default-unsigned.hap',
  'harmony/oh_modules/@ohos/hypium/index.ts',
  'harmony/.hvigor/cache/state.json',
  'harmony/local.properties',
  'review-check.txt',
  'review-npm.txt',
  'tools/probe-edge-log.json',
  'tools/jsxsd-kb.html',
  'tools/jsxsd-rows.json',
  'tools/jsxsd-week.html',
  'tools/jsxsd-data.html',
  '.env',
  'Thumbs.db',
  'DECISIONS.md',
  'ANDROID-CHANGELOG.md',
  'README-归档说明-归档入口.md',
  'MOBILE_ONLY.md',
  'RELEASE-POLICY.md',
  'harmony/README-Harmony.md',
  'harmony/deveco-setup.md',
  'harmony/entry/src/main/ets/features/custom/NAV.md',
  'tools/probe-edge.cjs',
  'tools/probe2.cjs',
  'tools/qzTable.js',
  'tools/verify-jsxsd.mjs',
  'tools/extract_samples.py',
];

// 必须不被忽略的哨兵（防止忽略规则过度扩大）
const MUST_NOT_IGNORE = [
  '.gitignore',
  '.gitattributes',
  'package.json',
  'web/app.mjs',
  'tools/check-upload-scope.mjs',
  'tools/upload-allowlist.txt',
  'harmony/entry/src/main/ets/pages/Index.ets',
  'NOTIFICATIONS.md',
  'XIAOMI-NOTIFICATIONS.md',
  'tools/build-android.ps1',
  'tools/export-client-icons.cjs',
  'README.md',
  'SECURITY.md',
  'LICENSE',
  'NOTICE',
  'tools/package-apk.py',
  'tools/package-windows.cjs',
  'harmony/tools/check-harmony.mjs',
  'harmony/tools/resource-requests/harmony-custom.json',
  'harmony/tools/resource-requests/harmony-export.json',
  'harmony/tools/resource-requests/harmony-files.json',
  'harmony/tools/resource-requests/harmony-session.json',
  'harmony/tools/resource-requests/harmony-system.json',
  'harmony/tools/resource-requests/harmony-ui.json',
];

function die(message, code = 2) {
  console.error('[check-upload-scope] ' + message);
  process.exit(code);
}

function runGit(args, options = {}) {
  const res = spawnSync(GIT_EXE, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) die('无法运行 git（' + GIT_EXE + '）：' + res.error.message);
  if (res.status !== 0 && !options.allowFailure) {
    die('git ' + args.join(' ') + ' 失败（exit ' + res.status + '）：' +
      String(res.stderr || '').trim());
  }
  return res;
}

function splitNul(text) {
  return String(text || '').split('\0').filter(Boolean);
}

function globToRegExp(raw) {
  let pattern = String(raw).trim().replace(/\\/g, '/');
  if (pattern.startsWith('/')) pattern = pattern.slice(1);
  let dirOnly = false;
  if (pattern.endsWith('/')) {
    dirOnly = true;
    pattern = pattern.slice(0, -1);
  }
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  out += dirOnly ? '(?:/.*)?$' : '$';
  return new RegExp(out);
}

function loadAllowlist() {
  let text;
  try {
    text = readFileSync(ALLOWLIST_PATH, 'utf8');
  } catch (error) {
    die('无法读取白名单 ' + ALLOWLIST_PATH + '：' + error.message);
  }
  const entries = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const exclude = trimmed.startsWith('!');
    const pattern = exclude ? trimmed.slice(1) : trimmed;
    if (!pattern) return;
    entries.push({ line: index + 1, raw: trimmed, exclude, regex: globToRegExp(pattern) });
  });
  if (!entries.length) die('白名单为空：' + ALLOWLIST_PATH);
  return entries;
}

function hardDenyReason(filePath) {
  const lower = filePath.toLowerCase();
  const segments = lower.split('/');
  for (const segment of segments) {
    if (HARD_DENY_DIRS.has(segment)) return '目录 ' + segment + '/ 属于构建产物或依赖';
  }
  const base = segments[segments.length - 1] || '';
  if (base === '.env' || base.startsWith('.env.')) return '环境变量文件';
  if (HARD_DENY_NAMES.has(base)) return '系统/本地环境文件';
  const ext = path.posix.extname(base);
  if (HARD_DENY_EXT.has(ext)) return '扩展名 ' + ext + ' 属于构建产物或签名材料';
  return null;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MiB';
}

function main() {
  const argv = new Set(process.argv.slice(2));
  if (argv.has('--help') || argv.has('-h')) {
    console.log('用法：node tools/check-upload-scope.mjs [--staged-only] [--list] [--json]');
    return;
  }
  const stagedOnly = argv.has('--staged-only');
  const list = argv.has('--list');
  const asJson = argv.has('--json');

  const root = runGit(['rev-parse', '--show-toplevel']).stdout.trim();
  if (!root) die('当前目录不在 git 仓库内');

  const allowEntries = loadAllowlist();

  const tracked = splitNul(runGit(['ls-files', '-z'], { cwd: root }).stdout);
  const staged = splitNul(runGit(
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
    { cwd: root },
  ).stdout);
  const untracked = stagedOnly ? [] : splitNul(runGit(
    ['ls-files', '-z', '--others', '--exclude-standard'],
    { cwd: root },
  ).stdout);

  const candidates = [...new Set([...(stagedOnly ? [] : tracked), ...staged, ...untracked])]
    .map((file) => file.replace(/\\/g, '/'))
    .sort();

  const problems = [];
  const allowed = [];
  let totalBytes = 0;
  let largest = null;

  for (const file of candidates) {
    const denied = hardDenyReason(file);
    if (denied) {
      problems.push({ file, reason: '硬性禁止：' + denied });
      continue;
    }
    const excluded = allowEntries.find((entry) => entry.exclude && entry.regex.test(file));
    if (excluded) {
      problems.push({ file, reason: '命中 allowlist 排除项：' + excluded.raw });
      continue;
    }
    const matched = allowEntries.find((entry) => !entry.exclude && entry.regex.test(file));
    if (!matched) {
      problems.push({ file, reason: '未列入 tools/upload-allowlist.txt' });
      continue;
    }
    let size = 0;
    try {
      size = statSync(path.join(root, file)).size;
    } catch {
      size = 0;
    }
    if (size > MAX_FILE_MB * 1024 * 1024) {
      problems.push({
        file,
        reason: '文件 ' + formatBytes(size) + ' 超过 ' + MAX_FILE_MB + ' MiB 上限',
      });
      continue;
    }
    totalBytes += size;
    allowed.push({ file, size });
    if (!largest || size > largest.size) largest = { file, size };
  }

  // 哨兵验证：忽略规则仍然生效，且没有把放行目录误伤
  const ignoreBroken = [];
  for (const sentinel of MUST_IGNORE) {
    const res = runGit(['check-ignore', '-q', '--no-index', '--', sentinel], {
      cwd: root,
      allowFailure: true,
    });
    if (res.status !== 0) ignoreBroken.push(sentinel);
  }
  for (const sentinel of MUST_NOT_IGNORE) {
    const res = runGit(['check-ignore', '-q', '--no-index', '--', sentinel], {
      cwd: root,
      allowFailure: true,
    });
    if (res.status === 0) ignoreBroken.push(sentinel + '（不应被忽略）');
  }
  for (const broken of ignoreBroken) {
    problems.push({ file: broken, reason: '.gitignore 哨兵校验失败' });
  }

  if (asJson) {
    console.log(JSON.stringify({
      ok: problems.length === 0,
      root,
      counts: {
        tracked: tracked.length,
        staged: staged.length,
        untracked: untracked.length,
        candidates: candidates.length,
        allowed: allowed.length,
      },
      totalBytes,
      largest,
      problems,
      allowed: list ? allowed : undefined,
    }, null, 2));
  } else {
    console.log('[check-upload-scope] 仓库根：' + root);
    console.log('[check-upload-scope] 候选文件：' + candidates.length +
      '（tracked ' + tracked.length + ' / staged ' + staged.length +
      ' / untracked ' + untracked.length + '）');
    console.log('[check-upload-scope] 放行：' + allowed.length + ' 个，合计 ' +
      formatBytes(totalBytes) +
      (largest ? '；最大 ' + largest.file + '（' + formatBytes(largest.size) + '）' : ''));
    console.log('[check-upload-scope] 忽略哨兵：' + (MUST_IGNORE.length + MUST_NOT_IGNORE.length - ignoreBroken.length) +
      '/' + (MUST_IGNORE.length + MUST_NOT_IGNORE.length) + ' 通过');
    if (list) {
      for (const item of allowed) console.log('  ' + item.file + '\t' + formatBytes(item.size));
    }
    if (problems.length) {
      console.error('[check-upload-scope] ❌ 发现 ' + problems.length + ' 个问题：');
      for (const item of problems.slice(0, 100)) {
        console.error('  - ' + item.file + '：' + item.reason);
      }
      if (problems.length > 100) {
        console.error('  … 其余 ' + (problems.length - 100) + ' 个从略');
      }
    } else {
      console.log('[check-upload-scope] ✅ 上传范围检查通过');
    }
  }

  process.exit(problems.length === 0 ? 0 : 1);
}

main();
