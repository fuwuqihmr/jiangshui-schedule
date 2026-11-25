const {chromium}=require('playwright');
const scrub=(u)=>{try{const x=new URL(u);const q=[...x.searchParams.keys()].map(k=>k+'=***');return x.origin+x.pathname+(q.length?'?'+q.join('&'):'');}catch(e){return String(u).slice(0,140);}};
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=browser.contexts()[0];
  const page=await ctx.newPage();
  const hits=[];
  page.on('request',r=>{const u=r.url();if(/needData/.test(u))hits.push('REQ '+r.method()+' '+scrub(u));});
  page.on('response',async r=>{const u=r.url();if(/needData/.test(u)){let head='';try{const t=await r.text();head=t.replace(/\s+/g,' ').slice(0,200);}catch(e){head='ERR';}hits.push('RESP '+r.status()+' len?'+' :: '+head);}});
  await page.goto('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?viweType=1',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  const clicked=await page.evaluate(()=>{
    const btn=document.querySelector('button[lay-submit]');
    if(btn){btn.click();return 'clicked';}
    return 'no-btn';
  });
  await page.waitForTimeout(3500);
  console.log(JSON.stringify({clicked,hits},null,2));
  await page.close();
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
