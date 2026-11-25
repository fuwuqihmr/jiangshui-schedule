const {chromium}=require('playwright');
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=browser.contexts()[0];
  const cookies=await ctx.cookies('http://jiaowu.juwp.edu.cn:8080/jsxsd/');
  const header='bzb_jsxsd='+cookies.find(c=>c.name==='bzb_jsxsd').value;
  const r=await fetch('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?viweType=1',{headers:{Cookie:header},redirect:'error',signal:AbortSignal.timeout(20000)});
  const t=await r.text();
  const around=(kw,len=420)=>{const i=t.indexOf(kw);return i<0?'NOT FOUND':t.slice(Math.max(0,i-80),i+len).replace(/\s+/g,' ');};
  const selBlock=(id)=>{const m=new RegExp('<select[^>]*id="'+id+'"[\\s\\S]*?</select>').exec(t);if(!m)return null;const opts=[...m[0].matchAll(/<option([^>]*)>/g)].map(o=>o[1].replace(/\s+/g,' ').trim()).slice(0,12);return {opts};};
  console.log(JSON.stringify({
    len:t.length,
    xnxqBlock:selBlock('xnxq01id'),
    kbjBlock:selBlock('kbjcmsid'),
    xnxqAround:around('id="xnxq01id"'),
    kbjAround:around('id="kbjcmsid"',260)
  },null,2));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
