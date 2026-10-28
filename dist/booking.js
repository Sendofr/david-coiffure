/* Public requests contain only the contact and chosen slot. No admin data or sessions
   are persisted by this widget. PostgreSQL and the protected Edge endpoint authorize
   the operation; a receipt is always pending, never a confirmed appointment. */
(function(root){
"use strict";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function businessDate(now=new Date()){
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Asuncion",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
 const get=type=>parts.find(part=>part.type===type).value;return get("year")+"-"+get("month")+"-"+get("day");
}
function plusDays(date,days){const value=new Date(date+"T12:00:00Z");value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10)}
function normalizePhone(input){
 const raw=String(input||"").trim();if(!/^[+0-9 ()-]{6,30}$/.test(raw))throw Error("Ingresá un WhatsApp válido, por ejemplo 0985 123 456 o +595985123456.");
 let phone=raw.replace(/[ ()-]/g,"");
 if(/^09\d{8}$/.test(phone))phone="+595"+phone.slice(1);
 else if(/^595\d{9}$/.test(phone))phone="+"+phone;
 if(!/^\+[1-9]\d{7,14}$/.test(phone))throw Error("Ingresá un WhatsApp con código de país o un número paraguayo 09XX XXX XXX.");
 return phone;
}
function requestFields(values,{demo=false,today=businessDate()}={}){
 const name=String(values.name||"").normalize("NFC").trim().replace(/\s+/g," ");
 if(/[\p{Cc}\p{Cf}]/u.test(String(values.name||""))||name.length<2||name.length>100||!/^[\p{L}\p{M}][\p{L}\p{M} .’'-]*$/u.test(name))throw Error("Ingresá tu nombre, entre 2 y 100 caracteres, usando letras y signos de nombre.");
 const phone=normalizePhone(values.phone);
 const date=String(values.date||"");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+"T12:00:00Z"))||new Date(date+"T12:00:00Z").toISOString().slice(0,10)!==date||date<today||date>plusDays(today,90))throw Error("Elegí una fecha disponible dentro de los próximos 90 días.");
 const time=String(values.time||"");if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error("Elegí un horario disponible.");
 const service_id=String(values.service_id||""),staff_id=String(values.staff_id||"");
 if(!service_id||!staff_id||(!demo&&(!UUID.test(service_id)||!UUID.test(staff_id))))throw Error("Elegí el servicio y el profesional publicados por el salón.");
 const website=String(values.website||"");if(website)throw Error("No se pudo validar la solicitud.");
 return {name,phone,service_id,staff_id,date,time,website};
}
function normalizeSlots(rows){
 if(!Array.isArray(rows)||rows.length>200)throw Error("No se pudo verificar la disponibilidad.");
 const seen=new Set();
 return rows.map(row=>{
  const start=String(row?.start_time||""),end=String(row?.end_time||"");
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||end<=start||seen.has(start))throw Error("No se pudo verificar la disponibilidad.");
  seen.add(start);return {start_time:start,end_time:end};
 }).sort((a,b)=>a.start_time.localeCompare(b.start_time));
}
function newRequestId(){return root.crypto.randomUUID()}
function requestIdentity(previous,fields,createId=newRequestId){
 const signature=JSON.stringify(fields);
 return previous?.signature===signature?previous:{signature,id:createId()};
}
function whatsappUrl(fields,reference,services=[],professionals=[]){
 const service=services.find(item=>item.id===fields.service_id)?.name||"Servicio seleccionado";
 const staff=professionals.find(item=>item.id===fields.staff_id)?.name||"Profesional seleccionado";
 const lines=["Hola David Coiffure. Envié una solicitud pendiente desde la web.","Referencia: "+reference,"Nombre: "+fields.name,"Servicio: "+service,"Profesional: "+staff,"Fecha: "+fields.date,"Horario: "+fields.time+" (America/Asuncion)","Sé que el salón debe confirmar la cita."];
 return "https://wa.me/595985499769?text="+encodeURIComponent(lines.join("\n"));
}
let turnstilePromise;
function loadTurnstile(){
 if(root.turnstile)return Promise.resolve(root.turnstile);
 if(!turnstilePromise)turnstilePromise=new Promise((resolve,reject)=>{
  const script=root.document.createElement("script");script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";script.async=true;script.defer=true;
  script.onload=()=>root.turnstile?resolve(root.turnstile):reject(Error("No se pudo iniciar la verificación."));
  script.onerror=()=>reject(Error("No se pudo cargar la verificación. Revisá la conexión y recargá la página."));
  root.document.head.append(script);
 });
 return turnstilePromise;
}
function init(options){
 const doc=root.document,form=doc.querySelector("#booking-form");
 if(!form)return {refresh:async()=>{},destroy(){}};
 const requireField=selector=>{const element=form.querySelector(selector);if(!element)throw Error("Falta el campo de reservas "+selector);return element};
 const service=requireField("#booking-service"),staff=requireField("#booking-staff"),date=requireField("#booking-date"),time=requireField("#booking-time"),name=requireField('[name="name"]'),phone=requireField('[name="phone"]'),website=requireField('[name="website"]'),submit=requireField('[type="submit"]'),status=requireField("#booking-status"),receipt=requireField("#booking-receipt"),captcha=requireField("#booking-captcha");
 const getMode=()=>options.getMode?.()||"production",getClient=()=>options.getClient?.(),config=()=>typeof options.config==="function"?options.config():options.config||{},getProject=()=>options.getProject?.()||config().supabaseUrl||"";
 let destroyed=false,refreshSequence=0,slotSequence=0,professionals=[],slots=[],pendingRequest=null,submitted=false,submitting=false,refreshQueued=false,catalogLoading=false,slotsLoading=false,token="",captchaWidget=null,captchaKey="",captchaPromise=null,lastService="",mode=getMode(),project=getProject(),catalogRead=null,slotRead=null;
 const listeners=[];
 const on=(element,event,handler)=>{element.addEventListener(event,handler);listeners.push(()=>element.removeEventListener(event,handler))};
 function message(text,error=false){status.textContent=text;status.classList.toggle("booking-error",error)}
 function setOptions(element,items,placeholder,preferred=element.value){
  const nodes=[new Option(placeholder,"")];for(const item of items)nodes.push(new Option(item.name,item.id));element.replaceChildren(...nodes);if(items.some(item=>item.id===preferred))element.value=preferred;
 }
 function formFields(){return requestFields({name:name.value,phone:phone.value,service_id:service.value,staff_id:staff.value,date:date.value,time:time.value,website:website.value},{demo:getMode()==="demo"})}
 function selectedRetry(){
  if(!pendingRequest?.uncertain)return false;
  try{return pendingRequest.signature===JSON.stringify(formFields())}catch{return false}
 }
 function retryOption(preferred){
  if(!pendingRequest?.uncertain)return [];
  const sent=JSON.parse(pendingRequest.signature);
  return sent.service_id===service.value&&sent.staff_id===staff.value&&sent.date===date.value&&sent.time===preferred?[{id:preferred,name:preferred+" · Recuperar solicitud enviada"}]:[];
 }
 function updateButton(){
  service.disabled=submitting;staff.disabled=submitting||catalogLoading;date.disabled=submitting;time.disabled=submitting||slotsLoading;name.disabled=submitting;phone.disabled=submitting;
  const production=getMode()!=="demo";
  submit.disabled=submitting||submitted||catalogLoading||slotsLoading||!service.value||!staff.value||!date.value||(!slots.some(slot=>slot.start_time===time.value)&&!selectedRetry())||(production&&(!getClient()||!token||!config().bookingTurnstileSiteKey));
  submit.textContent=submitting?"ENVIANDO SOLICITUD…":getMode()==="demo"?"SIMULAR SOLICITUD · DEMO":"SOLICITAR TURNO";
 }
 function resetCaptcha(){token="";if(captchaWidget!==null){try{root.turnstile?.reset(captchaWidget)}catch{}}updateButton()}
 async function ensureCaptcha(){
  if(getMode()==="demo"){captcha.hidden=true;return}
  captcha.hidden=false;const key=config().bookingTurnstileSiteKey;
  if(!key){token="";message("Las solicitudes online todavía no están habilitadas. Consultá al salón por WhatsApp.",true);updateButton();return}
  if(captchaWidget!==null&&captchaKey===key)return;
  if(captchaPromise)return captchaPromise;
  const expectedMode=getMode();
  captchaPromise=(async()=>{
   try{
    const api=await loadTurnstile();if(destroyed||getMode()!==expectedMode)return;
    if(captchaWidget!==null)api.remove(captchaWidget);captchaKey=key;
    captchaWidget=api.render(captcha,{sitekey:key,action:"booking",theme:"light",size:"compact",callback:value=>{if(!destroyed&&getMode()!=="demo"){token=value;updateButton()}},"expired-callback":()=>{token="";updateButton()},"error-callback":()=>{token="";message("La verificación no se completó. Reintentá o recargá la página.",true);updateButton()}});
   }catch(error){if(!destroyed&&getMode()!=="demo"){message(error.message,true);updateButton()}}
   finally{captchaPromise=null}
  })();return captchaPromise;
 }
 function currentSelection(){return service.value+"|"+staff.value+"|"+date.value}
 function demoSlots(){
  const selected=options.getServices?.().find(item=>item.id===service.value);const duration=Number(selected?.duration_minutes)||60;
  const day=new Date(date.value+"T12:00:00Z").getUTCDay();if(!day)return [];
  const entries=[];for(let start=(day===6?10:13)*60;start+duration<=20*60;start+=30){const fmt=value=>String(Math.floor(value/60)).padStart(2,"0")+":"+String(value%60).padStart(2,"0");const start_time=fmt(start),end_time=fmt(start+duration);
   const overlap=(options.getDemoAppointments?.()||[]).some(appointment=>appointment.staff_id===staff.value&&appointment.appointment_date===date.value&&["pendiente","confirmado","en-proceso"].includes(appointment.status)&&appointment.start_time<end_time&&appointment.end_time>start_time);
   if(!overlap)entries.push({start_time,end_time})}return entries;
 }
 async function loadSlots(){
  const sequence=++slotSequence,selection=currentSelection(),activeClient=getClient(),activeMode=getMode(),preferred=time.value;
  slotRead?.abort();slotRead=new AbortController();slots=[];setOptions(time,[],"Elegí servicio, profesional y fecha");slotsLoading=false;
  if(!service.value||!staff.value||!date.value){updateButton();return}
  slotsLoading=true;time.disabled=true;message(activeMode==="demo"?"DEMO: horarios simulados. No representan la agenda real.":"Consultando disponibilidad del salón…");updateButton();
  try{
   let result;
   if(activeMode==="demo")result=demoSlots();
   else{
    if(!activeClient)throw Error("No se pudo conectar con la agenda. Recargá la página o consultá al salón.");
    const {data,error}=await activeClient.rpc("available_slots",{p_staff_id:staff.value,p_service_id:service.value,p_date:date.value}).abortSignal(slotRead.signal);if(error)throw error;result=normalizeSlots(data);
   }
   if(destroyed||sequence!==slotSequence||selection!==currentSelection()||activeMode!==getMode()||activeMode!=="demo"&&activeClient!==getClient())return;
   slots=result;const choices=slots.map(slot=>({id:slot.start_time,name:slot.start_time+" a "+slot.end_time}));
   // An accepted request can occupy its own slot after its response was lost.
   // Keep that exact payload retryable; PostgreSQL still decides idempotence.
   if(!choices.some(item=>item.id===preferred))choices.push(...retryOption(preferred));
   setOptions(time,choices,choices.length?"Elegí un horario disponible":"No hay horarios disponibles",preferred);
   message(activeMode==="demo"?"DEMO: disponibilidad simulada. La prueba no envía solicitudes reales.":!config().bookingTurnstileSiteKey?"Las solicitudes online todavía no están habilitadas. Consultá al salón por WhatsApp.":slots.length?"Horarios en America/Asuncion. La solicitud quedará pendiente hasta que el salón la confirme.":"No hay horarios para esa combinación. Elegí otra fecha o profesional.");
   if(selectedRetry())message("La recepción sigue sin verificar. Reintentá sin cambiar los datos. Referencia de reintento: "+pendingRequest.id,true);
  }catch(error){if(!destroyed&&sequence===slotSequence){slots=[];setOptions(time,retryOption(preferred),"Disponibilidad no verificada",preferred);message(selectedRetry()?"No se pudo consultar disponibilidad. Podés recuperar la misma solicitud con su referencia: "+pendingRequest.id:"No se pudo verificar la disponibilidad. Elegí otra fecha o volvé a intentar.",true)}}
  finally{if(!destroyed&&sequence===slotSequence){slotsLoading=false;time.disabled=false;updateButton()}}
 }
 async function refresh(){
  if(destroyed)return;if(submitting){refreshQueued=true;return}const sequence=++refreshSequence,activeMode=getMode(),activeClient=getClient();
  catalogRead?.abort();slotRead?.abort();catalogRead=new AbortController();slotSequence++;
  if(mode!==activeMode||project!==getProject()){mode=activeMode;project=getProject();pendingRequest=null;submitted=false;receipt.hidden=true;name.value="";phone.value="";token="";professionals=[];slots=[];if(captchaWidget!==null){try{root.turnstile?.remove(captchaWidget)}catch{}captchaWidget=null}}
  const services=(options.getServices?.()||[]).filter(item=>item.active!==false);
  setOptions(service,services,"Seleccioná un servicio",service.value||lastService);lastService=service.value;
  const today=businessDate();date.min=today;date.max=plusDays(today,90);if(!date.value)date.value=plusDays(today,1);
  ensureCaptcha();catalogLoading=true;staff.disabled=true;updateButton();
  try{
   let rows;
   if(activeMode==="demo")rows=(options.getDemoStaff?.()||[{id:"demo-professional",name:"Profesional de ejemplo · DEMO"}]).filter(item=>item.active!==false).map(item=>({id:item.id,name:item.name}));
   else{
    if(!activeClient)throw Error("La conexión con la agenda todavía no está disponible.");
    const {data,error}=await activeClient.rpc("booking_catalog").abortSignal(catalogRead.signal);if(error)throw error;rows=data;
    if(!Array.isArray(rows)||rows.some(item=>!UUID.test(item?.id)||typeof item.name!=="string")||new Set(rows.map(item=>item.id)).size!==rows.length)throw Error("Catálogo no verificado.");
   }
   if(destroyed||sequence!==refreshSequence||activeMode!==getMode()||activeMode!=="demo"&&activeClient!==getClient())return;
   professionals=rows;setOptions(staff,rows,"Seleccioná un profesional");
   if(!rows.length)message("El salón todavía no publicó profesionales para solicitudes online.");
   else if(activeMode==="demo")message("DEMO: prueba con datos y disponibilidad ficticios; no se envían solicitudes.");
   else if(config().bookingTurnstileSiteKey)message("Elegí servicio, profesional y fecha para consultar horarios reales.");
  }catch(error){if(!destroyed&&sequence===refreshSequence){professionals=[];slots=[];setOptions(staff,[],"Agenda no disponible");setOptions(time,[],"Disponibilidad no verificada");message("La agenda online no está disponible. Consultá al salón por WhatsApp.",true)}}
  finally{if(!destroyed&&sequence===refreshSequence){catalogLoading=false;staff.disabled=false;await loadSlots();updateButton()}}
 }
 function showReceipt(fields,reference,demo){
  receipt.replaceChildren();const heading=doc.createElement("strong");heading.textContent=demo?"DEMO · Solicitud simulada":"Solicitud recibida · Pendiente";
  const explanation=doc.createElement("p");explanation.textContent=demo?"Esta prueba solo usa datos ficticios de demostración en este navegador. No se envió una solicitud real al salón.":"El salón debe confirmar la cita. La recepción de esta solicitud no equivale a una cita confirmada.";
  const selection=doc.createElement("p");selection.textContent=(options.getServices?.()||[]).find(item=>item.id===fields.service_id)?.name+" · "+(professionals.find(item=>item.id===fields.staff_id)?.name||"Profesional seleccionado")+" · "+fields.date+" · "+fields.time+" (America/Asuncion)";
  const code=doc.createElement("p");code.className="booking-reference";code.textContent="Referencia: "+reference;receipt.append(heading,explanation,selection,code);
  if(!demo){const link=doc.createElement("a");link.className="underline-link";link.href=whatsappUrl(fields,reference,options.getServices?.()||[],professionals);link.target="_blank";link.rel="noopener";link.textContent="CONSULTAR POR WHATSAPP ↗";receipt.append(link)}
  const again=doc.createElement("button");again.type="button";again.className="booking-again";again.textContent="Nueva solicitud";again.onclick=()=>{submitted=false;pendingRequest=null;receipt.hidden=true;name.value="";phone.value="";time.value="";resetCaptcha();loadSlots();name.focus()};receipt.append(again);receipt.hidden=false;
 }
 async function send(event){
  event.preventDefault();if(submitting||submitted||destroyed)return;
  if(!form.reportValidity())return;
  const activeMode=getMode(),activeClient=getClient();let fields;
  try{fields=formFields();if(!slots.some(slot=>slot.start_time===fields.time)&&!selectedRetry())throw Error("Elegí un horario verificado.");if(activeMode!=="demo"&&(!activeClient||!token||!config().bookingTurnstileSiteKey))throw Error("Completá la verificación antes de solicitar el turno.")}
  catch(error){message(error.message,true);return}
  const captchaToken=token;pendingRequest=requestIdentity(pendingRequest,fields);const requestId=pendingRequest.id;
  submitting=true;receipt.hidden=true;message(activeMode==="demo"?"Preparando simulación…":"Enviando solicitud. Esperá la referencia antes de repetirla.");updateButton();
  try{
   if(activeMode==="demo"){
    if(options.createDemoBooking)await options.createDemoBooking({request_id:requestId,...fields});
    if(destroyed||getMode()!=="demo")return;
    showReceipt(fields,"DEMO-"+requestId,true);submitted=true;message("Simulación completada. No se enviaron datos al salón.");return;
   }
   pendingRequest.uncertain=true;
   const {data,error}=await activeClient.functions.invoke("booking",{body:{request_id:requestId,...fields,captcha_token:captchaToken},timeout:20000});
   if(destroyed||activeMode!==getMode()||activeClient!==getClient())return;
   if(error){const code=error.context?.status||0;pendingRequest.uncertain=![400,403,409,429].includes(code);if(code===409){message("Ese horario ya no está disponible. Elegí otro; no se confirmó una cita.",true);await loadSlots();time.value="";throw Error("El horario cambió. Elegí uno disponible y completá nuevamente la verificación.")}if(code===429)throw Error("Se alcanzó el límite de solicitudes. Esperá 10 minutos antes de volver a intentar.");if(code===400)throw Error("No se pudo validar la solicitud. Revisá los datos y completá nuevamente la verificación.");if(code===403)throw Error("Las solicitudes desde este sitio no están habilitadas. Consultá al salón por WhatsApp.");throw Error("No se pudo confirmar la recepción. Reintentá sin cambiar los datos para evitar duplicados. Referencia de reintento: "+requestId)}
   if(data?.reference!==requestId||data?.status!=="pendiente"){pendingRequest.uncertain=true;throw Error("No se pudo verificar la recepción. Reintentá sin cambiar los datos. Referencia de reintento: "+requestId)}
   pendingRequest.uncertain=false;
   showReceipt(fields,data.reference,false);submitted=true;message("Solicitud recibida y pendiente. El salón debe confirmar la cita.");
  }catch(error){if(!destroyed&&activeMode===getMode())message(pendingRequest?.uncertain&&!String(error.message).includes(requestId)?"No se pudo confirmar la recepción. Reintentá sin cambiar los datos. Referencia de reintento: "+requestId:error.message,true)}
  finally{if(!destroyed){submitting=false;if(activeMode!=="demo")resetCaptcha();updateButton();if(refreshQueued){refreshQueued=false;await refresh()}}}
 }
 function invalidateReceipt(){if(submitting)return;submitted=false;receipt.hidden=true;updateButton()}
 on(form,"submit",send);
 on(service,"change",()=>{lastService=service.value;invalidateReceipt();loadSlots()});on(staff,"change",()=>{invalidateReceipt();loadSlots()});on(date,"change",()=>{invalidateReceipt();loadSlots()});on(time,"change",invalidateReceipt);on(name,"input",invalidateReceipt);on(phone,"input",invalidateReceipt);
 refresh();
 return {refresh,destroy(){destroyed=true;refreshSequence++;slotSequence++;catalogRead?.abort();slotRead?.abort();listeners.forEach(remove=>remove());if(captchaWidget!==null){try{root.turnstile?.remove(captchaWidget)}catch{}}}};
}
const api={init,businessDate,plusDays,normalizePhone,requestFields,normalizeSlots,requestIdentity,whatsappUrl};root.DavidBooking=api;
if(typeof module!=="undefined"&&module.exports)module.exports=api;
})(typeof window!=="undefined"?window:globalThis);
