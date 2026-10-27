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
base de datos. Construir antes de preparar el artefacto estático. No se necesita
Node en producción. Python es solo servidor de desarrollo.

Recursos externos: `images.unsplash.com`, `fonts.googleapis.com`,
`fonts.gstatic.com`, `cdn.simpleicons.org` y hostname HTTPS concreto de Supabase.
Revisar disponibilidad y autorizaciones; no abrir toda la red por un fallo.

## Supabase del propietario

No se autorizaron cambios en una base real. El propietario debe:

1. Identificar su proyecto y un entorno separado de ensayo.
2. Obtener URL y publishable/anon key; no compartir contraseñas/claves
   administrativas en chat ni archivos públicos.
3. Revisar `supabase/migrations/20261027000100_baseline.sql` y
   `20261027000200_security.sql` juntas. Hacer backup antes de migrar.
   `supabase/schema.sql` es referencia histórica: no ejecutarlo nuevamente sobre
   un entorno endurecido, porque puede reabrir permisos antiguos.
4. Instalar/fijar Supabase CLI desde el canal oficial. Para un stack descartable
   local ejecutar `supabase start` y `supabase migration up --local`.
   `supabase db reset --local` recrea y **borra los datos locales**; solo usarlo
   para pruebas descartables, nunca como procedimiento de actualización.
5. Para un proyecto remoto autorizado: `supabase link --project-ref <referencia>`
   y `supabase db push --dry-run`; revisar referencia/plan antes de aprobar
   `supabase db push`. La autenticación administrativa de CLI es privada y no
   forma parte del arranque del navegador.
6. Si ya existe el esquema original, comprobar correspondencia con la migración
   base: IF NOT EXISTS no repara diferencias arbitrarias. No marcar migraciones
   aplicadas sin inspección. Las nuevas restricciones NOT VALID preservan datos
   heredados; auditar, corregir mediante plan explícito y ejecutar VALIDATE
   CONSTRAINT antes de operar. No borrar registros para hacer pasar una migración.
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
