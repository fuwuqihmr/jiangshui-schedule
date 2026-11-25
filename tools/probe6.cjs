const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=browser.contexts()[0];
  const page=await ctx.newPage();
  await page.goto('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?viweType=1',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(1500);
  const out=await page.evaluate(async()=>{
    const body=new URLSearchParams();
    body.set('xnxq01id','2026-2027-1');
    body.set('zc','');
    body.set('kbjcmsid','16FD8C2BE55E15F9E0630100007FF6B5');
    body.set('jc','');
    const r=await fetch('/jsxsd/xskb/xskb_list.do?viweType=1&needData=1',{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body.toString()});
    const txt=await r.text();
    let parsed=null;try{parsed=JSON.parse(txt);}catch(e){}
    const info={status:r.status,rawLen:txt.length,head:txt.slice(0,200)};
    if(parsed){
      const rows=parsed.data||parsed.rows||[];
      info.shape={code:parsed.code,count:parsed.count,dataLen:Array.isArray(rows)?rows.length:null,keys:rows[0]?Object.keys(rows[0]):null};
      if(rows[0]){const r0=rows[0];const sample={};for(const k of Object.keys(r0)){const v=r0[k];if(/gh|id|bh/i.test(k))sample[k]='***';else sample[k]=String(v).slice(0,60);}info.sample0=sample;if(rows[1]){const r1=rows[1];const s2={};for(const k of Object.keys(r1)){const v=r1[k];if(/gh|id|bh/i.test(k))s2[k]='***';else s2[k]=String(v).slice(0,60);}info.sample1=s2;}}
    }
    return info;
  });
  console.log(JSON.stringify(out,null,2));
  await page.close();
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
