const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
  const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx=browser.contexts()[0];
  const page=await ctx.newPage();
  await page.goto('http://jiaowu.juwp.edu.cn:8080/jsxsd/xskb/xskb_list.do?viweType=1',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2000);
  const html=await page.content();
  fs.writeFileSync(__dirname+'/jsxsd-kb.html',html);
  const info=await page.evaluate(()=>{
    const sel=[...document.querySelectorAll('select')].map(s=>({name:s.name,id:s.id,options:[...s.options].slice(0,8).map(o=>({v:o.value,t:(o.textContent||'').trim().slice(0,20)}))}));
    const tables=[...document.querySelectorAll('table')].map(t=>({id:t.id,cls:String(t.className).slice(0,60),rows:t.rows.length,cells:t.rows.length?(t.rows[0].cells.length):0}));
    const kbTable=document.querySelector('#kbtable')||document.querySelector('table[class*=kb]')||tables[0];
    let sample=null;
    const trs=[...document.querySelectorAll('table tr')];
    for(const tr of trs){const cells=[...tr.querySelectorAll('td,th')];for(const c of cells){const t=(c.textContent||'').replace(/\s+/g,' ').trim();if(t.length>8&&t.length<200&&/[\u4e00-\u9fa5]/.test(t)){sample={cellText:t.slice(0,150),cellHtml:c.innerHTML.replace(/\s+/g,' ').slice(0,400),row:tr.rowIndex,col:c.cellIndex};break;}}if(sample)break;}
    return {title:document.title,selects:sel,tables,sample};
  });
  console.log(JSON.stringify(info,null,2));
  await page.close();
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
