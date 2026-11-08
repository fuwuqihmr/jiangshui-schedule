const MAX_BYTES=32*1024*1024;
function validText(bytes){
 try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return text.length>0&&!text.includes('\u0000');}catch{return false;}
}
function decodeExport(payload){
 const mime=payload?.mime,extension=mime==='image/png'?'png':mime==='application/pdf'?'pdf':mime==='text/plain'?'txt':null;
 const filename=payload?.filename,base64=payload?.base64;
 if(!extension||typeof filename!=='string'||filename.length>180||/[\\/:*?"<>|]/.test(filename)||!filename.endsWith('.'+extension))throw Error('导出文件格式无效');
 if(typeof base64!=='string'||base64.length>Math.ceil(MAX_BYTES/3)*4||!base64.length||base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('导出文件大小或编码无效');
 const bytes=Buffer.from(base64,'base64');if(!bytes.length||bytes.length>MAX_BYTES)throw Error('导出文件超过32MB');
 const valid=extension==='pdf'?bytes.subarray(0,5).equals(Buffer.from('%PDF-')):extension==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):validText(bytes);
 if(!valid)throw Error('导出文件内容无效');
 return {mime,filename,extension,bytes};
}
module.exports={decodeExport};
