import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// 实验课亮蓝卡片（T4）静态门禁：提取 CSS 变量、复算十六进制与 WCAG，不依赖浏览器/真机。
const css=readFileSync(new URL('../web/themes.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../web/app.mjs',import.meta.url),'utf8');
const theme=readFileSync(new URL('../web/theme.mjs',import.meta.url),'utf8');

const blockStart=css.indexOf('/* ===== 实验课卡片');
assert(blockStart>=0,'themes.css 必须包含实验课卡片样式块');
const blockEnd=css.indexOf('/* ===== 考试卡片',blockStart);
const labBlock=css.slice(blockStart,blockEnd>blockStart?blockEnd:undefined);
const darkStart=labBlock.indexOf('html[data-theme=dark]{');
assert(darkStart>0,'实验课样式必须提供深色主题变量');
const lightPart=labBlock.slice(0,darkStart);
const darkPart=labBlock.slice(darkStart);
const valueOf=(part,name)=>{const index=part.indexOf(name+':');if(index<0)return null;const match=/^\s*(#[0-9a-fA-F]{6})/.exec(part.slice(index+name.length+1));return match?match[1].toLowerCase():null;};
function luminance(hex){
 const [r,g,b]=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255);
 const channel=value=>value<=0.03928?value/12.92:Math.pow((value+0.055)/1.055,2.4);
 return 0.2126*channel(r)+0.7152*channel(g)+0.0722*channel(b);
}
function contrast(a,b){const [high,low]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (high+0.05)/(low+0.05);}

test('浅色主题：深蓝卡底 #1976d2、亮蓝强调 #42a5f5、白字、深蓝角标',()=>{
 assert.equal(valueOf(lightPart,'--lab-accent'),'#42a5f5');
 assert.equal(valueOf(lightPart,'--lab-card-bg'),'#1976d2');
 assert.equal(valueOf(lightPart,'--lab-card-border'),'#42a5f5');
 assert.equal(valueOf(lightPart,'--lab-card-ink'),'#ffffff');
 assert.equal(valueOf(lightPart,'--lab-badge-bg'),'#0d47a1');
 assert.equal(valueOf(lightPart,'--lab-badge-ink'),'#ffffff');
 assert.equal(valueOf(lightPart,'--lab-badge-border'),'#0d47a1');
 assert.equal(valueOf(lightPart,'--lab-hero-bg'),'#1976d2');
 assert.equal(valueOf(lightPart,'--lab-hero-ink'),'#ffffff');
});

test('深色主题：更深的蓝底 #0d47a1、浅蓝边框/角标 #64b5f6、浅色字',()=>{
 assert.equal(valueOf(darkPart,'--lab-card-bg'),'#0d47a1');
 assert.equal(valueOf(darkPart,'--lab-card-border'),'#64b5f6');
 assert.equal(valueOf(darkPart,'--lab-card-ink'),'#e3f2fd');
 assert.equal(valueOf(darkPart,'--lab-badge-bg'),'#64b5f6');
 assert.equal(valueOf(darkPart,'--lab-badge-ink'),'#001b33');
 assert.equal(valueOf(darkPart,'--lab-badge-border'),'#64b5f6');
 assert.equal(valueOf(darkPart,'--lab-hero-bg'),'#0d47a1');
 assert.equal(valueOf(darkPart,'--lab-hero-ink'),'#e3f2fd');
});

test('WCAG：卡底/角标正文 ≥4.5:1，卡片边界/深色边框非文本 ≥3:1',()=>{
 const lightCard=contrast('#ffffff','#1976d2');
 const lightBadge=contrast('#ffffff','#0d47a1');
 const darkCard=contrast('#e3f2fd','#0d47a1');
 const darkBadge=contrast('#001b33','#64b5f6');
 assert.ok(lightCard>=4.5,'浅色卡底白字 '+lightCard.toFixed(2)+':1');
 assert.ok(lightBadge>=4.5,'浅色角标白字 '+lightBadge.toFixed(2)+':1');
 assert.ok(darkCard>=4.5,'深色卡底浅字 '+darkCard.toFixed(2)+':1');
 assert.ok(darkBadge>=4.5,'深色角标深字 '+darkBadge.toFixed(2)+':1');
 assert.ok(contrast('#1976d2','#ffffff')>=3,'浅色卡底对页面白底 ≥3:1');
 assert.ok(contrast('#0d47a1','#ffffff')>=3,'浅色角标对页面白底 ≥3:1');
 assert.ok(contrast('#64b5f6','#0d47a1')>=3,'深色边框对卡底 ≥3:1');
 assert.ok(contrast('#64b5f6','#0d47a1')>=3,'深色角标对卡底 ≥3:1');
});

test('CSS 变量通过 lab 类映射到卡片/角标/详情，深色覆盖齐全',()=>{
 const stripped=labBlock.replace(/\/\*[\s\S]*?\*\//g,'');
 const rules=[...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match=>({selector:match[1].trim().replace(/\s+/g,' '),body:match[2]}));
 assert(rules.length>=6,'实验课样式块规则数量异常');
 for(const rule of rules){
  if(rule.selector===':root'||rule.selector==='html[data-theme=dark]'){
   assert.match(rule.body,/--lab-/,'主题变量块必须定义实验课变量');
   continue;
  }
  assert.match(rule.selector,/lab/,'实验课样式规则不得命中普通课程：'+rule.selector);
 }
 const cardRule=rules.find(rule=>rule.selector==='.course-card.lab-card');
 assert(cardRule,'缺少 .course-card.lab-card 映射');
 assert.match(cardRule.body,/background:var\(--lab-card-bg\)/);
 assert.match(cardRule.body,/border-color:var\(--lab-card-border\)/);
 assert.match(cardRule.body,/color:var\(--lab-card-ink\)/);
 assert.match(cardRule.body,/box-shadow:inset 4px 0 0 var\(--lab-accent\)/,'亮蓝只作强调条');
 const badgeRule=rules.find(rule=>rule.selector==='.badge.lab');
 assert(badgeRule,'缺少 .badge.lab 映射');
 assert.match(badgeRule.body,/background:var\(--lab-badge-bg\)/);
 assert.match(badgeRule.body,/color:var\(--lab-badge-ink\)/);
 assert(rules.some(rule=>rule.selector==='.detail-hero.lab-hero'),'实验详情头使用 lab-hero');
 assert(rules.some(rule=>rule.selector==='html[data-theme=dark] .course-card.lab-card:not(.vacant)'),'深色主题必须覆盖实验卡变量');
 assert(rules.some(rule=>rule.selector==='html[data-theme=dark] .badge.lab'),'深色主题必须覆盖实验角标');
 assert(rules.some(rule=>rule.selector==='html[data-theme=dark] .detail-hero.lab-hero'),'深色主题必须覆盖实验详情头');
});

test('实验卡内联变更文字跟随卡片字色可读，del/ins 语义保留',()=>{
 const stripped=labBlock.replace(/\/\*[\s\S]*?\*\//g,'');
 const rules=[...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match=>({selector:match[1].trim().replace(/\s+/g,' '),body:match[2]}));
 const override=rules.find(rule=>rule.selector.includes('.course-card.lab-card .unread'));
 assert(override,'缺少实验卡内联变更文字颜色覆盖');
 for(const token of ['.course-card.lab-card .change-inline','.course-card.lab-card .change-inline del','.course-card.lab-card .change-inline ins','.course-card.lab-card .unread']) assert(override.selector.includes(token),'覆盖规则需包含 '+token);
 assert.match(override.body,/color:var\(--lab-card-ink\)!important/);
 assert(rules.some(rule=>rule.selector==='.course-card.lab-card .change-inline del'&&/line-through/.test(rule.body)),'del 保留删除线');
 assert(rules.some(rule=>rule.selector==='.course-card.lab-card .change-inline ins'&&/underline/.test(rule.body)),'ins 保留下划线');
});

test('app 实验课分支使用 lab 类且不注入内联实验配色',()=>{
 const cardStart=app.indexOf('function courseCard(');
 const cardEnd=app.indexOf('\nfunction ',cardStart+1);
 assert(cardStart>=0&&cardEnd>cardStart);
 const card=app.slice(cardStart,cardEnd);
 const labBranch=card.slice(card.indexOf('if(r.lab===true)'),card.indexOf('const e=unreadFor'));
 assert(labBranch.includes('lab-card'),'实验卡使用 lab-card');
 assert(labBranch.includes("badge('实验','lab')"),'实验角标使用 lab');
 assert(!labBranch.includes('courseColor'),'实验卡不得注入课程自动配色');
 assert.doesNotMatch(app,/#(?:1976d2|42a5f5|0d47a1|64b5f6|e3f2fd)/i,'实验配色只能来自 themes.css 变量');
 const detailStart=app.indexOf('function detail(');
 const detailEnd=app.indexOf('\nfunction ',detailStart+1);
 const detail=app.slice(detailStart,detailEnd);
 assert(detail.includes('lab-hero'),'实验详情头使用 lab-hero');
});

test('亮/暗切换走既有主题机制：theme.mjs 解析系统偏好后写 html[data-theme]',()=>{
 assert(theme.includes('prefers-color-scheme: dark'),'系统深色来自 prefers-color-scheme');
 assert(theme.includes('document.documentElement.dataset.theme=resolved'),'主题通过 html[data-theme] 切换');
 assert.match(labBlock,/html\[data-theme=dark\]\{/,'深色主题变量挂在 html[data-theme=dark]');
});
