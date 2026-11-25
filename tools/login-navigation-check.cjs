const {_electron:electron}=require('playwright');
const path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const app=await electron.launch({args:[path.resolve('.')],env:{...process.env,TOMORROW_TEST:'1'}});
 let exited=false;
 try{
  const main=await app.firstWindow();await main.locator('#consent-check').check();await main.getByRole('button',{name:'同意并使用',exact:true}).click();
  await app.evaluate(({session,BrowserWindow})=>{
   BrowserWindow.getAllWindows().forEach(w=>w.setPosition(-5000,0));global.loginFixtureAuthenticated=false;global.loginFixturePosts=0;
   session.fromPartition('school-memory').protocol.handle('http',async request=>{
    const url=new URL(request.url),headers={'content-type':'text/html; charset=utf-8'};
    if(url.hostname==='eapp2.juwp.edu.cn'){
     let error='';if(request.method==='POST'){global.loginFixturePosts++;const fields=new URLSearchParams(await request.text());if(fields.get('password')==='correct-fixture'){global.loginFixtureAuthenticated=true;return new Response('<script>location="http://portal.juwp.edu.cn/"</script>',{headers});}error='<p id="school-error">学校原生提示：用户名或密码错误</p>';}
     return new Response('<form method="post" action="http://eapp2.juwp.edu.cn/cas/login"><input name="username" value="fixture"><input name="password" type="password"><button>登录</button></form>'+error,{status:error?401:200,headers});
    }
    if(url.hostname==='portal.juwp.edu.cn')return new Response(global.loginFixtureAuthenticated?'<a href="http://jiaowu.juwp.edu.cn:8080/jsxsd/framework/xsMainV.htmlx">教务系统</a>':'<script>location="http://eapp2.juwp.edu.cn/cas/login"</script>',{headers});
    if(url.hostname==='jiaowu.juwp.edu.cn')return new Response('<h1>合成教务页面</h1>',{headers});
    return new Response('',{status:404});
   });
  });
  const next=app.waitForEvent('window');await main.evaluate(()=>window.native.request('openSchool'));const login=await next;
  await login.locator('input[type=password]').waitFor();
  const visible=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle().startsWith('学校登录'))?.isVisible());
  assert.equal(await visible(),true);
  for(let attempt=0;attempt<2;attempt++){
   await login.locator('input[type=password]').fill('wrong-fixture');await login.getByRole('button',{name:'登录',exact:true}).click();await login.locator('#school-error').waitFor();
   assert.equal(await visible(),true);assert.match(await login.locator('#school-error').innerText(),/学校原生提示/);
   assert.equal(await login.locator('#jiangshui-login-error').count(),0);assert.equal(await login.evaluate(()=>Boolean(window.__jiangshuiLoginMonitor)),false);
  }
  await login.locator('input[type=password]').fill('correct-fixture');await login.getByRole('button',{name:'登录',exact:true}).click();await login.getByRole('heading',{name:'合成教务页面'}).waitFor();
  assert.equal(await visible(),false);assert.equal(await app.evaluate(()=>global.loginFixturePosts),3);
  await main.evaluate(()=>window.native.request('openSchool'));assert.equal(await visible(),true);
  await Promise.all([app.waitForEvent('close'),app.evaluate(({BrowserWindow})=>setTimeout(()=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='江水课表')?.close(),25))]);exited=true;
  console.log('LOGIN NAVIGATION PASS: repeated HTTP 401 preserves school errors; no injected password hints; portal success hides login; hidden school window can reopen.');
 }finally{if(!exited)await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
