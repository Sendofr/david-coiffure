# Hito 1 para revisión

La versión anterior inicializaba registros demo también al conectar Supabase y
podía mantener colecciones después del logout. Este cambio separa los modos y
usa el SDK oficial para Auth/API; PostgreSQL aplica los permisos administrativos.
El sitio existente y sus fotografías se mantienen. No se desplegó producción ni
se modificó ningún proyecto real de Supabase.

## Cambios

- `dist/auth.js`, `dist/app.js`, `dist/config.js`: configuración pública validada,
  sesión por pestaña, renovación, limpieza de datos, consultas por rol y bloqueo
  de envíos repetidos en una página. Se conserva el demo anterior.
- `dist/index.html`, `dist/styles.css`: carga local del SDK y corrección del
  desbordamiento del panel; branding y accesos móviles conservados.
- `supabase/migrations/`: base versionada y endurecimiento de RLS, privilegios
  de tabla/columna y RPC sin borrar datos; equipo privado, catálogos públicos
  limitados y operaciones transaccionales de inventario.
- `supabase/audit-legacy.sql`, `supabase/config.toml`: revisión de datos heredados
  y configuración local sin registro público ni semillas demo.
- `package*.json`, `.env.example`, `scripts/`, `tests/`, `.github/workflows/ci.yml`:
  dependencias fijadas, build estático y verificaciones ejecutables.
- `README.md`, `docs/`: plan de fases, operación, permisos y recuperación.

## Validación ejecutada

- `npm ci`, `npm run build`, `npm run check`: correctos.
- `npm test`: 8 pruebas aprobadas.
- `npm run test:browser`: 11 pruebas aprobadas; 360, 390, 768 y 1440 píxeles,
  CRUD demo, HTML escapado, separación de modos y SDK con respuestas controladas.
- `npm run test:db`: 84 aserciones SQL aprobadas, más actualización con datos,
  auditoría de restricciones heredadas y concurrencia en dos sesiones PostgreSQL.
- `npm run test:integration`: 12 pruebas aprobadas contra GoTrue, PostgREST y
  PostgreSQL locales reales; 4 son recorridos Chromium y 8 comprueban Auth/API.
- Venta concurrente de la última unidad: una aceptada y otra rechazada, stock
  cero, una venta y un único movimiento de salida. Costo histórico protegido.
- `npm audit`: ninguna vulnerabilidad conocida al ejecutar la comprobación.
- `git diff --check`: correcto.

Sin fallos ni pruebas omitidas en la ejecución final. Los tests funcionales
excluyen fotografías/fuentes externas de su red; preservan sus URLs originales
y no certifican disponibilidad de esos proveedores. El workflow de GitHub Actions
está preparado; su ejecución remota no se presupone aprobada.

## Acciones del propietario antes de datos reales

1. Revisar este cambio y las migraciones; preparar backup y proyecto de ensayo.
2. Aplicar allí el procedimiento de `docs/OPERACION.md`, auditar datos heredados
   y validar las restricciones pendientes sin borrar registros.
3. Invitar usuarios, asignar perfiles y vincular stylist a su profesional.
4. Desactivar signup en el proyecto alojado, configurar Auth y proporcionar solo
   URL y clave pública al build. Nunca enviar secretos por chat ni al navegador.
5. Repetir las comprobaciones de roles, sesiones y ventas en ese proyecto.
6. Revisar hosting, HTTPS/cabeceras, privacidad, backups y restauración antes de
   autorizar el uso comercial.

## Alcance pendiente

Este hito no convierte el producto en una solución comercial terminada. Agenda
con disponibilidad y solicitudes persistidas corresponde al hito 2. Ventas de
varias líneas, idempotencia entre reintentos, reversos y caja corresponden al
hito 3. Paginación, informes ampliados y controles operativos también siguen
pendientes en el plan. WhatsApp sigue siendo una solicitud sujeta a confirmación.
El resultado financiero continúa siendo estimado.
