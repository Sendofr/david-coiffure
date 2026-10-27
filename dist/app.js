(function(){
"use strict";
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const escapeHTML=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=n=>n==null||n===""?"A consultar":new Intl.NumberFormat("es-PY").format(Number(n))+" Gs.";
const fmtDate=d=>{if(!d)return"—";const p=String(d).split("-");return p.length===3?p[2]+"/"+p[1]+"/"+p[0]:d};
const monthLabel=m=>{const d=new Date(m+"-01T12:00:00");return d.toLocaleDateString("es-PY",{month:"long",year:"numeric"})};
const today=()=>{let x=new Date();return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")};
const addDays=n=>{let x=new Date();x.setDate(x.getDate()+n);return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")};
const id=()=>crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
const stamp=(text,params)=>text.replace(/\{(\w+)\}/g,(_,key)=>escapeHTML(params[key]??""));
const serviceImages=[
 "https://images.unsplash.com/photo-1595476108010-b4d1f102b1b1?auto=format&fit=crop&w=800&q=80",
 "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=800&q=80",
 "https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=800&q=80",
 "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=800&q=80",
 "https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=800&q=80",
 "https://images.unsplash.com/photo-1524250502761-1ac6f2e30d43?auto=format&fit=crop&w=800&q=80"];
const baseServices=[
 {id:"s1",name:"Coloración",category:"COLOR",duration_minutes:120,price_gs:null,active:true},
 {id:"s2",name:"Corte & Styling",category:"CORTE",duration_minutes:60,price_gs:null,active:true},
 {id:"s3",name:"Rubios",category:"COLOR",duration_minutes:180,price_gs:null,active:true},
 {id:"s4",name:"Maquillaje",category:"MAKEUP",duration_minutes:75,price_gs:null,active:true},
 {id:"s5",name:"Tratamientos",category:"CUIDADO",duration_minutes:90,price_gs:null,active:true},
 {id:"s6",name:"Recogidos",category:"STYLING",duration_minutes:75,price_gs:null,active:true},
 {id:"s7",name:"Semirrecogidos",category:"STYLING",duration_minutes:60,price_gs:null,active:true}
];
const seeded=()=>({
 services:baseServices,staff:[{id:"p1",name:"Profesional demo A",specialty:"Coloración",active:true},{id:"p2",name:"Profesional demo B",specialty:"Corte y estilismo",active:true},{id:"p3",name:"Profesional demo C",specialty:"Maquillaje",active:true}],
 clients:[{id:"c1",name:"Clienta de ejemplo 01",phone:"000000001",email:"",notes:"Datos ficticios"},{id:"c2",name:"Clienta de ejemplo 02",phone:"000000002",email:"",notes:"Datos ficticios"}],
 appointments:[{id:"a1",client_name:"Clienta de ejemplo 01",client_phone:"000000001",service_id:"s1",staff_id:"p1",appointment_date:addDays(1),start_time:"14:00",end_time:"16:00",status:"confirmado",notes:"Cita ilustrativa"},{id:"a2",client_name:"Clienta de ejemplo 02",client_phone:"000000002",service_id:"s2",staff_id:"p2",appointment_date:addDays(2),start_time:"15:00",end_time:"16:00",status:"pendiente",notes:"Cita ilustrativa"}],
 products:[{id:"pr1",name:"Color profesional · tono 7.1",sku:"DEMO-COL-071",category:"Consumible",unit:"tubo",stock_qty:4,min_qty:6,cost_gs:40000,sale_price_gs:null,active:true},{id:"pr2",name:"Oxidante profesional",sku:"DEMO-OXI-01",category:"Consumible",unit:"ml",stock_qty:850,min_qty:500,cost_gs:25,sale_price_gs:null,active:true},{id:"pr3",name:"Shampoo cuidado color",sku:"DEMO-SHP-01",category:"Venta",unit:"unidad",stock_qty:9,min_qty:4,cost_gs:65000,sale_price_gs:110000,active:true},{id:"pr4",name:"Mascarilla reparación",sku:"DEMO-MAS-01",category:"Consumible",unit:"g",stock_qty:190,min_qty:250,cost_gs:90,sale_price_gs:null,active:true}],
 stock_movements:[{id:"m1",product_id:"pr1",kind:"entrada",delta_qty:5,note:"Carga inicial demo",created_at:new Date().toISOString()},{id:"m2",product_id:"pr1",kind:"consumo",delta_qty:-1,note:"Aplicación de ejemplo",created_at:new Date().toISOString()}],
 sales:[{id:"sale-demo-1",sale_date:today(),kind:"producto",product_id:"pr3",service_id:null,quantity:1,unit_price_gs:110000,unit_cost_gs:65000,total_gs:110000,cost_total_gs:65000,gross_profit_gs:45000,payment_method:"Efectivo",customer_name:"Cliente demo",notes:"Operación ilustrativa",created_at:new Date().toISOString()},{id:"sale-demo-2",sale_date:today(),kind:"servicio",product_id:null,service_id:"s1",quantity:1,unit_price_gs:180000,unit_cost_gs:40000,total_gs:180000,cost_total_gs:40000,gross_profit_gs:140000,payment_method:"Transferencia",customer_name:"Cliente demo",notes:"Ejemplo, no es tarifa oficial",created_at:new Date().toISOString()}],
 expenses:[{id:"expense-demo-1",expense_date:today(),category:"Operativo",description:"Gasto ilustrativo del salón",amount_gs:65000,created_at:new Date().toISOString()}]
});
const demoKey="david-coiffure-demo-v1";
let state;try{state=JSON.parse(localStorage.getItem(demoKey))||seeded()}catch{state=seeded()}
state.sales=state.sales||[];state.expenses=state.expenses||[];
const persist=()=>{if(!isLive())localStorage.setItem(demoKey,JSON.stringify(state))};
let page="dashboard",search="",filter="todos",userProfile=null,reportMonth=today().slice(0,7);
let settings;try{settings=JSON.parse(localStorage.getItem("david-supabase-config"))||{}}catch{settings={}}
settings.url=settings.url||window.DAVID_CONFIG?.supabaseUrl||"";
settings.key=settings.key||window.DAVID_CONFIG?.supabasePublishableKey||"";
let session;try{session=JSON.parse(localStorage.getItem("david-auth-session"))||null}catch{session=null}
const isLive=()=>Boolean(settings.url&&settings.key);
const toast=msg=>{const t=$("#toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),3100)};
const modal=(title,body)=>{$("#modal-title").textContent=title;$("#modal-body").innerHTML=body;$("#modal-backdrop").hidden=false};
const closeModal=()=>{$("#modal-backdrop").hidden=true;$("#modal-body").innerHTML=""};
$("#modal-close").onclick=closeModal;
$("#modal-backdrop").addEventListener("click",e=>{if(e.target.id==="modal-backdrop")closeModal()});
$("#year").textContent=new Date().getFullYear();
$("#mobile-menu").setAttribute("aria-expanded","false");
$("#mobile-menu").onclick=()=>{const open=$(".main-nav").classList.toggle("open");$("#mobile-menu").setAttribute("aria-expanded",String(open))};
$$(".main-nav a").forEach(a=>a.addEventListener("click",()=>{$(".main-nav").classList.remove("open");$("#mobile-menu").setAttribute("aria-expanded","false")}));
function publicServices(){
 const grid=$("#service-grid");const items=state.services.filter(s=>s.active!==false).slice(0,6);
 grid.innerHTML=items.map((s,i)=>'<a class="service-tile" href="#reservar" style="--photo:url(&quot;'+serviceImages[i%serviceImages.length]+'&quot;)"><small>0'+(i+1)+' / '+escapeHTML(s.category||"ESTILO")+'</small><h3>'+escapeHTML(s.name)+'</h3><div class="tile-bottom"><span>CONSULTAR SERVICIO</span><span class="round-arrow">↗</span></div></a>').join("");
 $("#booking-service").innerHTML='<option value="">Seleccioná un servicio</option>'+state.services.filter(s=>s.active!==false).map(s=>'<option value="'+escapeHTML(s.id)+'">'+escapeHTML(s.name)+'</option>').join("");
}
const dateField=$("#booking-date");dateField.min=today();dateField.value=addDays(1);
function updateTimeOptions(){
 const date=new Date(dateField.value+"T12:00:00");
 const day=date.getDay();const sel=$("#booking-time");
 if(!dateField.value||day===0){sel.innerHTML='<option value="">Sin horarios publicados para domingo</option>';return}
 let start=day===6?10:13;
 const opts=[];for(let hour=start;hour<20;hour++)for(let min of [0,30])opts.push(String(hour).padStart(2,"0")+":"+String(min).padStart(2,"0"));
 sel.innerHTML='<option value="">Elegí un horario de preferencia</option>'+opts.map(t=>'<option value="'+t+'">'+t+' hs</option>').join("");
}
dateField.onchange=updateTimeOptions;updateTimeOptions();publicServices();
$("#booking-form").onsubmit=e=>{
 e.preventDefault();const f=new FormData(e.currentTarget),s=state.services.find(x=>x.id===f.get("service"));
 if(!s)return toast("Seleccioná un servicio");
 const lines=["Hola David Coiffure, quisiera consultar disponibilidad para un turno.","Servicio: "+s.name,"Fecha: "+fmtDate(f.get("date")),"Horario de preferencia: "+f.get("time")+" hs","Nombre: "+f.get("name"),"Teléfono: "+f.get("phone")];
 if(f.get("notes"))lines.push("Observaciones: "+f.get("notes"));
 lines.push("Sé que la reserva está sujeta a confirmación. ¡Gracias!");
 window.open("https://wa.me/595985499769?text="+encodeURIComponent(lines.join("\n")),"_blank","noopener");
 toast("Se abrió WhatsApp para enviar tu solicitud.");
};
const icons={dashboard:"▦",appointments:"▣",clients:"♙",services:"✦",inventory:"▤",movements:"⇄",sales:"◈",expenses:"−",profits:"▥",staff:"♧",settings:"⚙"};
const navItems=[["dashboard","Resumen"],["appointments","Agenda"],["clients","Clientes"],["services","Servicios"],["inventory","Inventario"],["movements","Movimientos"],["sales","Ventas"],["expenses","Gastos"],["profits","Ganancias"],["staff","Equipo"],["settings","Configuración"]];
const canWrite=()=>!isLive()||["owner","manager"].includes(userProfile?.role);
function adminNav(){
 const allowed=canWrite()?navItems:navItems.filter(x=>["dashboard","appointments","services","staff","settings"].includes(x[0]));
 $("#admin-nav").innerHTML=allowed.map(([k,label])=>'<button data-page="'+k+'" class="'+(page===k?"active":"")+'"><span style="font-size:19px;width:20px;text-align:center">'+icons[k]+'</span>'+label+'</button>').join("");
 $$("#admin-nav button").forEach(b=>b.onclick=()=>{page=b.dataset.page;search="";filter="todos";renderAdmin();$(".sidebar").classList.remove("open")});
 $("#admin-current-name").textContent=navItems.find(x=>x[0]===page)?.[1]||"Resumen";
 $("#mode-label").textContent=isLive()?"SUPABASE · DATOS REALES":"MODO DEMOSTRACIÓN";
 $("#connection-status").textContent=isLive()?(session?"Supabase conectado":"Supabase sin sesión"):"Datos de ejemplo";
 $("#connection-button").textContent=isLive()?"Gestionar conexión":"Conectar Supabase";
}
$("#mobile-admin-toggle").onclick=()=>$(".sidebar").classList.toggle("open");
function showAdmin(){ $(".sidebar").classList.remove("open");$(".main-nav").classList.remove("open");$("#mobile-menu").setAttribute("aria-expanded","false");$("#site-view").hidden=true;$("#admin-view").hidden=false;window.scrollTo(0,0);adminNav();if(isLive())loadLive();else renderAdmin() }
function showSite(){ $(".sidebar").classList.remove("open");$("#site-view").hidden=false;$("#admin-view").hidden=true;window.scrollTo(0,0);publicServices() }
$("#open-admin").onclick=showAdmin;$("#footer-admin").onclick=e=>{e.preventDefault();showAdmin()};
$("#mobile-quick-admin").onclick=showAdmin;$("#mobile-nav-admin").onclick=showAdmin;
$("#back-site").onclick=showSite;
$("#connection-button").onclick=connectionDialog;
function title(name,desc,button="",act=""){return '<div class="admin-titlebar"><div><div class="admin-kicker">DAVID COIFFURE / GESTIÓN</div><h1>'+name+'</h1><p>'+desc+'</p></div>'+(button&&canWrite()?'<button class="admin-action" data-action="'+act+'">＋ '+button+'</button>':"")+'</div>'}
function panel(heading,inner,aside=""){return '<section class="panel"><div class="panel-head"><h2>'+heading+'</h2><small>'+aside+'</small></div>'+inner+'</section>'}
function table(headers,rows){return '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>'+headers.map(x=>'<th>'+x+'</th>').join("")+'</tr></thead><tbody>'+rows.join("")+'</tbody></table></div>'}
function td(v,extra=""){return '<td class="'+extra+'">'+v+'</td>'}
function status(s){return '<span class="status '+escapeHTML(s||"pendiente")+'">'+escapeHTML((s||"pendiente").replaceAll("-"," "))+'</span>'}
const serviceName=id=>state.services.find(x=>x.id===id)?.name||"Sin servicio";
const staffName=id=>state.staff.find(x=>x.id===id)?.name||"Sin asignar";
const productName=id=>state.products.find(x=>x.id===id)?.name||"Producto";
const lowStock=()=>state.products.filter(p=>Number(p.stock_qty)<=Number(p.min_qty));
function financials(month=reportMonth){
 const sales=state.sales.filter(s=>String(s.sale_date).slice(0,7)===month);
 const expenses=state.expenses.filter(e=>String(e.expense_date).slice(0,7)===month);
 const revenue=sales.reduce((n,s)=>n+Number(s.total_gs||0),0);
 const directCosts=sales.reduce((n,s)=>n+Number(s.cost_total_gs||0),0);
 const overhead=expenses.reduce((n,e)=>n+Number(e.amount_gs||0),0);
 return {sales,expenses,revenue,directCosts,overhead,gross:revenue-directCosts,balance:revenue-directCosts-overhead};
}
function makeSKU(){
 const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let sku="";
 for(let tries=0;tries<30;tries++){const bytes=new Uint8Array(7);crypto.getRandomValues(bytes);sku="DAV-"+[...bytes].map(x=>alphabet[x%alphabet.length]).join("");if(!state.products.some(p=>p.sku.toUpperCase()===sku))return sku}
 throw Error("No se pudo generar un código. Intentalo nuevamente.");
}
function metric(label,value,caption,icon){return '<div class="metric-card"><div class="metric-top"><span>'+label+'</span><span class="metric-icon">'+icon+'</span></div><div class="metric-value">'+value+'</div><div class="metric-sub">'+caption+'</div></div>'}
function renderDashboard(){
 const upcoming=[...state.appointments].filter(a=>a.appointment_date>=today()&&a.status!=="cancelado").sort((a,b)=>(a.appointment_date+a.start_time).localeCompare(b.appointment_date+b.start_time)).slice(0,6);
 const rows=upcoming.map(a=>'<tr>'+td(fmtDate(a.appointment_date)+" · "+escapeHTML(a.start_time),"strong-cell")+td(escapeHTML(a.client_name))+td(escapeHTML(serviceName(a.service_id)))+td(status(a.status))+'</tr>');
 const alert=lowStock().slice(0,5).map(p=>'<div class="alert-item"><div><strong>'+escapeHTML(p.name)+'</strong><span>'+escapeHTML(p.sku)+" · Mínimo "+escapeHTML(p.min_qty)+" "+escapeHTML(p.unit)+'</span></div><span class="alert-qty">'+escapeHTML(p.stock_qty)+" "+escapeHTML(p.unit)+'</span></div>').join("");
 return title("Buenos días, equipo 👋","Tu salón, organizado en un solo lugar.")+'<div class="insight-banner"><div><strong>'+(isLive()?"Datos sincronizados con el proyecto Supabase":"Vista previa con información ficticia")+'</strong>'+(isLive()?"Administrá turnos, clientes y stock con permisos de acceso.":"Probá el sistema. Los cambios demo se guardan solo en este navegador.")+'</div><button class="admin-outline" data-action="settings">Ver configuración ↗</button></div><div class="metric-grid">'+metric("TURNOS FUTUROS",state.appointments.filter(a=>a.appointment_date>=today()&&a.status!=="cancelado").length,"En agenda","▣")+metric("CLIENTES",state.clients.length,"Fichas registradas","♙")+metric("PRODUCTOS",state.products.length,"Referencias cargadas","▤")+metric("STOCK BAJO",lowStock().length,"Necesitan atención","!")+'</div><div class="dashboard-columns">'+panel("Próximas citas",upcoming.length?table(["FECHA / HORA","CLIENTE","SERVICIO","ESTADO"],rows):'<div class="empty">Todavía no hay citas agendadas.</div>',"AGENDA")+panel("Alertas de inventario",alert||'<div class="empty">No hay alertas de stock.</div>',"REPOSICIÓN")+'</div>';
}
function toolbar(withFilter=false){
 return '<div class="toolbar"><input class="search-input" id="data-search" placeholder="⌕  Buscar..." value="'+escapeHTML(search)+'"/>'+(withFilter?'<div class="filter-tabs">'+["todos","Consumible","Venta"].map(x=>'<button data-filter="'+x+'" class="'+(filter===x?"active":"")+'">'+x+'</button>').join("")+'</div>':"")+'</div>';
}
function renderAppointments(){
 const rows=state.appointments.filter(a=>(a.client_name+" "+serviceName(a.service_id)+" "+a.appointment_date).toLowerCase().includes(search.toLowerCase())).sort((a,b)=>(b.appointment_date+b.start_time).localeCompare(a.appointment_date+a.start_time)).map(a=>'<tr>'+td(fmtDate(a.appointment_date)+" · "+escapeHTML(a.start_time),"strong-cell")+td(escapeHTML(a.client_name)+"<br/><small>"+escapeHTML(a.client_phone)+"</small>")+td(escapeHTML(serviceName(a.service_id)))+td(escapeHTML(staffName(a.staff_id)))+td(status(a.status))+td('<button class="tiny-btn" data-edit="appointments" data-id="'+escapeHTML(a.id)+'">Editar</button>')+'</tr>');
 return title("Agenda de turnos","Organizá las citas y mantené actualizado su estado.","Nuevo turno","new-appointments")+toolbar()+panel("Agenda",rows.length?table(["FECHA / HORA","CLIENTE","SERVICIO","PROFESIONAL","ESTADO",""],rows):'<div class="empty">No encontramos turnos. Probá crear uno nuevo.</div>',state.appointments.length+" registros");
}
function renderClients(){
 const rows=state.clients.filter(c=>(c.name+" "+c.phone+" "+(c.email||"")).toLowerCase().includes(search.toLowerCase())).map(c=>'<tr>'+td(escapeHTML(c.name),"strong-cell")+td(escapeHTML(c.phone))+td(escapeHTML(c.email||"—"))+td(escapeHTML(c.notes||"—"))+td('<button class="tiny-btn" data-edit="clients" data-id="'+escapeHTML(c.id)+'">Editar</button>')+'</tr>');
 return title("Clientes","Consultá y actualizá las fichas del salón.","Nuevo cliente","new-clients")+toolbar()+panel("Directorio de clientes",rows.length?table(["CLIENTE","TELÉFONO","EMAIL","OBSERVACIONES",""],rows):'<div class="empty">No hay clientes para mostrar.</div>',state.clients.length+" fichas");
}
function renderServices(){
 const rows=state.services.filter(s=>(s.name+" "+s.category).toLowerCase().includes(search.toLowerCase())).map(s=>'<tr>'+td(escapeHTML(s.name),"strong-cell")+td(escapeHTML(s.category))+td(escapeHTML(s.duration_minutes)+" min")+td(money(s.price_gs))+td(s.active!==false?status("confirmado"):status("cancelado"))+td('<button class="tiny-btn" data-edit="services" data-id="'+escapeHTML(s.id)+'">Editar</button>')+'</tr>');
 return title("Servicios","Definí las especialidades, tiempos y precios del salón.","Nuevo servicio","new-services")+toolbar()+panel("Catálogo de servicios",rows.length?table(["SERVICIO","CATEGORÍA","DURACIÓN","PRECIO","ACTIVO",""],rows):'<div class="empty">Todavía no hay servicios configurados.</div>');
}
function renderInventory(){
 const list=state.products.filter(p=>(p.name+" "+p.sku+" "+p.category).toLowerCase().includes(search.toLowerCase())&&(filter==="todos"||p.category===filter));
 const rows=list.map(p=>'<tr>'+td(escapeHTML(p.name)+"<br/><small>"+escapeHTML(p.sku)+"</small>","strong-cell")+td(escapeHTML(p.category))+td('<strong style="color:'+(Number(p.stock_qty)<=Number(p.min_qty)?"#b77848":"#75684e")+'">'+escapeHTML(p.stock_qty)+" "+escapeHTML(p.unit)+'</strong>')+td(escapeHTML(p.min_qty)+" "+escapeHTML(p.unit))+td(money(p.cost_gs))+td(money(p.sale_price_gs))+td(p.category==="Venta"&&p.sale_price_gs!=null&&p.cost_gs!=null?money(Number(p.sale_price_gs)-Number(p.cost_gs)):"—")+td('<div class="table-actions"><button class="tiny-btn" data-stock="'+escapeHTML(p.id)+'">Movimiento</button><button class="tiny-btn" data-edit="products" data-id="'+escapeHTML(p.id)+'">Editar</button></div>')+'</tr>');
 return title("Inventario","Cargá precio de compra y venta, y llevá el control de existencias.","Nuevo producto","new-products")+'<div class="metric-grid">'+metric("REFERENCIAS",state.products.length,"En el inventario","▤")+metric("CONSUMIBLES",state.products.filter(x=>x.category==="Consumible").length,"Uso interno","◈")+metric("VENTA",state.products.filter(x=>x.category==="Venta").length,"Para mostrador","◉")+metric("STOCK BAJO",lowStock().length,"Para reponer","!")+'</div>'+toolbar(true)+panel("Productos e insumos",rows.length?table(["PRODUCTO / SKU","TIPO","STOCK","MÍNIMO","COMPRA UNIT.","VENTA UNIT.","MARGEN UNIT.",""],rows):'<div class="empty">No hay productos para mostrar.</div>')+'<p class="admin-footer-note">El margen unitario es precio de venta menos precio de compra, antes de otros gastos. El stock se carga desde Movimientos.</p>';
}
function renderMovements(){
 const rows=[...state.stock_movements].sort((a,b)=>(b.created_at||"").localeCompare(a.created_at||"")).map(m=>'<tr>'+td(new Date(m.created_at).toLocaleString("es-PY"),"strong-cell")+td(escapeHTML(productName(m.product_id)))+td(escapeHTML(m.kind))+td('<b style="color:'+(Number(m.delta_qty)>=0?"#3e8960":"#aa7752")+'">'+(Number(m.delta_qty)>0?"+":"")+escapeHTML(m.delta_qty)+'</b>')+td(escapeHTML(m.note||"—"))+'</tr>');
 return title("Movimientos de stock","Cada entrada o salida queda registrada con su motivo.","Registrar movimiento","new-movement")+panel("Historial de inventario",rows.length?table(["FECHA","PRODUCTO","TIPO","VARIACIÓN","NOTA"],rows):'<div class="empty">Todavía no hay movimientos registrados.</div>',state.stock_movements.length+" registros");
}
function monthSelector(){
 return '<div class="toolbar"><label class="form-field"><span style="font-size:11px;color:#80745f">Mes para analizar</span><input type="month" id="report-month" class="search-input" value="'+escapeHTML(reportMonth)+'"/></label></div>';
}
function saleSubject(s){
 return s.kind==="producto"?productName(s.product_id):serviceName(s.service_id);
}
function renderSales(){
 const fin=financials(),rows=[...fin.sales].sort((a,b)=>String(b.sale_date).localeCompare(String(a.sale_date))).map(s=>'<tr>'+td(fmtDate(s.sale_date),"strong-cell")+td(escapeHTML(saleSubject(s))+"<br/><small>"+escapeHTML(s.kind==="producto"?"Producto":"Servicio")+"</small>")+td(escapeHTML(s.quantity))+td(money(s.unit_price_gs))+td(money(s.total_gs))+td(money(s.gross_profit_gs))+td(escapeHTML(s.payment_method||"—"))+'</tr>');
 return title("Ventas","Registrá productos vendidos y servicios realizados.","Registrar venta","new-sale")+monthSelector()+'<div class="metric-grid">'+metric("VENTAS DEL MES",fin.sales.length,"Operaciones registradas","◈")+metric("INGRESOS",money(fin.revenue),"Total cobrado","₲")+metric("COSTOS DIRECTOS",money(fin.directCosts),"Costo asignado","−")+metric("GANANCIA BRUTA",money(fin.gross),"Antes de gastos generales","▥")+'</div>'+panel("Historial de ventas",rows.length?table(["FECHA","PRODUCTO / SERVICIO","CANTIDAD","PRECIO UNIT.","TOTAL","MARGEN BRUTO","PAGO"],rows):'<div class="empty">No hay ventas registradas en este mes.</div>',monthLabel(reportMonth));
}
function renderExpenses(){
 const fin=financials(),rows=[...fin.expenses].sort((a,b)=>String(b.expense_date).localeCompare(String(a.expense_date))).map(e=>'<tr>'+td(fmtDate(e.expense_date),"strong-cell")+td(escapeHTML(e.category||"General"))+td(escapeHTML(e.description||"—"))+td(money(e.amount_gs))+td('<button class="tiny-btn" data-edit="expenses" data-id="'+escapeHTML(e.id)+'">Editar</button>')+'</tr>');
 return title("Gastos del salón","Anotá alquiler, servicios, suministros y otros gastos.","Agregar gasto","new-expenses")+monthSelector()+'<div class="metric-grid">'+metric("GASTOS DEL MES",money(fin.overhead),"Total anotado","−")+metric("REGISTROS",fin.expenses.length,"Gastos individuales","▤")+metric("INGRESOS",money(fin.revenue),"Ventas y servicios","₲")+metric("BALANCE ESTIMADO",money(fin.balance),"Ingresos − costos − gastos","▥")+'</div>'+panel("Detalle de gastos",rows.length?table(["FECHA","CATEGORÍA","DETALLE","IMPORTE",""],rows):'<div class="empty">No hay gastos registrados en este mes.</div>',monthLabel(reportMonth));
}
function renderProfits(){
 const fin=financials();const history=[];for(let i=5;i>=0;i--){const d=new Date(reportMonth+"-01T12:00:00");d.setMonth(d.getMonth()-i);const m=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");history.push({...financials(m),month:m})}
 const max=Math.max(1,...history.map(x=>Math.max(x.revenue,x.balance)));
 const bars='<div class="mini-bars finance-chart">'+history.map(x=>'<div class="bar-group"><div class="bar-pair"><div class="bar bar-revenue" title="Ingresos: '+money(x.revenue)+'" style="height:'+Math.max(3,150*Math.max(0,x.revenue)/max)+'px"></div><div class="bar bar-profit" title="Balance estimado: '+money(x.balance)+'" style="height:'+Math.max(3,150*Math.max(0,x.balance)/max)+'px"></div></div><small>'+escapeHTML(x.month.slice(5))+"/"+escapeHTML(x.month.slice(2,4))+'</small></div>').join("")+'</div><div class="chart-legend"><span><i class="legend-revenue"></i> Ingresos</span><span><i class="legend-profit"></i> Balance estimado</span></div>';
 const detail='<div class="finance-breakdown"><div class="finance-line"><span>Ingresos por ventas y servicios</span><strong>'+money(fin.revenue)+'</strong></div><div class="finance-line"><span>Costos directos de productos y servicios</span><strong>− '+money(fin.directCosts)+'</strong></div><div class="finance-line"><span>Ganancia bruta</span><strong>'+money(fin.gross)+'</strong></div><div class="finance-line"><span>Gastos generales registrados</span><strong>− '+money(fin.overhead)+'</strong></div><div class="finance-total"><span>Resultado mensual estimado</span><strong>'+money(fin.balance)+'</strong></div></div>';
 return title("Ganancias y resultados","Analizá lo que entra, lo que cuesta y lo que queda.")+monthSelector()+'<div class="metric-grid">'+metric("INGRESOS",money(fin.revenue),"Ventas registradas","₲")+metric("COSTO DIRECTO",money(fin.directCosts),"Compra e insumos estimados","−")+metric("GASTOS",money(fin.overhead),"Gastos del mes","▤")+metric("RESULTADO ESTIMADO",money(fin.balance),"No equivale a utilidad contable","▥")+'</div><div class="finance-pair">'+panel("Cómo se calcula el resultado",detail,monthLabel(reportMonth))+panel("Evolución de seis meses",bars,"RESUMEN")+'</div><div class="insight-banner"><div><strong>¿Cómo leer este resultado?</strong>Se calcula como ingresos menos costos directos cargados en cada venta y gastos anotados. No reemplaza la contabilidad: faltan impuestos, depreciación y cualquier costo que no se registre. Para servicios, cargá también el costo directo aproximado. Evitá registrar la compra de mercadería como gasto general si ya se descuenta como costo de los productos vendidos.</div></div>';
}
function renderFinancialOverview(){
 const fin=financials(today().slice(0,7));
 return '<div style="margin-top:24px">'+panel("Este mes · Ventas y ganancias",'<div class="metric-grid">'+metric("INGRESOS",money(fin.revenue),"Ventas y servicios","₲")+metric("GANANCIA BRUTA",money(fin.gross),"Después de costos directos","◈")+metric("GASTOS",money(fin.overhead),"Gastos ingresados","−")+metric("RESULTADO",money(fin.balance),"Balance estimado","▥")+'</div><button class="admin-outline" data-action="profits">Ver informe mensual ↗</button>',monthLabel(today().slice(0,7)))+'</div>';
}
function renderStaff(){
 const rows=state.staff.filter(s=>(s.name+" "+(s.specialty||"")).toLowerCase().includes(search.toLowerCase())).map(s=>'<tr>'+td(escapeHTML(s.name),"strong-cell")+td(escapeHTML(s.specialty||"—"))+td(s.active!==false?status("confirmado"):status("cancelado"))+td('<button class="tiny-btn" data-edit="staff" data-id="'+escapeHTML(s.id)+'">Editar</button>')+'</tr>');
 return title("Equipo profesional","Organizá quiénes forman parte del equipo.","Nuevo profesional","new-staff")+toolbar()+panel("Profesionales",rows.length?table(["NOMBRE","ESPECIALIDAD","ACTIVO",""],rows):'<div class="empty">Todavía no hay profesionales registrados.</div>');
}
function renderSettings(){
 return title("Configuración","Conexión, seguridad y datos del salón.")+panel("Estado de la plataforma",'<div class="kpi-row"><span>Modo actual</span><strong>'+(isLive()?"Supabase":"Demostración local")+'</strong></div><div class="kpi-row"><span>Datos administrativos</span><strong>'+(isLive()?"Controlados por RLS":"Ficticios en navegador")+'</strong></div><div class="kpi-row"><span>Contacto público</span><strong>+595 985 499769</strong></div><div class="kpi-row"><span>Reservas desde la web</span><strong>Solicitud por WhatsApp</strong></div><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:23px"><button class="admin-action" data-action="connect">'+(isLive()?"Administrar Supabase":"Conectar Supabase")+'</button>'+(isLive()?'<button class="admin-outline" data-action="logout">Cerrar sesión</button>':'<button class="admin-outline" data-action="reset-demo">Restaurar datos demo</button>')+'</div>')+'<div class="admin-footer-note">Importante: esta versión no genera comprobantes tributarios, no cobra online ni envía recordatorios automáticos. La solicitud pública por WhatsApp no bloquea ningún turno.</div>';
}
function renderAdmin(){
 $("#admin-view").classList.toggle("admin-readonly",!canWrite());
 adminNav();
 if(isLive()&&!userProfile){$("#admin-content").innerHTML=title("Acceso protegido","Iniciá sesión con tu usuario autorizado.")+panel("Conectar al panel",'<div class="empty">Para administrar información real es necesario iniciar sesión y tener un perfil habilitado. <br/><br/><button class="admin-action" data-action="connect">Iniciar sesión</button></div>');wireActions();return}
 const components={dashboard:renderDashboard,appointments:renderAppointments,clients:renderClients,services:renderServices,inventory:renderInventory,movements:renderMovements,sales:renderSales,expenses:renderExpenses,profits:renderProfits,staff:renderStaff,settings:renderSettings};
 $("#admin-content").innerHTML=(components[page]||renderDashboard)()+(page==="dashboard"&&canWrite()?renderFinancialOverview():"")+'<p class="admin-footer-note">'+(isLive()?"Datos del proyecto Supabase. El acceso y los cambios están sujetos a permisos de usuario.":"MODO DEMO · Información y personas ficticias. Los cambios solo se conservan en este navegador.")+'</p>';
 wireActions();
}
function wireActions(){
 $$("#admin-content [data-action]").forEach(b=>b.onclick=()=>{
 const a=b.dataset.action;
 if(a==="connect")connectionDialog();
 else if(a==="settings"){page="settings";renderAdmin()}
 else if(a==="profits"){page="profits";reportMonth=today().slice(0,7);renderAdmin()}
 else if(a==="logout")logout();
 else if(a==="reset-demo"){if(confirm("¿Restaurar todos los datos ficticios?")){state=seeded();persist();renderAdmin();toast("Demo restaurada.")}}
 else if(a==="new-movement")movementDialog();
 else if(a==="new-sale")saleDialog();
 else if(a.startsWith("new-"))editDialog(a.slice(4));
 });
 $$("#admin-content [data-edit]").forEach(b=>b.onclick=()=>editDialog(b.dataset.edit,b.dataset.id));
 $$("#admin-content [data-stock]").forEach(b=>b.onclick=()=>movementDialog(b.dataset.stock));
 const q=$("#data-search");if(q)q.oninput=e=>{const pos=e.target.selectionStart;search=e.target.value;const fn={appointments:renderAppointments,clients:renderClients,services:renderServices,inventory:renderInventory,staff:renderStaff}[page];if(fn){$("#admin-content").innerHTML=fn();wireActions();const nq=$("#data-search");nq.focus();nq.setSelectionRange(pos,pos)}};
 const m=$("#report-month");if(m)m.onchange=e=>{reportMonth=e.target.value||today().slice(0,7);renderAdmin()};
 $$("#admin-content [data-filter]").forEach(b=>b.onclick=()=>{filter=b.dataset.filter;renderAdmin()});
}
const input=(name,label,value="",type="text",attrs="")=>'<div class="form-field"><label for="field-'+name+'">'+label+'</label><input id="field-'+name+'" name="'+name+'" type="'+type+'" value="'+escapeHTML(value)+'" '+attrs+' /></div>';
const select=(name,label,options,current)=>'<div class="form-field"><label for="field-'+name+'">'+label+'</label><select id="field-'+name+'" name="'+name+'">'+options.map(([v,l])=>'<option value="'+escapeHTML(v)+'" '+(String(v)===String(current)?"selected":"")+'>'+escapeHTML(l)+'</option>').join("")+'</select></div>';
const textArea=(name,label,value="")=>'<div class="form-field wide"><label for="field-'+name+'">'+label+'</label><textarea id="field-'+name+'" name="'+name+'" rows="2">'+escapeHTML(value)+'</textarea></div>';
function editDialog(type,recordId){
 const record=recordId?state[type].find(x=>String(x.id)===String(recordId)):{};
 if(!record){toast("Registro no encontrado.");return}
 const r=record,opts=state.services.map(s=>[s.id,s.name]),pros=[["","Sin asignar"],...state.staff.filter(x=>x.active!==false).map(s=>[s.id,s.name])];
 let fields="";
 if(type==="appointments"){
 fields=input("client_name","Nombre del cliente",r.client_name||"","text","required maxlength=100")+input("client_phone","WhatsApp",r.client_phone||"","tel","required maxlength=30")+select("service_id","Servicio",opts,r.service_id||opts[0]?.[0])+select("staff_id","Profesional",pros,r.staff_id||"")+input("appointment_date","Fecha",r.appointment_date||today(),"date","required")+input("start_time","Hora de inicio",r.start_time||"14:00","time","required")+select("status","Estado",[["pendiente","Pendiente"],["confirmado","Confirmado"],["en-proceso","En proceso"],["completado","Completado"],["cancelado","Cancelado"],["no-asistio","No asistió"]],r.status||"pendiente")+textArea("notes","Observaciones",r.notes);
 }else if(type==="clients"){
 fields=input("name","Nombre completo",r.name||"","text","required maxlength=100")+input("phone","Teléfono",r.phone||"","tel","required maxlength=30")+input("email","Email (opcional)",r.email||"","email")+textArea("notes","Notas internas",r.notes);
 }else if(type==="services"){
 fields=input("name","Nombre del servicio",r.name||"","text","required")+input("category","Categoría",r.category||"COLOR","text","required")+input("duration_minutes","Duración (min)",r.duration_minutes||60,"number","min=15 max=600 required")+input("price_gs","Precio (Gs., opcional)",r.price_gs??"","number","min=0")+select("active","Mostrar servicio",[["true","Sí"],["false","No"]],String(r.active!==false));
 }else if(type==="products"){
 fields=input("name","Producto",r.name||"","text","required")+'<div class="form-field wide"><label for="field-sku">Código interno (SKU)</label><div class="code-field"><input id="field-sku" name="sku" value="'+escapeHTML(r.sku||"")+'" placeholder="Ej.: DAV-COL-001" maxlength="50" required/><button type="button" id="generate-sku">Generar código</button></div><small class="sale-type-hint">Podés escribir el tuyo o generar uno único. No es obligatorio usar un código automático.</small></div>'+select("category","Tipo",[["Consumible","Consumo interno"],["Venta","Para venta"]],r.category||"Consumible")+select("unit","Unidad",[["unidad","Unidad"],["tubo","Tubo"],["ml","Mililitros"],["g","Gramos"]],r.unit||"unidad")+input("min_qty","Stock mínimo",r.min_qty??0,"number","min=0 step=any required")+input("cost_gs","Precio de compra unitario (Gs.)",r.cost_gs??"","number","min=0 step=any required")+input("sale_price_gs","Precio de venta unitario (Gs.)",r.sale_price_gs??"","number","min=0 step=any")+ (recordId?"":'<div class="modal-note wide">El producto empieza con stock cero. Cargá las existencias mediante una entrada en Movimientos.</div>');
 }else if(type==="staff"){
 fields=input("name","Nombre del profesional",r.name||"","text","required")+input("specialty","Especialidad",r.specialty||"","text")+select("active","Activo",[["true","Sí"],["false","No"]],String(r.active!==false));
 }else if(type==="expenses"){
 fields=input("expense_date","Fecha",r.expense_date||today(),"date","required")+select("category","Categoría",[["Operativo","Operativo"],["Alquiler","Alquiler"],["Servicios básicos","Servicios básicos"],["Sueldos","Sueldos"],["Marketing","Marketing"],["Otros","Otros"]],r.category||"Operativo")+input("description","Descripción",r.description||"","text","required maxlength=180")+input("amount_gs","Importe (Gs.)",r.amount_gs??"","number","required min=0.01 step=any");
 }else return;
 modal((recordId?"Editar ":"Nuevo ")+({appointments:"turno",clients:"cliente",services:"servicio",products:"producto",staff:"profesional",expenses:"gasto"}[type]),'<form id="edit-form"><div class="form-stack two">'+fields+'</div><div class="modal-footer"><button type="button" class="admin-outline" id="cancel-edit">Cancelar</button><button class="admin-action" type="submit">Guardar cambios</button></div></form>');
 $("#cancel-edit").onclick=closeModal;
 const gen=$("#generate-sku");if(gen)gen.onclick=()=>{try{$("#field-sku").value=makeSKU();toast("Código generado. También podés editarlo.")}catch(err){toast(err.message)}};
 $("#edit-form").onsubmit=async e=>{
 e.preventDefault();const body=Object.fromEntries(new FormData(e.currentTarget).entries());
 if(type==="appointments"){
 const s=state.services.find(x=>x.id===body.service_id);
 const [hh,mm]=body.start_time.split(":").map(Number);const total=hh*60+mm+Number(s?.duration_minutes||60);
 if(total>24*60){toast("El turno termina después de medianoche.");return}
 body.end_time=String(Math.floor(total/60)).padStart(2,"0")+":"+String(total%60).padStart(2,"0");
 if(!body.staff_id)body.staff_id=null;
 const overlap=state.appointments.some(a=>a.id!==recordId&&a.staff_id&&a.staff_id===body.staff_id&&a.appointment_date===body.appointment_date&&!["cancelado","no-asistio"].includes(a.status)&&!["cancelado","no-asistio"].includes(body.status)&&a.start_time<body.end_time&&a.end_time>body.start_time);
 if(overlap){toast("Hay otro turno del profesional en ese horario.");return}
 }
 if(type==="products"){
  body.sku=String(body.sku).trim().toUpperCase();
  if(!/^[A-Z0-9._-]{2,50}$/.test(body.sku)){toast("El código admite letras, números, punto, guion y guion bajo.");return}
  if(state.products.some(p=>p.id!==recordId&&String(p.sku).toUpperCase()===body.sku)){toast("Ese código ya existe. Escribí otro o generá uno nuevo.");return}
  body.min_qty=Number(body.min_qty);body.cost_gs=body.cost_gs===""?null:Number(body.cost_gs);body.sale_price_gs=body.sale_price_gs===""?null:Number(body.sale_price_gs);
  if(body.cost_gs===null||!Number.isFinite(body.cost_gs)){toast("Ingresá el precio de compra.");return}
  if(body.category==="Venta"&&(body.sale_price_gs===null||!Number.isFinite(body.sale_price_gs))){toast("Ingresá el precio de venta del producto.");return}
  if(!recordId)body.stock_qty=0;
 }
 if(type==="services"){body.duration_minutes=Number(body.duration_minutes);body.price_gs=body.price_gs===""?null:Number(body.price_gs);body.active=body.active==="true"}
 if(type==="staff")body.active=body.active==="true";
 if(type==="expenses"){body.amount_gs=Number(body.amount_gs);if(!(body.amount_gs>0)){toast("El importe debe ser mayor que cero.");return}}
 try{await saveRecord(type,recordId,body);closeModal();toast("Cambios guardados.");renderAdmin();if(type==="services")publicServices()}catch(err){toast("Error: "+err.message)}
 };
}
function movementDialog(productId){
 const products=state.products; if(!products.length)return toast("Primero creá un producto.");
 modal("Registrar movimiento de stock",'<div class="modal-note">Para vender un producto usá Ventas: descontará stock y registrará el ingreso y el costo al mismo tiempo.</div><form id="movement-form"><div class="form-stack">'+select("product_id","Producto",products.map(p=>[p.id,p.name+" ("+p.stock_qty+" "+p.unit+")"]),productId||products[0].id)+select("kind","Tipo",[["entrada","Entrada de mercadería"],["consumo","Consumo por servicio"],["ajuste_positivo","Ajuste positivo"],["ajuste_negativo","Ajuste negativo"]],"entrada")+input("quantity","Cantidad positiva",1,"number","min=0.001 step=any required")+textArea("note","Motivo o referencia","")+'</div><div class="modal-footer"><button class="admin-outline" type="button" id="cancel-movement">Cancelar</button><button class="admin-action" type="submit">Registrar movimiento</button></div></form>');
 $("#cancel-movement").onclick=closeModal;
 $("#movement-form").onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);const quantity=Number(f.get("quantity"));if(!(quantity>0))return toast("Indicá una cantidad válida.");const kind=f.get("kind");const delta=["entrada","ajuste_positivo"].includes(kind)?quantity:-quantity;
 try{await recordMovement({product_id:f.get("product_id"),kind,delta_qty:delta,note:f.get("note")});closeModal();toast("Movimiento registrado.");renderAdmin()}catch(err){toast("Error: "+err.message)}
 };
}
function saleDialog(){
 const goods=state.products.filter(p=>p.category==="Venta"&&p.active!==false);
 const services=state.services.filter(s=>s.active!==false);
 if(!goods.length&&!services.length)return toast("Primero cargá algún producto o servicio.");
 const choices=[["producto","Producto"],["servicio","Servicio"]];
 modal("Registrar una venta o servicio",'<div class="modal-note">Los productos vendidos descuentan stock y conservan el costo de compra de ese momento. Los servicios usan el costo directo estimado que cargues. Cada registro corresponde a una operación.</div><form id="sale-form"><div class="form-stack two">'+select("kind","Tipo de ingreso",choices,goods.length?"producto":"servicio")+'<div data-sale-kind="producto" class="form-field">'+select("product_id","Producto",goods.map(p=>[p.id,p.name+" · "+p.stock_qty+" "+p.unit]),goods[0]?.id).replace('<div class="form-field">','').replace('</div>','')+'</div><div data-sale-kind="servicio" class="form-field">'+select("service_id","Servicio",services.map(s=>[s.id,s.name]),services[0]?.id).replace('<div class="form-field">','').replace('</div>','')+'</div>'+input("sale_date","Fecha",today(),"date","required")+input("quantity","Cantidad",1,"number","required min=0.001 step=any")+input("unit_price_gs","Precio cobrado por unidad (Gs.)","","number","required min=0 step=any")+input("unit_cost_gs","Costo directo unitario (Gs.)","","number","required min=0 step=any")+select("payment_method","Medio de pago",[["Efectivo","Efectivo"],["Transferencia","Transferencia"],["Tarjeta","Tarjeta"],["Otro","Otro"]],"Efectivo")+input("customer_name","Cliente (opcional)","","text","maxlength=100")+textArea("notes","Observaciones (opcional)","")+'</div><div id="sale-calculation" class="modal-note"></div><div class="modal-footer"><button id="cancel-sale" class="admin-outline" type="button">Cancelar</button><button class="admin-action" type="submit">Registrar</button></div></form>');
 $("#cancel-sale").onclick=closeModal;
 const kind=$("#field-kind"),pSel=$("#field-product_id"),sSel=$("#field-service_id"),qty=$("#field-quantity"),price=$("#field-unit_price_gs"),cost=$("#field-unit_cost_gs");
 function syncSale(changed=true){
  const isProduct=kind.value==="producto";$$("[data-sale-kind]").forEach(x=>x.hidden=x.dataset.saleKind!==kind.value);
  qty.readOnly=!isProduct;if(!isProduct)qty.value=1;
  cost.readOnly=isProduct;
  if(changed){
   const record=isProduct?goods.find(x=>x.id===pSel.value):services.find(x=>x.id===sSel.value);
   price.value=record?(isProduct?record.sale_price_gs??"":record.price_gs??""):"";
   cost.value=isProduct?(record?.cost_gs??""):"";
  }
  const total=Number(qty.value)*Number(price.value);const direct=Number(qty.value)*Number(cost.value);
  $("#sale-calculation").innerHTML='<strong>Resumen:</strong> cobro '+money(total)+' · costo directo '+money(direct)+' · margen bruto '+money(total-direct)+(isProduct?'<br/>El stock se descontará al guardar.':"<br/>El costo directo del servicio debe incluir los insumos asociados.");
 }
 kind.onchange=()=>syncSale(true);
 pSel.onchange=()=>syncSale(true);sSel.onchange=()=>syncSale(true);
 [qty,price,cost].forEach(el=>el.oninput=()=>syncSale(false));
 syncSale(true);
 $("#sale-form").onsubmit=async e=>{
  e.preventDefault();
  const form=new FormData(e.currentTarget),kind=form.get("kind"),quantity=Number(form.get("quantity")),unit_price_gs=Number(form.get("unit_price_gs")),unit_cost_gs=Number(form.get("unit_cost_gs"));
  if(!(quantity>0)||!Number.isFinite(unit_price_gs)||unit_price_gs<0||!Number.isFinite(unit_cost_gs)||unit_cost_gs<0){toast("Revisá la cantidad, precio y costo.");return}
  const product=goods.find(x=>x.id===form.get("product_id"));
  if(kind==="producto"&&(!product||quantity>Number(product.stock_qty))){toast("No hay stock suficiente para esa venta.");return}
  if(kind==="servicio"&&!form.get("service_id")){toast("Elegí un servicio.");return}
  const data={kind,product_id:kind==="producto"?form.get("product_id"):null,service_id:kind==="servicio"?form.get("service_id"):null,sale_date:form.get("sale_date"),quantity,unit_price_gs,unit_cost_gs,payment_method:form.get("payment_method"),customer_name:form.get("customer_name")||null,notes:form.get("notes")||null};
  try{await registerSale(data);reportMonth=String(data.sale_date).slice(0,7);closeModal();toast("Venta registrada y resultado actualizado.");page="sales";renderAdmin()}catch(err){toast("Error: "+err.message)}
 };
}
async function authCall(endpoint,payload){
 const response=await fetch(settings.url.replace(/\/$/,"")+"/auth/v1/"+endpoint,{method:"POST",headers:{"Content-Type":"application/json",apikey:settings.key},body:JSON.stringify(payload)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.msg||data.error_description||data.message||"Error de autenticación");
 return data;
}
async function refreshSession(){
 if(!session?.refresh_token)throw Error("La sesión expiró. Volvé a ingresar.");
 const s=await authCall("token?grant_type=refresh_token",{refresh_token:session.refresh_token});
 session={...s,expires_at:Date.now()+Number(s.expires_in||3600)*1000};
 localStorage.setItem("david-auth-session",JSON.stringify(session));
}
async function apiRequest(path,method="GET",body,returnRows=true){
 if(!isLive())throw Error("Supabase no está configurado.");
 if(session?.expires_at&&Date.now()>session.expires_at-60000)await refreshSession();
 const headers={"apikey":settings.key,"Content-Type":"application/json"};
 if(session?.access_token)headers.Authorization="Bearer "+session.access_token;
 if(method!=="GET")headers.Prefer="return=representation";
 const response=await fetch(settings.url.replace(/\/$/,"")+"/rest/v1/"+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}
 if(!response.ok)throw Error(typeof data==="object"?(data.message||data.details||data.hint||"Error al consultar Supabase"):String(data||"Error de conexión"));
 return returnRows?data:null;
}
async function saveRecord(type,recordId,body){
 if(isLive()){
  if(!userProfile||!["owner","manager"].includes(userProfile.role))throw Error("Tu usuario no tiene permiso para modificar estos datos.");
  const route=type+(recordId?"?id=eq."+encodeURIComponent(recordId):"");
  await apiRequest(route,recordId?"PATCH":"POST",body);
  await fetchCollections();return;
 }
 if(recordId){const idx=state[type].findIndex(x=>String(x.id)===String(recordId));state[type][idx]={...state[type][idx],...body}}
 else state[type].push({id:id(),...body});
 persist();
}
async function recordMovement({product_id,delta_qty,kind,note}){
 if(isLive()){
  if(!userProfile||!["owner","manager"].includes(userProfile.role))throw Error("No tenés permiso para movimientos.");
  await apiRequest("rpc/record_stock_movement","POST",{p_product_id:product_id,p_delta_qty:delta_qty,p_kind:kind,p_note:note||""});
  await fetchCollections();return;
 }
 const p=state.products.find(x=>x.id===product_id);
 if(!p)throw Error("Producto no encontrado");
 const after=Number(p.stock_qty)+Number(delta_qty);
 if(after<0)throw Error("Stock insuficiente. No se permiten saldos negativos.");
 p.stock_qty=Math.round(after*1000)/1000;
 state.stock_movements.push({id:id(),product_id,delta_qty,kind,note,created_at:new Date().toISOString()});
 persist();
}
async function registerSale(data){
 if(isLive()){
  if(!userProfile||!["owner","manager"].includes(userProfile.role))throw Error("No tenés permiso para registrar ventas.");
  await apiRequest("rpc/register_sale","POST",{p_kind:data.kind,p_product_id:data.product_id,p_service_id:data.service_id,p_sale_date:data.sale_date,p_quantity:data.quantity,p_unit_price_gs:data.unit_price_gs,p_unit_cost_gs:data.unit_cost_gs,p_payment_method:data.payment_method,p_customer_name:data.customer_name||"",p_notes:data.notes||""});
  await fetchCollections();return;
 }
 const p=data.kind==="producto"?state.products.find(x=>x.id===data.product_id):null;
 const s=data.kind==="servicio"?state.services.find(x=>x.id===data.service_id):null;
 if(data.kind==="producto"&&(!p||p.category!=="Venta"))throw Error("Producto inválido.");
 if(data.kind==="servicio"&&!s)throw Error("Servicio inválido.");
 const cost=data.kind==="producto"?Number(p.cost_gs):Number(data.unit_cost_gs);
 if(!Number.isFinite(cost)||cost<0)throw Error("Falta el costo directo de la operación.");
 if(p&&Number(p.stock_qty)<Number(data.quantity))throw Error("No hay stock suficiente.");
 const total=Math.round(data.unit_price_gs*data.quantity);
 const direct=Math.round(cost*data.quantity);
 const sale={id:id(),...data,unit_cost_gs:cost,total_gs:total,cost_total_gs:direct,gross_profit_gs:total-direct,created_at:new Date().toISOString()};
 if(p){p.stock_qty=Math.round((Number(p.stock_qty)-data.quantity)*1000)/1000;state.stock_movements.push({id:id(),product_id:p.id,kind:"venta",delta_qty:-data.quantity,note:"Venta "+sale.id,created_at:new Date().toISOString()})}
 state.sales.push(sale);
 persist();
}
async function fetchCollections(){
 const tables=["services","staff","clients","appointments","products","stock_movements","sales","expenses"];
 const output=await Promise.all(tables.map(x=>apiRequest(x+"?select=*")));
 tables.forEach((x,i)=>state[x]=Array.isArray(output[i])?output[i]:[]);
 publicServices();
}
async function loadLive(){
 adminNav();
 if(!session?.access_token){userProfile=null;renderAdmin();connectionDialog("login");return}
 try{
  if(session?.expires_at&&Date.now()>session.expires_at-60000)await refreshSession();
  const uid=session.user?.id;
  if(!uid)throw Error("El usuario no tiene una sesión válida.");
  const rows=await apiRequest("profiles?select=id,role,display_name&id=eq."+encodeURIComponent(uid));
  const profile=Array.isArray(rows)?rows[0]:null;
  if(!profile||!["owner","manager","stylist"].includes(profile.role))throw Error("Esta cuenta no tiene un perfil autorizado. El propietario debe habilitarla en Supabase.");
  userProfile=profile;
  await fetchCollections();
  renderAdmin();
 }catch(err){userProfile=null;renderAdmin();toast(err.message)}
}
function connectionDialog(view="configure"){
 const address=escapeHTML(settings.url||"");
 const pubkey=escapeHTML(settings.key||"");
 if(view==="login"){
  modal("Acceso privado · David Coiffure",'<div class="modal-note">El acceso solo es posible con una cuenta creada en Supabase Auth y un perfil autorizado (owner, manager o stylist). No hay usuario ni contraseña de demostración en el sistema real.</div><form id="login-form"><div class="form-stack">'+input("email","Correo del equipo","","email","required autocomplete=username")+input("password","Contraseña","","password","required autocomplete=current-password")+'</div><div class="modal-footer"><button type="button" class="admin-outline" id="edit-config">Configurar conexión</button><button type="submit" class="admin-action">Entrar al panel</button></div></form>');
  $("#edit-config").onclick=()=>connectionDialog();
  $("#login-form").onsubmit=async e=>{
   e.preventDefault();const d=new FormData(e.currentTarget);
   try{const s=await authCall("token?grant_type=password",{email:d.get("email"),password:d.get("password")});session={...s,expires_at:Date.now()+Number(s.expires_in||3600)*1000};localStorage.setItem("david-auth-session",JSON.stringify(session));closeModal();await loadLive()}catch(err){toast("No se pudo ingresar: "+err.message)}
  };return;
 }
 modal("Conectar a Supabase",'<div class="modal-note">Primero creá un proyecto en Supabase, ejecutá el archivo <strong>supabase/schema.sql</strong> e invitá a un usuario. Solo necesitás la URL del proyecto y su <strong>clave pública</strong> (publishable/anon). Nunca pegues la service_role ni una clave secreta aquí.</div><form id="config-form"><div class="form-stack">'+input("url","Project URL",address,"url","required placeholder=https://xxxxx.supabase.co")+input("key","Publishable key o anon key",pubkey,"text","required")+'</div><div class="modal-footer">'+(isLive()?'<button id="disconnect" class="admin-outline" type="button">Volver a demo</button>':"")+'<button class="admin-action" type="submit">Guardar y continuar</button></div></form><p style="font-size:10px;color:#87958b;margin-top:18px">Los valores públicos se guardan en este navegador. Para uso definitivo con todo el equipo, configurarlos también en config.js durante el despliegue.</p>');
 const dc=$("#disconnect");if(dc)dc.onclick=()=>{
  if(!confirm("¿Desconectar Supabase de este navegador y volver a los datos ficticios? Los datos de Supabase no serán eliminados."))return;
  localStorage.removeItem("david-supabase-config");localStorage.removeItem("david-auth-session");settings={url:"",key:""};session=null;userProfile=null;state=seeded();persist();closeModal();renderAdmin();publicServices();toast("Modo demostración activado.");
 };
 $("#config-form").onsubmit=e=>{
  e.preventDefault();const d=new FormData(e.currentTarget);const u=String(d.get("url")).trim().replace(/\/$/,"");
  if(!/^https:\/\/[a-z0-9.-]+\.supabase\.co$/i.test(u)){toast("Ingresá una URL válida de proyecto Supabase.");return}
  const key=String(d.get("key")).trim();if(key.length<20){toast("La clave pública parece incompleta.");return}
  if(key.startsWith("sb_secret_")){toast("No ingreses claves secretas.");return}
  settings={url:u,key};localStorage.setItem("david-supabase-config",JSON.stringify(settings));
  session=null;userProfile=null;localStorage.removeItem("david-auth-session");closeModal();renderAdmin();connectionDialog("login");
 };
}
async function logout(){
 if(session?.access_token){try{await fetch(settings.url.replace(/\/$/,"")+"/auth/v1/logout",{method:"POST",headers:{apikey:settings.key,Authorization:"Bearer "+session.access_token}})}catch{}}
 session=null;userProfile=null;localStorage.removeItem("david-auth-session");renderAdmin();connectionDialog("login");
}
window.addEventListener("hashchange",()=>{if(!$("#site-view").hidden)return;});
})();
