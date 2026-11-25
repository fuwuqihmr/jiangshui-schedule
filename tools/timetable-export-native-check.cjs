const {_electron:electron}=require('playwright'),path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{
 const output=path.resolve('D:/ChatGPT/2026-10-10/files-pasted-by-the-user-d/outputs/课表导出-1.1.5-示例'),app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
 try{
  await app.evaluate(({BrowserWindow,dialog},{output})=>{
   BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();});
   global.exportDialogs=[];dialog.showSaveDialog=async(_window,options)=>{global.exportDialogs.push(options);if(global.exportDialogs.length===1)return {canceled:true};return {canceled:false,filePath:output+'/'+(options.defaultPath.endsWith('.png')?'桌面原生保存验证.png':'桌面原生保存验证.pdf')};};
  },{output});
  const page=await app.firstWindow();await page.locator('#consent-check').check();await page.locator('#consent-accept').click();await page.locator('.day-swipe').waitFor();
  await page.evaluate(async()=>{const {createState}=await import('./core.mjs');const snapshot=await (await fetch('./data/adjusted.json')).json();await native.request('saveState',{state:createState(snapshot)});});
  await page.reload();await page.locator('.day-swipe').waitFor();
  await page.getByRole('button',{name:'完整课表',exact:true}).click();
  await page.getByRole('button',{name:'导出这一周',exact:true}).click();await page.locator('#timetable-export-progress').waitFor({state:'detached'});
  await page.getByRole('button',{name:'导出这一周',exact:true}).click();await page.locator('#timetable-export-progress').waitFor({state:'detached'});
  const png=await fs.readFile(path.join(output,'桌面原生保存验证.png'));assert.equal(png.readUInt32BE(16),2520);assert.equal(png.readUInt32BE(20),1782);
  await page.getByRole('button',{name:'导出整个学期',exact:true}).click();await page.getByRole('button',{name:'每周一页（PDF）',exact:true}).click();await page.locator('#timetable-export-progress').waitFor({state:'detached',timeout:90000});
  const pdf=await fs.readFile(path.join(output,'桌面原生保存验证.pdf'));assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  assert.equal((await app.evaluate(()=>global.exportDialogs)).length,3);
  await page.setViewportSize({width:430,height:932});await page.screenshot({path:path.join(output,'手机端导出入口.png'),fullPage:false});
  const extent=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(extent.scroll<=extent.width);
  console.log('NATIVE DESKTOP EXPORT PASS: actual IPC handler, consent gate, save dialog filters, cancel/retry, PNG and PDF bytes written. Mobile entry has no page overflow.');
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
