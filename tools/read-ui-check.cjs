const {_electron:electron}=require('playwright');
const path=require('path'),fs=require('fs/promises');
(async()=>{
  const out=process.env.TOMORROW_OUTPUT||path.resolve('../../outputs');await fs.mkdir(out,{recursive:true});
  const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
  try{
    const page=await app.firstWindow();await page.locator('#consent-check').check();await page.getByRole('button',{name:'同意并使用',exact:true}).click();await page.waitForSelector('.day-swipe');const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date());if(await page.locator('#day-date').inputValue()!==today)throw Error('Default date is not today');if(!await page.getByRole('heading',{name:'江水课表',exact:true}).count())throw Error('App title missing');
    await app.evaluate(({ipcMain})=>{
      ipcMain.removeHandler('app:request');global.testMode='success';global.readCalls=0;
      ipcMain.handle('app:request',async(_event,action,payload)=>{
        if(action==='saveState'){global.savedTestState=payload.state;return {ok:true};}
        if(['sync','capture','openSchool'].includes(action)){
          global.readCalls++;await new Promise(r=>setTimeout(r,1600));
          if(global.testMode==='fail')throw Error('测试：学校响应超时，保留原课表');
          return {semesterId:'2026-2027-1',totalWeeks:25,rows:[{kc_mc:'合成测试课',jg0101mc:'测试教师',sktime:'周二第3、4节{第5-16周}(全部)',skddmc:'测试教室',jx0404id:'plan-test',kch:'test'}]};
        }return {ok:true};
      });
    });
    await page.getByRole('button',{name:'设置与数据',exact:true}).click();
    await page.getByRole('button',{name:'登录学校门户',exact:true}).click();
    await page.locator('#sync-status [data-state=checking]').waitFor();
    if(!await page.getByRole('button',{name:'读取学校课表',exact:true}).isDisabled())throw Error('Read button not disabled');
    await page.setViewportSize({width:412,height:880});
    await page.screenshot({path:path.join(out,'Android-读取进度预览.png'),fullPage:false});
    await page.getByRole('button',{name:'采用完整学校课表',exact:true}).waitFor();
    await page.getByRole('button',{name:'采用完整学校课表',exact:true}).click();
    await app.evaluate(()=>{global.testMode='fail';});
    await page.getByRole('button',{name:'读取学校课表',exact:true}).click();
    await page.getByText('未能确认最新课表',{exact:true}).waitFor();
    if(!await page.getByText('学校教务系统 · 本机读取',{exact:true}).count())throw Error('Previous source lost after failure');
    await page.screenshot({path:path.join(out,'Android-读取失败预览.png'),fullPage:false});
    const stats=await app.evaluate(()=>({calls:global.readCalls,keptSchool:global.savedTestState?.snapshot.source.kind==='school',error:global.savedTestState?.error}));
    if(stats.calls!==2||!stats.keptSchool||!stats.error)throw Error('Failed persistence/serialization '+JSON.stringify(stats));
    console.log('READ UI PASS: immediate persistent progress, disabled duplicate actions, school adoption, persistent failure with original timetable.');
  }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
