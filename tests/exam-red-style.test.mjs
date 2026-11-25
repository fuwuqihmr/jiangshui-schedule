import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// 考试卡片统一红色（T14 新需求）。本测试是“静态提取 CSS 变量 + 类映射”的证据：
// 不做像素级渲染（本机无浏览器/真机），只复算颜色值与 WCAG 对比度。
const css=readFileSync(new URL('../web/themes.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const theme=readFileSync(new URL('../web/theme.mjs',import.meta.url),'utf8');

const blockStart=css.indexOf('/* ===== 考试卡片');
assert(blockStart>=0,'themes.css 必须包含考试卡片样式块');
const examBlock=css.slice(blockStart);
const darkStart=examBlock.indexOf('html[data-theme=dark]{');
assert(darkStart>0,'考试样式必须提供深色主题变量');
const lightPart=examBlock.slice(0,darkStart);
const darkPart=examBlock.slice(darkStart);
const valueOf=(part,name)=>{const index=part.indexOf(name+':');if(index<0)return null;const match=/^\s*(#[0-9a-fA-F]{6})/.exec(part.slice(index+name.length+1));return match?match[1].toLowerCase():null;};

function luminance(hex){
 const [r,g,b]=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255);
 const channel=value=>value<=0.03928?value/12.92:Math.pow((value+0.055)/1.055,2.4);
 return 0.2126*channel(r)+0.7152*channel(g)+0.0722*channel(b);
}
function contrast(a,b){const [high,low]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (high+0.05)/(low+0.05);}

test('浅色主题：鲜红底 #D32F2F + 深红边框/角标 #8B0000 + 白字',()=>{
 assert.equal(valueOf(lightPart,'--exam-card-bg'),'#d32f2f');
 assert.equal(valueOf(lightPart,'--exam-card-border'),'#8b0000');
 assert.equal(valueOf(lightPart,'--exam-card-ink'),'#ffffff');
 assert.equal(valueOf(lightPart,'--exam-badge-bg'),'#8b0000');
 assert.equal(valueOf(lightPart,'--exam-badge-border'),'#8b0000');
 assert.equal(valueOf(lightPart,'--exam-badge-ink'),'#ffffff');
});

test('深色主题：深红底 #B71C1C + 鲜红边框/角标 #EF5350 + 浅色字',()=>{
 assert.equal(valueOf(darkPart,'--exam-card-bg'),'#b71c1c');
 assert.equal(valueOf(darkPart,'--exam-card-border'),'#ef5350');
 assert.equal(valueOf(darkPart,'--exam-card-ink'),'#ffebee');
 assert.equal(valueOf(darkPart,'--exam-badge-bg'),'#ef5350');
 assert.equal(valueOf(darkPart,'--exam-badge-border'),'#ef5350');
});

test('WCAG AA：正文对比度 ≥4.5:1，角标 ≥3:1（同时满足正文 4.5）',()=>{
 const lightCard=contrast('#ffffff','#d32f2f');
 const lightBadge=contrast('#ffffff','#8b0000');
 const darkCard=contrast('#ffebee','#b71c1c');
 const darkBadge=contrast('#1a0000','#ef5350');
 assert.ok(lightCard>=4.5,'浅色卡片正文 '+lightCard.toFixed(2)+':1');
 assert.ok(lightBadge>=4.5,'浅色角标文字 '+lightBadge.toFixed(2)+':1');
 assert.ok(darkCard>=4.5,'深色卡片正文 '+darkCard.toFixed(2)+':1');
 assert.ok(darkBadge>=4.5,'深色角标文字 '+darkBadge.toFixed(2)+':1');
 assert.ok(lightBadge>=3&&darkBadge>=3,'角标 ≥3:1');
 assert.ok(contrast('#8b0000','#ffffff')>=3,'浅色边框对白底 ≥3:1');
 assert.ok(contrast('#ef5350','#121212')>=3,'深色边框对深色面板 ≥3:1');
 assert.ok(contrast('#ef5350','#000000')>=3,'深色边框对纯黑背景 ≥3:1');
});

test('CSS 变量通过类映射到考试卡片/角标/详情，不影响普通课程',()=>{
 const stripped=examBlock.replace(/\/\*[\s\S]*?\*\//g,'');
 const rules=[...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match=>({selector:match[1].trim().replace(/\s+/g,' '),body:match[2]}));
 assert(rules.length>=5,'考试样式块规则数量异常');
 for(const rule of rules){
  if(rule.selector===':root'||rule.selector==='html[data-theme=dark]'){
   assert.match(rule.body,/--exam-/,'主题变量块必须定义考试变量');
   continue;
  }
  assert.match(rule.selector,/exam/,'考试样式规则不得命中普通课程：'+rule.selector);
 }
 const cardRule=rules.find(rule=>rule.selector==='.course-card.exam-card');
 assert(cardRule,'缺少 .course-card.exam-card 映射');
 assert.match(cardRule.body,/background:var\(--exam-card-bg\)/);
 assert.match(cardRule.body,/border-color:var\(--exam-card-border\)/);
 assert.match(cardRule.body,/color:var\(--exam-card-ink\)/);
 const badgeRule=rules.find(rule=>rule.selector==='.badge.exam');
 assert(badgeRule,'缺少 .badge.exam 映射');
 assert.match(badgeRule.body,/background:var\(--exam-badge-bg\)/);
 assert.match(badgeRule.body,/color:var\(--exam-badge-ink\)/);
 assert(rules.some(rule=>rule.selector==='.detail-hero.exam-hero'),'考试详情头同样使用统一红色');
 assert(rules.some(rule=>rule.selector==='html[data-theme=dark] .course-card.exam-card:not(.vacant)'),'深色主题必须覆盖卡片变量');
});

test('考试卡片不跟随课程自动配色：exam-card 走单独类，普通卡片仍用 courseColor',()=>{
 const cardStart=app.indexOf('function courseCard(');
 const cardEnd=app.indexOf('function status(');
 assert(cardStart>=0&&cardEnd>cardStart);
 const card=app.slice(cardStart,cardEnd);
 assert.match(card,/exam\?' exam-card':''/,'考试卡片必须带 exam-card 类');
 assert.match(card,/exam\?'':` style="\$\{courseColor\(r\)\}"`/,'考试卡片不得使用内联课程配色');
 assert.match(card,/exam\?badge\('考试','exam'\)/,'考试角标使用 exam 样式');
 assert.doesNotMatch(card,/badge\('考试','purple'\)/,'考试角标不再用紫色');
 const detailStart=app.indexOf('function detail(');
 const detailEnd=app.indexOf('function edit(');
 const detail=app.slice(detailStart,detailEnd);
 assert.match(detail,/exam-hero/,'考试详情头使用 exam-hero');
 assert.match(detail,/r\.exam===true\?'':` style="\$\{courseColor\(r\)\}"`/,'考试详情不得使用内联课程配色');
});

test('亮/暗切换走既有主题机制：theme.mjs 解析系统偏好后写 html[data-theme]',()=>{
 assert(theme.includes('prefers-color-scheme: dark'),'系统深色来自 prefers-color-scheme');
 assert(theme.includes('document.documentElement.dataset.theme=resolved'),'主题通过 html[data-theme] 切换');
 assert.match(examBlock,/html\[data-theme=dark\]\{/,'深色主题变量挂在 html[data-theme=dark]');
});

test('考试卡内联变更文字在红底上可读：unread/del/ins 覆盖为卡片文字色且 ≥4.5:1（P2-R2-5）',()=>{
 const stripped=examBlock.replace(/\/\*[\s\S]*?\*\//g,'');
 const rules=[...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match=>({selector:match[1].trim().replace(/\s+/g,' '),body:match[2]}));
 const override=rules.find(rule=>rule.selector.includes('.course-card.exam-card .unread'));
 assert(override,'缺少考试卡内联变更文字的颜色覆盖规则');
 for(const token of ['.course-card.exam-card .change-inline','.course-card.exam-card .change-inline del','.course-card.exam-card .change-inline ins','.course-card.exam-card .unread']) assert(override.selector.includes(token),'覆盖规则需包含选择器 '+token);
 assert.match(override.body,/color:var\(--exam-card-ink\)!important/,'必须用 !important 压过 .unread{color:var(--red)!important}');
 const delRule=rules.find(rule=>rule.selector==='.course-card.exam-card .change-inline del');
 assert(delRule,'缺少 del 语义覆盖');
 assert.match(delRule.body,/text-decoration:line-through/);
 const insRule=rules.find(rule=>rule.selector==='.course-card.exam-card .change-inline ins');
 assert(insRule,'缺少 ins 语义覆盖');
 assert.match(insRule.body,/text-decoration:underline/);
 assert.ok(contrast(valueOf(lightPart,'--exam-card-ink'),valueOf(lightPart,'--exam-card-bg'))>=4.5,'亮色考试卡变更文字 ≥4.5:1');
 assert.ok(contrast(valueOf(darkPart,'--exam-card-ink'),valueOf(darkPart,'--exam-card-bg'))>=4.5,'深色考试卡变更文字 ≥4.5:1');
});
