// 学校数据读取层：仅负责 HTTP，结构化解析在 web/jsxsd.mjs / web/school.mjs。
// 实测接口（2026-10-09 实测，登录门户后经 SSO 进入教务系统）：
//   会话 cookie：bzb_jsxsd（主机 jiaowu.juwp.edu.cn:8080，Path=/jsxsd）
//   学期与节次模式：页面 /jsxsd/xskb/xskb_list.do?viweType=1 内 selected option
//   教学周范围：GET /jsxsd/xskb/jxzlzc_xnxq_ajax?xnxq01id=<学期> → [{qszc,jszc}]
//   课表数据：GET /jsxsd/xskb/xskb_list.do?viweType=1&needData=1&pageNum=1&pageSize=500&... → {code:0,data:[rows]}
const {record}=require('./diagnostics.cjs');
const ROOT='http://jiaowu.juwp.edu.cn:8080/jsxsd';
function selectedOption(html,id){ // 先取 select 块，再在块内找 selected 选项，避免跨 select 误匹配
  const block=new RegExp('<select[^>]*id="'+id+'"[\\s\\S]*?</select>').exec(html);
  if(!block)return null;
  const m=/<option[^>]*selected[^>]*value="([^"]+)"/.exec(block[0])||/<option[^>]*value="([^"]+)"[^>]*selected/.exec(block[0]);
  return m?m[1]:null;
}
async function httpGet(path,query,cookie){const r=await fetch(ROOT+path+(query||''),{headers:{'Cookie':cookie},redirect:'error',signal:AbortSignal.timeout(20000)});record('desktop-read step='+(path.includes('jxzlzc')?'weeks':query&&query.includes('needData=1')?'courses':'page')+' status='+r.status);if(!r.ok)throw Error('学校课表接口返回 HTTP '+r.status+'，原课表已保留。可在设置页导出排查日志');return await r.text();}
async function fetchJsxsdRows(cookie){
  if(!cookie)throw Error('请先登录门户，进入教务系统后再读取');
  const page=await httpGet('/xskb/xskb_list.do','?viweType=1',cookie);
  const semesterId=selectedOption(page,'xnxq01id'),kbjcmsid=selectedOption(page,'kbjcmsid');
  if(!semesterId||!kbjcmsid)throw Error('学校课表页面结构变化，请重新确认');
  const zcTxt=await httpGet('/xskb/jxzlzc_xnxq_ajax','?xnxq01id='+encodeURIComponent(semesterId),cookie);
  let totalWeeks=0;try{const zc=JSON.parse(zcTxt);totalWeeks=Number(zc[0]&&zc[0].jszc);}catch{}
  if(!Number.isInteger(totalWeeks)||totalWeeks<1)throw Error('教学周结构不完整');
  const q=new URLSearchParams({viweType:'1',demoStr:'',needData:'1',baseUrl:'/jsxsd',sfykb:'2','xsflMapListJsonStr':'理论学时,实践学时,讲座学时,实验学时,',xnxq01id:semesterId,zc:'',kbjcmsid,pageNum:'1',pageSize:'500'});
  const dataTxt=await httpGet('/xskb/xskb_list.do','?'+q.toString(),cookie);
  let rows=null;try{rows=JSON.parse(dataTxt).data;}catch{}
  if(!Array.isArray(rows))throw Error('学校会话已失效或响应结构变化，请重新登录');
  return {rows,semesterId,totalWeeks};
}
// —— 移动教务备用通道（token 头，公开前端定位，尚未用真实会话验证）——
const MROOT='http://jiaowuh5.juwp.edu.cn/njwhd';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchBundle(token){
  if(!token)throw Error('请先登录移动教务');
  async function request(path,query=''){const r=await fetch(MROOT+path+query,{method:'POST',headers:{token},redirect:'error',signal:AbortSignal.timeout(20000)});record('desktop-read step='+(path==='/teachingWeek'?'mobile-weeks':path==='/Get_sjkbms'?'mobile-modes':'mobile-courses')+' status='+r.status);if(!r.ok)throw Error('学校课表接口返回 HTTP '+r.status+'，原课表已保留。可在设置页导出排查日志');const data=await r.json();if(!Array.isArray(data.data))throw Error('学校会话已失效或响应结构变化，请重新登录');return data.data;}
  const teaching=await request('/teachingWeek');await sleep(700);const modes=await request('/Get_sjkbms');const mode=modes.find(x=>Number(x.mrms)===1);if(!mode?.kbjcmsid)throw Error('学校默认节次模式未知');
  const nums=teaching.map(x=>Number(x.week)).sort((a,b)=>a-b);if(nums.length<1||nums.length>60||nums.some((x,i)=>x!==i+1))throw Error('教学周结构不完整');const weeks=[];
  for(const week of nums){await sleep(700);const data=await request('/student/curriculum',`?week=${week}&kbjcmsid=${encodeURIComponent(mode.kbjcmsid)}`);if(data.length!==1||!Array.isArray(data[0].item)||!Array.isArray(data[0].date))throw Error('周课表结构未知');const r=data[0];weeks.push({week:r.week,date:r.date.map(d=>({mxrq:d.mxrq,xqmc:d.xqmc})),item:r.item.map(i=>Object.fromEntries(['classTime','courseName','teacherName','location','startTime','endTIme','classWeek','jx0408id'].map(k=>[k,i[k]])))});}
  return {weeks};
}
module.exports={fetchJsxsdRows,fetchBundle};
