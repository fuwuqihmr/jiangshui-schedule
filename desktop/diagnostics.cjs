const fs=require('node:fs/promises');
const path=require('node:path');
let writer=()=>{};
function setWriter(next){writer=next;}
function record(event){try{writer(event);}catch{}}
function pageName(url){try{const u=new URL(url);if(u.hostname==='portal.juwp.edu.cn')return 'portal';if(['eapp2.juwp.edu.cn','eapp2.nit.edu.cn'].includes(u.hostname))return 'school-login';if(u.hostname==='jiaowuh5.juwp.edu.cn')return 'mobile-academic';if(u.hostname==='jiaowu.juwp.edu.cn')return u.pathname.startsWith('/jsxsd/xskb/')?'timetable':u.pathname.startsWith('/jsxsd/framework/')?'academic-home':'academic';}catch{}return 'school';}
async function readEvents(folder){try{const file=await fs.open(path.join(folder,'diagnostics.log'),'r');try{const stat=await file.stat(),bytes=Buffer.alloc(Math.min(stat.size,131072));await file.read(bytes,0,bytes.length,Math.max(0,stat.size-bytes.length));return bytes.toString('utf8').split(/\r?\n/).slice(-400);}finally{await file.close();}}catch{return [];}}
module.exports={setWriter,record,pageName,readEvents};
