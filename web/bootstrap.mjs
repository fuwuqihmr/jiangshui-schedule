import './theme.mjs';
import {showNotice} from './notifications.mjs';
import {requireConsent} from './consent.mjs';
requireConsent().then(()=>import('./app.mjs')).catch(error=>{showNotice('启动失败',{detail:error.message,tone:'error',duration:10000});});
