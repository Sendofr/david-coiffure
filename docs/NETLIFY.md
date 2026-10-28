# Publicación en Netlify

Netlify será el hosting definitivo. Vercel queda reservado a pruebas. Estos
archivos preparan el despliegue; no crean sitios, no cambian el hosting actual
ni autorizan publicar producción.

## Configuración compartida

`netlify.toml` fija:

| Ajuste | Valor |
| --- | --- |
| Framework | Sitio estático, sin preset de framework |
| Root/Base directory | Raíz del repositorio |
| Build | `npm run build && npm run build:config` |
| Publish | `dist` |
| Node | `24` |

Las variables del build definitivo son `DAVID_MODE=production`, `SUPABASE_URL`
y `SUPABASE_PUBLISHABLE_KEY`. La última admite una publishable key o la anon key
tradicional (JWT con rol anon). Son valores públicos; nunca usar service_role,
sb_secret, contraseñas o credenciales administrativas. El build no necesita
conexión SQL ni autenticación administrativa de Netlify/Supabase.

`build` genera `dist/vendor/supabase.js`; `build:config` genera `dist/config.js`.
Producción obtiene la configuración del archivo generado, sin depender de datos
ingresados anteriormente en localStorage. Una configuración inválida impide el
build o bloquea el acceso al panel, sin sustituirlo por demo. El modo debe ser
explícito en Netlify; un build sin modo no debe publicar accidentalmente demo.

Para muestras, usar `DAVID_MODE=demo` sin URL ni clave. Si un Deploy Preview o una
rama de ensayo necesita datos reales de prueba, configurar production con **otro
proyecto Supabase de ensayo**. Revisar variables por contexto en Netlify: no
presuponer que las de producción quedan aisladas de previews automáticamente.

## Opción A: repositorio GitHub

1. El propietario conecta el repositorio en Netlify y revisa los valores de la
   tabla. El agente no necesita credenciales de su cuenta para preparar archivos.
2. Configurar las tres variables públicas para el contexto previsto. Mantener
   separadas producción y vistas de ensayo.
3. Elegir la rama prevista para la revisión; no habilitar producción desde una
   rama de trabajo como sustituto de la revisión del PR. Revisar también que un
   futuro merge no active un despliegue automático no autorizado.
4. Cuando autorice una publicación, Netlify instalará desde package-lock y
   ejecutará el comando de build. Revisar el log sin copiar claves a incidencias.
5. Probar el artefacto con navegador nuevo y con los roles de ensayo antes de
   promover el sitio definitivo. El entorno Supabase debe incluir la nueva RPC
   de informes descrita en [MIGRACIONES.md](MIGRACIONES.md).

## Opción B: publicación manual de dist

Una subida manual no ejecuta el build ni lee variables de Netlify. Preparar el
artefacto localmente, en la raíz del checkout, con Node 24:

```sh
npm ci
npm run build && NETLIFY=true npm run build:config
npm run check
```

La asignación `NETLIFY=true` corresponde a un shell POSIX y activa localmente las
mismas validaciones del build de Netlify (modo explícito y URL HTTPS para
producción); no conecta ni despliega el sitio. En otro shell, establecer esa
variable en el proceso del build según su sintaxis.

Antes del comando, el propietario configura las tres variables públicas en el
proceso o en `.env` local ignorado por Git. No escribir sus valores en scripts
compartidos ni logs. Revisar el modo y proyecto elegido sin exponer credenciales.
Los archivos generados son específicos del destino y no se deben incorporar a un
commit con configuración real.

Subir **el contenido de dist** a la raíz del sitio, o seleccionar esa carpeta en
la herramienta manual de Netlify. Debe contener `index.html`, `styles.css`,
`app.js`, `auth.js`, `pagination.js`, `config.js`,
`vendor/supabase.js` y `_headers`. No subir el checkout, `.env`, `node_modules`,
pruebas, documentos, SQL, backups ni `.git`. Verificar que el archivo `_headers`
no se pierda al preparar/copiar el artefacto.

`publish = "dist"` ya limita la publicación automática a ese directorio. En una
subida manual, esa selección depende del operador. Un cambio de variables
requiere **reconstruir y subir** el artefacto: no basta modificar variables de
Netlify para cambiar archivos que ya se subieron manualmente.

## Rutas y cabeceras

El sitio navega por fragmentos (`#reservar`, etc.) y el panel comparte la página
principal. No necesita redirección SPA `/* -> /index.html`; esa regla ocultaría
recursos faltantes respondiendo HTML con estado 200. `/`, los scripts y CSS deben
responder correctamente; una ruta o script inexistente debe conservar su 404.

`dist/_headers` es la única fuente de las cabeceras y se aplica tanto al build
desde GitHub como a una publicación manual. Incluye:

- CSP: scripts locales sin unsafe-inline ni eval; conexión HTTPS a Supabase;
  fuentes Google e imágenes de los proveedores existentes. Se permiten estilos
  inline porque el diseño actual genera atributos style para fotos/gráficos.
- Protección contra framing, MIME sniffing y uso de cámara, micrófono,
  geolocalización/pagos desde la página.
- Política de referrer que limita información enviada entre sitios.
- HSTS durante un año sobre HTTPS y `Cache-Control: no-store` para config.js.

La CSP admite `https://*.supabase.co` para soportar el proyecto definido por build;
no autoriza endpoints locales en el hosting definitivo. Tampoco concede permisos
de base de datos: RLS sigue autorizando cada operación. No se habilita realtime
ni conexión WebSocket porque esta fase no los usa. Los tests locales que usan un
Supabase en loopback necesitan su servidor de pruebas; no se debe ampliar la CSP
de producción para facilitar esas pruebas.

## Validación posterior a una publicación autorizada

Comprobar HTTPS y cabeceras reales con las herramientas del navegador; las
pruebas del repositorio simulan la aplicación de `_headers`, no certifican una
instancia Netlify todavía no publicada. Verificar assets sin 404/MIME erróneo,
fotografías/fuentes, 360/390/768/1440 píxeles, Reservar cita y Acceso equipo.
Desde un navegador limpio: confirmar modo production, login/logout, permisos,
persistencia al recargar y ausencia de datos al cerrar sesión. Configurar Site
URL/redirecciones de Auth para el dominio autorizado y ensayar recuperación de
cuenta según las capacidades disponibles antes de uso comercial.
