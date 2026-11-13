import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseVersion,compareVersions,isNewer,normalizeUpdateInfo,normalizeRelease,releaseTitle,releaseTag,updateErrorText,releaseNotes,formatUpdateSize} from '../web/update.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('版本标签只接受 v?X.Y.Z 与可选预发布后缀',()=>{
  assert.deepEqual(parseVersion('v1.3.3-rc1'),{major:1,minor:3,patch:3,pre:'rc1',value:'1.3.3-rc1'});
  assert.deepEqual(parseVersion('1.3.3'),{major:1,minor:3,patch:3,pre:null,value:'1.3.3'});
  assert.deepEqual(parseVersion('  v2.0.0  '),{major:2,minor:0,patch:0,pre:null,value:'2.0.0'});
  for(const value of ['1.3','v1.3.3.4','1.3.3-','release-1.3.3','v1.3.3-rc_1','',null,1.3,undefined]) assert.equal(parseVersion(value),null,String(value));
  assert.equal(parseVersion('1'.repeat(81)),null);
});

test('正式版高于预发布，rc 数字按数值比较',()=>{
  assert.equal(compareVersions('v1.3.3','v1.3.3-rc1'),1);
  assert.equal(compareVersions('1.3.3-rc1','1.3.3'),-1);
  assert.equal(compareVersions('1.3.3-rc2','1.3.3-rc10'),-1,'rc2 必须小于 rc10');
  assert.equal(compareVersions('1.3.3-rc10','1.3.3-rc2'),1);
  assert.equal(compareVersions('1.3.2','1.3.3-rc1'),-1);
  assert.equal(compareVersions('v2.0.0','v1.9.9'),1);
  assert.equal(compareVersions('1.3.3','1.3.3'),0);
  assert.equal(compareVersions('bad','1.0.0'),null);
  assert.equal(isNewer('1.3.3-rc2','1.3.3-rc1'),true);
  assert.equal(isNewer('1.3.3-rc1','1.3.3'),false);
  assert.equal(isNewer('1.3.3','1.3.3-rc10'),true);
});

test('原生更新信息归一化并兼容 rc 当前版本',()=>{
  assert.deepEqual(normalizeUpdateInfo(null),{enabled:true,currentVersion:'',skippedVersion:'',lastAutoCheckAt:0});
  assert.deepEqual(normalizeUpdateInfo({enabled:false,currentVersion:'v1.3.3-rc1',skippedVersion:'1.3.3-rc2',lastAutoCheckAt:'123'}),{enabled:false,currentVersion:'1.3.3-rc1',skippedVersion:'1.3.3-rc2',lastAutoCheckAt:123});
  assert.equal(normalizeUpdateInfo({lastAutoCheckAt:'not-a-number'}).lastAutoCheckAt,0);
});

test('发布结果区分正式版、测试版与失败',()=>{
  const rc=normalizeRelease({ok:true,updateAvailable:true,currentVersion:'1.3.2',latestVersion:'v1.3.3-rc1',prerelease:true,notes:' 修复若干问题 '});
  assert.equal(rc.ok,true);
  assert.equal(rc.updateAvailable,true);
  assert.equal(rc.latestVersion,'1.3.3-rc1');
  assert.equal(rc.prerelease,true);
  assert.equal(rc.notes,'修复若干问题');
  assert.equal(releaseTitle(rc.latestVersion),'发现测试版 v1.3.3-rc1');
  assert.equal(releaseTag(rc.latestVersion),'v1.3.3-rc1');
  const stable=normalizeRelease({ok:true,updateAvailable:true,currentVersion:'1.3.2',latestVersion:'1.3.3',prerelease:false});
  assert.equal(stable.prerelease,false);
  assert.equal(releaseTitle(stable.latestVersion),'发现新版本 v1.3.3');
  assert.equal(normalizeRelease({ok:true,updateAvailable:true,latestVersion:'bad'}).updateAvailable,false);
  assert.equal(normalizeRelease({ok:false,errorCode:'checksum_mismatch'}).ok,false);
  assert.match(normalizeRelease({ok:false,errorCode:'checksum_mismatch'}).message,/校验失败/);
  assert.equal(normalizeRelease(null).updateAvailable,false);
});

test('更新说明清洗控制字符并限制长度',()=>{
  assert.equal(releaseNotes('  a\r\nb  '),'a\nb');
  assert.equal(releaseNotes('x\u0000y\u0007z'),'xyz');
  const long=releaseNotes('x'.repeat(1300));
  assert.equal(long.length,1201);
  assert.equal(long.endsWith('…'),true);
  assert.equal(releaseNotes(null),'');
});

test('错误码给中文可操作文案，未知错误有上限',()=>{
  assert.match(updateErrorText('checksum_mismatch'),/校验失败/);
  assert.match(updateErrorText('signature_mismatch'),/签名不匹配/);
  assert.match(updateErrorText('asset_missing'),/资产不完整/);
  assert.match(updateErrorText('cancelled'),/已取消/);
  assert.equal(updateErrorText('custom','  自定义错误  '),'自定义错误');
  assert.equal(updateErrorText('custom','x'.repeat(300)).length,160);
  assert.match(updateErrorText('',''),/更新检查失败/);
});

test('下载大小格式化不产生负值或空单位',()=>{
  assert.equal(formatUpdateSize(0),'');
  assert.equal(formatUpdateSize(-1),'');
  assert.equal(formatUpdateSize(1024),'1 KB');
  assert.equal(formatUpdateSize(2*1024*1024),'2.0 MB');
});

test('Android 原生更新链路：预发布列表、证书固定与安装入口',async()=>{
  const java=await read('android/app/src/main/java/cn/local/tomorrow/UpdateChecker.java');
  assert.match(java,/releases\?per_page=30/,'必须拉取非 latest 的发布列表，才能看到 rc');
  assert.match(java,/EXPECTED_CERT_SHA256\s*=\s*"[0-9a-f]{64}"/);
  assert.match(java,/draft/);
  assert.match(java,/isAllowedAssetHost/);
  assert.match(java,/ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(java,/getApkContentsSigners/);
  const main=await read('android/app/src/main/java/cn/local/tomorrow/MainActivity.java');
  for(const action of ['updateInfo','updateSettings','updateCheck','updateDownload','updateCancel','updateSkip','updateInstall']) assert.match(main,new RegExp(action));
  assert.match(main,/onNativeUpdateProgress/);
});

test('Release 选取：同版本稳定版优先于 rc',async()=>{
  assert.equal(compareVersions('v1.3.4','v1.3.4-rc1'),1);
  assert.equal(compareVersions('v1.3.4-rc1','v1.3.4'),-1);
  const java=await read('android/app/src/main/java/cn/local/tomorrow/UpdateChecker.java');
  const fetch=java.match(/private Release fetchBestRelease\(\)[\s\S]*?\n    \}/)?.[0]||'';
  assert.match(fetch,/isBetterRelease\(candidate, best\)/,'候选必须走统一比较');
  const better=java.match(/private static boolean isBetterRelease\(Release candidate, Release best\) \{[\s\S]*?\n    \}/)?.[0]||'';
  assert.match(better,/candidate\.version\.major == best\.version\.major/,'先按版本数值比较');
  assert.match(better,/candidate\.version\.minor == best\.version\.minor/);
  assert.match(better,/candidate\.version\.patch == best\.version\.patch/);
  assert.match(better,/candidate\.prerelease != best\.prerelease/,'数值相同要区分预发布');
  assert.match(better,/return !candidate\.prerelease/,'稳定版优先');
  assert.match(better,/candidate\.hasAssets\(\) && !best\.hasAssets\(\)/,'预发布之间仍按 assets 取舍');
  assert.match(java,/version\.pre != null \|\| item\.optBoolean\("prerelease", false\)/,'rc 仍要识别并提示');
});

test('清单声明安装权限与只读 provider',async()=>{
  const manifest=await read('android/app/src/main/AndroidManifest.xml');
  assert.match(manifest,/REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest,/\.UpdateInstallProvider/);
  const appId=(await read('android/app/build.gradle')).match(/applicationId\s+'([^']+)'/)?.[1];
  assert.equal(appId,'cn.local.tomorrow','applicationId 必须固定为 cn.local.tomorrow');
  assert.match(manifest,new RegExp('android:authorities="'+appId.replace(/\./g,'\\.')+'\\.updates"'),'清单 provider authority 必须是字面 applicationId.updates');
  assert.doesNotMatch(manifest,/\$\{/,'清单不允许残留未替换的占位符');
  const providerCode=await read('android/app/src/main/java/cn/local/tomorrow/UpdateInstallProvider.java');
  assert.match(providerCode,/AUTHORITY_SUFFIX\s*=\s*"\.updates"/,'provider 常量后缀与清单一致');
  assert.match(providerCode,/getContext\(\)\.getPackageName\(\)\s*\+\s*AUTHORITY_SUFFIX/,'provider 运行时 authority = getPackageName()+.updates');
  const checkerCode=await read('android/app/src/main/java/cn/local/tomorrow/UpdateChecker.java');
  assert.match(checkerCode,/"content:\/\/"\s*\+\s*activity\.getPackageName\(\)\s*\+\s*"\.updates\/"/,'安装器 Uri authority 与 provider 一致');
  assert.match(manifest,/grantUriPermissions="true"/);
  const provider=await read('android/app/src/main/java/cn/local/tomorrow/UpdateInstallProvider.java');
  assert.match(provider,/extends ContentProvider/);
  assert.match(provider,/MODE_READ_ONLY/);
  assert.match(provider,/update\.apk/);
});

test('更新面板只在 Android 暴露，并提示预发布风险',async()=>{
  const app=await read('web/app.mjs');
  assert.match(app,/function appUpdatePanel\(\)\{/);
  assert.match(app,/if\(!globalThis\.Android\)return '';/);
  assert.match(app,/'update-enabled'/);
  assert.match(app,/onNativeUpdateProgress/);
  const update=await read('web/update.mjs');
  assert.match(update,/发现测试版 v/);
  assert.match(update,/发现新版本 v/);
  const appText=await read('web/app.mjs');
  assert.match(appText,/这是预发布版本，可能不稳定/);
});
