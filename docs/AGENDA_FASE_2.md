# Agenda y solicitudes públicas · Fase 2

La rama `feat/agenda-fase-2` continúa sobre Fase 1, ya integrada en main. Conserva
el sitio, identidad visual, fotografías, demo, inventario y caja existentes.
Esta fase añade disponibilidad y solicitudes pendientes; no implementa ventas
múltiples, cobros, recordatorios automáticos ni facturación tributaria.

No se despliega desde esta revisión ni se modifica el proyecto real. Las
instrucciones remotas siguientes quedan preparadas para el propietario y
requieren autorización separada, primero en un entorno de ensayo.

La integración del HTML, los módulos y la configuración continúa desde el
checkpoint `e4a7fa2`, sin reemplazarlo. Consultar los resultados ejecutados y los
límites de la verificación local en [VALIDACION_FASE_2.md](VALIDACION_FASE_2.md).

## Comprobar localmente

Usar Node 24, Python 3 y Docker. Ninguno de estos comandos enlaza un proyecto
Supabase alojado; los runners crean y eliminan contenedores con nombres únicos.

```sh
npm ci
npm run build
npm run check
npm test
npx playwright install --with-deps chromium
npm run test:browser
npm run test:db
npm run test:db:agenda
npm run test:integration
```

Si Chromium ya está instalado, puede seleccionarse con
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` al ejecutar las pruebas.
`test:integration` recorre el navegador, el SDK oficial, Auth, PostgREST, la
función de reservas y PostgreSQL locales. Solo el widget/proveedor externo de
Turnstile se sustituye desde el runner; la aplicación y la función conservan sus
controles. No prueba el gateway ni las credenciales de un Supabase alojado.

Para explorar el diseño manualmente, generar configuración pública **demo** con
variables de entorno explícitas y ejecutar `npm run dev`. `build:config` carga
el `.env` local si existe: revisar sus variables antes de usarlo y no publicar
el artefacto resultante sin revisar el modo. En demo solo ingresar datos ficticios;
su disponibilidad ilustrativa no es la agenda del salón. Los tests aíslan su
configuración de la del propietario y no dependen de ese `.env`.

## Qué representa una reserva

El visitante elige servicio, profesional publicado, fecha y un horario calculado
en PostgreSQL. Completa nombre, teléfono internacional y CAPTCHA. El servidor
registra una solicitud `pendiente` y devuelve una referencia; la interfaz indica
que **falta confirmación del salón**. WhatsApp es un enlace de comunicación
opcional posterior al registro, nunca una confirmación ni una segunda reserva.

Las solicitudes pendientes ocupan el intervalo para evitar adjudicar el mismo
horario dos veces. No tienen vencimiento automático en esta entrega: el equipo
debe revisarlas y confirmar, reprogramar o cancelar las que no correspondan.
Cancelar libera el intervalo. Esta carga operativa debe estar definida antes de
habilitar solicitudes públicas.

Demo simula disponibilidad y recibos con aviso visible. No invoca RPC ni Edge
Functions y no copia personas o turnos ficticios a Supabase. Producción nunca
sustituye un fallo por una simulación.

## Configuración del profesional y del calendario

owner/manager administran horarios; stylist consulta sus registros asignados.
La disponibilidad considera:

- Intervalos semanales por día y profesional; los huecos entre intervalos
  representan descansos.
- Excepciones de una fecha, que sustituyen los intervalos semanales de ese día;
  pueden representar un día cerrado o intervalos de trabajo distintos.
- Vacaciones/ausencias del profesional y cierres completos del salón.
- Duración vigente del servicio y citas activas que ya ocupan el intervalo.

No se habilita automáticamente todo el equipo. Cada profesional requiere
horarios y consentimiento de publicación mediante `staff_booking_settings`.
El catálogo público entrega únicamente el identificador y nombre de los
profesionales habilitados, sin perfiles Auth, teléfonos ni campos internos.

La zona horaria es `America/Asuncion`. El calendario público ofrece hasta 90 días
desde la fecha local, anticipación mínima de 60 minutos e inicios en una grilla
de 15 minutos. Estas reglas se validan también en la base, sin confiar en el
reloj o cálculos del navegador. Una lista mostrada puede quedar desactualizada
si otra persona reserva; PostgreSQL vuelve a validar al recibir la solicitud.

La base calcula la finalización según la duración del servicio, comprueba
jornada/descansos/cierres y serializa conflictos. Los cambios de horario que
invaliden citas futuras activas se rechazan: revisar y reprogramar/cancelar esas
citas primero, sin borrarlas. No se convierten ni eliminan turnos heredados al
instalar la migración.

## Componentes y permisos

`20261028000200_agenda.sql` es una migración aditiva nueva. No repetir baseline,
seguridad o informes ya aplicados. Las tablas privadas de calendario son
`staff_booking_settings`, `staff_working_hours`, `staff_schedule_exceptions`,
`staff_time_off` y `salon_closures`.

Las RPC públicas `booking_catalog` y `available_slots` exponen el catálogo
autorizado e intervalos disponibles, sin datos de clientes ni detalles de citas.
La operación de escritura `request_booking` se reserva al backend privado; el
cliente anónimo no puede ejecutarla directamente ni insertar en appointments.
Los cambios administrativos continúan autorizándose mediante perfiles/RLS.

La Edge Function `booking` recibe solicitudes públicas y comprueba entrada,
origen, Turnstile y límites antes de llamar a la operación transaccional. La
clave service_role que Supabase inyecta al backend permanece exclusivamente
dentro de la función. No se incorpora al build ni a archivos públicos.

La función se publica sin validación JWT del gateway porque la solicitud es
anónima. Esto no autoriza una escritura anónima general: la protección depende
de sus validaciones y de la RPC privada. No crear un flag de bypass CAPTCHA en
producción ni abrir los grants para hacer funcionar una prueba.

## CAPTCHA, reintentos y límites

Turnstile usa la acción `booking`; el backend verifica el resultado y que el
hostname coincida con el origen autorizado. El token se comprueba por HTTPS con
Cloudflare. Si el proveedor falla o falta configuración, la solicitud no se
acepta por una vía alternativa.

Cada intento lógico usa un UUID de idempotencia. Repetirlo con el mismo cuerpo
devuelve la misma referencia pendiente, sin crear otro turno. Usarlo con otro
cuerpo se rechaza. Un reintento obtiene un token CAPTCHA nuevo y conserva el
UUID/cuerpo original. No generar un UUID nuevo para repetir ciegamente una
solicitud cuya respuesta se perdió.

La base mantiene límites persistentes de solicitudes aceptadas: 5 por IP en 10
minutos, 3 por teléfono en una hora y 100 globales por hora. Se calculan HMAC
separados para IP y teléfono con una clave privada. No se almacena IP sin
transformar. El teléfono de la cita sí es un dato personal necesario para que
el salón contacte al solicitante; limitar su acceso y retención.

La IP recibida mediante cabeceras del gateway es una señal auxiliar, no identidad
infalible. CAPTCHA, límites por teléfono y límite global siguen siendo necesarios.
Estos controles reducen abuso, pero no sustituyen supervisión ni protección de
infraestructura ante ataques distribuidos. Definir limpieza/retención y revisar
los límites antes de operar a mayor escala.

El recibo público contiene solo referencia y estado `pendiente`. No devuelve
nombres, teléfonos, tokens o datos de otras citas y no deben registrarse en logs.
Los errores incluyen 400 (entrada/CAPTCHA), 403 (origen), 409 (conflicto), 429
(límite, con Retry-After) y 503 (configuración, proveedor o servicio indisponible).
Ante un conflicto, consultar horarios otra vez; no presentarlo como confirmado.

## Variables públicas y privadas

| Variable | Dónde se configura | Contenido |
| --- | --- | --- |
| DAVID_MODE | Build del sitio | production para conectar al proyecto de ensayo/definitivo elegido |
| SUPABASE_URL | Build del sitio | URL pública del proyecto correspondiente |
| SUPABASE_PUBLISHABLE_KEY | Build del sitio | Publishable o anon key pública; nunca service_role |
| BOOKING_TURNSTILE_SITE_KEY | Build del sitio | Site key pública del widget Turnstile |
| TURNSTILE_SECRET_KEY | Secretos de la Edge Function | Clave privada de verificación Cloudflare |
| BOOKING_RATE_SECRET | Secretos de la Edge Function | Material aleatorio privado de al menos 32 bytes para HMAC |
| BOOKING_ALLOWED_ORIGINS | Configuración privada de la Edge Function | Lista de orígenes exactos separada por comas |

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` se reciben dentro de la Edge Function
mediante el entorno privado administrado por Supabase; no copiar la segunda al
build. Los secretos privados se ingresan desde las herramientas de secretos del
propietario, nunca por chat ni en Git. `.env` del sitio conserva solo variables
públicas. No mezclar el archivo de secretos de Edge con la configuración pública.

Los orígenes tienen esquema y hostname exactos, sin rutas ni comodines. No
permitir `*.vercel.app`, `*` ni todos los previews. Registrar explícitamente el
hostname de ensayo elegido tanto en Cloudflare como en BOOKING_ALLOWED_ORIGINS.
Una URL alternativa no registrada debe fallar, aunque pertenezca al mismo equipo.

## Preparar Supabase de ensayo · solo el propietario autorizado

1. Confirmar backup y proyecto de ensayo, roles y migraciones de Fase 1. Si los
   archivos se aplicaron desde SQL Editor, conciliar el historial siguiendo
   [MIGRACIONES.md](MIGRACIONES.md), sin reset remoto ni ejecución repetida de
   baseline.
2. Revisar `20261028000200_agenda.sql`, ejecutar el dry-run y probarla en una
   copia con datos existentes. Aplicar al proyecto confirmado únicamente tras
   autorización; esta revisión no lo hace.
3. Crear/configurar un widget Turnstile de ensayo para el hostname explícito de
   prueba. Configurar los secretos de la función de forma privada. No emplear
   claves de pruebas del proveedor en el sistema definitivo.
4. Revisar la función y su configuración verify_jwt=false. Cuando se autorice
   su despliegue en ensayo, el comando preparado es:

```sh
supabase functions deploy booking --no-verify-jwt --project-ref <referencia-de-ensayo>
```

5. Configurar jornadas, descansos, excepciones y publicación de al menos un
   profesional de ensayo; cargar un servicio activo. La ausencia de horarios
   o publicación no debe abrir disponibilidad por defecto.
6. Probar CAPTCHA válido/inválido, CORS, reintentos, límites y solicitudes
   simultáneas. Revisar el turno pendiente desde una cuenta autorizada; confirmar,
   reprogramar y cancelar. Repetir controles de acceso de los tres roles.

No se ejecutó aquí el comando de despliegue ni se modificaron secretos remotos.
Un build estático correcto no demuestra que la función y la migración ya estén
instaladas en el proyecto del propietario.

## Vercel Preview paso a paso · sin publicación automática de producción

Vercel se usa para pruebas; Netlify sigue siendo el hosting definitivo. El archivo
`vercel.json` declara framework null, instalación npm ci, build
`npm run build && npm run build:config` y salida dist. Elegir Node.js 24.x en la
configuración del proyecto y conservar el pin de Node del repositorio.

1. El propietario debe autorizar la creación del preview y usar un proyecto
   Vercel de ensayo. Root Directory es la raíz del repositorio; Framework Preset
   es Other/sitio estático. Revisar que no se active un despliegue de producción
   al importar o conectar el repositorio.
2. Configurar las cuatro variables **públicas** en el contexto Preview. Usar
   DAVID_MODE=production para conectar a Supabase **de ensayo**, no al proyecto
   operativo. Nunca configurar service_role ni los secretos de Edge en Vercel.
3. Si aún no existe un hostname conocido, el propietario puede autorizar primero
   un preview demo, sin URL/clave Supabase. Obtener el hostname real del preview;
   no inventarlo ni permitir un comodín para anticiparlo.
4. Registrar ese hostname en Turnstile y su origen exacto en la Edge Function
   de ensayo. Configurar la site key pública en Preview y reconstruir el
   preview conectado. Un cambio de variables requiere un nuevo build.
5. Publicar únicamente un Preview de la rama feat/agenda-fase-2 tras autorización.
   Con CLI enlazada al proyecto de ensayo, `vercel deploy` crea un preview por
   defecto; no usar --prod ni promover a producción. Con integración Git, revisar
   las reglas de ramas y el contexto antes de que un push active despliegues.
6. Desde navegador limpio probar a 360, 390, 768 y 1440 píxeles: reservar desde
   móvil, CAPTCHA, recibo pendiente, enlace WhatsApp y Acceso equipo. Verificar
   cabeceras, consola, horarios America/Asuncion y que solo aparezcan
   profesionales expresamente publicados. Probar dos dispositivos sobre el
   último intervalo y comprobar que solo se acepta una solicitud.
7. Revisar los registros en Supabase de ensayo, sin datos personales reales.
   No aprobar producción basándose solo en un puerto abierto, un build o una
   captura. Documentar los resultados del preview y mantener separada la
   autorización de Netlify definitivo.

No se ejecutó vercel deploy desde esta revisión. Si se publica manualmente un
artefacto estático, también debe incluir booking.js, booking.css, el SDK y el
resto de recursos generados; no subir .env, pruebas, documentos o SQL.

## Cabeceras y compatibilidad de hosting

Netlify consume `dist/_headers`; Vercel no interpreta ese archivo. Por eso
vercel.json repite los mismos valores, con una prueba automática de igualdad en
`tests/unit/deployment.test.cjs` que impide cambios divergentes. Una modificación
de cabeceras debe actualizar ambas representaciones y ejecutar la prueba.

La CSP habilita challenges.cloudflare.com para script, frame y conexión del
widget; los scripts propios siguen siendo locales y no se permite eval ni
JavaScript inline. Los estilos inline existentes se conservan por compatibilidad
con el diseño. Se mantiene la protección contra framing del sitio, el bloqueo
de MIME sniffing y config.js sin caché. No se añaden fallbacks SPA que conviertan
recursos faltantes en HTML con estado 200.

## Límites y revisión antes de activar

- Sin proyecto de ensayo, migración, función, hostname y Turnstile configurados
  no se declara probada la integración pública alojada. Las pruebas locales
  inyectan respuestas del proveedor únicamente en el runner, sin bypass de
  producción.
- Los pendientes ocupan agenda hasta intervención del salón; definir responsable
  y frecuencia de revisión. No hay confirmación automática, pago o recordatorio.
- Establecer retención de solicitudes, teléfono y contadores de abuso, atención
  de incidentes y recuperación. Publicar solo nombres consentidos.
- Fase 3 permanece fuera de alcance: no se atribuyen a este trabajo caja,
  idempotencia de ventas ni reversos financieros.

La comprobación local y la validación alojada son hitos distintos. Antes de
activar reservas reales se necesita el ensayo autorizado con CAPTCHA y gateway
reales descrito arriba. Ninguno de esos pasos autoriza merge o producción
automáticos.
