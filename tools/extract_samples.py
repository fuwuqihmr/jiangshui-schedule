from pathlib import Path
from docx import Document
import json,re,datetime
root=Path(__file__).resolve().parents[1]
source=root.parent/'handoff'/'课表同步-交接包'/'03-样例数据'/'课表-调休调整版.docx'
doc=Document(source)
rules=[]
for row in doc.tables[1].rows[1:]:
    v=[re.sub(r'\s+','',c.text) for c in row.cells]
    day='一二三四五六日'.index(v[4][1])+1
    start,end=v[5].split('—')
    rules.append(dict(id='course-'+v[0],name=v[1],teacher=v[2],room=v[3],weekday=day,periods=[int(x) for x in re.findall(r'\d+',v[4])],startTime=start,endTime=end,weeks=[int(x) for x in re.findall(r'\d+',v[6])],exam=v[8]))
base=dict(schemaVersion=1,semester=dict(id='2026-2027-1',name='2026—2027 · 第一学期',startDate='2026-08-31',weeks=18),source=dict(kind='sample',label='交接课表 · 原件样例',exportedAt='2026-09-08'),rules=rules,closedDates=[],remaps=[],exceptions=[],unscheduled=[dict(name=r.cells[0].text,teacher=r.cells[2].text,weeks=r.cells[3].text) for r in doc.tables[17].rows[1:]])
adjusted=json.loads(json.dumps(base)); adjusted['source']=dict(kind='sample',label='交接课表 · 调休调整样例',exportedAt='2026-09-18')
a=datetime.date(2026,9,25)
adjusted['closedDates']=[(a+datetime.timedelta(days=i)).isoformat() for i in range(13)]
adjusted['remaps']=[dict(id='holiday-'+d,date=d,fromDate=f,mode='append') for d,f in [('2026-10-10','2026-09-29'),('2026-10-17','2026-09-30'),('2026-10-24','2026-10-06'),('2026-10-31','2026-10-07')]]
(root/'web'/'data').mkdir(parents=True,exist_ok=True)
for name,data in [('baseline',base),('adjusted',adjusted)]:
    (root/'web'/'data'/f'{name}.json').write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Extracted {len(rules)} rules; {len(adjusted["remaps"])} makeup dates; 13 closure dates. Source: DOCX table rows.')
