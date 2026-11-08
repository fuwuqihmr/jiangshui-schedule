import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createState,timetableDay,saveOverride} from '../web/core.mjs';
import {saveCustomCourse} from '../web/custom-courses.mjs';
import {exportWeekModel,imagePagesPdf} from '../web/timetable-export.mjs';
const require=createRequire(import.meta.url),{decodeExport}=require('../desktop/export-file.cjs');
const source={schemaVersion:1,semester:{id:'test',name:'测试学期',startDate:'2026-10-12',weeks:3},rules:[{id:'math',name:'高等数学',room:'A101',teacher:'李老师',weekday:1,weeks:[1,2,3],periods:[1,2],startTime:'08:30',endTime:'09:55'}],exceptions:[],remaps:[],unscheduled:[]};
test('单周导出逐日采用统一有效课表，包含修改、调休空位、自定义与取消',()=>{
 let state=createState(source);
 state=saveOverride(state,timetableDay(state.snapshot,'2026-10-12')[0],{room:'已修改教室'});
 state=saveCustomCourse(state,{mode:'once',date:'2026-10-13',name:'独立加课',startTime:'21:40',endTime:'22:20',room:'B402'});
 state.localMaps=[{id:'move',fromDate:'2026-10-19',date:'2026-10-24',mode:'replace'}];
 const before=JSON.stringify(state),first=exportWeekModel(state,1),second=exportWeekModel(state,2);
 assert.equal(first.days[0].courses[0].room,'已修改教室');assert.equal(first.days[1].courses[0].name,'独立加课');
 assert.ok(second.days[0].courses.some(r=>r.vacant));assert.ok(second.days[5].courses.some(r=>!r.cancelled&&r.name==='高等数学'));
 for(const model of [first,second])for(const day of model.days)assert.deepEqual(day.courses,timetableDay(state.snapshot,day.date,state.overrides,state.localMaps,state.courseSettings,state.customCourses));
 assert.equal(JSON.stringify(state),before);
});
test('空周仍有七个日期，非法周次不会导出其他学期',()=>{
 const state=createState({...source,rules:[]});assert.equal(exportWeekModel(state,3).days.length,7);assert.ok(exportWeekModel(state,3).days.every(d=>!d.courses.length));
 for(const week of [0,4,1.5,'1'])assert.throws(()=>exportWeekModel(state,week));
});
test('PDF字节偏移和图片流长度包含二进制字节',()=>{
 const image=new Uint8Array([255,216,0,13,10,255,217]),pdf=imagePagesPdf([{width:2520,height:1782,bytes:image},{width:2520,height:1782,bytes:image}]);
 const ascii=Buffer.from(pdf).toString('latin1'),xref=Number(/startxref\n(\d+)/.exec(ascii)[1]);assert.equal(ascii.slice(xref,xref+4),'xref');assert.match(ascii,/\/Count 2/);assert.match(ascii,/\/MediaBox \[0 0 841\.89 595\.28\]/);
 const entries=ascii.slice(xref).split('\n').slice(3,11);entries.forEach((line,i)=>{const offset=Number(line.slice(0,10));assert.equal(ascii.slice(offset,offset+`${i+1} 0 obj`.length),`${i+1} 0 obj`);});
 assert.throws(()=>imagePagesPdf([]));
});
test('桌面保存校验类型、扩展名、路径与二进制格式',()=>{
 const pdf=Buffer.from('%PDF-1.4\nexample');const payload={filename:'江水课表.pdf',mime:'application/pdf',base64:pdf.toString('base64')};assert.deepEqual(decodeExport(payload).bytes,pdf);
 for(const bad of [{filename:'../课表.pdf'},{filename:'课表.exe'},{mime:'text/plain'},{base64:'!!!!'},{base64:Buffer.from('wrong').toString('base64')}])assert.throws(()=>decodeExport({...payload,...bad}));
 const png=Buffer.from([137,80,78,71,13,10,26,10]);assert.equal(decodeExport({filename:'课表.png',mime:'image/png',base64:png.toString('base64')}).extension,'png');
});
