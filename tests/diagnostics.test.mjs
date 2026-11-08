import test from 'node:test';import assert from 'node:assert/strict';
import {failureCategory,safeDiagnosticLines,formatDiagnostics} from '../web/diagnostics.mjs';
test('排查文件保留固定错误码与环境，丢弃密码、Cookie、账号、课程、URL及任意日志',()=>{
 const secret='private-account-cookie-ticket';
 const text=formatDiagnostics({platform:'android',appVersion:'1.1.6',systemVersion:'16',androidApi:30,engineVersion:'100.0.4896.127',cookies:secret,account:secret,events:[
  '10-12 11:00:00 read-start background=false profile-known=false',
  '10-12 11:00:01 school-page http-error=503 page=school-login method=POST',
  '10-12 11:00:02 profile-read recognized=true links=2 path=/student/'+secret,
  '10-12 11:00:03 read-failed background=false',
  '10-12 11:00:04 page https://example.invalid/?ticket='+secret,
  '10-12 11:00:05 Cookie='+secret,
  '10-12 11:00:06 school-page http-error=503 page='+secret+' method=POST',
  '10-12 11:00:07 school-page http-error=503 page=school-login method=POST '+secret,
 ]},'学校页面返回 HTTP 503 '+secret);
 assert.match(text,/1\.1\.6/);assert.match(text,/Android API：30/);assert.match(text,/HTTP 503/);assert.match(text,/profile-read recognized=true links=2/);
 assert.doesNotMatch(text,/private-account|ticket=|example\.invalid|Cookie=|path=/);
 assert.equal(safeDiagnosticLines(Array.from({length:300},()=> '10-12 11:00:00 read-failed background=false')).length,200);
});
test('空日志及错误分类可用，不逐字复制失败消息',()=>{
 assert.deepEqual(failureCategory('上课时间格式无法识别：私人课程'),{kind:'structure',httpStatus:0});
 assert.match(formatDiagnostics({},'上课时间格式无法识别：私人课程'),/最近失败分类：structure/);
 assert.doesNotMatch(formatDiagnostics({},'上课时间格式无法识别：私人课程'),/私人课程/);
 assert.match(formatDiagnostics(),/暂无可导出的读取事件/);
});

test('登录等待与成功事件只保留固定状态，拒绝额外文字',()=>{
 assert.deepEqual(safeDiagnosticLines(['10-13 00:01:00 school-login awaiting-user','10-13 00:02:00 school-login accepted','10-13 00:02:01 school-login accepted cookie=private']),['10-13 00:01:00 school-login awaiting-user','10-13 00:02:00 school-login accepted']);
});

test('内测版本号和通知诊断只导出权限标量，不复制课程及任意内容',()=>{
 const text=formatDiagnostics({appVersion:'1.2.0-beta8',notificationStatus:{enabled:true,importance:4,lockVisibility:1,deviceLocked:true,activeCount:1,groupedCount:0,course:'私密课程',focus:{xiaomi:true,checked:true,protocol:3,allowed:false,note:'私密票据'}}});
 assert.match(text,/应用版本：1\.2\.0-beta8/);assert.match(text,/importance=4/);assert.match(text,/device-locked=true/);assert.match(text,/grouped=0/);assert.match(text,/protocol=3 allowed=false/);assert.doesNotMatch(text,/私密/);
});

test('beta10 版本在排查日志中正常显示',()=>{const text=formatDiagnostics({appVersion:'1.2.0-beta10'});assert.match(text,/应用版本：1\.2\.0-beta10/);});
test('1.3.0-rc1 版本在排查日志中正常显示',()=>{const text=formatDiagnostics({appVersion:'1.3.0-rc1'});assert.match(text,/应用版本：1\.3\.0-rc1/);});


test('session 恢复日志仅允许固定阶段和布尔状态',()=>{
 const lines=safeDiagnosticLines([
  '10-17 20:00:00 session-cookie-state tgc=true academic=false',
  '10-17 20:00:01 session-cookie-restore tgc=true academic=false',
  '10-17 20:00:02 session-cookie-restored name=tgc',
  '10-17 20:00:03 session-renewal start reason=expired-school-cookie',
  '10-17 20:00:04 session-renewal reached-academic-home',
  '10-17 20:00:05 session-cookie-state tgc=private academic=true',
  '10-17 20:00:06 session-cookie-state tgc=true academic=false TGC=secret',
 ]);
 assert.equal(lines.length,5);assert.doesNotMatch(lines.join(' '),/private|secret|TGC=/);
});
