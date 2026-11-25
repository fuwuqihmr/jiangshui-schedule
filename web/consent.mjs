import {native,call} from './bridge.mjs';
export const agreement=await (await fetch('./agreement.json')).json();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const consentKey='jiangshui-consent';
export function agreementContent(){return '<p class="agreement-version">更新日期：'+esc(agreement.updatedAt)+' · 版本 '+esc(agreement.version)+'</p><p>'+esc(agreement.intro)+'</p>'+agreement.sections.map(s=>'<section><h3>'+esc(s.title)+'</h3><p>'+esc(s.text)+'</p></section>').join('');}
export async function requireConsent(){
 let status=null;try{status=native?await call('consentStatus'):JSON.parse(localStorage.getItem(consentKey));}catch{}
 if(status?.version===agreement.version&&status?.acceptedAt)return;
 const host=document.querySelector('#app');
 host.innerHTML='<main class="agreement-screen"><section class="agreement-card" aria-labelledby="agreement-title"><div class="agreement-brand">江水课表</div><h1 id="agreement-title">用户协议与 Cookie 授权</h1><div class="agreement-body" tabindex="0">'+agreementContent()+'</div><form id="consent-form"><label class="consent-check"><input type="checkbox" id="consent-check" required><span>我已阅读并同意本协议，授权本软件在本机保存和复用学校登录 Cookie。</span></label><p id="consent-error" role="alert"></p><div class="consent-actions"><button type="button" class="button" id="consent-decline">拒绝并退出</button><button type="submit" class="button primary" id="consent-accept" disabled>同意并使用</button></div></form></section></main>';
 const checkbox=host.querySelector('#consent-check'),accept=host.querySelector('#consent-accept'),decline=host.querySelector('#consent-decline'),error=host.querySelector('#consent-error');let pending=false;
 checkbox.addEventListener('change',()=>{accept.disabled=pending||!checkbox.checked;});
 await new Promise(resolve=>{
  host.querySelector('#consent-form').addEventListener('submit',async event=>{event.preventDefault();if(pending||!checkbox.checked)return;pending=true;accept.disabled=true;decline.disabled=true;error.textContent='';try{let record;if(native)record=await call('acceptConsent',{version:agreement.version});else{record={version:agreement.version,acceptedAt:new Date().toISOString()};localStorage.setItem(consentKey,JSON.stringify(record));}if(record?.version!==agreement.version||!record.acceptedAt)throw Error('协议确认未能保存，请重试');resolve();}catch(e){error.textContent=e.message||'协议确认未能保存，请重试';pending=false;accept.disabled=!checkbox.checked;decline.disabled=false;}});
  decline.addEventListener('click',async()=>{if(pending)return;try{if(native)await call('declineConsent');else error.textContent='尚未同意协议，功能未启用。你可以关闭此页面。';}catch(e){error.textContent=e.message;}});
 });
 host.innerHTML='';
}
