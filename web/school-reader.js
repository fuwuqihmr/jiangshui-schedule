// Runs only inside the authenticated timetable origin. All requests are read-only and serial.
(async () => {
  const id = window.__tomorrowRequestId;
  const result = window.__tomorrowRead = {id, stage: 'weeks', done: false};
  window.__tomorrowAbort?.abort();
  const controller = window.__tomorrowAbort = new AbortController();
  const current = () => window.__tomorrowRead === result && !controller.signal.aborted;
  const finish = data => { if (current()) Object.assign(result, data, {done: true}); };
  const loginPage = text => {
    if (/<input[^>]+(?:type=["']?password|name=["']?userAccount)/i.test(text)) return true;
    try {
      const payload=JSON.parse(text);
      // The school returns {flag1:2,msgContent:...} when a server session expires,
      // and {flag1:3,msgContent:"您的账号在其它地方登录"} when the same account signs in
      // elsewhere (single-session kick). Both mean this session can no longer read, so
      // both must go through SSO again instead of looking like a format error.
      if (!payload || typeof payload!=='object' || Array.isArray(payload)) return false;
      const code=Number(payload.flag1);
      return (code===2||code===3) && typeof payload.msgContent==='string';
    } catch { return false; }
  };
  let networkTimer;
  const read = async url => {
    networkTimer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, {credentials:'include', signal:controller.signal, cache:'no-store'});
      if (!response.ok) {if(response.status===401)throw Object.assign(Error('学校会话已失效'),{login:true});throw Object.assign(Error('学校课表接口返回 HTTP '+response.status+'，原课表已保留。可在设置页导出排查日志'),{httpStatus:response.status,kind:'http'});}
      const text = await response.text();
      if (loginPage(text)) throw Object.assign(Error('学校会话已失效'), {login:true});
      return text;
    } finally { clearTimeout(networkTimer); }
  };
  try {
    if (location.origin !== 'http://jiaowu.juwp.edu.cn:8080' || !location.pathname.startsWith('/jsxsd/xskb/')) throw Error('读取页面来源不符，已保留上次课表');
    if (document.querySelector('input[type=password],input[name=userAccount]') || loginPage(document.body?.innerText||'')) { finish({login:true}); return; }
    const sem=document.getElementById('xnxq01id')?.value, mode=document.getElementById('kbjcmsid')?.value;
    if (!sem || !mode) throw Error('课表页面结构变化，已保留上次课表');
    const cached=window.__tomorrowCalendar;
    let weeks, calendarCached=false;
    if (cached?.sem===sem && cached.mode===mode && Date.now()-cached.at<600000) { weeks=cached.weeks; calendarCached=true; }
    else {
      const calendar=JSON.parse(await read('/jsxsd/xskb/jxzlzc_xnxq_ajax?xnxq01id='+encodeURIComponent(sem)));
      weeks=Number(calendar?.[0]?.jszc);
      if (!Number.isInteger(weeks)||weeks<1||weeks>60) throw Error('教学周结构不完整，已保留上次课表');
    }
    if (!current()) return;
    result.stage='courses';
    const params=new URLSearchParams({viweType:'1',demoStr:'',needData:'1',baseUrl:'/jsxsd',sfykb:'2',pageNum:'1',pageSize:'500',xsflMapListJsonStr:'理论学时,实践学时,讲座学时,实验学时,',xnxq01id:sem,zc:'',kbjcmsid:mode});
    const data=JSON.parse(await read('/jsxsd/xskb/xskb_list.do?'+params));
    if (!Array.isArray(data.data)||!data.data.length||data.code!==0) throw Error('学校课表数据不完整，已保留上次课表');
    const rows=data.data.map(r=>({kc_mc:r.kc_mc,jg0101mc:r.jg0101mc,sktime:r.sktime,skddmc:r.skddmc,jx0404id:r.jx0404id,kch:r.kch}));
    if (current()) {window.__tomorrowCalendar={sem,mode,weeks,at:Date.now()};finish({sem,weeks,rows,calendarCached,modeKnown:!!mode});}
  } catch (error) {
    if (window.__tomorrowRead !== result) return;
    Object.assign(result,{done:true,login:!!error.login,httpStatus:Number(error.httpStatus)||0,kind:error.kind|| (error.login?'session':error.name==='AbortError'?'timeout':error.name==='SyntaxError'?'format':'other'),error:error.name==='AbortError'?'学校响应超时或读取已取消，保留上次课表':error.name==='SyntaxError'?'学校响应格式变化，已保留上次课表':error.message});
  }
})();

