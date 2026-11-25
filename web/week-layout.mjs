// A course occupies every weekly band its effective time overlaps, even after a local edit.
export const WEEK_SLOTS = Object.freeze([
 [1,2,'08:30','09:55'],[3,4,'10:15','11:40'],[5,6,'14:00','15:25'],
 [7,8,'15:45','17:10'],[9,11,'19:00','21:10']
].map(slot=>Object.freeze(slot)));

export function courseWeekRange(course) {
 const covered=WEEK_SLOTS.flatMap(([, ,start,end],index)=>course.startTime<end&&course.endTime>start?[index]:[]);
 if(covered.length)return {start:covered[0],end:covered.at(-1)};
 // Early, lunchtime and late custom courses must still appear exactly once.
 const start=Math.max(0,WEEK_SLOTS.filter(([, ,time])=>course.startTime>=time).length-1);
 return {start,end:start};
}

export function weekDayBlocks(courses) {
 const ranges=courses.map(course=>({course,...courseWeekRange(course)}));
 const blocks=[];
 for(let start=0;start<WEEK_SLOTS.length;) {
  let end=start;
  // Merge bands connected by a long course; preserve all simultaneous courses in the cell.
  for(let row=start;row<=end;row++)
   for(const range of ranges)if(range.start<=row&&range.end>=row)end=Math.max(end,range.end);
  blocks.push({start,end,courses:ranges.filter(range=>range.start>=start&&range.start<=end).map(range=>range.course)});
  start=end+1;
 }
 return blocks;
}
