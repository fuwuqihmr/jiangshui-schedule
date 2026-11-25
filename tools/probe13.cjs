const {chromium}=require('playwright');
const src=require('../desktop/school-source.cjs');
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=browser.contexts()[0];
  const cookies=await ctx.cookies('http://jiaowu.juwp.edu.cn:8080/jsxsd/');
  const bzb=cookies.find(c=>c.name==='bzb_jsxsd');
  if(!bzb){console.log(JSON.stringify({ok:false,err:'no-cookie'}));process.exit(0);}
  const header='bzb_jsxsd='+bzb.value;
  const out={cookiePresent:true};
  // 诊断：直接取页面看结构
  try{
    const r=await fetch('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?viweType=1',{headers:{Cookie:header},redirect:'error',signal:AbortSignal.timeout(20000)});
    const t=await r.text();
    out.pageStatus=r.status;
    out.pageLen=t.length;
    out.hasXnxq=t.includes('xnxq01id');
    out.hasSelected=t.includes('selected');
    out.semesterMatch=/<select[^>]*id="xnxq01id"[\s\S]*?<option value="([^"]+)" selected/.exec(t)?.[1]||null;
    out.kbjcMatch=/<select[^>]*id="kbjcmsid"[\s\S]*?<option value="([^"]+)" selected/.exec(t)?.[1]?true:false;
    out.title=(/<title>([^<]*)<\/title>/.exec(t)||[])[1]||null;
    out.hasLoginForm=/LoginToXk|userAccount/.test(t);
  }catch(e){out.pageErr=String(e.message||e).slice(0,120);}
  // 跑生产读取器
  try{
    const res=await src.fetchJsxsdRows(header);
    out.reader={ok:true,rows:res.rows.length,semesterId:res.semesterId,totalWeeks:res.totalWeeks,
      sample:res.rows.slice(0,2).map(r=>({kc_mc:r.kc_mc,sktime:String(r.sktime||'').slice(0,50),skddmc:r.skddmc}))};
  }catch(e){out.reader={ok:false,err:String(e.message||e).slice(0,160)};}
  console.log(JSON.stringify(out,null,2));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
