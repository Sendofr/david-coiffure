const test=require('node:test');
const assert=require('node:assert/strict');
const agenda=require('../../dist/agenda.js');

test('business dates use America/Asuncion rather than host timezone',()=>{
 assert.equal(agenda.today(new Date('2026-10-28T01:30:00Z')),'2026-10-27');
 assert.equal(agenda.today(new Date('2026-10-28T12:30:00Z')),'2026-10-28');
});
test('date operations handle month ends, leap years and Monday-based weeks',()=>{
 assert.equal(agenda.shiftDate('2028-02-28',1),'2028-02-29');
 assert.equal(agenda.shiftDate('2028-02-29',1),'2028-03-01');
 assert.equal(agenda.shiftMonth('2028-01-31',1),'2028-02-29');
 assert.equal(agenda.shiftMonth('2027-01-31',1),'2027-02-28');
 assert.equal(agenda.weekStart('2026-11-01'),'2026-10-26');
 assert.equal(agenda.weekStart('2026-10-26'),'2026-10-26');
 assert.equal(agenda.validDate('2026-02-30'),false);
 assert.equal(agenda.validDate('2028-02-29'),true);
 assert.throws(()=>agenda.shiftDate('not-a-date',1));
});
test('month view has exactly42 ordered cells and crosses year boundaries',()=>{
 const cells=agenda.monthCells('2026-12-16');
 assert.equal(cells.length,42);assert.equal(new Set(cells).size,42);
 assert.equal(cells[0],'2026-11-30');assert.equal(cells.at(-1),'2027-01-10');
 assert.equal(agenda.visibleDates('day','2026-10-28').length,1);
 assert.equal(agenda.visibleDates('week','2026-10-28').length,7);
});
test('calendar filtering preserves input, orders by time and restricts professional',()=>{
 const rows=[{id:'b',appointment_date:'2026-10-28',start_time:'14:00',staff_id:'p1'},{id:'c',appointment_date:'2026-10-29',start_time:'09:00',staff_id:'p1'},{id:'a',appointment_date:'2026-10-28',start_time:'09:00',staff_id:'p2'}];
 assert.deepEqual(agenda.selectAppointments(rows,['2026-10-28']).map(row=>row.id),['a','b']);
 assert.deepEqual(agenda.selectAppointments(rows,['2026-10-28'],'p1').map(row=>row.id),['b']);
 assert.equal(rows[0].id,'b');
});
test('split working intervals support breaks and reject overlaps or midnight crossing',()=>{
 assert.deepEqual(agenda.parseIntervals('09:00-12:00, 13:00-18:00',1),[{weekday:1,start_time:'09:00',end_time:'12:00'},{weekday:1,start_time:'13:00',end_time:'18:00'}]);
 assert.deepEqual(agenda.parseIntervals('',0),[]);
 for(const text of ['09:00-13:00, 12:30-18:00','22:00-02:00','25:00-26:00','9:00-12:00','09:00-09:00'])assert.throws(()=>agenda.parseIntervals(text));
});
function context(overrides={}){return {initialDate:'2026-10-28',getState:()=>({appointments:[{id:'a',client_name:'<img src=x onerror=alert(1)>',client_phone:'000',staff_id:'p1',service_id:'s1',appointment_date:'2026-10-28',start_time:'10:00',end_time:'11:00',status:'pendiente'}],staff:[{id:'p1',name:'Profesional'},{id:'p2',name:'Otro'}],services:[{id:'s1',name:'Servicio'}]}),canWrite:()=>true,isLive:()=>false,...overrides}}
test('render preserves branding classes and escapes client data without inline handlers',()=>{
 const calendar=agenda.create(context());
 const markup=calendar.render();
 assert.match(markup,/Agenda del salón/);assert.match(markup,/America\/Asuncion/);
 assert.match(markup,/data-agenda-view="day"/);assert.match(markup,/data-agenda-view="month"/);
 assert.doesNotMatch(markup,/<img|onclick=|onchange=/);
 assert.match(markup,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.match(markup,/data-agenda-action="schedule"/);
});
test('stylist calendar contains no write controls and filters private rows to assigned staff',()=>{
 const calendar=agenda.create(context({isLive:()=>true,canWrite:()=>false,getProfile:()=>({staff_id:'p2'})}));
 const markup=calendar.render();
 assert.doesNotMatch(markup,/data-agenda-action="new"|data-agenda-action="schedule"|data-agenda-edit|data-agenda-status/);
 assert.doesNotMatch(markup,/<img|onerror=alert/);
 assert.doesNotMatch(markup,/value="p1"/);
});
test('closing the schedule invalidates its pending read instead of reopening a modal',async()=>{
 const previous=globalThis.DavidPagination;
 let finish;const settings=new Promise(resolve=>finish=resolve),modals=[];
 globalThis.DavidPagination={fetchAll:async()=>[]};
 const client={from:()=>({select:()=>({eq:()=>({maybeSingle:()=>settings})})})};
 try{
  const calendar=agenda.create(context({isLive:()=>true,apiClient:()=>client,modal:(title,body)=>modals.push({title,body})}));
  const read=calendar.showSchedule('p1');
  calendar.cancelSchedule();finish({data:{public_enabled:false},error:null});await read;
  assert.equal(modals.length,1);assert.match(modals[0].body,/Cargando disponibilidad/);
 }finally{globalThis.DavidPagination=previous}
});
test('switching professionals ignores a late response for the previous schedule',async()=>{
 const previous=globalThis.DavidPagination,reads=new Map(),modals=[];
 globalThis.DavidPagination={fetchAll:async()=>[]};
 const client={from:()=>({select:()=>({eq:(_,id)=>({maybeSingle:()=>new Promise(resolve=>reads.set(id,resolve))})})})};
 try{
  const calendar=agenda.create(context({isLive:()=>true,apiClient:()=>client,modal:(title,body)=>modals.push({title,body})}));
  const first=calendar.showSchedule('p1'),second=calendar.showSchedule('p2');
  reads.get('p2')({data:{public_enabled:true},error:null});await second;
  const count=modals.length;assert.match(modals.at(-1).body,/value="p2" selected/);
  reads.get('p1')({data:{public_enabled:false},error:null});await first;
  assert.equal(modals.length,count);
 }finally{globalThis.DavidPagination=previous}
});
