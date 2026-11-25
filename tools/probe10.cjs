const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=browser.contexts()[0];
  const page=await ctx.newPage();
  await page.goto('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?viweType=1',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1200);
  const out=await page.evaluate(async()=>{
    const p=new URLSearchParams();
    p.set('viweType','1');p.set('demoStr','');p.set('needData','1');p.set('baseUrl','/jsxsd');p.set('sfykb','2');
    p.set('xsflMapListJsonStr','理论学时,实践学时,讲座学时,实验学时,');
    p.set('xnxq01id','2026-2027-1');p.set('zc','');p.set('kbjcmsid','16FD8C2BE55E15F9E0630100007FF6B5');
    p.set('pageNum','1');p.set('pageSize','500');
    const r=await fetch('/jsxsd/xskb/xskb_list.do?'+p.toString(),{method:'GET',credentials:'include'});
    const txt=await r.text();
    let parsed=null;try{parsed=JSON.parse(txt.trim());}catch(e){}
    if(!parsed)return {status:r.status,head:txt.replace(/\s+/g,' ').slice(0,150)};
    const rows=parsed.data||[];
    const mask=(k,v)=>/gh$|id$|bh$|xh$/i.test(k)?'***':String(v).slice(0,80);
    const samples=rows.slice(0,3).map(r=>{const s={};for(const k of Object.keys(r))s[k]=mask(k,r[k]);return s;});
    const keys=rows[0]?Object.keys(rows[0]):[];
    const allTimes=[...new Set(rows.map(r=>String(r.sktime||'')))].slice(0,12);
    const allDays=[...new Set(rows.map(r=>String(r.skxqmc||'')))];
    return {status:r.status,code:parsed.code,msg:parsed.msg,countField:parsed.count,dataLen:rows.length,keys,allDays,sampleTimes:allTimes,samples};
  });
  console.log(JSON.stringify(out,null,2));
  await page.close();
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
