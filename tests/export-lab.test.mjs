import test from 'node:test';
import assert from 'node:assert/strict';
import {createState} from '../web/core.mjs';
import {PERIOD_TIMES} from '../web/jsxsd.mjs';
import {attachLabPayload} from '../web/jiaowu-lab.mjs';
import {exportWeekModel,semesterOccurrences,buildRulesModel,buildRulesText,buildSemesterOverviewModel,renderWeekPages,renderSemesterOverviewPages} from '../web/timetable-export.mjs';

const SEMESTER={id:'lab-export',name:'合成学期',startDate:'2026-08-31',weeks:5};
const DATE='2026-09-14';
const RAW_LAB={week:3,weekday:1,name:'课程A',courseCode:'K1',className:'合成班',room:'X101',sectionCode:'10102'};
const NORMAL={id:'normal-a',name:'课程A',teacher:'',room:'X101',weekday:1,weeks:[3],periods:[1,2],startTime:'08:30',endTime:'09:55'};

function base(extra={}){
  return {schemaVersion:1,semester:{...SEMESTER},source:{kind:'school',label:'合成学校'},rules:[],exceptions:[],remaps:[],closedDates:[],unscheduled:[],...extra};
}

function makeState({labs=true,normal=true,extra={}}={}){
  let snapshot=base({rules:normal?[NORMAL]:[],...extra});
  if(labs)snapshot=attachLabPayload(snapshot,{labs:[RAW_LAB]},undefined,{periodTimes:PERIOD_TIMES,now:'2026-11-17T00:00:00.000Z'});
  return createState(snapshot);
}

function allCards(model){return model.days.flatMap(day=>day.courses);}

// The writer uses a fake 2D context only to observe the real draw calls.
function canvasRecorder(){
  const record={texts:[],fills:[]};
  const createCanvas=()=>{
    const canvas={width:0,height:0};
    canvas.getContext=()=>{
      const ctx={textBaseline:'',font:'',fillStyle:'',strokeStyle:'',lineWidth:1};
      ctx.measureText=text=>{
        const size=Number((/(\d+(?:\.\d+)?)px/.exec(ctx.font)||[])[1]||24);
        let width=0;
        for(const character of String(text))width+=character.codePointAt(0)>=0x2e80?size:size*.55;
        return {width};
      };
      ctx.fillText=value=>record.texts.push(String(value));
      ctx.fillRect=(x,y,w,h)=>record.fills.push({fill:String(ctx.fillStyle),w,h});
      ctx.strokeRect=()=>{};ctx.beginPath=()=>{};ctx.moveTo=()=>{};ctx.lineTo=()=>{};ctx.stroke=()=>{};
      ctx.save=()=>{};ctx.restore=()=>{};ctx.scale=()=>{};ctx.translate=()=>{};ctx.setTransform=()=>{};
      return ctx;
    };
    return canvas;
  };
  return {record,createCanvas};
}

test('实验课进入周图、总览和规则文本：独立标识、来源 lab、【实验】前缀',()=>{
  const state=makeState();
  const week=exportWeekModel(state,3);
  const weekLab=week.days[0].courses.find(course=>course.lab===true);
  assert.ok(weekLab,'周图应包含实验课');
  assert.equal(weekLab.name,'课程A');
  assert.equal(weekLab.source,'lab');

  const occurrences=semesterOccurrences(state).filter(row=>row.lab===true);
  assert.equal(occurrences.length,1);
  assert.equal(occurrences[0].source,'lab');
  assert.equal(occurrences[0].labId,RAW_LAB.courseCode+'|'+RAW_LAB.week+'|1|'+RAW_LAB.sectionCode);

  const card=allCards(buildSemesterOverviewModel(state)).find(item=>item.lab===true);
  assert.ok(card,'总览应包含实验课卡片');
  assert.equal(card.name,'课程A');
  assert.ok(card.sources.includes('lab'));

  const rules=buildRulesModel(state);
  const labCourse=rules.courses.find(course=>course.lab===true);
  assert.ok(labCourse,'规则模型应保留实验课');
  assert.equal(labCourse.name,'课程A');
  const text=buildRulesText(state);
  assert.ok(text.includes('【实验】课程A'));
  assert.ok(text.includes('# 实验课：'));
});

test('同名实验课与普通课在总览和规则文本中不合并',()=>{
  const state=makeState();
  const cards=allCards(buildSemesterOverviewModel(state)).filter(card=>card.name==='课程A');
  assert.equal(cards.length,2,'同名普通课与实验课应各有一张卡片');
  assert.equal(cards.filter(card=>card.lab===true).length,1);
  assert.equal(new Set(cards.map(card=>card.key)).size,2,'两张卡片主键应不同');
  assert.ok(cards.some(card=>card.key.includes('lab:')));

  const courses=buildRulesModel(state).courses.filter(course=>course.name==='课程A');
  assert.equal(courses.length,2,'同名普通课与实验课应各占一行');
  assert.equal(courses.filter(course=>course.lab===true).length,1);

  const lines=buildRulesText(state).split('\n').filter(line=>line.startsWith('课程A\t')||line.startsWith('【实验】课程A\t'));
  assert.equal(lines.length,2);
  assert.ok(lines.some(line=>line.startsWith('【实验】课程A\t')));
  assert.ok(lines.some(line=>line.startsWith('课程A\t')));
});

test('图片层：实验课使用蓝色卡面、角标和图例',()=>{
  const state=makeState();
  const recorder=canvasRecorder();
  renderWeekPages(exportWeekModel(state,3),recorder.createCanvas);
  renderSemesterOverviewPages(buildSemesterOverviewModel(state),recorder.createCanvas);
  assert.ok(recorder.record.texts.includes('【实验】课程A'),'图片文字应带【实验】');
  assert.ok(recorder.record.texts.some(text=>text.includes('实验课')),'图片应显示实验课标签');
  assert.ok(recorder.record.texts.some(text=>text.includes('蓝色卡片：实验课')),'周图应有实验课图例');
  assert.ok(recorder.record.texts.some(text=>text.includes('实验课（蓝色）')),'图片标题应说明实验课颜色');
  assert.ok(recorder.record.fills.some(item=>item.fill==='#e3f2fd'),'实验课卡面应使用浅蓝填充');
  assert.ok(recorder.record.fills.some(item=>item.fill==='#1976d2'&&item.w===6),'实验课应有蓝色左侧角标');
});

test('无实验课数据时图片、总览和规则文本不出现实验课卡片或行',()=>{
  const state=makeState({labs:false});
  const recorder=canvasRecorder();
  renderWeekPages(exportWeekModel(state,3),recorder.createCanvas);
  renderSemesterOverviewPages(buildSemesterOverviewModel(state),recorder.createCanvas);
  assert.equal(allCards(buildSemesterOverviewModel(state)).filter(card=>card.lab===true).length,0);
  assert.equal(semesterOccurrences(state).filter(row=>row.lab===true).length,0);
  assert.ok(!recorder.record.fills.some(item=>item.fill==='#e3f2fd'),'空实验课不应画实验课卡面');
  const text=buildRulesText(state);
  assert.doesNotMatch(text,/【实验】课程A/);
});

test('停课日实验课在周图中标记停课，但不进入总览与规则文本',()=>{
  const state=makeState({extra:{closedDates:[DATE]}});
  const week=exportWeekModel(state,3);
  const cancelled=week.days[0].courses.find(course=>course.lab===true);
  assert.ok(cancelled,'周图应保留停课实验课以显示停课状态');
  assert.equal(cancelled.cancelled,true);

  assert.equal(semesterOccurrences(state).filter(row=>row.lab===true).length,0);
  assert.equal(allCards(buildSemesterOverviewModel(state)).filter(card=>card.lab===true).length,0);
  assert.doesNotMatch(buildRulesText(state),/【实验】课程A/);
});
