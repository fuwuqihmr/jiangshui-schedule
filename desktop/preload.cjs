const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('native',{request:(action,payload={})=>ipcRenderer.invoke('app:request',action,payload)});
