import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../web/core.mjs';
import {PERIOD_TIMES} from '../web/jsxsd.mjs';
import {attachLabPayload} from '../web/jiaowu-lab.mjs';
import {buildCalendarEvents,LAB_TITLE_PREFIX} from '../web/calendar-events.mjs';

const START='2026-08-31',WEEKS=2,DATE=START;
const RAW_LAB={week:1,weekday:1,name:'课程A',courseCode:'K1',className:'合成班',room:'X101',sectionCode:'10102'};
const NORMAL={id:'normal-a',name:'课程A',teacher:'',room:'X101',weekday:1,weeks:[1],periods:[1,2],startTime:'08:30',endTime:'09:55'};

function snapshot(rules=[],extra={}){
  return {schemaVersion:1,semester:{id:'lab-calendar',name:'合成学期',startDate:START,weeks:WEEKS},rules,exceptions:[],remaps:[],closedDates:[],unscheduled:[],...extra};
}

function labState({rules=[],extra={},stateExtra={},lab=RAW_LAB}={}){
  let snap=snapshot(rules,extra);
  snap=attachLabPayload(snap,{labs:[lab]},undefined,{periodTimes:PERIOD_TIMES,now:'2026-11-17T00:00:00.000Z'});
  return {...createState(snap),...stateExtra};
}

test('实验课写入系统日历：标题前缀、source=lab、描述含课程编号/节次/地点',()=>{
  const out=buildCalendarEvents(labState());
  assert.equal(out.error,null);
  assert.equal(out.events.length,1);
  const event=out.events[0];
  assert.equal(event.title,LAB_TITLE_PREFIX+'课程A');
  assert.equal(event.title,'【实验】课程A');
  assert.equal(event.source,'lab');
  assert.equal(event.lab,true);
  assert.equal(event.exam,false);
  assert.equal(event.location,'X101');
  assert.equal(event.startDate,DATE);
  assert.equal(event.startTime,'08:30');
  assert.equal(event.endTime,'09:55');
  assert.equal(event.startMillis,Date.parse(DATE+'T08:30:00+08:00'));
  assert.equal(event.endMillis,Date.parse(DATE+'T09:55:00+08:00'));
  assert.equal(event.key,DATE+'/lab-'+'K1|1|1|10102');
  assert.equal(event.description,'实验课 · 课程编号：K1 · 节次：10102 · 地点：X101 · 教师：未填写 · 第1周（周一） · 来源：学校实验课 · 由江水课表写入');
});

test('同名实验课与普通课不合并，实验课随「学校课程」选项开关',()=>{
  const s=labState({rules:[NORMAL]});
  const out=buildCalendarEvents(s);
  assert.equal(out.error,null);
  assert.equal(out.events.length,2,'同名普通课与实验课各一条');
  const lab=out.events.find(event=>event.lab===true);
  const school=out.events.find(event=>event.lab===false);
  assert(lab);assert(school);
  assert.equal(lab.title,'【实验】课程A');
  assert.equal(school.title,'课程A');
  assert.equal(lab.source,'lab');
  assert.equal(school.source,'school');
  assert.notEqual(lab.key,school.key,'两条事件 key 必须不同');
  assert.equal(lab.startDate,DATE);
  assert.equal(school.startDate,DATE);

  const off=buildCalendarEvents(s,{school:false,custom:true,study:true});
  assert.deepEqual(off.events,[]);
  assert(off.skipped>=2,'学校课程关闭后普通课与实验课都跳过');

  const schoolOnly=buildCalendarEvents(s,{school:true,custom:false,study:false});
  assert.equal(schoolOnly.events.length,2,'实验课不占自定义/晚自习选项，随学校课程保留');
  assert.equal(schoolOnly.events.filter(event=>event.source==='lab').length,1);
});

test('停课取消实验课；本机调休不移动实验课',()=>{
  const closed=labState({extra:{closedDates:[DATE]}});
  const closedOut=buildCalendarEvents(closed);
  assert.equal(closedOut.error,null);
  assert.deepEqual(closedOut.events,[]);
  assert(closedOut.skipped>=1,'停课实验课计入 skipped');

  const moved=labState({rules:[NORMAL],stateExtra:{localMaps:[{id:'lm1',fromDate:DATE,date:'2026-09-01'}]}});
  const movedOut=buildCalendarEvents(moved);
  assert.equal(movedOut.error,null);
  const lab=movedOut.events.find(event=>event.lab===true);
  assert(lab,'实验课按原周次保留');
  assert.equal(lab.startDate,DATE);
  assert.equal(movedOut.events.some(event=>event.lab===true&&event.startDate==='2026-09-01'),false,'实验课不被本机调休搬到目标日');
  assert(movedOut.events.some(event=>event.lab===false&&event.startDate==='2026-09-01'),'普通课按调休移动到目标日');
});

test('实验课标题/描述裁剪仍保留【实验】前缀',()=>{
  const longLab={...RAW_LAB,name:'实'.repeat(250)};
  const event=buildCalendarEvents(labState({lab:longLab})).events[0];
  assert(event.title.startsWith(LAB_TITLE_PREFIX));
  assert(event.title.length<=200);
  assert(event.title.length>LAB_TITLE_PREFIX.length,'长名称未完全丢失');
  assert(event.description.length<=1000);
  assert(event.description.startsWith('实验课 · 课程编号：K1'));
});
