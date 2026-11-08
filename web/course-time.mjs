// School and personal course times use Asia/Shanghai, independent of the phone time zone.
export function courseOngoing(course, now=Date.now()) {
 if (!course || course.cancelled || course.vacant || !/^\d{4}-\d{2}-\d{2}$/.test(course.date||'') || !/^\d{2}:\d{2}$/.test(course.startTime||'') || !/^\d{2}:\d{2}$/.test(course.endTime||'')) return false;
 const start=Date.parse(`${course.date}T${course.startTime}:00+08:00`), end=Date.parse(`${course.date}T${course.endTime}:00+08:00`);
 return Number.isFinite(start) && Number.isFinite(end) && start<=now && now<end;
}
