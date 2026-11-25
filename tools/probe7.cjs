const {chromium}=require('playwright');
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
    p.set('page','1');p.set('limit','100');
    const r=await fetch('/jsxsd/xskb/xskb_list.do?'+p.toString(),{method:'GET',credentials:'include'});
    const txt=await r.text();
    let parsed=null;try{parsed=JSON.parse(txt.replace(/^\uFEFF/,'').trim());}catch(e){}
    const info={status:r.status,rawLen:txt.length,head:txt.replace(/\s+/g,' ').slice(0,150)};
    if(parsed){
      const rows=parsed.data||[];
      info.shape={code:parsed.code,msg:parsed.msg,count:parsed.count,dataLen:rows.length,keys:rows[0]?Object.keys(rows[0]):null};
      if(rows[0]){const s={};for(const k of Object.keys(rows[0])){const v=rows[0][k];if(/gh$|id$|bh$|xh$/i.test(k))s[k]='***';else s[k]=String(v).slice(0,70);}info.sample0=s;}
      if(rows[1]){const s={};for(const k of Object.keys(rows[1])){const v=rows[1][k];if(/gh$|id$|bh$|xh$/i.test(k))s[k]='***';else s[k]=String(v).slice(0,70);}info.sample1=s;}
    }
    return info;
  });
  console.log(JSON.stringify(out,null,2));
  await page.close();
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
