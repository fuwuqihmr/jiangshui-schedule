const {chromium}=require('playwright');
const fs=require('node:fs');
const scrub=(u)=>{try{const x=new URL(u);const q=[...x.searchParams.keys()].map(k=>k+'=***');return x.origin+x.pathname+(q.length?'?'+q.join('&'):'');}catch(e){return String(u).slice(0,140);}};
const hit=(u)=>/jiaowu|ticket|jsxsd|cas|sso|app_portal|enter_app|xskb|LoginToXk/i.test(u);
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const seen=[];
  const watch=(ctx)=>{ctx.on('request',r=>{if(hit(r.url()))seen.push('REQ '+scrub(r.url()));});ctx.on('response',r=>{if(hit(r.url()))seen.push('RESP '+r.status()+' '+scrub(r.url()));});};
  browser.contexts().forEach(watch);
  browser.on('targetcreated',()=>{browser.contexts().forEach(watch);});
  await new Promise(res=>setTimeout(res,150000));
  fs.writeFileSync(__dirname+'/probe-edge-log.json',JSON.stringify(seen,null,2));
  console.log('DONE count='+seen.length);
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
