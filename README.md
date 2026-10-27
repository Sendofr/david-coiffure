# David Coiffure · Web + gestión del salón

Primera versión de una plataforma web para David Coiffure, Encarnación.

## Qué funciona

- Web pública responsive: servicios, presentación, galería de imágenes **referenciales** y solicitud por WhatsApp al número publicado.
- Formulario de solicitud que precarga servicio, fecha, horario, nombre y observaciones. **No confirma ni bloquea horarios.**
- Panel privado con resumen, agenda de turnos, fichas de clientes, servicios, equipo, inventario y movimientos de stock.
- Ventas de productos (descuentan stock) y servicios, gastos, informe mensual de ingresos, costos y resultado estimado.
- Alta de productos con precio de compra, precio de venta y SKU manual o generado con un botón. El código generado es un identificador interno, no un código de barras EAN.
- Modo demostración con datos ficticios en localStorage. Se puede probar sin Supabase y restablecer.
- Modo conectado a Supabase: inicio de sesión con Auth, roles, lectura y edición de registros, movimientos transaccionales de stock, RLS.

## Activar el sistema real en Supabase

1. Crear un proyecto Supabase del **propietario del salón**.
2. Abrir **SQL Editor** y ejecutar íntegramente supabase/schema.sql. Si el salón ya ejecutó la versión anterior, volver a ejecutarlo después de revisar: agrega ventas, gastos y la función de registro de venta, sin borrar datos existentes.
3. Ir a **Authentication > Users**. Invitar o crear un usuario para el propietario. Confirmar su email según la configuración de Auth.
4. Volver a SQL Editor y ejecutar, reemplazando el correo por el real:

        insert into public.profiles(id, display_name, role)
        select id, 'Propietario David Coiffure', 'owner'
        from auth.users where email = 'correo-real@ejemplo.com'
        on conflict (id) do update set role = excluded.role;

5. Abrir la página desplegada, elegir **Acceso equipo > Conectar Supabase**. Ingresar Project URL y la **publishable key** (o anon key del proyecto). Nunca ingresar la service_role o una clave secreta.
6. Iniciar sesión con la cuenta autorizada y cargar los profesionales, servicios, clientes, productos y turnos reales. No copiar los datos ficticios del modo demo.
7. Para una configuración compartida entre dispositivos, completar dist/config.js con URL y clave **pública** y volver a desplegar. Las credenciales del usuario nunca se publican allí.

## Seguridad implementada en el esquema

- Sin registro público de administradores. Los perfiles de empleados se otorgan desde la base de datos por una persona autorizada.
- RLS por rol: owner y manager gestionan registros; stylist solo ve su agenda asignada y catálogos públicos. Para vincular su agenda, configurar staff_id en su fila de profiles.
- Clientes, citas, costos y existencias no tienen políticas de lectura pública. La lectura de clientes, inventario y movimientos está limitada a owner/manager.
- Solo servicios y profesionales marcados activos tienen lectura pública.
- Inventario modificado mediante record_stock_movement, que bloquea la fila, comprueba disponibilidad, impide stock negativo y guarda movimiento con usuario.
- Ventas de productos mediante register_sale: la operación y la salida de stock quedan en una sola transacción, con costo histórico y control de permisos.
- Los turnos confirmados/en proceso no pueden superponerse para un mismo profesional.
- Nunca se usa una clave administrativa secreta en el navegador.

## Límites de esta primera versión

- No se han conectado las credenciales del salón ni probado aún las políticas en **su** proyecto Supabase. Antes de utilizar información de clientes reales, probar con usuarios de los tres roles, datos de prueba, backups y políticas de recuperación.
- El contacto de la web es una **solicitud por WhatsApp**: no crea una reserva automática. El personal puede registrarla en la agenda tras confirmar.
- No se envían recordatorios automáticos de WhatsApp; eso necesita integración aprobada.
- Los consumos de productos se registran como movimientos manuales; no hay receta automática por tratamiento todavía.
- Un registro de venta representa un producto o un servicio; carrito de múltiples ítems, devoluciones y anulaciones formales quedan para otra fase.
- El resultado mensual **estimado** = ingresos por ventas y servicios − costos directos asociados − gastos generales anotados. No incluye automáticamente tributos, depreciación, comisiones, nómina ni costos omitidos; los costos directos de servicios se cargan manualmente.
- No registrar la compra de mercadería como gasto general si el costo de esa mercadería ya se descontará al venderla: duplicaría el gasto en el reporte.
- No se incluyen proveedores, cierre de caja, SIFEN/facturación electrónica ni cobros en línea. Esos módulos requieren una fase adicional.
- La galería usa fotografías editoriales de referencia; sustituirlas por trabajos autorizados antes de usar la web públicamente como marca oficial.
- No se usa el logo original en alta resolución, porque no se ha proporcionado el archivo.
- El sitio está planteado como **vista privada de revisión**. Antes de hacerlo público hace falta aprobación del titular del negocio, validar contenidos y configurar el entorno.

## Estructura

- dist/index.html: sitio público y base del panel.
- dist/styles.css: estilos responsive.
- dist/app.js: interacciones, modo demo y cliente Supabase REST/Auth.
- dist/config.js: configuración pública opcional de Supabase.
- supabase/schema.sql: estructura y reglas de seguridad.
- .openai/hosting.json: publicación del proyecto.

## Validaciones iniciales

Ejecutar: node --check dist/app.js

Luego probar manualmente:

1. Solicitud por WhatsApp desde la web.
2. Navegación móvil y panel.
3. Altas/ediciones de clientes, servicios y citas.
4. Entrada/salida de stock y rechazo de saldo negativo.
5. Crear producto con SKU escrito por el usuario y otro generado; verificar la detección de duplicados.
6. Registrar producto vendido y comprobar descuento de stock, precio de compra histórico e informe mensual.
7. Registrar servicio y gasto y comprobar cálculo mensual.
8. En Supabase: lectura por rol, rechazo de anónimos y de cambios del estilista, rechazo de superposiciones, de stock negativo y de cambios directos a existencias.

**Esta entrega es una base funcional, no una certificación de producción.** Los formularios y RLS deben probarse en el proyecto real antes de operar con clientes o inventario real.
