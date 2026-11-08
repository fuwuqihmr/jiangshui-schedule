const path = require('node:path');
(async()=>{
  const {packager}=require('@electron/packager');
  const root=path.resolve(__dirname,'..');
  const output=path.resolve(process.argv[2]||process.env.JIANGSHUI_OUTPUT||path.resolve(root,'../../outputs'));
  const appPaths=await packager({dir:root,name:'JiangshuiSchedule',platform:'win32',arch:'x64',out:path.join(output,'windows-1.1.9-rc1'),overwrite:true,prune:true,asar:true,icon:path.join(root,'assets/app-icon.ico'),electronZipDir:path.resolve(root,'../toolchain'),ignore:[/^\/android(?:\/|$)/,/^\/tests(?:\/|$)/,/^\/tools(?:\/|$)/,/^\/DECISIONS\.md$/]});
  console.log('Windows package:',appPaths[0]);
})().catch(error=>{console.error(error);process.exitCode=1;});
