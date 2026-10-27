/* Public configuration and the official Supabase client. No credentials belong here. */
(function(root){
"use strict";
function validatePublicConfig(config){
 if(config.mode!==undefined&&!["demo","production"].includes(config.mode))throw Error("El modo debe ser demo o production.");
 if(config.mode==="demo"&&!config.url&&!config.key&&!config.supabaseUrl&&!config.supabasePublishableKey)return {mode:"demo",url:"",key:""};
 const url=String(config.url||config.supabaseUrl||"").trim().replace(/\/$/,"");
 const key=String(config.key||config.supabasePublishableKey||"").trim();
 let address;try{address=new URL(url)}catch{throw Error("Configurá una URL válida de Supabase.")}
 const cloud=address.protocol==="https:"&&/^[a-z0-9-]+\.supabase\.co$/i.test(address.hostname)&&!address.port;
 const local=address.protocol==="http:"&&["127.0.0.1","localhost"].includes(address.hostname);
 if((!cloud&&!local)||address.username||address.password||address.pathname!=="/"||address.search||address.hash)throw Error("Usá la URL del proyecto Supabase o de su entorno local.");
 let publicKey=/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key);
 if(key.split(".").length===3){
  try{const encoded=key.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");const payload=JSON.parse(atob(encoded));publicKey=payload.role==="anon"}catch{publicKey=false}
 }
 if(!publicKey)throw Error("Usá solamente una publishable key o anon key. Nunca claves secretas o service_role.");
 return {mode:"production",url,key};
}
function resolveConfig(publicConfig={},runtimeConfig={}){
 // A deployed production setting cannot be downgraded by browser storage.
 const selected=publicConfig.mode==="demo"?(runtimeConfig.mode==="production"?runtimeConfig:{mode:"demo"}):{
  mode:publicConfig.mode,url:publicConfig.supabaseUrl,key:publicConfig.supabasePublishableKey
 };
 if(selected.mode==="demo")return {mode:"demo",url:"",key:"",error:null};
 try{if(selected.mode!=="production")throw Error("El modo de la aplicación debe ser demo o production.");return {...validatePublicConfig(selected),error:null}}catch(error){return {mode:"production",url:"",key:"",error:error.message}}
}
function createClient(config){
 if(config.error)throw Error(config.error);
 if(!root.supabase?.createClient)throw Error("No se pudo cargar el SDK de Supabase. Revisá los archivos del sitio.");
 const storageKey="david-auth-"+new URL(config.url).host;
 // A reload during an unfinished logout must not restore the previous session.
 if(root.sessionStorage.getItem(storageKey+"-logout")){
  root.sessionStorage.removeItem(storageKey);root.sessionStorage.removeItem(storageKey+"-logout");
 }
 return root.supabase.createClient(config.url,config.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storage:root.sessionStorage,storageKey}});
}
const api={validatePublicConfig,resolveConfig,createClient};
root.DavidAuth=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
