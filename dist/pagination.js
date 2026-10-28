/* Complete, bounded reads from PostgREST. Financial totals use a database snapshot RPC.
   Independent REST requests cannot promise a transaction snapshot during arbitrary writes.
   Counts and a second ID scan reject observed membership changes rather than returning
   a silently truncated/partial result. No automatic retries of an inconsistent scan. */
(function(root){
"use strict";
function failure(code,message,cause){const error=new Error(message);error.code=code;if(cause)error.cause=cause;return error}
function positiveInteger(value,name,defaultValue){
 const resolved=value===undefined?defaultValue:value;
 if(!Number.isSafeInteger(resolved)||resolved<1)throw TypeError(name+" debe ser un entero positivo.");
 return resolved;
}
async function fetchAll(client,table,options={}){
 if(!client||typeof client.from!=="function")throw TypeError("Se requiere un cliente Supabase.");
 if(typeof table!=="string"||!/^[a-z_][a-z0-9_]*$/i.test(table))throw TypeError("Tabla inválida.");
 const pageSize=Math.min(positiveInteger(options.pageSize,"pageSize",1000),1000);
 const maxRows=positiveInteger(options.maxRows,"maxRows",200000);
 const maxPages=positiveInteger(options.maxPages,"maxPages",1000);
 const filters=options.filters||{};
 if(typeof filters!=="object"||Array.isArray(filters))throw TypeError("filters debe ser un objeto de igualdades.");
 const requestedSelect=options.select===undefined?"*":options.select;
 if(typeof requestedSelect!=="string"||!requestedSelect.trim())throw TypeError("select inválido.");
 // Every projection needs the primary key to advance and verify the scan.
 const select=requestedSelect.split(",").some(column=>["*","id"].includes(column.trim()))?requestedSelect:requestedSelect+",id";
 let pageRequests=0;
 const checkAbort=()=>{if(options.signal?.aborted)throw failure("PAGINATION_ABORTED","La consulta fue cancelada.")};
 function base(projection,countOnly=false){
  checkAbort();
  let query=client.from(table).select(projection,countOnly?{count:"exact",head:true}:undefined);
  for(const [column,value] of Object.entries(filters))query=value===null?query.is(column,null):query.eq(column,value);
  if(options.signal)query=query.abortSignal(options.signal);
  return query;
 }
 async function execute(query){
  checkAbort();let result;
  try{result=await query}catch(cause){checkAbort();throw failure("PAGINATION_REQUEST","No se pudo completar la lectura de "+table+".",cause)}
  checkAbort();
  if(!result||result.error)throw failure(result?.error?.code||"PAGINATION_REQUEST","No se pudo completar la lectura de "+table+".",result?.error);
  return result;
 }
 async function countRows(){
  const result=await execute(base("id",true));
  if(!Number.isSafeInteger(result.count)||result.count<0)throw failure("PAGINATION_COUNT","Supabase no devolvió un conteo exacto de "+table+".");
  if(result.count>maxRows)throw failure("PAGINATION_LIMIT","La consulta de "+table+" supera el límite de lectura; acotá el período o usá el informe del servidor.");
  return result.count;
 }
 const changed=()=>failure("PAGINATION_INCONSISTENT","Los registros de "+table+" cambiaron durante la consulta. Volvé a cargar los datos.");
 const initialCount=await countRows();
 async function scan(projection,expectedIds){
  const rows=[],seen=new Set();let cursor=null;
  for(;;){
   if(++pageRequests>maxPages)throw failure("PAGINATION_LIMIT","Se alcanzó el límite de páginas de "+table+".");
   let query=base(projection).order("id",{ascending:true}).range(0,pageSize-1);
   if(cursor!==null)query=query.gt("id",cursor);
   const {data}=await execute(query);
   if(!Array.isArray(data))throw failure("PAGINATION_RESPONSE","Supabase devolvió una página inválida de "+table+".");
   if(!data.length)break;
   for(const row of data){
    if(!row||typeof row.id!=="string"||!row.id||seen.has(row.id)||cursor!==null&&row.id<=cursor)throw changed();
    if(expectedIds&&expectedIds[rows.length]!==row.id)throw changed();
    seen.add(row.id);cursor=row.id;rows.push(row);
    if(rows.length>initialCount)throw changed();
    if(rows.length>maxRows)throw failure("PAGINATION_LIMIT","Se alcanzó el límite de registros de "+table+".");
   }
   // A gateway may impose a cap smaller than pageSize. Only an empty page is EOF.
  }
  if(rows.length!==initialCount)throw changed();
  return rows;
 }
 const rows=await scan(select);
 if(await countRows()!==initialCount)throw changed();
 // Counts alone miss a deletion paired with an insertion. Compare the entire ID set.
 await scan("id",rows.map(row=>row.id));
 if(await countRows()!==initialCount)throw changed();
 checkAbort();return rows;
}
const api={fetchAll};root.DavidPagination=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
