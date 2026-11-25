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
    const r=await fetch('/jsxsd/xskb/xskb_list.do?'+p.toString(),{method:'GET',credentials:'include'});
    const txt=await r.text();
    const doc=new DOMParser().parseFromString(txt,'text/html');
    const rows=[...doc.querySelectorAll('tr')].map(tr=>[...tr.querySelectorAll('td,th')].map(c=>(c.textContent||'').replace(/\s+/g,' ').trim()));
    const dataRows=rows.filter(r=>r.length>3);
    return {status:r.status,len:txt.length,rowCount:rows.length,dataRowCount:dataRows.length,
      header:rows[0]?rows[0].slice(0,22):null,
      row1:dataRows[0]?dataRows[0].slice(0,22):null,
      row2:dataRows[1]?dataRows[1].slice(0,22):null,
      scripts:[...doc.querySelectorAll('script')].map(s=>(s.textContent||'').replace(/\s+/g,' ').slice(0,120)).filter(t=>/calendar|xnxq|周|date/i.test(t)).slice(0,6)};
  });
  fs.writeFileSync(__dirname+'/jsxsd-data.html',out&&out.html||'');
  console.log(JSON.stringify(out,null,2));
  await page.close();
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
