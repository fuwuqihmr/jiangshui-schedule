import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp = process.env.HARMONY_CORE_TMP;
if (!tmp) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');

async function load(rel) {
  return import(pathToFileURL(path.join(tmp, rel)).href);
}
const naming = await load('core/files/FileNaming.ts');
const utf8 = await load('core/files/Utf8Text.ts');

const replacement = String.fromCharCode(0xFFFD);

test('1) 文件名清洗：清非法字符、去首尾点与空格、保留中文、空串用兜底', () => {
  assert.equal(naming.sanitizeFileStem('a/b:c*d?e"f<g>h|i\\j', 'fallback'), 'abcdefghij');
  assert.equal(naming.sanitizeFileStem('.hidden.', 'x'), 'hidden');
  assert.equal(naming.sanitizeFileStem('  课表 2026  ', 'x'), '课表 2026');
  assert.equal(naming.sanitizeFileStem(String.fromCharCode(7) + 'bell', 'x'), 'bell');
  assert.equal(naming.sanitizeFileStem('   ', 'fallback'), 'fallback');
  assert.equal(naming.sanitizeFileStem('', 'fallback'), 'fallback');
});

test('2) 文件名合法性：非法路径符/超长/首尾点空格/全空串拒绝，正常中文名通过', () => {
  assert.equal(naming.isValidFileName('课表-2026.json'), true);
  assert.equal(naming.isValidFileName('a.txt'), true);
  assert.equal(naming.isValidFileName('a'.repeat(180) + '.txt'), false);
  assert.equal(naming.isValidFileName('a/b.json'), false);
  assert.equal(naming.isValidFileName('a.b.'), false);
  assert.equal(naming.isValidFileName('a '), false);
  assert.equal(naming.isValidFileName('.'), false);
  assert.equal(naming.isValidFileName('..'), false);
  assert.equal(naming.isValidFileName(''), false);
});

test('3) 扩展名归一与补全：大写/多余点/重复后缀不叠加', () => {
  assert.equal(naming.normalizeExtension(' .TXT '), 'txt');
  assert.equal(naming.normalizeExtension('.'), '');
  assert.equal(naming.normalizeExtension('a-b'), '');
  assert.equal(naming.extensionOfFileName('x.tar.gz'), 'gz');
  assert.equal(naming.extensionOfFileName('README'), '');
  assert.equal(naming.ensureFileExtension('a.txt', 'txt'), 'a.txt');
  assert.equal(naming.ensureFileExtension('a.TXT', 'txt'), 'a.TXT');
  assert.equal(naming.ensureFileExtension('a', '.TXT'), 'a.txt');
  assert.equal(naming.ensureFileExtension('a.', 'txt'), 'a.txt');
  assert.equal(naming.ensureFileExtension('a', ''), 'a');
});

test('4) 截断：按上限裁剪并去掉尾部点/空格，上限非法返回空串', () => {
  assert.equal(naming.trimFileName('abcdef', 3), 'abc');
  assert.equal(naming.trimFileName('ab.', 3), 'ab');
  assert.equal(naming.trimFileName('abcdef', 0), '');
  assert.equal(naming.trimFileName('abcdef', 6), 'abcdef');
});

test('5) 时间戳：UTC 与东八区偏移格式固定，非法时间抛 FILE_TIME_INVALID', () => {
  assert.equal(naming.buildTimestamp(0, 0), '19700101-000000');
  assert.equal(naming.buildTimestamp(0, 480), '19700101-080000');
  assert.throws(() => naming.buildTimestamp(NaN, 0), (error) => error.message === naming.FILE_TIME_INVALID);
  assert.throws(() => naming.buildTimestamp(-1, 0), (error) => error.message === naming.FILE_TIME_INVALID);
});

test('6) 导出种类到扩展名、扩展名到 MIME', () => {
  assert.equal(naming.extensionForKind('semester-overview'), 'png');
  assert.equal(naming.extensionForKind('semester-pages'), 'pdf');
  assert.equal(naming.extensionForKind('rules-text'), 'txt');
  assert.equal(naming.extensionForKind('rules-csv'), 'csv');
  assert.equal(naming.extensionForKind('backup'), 'json');
  assert.equal(naming.extensionForKind('diagnostics'), 'txt');
  assert.equal(naming.extensionForKind('unknown'), '');
  assert.equal(naming.mimeForExtension('PNG'), 'image/png');
  assert.equal(naming.mimeForExtension('pdf'), 'application/pdf');
  assert.equal(naming.mimeForExtension('txt'), 'text/plain');
  assert.equal(naming.mimeForExtension('json'), 'application/json');
  assert.equal(naming.mimeForExtension('csv'), 'text/csv');
  assert.equal(naming.mimeForExtension('bin'), 'application/octet-stream');
});

test('7) 文件名生成：含前缀、学期、时间戳、扩展名，超长仍 ≤180 且扩展名保留', () => {
  const name = naming.buildFileName({
    prefix: 'jiangshui',
    label: '2026-2027-1',
    kind: 'backup',
    nowMs: Date.UTC(2026, 9, 30, 9, 19, 0),
    offsetMinutes: 480,
  });
  assert.equal(name, 'jiangshui-2026-2027-1-20261030-171900.json');
  const long = naming.buildFileName({
    prefix: 'jiangshui',
    label: '第'.repeat(400),
    kind: 'semester-pages',
    nowMs: 0,
  });
  assert.equal(long.length <= naming.MAX_FILE_NAME_LENGTH, true);
  assert.equal(long.endsWith('.pdf'), true);
});

test('8) 字节数格式化：B/KB/MB、负数与非数值归零', () => {
  assert.equal(naming.formatBytes(0), '0 B');
  assert.equal(naming.formatBytes(512), '512 B');
  assert.equal(naming.formatBytes(1024), '1 KB');
  assert.equal(naming.formatBytes(1536), '1.5 KB');
  assert.equal(naming.formatBytes(1048576), '1 MB');
  assert.equal(naming.formatBytes(8388608), '8 MB');
  assert.equal(naming.formatBytes(-1), '0 B');
  assert.equal(naming.formatBytes(NaN), '0 B');
});

test('9) 可选导入类型：只接受 json/txt/csv（大小写无关），其余拒绝', () => {
  assert.equal(naming.isSupportedPickName('a.json'), true);
  assert.equal(naming.isSupportedPickName('A.TXT'), true);
  assert.equal(naming.isSupportedPickName('备份.csv'), true);
  assert.equal(naming.isSupportedPickName('a.png'), false);
  assert.equal(naming.isSupportedPickName('a.pdf'), false);
  assert.equal(naming.isSupportedPickName('noext'), false);
});

test('10) picker URI 安全：file/datashare 通过，http/越权/反斜杠/空格/超长拒绝', () => {
  assert.equal(naming.isSafePickedUri('file://docs/storage/Users/currentUser/Download/a.json'), true);
  assert.equal(naming.isSafePickedUri('datashare:///media/a.json'), true);
  assert.equal(naming.isSafePickedUri('file:///a.json'), false);
  assert.equal(naming.isSafePickedUri('http://docs/a.json'), false);
  assert.equal(naming.isSafePickedUri('file://docs/../a.json'), false);
  assert.equal(naming.isSafePickedUri('file://docs/a\\b.json'), false);
  assert.equal(naming.isSafePickedUri('file://docs/a b.json'), false);
  assert.equal(naming.isSafePickedUri('file://docs/' + 'a'.repeat(2100)), false);
  assert.equal(naming.isSafePickedUri(''), false);
});

test('11) URI 取文件名：百分号解码中文、剥离 query/hash、空名兜底', () => {
  assert.equal(
    naming.fileNameOfUri('file://docs/storage/Users/currentUser/Download/%E8%AF%BE%E8%A1%A8.json'),
    '课表.json',
  );
  assert.equal(naming.fileNameOfUri('file://docs/a.json?v=1'), 'a.json');
  assert.equal(naming.fileNameOfUri('file://docs/a.json#x'), 'a.json');
  assert.equal(naming.fileNameOfUri('file://docs/'), 'file');
  assert.equal(naming.fileNameOfUri(''), 'file');
});

test('12) 取消映射：13900042 与 cancel 文案都归 FILE_CANCELED', () => {
  assert.equal(naming.mapPickerFailure(13900042, 'User canceled'), naming.FILE_CANCELED);
  assert.equal(naming.mapPickerFailure('13900042', ''), naming.FILE_CANCELED);
  assert.equal(naming.mapPickerFailure(0, 'user canceled by user'), naming.FILE_CANCELED);
  assert.equal(naming.mapPickerFailure(13900005, 'I/O error'), naming.FILE_IO_FAILED);
});

test('13) 能力不可用映射：801/13900020/not supported 归 FILE_UNAVAILABLE', () => {
  assert.equal(naming.mapPickerFailure(801, ''), naming.FILE_UNAVAILABLE);
  assert.equal(naming.mapPickerFailure(13900020, ''), naming.FILE_UNAVAILABLE);
  assert.equal(naming.mapPickerFailure(0, 'capability not supported'), naming.FILE_UNAVAILABLE);
  assert.equal(naming.mapPickerFailure(0, 'service unavailable'), naming.FILE_UNAVAILABLE);
  assert.equal(naming.mapPickerFailure(0, 'other failure'), naming.FILE_IO_FAILED);
});

test('14) 大小检查：0 字节 EMPTY、超 8MB TOO_LARGE、导出上限 33MB、非法值 IO', () => {
  assert.equal(naming.checkPickedSize(0), naming.FILE_EMPTY);
  assert.equal(naming.checkPickedSize(1024), '');
  assert.equal(naming.checkPickedSize(naming.MAX_PICK_BYTES), '');
  assert.equal(naming.checkPickedSize(naming.MAX_PICK_BYTES + 1), naming.FILE_TOO_LARGE);
  assert.equal(naming.checkPickedSize(NaN), naming.FILE_IO_FAILED);
  assert.equal(naming.checkPickedSize(-1), naming.FILE_IO_FAILED);
  assert.equal(naming.checkSaveSize(naming.MAX_SAVE_BYTES), '');
  assert.equal(naming.checkSaveSize(naming.MAX_SAVE_BYTES + 1), naming.FILE_TOO_LARGE);
  assert.equal(naming.checkPickedSize(2048, 1024), naming.FILE_TOO_LARGE);
});

test('15) 错误码到文案键：取消有键但 UI 默认静默，其余有可见键', () => {
  assert.equal(naming.messageKeyForFileError(naming.FILE_CANCELED), 'file_error_canceled');
  assert.equal(naming.messageKeyForFileError(naming.FILE_TOO_LARGE), 'file_error_too_large');
  assert.equal(naming.messageKeyForFileError(naming.FILE_UNAVAILABLE), 'file_error_unavailable');
  assert.equal(naming.messageKeyForFileError(naming.FILE_UNSUPPORTED), 'file_error_unsupported');
  assert.equal(naming.messageKeyForFileError(naming.FILE_EMPTY), 'file_error_empty');
  assert.equal(naming.messageKeyForFileError(naming.FILE_INVALID_PATH), 'file_error_invalid_path');
  assert.equal(naming.messageKeyForFileError(naming.FILE_NAME_INVALID), 'file_error_name');
  assert.equal(naming.messageKeyForFileError(naming.FILE_TIME_INVALID), 'file_error_time');
  assert.equal(naming.messageKeyForFileError('WHATEVER'), 'file_error_io');
});

test('16) UTF-8 解码：ASCII、中文、emoji、BOM 剥离', () => {
  assert.equal(utf8.decodeUtf8(Buffer.from('abc', 'utf8')), 'abc');
  assert.equal(utf8.decodeUtf8(Buffer.from('课表 2026', 'utf8')), '课表 2026');
  assert.equal(utf8.decodeUtf8(Buffer.from('😀', 'utf8')), '😀');
  const bom = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('课表', 'utf8')]);
  assert.equal(utf8.decodeUtf8(bom), '课表');
  assert.equal(utf8.decodeUtf8(new Uint8Array(0)), '');
});

test('17) UTF-8 非法/截断序列替换为 U+FFFD，不抛异常', () => {
  assert.equal(utf8.decodeUtf8(Uint8Array.from([0xE8])), replacement);
  assert.equal(utf8.decodeUtf8(Uint8Array.from([0xC0, 0x80])), replacement + replacement);
  assert.equal(
    utf8.decodeUtf8(Uint8Array.from([0xE0, 0x80, 0x80])),
    replacement + replacement + replacement,
  );
  assert.equal(utf8.decodeUtf8(Uint8Array.from([0xFF])), replacement);
});

test('18) MIME 到扩展名映射：建议名无后缀时补全、未知 MIME 不补', () => {
  assert.equal(naming.extensionForMime('image/png'), 'png');
  assert.equal(naming.extensionForMime('application/pdf'), 'pdf');
  assert.equal(naming.extensionForMime('text/plain'), 'txt');
  assert.equal(naming.extensionForMime('application/json'), 'json');
  assert.equal(naming.extensionForMime('text/csv'), 'csv');
  assert.equal(naming.extensionForMime('application/zip'), '');
  assert.equal(
    naming.ensureFileExtension('jiangshui-backup', naming.extensionForMime('application/json')),
    'jiangshui-backup.json',
  );
});

test('19) 稳定码字面值固定：与 Common.ets ErrorCode 三条文件码一致', () => {
  assert.equal(naming.FILE_CANCELED, 'FILE_CANCELED');
  assert.equal(naming.FILE_TOO_LARGE, 'FILE_TOO_LARGE');
  assert.equal(naming.FILE_UNAVAILABLE, 'FILE_UNAVAILABLE');
  assert.equal(naming.FILE_IO_FAILED, 'FILE_IO_FAILED');
});

test('20) UTF-8 字节长度：ASCII/中文/emoji/孤立代理', () => {
  assert.equal(utf8.utf8ByteLength('a'), 1);
  assert.equal(utf8.utf8ByteLength('课表'), 6);
  assert.equal(utf8.utf8ByteLength('😀'), 4);
  assert.equal(utf8.utf8ByteLength(String.fromCharCode(0xD83D)), 3);
  assert.equal(utf8.utf8ByteLength(''), 0);
});
