const test=require('node:test');
const assert=require('node:assert/strict');
const {fetchAll}=require('../../dist/pagination.js');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const makeRows=n=>Array.from({length:n},(_,i)=>({id:id(i+1),amount_gs:i+1,active:i%2===0}));
function mockClient(original,{cap=1000,hook}={}){
 const store={rows:structuredClone(original),calls:[],pages:0,counts:0};
 const client={from(table){
  const request={table,select:'*',head:false,filters:[],cursor:null,range:null,signal:null};
  const query={
   select(projection,opts){request.select=projection;request.head=Boolean(opts?.head);return query},
   eq(column,value){request.filters.push([column,value]);return query},
   is(column,value){request.filters.push([column,value]);return query},
   order(column,opts){assert.equal(column,'id');assert.equal(opts.ascending,true);return query},
   gt(column,value){assert.equal(column,'id');request.cursor=value;return query},
   range(start,end){request.range=[start,end];assert.equal(start,0);return query},
   abortSignal(signal){request.signal=signal;return query},
   async then(resolve,reject){
    try{
     store.calls.push(request);request.head?store.counts++:store.pages++;
     const altered=await hook?.(request,store);if(altered)return resolve(altered);
     const filtered=store.rows.filter(r=>request.filters.every(([c,v])=>r[c]===v));
     if(request.head)return resolve({count:filtered.length,error:null,data:null});
     const selected=filtered.filter(r=>request.cursor===null||r.id>request.cursor).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).slice(0,Math.min(cap,request.range[1]+1));
     return resolve({data:selected.map(row=>request.select==='id'?{id:row.id}:{...row}),error:null});
    }catch(error){return reject(error)}
   }
  };return query;
 }};
 return {client,store};
}
test('fetches 2,505 rows with range and stable ID order despite a lower server cap',async()=>{
 const rows=makeRows(2505).reverse();const {client,store}=mockClient(rows,{cap:500});
 const output=await fetchAll(client,'sales');
 assert.equal(output.length,2505);assert.equal(new Set(output.map(r=>r.id)).size,2505);
 assert.equal(output.reduce((total,r)=>total+r.amount_gs,0),2505*2506/2);
 assert.equal(output[0].id,id(1));assert.equal(output.at(-1).id,id(2505));
 assert.equal(store.pages,14);assert.equal(store.counts,3);
 assert.ok(store.calls.filter(r=>!r.head).every(r=>r.range[0]===0&&r.range[1]===999));
});
test('exact multiples of the server cap require an empty final page; filters apply to every request',async()=>{
 const {client,store}=mockClient(makeRows(2400),{cap:500});
 const output=await fetchAll(client,'clients',{filters:{active:true},select:'amount_gs'});
 assert.equal(output.length,1200);assert.ok(output.every(row=>row.active));
 assert.ok(store.calls.every(r=>r.filters.some(([k,v])=>k==='active'&&v===true)));
 assert.ok(store.calls.filter(r=>!r.head).some(r=>r.select==='amount_gs,id'));
});
test('empty datasets return no fictitious records',async()=>{
 const {client}=mockClient([]);assert.deepEqual(await fetchAll(client,'expenses'),[]);
});
test('a failed later page rejects the entire read without returning partial financial data',async()=>{
 const {client}=mockClient(makeRows(1600),{cap:500,hook:(r,s)=>!r.head&&s.pages===3?{error:{code:'NETWORK'},data:null}:null});
 await assert.rejects(fetchAll(client,'sales'),{code:'NETWORK'});
});
test('thrown network failures reject and keep the original diagnostic as cause',async()=>{
 const cause=new Error('offline');const {client}=mockClient(makeRows(3),{hook:()=>{throw cause}});
 await assert.rejects(fetchAll(client,'sales'),error=>error.code==='PAGINATION_REQUEST'&&error.cause===cause);
});
test('duplicate/out-of-order IDs are rejected even when the backend ignores the cursor',async()=>{
 const {client}=mockClient(makeRows(1001),{cap:500,hook:(r,s)=>!r.head&&s.pages===2?{data:[{id:id(1)}],error:null}:null});
 await assert.rejects(fetchAll(client,'products'),{code:'PAGINATION_INCONSISTENT'});
});
test('insertions behind the cursor cannot silently omit a row',async()=>{
 const {client}=mockClient(makeRows(1200),{cap:500,hook:(r,s)=>{if(!r.head&&s.pages===2)s.rows.push({id:id(0),amount_gs:7})}});
 await assert.rejects(fetchAll(client,'stock_movements'),{code:'PAGINATION_INCONSISTENT'});
});
test('second ID scan detects count-neutral concurrent deletion plus insertion',async()=>{
 const {client}=mockClient(makeRows(1200),{cap:500,hook:(r,s)=>{if(!r.head&&s.pages===2){s.rows=s.rows.filter(row=>row.id!==id(1));s.rows.push({id:id(0),amount_gs:7})}}});
 await assert.rejects(fetchAll(client,'sales'),{code:'PAGINATION_INCONSISTENT'});
});
test('deletions during scanning reject instead of presenting a shortened collection',async()=>{
 const {client}=mockClient(makeRows(1200),{cap:500,hook:(r,s)=>{if(!r.head&&s.pages===2)s.rows=s.rows.filter(row=>row.id!==id(1200))}});
 await assert.rejects(fetchAll(client,'appointments'),{code:'PAGINATION_INCONSISTENT'});
});
test('membership changes during the verification pass reject',async()=>{
 const {client}=mockClient(makeRows(1001),{cap:500,hook:(r,s)=>{if(!r.head&&s.pages===6)s.rows.push({id:id(0)})}});
 await assert.rejects(fetchAll(client,'services'),{code:'PAGINATION_INCONSISTENT'});
});
test('cancellation before or during a read rejects',async()=>{
 const controller=new AbortController();controller.abort();
 await assert.rejects(fetchAll(mockClient([]).client,'staff',{signal:controller.signal}),{code:'PAGINATION_ABORTED'});
 const next=new AbortController();const {client}=mockClient(makeRows(1001),{hook:(r,s)=>{if(!r.head&&s.pages===2)next.abort()}});
 await assert.rejects(fetchAll(client,'staff',{signal:next.signal}),{code:'PAGINATION_ABORTED'});
});
test('limits and missing exact counts fail closed',async()=>{
 await assert.rejects(fetchAll(mockClient(makeRows(10)).client,'sales',{maxRows:5}),{code:'PAGINATION_LIMIT'});
 await assert.rejects(fetchAll(mockClient(makeRows(10),{cap:1}).client,'sales',{maxPages:2}),{code:'PAGINATION_LIMIT'});
 const {client}=mockClient([],{hook:r=>r.head?{data:null,count:null,error:null}:null});
 await assert.rejects(fetchAll(client,'sales'),{code:'PAGINATION_COUNT'});
});
test('invalid pagination options are rejected before reading',async()=>{
 const {client,store}=mockClient([]);
 for(const options of [{pageSize:0},{pageSize:NaN},{maxRows:-1},{maxPages:1.5},{select:''},{filters:[]}])await assert.rejects(fetchAll(client,'sales',options));
 assert.equal(store.calls.length,0);
});
