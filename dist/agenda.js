/* Administrative calendar and schedule editor. PostgreSQL remains authoritative. */
(function(root){
"use strict";
const ZONE="America/Asuncion";
const weekdays=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const statuses={pendiente:"Pendiente",confirmado:"Confirmado","en-proceso":"En proceso",completado:"Completado",cancelado:"Cancelado","no-asistio":"No asistió"};
const activeStatuses=new Set(["pendiente","confirmado","en-proceso"]);
const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function validDate(value){return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+"T12:00:00Z"))&&new Date(value+"T12:00:00Z").toISOString().slice(0,10)===value}
function dayDate(value){if(!validDate(value))throw Error("Fecha inválida.");return new Date(value+"T12:00:00Z")}
function today(now=new Date()){return new Intl.DateTimeFormat("en-CA",{timeZone:ZONE,year:"numeric",month:"2-digit",day:"2-digit"}).format(now)}
function shiftDate(value,amount){const d=dayDate(value);d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10)}
function shiftMonth(value,amount){const d=dayDate(value),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+amount);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0,12)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10)}
function weekStart(value){const d=dayDate(value);return shiftDate(value,-((d.getUTCDay()+6)%7))}
function monthCells(value){const first=value.slice(0,7)+"-01",start=weekStart(first);return Array.from({length:42},(_,i)=>shiftDate(start,i))}
function visibleDates(view,value){return view==="month"?monthCells(value):view==="week"?Array.from({length:7},(_,i)=>shiftDate(weekStart(value),i)):[value]}
function selectAppointments(rows,dates,staffId=""){
 const allowed=new Set(dates);
 return rows.filter(row=>allowed.has(row.appointment_date)&&(!staffId||row.staff_id===staffId)).slice().sort((a,b)=>(a.appointment_date+String(a.start_time)).localeCompare(b.appointment_date+String(b.start_time))||String(a.id).localeCompare(String(b.id)));
}
function parseIntervals(value,weekday){
 const text=String(value||"").trim();if(!text)return [];
 const parsed=text.split(",").map(part=>{
  const match=part.trim().match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
  if(!match||![match[1],match[2]].every(time=>/^([01]\d|2[0-3]):[0-5]\d$/.test(time))||match[1]>=match[2])throw Error("Usá intervalos válidos, por ejemplo 09:00-12:00, 13:00-18:00. No se admiten jornadas que crucen medianoche.");
  return {...(weekday===undefined?{}:{weekday}),start_time:match[1],end_time:match[2]};
 }).sort((a,b)=>a.start_time.localeCompare(b.start_time));
 if(parsed.some((part,i)=>i&&parsed[i-1].end_time>part.start_time))throw Error("Los intervalos laborales no pueden superponerse.");
 return parsed;
}
function formatDate(value,full=false){return dayDate(value).toLocaleDateString("es-PY",{timeZone:"UTC",...(full?{weekday:"long",day:"numeric",month:"long",year:"numeric"}:{day:"2-digit",month:"2-digit"})})}
function create(context){
 let view="week",date=validDate(context.initialDate)?context.initialDate:today(),staffFilter="",generation=0,scheduleStaff="",scheduleCache=null;
 const pending=new WeakSet(),demoSchedules=new Map();
 const canWrite=()=>Boolean(context.canWrite?.());
 const live=()=>Boolean(context.isLive?.());
 const state=()=>context.getState?.()||{appointments:[],staff:[],services:[]};
 const notify=message=>context.toast?.(message);
 const rerender=()=>context.onRender?.();
 const e=context.escapeHTML||escape;
 const named=(table,id,fallback)=>state()[table]?.find(row=>row.id===id)?.name||fallback;
 function accessibleRows(){
  const rows=state().appointments||[],profile=context.getProfile?.();
  if(live()&&!canWrite())return profile?.staff_id?rows.filter(row=>row.staff_id===profile.staff_id):[];
  return rows;
 }
 function professionalOptions(current,all=true){
  const profile=context.getProfile?.();
  const staff=(state().staff||[]).filter(person=>!live()||canWrite()||person.id===profile?.staff_id);
  return (all?'<option value="">Todos los profesionales</option>':"")+staff.map(person=>'<option value="'+e(person.id)+'" '+(person.id===current?"selected":"")+'>'+e(person.name)+(person.active===false?" · inactivo":"")+'</option>').join("");
 }
 function card(appointment){
  const current=appointment.status||"pendiente",actions=[];
  if(canWrite()){
   if(current==="pendiente")actions.push(["confirmado","Confirmar"]);
   if(current==="confirmado")actions.push(["en-proceso","Iniciar"],["completado","Completar"],["no-asistio","No asistió"]);
   if(current==="en-proceso")actions.push(["completado","Completar"]);
   if(activeStatuses.has(current))actions.push(["cancelado","Cancelar"]);
  }
  return '<article class="agenda-card" data-appointment-id="'+e(appointment.id)+'"><div class="agenda-card-top"><strong>'+e(String(appointment.start_time||"").slice(0,5))+"–"+e(String(appointment.end_time||"").slice(0,5))+'</strong><span class="status '+e(current)+'">'+e(statuses[current]||current)+'</span></div><h3>'+e(appointment.client_name)+'</h3><p>'+e(named("services",appointment.service_id,"Servicio archivado"))+'</p><p class="agenda-muted">'+e(named("staff",appointment.staff_id,"Sin asignar"))+'</p>'+(view==="day"?'<p class="agenda-muted">'+e(appointment.client_phone||"")+'</p>':"")+(canWrite()?'<div class="agenda-card-actions">'+(activeStatuses.has(current)?'<button type="button" class="tiny-btn" data-agenda-edit="'+e(appointment.id)+'">Reprogramar</button>':"")+actions.map(([next,label])=>'<button type="button" class="tiny-btn" data-agenda-status="'+next+'" data-id="'+e(appointment.id)+'">'+label+'</button>').join("")+'</div>':"")+'</article>';
 }
 function dayColumn(value,rows){
  const appointments=rows.filter(row=>row.appointment_date===value);
  return '<section class="agenda-day-column '+(value===today()?"is-today":"")+'"><button type="button" class="agenda-day-heading" data-agenda-focus="'+value+'">'+e(weekdays[dayDate(value).getUTCDay()])+" "+e(formatDate(value))+'</button><div class="agenda-day-appointments">'+(appointments.length?appointments.map(card).join(""):'<p class="agenda-empty">Sin turnos.</p>')+'</div></section>';
 }
 function monthGrid(dates,rows){
  return '<div class="agenda-month-weekdays" aria-hidden="true">'+["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(label=>'<span>'+label+'</span>').join("")+'</div><div class="agenda-month-grid">'+dates.map(value=>{
   const list=rows.filter(row=>row.appointment_date===value),pendingCount=list.filter(row=>row.status==="pendiente").length;
   return '<button type="button" class="agenda-month-cell '+(value.slice(0,7)!==date.slice(0,7)?"is-outside ":"")+(value===today()?"is-today":"")+'" data-agenda-focus="'+value+'" aria-label="'+e(formatDate(value,true))+", "+list.length+' turnos"><span class="agenda-month-number">'+Number(value.slice(-2))+'</span>'+(list.length?'<strong>'+list.length+'<span class="agenda-month-count-label"> '+(list.length===1?"turno":"turnos")+'</span></strong>':"")+(pendingCount?'<small>'+pendingCount+' pendiente'+(pendingCount===1?"":"s")+'</small>':"")+'</button>';
  }).join("")+'</div>';
 }
 function render(){
  const dates=visibleDates(view,date),rows=selectAppointments(accessibleRows(),dates,staffFilter),caption=view==="month"?dayDate(date).toLocaleDateString("es-PY",{timeZone:"UTC",month:"long",year:"numeric"}):view==="week"?formatDate(dates[0])+" – "+formatDate(dates[6])+" · "+date.slice(0,4):formatDate(date,true);
  return '<section class="agenda-shell"><div class="admin-titlebar"><div><div class="admin-kicker">DAVID COIFFURE / AGENDA</div><h1>Agenda del salón</h1><p>Horarios de Paraguay · America/Asuncion. Las solicitudes pendientes requieren confirmación.</p></div><div class="agenda-header-actions">'+(canWrite()?'<button type="button" class="admin-outline" data-agenda-action="schedule">Disponibilidad</button><button type="button" class="admin-action" data-agenda-action="new">＋ Nuevo turno</button>':"")+'<button type="button" class="admin-outline" data-agenda-action="refresh">Actualizar</button></div></div><div class="agenda-toolbar"><div class="agenda-date-nav"><button type="button" class="admin-outline" data-agenda-action="prev" aria-label="Período anterior">←</button><button type="button" class="admin-outline" data-agenda-action="today">Hoy</button><button type="button" class="admin-outline" data-agenda-action="next" aria-label="Período siguiente">→</button><label class="agenda-date-label"><span>Fecha</span><input type="date" id="agenda-date" value="'+date+'" min="1900-01-01" max="9999-12-31"/></label></div><div class="agenda-views" role="group" aria-label="Vista de agenda">'+[["day","Día"],["week","Semana"],["month","Mes"]].map(([key,label])=>'<button type="button" data-agenda-view="'+key+'" aria-pressed="'+(view===key)+'" class="'+(view===key?"active":"")+'">'+label+'</button>').join("")+'</div><label class="agenda-staff-label"><span>Profesional</span><select id="agenda-staff">'+professionalOptions(staffFilter)+'</select></label></div><div class="agenda-period-heading"><h2>'+e(caption)+'</h2><span>'+rows.length+' turnos en esta vista</span></div>'+(view==="month"?monthGrid(dates,rows):'<div class="agenda-calendar-scroll"><div class="agenda-calendar agenda-calendar-'+view+'">'+dates.map(value=>dayColumn(value,rows)).join("")+'</div></div>')+'<p class="admin-footer-note">'+(live()?"Datos de Supabase. Actualizá la agenda para recibir nuevas solicitudes. Los cambios se validan nuevamente al guardar.":"MODO DEMO · Turnos ficticios en este navegador, sin reservas reales.")+'</p></section>';
 }
 async function perform(button,operation){
  if(pending.has(button))return;pending.add(button);button.disabled=true;
  const token=generation;
  try{await operation();if(token===generation)notify("Agenda actualizada.")}
  catch(error){if(token===generation)notify(error.message||"No se pudo actualizar la agenda. Volvé a consultar antes de repetir.")}
  finally{pending.delete(button);if(button.isConnected)button.disabled=false}
 }
 function wire(container){
  const shell=container?.querySelector('.agenda-shell');if(!shell)return;
  // Keep the selected day visible in the horizontally scrollable mobile week.
  const scroll=shell.querySelector('.agenda-calendar-scroll');
  if(view==="week"&&scroll&&scroll.clientWidth<700){
   const selected=shell.querySelector('[data-agenda-focus="'+date+'"]')?.closest('.agenda-day-column');
   if(selected)scroll.scrollLeft+=selected.getBoundingClientRect().left-scroll.getBoundingClientRect().left;
  }
  shell.querySelectorAll('[data-agenda-view]').forEach(button=>button.onclick=()=>{view=button.dataset.agendaView;rerender()});
  shell.querySelectorAll('[data-agenda-focus]').forEach(button=>button.onclick=()=>{date=button.dataset.agendaFocus;view="day";rerender()});
  const dateInput=shell.querySelector('#agenda-date');dateInput.onchange=()=>{if(validDate(dateInput.value)){date=dateInput.value;rerender()}};
  shell.querySelector('#agenda-staff').onchange=event=>{staffFilter=event.target.value;rerender()};
  shell.querySelectorAll('[data-agenda-action]').forEach(button=>button.onclick=()=>{
   const action=button.dataset.agendaAction;
   if(action==="new"){if(canWrite())context.openEdit?.(null);return}
   if(action==="schedule"){if(canWrite())showSchedule();return}
   if(action==="refresh"){perform(button,()=>context.refresh?.());return}
   if(action==="today")date=today();
   if(action==="prev"||action==="next"){const direction=action==="next"?1:-1;date=view==="month"?shiftMonth(date,direction):shiftDate(date,direction*(view==="week"?7:1))}
   rerender();
  });
  shell.querySelectorAll('[data-agenda-edit]').forEach(button=>button.onclick=()=>{if(canWrite())context.openEdit?.(button.dataset.agendaEdit)});
  shell.querySelectorAll('[data-agenda-status]').forEach(button=>button.onclick=()=>{
   if(!canWrite())return;
   const appointment=accessibleRows().find(row=>row.id===button.dataset.id);if(!appointment)return;
   perform(button,async()=>{await context.saveAppointment(appointment.id,{status:button.dataset.agendaStatus});await context.refresh?.()});
  });
 }
 function demoSchedule(staffId){
  if(!demoSchedules.has(staffId))demoSchedules.set(staffId,{settings:{public_enabled:false},weekly:[],exceptions:[],timeOff:[],closures:[]});
  return demoSchedules.get(staffId);
 }
 async function result(query){const {data,error}=await query;if(error)throw error;return data}
 async function all(table,filters){
  const client=context.apiClient?.();if(!client)throw Error("No hay sesión de Supabase disponible.");
  if(!root.DavidPagination?.fetchAll)throw Error("No se pudo cargar el lector de datos.");
  return root.DavidPagination.fetchAll(client,table,{filters});
 }
 async function loadSchedule(staffId){
  if(!live())return structuredClone(demoSchedule(staffId));
  const client=context.apiClient?.();if(!client)throw Error("No hay sesión de Supabase disponible.");
  const [settings,weekly,exceptions,timeOff,closures]=await Promise.all([
   result(client.from("staff_booking_settings").select("staff_id,public_enabled").eq("staff_id",staffId).maybeSingle()),
   all("staff_working_hours",{staff_id:staffId}),all("staff_schedule_exceptions",{staff_id:staffId}),all("staff_time_off",{staff_id:staffId}),all("salon_closures",{})
  ]);
  return {settings:settings||{public_enabled:false},weekly,exceptions,timeOff,closures};
 }
 function intervalsText(rows){return rows.slice().sort((a,b)=>String(a.start_time).localeCompare(String(b.start_time))).filter(row=>row.start_time&&row.end_time).map(row=>String(row.start_time).slice(0,5)+"-"+String(row.end_time).slice(0,5)).join(", ")}
 function scheduleMarkup(data){
  const overrideDates=[...new Set(data.exceptions.map(row=>row.date))].sort();
  const removals=(rows,kind)=>rows.map(row=>'<li><span>'+e(formatDate(row.start_date))+" – "+e(formatDate(row.end_date))+(row.reason?" · "+e(row.reason):"")+'</span><button type="button" class="tiny-btn" data-agenda-remove="'+kind+'" data-id="'+e(row.id)+'">Quitar</button></li>').join("");
  return '<div class="agenda-schedule"><label class="form-field">Profesional<select id="agenda-schedule-staff">'+professionalOptions(scheduleStaff,false)+'</select></label><p class="modal-note">'+(live()?"Los horarios y cierres se guardan en Supabase. No se pueden guardar cambios que invaliden turnos futuros activos.":"Configuración de demostración: no cambia el proyecto real.")+'</p><form id="agenda-public-form"><label class="agenda-checkbox"><input type="checkbox" id="agenda-public-enabled" '+(data.settings.public_enabled?"checked":"")+'/> Mostrar este profesional para reservas públicas</label><button type="submit" class="admin-outline">Guardar acceso público</button></form><details open><summary>Semana habitual y descansos</summary><p class="sale-type-hint">Separá los tramos con coma para dejar descansos. Ejemplo: 09:00-12:00, 13:00-18:00. Dejá vacío un día cerrado.</p><form id="agenda-schedule-form"><div class="agenda-weekly-fields">'+[1,2,3,4,5,6,0].map(day=>'<label class="form-field">'+weekdays[day]+'<input name="weekday-'+day+'" value="'+e(intervalsText(data.weekly.filter(row=>row.weekday===day)))+'" placeholder="09:00-12:00, 13:00-18:00" maxlength="160"/></label>').join("")+'</div><button type="submit" class="admin-action">Guardar semana</button></form></details><details><summary>Días especiales y días cerrados</summary><form id="agenda-day-form"><div class="form-stack"><label class="form-field">Fecha<input type="date" id="agenda-day-date" required value="'+today()+'"/></label><label class="agenda-checkbox"><input type="checkbox" id="agenda-day-closed"/> Cerrar todo este día</label><label class="form-field">Tramos especiales<input id="agenda-day-intervals" placeholder="10:00-13:00, 14:00-17:00" maxlength="160"/></label></div><button type="submit" class="admin-action">Guardar día especial</button></form><ul class="agenda-schedule-list">'+overrideDates.map(value=>'<li><span>'+e(formatDate(value))+" · "+e(intervalsText(data.exceptions.filter(row=>row.date===value))||"Cerrado")+'</span><button type="button" class="tiny-btn" data-agenda-remove="exception" data-date="'+value+'">Usar semana habitual</button></li>').join("")+'</ul></details><details><summary>Vacaciones y ausencias</summary>'+rangeForm("agenda-timeoff-form","Registrar ausencia")+'<ul class="agenda-schedule-list">'+removals(data.timeOff,"timeoff")+'</ul></details><details><summary>Cierres de todo el salón</summary><p class="sale-type-hint">Este cierre afecta a todos los profesionales.</p>'+rangeForm("agenda-closure-form","Registrar cierre")+'<ul class="agenda-schedule-list">'+removals(data.closures,"closure")+'</ul></details><p class="admin-footer-note">Zona horaria America/Asuncion. Las reservas pendientes ocupan su horario hasta que el salón las confirme o cancele.</p></div>';
 }
 function rangeForm(id,label){return '<form id="'+id+'"><div class="form-stack two"><label class="form-field">Desde<input type="date" name="start_date" required value="'+today()+'"/></label><label class="form-field">Hasta<input type="date" name="end_date" required value="'+today()+'"/></label><label class="form-field wide">Motivo interno (opcional)<input name="reason" maxlength="200"/></label></div><button type="submit" class="admin-action">'+label+'</button></form>'}
 async function showSchedule(requestedStaff){
  if(!canWrite())return;
  const staff=state().staff||[];if(!staff.length){notify("Primero cargá un profesional en Equipo.");return}
  scheduleStaff=requestedStaff||scheduleStaff||staff[0].id;
  if(!staff.some(person=>person.id===scheduleStaff))scheduleStaff=staff[0].id;
  const token=++generation;
  context.modal?.("Disponibilidad por profesional",'<p class="modal-note">Cargando disponibilidad…</p>');
  try{
   const data=await loadSchedule(scheduleStaff);
   if(token!==generation||!canWrite())return;
   scheduleCache=data;context.modal?.("Disponibilidad por profesional",scheduleMarkup(data));wireSchedule(token);
  }catch(error){if(token===generation&&canWrite())context.modal?.("Disponibilidad no disponible",'<p class="modal-note">No se pudo cargar la configuración completa. Comprobá la sesión y que la migración de agenda esté aplicada. No se reemplazará por horarios ficticios.</p>')}
 }
 function wireSchedule(token){
  const host=root.document?.querySelector('.agenda-schedule');if(!host)return;
  const staffId=scheduleStaff,current=()=>token===generation&&canWrite()&&host.isConnected;
  host.querySelector('#agenda-schedule-staff').onchange=event=>showSchedule(event.target.value);
  const rpc=async(name,body)=>result(context.apiClient().rpc(name,body));
  const bind=(id,operation)=>{const form=host.querySelector('#'+id);form.onsubmit=event=>{
   event.preventDefault();if(!current()||pending.has(form))return;
   pending.add(form);const buttons=[...form.querySelectorAll('button[type="submit"]')];buttons.forEach(button=>button.disabled=true);
   Promise.resolve().then(()=>{if(current())return operation(form)}).then(()=>{if(current()){notify("Disponibilidad guardada.");context.onScheduleChange?.();showSchedule(staffId)}}).catch(error=>{if(current())notify(error.message||"No se pudo guardar. Revisá los turnos existentes antes de repetir.")}).finally(()=>{pending.delete(form);buttons.forEach(button=>button.disabled=false)});
  }};
  bind("agenda-public-form",async()=>{
   const enabled=host.querySelector('#agenda-public-enabled').checked;
   if(live())await result(context.apiClient().from("staff_booking_settings").upsert({staff_id:staffId,public_enabled:enabled},{onConflict:"staff_id"}));
   else demoSchedule(staffId).settings.public_enabled=enabled;
  });
  bind("agenda-schedule-form",async form=>{
   const intervals=[0,1,2,3,4,5,6].flatMap(day=>parseIntervals(form.elements.namedItem('weekday-'+day).value,day));
   if(live())await rpc("replace_working_hours",{p_staff_id:staffId,p_intervals:intervals});
   else demoSchedule(staffId).weekly=intervals;
  });
  bind("agenda-day-form",async()=>{
   const value=host.querySelector('#agenda-day-date').value;if(!validDate(value))throw Error("Elegí una fecha válida.");
   const intervals=host.querySelector('#agenda-day-closed').checked?[]:parseIntervals(host.querySelector('#agenda-day-intervals').value);
   if(!host.querySelector('#agenda-day-closed').checked&&!intervals.length)throw Error("Ingresá al menos un tramo o marcá Cerrar todo este día.");
   if(live())await rpc("replace_schedule_day",{p_staff_id:staffId,p_date:value,p_intervals:intervals});
   else{const schedule=demoSchedule(staffId);schedule.exceptions=schedule.exceptions.filter(row=>row.date!==value);schedule.exceptions.push(...(intervals.length?intervals:[{start_time:null,end_time:null}]).map(row=>({...row,date:value})))}
  });
  const dayClosed=host.querySelector('#agenda-day-closed'),dayIntervals=host.querySelector('#agenda-day-intervals');dayClosed.onchange=()=>dayIntervals.disabled=dayClosed.checked;
  host.querySelector('#agenda-day-date').onchange=event=>{
   const existing=(scheduleCache?.exceptions||[]).filter(row=>row.date===event.target.value);
   dayClosed.checked=existing.some(row=>row.start_time===null&&row.end_time===null);
   dayIntervals.disabled=dayClosed.checked;dayIntervals.value=intervalsText(existing);
  };
  host.querySelector('#agenda-day-date').dispatchEvent(new Event("change"));
  for(const [formId,table,key] of [["agenda-timeoff-form","staff_time_off","timeOff"],["agenda-closure-form","salon_closures","closures"]])bind(formId,async form=>{
   const data=Object.fromEntries(new FormData(form).entries());
   if(!validDate(data.start_date)||!validDate(data.end_date)||data.end_date<data.start_date)throw Error("Revisá el rango de fechas.");
   data.reason=String(data.reason||"").trim();if(table!=="salon_closures")data.staff_id=staffId;
   if(live())await result(context.apiClient().from(table).insert(data));
   else demoSchedule(staffId)[key].push({...data,id:root.crypto?.randomUUID?.()||String(Date.now())});
  });
  host.querySelectorAll('[data-agenda-remove]').forEach(button=>button.onclick=()=>{
   if(!current())return;
   perform(button,async()=>{
    const kind=button.dataset.agendaRemove,table={exception:"staff_schedule_exceptions",timeoff:"staff_time_off",closure:"salon_closures"}[kind];
    if(live()){
     let query=context.apiClient().from(table).delete();
     if(kind==="exception")query=query.eq("staff_id",staffId).eq("date",button.dataset.date);else query=query.eq("id",button.dataset.id);
     await result(query);
    }else{const schedule=demoSchedule(staffId),key={exception:"exceptions",timeoff:"timeOff",closure:"closures"}[kind];schedule[key]=schedule[key].filter(row=>kind==="exception"?row.date!==button.dataset.date:row.id!==button.dataset.id)}
    if(current()){context.onScheduleChange?.();await showSchedule(staffId)}
   });
  });
 }
 function cancelSchedule(){generation++}
 function reset(){cancelSchedule();view="week";date=today();staffFilter="";scheduleStaff="";scheduleCache=null;demoSchedules.clear()}
 return {render,wire,reset,showSchedule,cancelSchedule};
}
const api={create,today,validDate,shiftDate,shiftMonth,weekStart,monthCells,visibleDates,selectAppointments,parseIntervals};
root.DavidAgenda=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
