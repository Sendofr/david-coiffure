# Validación local de Fase 2

Continuación del checkpoint `e4a7fa2` del 28 de octubre de 2026, en
`feat/agenda-fase-2`, sobre Fase 1 `03d63d5`. El árbol estaba limpio al comenzar.
Se conservaron el checkpoint y todos sus archivos. No se hizo push, merge,
despliegue, enlace de proyecto ni cambio sobre Supabase alojado.

## Implementado y corregido

| Problema comprobado | Causa | Corrección |
| --- | --- | --- |
| `DavidAgenda`/`DavidBooking` indefinidos al iniciar | El HTML solo cargaba scripts de Fase 1 | Cargar módulos antes de app y sus CSS; completar el contrato DOM del formulario. |
| Formulario aún decía que solo abría WhatsApp | Texto y campos anteriores | Profesional, disponibilidad, CAPTCHA, honeypot, estado accesible y recibo pendiente; nombre y teléfono mínimos; WhatsApp opcional posterior. |
| Una escritura durante un refresco podía no actualizarse | La función descartaba la segunda petición mientras había una lectura activa | Promesa compartida con nueva lectura encolada y secuencias contra respuestas antiguas/otras sesiones. |
| Respuesta perdida podía impedir recuperar una solicitud ya guardada | El turno propio ya no aparece entre los libres | Conservar UUID y cuerpo en memoria, mostrar referencia, renovar CAPTCHA y permitir recuperar exactamente ese intento incluso después de refrescar disponibilidad. |
| Cambio de proyecto podía conservar contacto/recibo anterior | Solo se comparaba el modo demo/producción | Identificar también el proyecto y limpiar esos campos al cambiarlo. |
| Editor podía reabrirse después de cerrar o mostrar otro profesional | Lectura asíncrona sin invalidación al cerrar | Invalidar generación, capturar profesional y comprobar modal vigente antes de continuar. |
| Ausencia/cierre sin motivo fallaba en PostgreSQL | El formulario enviaba `null` a una columna NOT NULL | Enviar cadena vacía para el motivo opcional. |
| Fallo JSON de zona horaria | `json_agg(record)` generaba varias líneas y la prueba tomaba solo la última | Serializar con `jsonb_agg`; conservar comparación estricta de horarios Tokio/Asunción. |
| Configuración CAPTCHA y CI incompletos | Generador y scripts aún correspondían a Fase 1 | Site key pública permitida explícitamente, secretos excluidos, configuración Edge, checks de módulos, Node 24 y SQL agenda en CI. |

Se conservaron las tres vistas del calendario, navegación, filtros, gestión de
estados, jornadas y descansos, excepciones, vacaciones y cierres recuperados.
En pantallas estrechas, la semana desplaza su contenedor al día seleccionado.
La identidad y fotografías existentes permanecen; se verificó el diseño sin
descargar fuentes/fotografías externas durante los tests.

## Archivos afectados en esta continuación

- Integración: `dist/index.html`, `dist/app.js`, `dist/agenda.js`, `dist/booking.js`.
- Configuración: `.env.example`, `scripts/build-config.cjs`,
  `supabase/config.toml`, `package.json`, `package-lock.json`, `.github/workflows/ci.yml`.
- Pruebas: nuevo `tests/integration/agenda-browser.test.mjs`; ampliaciones en
  `tests/integration/agenda.test.mjs`, `tests/integration/browser.test.mjs`,
  `tests/browser/netlify.test.cjs`, `tests/unit/agenda-calendar.test.cjs`,
  `tests/unit/booking-client.test.cjs`, `tests/unit/config.test.cjs`.
- Documentación: `README.md`, `docs/AGENDA_FASE_2.md`, `docs/SECURITY.md`,
  nota de estado histórico en `docs/RECUPERACION_FASE_2.md` y este informe.

`dist/agenda.css`, `dist/booking.css`, `dist/_headers`, `vercel.json`, la función
Edge y la migración SQL del checkpoint se reutilizaron sin reemplazarlos.
No se modificaron migraciones históricas de Fase 1 ni la migración recuperada
`20261028000200_agenda.sql`.

## Evidencia ejecutada

Las pruebas de negocio usan PostgreSQL 17, Auth y PostgREST locales descartables.
Las de navegador ejecutan Chromium real y el SDK oficial. Turnstile se inyecta
solo en los runners; no existe un modo de omitir CAPTCHA en la aplicación o la
función desplegable. Los tests bloquean destinos cloud y usan una configuración
aislada, sin cargar las credenciales del `.env` del propietario.

| Comprobación | Resultado |
| --- | --- |
| Instalación con lockfile, Node 24 | Correcta: `npm ci --cache /tmp/david-npm-cache`. El primer intento necesitó una caché escribible de este entorno. |
| Build SDK y configuración pública de producción ficticia en directorio descartable | Correctos; no se generó un despliegue ni se sobrescribió la configuración local del propietario. |
| `npm run check` | Correcto, incluidos módulos y entrada Edge. |
| `npm test` | 57 aprobadas, 0 fallos, 0 omitidas. |
| `npm run test:browser` | 21 aprobadas, 0 fallos, 0 omitidas. |
| `npm run test:db` | 84 aserciones de permisos/integridad y 29 financieras; además ventas y gastos concurrentes, correctos. |
| `npm run test:db:agenda` | 42 aserciones aprobadas y conservación de dos citas heredadas superpuestas. |
| `npm run test:integration` | 45 aprobadas, 0 fallos, 0 omitidas: 11 recorridos nuevos de navegador, 15 de API de agenda y 19 de regresión de Fase 1. |
| Deno 2.9.6 `check --no-lock` de la entrada Edge | Correcto. |
| `git diff --check` | Correcto. |

La integración nueva comprueba solicitudes simultáneas al mismo horario y con
distintas duraciones, UUID simultáneo/reintento, carrera entre cierre y reserva,
límites por IP/teléfono, anticipación/horizonte/grilla, días especiales,
descansos y vacaciones. Verifica owner, manager, stylist, cuenta sin perfil y
anon; las tablas privadas y la auditoría permanecen protegidas.

El navegador recorre formulario público → Edge → PostgreSQL → panel; recibos
pendientes y WhatsApp coherente; confirmación, reprogramación, cancelación y
ausencia; editor y persistencia; sesión restaurada; respuesta perdida y conflicto
409 real; lectura antigua durante guardado y después de logout. Comprueba
360, 390, 768 y 1440 píxeles, acceso equipo y ausencia de errores JavaScript/CSP.
La regresión incluye clientes, equipo, venta, stock y reporte con la migración
de agenda aplicada, además de los recorridos completos anteriores de Fase 1.

## Pendiente de verificación externa

No se ejecutaron CAPTCHA real con Cloudflare, gateway/Edge alojados, migraciones
remotas, persistencia en el proyecto del propietario, Netlify ni Vercel Preview.
Requieren un proyecto/hostname de ensayo y autorización posterior, no una
corrección local ni credenciales inventadas. El éxito local no certifica esas
integraciones externas.

Solo el propietario autorizado debe:

1. Preparar backup y Supabase de ensayo con Fase 1 conciliada.
2. Revisar y aplicar únicamente la migración nueva de agenda pendiente,
   comprobando antes el historial; no repetir baseline ni hacer reset remoto.
3. Configurar secretos privados de Edge, widget Turnstile y orígenes exactos.
4. Desplegar la función y generar Preview con las variables públicas indicadas
   en [AGENDA_FASE_2.md](AGENDA_FASE_2.md), siguiendo sus pasos de Vercel.
5. Publicar horarios/profesionales de prueba y repetir reservas simultáneas,
   CAPTCHA inválido/válido, roles y recorridos móviles usando personas ficticias.

Riesgos operativos documentados: los pendientes ocupan horario hasta revisión
manual y no vencen; IP es una señal auxiliar; falta definir retención y atención
de solicitudes antes de operar. Un UUID se conserva en memoria durante reintentos
de la página, no después de cerrarla: si se pierde la respuesta y se recarga,
consultar al salón con la referencia antes de crear otra solicitud.

Esta entrega no añade facturación tributaria, cobros, notificaciones automáticas
ni las funcionalidades financieras de Fase 3. La idempotencia de reservas no
añade idempotencia global a ventas: ante una venta con respuesta perdida, revisar
historial antes de repetir.

## Estado de cierre local

La integración local queda verificada por los recorridos descritos, sin fallos
conocidos en esos escenarios. Los errores de ejecución inicial y los ajustes de
los runners se corrigieron y se repitieron; la ejecución conjunta final no tiene
fallos ni pruebas omitidas. Los contenedores locales finalizaron eliminados.
Las capturas móviles/escritorio también se inspeccionaron visualmente; no son
una validación de fotografías externas ni del widget real de Cloudflare.

El resultado se guarda en un commit local adicional al checkpoint, manteniendo
`feat/agenda-fase-2`. Consultar `git log -2 --oneline` para sus identificadores.
Los cambios de esta fase continúan sin publicar en GitHub. No se crea PR ni
artefacto alojado porque esta continuación prohíbe push y despliegues.
