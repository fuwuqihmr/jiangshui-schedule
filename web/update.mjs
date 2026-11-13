// 应用更新：版本比较、原生结果归一化与提示文案。
// 检查与下载都在 Android 原生侧完成；本模块只做纯函数，方便测试，也不接触任何凭据。

const TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const MAX_NOTES = 1200;

function parseIdentifier(value) {
  const match = /^([A-Za-z]*)(\d*)$/.exec(value);
  if (!match) return null;
  return {prefix: match[1].toLowerCase(), number: match[2].replace(/^0+(?=\d)/, '')};
}

function compareIdentifier(left, right) {
  const a = parseIdentifier(left), b = parseIdentifier(right);
  if (a && b) {
    if (a.prefix !== b.prefix) return a.prefix < b.prefix ? -1 : 1;
    if (!a.number && !b.number) return 0;
    if (!a.number) return -1;
    if (!b.number) return 1;
    if (a.number.length !== b.number.length) return a.number.length < b.number.length ? -1 : 1;
    if (a.number === b.number) return 0;
    return a.number < b.number ? -1 : 1;
  }
  const x = String(left).toLowerCase(), y = String(right).toLowerCase();
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

export function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 80) return null;
  const match = TAG_PATTERN.exec(raw);
  if (!match) return null;
  const major = Number(match[1]), minor = Number(match[2]), patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  const pre = match[4] || null;
  return {major, minor, patch, pre, value: major + '.' + minor + '.' + patch + (pre ? '-' + pre : '')};
}

function toVersion(value) {
  return typeof value === 'string' ? parseVersion(value) : value;
}

export function compareVersions(left, right) {
  const a = toVersion(left), b = toVersion(right);
  if (!a || !b) return null;
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (!a.pre && !b.pre) return 0;
  if (!a.pre) return 1;
  if (!b.pre) return -1;
  const leftParts = a.pre.split(/[.-]/), rightParts = b.pre.split(/[.-]/);
  const count = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index++) {
    const result = compareIdentifier(leftParts[index], rightParts[index]);
    if (result) return result;
  }
  if (leftParts.length === rightParts.length) return 0;
  return leftParts.length < rightParts.length ? -1 : 1;
}

export function isNewer(candidate, current) {
  return compareVersions(candidate, current) === 1;
}

function cleanVersion(value) {
  const parsed = parseVersion(value);
  return parsed ? parsed.value : '';
}

export function normalizeUpdateInfo(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: source.enabled !== false,
    currentVersion: cleanVersion(source.currentVersion),
    skippedVersion: cleanVersion(source.skippedVersion),
    lastAutoCheckAt: Number.isFinite(Number(source.lastAutoCheckAt)) ? Number(source.lastAutoCheckAt) : 0
  };
}

export function releaseNotes(value) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return text.length > MAX_NOTES ? text.slice(0, MAX_NOTES).trim() + '…' : text;
}

export function normalizeRelease(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  if (source.ok === false) {
    return {ok: false, updateAvailable: false, errorCode: String(source.errorCode || 'unknown'), message: updateErrorText(source.errorCode, source.message)};
  }
  const latest = parseVersion(source.latestVersion);
  const available = source.updateAvailable === true && !!latest;
  return {
    ok: true,
    updateAvailable: available,
    currentVersion: cleanVersion(source.currentVersion),
    latestVersion: latest ? latest.value : '',
    prerelease: available && (source.prerelease === true || !!latest.pre),
    notes: available ? releaseNotes(source.notes) : '',
    publishedAt: typeof source.publishedAt === 'string' ? source.publishedAt.slice(0, 40) : '',
    skipped: source.skipped === true
  };
}

export function releaseTitle(version) {
  const parsed = parseVersion(version);
  if (!parsed) return '发现新版本';
  return (parsed.pre ? '发现测试版 v' : '发现新版本 v') + parsed.value;
}

export function releaseTag(version) {
  const parsed = parseVersion(version);
  return parsed ? 'v' + parsed.value : '';
}

export function updateErrorText(code, message) {
  const key = typeof code === 'string' ? code : '';
  const known = {
    network: '网络连接失败，请检查网络后重试',
    storage: '本机存储空间不足或文件写入失败',
    asset_missing: '发布资产不完整，已停止更新',
    checksum_mismatch: '安装包校验失败，已删除文件并阻止安装',
    signature_mismatch: '安装包签名不匹配，已删除文件并阻止安装',
    install: '无法打开系统安装器，请稍后重试',
    version: '版本号无法识别，暂时无法检查更新',
    busy: '正在处理，请稍候',
    not_ready: '请先检查更新',
    cancelled: '已取消下载'
  };
  if (known[key]) return known[key];
  const text = typeof message === 'string' ? message.trim() : '';
  return text ? text.slice(0, 160) : '更新检查失败，请稍后重试';
}

export function formatUpdateSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1024 * 1024) return Math.max(1, Math.round(value / 1024)) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}
