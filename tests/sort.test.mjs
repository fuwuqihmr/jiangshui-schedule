import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cmp, cmpText, zhCollator} from '../web/sort.mjs';

// 排序语义唯一出口 web/sort.mjs 的单测（1.5.0 D-2 / task-65）。
// 语义：中文自由文本 → 显式 zh-Hans-CN（拼音序、不带 numeric）；技术键/日期/时间 → UTF-16 码元序；
// 无 ICU → zhCollator 为 null、cmpText 降级码元序（确定性兜底）。
const collatorSupported = zhCollator !== null;

test('cmp：UTF-16 码元比较（与 Java String.compareTo 同口径）', () => {
 assert.equal(cmp('A','a'),-1,'A(65) < a(97)，大小写不折叠');
 assert.equal(cmp('10','2'),-1,'数字串按码元比较，不按数值');
 assert.equal(cmp('—','A101'),1,'U+2014(8212) > A(65)，与 en-US collator 相反');
 assert.equal(cmp('a','中'),-1,'97 < U+4E2D(20013)');
 assert.equal(cmp('same','same'),0);
 assert.equal(cmp(null,''),0,'null 按空串');
 assert.equal(cmp(undefined,'x'),-1,'undefined 按空串');
 assert.deepEqual(['a','A','_','0','-'].sort(cmp),['-','0','A','_','a'],'码元升序与 Java 口径一致');
});

test('cmpText：显式 zh-Hans-CN 拼音序（不带 numeric）', () => {
 if(!collatorSupported)return; // 无 ICU 环境由「降级」用例覆盖
 assert.equal(zhCollator instanceof Intl.Collator,true,'zhCollator 必须是缓存的 Collator 实例');
 assert(cmpText('高等数学','人工智能导论')<0,'gao < ren（码元序相反）');
 assert(cmpText('杜老师','李老师')<0,'du < li（码元序相反）');
 assert(cmpText('实验楼','A101')<0,'中文习惯：汉字排在拉丁字母前');
 assert(cmpText('a','中')>0,'拼音序把汉字排在拉丁字母前，与码元序相反');
 assert(cmpText('大学英语10','大学英语2')<0,'不带 numeric：10 仍在 2 前（维持现状，自然序需另拍板）');
 assert.deepEqual(['人工智能导论','高等数学','单周课程'].sort(cmpText),['单周课程','高等数学','人工智能导论'],'拼音序固定值');
});

test('cmpText 不跟随运行环境默认 locale：把默认 localeCompare 钉为 en-US 后结果不变', () => {
 if(!collatorSupported)return;
 const original=String.prototype.localeCompare,en=new Intl.Collator('en-US');
 String.prototype.localeCompare=function(other,locales,options){
  if(locales===undefined&&options===undefined)return en.compare(String(this),String(other));
  return original.call(this,other,locales,options);
 };
 try{
  assert.deepEqual(['人工智能导论','高等数学','单周课程'].sort(cmpText),['单周课程','高等数学','人工智能导论'],'显式 zh-Hans-CN 不受默认 locale 影响');
  assert(cmpText('实验楼','A101')<0);
 }finally{String.prototype.localeCompare=original;}
});

test('无 ICU 环境（Intl 不可用）：zhCollator 为 null，cmpText 降级码元序且不抛错', () => {
 const moduleUrl=new URL('../web/sort.mjs',import.meta.url).href;
 const script='globalThis.Intl=undefined;const m=await import('+JSON.stringify(moduleUrl)+');'
  +'console.log(JSON.stringify({zhCollator:m.zhCollator,text:m.cmpText("高等数学","人工智能导论"),'
  +'codeUnit:m.cmp("高等数学","人工智能导论"),empty:m.cmpText(null,undefined),mixed:m.cmpText("实验楼","A101")}));';
 const out=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
 assert.equal(out.status,0,out.stderr||out.stdout);
 const result=JSON.parse(out.stdout.trim());
 assert.equal(result.zhCollator,null,'无 Intl 时模块加载不得抛错，zhCollator 为 null');
 assert.equal(result.text,result.codeUnit,'降级分支：cmpText 必须与 cmp 完全一致');
 assert.equal(result.empty,0);
 assert.equal(result.mixed,1,'降级后 实验楼 vs A101 为码元序');
});
