// Reads only grade/cohort metadata from labelled fields and links supplied by the school page.
(async()=>{
 const out=window.__jiangshuiProfile={done:false,profile:null};
 const parse=doc=>{
  const entries=[];
  for(const cell of doc.querySelectorAll('td,th,dt,label')){
   const label=(cell.textContent||'').replace(/\s/g,'');
   if(/^(?:年级|入学年份|入学年度|入学年|入学日期|入学时间)[:：]?$/.test(label)){
    const next=cell.nextElementSibling;
    let value=(next?.textContent||'').trim();
    const input=next?.querySelector('input,select');if(input)value=input.value;
    if(cell.tagName==='LABEL'&&cell.htmlFor)value=doc.getElementById(cell.htmlFor)?.value||value;
    entries.push({label,value});
   }
  }
  const text=(doc.body?.innerText||doc.body?.textContent||'').slice(0,150000);
  const hit=/(?:年级|入学年份|入学年度|入学年|入学日期|入学时间)\s*[:：]?\s*((?:20\d{2})(?:级|年)?|大[一二三四五]|[一二三四五]年级)/.exec(text);
  if(hit)entries.push({label:hit[0].replace(hit[1],''),value:hit[1]});
  for(const entry of entries){
   const cohort=/^(20\d{2})(?:级|年|[-/.].*)?$/.exec(entry.value.trim());
   if(cohort)return {enrollmentYear:Number(cohort[1]),sourceLabel:'学校教务个人信息 · 年级',checkedAt:new Date().toISOString()};
   const grade=/^大([一二三四五])$|^([一二三四五])年级$/.exec(entry.value.trim());
   if(grade){const now=new Date(),year=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric'}).format(now)),month=Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',month:'numeric'}).format(now));return {grade:'一二三四五'.indexOf(grade[1]||grade[2])+1,academicYear:month>=9?year:year-1,sourceLabel:'学校教务个人信息 · 年级',checkedAt:now.toISOString()};}
  }
  return null;
 };
 try{
  out.profile=parse(document);
  const links=[];
  for(const a of document.querySelectorAll('a')){
   const title=(a.textContent||a.title||'').trim();if(!/个人信息|学籍信息|基本信息|个人资料/.test(title))continue;
   let href=a.getAttribute('href')||'';
   if(!href||href.startsWith('javascript:')){const code=a.getAttribute('onclick')||href;const m=code.match(/["']([^"']*\/jsxsd\/[^"']+)["']/);if(m)href=m[1];}
   try{const u=new URL(href,location.href);if(u.origin===location.origin&&u.pathname.startsWith('/jsxsd/')&&!/save|delete|submit|insert|update/i.test(u.pathname))links.push(u.href);}catch{}
  }
  out.linkCount=links.length;
  if(!out.profile&&links[0]){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
   try{const r=await fetch(links[0],{credentials:'include',signal:controller.signal});if(r.ok){const doc=new DOMParser().parseFromString(await r.text(),'text/html');out.profile=parse(doc);out.path=new URL(links[0]).pathname;}}finally{clearTimeout(timer);}
  }
 }catch{out.error='年级暂未识别';}
 out.done=true;
})();
