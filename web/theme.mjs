export const THEMES=[['system','跟随系统'],['blue','江水蓝'],['dark','黑'],['light','白'],['purple','紫']];
const system=matchMedia('(prefers-color-scheme: dark)');
let preference='system',nativeSystemDark;
try{preference=localStorage.getItem('jiangshui-theme')||'system';}catch{}
// A light native Activity can make WebView's media query report light even
// while Android is in dark mode. Read the actual Android configuration.
try{const value=globalThis.Android?.systemDarkMode?.();if(typeof value==='boolean')nativeSystemDark=value;}catch{}
const listeners=new Set();
export function themePreference(){return preference;}
export function resolvedTheme(){return preference==='system'?((nativeSystemDark??system.matches)?'dark':'light'):preference;}
export function applyTheme(value=preference){preference=THEMES.some(t=>t[0]===value)?value:'system';const resolved=resolvedTheme();document.documentElement.dataset.theme=resolved;document.documentElement.style.colorScheme=resolved==='dark'?'dark':'light';const meta=document.querySelector('meta[name="color-scheme"]');if(meta)meta.content=resolved==='dark'?'dark':'light';try{localStorage.setItem('jiangshui-theme',preference);}catch{}for(const callback of listeners)callback(preference,resolved);return resolved;}
export function onThemeChanged(callback){listeners.add(callback);return ()=>listeners.delete(callback);}
globalThis.onNativeSystemThemeChanged=dark=>{if(typeof dark!=='boolean')return;const changed=nativeSystemDark!==dark;nativeSystemDark=dark;if(changed&&preference==='system')applyTheme();};
const mediaChanged=()=>{if(preference==='system')applyTheme();};
if(system.addEventListener)system.addEventListener('change',mediaChanged);else system.addListener(mediaChanged);
applyTheme();
