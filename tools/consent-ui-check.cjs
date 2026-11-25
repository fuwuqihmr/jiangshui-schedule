const {_electron:electron}=require('playwright');const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
(async()=>{const output=process.env.TOMORROW_OUTPUT||path.resolve('../../outputs');await fs.mkdir(output,{recursive:true});
 for(const [name,width,height] of [['电脑',1280,930],['手机',412,900]]){
  const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
  try{const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();}));const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height});await page.locator('#consent-form').waitFor();
   assert.equal(await page.locator('.day-swipe').count(),0);assert.equal(await page.locator('.nav').count(),0);assert.equal(await page.locator('#consent-check').isChecked(),false);assert.equal(await page.locator('#consent-accept').isDisabled(),true);
   for(const action of ['loadState','sync','openSchool','capture','saveState']){const result=await page.evaluate(async a=>{try{await globalThis.native.request(a);return 'allowed';}catch(e){return e.message;}},action);assert.match(result,/请先阅读并同意/);}
   await page.keyboard.press('Escape');assert.equal(await page.locator('#consent-form').count(),1);await page.reload();await page.locator('#consent-form').waitFor();assert.equal(await page.locator('#consent-accept').isDisabled(),true);
   await page.screenshot({path:path.join(output,'用户协议启动页-'+name+'.png'),fullPage:true});
   await page.locator('#consent-check').check();await page.locator('#consent-accept').click();await page.locator('.day-swipe').waitFor();const status=await page.evaluate(()=>globalThis.native.request('consentStatus'));assert.equal(status.version,'2026-10-17.1');assert.ok(status.acceptedAt);
   await page.reload();await page.locator('.day-swipe').waitFor();assert.equal(await page.locator('#consent-form').count(),0);
   await page.getByRole('button',{name:'设置与数据',exact:true}).click();await page.getByRole('button',{name:'查看用户协议与 Cookie 授权',exact:true}).click();await page.locator('.agreement-review').waitFor();assert.match(await page.locator('.agreement-review').innerText(),/学校服务器/);await page.locator('.modal [data-action=close]').last().click();
   await page.getByRole('button',{name:'注销并删除本机数据',exact:true}).click();await page.getByRole('button',{name:'注销并清除',exact:true}).click();await page.locator('#consent-form').waitFor();assert.equal(await page.locator('.day-swipe').count(),0);const revoked=await page.evaluate(()=>globalThis.native.request('consentStatus'));assert.ok(!revoked.version);
   const testDir=await app.evaluate(({app})=>app.getPath('userData'));await fs.writeFile(path.join(testDir,'consent.json'),JSON.stringify({version:'old-version',acceptedAt:new Date().toISOString()}));await page.reload();await page.locator('#consent-form').waitFor();assert.equal(await page.locator('.day-swipe').count(),0);
   assert.deepEqual(errors,[]);
  }finally{await app.close();}
 }
 const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});const page=await app.firstWindow();await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>{w.setPosition(-5000,0);w.showInactive();}));await page.locator('#consent-decline').waitFor();const closing=app.waitForEvent('close');await page.locator('#consent-decline').click();await closing;
 console.log('CONSENT UI PASS: desktop/mobile unchecked gate, IPC blocked, Escape/reload blocked, persisted confirmation, review, revoke, old version blocked, refuse exits.');
})().catch(e=>{console.error(e);process.exitCode=1;});
