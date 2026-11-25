const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const pages=[];
  for(const ctx of browser.contexts())for(const p of ctx.pages())pages.push(p);
  const jw=pages.find(p=>p.url().includes('jiaowu.juwp.edu.cn'));
  if(!jw){console.log('NO-JW-PAGE');process.exit(0);}
  const out=await jw.evaluate(async()=>{
    const base='http://jiaowu.juwp.edu.cn:8080/jsxsd';
    const paths=['/xskb/xskb_list.do','/xskb/xskb_list.jsp','/framework/xsMain.jsp','/xk/LoginToXk','/kbcx/xskbcx.do','/jsxsd/xskb/xskb_list.do'];
    const res=[];
    for(const p of paths){
      try{
        const r=await fetch(base+p,{method:'GET',credentials:'include',redirect:'manual'});
        let body='';
        if(r.status===200){const t=await r.text();body=t.slice(0,400);}
        res.push({p,status:r.status,type:r.headers.get('content-type'),len:body.length,hasTable:/kbtable|课程表|课表/i.test(body),head:body.replace(/\s+/g,' ').slice(0,120)});
      }catch(e){res.push({p,err:String(e).slice(0,80)});}
    }
    // 页面结构线索
    const ifr=[...document.querySelectorAll('iframe')].map(f=>f.src);
    const scripts=[...document.querySelectorAll('script[src]')].map(s=>s.src.split('/').pop()).slice(0,20);
    return {res,iframes:ifr,scripts};
  });
  console.log(JSON.stringify(out,null,2));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
