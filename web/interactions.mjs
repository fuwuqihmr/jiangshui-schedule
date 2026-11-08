export const normalized=value=>String(value??'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
export const courseSettingKey=row=>row.customCourseId?'custom/'+row.customCourseId:row.localActivity?'local-evening-study':normalized(row.name);
const subsequence=(text,query)=>{let i=0;for(const ch of text)if(ch===query[i])i++;return i===query.length;};
export function matchesCourse(row,query){const text=normalized([row.name,row.room,row.teacher].join(' ')),terms=String(query??'').trim().split(/\s+/).filter(Boolean);const needles=terms.length>1&&terms.every(t=>/^[a-z0-9]+$/i.test(normalized(t)))&&terms.some(t=>normalized(t).length===1)?[terms.join(' ')]:terms;return needles.every(term=>{const q=normalized(term);return !q||text.includes(q)||subsequence(text,q);});}
export function swipeDirection(start,end){const dx=end.x-start.x,dy=end.y-start.y,elapsed=end.at-start.at;return elapsed>=0&&elapsed<=1100&&Math.abs(dx)>=55&&Math.abs(dx)>Math.abs(dy)*1.5?(dx<0?1:-1):0;}
