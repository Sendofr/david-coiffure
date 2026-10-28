# Instalación, validación y recuperación

## Desarrollo estático

Requiere Node 24, npm y Python 3; Docker para pruebas SQL. Usar el checkout
existente: no se necesita otro worktree.

```sh
npm ci
npm run build
npm run check
npm test
npm run test:db
npm run test:integration
npx playwright install --with-deps chromium
npm run test:browser
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

El build genera el SDK oficial en `dist/vendor/` sin cambiar configuración.
`npm run build:config` genera explícitamente `dist/config.js` desde variables del
proceso y carga `.env` si existe. Copiar `.env.example` a `.env` para configuración
local; ambos contienen solo las tres variables públicas indicadas.

```sh
DAVID_MODE=demo npm run build:config
```

Para producción configurar `DAVID_MODE=production`, `SUPABASE_URL` y
`SUPABASE_PUBLISHABLE_KEY` y ejecutar `npm run build:config`. No usar claves
secretas. Mantener configuración de proyecto fuera de commits compartidos y
revisar el diff antes de publicar.

Servir solo `dist/`, nunca checkout completo, `.env`, backups ni herramientas de
base de datos. Construir SDK y configuración antes de preparar el artefacto
estático. No se necesita Node en producción. Python es solo desarrollo. Ver
[NETLIFY.md](NETLIFY.md) para despliegue automático y publicación manual, incluidos
los encabezados de seguridad conservados dentro de dist. Netlify es el destino
definitivo; Vercel solo se utiliza para pruebas.

Recursos externos: `images.unsplash.com`, `fonts.googleapis.com`,
`fonts.gstatic.com`, `cdn.simpleicons.org` y hostname HTTPS concreto de Supabase.
Revisar disponibilidad y autorizaciones; no abrir toda la red por un fallo.

## Supabase del propietario

El propietario confirma que creó la base manualmente y que la web persiste sus
operaciones. Esta revisión no toca ese proyecto. Para conciliar exactamente los
dos archivos ejecutados desde SQL Editor y actualizar sin duplicarlos, seguir
[MIGRACIONES.md](MIGRACIONES.md). El propietario debe:

1. Identificar su proyecto y un entorno separado de ensayo.
2. Obtener URL y publishable/anon key; no compartir contraseñas/claves
   administrativas en chat ni archivos públicos.
3. Revisar las migraciones y el historial real antes de preparar una actualización.
   Hacer backup. `supabase/schema.sql` bloquea su ejecución y dirige al
   procedimiento versionado; baseline no debe repetirse tras el endurecimiento.
4. Instalar/fijar Supabase CLI desde el canal oficial. Para un stack descartable
   local ejecutar `supabase start` y `supabase migration up --local`.
   `supabase db reset --local` recrea y **borra los datos locales**; solo usarlo
   para pruebas descartables, nunca como procedimiento de actualización.
5. Antes del dry-run de un proyecto remoto, conciliar el historial según el
   documento dedicado. Nunca marcar versiones nuevas como aplicadas ni ejecutar
   baseline de nuevo para resolver un historial vacío. La autenticación de CLI
   es privada y no forma parte del navegador.
6. Auditar las restricciones NOT VALID: preservan registros heredados pero
   requieren revisión, corrección explícita y VALIDATE CONSTRAINT antes de operar.
   No borrar registros para hacer pasar una migración.
7. Invitar cuentas Auth y asignar perfiles mediante SQL administrativo.

Después del endurecimiento en una copia de ensayo autorizada, ejecutar
`psql -X -v ON_ERROR_STOP=1 -f supabase/audit-legacy.sql` con la conexión privada
de esa copia configurada por el propietario. El script es de solo lectura y
reporta recuentos de infracciones de las 13 restricciones nuevas, sin datos de
clientes. Si falla, detener la promoción y revisar los registros en un canal
privado; no eliminarlos automáticamente. Un resultado correcto no marca las
restricciones como validadas: ejecutar `ALTER TABLE ... VALIDATE CONSTRAINT ...`
para cada restricción revisada mediante una migración posterior autorizada.

Ejemplo de asignación inicial, tras crear la cuenta y reemplazar el correo:

```sql
insert into public.profiles (id, display_name, role)
select id, 'Propietario David Coiffure', 'owner'
from auth.users where email = 'propietario@example.com'
on conflict (id) do update set role = excluded.role;
```

Crear manager/stylist con el mismo procedimiento controlado. Para stylist,
vincular `profiles.staff_id` a `staff` real. Verificar que el SQL afectó la cuenta
correcta. Nunca asignar rol desde metadatos de registro público.

## Pruebas y alcance

### Colecciones e informes grandes

Las colecciones se recuperan con rangos y orden estable por id, continuando hasta
una página vacía; un servidor que limite la página a menos filas no termina la
carga prematuramente. La carga verifica recuentos y membresía para detectar
inestabilidad, tiene límites defensivos y falla explícitamente en vez de truncar
sin aviso. Un error de red no publica una colección parcial ni activa demo.
Los límites son 200.000 registros y 1.000 páginas por colección, incluyendo la
verificación de ids; si se alcanzan, se muestra error. No representan un límite
de la base de datos. Un crecimiento mayor requiere listados por período o
paginación visible en la interfaz, no eliminar registros.

No existe una instantánea SQL compartida entre múltiples peticiones HTTP:
escrituras concurrentes pueden cambiar el contenido de las listas durante la
carga. Si se detecta inestabilidad se solicita recargar; las verificaciones no
deben presentarse como aislamiento transaccional de todo el navegador.

Los importes y recuentos mensuales, incluida la evolución de seis meses, proceden
de `report_financials` en PostgreSQL mediante una sola instantánea autorizada. No
dependen de sumar las ventas/gastos descargados. La instantánea describe el
momento de la consulta; otra operación posterior puede requerir actualizar la
pantalla. Si la RPC falta o falla no se sustituye por totales parciales locales.

### Suites

`npm test` ejecuta pruebas Node. `npm run test:browser` usa Playwright; para
Chromium existente: `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`.

`npm run test:db` ejecuta `scripts/test-db.sh` sobre PostgreSQL 17 descartable
en Docker. No acepta una base externa. Usa cuentas ficticias y un adaptador local
de auth.uid() para comprobar RLS, permisos, RPC y concurrencia mediante sesiones
reales de PostgreSQL. No prueba por sí solo Auth/PostgREST ni el proyecto remoto.

`npm run test:integration` crea PostgreSQL 17, GoTrue 2.186 y PostgREST 13.0.7
descartables en Docker. Usa el SDK oficial con tokens reales del stack local:
inicio de sesión, usuario verificado, renovación, logout, registro público
desactivado, retirada de rol con JWT vigente, permisos HTTP y dos ventas REST
simultáneas. También comprueba en Chromium login, alta persistida de cliente,
recarga, venta por RPC, informe estimado, logout y acceso de stylist/sin perfil.
No usa credenciales del
salón. Es más amplio que el adaptador SQL; no prueba el proyecto alojado, Studio
ni la instalación completa mediante CLI. El runner elimina solo sus contenedores
temporales al terminar.

Antes de datos reales completar en ensayo: tres roles, cuenta sin perfil,
anónimo, sesión vencida, revocación de rol, ventas concurrentes, stock y reportes
tras recargar. Comprobar 360, 390, 768 y 1440 píxeles: accesos Reservar cita/Acceso
equipo, menú, formularios y tablas. Un puerto abierto no verifica el negocio.

## Backup y restauración

Definir responsables, frecuencia, retención, cifrado y objetivos RPO/RTO antes de
operar. Verificar el plan Supabase: backups administrados y PITR dependen del plan
y no se presuponen activos. Una migración no es un backup.

Antes de migrar, obtener copia consistente con herramientas oficiales o pg_dump
compatible. Son datos personales: guardarlos cifrados fuera de Git, `dist/` y logs
de CI. Incluir inventario de Storage, configuración Auth, roles y secretos por
canales seguros; un dump público no recrea todo Supabase.

Ensayar restauración en otro proyecto: restaurar según formato, aplicar
migraciones pendientes revisadas y comprobar permisos, recuentos, ventas,
movimientos, stock y vínculos Auth/profesionales. Registrar duración, backup y
resultados sin información sensible.

Ante fallo, detener nuevas escrituras, conservar evidencia y evaluar corrección
hacia delante en copia. No resetear producción ni ejecutar rollback destructivo.
Restaurar una base real requiere autorización del propietario y reconciliar
operaciones posteriores al backup.
