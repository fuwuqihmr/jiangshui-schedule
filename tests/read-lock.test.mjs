import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=(name)=>readFileSync(path.join(root,name),'utf8');

test('读取锁真实编译执行：单持有、空编号拒绝、错配不释放、取消/完成可释放',()=>{
  const run=spawnSync(process.execPath,[path.join(root,'tools','android-login-check.cjs')],{cwd:root,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr||run.stdout);
  assert.match(run.stdout,/ANDROID SESSION PASS/);
  assert.match(run.stdout,/start-failure\/read-lock paths work/);
});

test('MainActivity：进行中状态只由 SchoolReadState 持有，所有结束路径都释放',()=>{
  const main=read('android/app/src/main/java/cn/local/tomorrow/MainActivity.java');
  assert.doesNotMatch(main,/activeReadId/,'不得再保留第二份进行中标记');
  assert.match(main,/readState\.begin\(id\)/,'开始读取必须先抢锁');
  assert.match(main,/readState\.finishIf\(id\)/,'失败路径按编号释放');
  assert.match(main,/String leftover=readState\.finishIf\(id\);/,'取消读取必须无条件释放');
  assert.match(main,/readState\.isActive\(\)/,'UI 判断读取中必须读同一把锁');
  assert.match(main,/school_read_start_failed/,'启动异常要有明确失败文案');
  assert.match(main,/onDestroy\(\)\{[\s\S]*?readState\.finish\(\);/,'Activity 销毁必须释放');
  assert.match(main,/readState\.begin\(id\)[^\n]*\n\s*try\{[\s\S]{0,800}catch\(Exception e\)/,'开始读取异常必须被捕获');
});

test('SchoolClient：启动异常、迟到登录与会话占用都不留锁',()=>{
  const client=read('android/app/src/main/java/cn/local/tomorrow/SchoolClient.java');
  assert.match(client,/String candidate=[^;]+;/,'先算候选后再占位');
  assert.match(client,/owner=candidate;/,'只有抢到锁才写 owner');
  assert.match(client,/try\{[\s\S]*?catch\(Exception e\)\{/,'start 全程有异常捕获');
  assert.match(client,/void needLogin\(\)\{if\(id==null\)return;/,'失败后的迟到登录回调必须忽略');
});

test('web 取消读取：本地先结束 waiting，再通知原生，丢回调也不锁死',()=>{
  const app=read('web/app.mjs');
  assert.match(app,/if\(a==='cancel-read'\)\{if\(busy\)\{readEpoch\+\+;endRead\(\);render\(\);\}try\{await call\('cancelRead'\);\}catch\{\}return;\}/);
});
