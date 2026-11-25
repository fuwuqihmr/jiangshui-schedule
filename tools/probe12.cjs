const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=browser.contexts()[0];
  const page=await ctx.newPage();
  await page.goto('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?viweType=1',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1200);
  const rows=await page.evaluate(async()=>{
    const p=new URLSearchParams();
    p.set('viweType','1');p.set('demoStr','');p.set('needData','1');p.set('baseUrl','/jsxsd');p.set('sfykb','2');
    p.set('xsflMapListJsonStr','理论学时,实践学时,讲座学时,实验学时,');
    p.set('xnxq01id','2026-2027-1');p.set('zc','');p.set('kbjcmsid','16FD8C2BE55E15F9E0630100007FF6B5');
    p.set('pageNum','1');p.set('pageSize','500');
    const r=await fetch('/jsxsd/xskb/xskb_list.do?'+p.toString(),{method:'GET',credentials:'include'});
    const j=await r.json();
    return (j.data||[]).map(x=>{const o={};for(const k of ['kc_mc','jg0101mc','sktime','skddmc','kch','jx0404id'])if(x[k]!=null)o[k]=x[k];return o;});
  });
  fs.writeFileSync(__dirname+'/jsxsd-rows.json',JSON.stringify(rows,null,2));
  console.log('saved rows='+rows.length);
  await page.close();
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
