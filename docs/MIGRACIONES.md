# Conciliar SQL Editor e historial de Supabase CLI

El propietario informa que la base de ensayo ya ejecutó manualmente:

- `20261027000100_baseline.sql`
- `20261027000200_security.sql`

Las operaciones de la web ya se guardan en Supabase según su comprobación. Eso
no prueba que exista una entrada correspondiente en el historial de CLI. No se
modificó ni inspeccionó el proyecto real durante esta revisión.

## Principio de actualización

No volver a ejecutar baseline después de seguridad: recrea políticas/grants
anteriores y puede reabrir acceso. No ejecutar db reset remoto ni eliminar datos
para resolver una divergencia. Una reparación del historial cambia metadatos de
migración: no aplica ni verifica el SQL automáticamente.

## Procedimiento del propietario, con autorización separada

La sintaxis de `migration list` y `migration repair [version]... --linked
--status applied` se contrastó con el [código oficial de Supabase CLI v2.75.0](https://github.com/supabase/cli/blob/v2.75.0/cmd/migration.go).
Es una referencia de sintaxis, no una certificación de instalación de esa versión.
Antes de operar, comprobar `supabase --version` y la ayuda de la versión oficial
adoptada por el propietario. No se ejecutaron comandos sobre el destino remoto
ni se inspeccionó su esquema desde esta revisión.

1. Guardar backup verificado y trabajar primero en una copia de ensayo. Registrar
   referencia exacta del proyecto y commit usado al ejecutar los dos archivos.
2. Instalar/fijar la CLI oficial. En un terminal privado, enlazar el proyecto
   correcto mediante `supabase link --project-ref <referencia>`. No introducir
   credenciales en Git, dist ni documentación.
3. Consultar el historial: `supabase migration list --linked`. Es una comprobación;
   no establece que la estructura real coincida con los archivos locales.
4. Comparar los archivos exactos ejecutados y el estado de PostgreSQL: tablas,
   columnas, índices, constraints, funciones (`pg_get_functiondef`), políticas
   (`pg_policies`) y privilegios de tablas/columnas/ejecución. Comparar también
   nuevas restricciones NOT VALID y grants individuales sobre stock_qty. No
   basarse solo en los nombres de tabla ni en que el login funcione.
5. Ejecutar la auditoría de solo lectura `supabase/audit-legacy.sql` mediante una
   conexión privada de la copia. El script reporta recuentos de violaciones; no
   corrige datos ni valida constraints. Resolver diferencias mediante plan
   revisado sin borrar información.
6. **Solo si ambos archivos están efectivamente aplicados y verificados**, marcar
   sus versiones como aplicadas en el historial. El siguiente comando se prepara
   para el propietario; no se ejecuta desde esta revisión:

```sh
supabase migration repair --linked --status applied 20261027000100 20261027000200
```

7. Repetir `supabase migration list --linked` y comprobar que solo esas versiones
   previamente ejecutadas figuran aplicadas. No marcar migraciones nuevas para
   evitar ejecutarlas.
8. Ejecutar `supabase db push --dry-run` y revisar el plan. Tras la conciliación,
   la migración nueva `20261028000100` de informes debe seguir pendiente si nunca
   se ejecutó. Si aparecen baseline/seguridad como pendientes o cambios no
   esperados, detener la operación y diagnosticar el historial.
9. Revisar y probar en ensayo la migración pendiente; solo tras autorización del
   propietario aplicar `supabase db push` al destino confirmado. Este paso no se
   ha ejecutado sobre la base real.
10. Repetir pruebas de permisos, ventas, stock e informes y auditar/validar las
    restricciones heredadas. Registrar commit, versiones y resultado sin datos
    de clientes ni credenciales.

Si los archivos manuales difieren de los del repositorio, no falsear el historial
como si fueran equivalentes. Conservar ambas versiones, preparar una migración
de conciliación explícita y probarla sobre una copia antes de tocar el destino.

## Migración nueva de informes

`20261028000100_financial_report.sql` añade la RPC
`report_financials(p_month date)` de solo lectura autorizada para owner/manager.
Es SECURITY INVOKER: conserva los permisos y RLS del solicitante. Sus
totales mensuales y evolución de seis meses se calculan en PostgreSQL en una
misma instantánea; no dependen del límite REST de 1.000 filas ni de la cantidad
de registros descargada por el navegador. No cambia ventas ni movimientos
existentes. Anónimo, usuario sin perfil y stylist no deben ejecutarla.

La aplicación requiere esta RPC para mostrar informes en producción. Si falta o
falla, debe informar que los resultados no están disponibles, sin usar sumas
parciales del navegador como sustituto. Aplicar y comprobar la nueva migración
es requisito de producción de esta versión, no un motivo para ejecutar cambios
automáticos en el proyecto del salón.

## Próximas fases

Crear un archivo nuevo por cambio, sin editar migraciones ya aplicadas. Ejecutar
pruebas SQL e integración, ensayar actualización con datos existentes y revisar
el dry-run antes de cualquier aplicación remota autorizada. No incorporar resets,
semillas ficticias ni secretos en un procedimiento de producción. Conservar
historial/backup permite saber qué se ejecutó, pero no sustituye un ensayo de
restauración.
