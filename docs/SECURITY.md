# Seguridad y límites

## Frontera de confianza

El navegador es público y modificable. Ocultar botones mejora la experiencia;
PostgreSQL autoriza con RLS, GRANT/REVOKE y funciones transaccionales. El SDK
transmite la sesión; los roles provienen de `public.profiles`, nunca de
metadatos editables por el usuario.

| Identidad | Lecturas | Escrituras |
| --- | --- | --- |
| Anónimo | Servicios activos, profesionales publicados y horarios libres mediante RPC limitadas | Ninguna administrativa; solicitud solo mediante función protegida |
| Cuenta sin perfil | Mismo catálogo público; ninguna información administrativa | Ninguna administrativa |
| stylist | Perfil propio, servicios/equipo, agenda y configuración horaria propia, cierres compartidos | Ninguna administrativa |
| manager | Datos administrativos permitidos por RLS | Gestión y RPC, sin asignar roles |
| owner | Datos administrativos permitidos por RLS | Gestión y RPC; roles mediante operación administrativa autorizada |

La asignación inicial y cambios de roles se realizan mediante conexión
administrativa del propietario, no desde el panel común. `staff_id` vincula
stylist a su profesional; sin vínculo no obtiene una agenda ajena.

En Fase 2 `request_booking` solo concede EXECUTE al backend `service_role`.
La Edge Function pública opera con `verify_jwt=false` para recibir solicitudes
sin registro; exige origen exacto, CAPTCHA válido, entrada limitada y límites
persistentes. No concede acceso a tablas privadas al visitante. Su recibo solo
expone referencia/estado pendiente. La auditoría de citas es de solo lectura
para owner/manager; cancelar conserva el historial y DELETE de citas se revoca.
Ver [AGENDA_FASE_2.md](AGENDA_FASE_2.md) para secretos y contrato completo.

Ventas y movimientos no se insertan, actualizan ni eliminan directamente desde
el navegador. Las RPC autorizan, validan y bloquean el producto para modificar
stock e historial en una transacción. No se concede actualización directa de
`stock_qty`. Mantener `search_path` vacío y referencias calificadas en funciones
`SECURITY DEFINER`.

## Configuración y sesiones

URL y publishable/anon key son públicas. Nunca introducir `service_role`,
`sb_secret_*`, contraseñas o tokens administrativos en `dist/`, Git, capturas ni
logs. La sesión del SDK se conserva en sessionStorage por pestaña con renovación
automática; las colecciones de negocio no se persisten localmente. El formato
antiguo `david-auth-session` se descarta.

Producción fija el modo y proyecto de la configuración pública; no permite que
una preferencia previa active demo o cambie de proyecto. Configuración inválida,
sesión vencida o error deben fallar cerrados y limpiar la vista administrativa.
Demo puede activar explícitamente conexión real desde el panel; antes de cargar
datos, verificar el modo indicado. Nunca usar datos reales en demo.

sessionStorage sigue siendo accesible a JavaScript: proteger contra XSS, usar
HTTPS y cerrar sesión en equipos compartidos. La configuración pública y los
tokens de usuario no sustituyen RLS.

## Revisión antes de publicar

La referencia histórica `supabase/schema.sql` ya no se ejecuta. El procedimiento
versionado está en `supabase/migrations/`. Para instalaciones nuevas se aplican
en orden; para la base manual existente conciliar primero el historial como se
documenta en [MIGRACIONES.md](MIGRACIONES.md). No repetir baseline tras seguridad.
Revisar restricciones heredadas en [OPERACION.md](OPERACION.md).

1. Backup y revisión/aplicación de migraciones en ensayo; resolver y validar
   restricciones heredadas marcadas NOT VALID.
2. Comprobar por HTTP cuentas de los tres roles, sin perfil y solicitudes anónimas;
   probar retirada de rol durante sesión abierta.
3. Desactivar registro público de personal en Auth; definir invitación,
   confirmación de email, contraseñas y recuperación. Evaluar MFA para el dueño;
   el panel de esta fase no implementa su interfaz.
4. Configurar dominios/redirecciones Auth y verificar HTTPS/cabeceras en el
   destino autorizado. `dist/_headers` prepara CSP, frame-ancestors,
   X-Content-Type-Options, Referrer-Policy y HSTS para Netlify. Los tests locales
   no certifican que un sitio Netlify no desplegado ya las haya aplicado.
5. Auditar permisos/políticas externos a las migraciones: una política permisiva
   adicional puede abrir acceso. Mantener las escrituras de reservas públicas
   dentro de la función protegida; no abrir tablas ni la RPC privada a anon.
6. Definir acceso/exportación de teléfonos/notas, retención y privacidad.

## Incidentes y operaciones ambiguas

Si una venta falla por red después de enviarse, revisar historial y stock antes
de repetir: no hay idempotencia global de reintentos todavía. El bloqueo de
envíos en una página no garantiza unicidad entre dispositivos o tras recargar.

Ante exposición, revocar/rotar credenciales en Supabase y revisar sesiones/logs.
No pegar valores en chat. Registrar hora, tipo de fallo e identificador de
operación sin tokens, contraseñas, nombres, teléfonos ni notas. Conservar
evidencia privada y seguir [OPERACION.md](OPERACION.md).
