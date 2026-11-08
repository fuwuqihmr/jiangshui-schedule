#!/usr/bin/env node
/**
 * 沙箱测试：SchoolTicketStoreImpl 的文件 + Preferences 元数据清理。
 * 只复制 platform/session/SchoolTicketStoreImpl.ets 与 data/SchoolTicketStore.ets，
 * 用内存文件系统和内存 Preferences 桩替代 @kit.CoreFileKit / @ohos.data.preferences；
 * 不访问真实文件、不访问 HarmonyOS SDK、不发网络请求。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const harmonyRoot = process.env.HARMONY_ROOT;
if (!harmonyRoot) throw new Error('HARMONY_ROOT 未设置，请用 run-core-tests.mjs 运行');
const etsRoot = path.join(harmonyRoot, 'entry/src/main/ets');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'harmony-ticket-impl-'));

function write(rel, text) {
  const full = path.join(sandbox, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
}

function copy(rel) {
  const from = path.join(etsRoot, rel);
  const to = path.join(sandbox, rel.slice(0, -4) + '.ts');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function rewrite(file) {
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/(from\s*['"])(\.{1,2}\/[^'"]+)(['"])/g, (whole, pre, spec, post) => {
    let next = spec;
    if (next.endsWith('.ets')) next = next.slice(0, -4) + '.ts';
    else if (!next.endsWith('.ts')) {
      const abs = path.resolve(path.dirname(file), next);
      if (fs.existsSync(abs + '.ts')) next += '.ts';
    }
    return pre + next + post;
  });
  text = text.replace("from '@kit.CoreFileKit'", "from '../../stubs/CoreFileKit.ts'");
  text = text.replace("from '@ohos.data.preferences'", "from '../../stubs/Preferences.ts'");
  fs.writeFileSync(file, text);
}

write('core/types/Common.ts', [
  'export const ErrorCode = {',
  "  STATE_WRITE_FAILED: 'STATE_WRITE_FAILED',",
  "  PREFERENCES_UNAVAILABLE: 'PREFERENCES_UNAVAILABLE',",
  "  STATE_FILE_UNAVAILABLE: 'STATE_FILE_UNAVAILABLE'",
  '};',
  ''
].join('\n'));

write('stubs/CoreFileKit.ts', [
  'const files = new Map();',
  'export const fileIo = {',
  '  OpenMode: { CREATE: 1, READ_WRITE: 2, TRUNC: 4 },',
  '  readTextSync(p) {',
  "    if (!files.has(p)) throw new Error('ENOENT');",
  '    return files.get(p);',
  '  },',
  '  openSync(p, _mode) { return { fd: p }; },',
  '  writeSync(fd, text) { files.set(fd, String(text)); },',
  '  fsyncSync(_fd) {},',
  '  closeSync(_file) {},',
  '  renameSync(from, to) {',
  "    if (!files.has(from)) throw new Error('ENOENT');",
  '    const value = files.get(from);',
  '    files.delete(from);',
  '    files.set(to, value);',
  '  },',
  '  unlinkSync(p) {',
  "    if (!files.has(p)) throw new Error('ENOENT');",
  '    files.delete(p);',
  '  }',
  '};',
  'export const __files = files;',
  ''
].join('\n'));

write('stubs/Preferences.ts', [
  'const values = new Map();',
  'const prefs = {',
  '  async get(key, fallback) { return values.has(key) ? values.get(key) : fallback; },',
  '  async put(key, value) { values.set(key, value); },',
  '  async delete(key) { values.delete(key); },',
  '  async flush() {}',
  '};',
  'export default { async getPreferences() { return prefs; } };',
  'export const __values = values;',
  ''
].join('\n'));

copy('data/SchoolTicketStore.ets');
copy('platform/session/SchoolTicketStoreImpl.ets');
rewrite(path.join(sandbox, 'platform/session/SchoolTicketStoreImpl.ts'));

const impl = await import(pathToFileURL(path.join(sandbox, 'platform/session/SchoolTicketStoreImpl.ts')).href);
const files = (await import(pathToFileURL(path.join(sandbox, 'stubs/CoreFileKit.ts')).href)).__files;
const values = (await import(pathToFileURL(path.join(sandbox, 'stubs/Preferences.ts')).href)).__values;
const context = { filesDir: '/files' };

test('ticket-store-impl-1) save 写文件与元数据，load 读回同一 TGC', async () => {
  const store = await impl.createSchoolTicketStore(context);
  await store.save({ cookieHeader: 'TGC=abc; route=x', updatedAt: 123, domain: 'eapp2.juwp.edu.cn:9443' });
  const raw = files.get('/files/school-ticket.bin');
  assert.ok(typeof raw === 'string' && raw.indexOf('TGC=abc') >= 0);
  assert.deepEqual(await store.load(), {
    cookieHeader: 'TGC=abc',
    updatedAt: 123,
    domain: 'eapp2.juwp.edu.cn:9443'
  });
  assert.deepEqual(await store.metadata(), { updatedAt: 123, hasTgc: true });
});

test('ticket-store-impl-2) clear 同时删除 TGC 文件与两个 Preferences 元数据键', async () => {
  const store = await impl.createSchoolTicketStore(context);
  await store.save({ cookieHeader: 'TGC=abc', updatedAt: 123, domain: 'eapp2.juwp.edu.cn:9443' });
  assert.ok(files.has('/files/school-ticket.bin'));
  assert.ok(values.has('jiangshui.school.ticket.updatedAt'));
  assert.ok(values.has('jiangshui.school.ticket.hasTgc'));

  await store.clear();
  assert.equal(files.has('/files/school-ticket.bin'), false);
  assert.equal(values.has('jiangshui.school.ticket.updatedAt'), false);
  assert.equal(values.has('jiangshui.school.ticket.hasTgc'), false);
  assert.equal(await store.load(), null);
  assert.deepEqual(await store.metadata(), { updatedAt: 0, hasTgc: false });
});

test('ticket-store-impl-3) 文件内容损坏时 load 返回 null，不抛出', async () => {
  const store = await impl.createSchoolTicketStore(context);
  files.set('/files/school-ticket.bin', 'not-json');
  assert.equal(await store.load(), null);
});
