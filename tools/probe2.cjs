const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const pages=[];
  for(const ctx of browser.contexts())for(const p of ctx.pages())pages.push(p);
  const jw=pages.find(p=>p.url().includes('jiaowu.juwp.edu.cn'));
  if(!jw){console.log('NO-JW-PAGE');process.exit(0);}
  const info=await jw.evaluate(()=>{
    const links=[...document.querySelectorAll('a')].map(a=>({t:(a.textContent||'').replace(/\s+/g,'').slice(0,20),href:a.getAttribute('href')||''}));
    const kb=links.filter(l=>/课表|xskb|kb/i.test(l.t)||/xskb|kbcx/i.test(l.href));
    const menus=[...document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')).filter(h=>/do$|\.do|\.htmlx|frame/i.test(h||''));
    return {title:document.title,url:location.href,kbLinks:kb.slice(0,30),menuSample:menus.slice(0,40)};
  });
  console.log(JSON.stringify(info,null,2));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
