import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isFeedbackUrl,normalizeFeedbackInfo,feedbackPanel,disabledFeedback} from '../web/feedback.mjs';

const WJX='https://www.wjx.cn/vm/abc123.aspx';

test('反馈地址只接受 https 问卷星域名',()=>{
  assert.equal(isFeedbackUrl(WJX),true);
  assert.equal(isFeedbackUrl('https://tp.wjx.top/vm/x.aspx'),true);
  assert.equal(isFeedbackUrl('https://www.wjx.cn/vm/x.aspx?a=1#top'),true);
  assert.equal(isFeedbackUrl('http://www.wjx.cn/vm/x.aspx'),false);
  assert.equal(isFeedbackUrl('https://www.wjx.cn.evil.example/vm/x.aspx'),false);
  assert.equal(isFeedbackUrl('https://evil.example/?wjx.cn'),false);
  assert.equal(isFeedbackUrl('https://user:pass@www.wjx.cn/vm/x.aspx'),false);
  assert.equal(isFeedbackUrl('https://www.wjx.cn:8443/vm/x.aspx'),false);
  assert.equal(isFeedbackUrl('https://www.wjx.cn/'),false);
  assert.equal(isFeedbackUrl('javascript:alert(1)'),false);
  assert.equal(isFeedbackUrl(''),false);
  assert.equal(isFeedbackUrl(null),false);
});

test('未配置网址时反馈入口关闭，配置后使用原生返回值',()=>{
  assert.equal(normalizeFeedbackInfo({enabled:true,url:''}).enabled,false);
  assert.equal(normalizeFeedbackInfo({enabled:true,url:'https://example.com/f'}).enabled,false);
  assert.equal(normalizeFeedbackInfo({enabled:false,url:WJX}).enabled,false);
  const info=normalizeFeedbackInfo({enabled:true,url:WJX,title:'  意见反馈  ',intro:' 说说哪里不好用 '});
  assert.equal(info.enabled,true);
  assert.equal(info.url,WJX);
  assert.equal(info.title,'意见反馈');
  assert.equal(info.intro,'说说哪里不好用');
});

test('反馈文案有长度上限和默认值，避免原生配置撑破布局',()=>{
  const info=normalizeFeedbackInfo({enabled:true,url:WJX,title:'   ',intro:''});
  assert.equal(info.title,'意见反馈');
  assert.equal(info.intro,'遇到问题或有建议？填一份问卷，帮我们把课表做得更稳。');
  const long=normalizeFeedbackInfo({enabled:true,url:WJX,title:'标题'.repeat(40),intro:'说明'.repeat(200)});
  assert.equal(long.title.length,40);
  assert.equal(long.intro.length,200);
});

test('入口面板只在配置有效时渲染，并调用 feedback 动作',()=>{
  assert.equal(feedbackPanel(disabledFeedback()),'');
  assert.equal(feedbackPanel(normalizeFeedbackInfo({enabled:true,url:''})),'');
  const html=feedbackPanel(normalizeFeedbackInfo({enabled:true,url:WJX,title:'意见反馈'}));
  assert.match(html,/id="feedback-panel"/);
  assert.match(html,/data-action="feedback"/);
  assert.match(html,/打开反馈问卷/);
  assert.match(html,/问卷由问卷星提供/);
});

test('配置标题按 HTML 转义，不能注入标记',()=>{
  const html=feedbackPanel(normalizeFeedbackInfo({enabled:true,url:WJX,title:'<img src=x onerror=alert(1)>'}));
  assert.ok(!html.includes('<img'));
  assert.match(html,/&lt;img/);
});

test('Android 清单声明反馈页，且桥接动作与配置文件名一致',async()=>{
  const manifest=await readFile(new URL('../android/app/src/main/AndroidManifest.xml',import.meta.url),'utf8');
  assert.match(manifest,/android:name="\.FeedbackActivity"/);
  const activity=await readFile(new URL('../android/app/src/main/java/cn/local/tomorrow/MainActivity.java',import.meta.url),'utf8');
  assert.match(activity,/case "feedbackInfo"/);
  assert.match(activity,/case "openFeedback"/);
  const config=await readFile(new URL('../web/feedback.json',import.meta.url),'utf8');
  const parsed=JSON.parse(config);
  assert.equal(typeof parsed.title,'string');
  assert.equal(typeof parsed.url,'string');
  assert.equal(parsed.url===''||isFeedbackUrl(parsed.url),true);
});
