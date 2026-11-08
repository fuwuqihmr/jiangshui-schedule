#!/usr/bin/env node
/**
 * 纯逻辑：CAS TGC 持久化契约（无网络、无 Kit）。
 * 覆盖提取/规范化/Memory 存储/元数据；由 run-core-tests.mjs 收集。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const TMP = process.env.HARMONY_CORE_TMP;
if (!TMP) throw new Error('HARMONY_CORE_TMP 未设置，请用 run-core-tests.mjs 运行');
const mod = await import(pathToFileURL(path.join(TMP, 'data/SchoolTicketStore.ts')).href);
const {
  SCHOOL_TICKET_DOMAIN,
  SCHOOL_TICKET_NAMES,
  extractTicketGrantingCookie,
  hasTicketGrantingCookie,
  ticketGrantingCookieFromSetCookies,
  isSchoolTicketUsable,
  normalizeSchoolTicket,
  ticketMetadata,
  MemorySchoolTicketStore
} = mod;

test('ticket-store-1) 从 Cookie 头按候选名优先级提取 CAS TGC，忽略其它 cookie', () => {
  // 多票据 cookie 同时存在时的规则定稿：严格按 SCHOOL_TICKET_NAMES 顺序取第一个存在者。
  assert.deepEqual(SCHOOL_TICKET_NAMES, ['TGC', 'CASTGC', 'CAS_TGC', 'TGC2']);
  const header = 'route=abc; CASTGC=CASTGC-value; TGC=second; foo=bar';
  assert.equal(extractTicketGrantingCookie(header), 'TGC=second');
  assert.equal(hasTicketGrantingCookie(header), true);
  assert.equal(extractTicketGrantingCookie('route=abc; foo=bar'), '');
  assert.equal(hasTicketGrantingCookie(''), false);
});

test('ticket-store-2) 从 Set-Cookie 列表只取 name=value，丢弃 Path/HttpOnly 属性', () => {
  const setCookies = [
    'bzb_jsxsd=session; Path=/jsxsd; HttpOnly',
    'TGC=fresh-ticket; Path=/; Secure; HttpOnly',
    'route=zzz; Path=/'
  ];
  assert.equal(ticketGrantingCookieFromSetCookies(setCookies), 'TGC=fresh-ticket');
  assert.equal(ticketGrantingCookieFromSetCookies([]), '');
  assert.equal(ticketGrantingCookieFromSetCookies(['foo=bar; Path=/']), '');
});

test('ticket-store-3) 规范化只保留 TGC；Memory 存储 save/load/clear 与元数据一致', async () => {
  const raw = normalizeSchoolTicket({
    cookieHeader: 'TGC=abc; route=xyz',
    updatedAt: 456,
    domain: 'wrong.example'
  });
  assert.equal(raw.cookieHeader, 'TGC=abc');
  assert.equal(raw.domain, SCHOOL_TICKET_DOMAIN);
  assert.equal(isSchoolTicketUsable(raw), true);

  const store = new MemorySchoolTicketStore();
  assert.equal(await store.load(), null);
  assert.deepEqual(await store.metadata(), { updatedAt: 0, hasTgc: false });
  await store.save({ cookieHeader: 'TGC=abc', updatedAt: 456, domain: SCHOOL_TICKET_DOMAIN });
  assert.deepEqual(await store.load(), {
    cookieHeader: 'TGC=abc',
    updatedAt: 456,
    domain: SCHOOL_TICKET_DOMAIN
  });
  assert.deepEqual(await store.metadata(), { updatedAt: 456, hasTgc: true });
  await store.clear();
  assert.equal(await store.load(), null);
  assert.deepEqual(ticketMetadata(null), { updatedAt: 0, hasTgc: false });
});

test('ticket-store-4) 无 TGC、时间非法或域不符的票据判为不可用', () => {
  assert.equal(isSchoolTicketUsable(null), false);
  assert.equal(isSchoolTicketUsable({ cookieHeader: 'route=x', updatedAt: 1, domain: SCHOOL_TICKET_DOMAIN }), false);
  assert.equal(isSchoolTicketUsable({ cookieHeader: 'TGC=x', updatedAt: 0, domain: SCHOOL_TICKET_DOMAIN }), false);
  assert.equal(isSchoolTicketUsable({ cookieHeader: 'TGC=x', updatedAt: 1, domain: 'other' }), false);
  assert.equal(isSchoolTicketUsable({ cookieHeader: 'TGC=x', updatedAt: 1, domain: SCHOOL_TICKET_DOMAIN }), true);
});
