import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createState,timetableDay} from '../web/core.mjs';
import {
  SAMPLE_MENU_GROUPS,sampleMenuEntries,sampleMenuActionIds,renderSampleMenu,
  sampleChangeExamples,renderSampleChangeList,sampleNotificationPreview,renderSampleNotificationPreview,
  sampleCalendarPreview,renderSampleCalendarPreview,renderSampleExportPanel,
  sampleDiagnosticsText,renderSampleDiagnosticsPreview
} from '../web/sample-menu.mjs';

// A4 / task-50：示例模式脱敏与底部可展开示例菜单。
// 说明：菜单结构/内容渲染为逻辑层（真实 import 执行）；app.mjs 接线为静态源码契约；
// 脱敏审计对 web/ 出包内容做真实文件扫描。
const root=new URL('../',import.meta.url);
const webDir=fileURLToPath(new URL('../web/',import.meta.url));
const app=readFileSync(new URL('web/app.mjs',root),'utf8');
const sampleMenuSource=readFileSync(new URL('web/sample-menu.mjs',root),'utf8');
const leaveStatus=readFileSync(new URL('web/leave-status.mjs',root),'utf8');
const themesCss=readFileSync(new URL('web/themes.css',root),'utf8');
const adjusted=JSON.parse(readFileSync(new URL('web/data/adjusted.json',root),'utf8'));
const baseline=JSON.parse(readFileSync(new URL('web/data/baseline.json',root),'utf8'));
const DATE='2026-11-18';
const sampleState=()=>createState(adjusted);
const PII={
  email:/[\w.+-]+@[\w-]+\.[\w.]+/,
  phone:/(?<!\d)1[3-9]\d{9}(?!\d)/,
  idCard:/(?<!\d)\d{17}[\dXx](?!\d)/,
  studentId:/(?:学号|身份证|准考证号|宿舍号)[:：]\s*\d/,
};

test('示例菜单结构：4 组 8 入口，覆盖课表/变更/请假/日历/通知/导出/诊断',()=>{
  assert.deepEqual(SAMPLE_MENU_GROUPS.map(group=>group.title),['课表','变化与通知','请假与日历','导出与排查'],'分组顺序固定');
  const entries=sampleMenuEntries();
  assert.equal(entries.length,8,'展开后共 8 个示例入口');
  assert.equal(new Set(entries.map(entry=>entry.id)).size,8,'入口 id 唯一');
  assert.equal(new Set(entries.map(entry=>entry.action)).size,8,'动作名唯一');
  for(const entry of entries){
    assert.match(entry.action,/^sample-menu-[a-z-]+$/,'入口动作必须落在只读示例动作命名空间：'+entry.action);
    assert.ok(entry.label&&entry.label.length>=3,'入口需要可读标签');
    assert.ok(entry.hint&&entry.hint.length>=4,'入口需要一行说明');
  }
  const labels=entries.map(entry=>entry.label).join('|');
  for(const keyword of ['今日课表','完整课表','变更记录','通知','假条','日历','导出','排查'])assert.ok(labels.includes(keyword),'菜单需覆盖：'+keyword);
  assert.deepEqual(SAMPLE_MENU_GROUPS.map(group=>group.entries.length),[2,2,2,2],'每组两个入口，折叠/展开布局稳定');
});

test('折叠态只占一行，展开后按组列出全部入口（逻辑层渲染）',()=>{
  const collapsed=renderSampleMenu();
  assert.ok(collapsed.includes('示例功能菜单'),'折叠态显示菜单标题');
  assert.ok(collapsed.includes('aria-expanded="false"'),'折叠态 aria-expanded=false');
  assert.ok(collapsed.includes('aria-controls="sample-example-menu-body"'),'折叠态声明展开区域');
  assert.equal((collapsed.match(/data-action="sample-menu-/g)||[]).length,1,'折叠态只有一行切换按钮');
  assert.equal(collapsed.includes('sample-example-group'),false,'折叠态不渲染分组');
  assert.equal(collapsed.includes('data-sample-entry'),false,'折叠态不渲染入口');

  const expanded=renderSampleMenu({expanded:true});
  assert.ok(expanded.includes('aria-expanded="true"'),'展开态 aria-expanded=true');
  assert.ok(expanded.includes('id="sample-example-menu-body"'),'展开态渲染菜单主体');
  assert.equal((expanded.match(/class="sample-example-group"/g)||[]).length,4,'展开态渲染 4 个分组');
  assert.equal((expanded.match(/data-sample-entry="/g)||[]).length,8,'展开态渲染全部 8 个入口');
  for(const group of SAMPLE_MENU_GROUPS){
    assert.ok(expanded.includes('<h3>'+group.title+'</h3>'),'分组标题渲染：'+group.title);
    for(const entry of group.entries){
      assert.ok(expanded.includes('data-action="'+entry.action+'"'),'入口动作渲染：'+entry.action);
      assert.ok(expanded.includes(entry.label),'入口标签渲染：'+entry.label);
      assert.ok(expanded.includes(entry.hint),'入口说明渲染：'+entry.hint);
    }
  }
});

test('示例菜单样式沿用现有主题变量，移动端单列',()=>{
  for(const selector of ['.sample-example-menu','.sample-example-menu-toggle','.sample-example-menu-body','.sample-example-group','.sample-example-link','.sample-example-item','.sample-diagnostics']){
    assert.ok(themesCss.includes(selector),'缺少样式：'+selector);
  }
  const start=themesCss.indexOf('.sample-example-menu{');
  const block=themesCss.slice(start);
  for(const variable of ['var(--line)','var(--surface)','var(--accent-soft)','var(--muted)','var(--ink)'])assert.ok(block.includes(variable),'示例菜单样式需沿用主题变量：'+variable);
  assert.ok(block.includes('aria-expanded=true] .sample-example-menu-chevron'),'展开态需要可观察的箭头状态');
  assert.ok(themesCss.includes('@media(max-width:720px){.sample-example-menu'),'移动端示例菜单单列/紧凑');
});

test('示例菜单动作全部只读，接入 app 的示例模式白名单门控',()=>{
  const actions=sampleMenuActionIds();
  assert.deepEqual(actions,['sample-menu-toggle','sample-menu-today','sample-menu-week','sample-menu-changes','sample-menu-notifications','sample-menu-leave','sample-menu-calendar','sample-menu-export','sample-menu-diagnostics'],'动作清单固定');
  // 白名单不是第二份手写清单：由菜单模块并入门控集合，避免新增入口被误拦（U-07 方向）。
  assert.ok(app.includes('for(const action of sampleMenuActionIds())sampleReadActions.add(action);'),'菜单动作必须并入 sampleReadActions 白名单');
  assert.ok(app.includes("if(sampleState&&!sampleReadActions.has(a)){toast('请先退出示例模式再修改个人数据');return;}"),'既有示例模式门控保持不变');
  const gate=app.indexOf("if(sampleState&&!sampleReadActions.has(a))");
  const firstBranch=app.indexOf("if(a==='sample-menu-toggle')");
  assert.ok(gate>=0&&firstBranch>gate,'菜单分支必须排在示例模式门控之后执行');
  for(const action of actions)assert.ok(app.includes("if(a==='"+action+"')"),'缺少菜单动作接线：'+action);
  const block=app.slice(firstBranch,app.indexOf("if(a==='study-settings')"));
  assert.ok(block.includes("if(a==='sample-menu-diagnostics')"),'菜单分支块完整性');
  assert.doesNotMatch(block,/save\(|localStorage|call\(/,'示例菜单动作不得写盘或调用原生桥');
  // 菜单 HTML 里出现的 data-action 只允许菜单动作与只读导出动作。
  const renderedActions=[...new Set([...sampleMenuSource.matchAll(/data-action="([^"$]+)"/g)].map(match=>match[1]))].sort();
  assert.deepEqual(renderedActions,['export-semester','export-week','sample-menu-toggle'],'示例菜单按钮只允许只读动作');
});

test('示例变更记录：基于示例课表生成 3 条合成记录，稳定、只读、不改状态',()=>{
  const state=sampleState();
  const before=JSON.stringify(state);
  const records=sampleChangeExamples(state,DATE);
  assert.equal(JSON.stringify(state),before,'生成示例变更不得修改传入状态');
  assert.equal(records.length,3,'默认生成 3 条示例变更');
  assert.deepEqual(records.map(record=>record.type),['换教室','改时间','停课'],'变化类型固定为换教室/改时间/停课');
  for(const record of records){
    assert.equal(record.demo,true,'示例变更必须带 demo 标记');
    assert.equal(record.source,'sample','来源固定为 sample');
    assert.match(record.name,/^课程[A-M]$/,'课程名只允许内置合成样例');
    assert.ok(record.date>=DATE&&record.date<='2027-01-03','示例变更日期落在示例学期内');
    const dayRows=timetableDay(state.snapshot,record.date,state.overrides,state.localMaps,state.courseSettings,state.customCourses,state.holidaySettings);
    assert.ok(dayRows.some(row=>row.name===record.name),'示例变更必须对应示例课表里真实存在的课程：'+record.date+' '+record.name);
  }
  assert.equal(records[2].after,null,'停课记录的 after 必须为空');
  assert.ok(records[0].before.room&&records[0].after.room,'换教室记录保留前后教室');
  assert.notEqual(records[0].before.room,records[0].after.room,'换教室前后教室必须不同');
  assert.deepEqual(sampleChangeExamples(state,DATE),records,'同一状态/日期结果稳定');
  assert.equal(sampleChangeExamples(state,DATE,1).length,1,'limit 生效');
  assert.deepEqual(sampleChangeExamples(createState({...adjusted,rules:[]}),DATE),[],'无课程时返回空数组');
  assert.deepEqual(sampleChangeExamples(state,'2026-02-30'),[],'非法日期返回空数组');
});

test('示例内容渲染：示例角标、HTML 转义、空态与只读提示',()=>{
  const records=sampleChangeExamples(sampleState(),DATE);
  const list=renderSampleChangeList(records);
  assert.ok(list.includes('示例数据'),'变更记录带示例数据角标');
  assert.ok(list.includes('换教室')&&list.includes('改时间')&&list.includes('停课'),'三类变化都渲染');
  assert.ok(list.includes('教室：'),'换教室展示前后值');
  const injected=renderSampleChangeList([{date:DATE,name:'<img src=x onerror="alert(1)">',type:'换教室',before:{room:'A101'},after:{room:'B201'}}]);
  assert.equal(injected.includes('<img'),false,'示例内容渲染必须转义 HTML');
  assert.ok(injected.includes('&lt;img'),'转义后的课程名可见');
  assert.ok(renderSampleChangeList([]).includes('暂无可展示'),'空态有兜底文案');

  const preview=sampleNotificationPreview(records);
  assert.equal(preview.title,'课表有 3 处变化（示例）','通知标题结构与真实 notifyPending 一致');
  assert.equal(preview.sent,false,'示例通知不发送');
  assert.match(preview.body,/^\d{1,2}月\d{1,2}日 课程[A-M]：/,'通知正文格式');
  assert.ok(renderSampleNotificationPreview(records).includes('不会发送通知'),'通知预览注明不发送');

  assert.ok(renderSampleNotificationPreview([]).includes('暂无可展示'),'无变化时通知预览有兜底');
});

test('日历写入预览：只统计示例课表事件，不写系统日历',()=>{
  const state=sampleState();
  const preview=sampleCalendarPreview(state);
  assert.equal(preview.error,null,'示例课表可生成日历预览');
  assert.ok(preview.total>0,'示例课表应产生日历事件');
  assert.deepEqual(preview.bySource,{school:preview.total,custom:0,study:0,exam:0},'示例状态只含学校课程');
  assert.ok(preview.events.length<=3,'预览列表最多 3 条');
  const html=renderSampleCalendarPreview(state);
  assert.ok(html.includes('将可写入系统日历'),'展示写入条数');
  assert.ok(html.includes('不会调用系统日历写入'),'注明不会写入');
  const invalid=renderSampleCalendarPreview({snapshot:{semester:{}}});
  assert.ok(invalid.includes('课表学期信息不完整'),'学期信息缺失时展示固定错误');
});

test('导出示例：复用只读导出动作，文件名带示例前缀',()=>{
  const html=renderSampleExportPanel({week:7});
  assert.ok(html.includes('data-action="export-week"')&&html.includes('data-action="export-semester"'),'复用既有导出动作');
  assert.ok(html.includes('第 7 周'),'展示当前周次');
  assert.ok(html.includes('示例-'),'说明文件名带示例前缀');
  assert.ok(html.includes('不会导出个人课表'),'注明只导出示例数据');
});

test('排查日志示例：固定占位字段，不含课程/账号等真实内容',()=>{
  const text=sampleDiagnosticsText();
  assert.match(text,/^江水课表 · 排查日志/,'复用真实排查日志格式');
  for(const fragment of ['应用版本：0.0.0','运行平台：android','系统版本：16','Android API：35','网页内核版本：0.0.0','read-start background=false profile-known=true','web-read ok weeks=18 rows=0 elapsed-ms=3000 sso=false background=false','本文件不包含账号、密码、Cookie、登录票据或课程内容']){
    assert.ok(text.includes(fragment),'排查日志样例字段：'+fragment);
  }
  assert.doesNotMatch(text,/课程[A-M]|教师[A-Z]|A10[0-9]/,'排查日志样例不得出现课程/教师/教室');
  const html=renderSampleDiagnosticsPreview();
  assert.ok(html.includes('<pre class="sample-diagnostics">'),'日志以等宽文本块展示');
  assert.ok(html.includes('不读取个人诊断数据'),'注明不读取个人诊断数据');
});

test('页面底部菜单接线与数据源隔离（app.mjs 源码契约，静态）',()=>{
  assert.ok(app.includes("</footer>${sampleState?renderSampleExampleMenu():''}</main></div>"),'示例菜单渲染在页脚之后的页面最下方，且只在示例模式出现');
  assert.ok(app.indexOf('</footer>')<app.indexOf('${sampleState?renderSampleExampleMenu()'),'菜单位于页脚之后');
  assert.ok(app.includes('function renderSampleExampleMenu(){return renderSampleMenu({expanded:sampleMenuExpanded});}'),'菜单展开态来自内存 UI 状态');
  assert.ok(app.includes('sampleState.showDayOverview=state.showDayOverview;sampleMenuExpanded=false;'),'进入示例模式时菜单默认折叠');
  assert.ok(app.includes('sampleState=null;sampleMenuExpanded=false;'),'退出示例模式时重置菜单展开态');
  assert.ok(app.includes('页面最下方有「示例功能菜单」'),'示例模式横幅/入口说明告知底部菜单');
  // 变更记录页在示例模式下展示合成变更列表（只读），不再只有占位文案。
  assert.ok(app.includes('变更记录示例'),'示例模式变更页展示示例列表');
  assert.ok(app.includes('renderSampleChangeList(sampleExampleChanges())'),'变更页复用示例变更渲染');
  assert.ok(app.includes("badge('示例数据','purple')"),'变更页展示示例角标');
  // 诊断导出在示例模式下改用 displayState()（sampleState），不再把个人课表交给诊断。
  assert.ok(app.includes('const current=displayState(),text=formatDiagnostics(data,current.error,current)'),'示例模式下排查日志使用示例状态而非个人状态');
  assert.equal(app.includes('formatDiagnostics(data,state.error,state)'),false,'不得再向诊断传入个人状态');
});

test('示例数据脱敏审计：内置样例与示例模块不含真实 PII',()=>{
  for(const [name,data] of [['adjusted',adjusted],['baseline',baseline]]){
    assert.deepEqual(Object.keys(data).sort(),['closedDates','exceptions','remaps','rules','schemaVersion','semester','source','unscheduled'],name+' 只允许固定字段');
    assert.equal(data.source.kind,'sample',name+' 来源必须标为 sample');
    assert.equal(data.source.label,'合成示例数据',name+' 来源标签必须写明合成');
    assert.match(data.semester.id,/^\d{4}-\d{4}-[12]$/,name+' 学期 id 为标准学期串');
    for(const rule of data.rules){
      assert.deepEqual(Object.keys(rule).sort(),['endTime','exam','id','name','periods','room','startTime','teacher','weekday','weeks'],name+' 排课规则只允许固定字段');
      assert.match(rule.name,/^课程[A-M]$/,name+' 课程名只允许合成命名');
      for(const teacher of String(rule.teacher).split(','))assert.match(teacher,/^教师[A-M]$/,name+' 教师名只允许合成命名');
      assert.match(rule.room,/^(—|[A-Z]\d{3})$/,name+' 教室只允许合成编号');
      assert.ok(['考试','考查'].includes(rule.exam),name+' 考试标记只允许固定值');
    }
    for(const item of data.unscheduled){
      assert.deepEqual(Object.keys(item).sort(),['name','teacher','weeks'],name+' 未排时间课程只允许固定字段');
      assert.match(item.name,/^课程[A-M]$/,name+' 未排课程名只允许合成命名');
      assert.match(item.teacher,/^教师[A-M]$/,name+' 未排教师名只允许合成命名');
    }
  }
  // 示例假条：只保留“（示例）”文案，不含真实编号/姓名/审批人。
  const region=leaveStatus.slice(leaveStatus.indexOf('function demoRange('),leaveStatus.indexOf('export const LEAVE_PROVIDER_MODE'));
  assert.ok(region.length>500,'定位到示例假条数据段');
  assert.ok(region.includes('辅导员（示例）'),'示例假条审批人明确标注示例');
  assert.ok(region.includes('（示例）'),'示例假条原因明确标注示例');
  assert.doesNotMatch(region,/number\s*:/,'示例假条不得包含真实假条编号字段');
});

test('web/ 出包内容 PII 扫描：无邮箱/手机号/身份证号',()=>{
  const walk=dir=>readdirSync(dir).flatMap(name=>{const full=join(dir,name);return statSync(full).isDirectory()?walk(full):[full];});
  const files=walk(webDir).filter(file=>/\.(?:mjs|js|json|html|css)$/.test(file));
  assert.ok(files.length>=30,'扫描范围覆盖 web/ 出包文件');
  for(const file of files){
    const text=readFileSync(file,'utf8');
    for(const key of ['email','phone','idCard']){
      const match=PII[key].exec(text);
      assert.equal(match,null,'出包文件不得包含'+key+'：'+file+(match?' -> '+match[0]:''));
    }
  }
  // 示例菜单模块不得有持久化/网络/原生桥调用。
  assert.doesNotMatch(sampleMenuSource,/localStorage|sessionStorage|fetch\(|XMLHttpRequest|indexedDB|call\(|save\(/,'示例菜单模块必须纯展示');
  assert.match(sampleMenuSource,/只读/,'示例菜单模块声明只读约束');
});
