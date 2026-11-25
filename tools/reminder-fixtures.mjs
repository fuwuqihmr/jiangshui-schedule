import fs from 'node:fs';
import {createState,clone,effectiveDay,saveOverride} from '../web/core.mjs';
import {saveCustomCourse} from '../web/custom-courses.mjs';
import {reminderWindows} from '../web/reminders.mjs';
const cases=[];const now=Date.parse('2026-10-12T08:00:00+08:00');
const base=JSON.parse(fs.readFileSync('web/data/baseline.json','utf8'));base.source={kind:'school',label:'测试学校课表'};base.rules=[{id:'math',name:'高等数学',room:'C204',teacher:'李老师',weekday:1,weeks:[7,8],periods:[1,2],startTime:'08:30',endTime:'09:55'}];base.closedDates=[];base.remaps=[];base.exceptions=[];
const s={...createState(base),classReminderPreferenceSet:true,classReminders:{enabled:true,leadMinutes:30,afterStartMinutes:5}};
const add=(label,state,time=now)=>cases.push({label,state:clone(state),now:time,events:reminderWindows(state,time),active:reminderWindows(state,time).filter(r=>r.showAt<=time&&time<r.expiresAt).map(r=>r.id)});
for(const [label,time] of [['before',now-1],['opens',now],['start',now+30*60000],['just before expiry',now+35*60000-1],['expiry',now+35*60000]])add(label,s,time);
for(const settings of [{enabled:false,leadMinutes:30,afterStartMinutes:5},{enabled:true,leadMinutes:60,afterStartMinutes:10},{enabled:true,leadMinutes:0,afterStartMinutes:5},{enabled:true,leadMinutes:30,afterStartMinutes:0},{enabled:true,leadMinutes:-1,afterStartMinutes:999},{enabled:'true',leadMinutes:'30',afterStartMinutes:5}])add('settings '+JSON.stringify(settings),{...s,classReminders:settings});
const custom=saveCustomCourse(s,{mode:'once',date:'2026-10-12',name:'独立课程',room:'C101',teacher:'张老师',startTime:'08:30',endTime:'09:00'});add('overlap keeps both',custom);
const mapped=clone(custom);mapped.localMaps=[{id:'map',fromDate:'2026-10-12',date:'2026-10-16',mode:'replace'}];add('moved original keeps once',mapped);add('moved target',mapped,Date.parse('2026-10-16T08:00:00+08:00'));
add('time edit',saveOverride(s,effectiveDay(s.snapshot,'2026-10-12')[0],{startTime:'09:00',endTime:'10:00',room:'当天地点'}));add('cancelled',saveOverride(s,effectiveDay(s.snapshot,'2026-10-12')[0],{cancelled:true}));
const cross=saveCustomCourse(s,{mode:'once',date:'2026-10-13',name:'跨日课程',room:'',teacher:'',startTime:'00:10',endTime:'00:40'});add('before-midnight lead',cross,Date.parse('2026-10-12T23:40:00+08:00'));
const previous=saveCustomCourse({...s,classReminders:{enabled:true,leadMinutes:30,afterStartMinutes:20}},{mode:'once',date:'2026-10-12',name:'跨日保留',room:'',teacher:'',startTime:'23:50',endTime:'23:59'});add('after-midnight retention',previous,Date.parse('2026-10-13T00:05:00+08:00'));
const demo=clone(s);demo.snapshot.source={kind:'sample',label:'内置演示'};add('demo sample skips bundled courses',demo);add('demo sample supports personal course',saveCustomCourse(demo,{mode:'once',date:'2026-10-12',name:'本人新增课程',room:'A101',teacher:'',startTime:'08:30',endTime:'09:00'}));
// Also exercise all established school/custom/study resolver fixtures as reminders.
for(const c of JSON.parse(fs.readFileSync('android/widget-test/custom-fixtures.json','utf8'))){c.state.snapshot.source={kind:'school',label:'原生提醒回归测试'};c.state.classReminders={enabled:true,leadMinutes:30,afterStartMinutes:5};add(c.label,c.state,Date.parse(c.date+'T19:00:00+08:00'));}
fs.writeFileSync('android/widget-test/reminder-fixtures.json',JSON.stringify(cases));
console.log('Generated '+cases.length+' native reminder timing/resolver cases');
