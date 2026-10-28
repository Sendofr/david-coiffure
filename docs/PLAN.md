# Hitos hacia producción

Se evoluciona la web y el administrador existentes. Se conservan negro, marfil y
champagne, fotografías, navegación responsive y accesos móviles. Cada hito
requiere pruebas y revisión; ninguno autoriza despliegues ni cambios en la base
real del salón.

## 1. Autenticación, datos y permisos

Este cambio aborda el primer hito: migraciones versionadas compatibles con la
base inicial; SDK oficial de Supabase; modos demo/producción separados; RLS,
GRANT/REVOKE y RPC endurecidas; pruebas, CI y documentación reproducible.

Salida del hito: permisos y comportamiento probados localmente, revisión de
migraciones y prueba integrada de Auth + PostgREST + PostgreSQL. La validación en
el proyecto del propietario sigue siendo un paso separado y autorizado. Un
adaptador SQL de `auth.uid()` no prueba por sí solo tokens ni exposición HTTP.

## 2. Agenda y solicitudes reales

Prerrequisito: completar y revisar el hito 1. Incorporar jornadas por profesional,
descansos, excepciones y cierres. Modelar instantes con `America/Asuncion` y
calcular duración en el servidor. Crear solicitudes pendientes con un endpoint
limitado, validación y protección contra abuso. No conceder escritura anónima
general en `appointments`.

Confirmación, reprogramación y cancelación deberán probarse concurrentemente
con exclusión en PostgreSQL. WhatsApp seguirá siendo comunicación, sin equivaler
a confirmación. Los horarios sugeridos actuales no son disponibilidad real.

## 3. Inventario y caja

Mantener SKU manual o generado y unicidad SQL. Ampliar ventas a cabecera y líneas,
descuentos, costo histórico y medios de pago. Añadir claves de idempotencia para
que un reintento tras un corte de red no duplique operaciones; bloquear un botón
no sustituye esa garantía.

Anulaciones/devoluciones serán movimientos reversos auditables. Aperturas/cierres
y conciliación requieren reglas confirmadas. Probar stock concurrente y
consistencia entre líneas, inventario y movimientos financieros.

## 4. Informes

Períodos, ingresos, costos, margen, gastos, productos/servicios y atribución real
por profesional; permisos y CSV protegido contra fórmulas. El resultado seguirá
siendo operativo estimado, no utilidad contable ni facturación tributaria.

## 5. Operación comercial

Refactorización incremental, optimización de listados, accesibilidad,
pruebas de red/sesión/reintentos y regresión visual a 360, 390, 768 y 1440 píxeles.
Cabeceras seguras, observabilidad sin datos sensibles, backups y restauración
ensayada. Revisar derechos de fotografías/marca, privacidad, retención y soporte.
No se incluye SIFEN, cobros online ni recordatorios automáticos.

## Auditoría de la versión inicial

| Hallazgo | Riesgo y tratamiento |
| --- | --- |
| Demo inicializada incluso al conectar | Mezcla o pantalla engañosa; aislar modos y vaciar estado real. |
| Logout conservaba colecciones | Datos del empleado anterior visibles; limpiar y descartar respuestas tardías. |
| Auth REST implementada a mano | Renovación/carreras de sesión; usar SDK oficial. |
| Lectura anónima de `staff` | Exposición del equipo; quitar acceso público. |
| stylist solicitaba todas las tablas | Solicitudes financieras improcedentes; carga por rol y RLS. |
| Auxiliares ejecutables por PUBLIC | Superficie innecesaria; permisos explícitos y search_path seguro. |
| Validación de nulos/números incompleta | Valores especiales y redondeos; validar SQL/RPC. |
| Sin migraciones ni pruebas | Cambios difíciles de revisar; versionado y pruebas locales/CI. |
| Agenda pública solo genera WhatsApp | No guarda ni confirma reservas; pendiente hito 2. |
| Venta de una línea sin idempotencia global | Reintentos ambiguos; pendiente hito 3. |
| Carga completa de tablas | Corregida en el cierre del hito 1 con paginación y totales SQL; optimización de listados pendiente. |

Una instalación o prueba aislada no establece disponibilidad comercial. Cada
resultado debe distinguir ejecutado, fallido y pendiente en el proyecto real.
