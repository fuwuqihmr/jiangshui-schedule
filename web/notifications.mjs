// Application-wide notices. Appearance is configured by callers, never by user settings.
const notices=[];
let nextId=0;
const exitMilliseconds=240;
function host(){return document.querySelector('#notification-root');}
export function positionNotices(){
 const root=host();if(!root)return;
 const subtitle=document.querySelector('.topbar .title-sub');
 root.style.setProperty('--notice-top',`${Math.max(12,subtitle?Math.ceil(subtitle.getBoundingClientRect().bottom)+8:12)}px`);
}
let positionFrame=0;
function queuePosition(){if(positionFrame)return;positionFrame=requestAnimationFrame(()=>{positionFrame=0;positionNotices();});}
globalThis.addEventListener('resize',queuePosition);
globalThis.addEventListener('scroll',queuePosition,{passive:true});
document.fonts?.ready.then(queuePosition);
function positions(){return new Map(notices.map(n=>[n,n.slot.getBoundingClientRect().top]));}
function moveStack(before){
 for(const n of notices){
  const old=before.get(n);if(old===undefined)continue;
  const delta=old-n.slot.getBoundingClientRect().top;
  n.move?.cancel();
  if(delta&&n.slot.animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches)n.move=n.slot.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:220,easing:'ease-out'});
 }
}
function remove(n){
 const before=positions();clearTimeout(n.timer);clearTimeout(n.exitTimer);n.move?.cancel();n.slot.remove();
 const at=notices.indexOf(n);if(at!==-1)notices.splice(at,1);moveStack(before);
}
export function dismissNotice(id){
 const n=notices.find(n=>n.id===id);if(!n||n.closing)return;
 n.closing=true;clearTimeout(n.timer);n.card.classList.add('is-leaving');
 n.exitTimer=setTimeout(()=>remove(n),matchMedia('(prefers-reduced-motion: reduce)').matches?0:exitMilliseconds);
}
export function showNotice(message,{detail='',tone='info',duration=4200,background,textColor,barColor}={}){
 const root=host();if(!root)return null;positionNotices();
 const before=positions(),id=++nextId;
 const slot=document.createElement('div');slot.className='notice-slot';slot.dataset.noticeId=String(id);
 const card=document.createElement('section');card.className='notice-card';card.dataset.tone=['info','success','warning','error','neutral'].includes(tone)?tone:'info';
 card.setAttribute('role',tone==='error'?'alert':'status');
 for(const [name,value] of [['--notice-bg',background],['--notice-ink',textColor],['--notice-bar',barColor]])if(value)card.style.setProperty(name,value);
 const mark=document.createElement('span');mark.className='notice-mark';mark.setAttribute('aria-hidden','true');mark.textContent=tone==='success'?'✓':tone==='error'||tone==='warning'?'!':'i';
 const content=document.createElement('div');content.className='notice-content';
 const title=document.createElement('strong');title.textContent=String(message);content.append(title);
 if(detail){const description=document.createElement('p');description.textContent=String(detail);content.append(description);}
 const close=document.createElement('button');close.type='button';close.className='notice-close';close.setAttribute('aria-label','关闭提示');close.textContent='×';close.addEventListener('click',()=>dismissNotice(id));
 const track=document.createElement('div');track.className='notice-track';track.setAttribute('aria-hidden','true');
 const bar=document.createElement('div');bar.className='notice-countdown';
 const milliseconds=Number.isFinite(duration)&&duration>0?duration:4200;bar.style.animationDuration=`${milliseconds}ms`;track.append(bar);
 card.append(mark,content,close,track);slot.append(card);root.prepend(slot);
 const n={id,slot,card};notices.unshift(n);
 // Remove the fourth immediately, including a notice which is already sliding out.
 while(notices.length>3)remove(notices[notices.length-1]);
 moveStack(before);n.timer=setTimeout(()=>dismissNotice(id),milliseconds);
 return id;
}
