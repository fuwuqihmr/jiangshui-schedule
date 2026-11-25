const {chromium}=require('playwright');
const scrub=(u)=>{try{const x=new URL(u);const q=[...x.searchParams.keys()].map(k=>k+'=***');return x.origin+x.pathname+(q.length?'?'+q.join('&'):'');}catch(e){return String(u).slice(0,140);}};
const shapeOf=(v)=>{if(v===null)return 'null';if(Array.isArray(v))return 'array['+v.length+'] of '+shapeOf(v[0]);if(typeof v==='string')return 'str'+v.length;if(typeof v==='number'||typeof v==='boolean')return String(v);if(typeof v==='object'){const k=Object.keys(v);return '{'+k.slice(0,12).map(x=>x+':'+shapeOf(v[x])).join(',')+'}'+(k.length>12?',...':'');}return typeof v;};
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=browser.contexts()[0];
  const page=await ctx.newPage();
  const xhrs=[];
  const isData=(u)=>/\.do(\?|$)|ajax|query|list|kb|schedule|curriculum/i.test(u)&&!/\.(js|css|png|jpg|ico|woff|ttf|svg)(\?|$)/i.test(u);
  page.on('request',r=>{const u=r.url();if(isData(u))xhrs.push('REQ '+scrub(u));});
  page.on('response',async r=>{const u=r.url();if(isData(u)){let shape='';try{const ct=(r.headers()['content-type']||'');if(ct.includes('json')){const j=await r.json();shape=shapeOf(j);}else{const t=await r.text();shape=ct+' textlen'+t.length+' head='+t.replace(/\s+/g,' ').slice(0,80);}}catch(e){shape='ERR '+String(e).slice(0,60);}xhrs.push('RESP '+r.status()+' '+scrub(u)+' :: '+shape);}});
  await page.goto('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(5000);
  console.log(JSON.stringify(xhrs,null,2));
  await page.close();
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
