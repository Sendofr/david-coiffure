const test=require('node:test');
const assert=require('node:assert/strict');
const {businessDate,plusDays,normalizePhone,requestFields,normalizeSlots,requestIdentity,whatsappUrl}=require('../../dist/booking.js');
const fields={name:'  Ana   Gómez  ',phone:'0985 123 456',service_id:'10000000-0000-4000-8000-000000000001',staff_id:'20000000-0000-4000-8000-000000000001',date:'2026-10-28',time:'14:00',website:''};
test('business dates use America/Asuncion across UTC midnight and year boundaries',()=>{
 assert.equal(businessDate(new Date('2026-10-28T01:00:00Z')),'2026-10-27');
 assert.equal(businessDate(new Date('2027-01-01T01:00:00Z')),'2026-12-31');
 assert.equal(plusDays('2026-12-31',1),'2027-01-01');
});
test('WhatsApp canonicalization matches the protected endpoint and rejects unusable numbers',()=>{
 for(const phone of ['0985 123 456','595985123456','+595 (985) 123-456'])assert.equal(normalizePhone(phone),'+595985123456');
 assert.equal(normalizePhone('+54 911 12345678'),'+5491112345678');
 for(const phone of ['123','0985','abc@example.com','+00012345678','123456789'])assert.throws(()=>normalizePhone(phone));
});
test('public requests contain normalized minimum fields and no arbitrary properties',()=>{
 const result=requestFields({...fields,notes:'not collected',role:'owner'},{today:'2026-10-28'});
 assert.deepEqual(result,{name:'Ana Gómez',phone:'+595985123456',service_id:fields.service_id,staff_id:fields.staff_id,date:fields.date,time:fields.time,website:''});
});
test('validation rejects invalid dates, unavailable horizon, identifiers, contact and honeypot',()=>{
 for(const patch of [{date:'2026-02-30'},{date:'2026-10-27'},{date:'2027-01-27'},{time:'25:00'},{service_id:'s1'},{staff_id:''},{name:'A'},{website:'bot.example'}])assert.throws(()=>requestFields({...fields,...patch},{today:'2026-10-28'}));
 assert.equal(requestFields({...fields,date:'2027-01-26'},{today:'2026-10-28'}).date,'2027-01-26');
 assert.equal(requestFields({...fields,service_id:'s1',staff_id:'demo-professional'},{today:'2026-10-28',demo:true}).service_id,'s1');
});
test('slots are validated, unique and sorted; malformed responses never become fake availability',()=>{
 assert.deepEqual(normalizeSlots([{start_time:'15:00',end_time:'16:00'},{start_time:'13:30',end_time:'14:00'}]),[{start_time:'13:30',end_time:'14:00'},{start_time:'15:00',end_time:'16:00'}]);
 for(const response of [null,[{start_time:'10:00',end_time:'09:00'}],[{start_time:'10:00',end_time:'11:00'},{start_time:'10:00',end_time:'12:00'}],[{start_time:'10:00:00',end_time:'11:00:00'}]])assert.throws(()=>normalizeSlots(response));
});
test('ambiguous network retries reuse the same UUID; changing the actual payload gets a new UUID',()=>{
 let serial=0;const create=()=>String(++serial);
 const first=requestIdentity(null,fields,create);assert.equal(first.id,'1');
 assert.equal(requestIdentity(first,{...fields},create),first);
 const updated=requestIdentity(first,{...fields,time:'15:00'},create);assert.equal(updated.id,'2');
 assert.equal(requestIdentity(updated,{...fields,time:'15:00'},create),updated);
});
test('secondary WhatsApp link is encoded and explicitly communicates pending status',()=>{
 const url=whatsappUrl({...fields,name:'Ana & <script>'},'reference',[{id:fields.service_id,name:'Color & cuidado'}],[{id:fields.staff_id,name:'Profesional'}]);
 assert.ok(url.startsWith('https://wa.me/595985499769?text='));
 const text=new URL(url).searchParams.get('text');assert.match(text,/solicitud pendiente/);assert.match(text,/salón debe confirmar/);assert.match(text,/America\/Asuncion/);assert.match(text,/Ana & <script>/);
});
