export const androidCallbacks=new Map();let requestId=0;
globalThis.onNativeResult=(id,result)=>{const cb=androidCallbacks.get(id);if(cb){androidCallbacks.delete(id);result.error?cb.reject(Error(result.error)):cb.resolve(result.value);}};
export const native=globalThis.native || (globalThis.Android?{request:(action,payload={})=>new Promise((resolve,reject)=>{const id=String(++requestId);androidCallbacks.set(id,{resolve,reject});globalThis.Android.request(id,action,JSON.stringify(payload));})}:null);
export const call=(action,payload={})=>native?native.request(action,payload):Promise.resolve(null);
