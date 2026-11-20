// Preloaded only by isolated checks. Prevent any accidental public/customer request.
const net=require('node:net');
const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let options=typeof args[0]==='object'?args[0]:{host:typeof args[1]==='string'?args[1]:'localhost'};
 if(Array.isArray(options))options=options[0];
 const host=options.host||options.hostname||'localhost';
 if(!['localhost','127.0.0.1','::1'].includes(host))throw Error('ISOLATED_NETWORK_REFUSED:'+host);
 return original.apply(this,args);
};
const oldFetch=globalThis.fetch;
globalThis.fetch=(input,...rest)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(!['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname))throw Error('ISOLATED_FETCH_REFUSED:'+url.hostname);
 return oldFetch(input,...rest);
};
