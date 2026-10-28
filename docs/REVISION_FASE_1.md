# Cierre de Fase 1 para revisión

La revisión corrige las lecturas limitadas por Supabase y prepara Netlify como
hosting definitivo, conservando la web, fotografías, identidad visual y funciones
existentes. Vercel queda reservado a pruebas. No se implementaron reservas
avanzadas ni caja/ventas múltiples. No se hizo merge ni se desplegó producción.

El propietario informa que la base creada desde SQL Editor ya persiste las
operaciones de la web. Esta revisión no cambió su base real. Las comprobaciones
de negocio y permisos se ejecutaron contra servicios locales descartables.

## Problemas corregidos

- `dist/pagination.js`, `dist/app.js`: rangos, orden por id y cursor, conteos y
  verificación de membresía para recuperar colecciones completas incluso por
  encima de 1.000 registros. Fallos de red, cancelaciones, límites o cambios
  detectados invalidan la carga; no se publica una descarga parcial.
- `20261028000100_financial_report.sql`: RPC de lectura owner/manager con RLS y
  snapshot PostgreSQL para totales mensuales e historial de seis meses. Los
  importes no dependen de sumar páginas REST. Las dos migraciones anteriores
  permanecen sin cambios; la nueva no se aplicó al proyecto del salón.
- `dist/app.js`: al cambiar de mes, vender en otro período, recargar o cerrar
  sesión se invalidan respuestas antiguas. Durante el cálculo no se muestran
  cifras previas como actuales. Si falta la RPC, CRUD sigue disponible y los
  totales quedan explícitamente indisponibles, sin sumas locales de sustitución.
- `netlify.toml`, `dist/_headers`: build y publicación estática, Node 24, CSP y
  cabeceras compartidas por publicación GitHub/manual. No hay fallback SPA que
  oculte scripts inexistentes mediante HTML con estado 200.
- `scripts/build-config.cjs`, `.env.example`: configuración pública generada por
  build, publishable/anon tradicional admitidas y rechazo de secretos. Netlify
  exige modo explícito y HTTPS para producción; la configuración publicada no
  depende de preferencias anteriores de localStorage.
- `tests/`, `.github/workflows/ci.yml`, `docs/`: regresiones, datos de prueba
  grandes, build CI aislado y procedimientos de Netlify/conciliación de historial.

## Comprobaciones ejecutadas

| Comprobación | Resultado |
| --- | --- |
| Build estático y generación production con configuración pública anon suministrada | Correctos; artefacto local, sin publicación |
| Validación JavaScript | Correcta |
| `npm test` | 22 aprobadas |
| `npm run test:browser` | 21 aprobadas, incluidas 5 de artefacto/cabeceras Netlify |
| `npm run test:db` | 84 aserciones existentes + 29 nuevas: 113 aprobadas |
| `npm run test:integration` | 19 aprobadas; sin fallos ni omisiones en la ejecución final |
| `npm audit` | 0 vulnerabilidades conocidas reportadas |
| `git diff --check` | Correcto |
| Parseo de netlify.toml y enlaces Markdown relativos | Correctos |

Los tests SQL añaden pruebas de actualización sin pérdida de datos, auditoría
heredada, dos ventas simultáneas de la última unidad y snapshot de informes
mientras otra sesión modifica gastos. Solo una venta consume la última unidad:
stock cero, costo histórico del inventario y un movimiento de salida.

La integración usa GoTrue, PostgREST y PostgreSQL reales locales con el SDK
oficial. Comprueba login, renovación, logout, retirada de rol, usuarios sin
perfil, anónimos y los tres roles, CRUD/persistencia de clientes/productos, SKU
manual/generado/duplicado y ventas concurrentes. Hay 1.505 clientes/movimientos y
1.535 ventas/gastos en las pruebas de lectura grande: IDs y totales mensuales/de
seis meses coinciden sin truncamiento de 1.000 filas. Un fallo persistente entre
páginas rechaza la lectura.

Los recorridos Chromium de producción aplican la CSP canónica sin relajarla,
con un hostname ficticio redirigido al stack descartable. Responsive cubre 360,
390, 768 y 1440 píxeles, Reservar cita, Acceso equipo y ausencia de desbordamiento.
Los recursos de ejecución responden 200 y archivos privados/rutas inexistentes
conservan 404. Estos tests no usan la base real.

El artefacto production quedó preparado localmente en `.local/netlify-dist`
y su archivo comprimido, fuera de Git. `dist/config.js` versionado conserva
la configuración demo y `.env` permanece ignorado. No se publicaron sus valores
ni se requieren credenciales administrativas para construir la web.

## Límites de la evidencia

- Las peticiones de solo lectura al proyecto alojado fueron bloqueadas por el
  proxy con CONNECT 403. No se verificaron desde esta máquina sus roles, esquema
  o historial. El dominio requerido se añadió al borrador de red; guardarlo no
  aplica por sí solo el cambio a la máquina actual.
- No se ejecutaron comandos CLI contra el proyecto remoto. La sintaxis de
  conciliación se contrastó con fuente oficial; no se certifica aquí una
  instalación funcional de CLI ni el resultado remoto de sus comandos.
- GitHub Actions está preparado; una ejecución remota no se presume aprobada.
  Las cabeceras se comprobaron en un servidor de prueba; no se certifica una
  instancia Netlify que aún no fue publicada.
- Las URLs de imágenes/fuentes se conservaron. Las pruebas funcionales aíslan
  esos proveedores y no certifican su disponibilidad ni derechos de uso.
- Las listas REST no comparten una transacción entre peticiones. Se detectan
  cambios observables, pero los totales financieros dependen del snapshot de la
  RPC; una operación posterior puede requerir actualizar la pantalla.

## Pendientes clasificados

### Bloqueante para merge

No queda un bloqueo técnico conocido tras las comprobaciones locales finales.
El PR requiere revisión; no se autoriza merge automático. El estado real de
publicación de rama/PR debe confirmarse mediante las herramientas de GitHub,
sin inferirlo de un commit o un archivo preparado localmente.

### Bloqueante para producción

1. El propietario debe respaldar y comparar el estado manual con las dos
   migraciones ejecutadas, conciliar su historial y revisar el dry-run. Solo
   después debe aplicar de forma autorizada la migración nueva de informes.
   No marcarla como aplicada si aún no se ejecutó. Ver [MIGRACIONES.md](MIGRACIONES.md).
2. Auditar datos heredados y validar las restricciones NOT VALID sin borrar
   registros. Confirmar roles, staff_id, signup desactivado y pruebas de sesión,
   permisos, ventas e informes en el proyecto alojado.
3. Configurar en Netlify las variables públicas correctas para cada contexto,
   revisar el artefacto con navegador nuevo/dispositivos y autorizar por separado
   la publicación. Ver [NETLIFY.md](NETLIFY.md) para GitHub o subida manual.
4. Comprobar dominio/HTTPS/cabeceras, configuración Auth y recuperación de cuentas,
   backup y restauración ensayada, privacidad y autorización de fotografías/marca
   antes del uso comercial. No se presuponen configurados por esta rama.

### Mejora futura

- Disponibilidad real, vacaciones y solicitudes de reserva persistidas: Fase 2.
- Carrito/ventas múltiples, descuentos, idempotencia entre reintentos, reversos,
  devoluciones y conciliación de caja: Fase 3. Mientras tanto, ante error de red
  después de enviar una venta se debe revisar el historial antes de repetirla.
- Paginación visible o filtros para un volumen que supere los límites defensivos
  de lectura, informes ampliados, accesibilidad y optimización. Alcanzar un
  límite produce un error explícito, no un resultado truncado.

El informe sigue siendo un resultado operativo estimado. No reemplaza utilidad
contable, facturación tributaria paraguaya, pagos online ni recordatorios
integrados. La Fase 1 queda preparada para revisión con las acciones de producción
anteriores pendientes del propietario.
