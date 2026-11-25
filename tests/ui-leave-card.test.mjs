import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

test('手动销假二次确认：取消在左，危险确认在右', () => {
  const start = app.indexOf("if(a==='manual-cancel'||a==='manual-cancel-undo')");
  const end = app.indexOf("if(a==='manual-cancel-confirm'||", start);
  assert.ok(start >= 0 && end > start, '应能定位手动销假确认弹窗');
  const block = app.slice(start, end);
  for (const [name, action] of [['标记', 'manual-cancel-confirm'], ['撤销', 'manual-cancel-undo-confirm']]) {
    const close = block.indexOf('data-action="close"');
    const danger = block.indexOf(`data-action="${action}"`);
    assert.ok(close >= 0 && danger >= 0, `${name}弹窗应有取消与危险确认按钮`);
    assert.ok(close < danger, `${name}弹窗必须取消在左、危险确认在右`);
  }
});

test('假条详情操作区吸底常驻，不滚动即可见', () => {
  assert.match(app, /class="actions leave-detail-actions"/);
  assert.match(css, /\.modal \.actions\.leave-detail-actions\{[^}]*position:sticky[^}]*bottom:0/);
});

test('假条卡头与页脚使用同一缓存时间字段', () => {
  const start = app.indexOf('function leaveUpdatedLabel()');
  const end = app.indexOf('\n', start);
  const fn = app.slice(start, end);
  assert.ok(fn.includes('displayState().lastSuccess'), '卡头应使用 state.lastSuccess');
  assert.ok(!fn.includes('leaveView.fetchedAt'), '卡头不应再使用 leaveView.fetchedAt');
  assert.ok(app.includes("数据截至 '+stamp(state.lastSuccess)"), '页脚应使用 state.lastSuccess');
});
