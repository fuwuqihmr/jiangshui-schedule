import fs from 'node:fs';
import {buildBundle,normalizeJsxsd} from '../web/jsxsd.mjs';
import {addDays,sourceDay} from '../web/core.mjs';
const rows=JSON.parse(fs.readFileSync(new URL('./jsxsd-rows.json',import.meta.url),'utf8'));
const s=normalizeJsxsd(rows,{monday:'2026-08-31',totalWeeks:25,semesterId:'2026-2027-1',sourceLabel:'学校教务系统 · 本机读取'});
console.log('semester:',s.semester.id,s.semester.startDate,'weeks',s.semester.weeks,'rules',s.rules.length,'source',s.source.label);
const show=(d)=>{console.log(d,sourceDay(s,d).map(r=>`${r.name}|${r.startTime}-${r.endTime}|${r.room}|${r.teacher}`));};
show('2026-10-10');show('2026-09-29');show('2026-12-15');
console.log('rules sample:',s.rules.slice(0,6).map(r=>`${r.name}|周${r.weekday}|${r.periods.join(',')}节|${r.room}|${r.weeks[0]}-${r.weeks[r.weeks.length-1]}周`));
