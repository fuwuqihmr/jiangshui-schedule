const {chromium}=require('playwright');
function selectedOption(html,id){
  const block=new RegExp('<select[^>]*id="'+id+'"[\\s\\S]*?</select>').exec(html);
  if(!block)return null;
  const m=/<option[^>]*selected[^>]*value="([^"]+)"/.exec(block[0])||/<option[^>]*value="([^"]+)"[^>]*selected/.exec(block[0]);
  return m?m[1]:null;
}
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=browser.contexts()[0];
  const cookies=await ctx.cookies('http://jiaowu.juwp.edu.cn:8080/jsxsd/');
  const header='bzb_jsxsd='+cookies.find(c=>c.name==='bzb_jsxsd').value;
  const r=await fetch('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?viweType=1',{headers:{Cookie:header},redirect:'error',signal:AbortSignal.timeout(20000)});
  const t=await r.text();
  const sem=selectedOption(t,'xnxq01id'), kbj=selectedOption(t,'kbjcmsid');
  const old=/<select[^>]*id="xnxq01id"[\s\S]*?<option value="([^"]+)" selected/.exec(t);
  const out={sem,kbj,oldMatch:old?old[1]:null,oldIndex:old?old.index:null,selectCount:(t.match(/<select/g)||[]).length};
  if(sem){
    const z=await fetch('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/jxzlzc_xnxq_ajax?xnxq01id='+encodeURIComponent(sem),{headers:{Cookie:header},redirect:'error',signal:AbortSignal.timeout(20000)});
    out.zcStatus=z.status;out.zcBody=(await z.text()).slice(0,120);
    const p=new URLSearchParams({viweType:'1',demoStr:'',needData:'1',baseUrl:'/jsxsd',sfykb:'2',xsflMapListJsonStr:'理论学时,实践学时,讲座学时,实验学时,',xnxq01id:sem,zc:'',kbjcmsid:kbj,pageNum:'1',pageSize:'500'});
    const d=await fetch('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?'+p.toString(),{headers:{Cookie:header},redirect:'error',signal:AbortSignal.timeout(20000)});
    const j=await d.json().catch(()=>null);
    out.dataStatus=d.status;out.dataCount=j&&j.data?j.data.length:null;
    if(j&&j.data&&j.data[0])out.sampleRow={kc_mc:j.data[0].kc_mc,sktime:String(j.data[0].sktime||'').slice(0,60),skddmc:j.data[0].skddmc,jg0101mc:j.data[0].jg0101mc};
  }
  console.log(JSON.stringify(out,null,2));
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
