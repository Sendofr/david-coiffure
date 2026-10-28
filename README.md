# David Coiffure · Web y gestión del salón

Plataforma existente para David Coiffure, Encarnación. Se conserva la identidad
negro, marfil y champagne y el despliegue estático. Esta rama desarrolla el primer
hito de seguridad y prepara Netlify como hosting definitivo; Vercel se reserva
a pruebas. No declara disponibilidad comercial.

## Ejecutar y comprobar

Requiere Node 24, npm y Python 3; Docker para pruebas SQL.

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

El build empaqueta el SDK oficial de Supabase para servirlo localmente. La app
sigue siendo HTML/CSS/JavaScript estático, sin servidor de aplicación. Generar
configuración durante el build con `npm run build:config` y las variables públicas
de [.env.example](.env.example). En Netlify se ejecutan ambos pasos. Nunca usar
service_role, contraseñas ni claves
secretas en el navegador.

## Modos y capacidades

- **Demo:** datos ficticios en localStorage, sin escrituras en Supabase. No cargar
  información real de clientes.
- **Producción:** URL/clave pública y sesión del personal; datos en Supabase y
  permisos PostgreSQL. Un fallo no activa datos ficticios como sustituto.
- Web pública con servicios, fotografías referenciales y solicitud WhatsApp. El
  formulario no guarda ni confirma reservas; los horarios son preferencias.
- Panel con agenda, clientes, servicios, equipo, inventario, movimientos, ventas
  de una línea, gastos y resultado operativo **estimado**.
- owner/manager administran; stylist consulta su agenda asignada. Equipo y datos
  administrativos no tienen lectura anónima. Servicios activos sí son públicos.

El propietario indica que la base Supabase ya existe y las escrituras desde la
web persisten. Esta revisión no conecta ni modifica su base real. Las pruebas
automatizadas usan un stack local descartable. Antes de usar esta actualización,
conciliar el historial manual y aplicar de forma autorizada la nueva migración
de informes; no volver a ejecutar las migraciones iniciales sin revisar su estado.

Las colecciones usan paginación y orden estable para superar el límite REST de
1.000 filas. Los totales mensuales se calculan en PostgreSQL y no mediante sumas
de una descarga potencialmente parcial. Un fallo de carga no debe mostrar
resultados incompletos como definitivos. Ver el alcance de concurrencia en
[OPERACION.md](docs/OPERACION.md).

## Documentación

- [Plan por hitos y auditoría inicial](docs/PLAN.md).
- [Instalación, Supabase, despliegue y recuperación](docs/OPERACION.md).
- [Permisos, sesiones y seguridad](docs/SECURITY.md).
- [Netlify desde GitHub o subida manual de dist](docs/NETLIFY.md).
- [Conciliar migraciones ejecutadas desde SQL Editor](docs/MIGRACIONES.md).
- [Informe de revisión de Fase 1](docs/REVISION_FASE_1.md).

`supabase/migrations/` contiene el procedimiento versionado, incluida la base
original. `supabase/schema.sql` bloquea su ejecución y dirige a las migraciones;
no volver a ejecutar la base original sobre un entorno endurecido porque puede
reabrir permisos antiguos. Las pruebas SQL usan una base
descartable y no deben apuntar a producción.

## Límites pendientes

Agenda con disponibilidad, vacaciones y solicitudes persistidas es el siguiente
hito. Ventas múltiples, descuentos, idempotencia entre reintentos, devoluciones,
anulaciones auditables, caja e informes ampliados quedan pendientes. Si falla la
red después de enviar una venta, verificar historial antes de repetirla.

El resultado estimado no equivale a utilidad contable: no incorpora impuestos,
depreciación, nómina ni costos omitidos. No se implementan SIFEN, cobros online ni
recordatorios automáticos. Evitar duplicar costo de mercadería como gasto.

Las fotografías son referenciales y requieren revisión/autorización para uso
oficial; no se proporcionó logo original de alta resolución. Publicar producción
y modificar bases reales requiere autorización y revisión del propietario.
