# Recuperación del avance de Fase 2

> Informe histórico del checkpoint `e4a7fa2`. La continuación y su evidencia se
> registran en [VALIDACION_FASE_2.md](VALIDACION_FASE_2.md). Los fallos y pendientes
> de este archivo describen el estado recuperado, no el estado posterior.

Revisión del 28 de octubre de 2026. Este archivo describe un **checkpoint
incompleto**, no una entrega lista para desplegar. Se conservó el contenido de
los archivos recuperados, sin reiniciar la implementación ni completar sus
conexiones pendientes durante esta revisión.

## Estado de Git al recuperar

- Rama local: `feat/agenda-fase-2`.
- Base: `03d63d58b99011b4614ae812d07f838aafd87872`, merge de Fase 1 en `main`.
- La consulta de referencias remotas confirmó esa versión de `main` y la rama
  anterior `feat/produccion-v1`, pero **no existía una rama remota de Fase 2**.
- Había 20 archivos de avance pendientes de commit: cuatro modificados y
  dieciséis nuevos, incluidos los que todavía figuraban como untracked.
- Este checkpoint guarda esos archivos y este informe en un commit local.
  No incluye `.env`, `.local`, dependencias ni artefactos ignorados. No hace push,
  merge, despliegue ni operaciones sobre Supabase alojado.

## Código recuperado

| Área | Archivos principales | Avance encontrado |
| --- | --- | --- |
| Disponibilidad y reservas SQL | `supabase/migrations/20261028000200_agenda.sql` | Jornadas, excepciones, ausencias, cierres, publicación explícita, horarios disponibles y solicitudes pendientes con protección de conflictos. |
| Seguridad de reservas | `supabase/functions/booking/index.ts`, `handler.mjs` | Validación, Turnstile, CORS exacto, hashes para límites de solicitudes y llamada privada a PostgreSQL. |
| Calendario administrativo | `dist/agenda.js`, `agenda.css` | Vistas diaria/semanal/mensual, filtro profesional, acciones de estado y editor de disponibilidad. |
| Formulario público | `dist/booking.js`, `booking.css` | Selección de profesional/horario, validaciones, CAPTCHA, referencia de reintento y recibo pendiente; demo separada. |
| Adaptación de la aplicación | `dist/app.js` | Llamadas a los módulos nuevos, refresco de agenda y adaptación parcial de altas/estados. La integración está inconclusa. |
| Hosting y documentación | `vercel.json`, `dist/_headers`, `README.md`, `docs/AGENDA_FASE_2.md` | Configuración estática, cabeceras para Turnstile e instrucciones preliminares de ensayo. |
| Pruebas | `supabase/tests/agenda.sql`, `scripts/test-agenda-db.sh`, `tests/integration/agenda.test.mjs`, cuatro archivos unitarios nuevos | Cobertura local recuperada para calendario, formulario, seguridad, permisos y concurrencia. |

Las descripciones de funcionalidades en `AGENDA_FASE_2.md` corresponden al
objetivo y al código preparado: no prueban que el sitio completo ya funcione.
Este informe registra las limitaciones comprobadas del checkpoint.

## Comprobaciones ejecutadas al recuperar

- `npm test`: **52 aprobadas**, cero fallos y cero omitidas. Incluye 30 nuevas
  pruebas unitarias de calendario, formulario, función protegida y hosting.
- `npm run check` y comprobación adicional de sintaxis de `agenda.js`,
  `booking.js` y `handler.mjs`: correctas. La sintaxis no detecta las conexiones
  faltantes entre HTML y módulos.
- `bash scripts/test-agenda-db.sh`: **42 aserciones SQL aprobadas** en PostgreSQL
  descartable. También comprueba conservación de dos turnos pendientes heredados.
- Prueba aislada `tests/integration/agenda.test.mjs`: **7 aprobadas y 1 fallida**.
  Las aprobadas incluyen permisos, persistencia, solicitudes simultáneas de
  distintas duraciones, reprogramación/cancelación y límites por teléfono/IP.
  La fallida termina con `SyntaxError` en `JSON.parse`, línea 127, al interpretar
  la salida SQL de la comprobación de zona horaria. Ese escenario necesita
  diagnóstico; no se cuenta como aprobado ni se atribuye sin más a un fallo SQL.
- Comprobación real de carga en Chromium, con configuración demo aislada:
  **fallida**. Se observó `Cannot read properties of undefined (reading 'create')`.
  `window.DavidAgenda` y `window.DavidBooking` no están definidos; tampoco
  existen los campos `#booking-staff` y `#booking-status`.
- `git diff --check`: correcto. Los servicios Docker descartables usados en
  esta revisión se eliminaron al terminar.

No se ejecutó una validación completa de navegador responsive ni un recorrido
de reserva pública de extremo a extremo: el HTML todavía impide inicializar los
módulos. No se reejecutó todo el conjunto de integración de Fase 1 ni un build de
producción. No se verificó CAPTCHA con credenciales reales, Supabase alojado ni
Vercel Preview. Los resultados anteriores no sustituyen esas comprobaciones.

## Trabajo pendiente para continuar desde aquí

1. Conectar `agenda.js`, `booking.js` y sus hojas de estilo en `dist/index.html`
   antes de inicializar `app.js`. Actualmente el HTML conserva los scripts de
   Fase 1 y la aplicación ya intenta llamar a los nuevos módulos.
2. Completar el formulario que espera `booking.js`: profesional, controles de
   verificación, honeypot, estado y recibo; ajustar los textos de solicitud y
   WhatsApp. La integración HTML actual no satisface ese contrato.
3. Incorporar `BOOKING_TURNSTILE_SITE_KEY` al generador de configuración pública
   y documentarla en `.env.example`, sin incorporar secretos del backend.
4. Completar/revisar la configuración de la Edge Function en
   `supabase/config.toml`; la documentación prepara `--no-verify-jwt`, pero el
   archivo todavía no registra esa configuración para `booking`.
5. Corregir y repetir la prueba de integración que falla al leer JSON. Añadir
   pruebas de extremo a extremo del formulario, del editor de horarios y de las
   tres vistas del calendario, además de responsive y regresión de Fase 1.
6. Revisar las condiciones de carrera del refresco de agenda y los reintentos
   demo antes de dar por terminada la adaptación parcial de `app.js`.
7. Añadir los nuevos archivos a las comprobaciones de sintaxis, un comando npm
   para el runner SQL de agenda y su ejecución en CI. El script de integración
   por glob ya incluye el archivo nuevo; la integración está fallando hoy.
8. Revisar la compatibilidad de Node 24 con los ajustes de Vercel y validar el
   build final. No asumir que la configuración de hosting equivale a un preview
   publicado o probado.
9. Solo tras autorización, preparar un Supabase de ensayo, aplicar la migración
   revisada, configurar secretos/CAPTCHA/orígenes y desplegar la función y el
   Preview. No usar este checkpoint para publicar producción.

## Cómo retomar sin perder el avance

Continuar en esta misma rama y partir del commit de recuperación. No regenerar
el proyecto, reemplazar módulos ni volver a ejecutar migraciones anteriores.
Resolver primero la conexión HTML/configuración, luego las pruebas pendientes.
Consultar `AGENDA_FASE_2.md` para los contratos y pasos propuestos de ensayo,
contrastándolos con este estado incompleto antes de ejecutarlos.
