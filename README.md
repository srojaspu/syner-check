# Syner Check Web

Aplicación web responsive para consulta segura de comprobantes de SynerCOM desde celular y computadora.

## Funcionalidades

- Inicio de sesión con Google Workspace en producción.
- Modo `AUTH_MODE=development` para probar localmente sin Google Cloud OAuth.
- Solo cuentas `@perfumeriasunidas.com.pe` y `email_verified=true` + claim `hd` autorizado.
- Consulta general por **rango de fechas + tipo de documento**.
- Tipos: factura, boleta y nota de crédito.
- Búsqueda directa por **número + tipo + rango opcional**.
- Búsqueda por número prioriza `MovSynerPos`; si no existe, usa un fallback GraphQL controlado.
- Consultas GraphQL reducidas para listados y consultas completas solo para el detalle.
- Paginación exclusivamente visual en el navegador después de recibir la respuesta GraphQL; **GraphQL no usa paginación** porque la API no la soporta.
- Exportación CSV del resultado actual.
- Atajos de rango de 7 y 30 días.
- Detalle en panel lateral con productos, impuestos, pagos, cliente y referencia de nota de crédito.
- Copiar número e imprimir detalle.
- Diseño responsive para celular y escritorio.
- Tema claro/oscuro con preferencia persistente y detección del tema del sistema.
- SQL Server con un solo login para lectura y escritura (sin `ApplicationIntent`: la instancia no tiene AG ni réplica).
- Validación estricta de tipos, fechas, identificadores SQL y límites de búsqueda.
- No se exponen tokens GraphQL, credenciales SQL ni errores internos al navegador.
- Headers de seguridad, `Cache-Control` por tipo de recurso (assets inmutables, API `no-store`, HTML revalidado) y request IDs para trazabilidad.
- Rate limit por usuario/IP, límite de cuerpo, validación de `Origin` en escrituras, pool de conexiones SQL y pool acotado de hilos para trabajo bloqueante.
- GZip en respuestas de texto y logs JSON con `request_id` en producción.
- Health check `/health` para Docker/Dockploy.
- Swagger/ReDoc disponibles solo fuera de `APP_ENV=production`.

## Arquitectura

```text
Browser
   │
   ▼
FastAPI ── Google Workspace OAuth
   │
   ├── GraphQLClient ── Keycloak ── SynerCOM GraphQL
   │
   └── pyodbc ── SQL Server
```

## Google OAuth

Crea un OAuth Client de tipo **Web application** en Google Cloud Console y registra:

`https://TU_DOMINIO/auth/callback`

Para desarrollo con Google OAuth:

`http://localhost:8000/auth/callback`

Sin embargo, no necesitas crear todavía el proyecto OAuth para desarrollar. Usa:

```env
AUTH_MODE=development
DEV_USER_EMAIL=dev@perfumeriasunidas.com.pe
DEV_USER_NAME=Usuario de desarrollo
```

En este modo `/auth/login` crea una sesión local de desarrollo. **No usar este modo en producción:** la aplicación se niega a arrancar si `APP_ENV=production` y `AUTH_MODE=development` a la vez.

La aplicación no confía únicamente en el parámetro `hd`: verifica el email, `email_verified` y el claim `hd` recibido de Google.

## Configuración

```bash
cp .env.example .env
```

Completa al menos en producción:

- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GRAPHQL_URL`
- `KC_*`
- `DB_HOST`
- `DB_NAME`
- `DB_USER`
- `DB_USER_PASSWORD`

Para producción se recomienda:

```env
APP_ENV=production
SESSION_HTTPS_ONLY=true
DB_ENCRYPT=yes
DB_TRUST_SERVER_CERTIFICATE=no
```

Si el SQL Server utiliza un certificado interno/autofirmado, `DB_TRUST_SERVER_CERTIFICATE=yes` puede ser necesario, pero es preferible instalar y validar el certificado correctamente.

### Endurecimiento HTTP

- Rate limit por usuario (o IP): 120 req/min general y 10/min para `POST /api/sunat/*`.
- Cuerpo máximo de 1 MB (`MAX_REQUEST_BYTES`).
- En POST/PUT/PATCH/DELETE, el `Origin` debe coincidir con el `Host`. Si un proxy reescribe el `Host`, define `ALLOWED_ORIGINS` con la lista separada por comas.
- Pool de conexiones pyodbc: 4 conexiones inactivas por base, descartadas tras 5 minutos o ante cualquier error.
- Pool acotado de hilos (`WEB_THREAD_POOL_SIZE`, 8 por defecto) para llamadas a SQL Server/GraphQL; evita saturar la base y conserva el `request_id` en los logs de los hilos.
- GZip para respuestas mayores a 600 bytes y caché inmutable de un año para los assets con hash de Vite.
- Logs JSON en producción (`LOG_FORMAT=json`) con `request_id`; en desarrollo el formato es texto.
- Los límites son por proceso (un worker de uvicorn). Con varios workers/instancias, muévelos a Redis.

Variables opcionales: `RATE_LIMIT_PER_MINUTE`, `RATE_LIMIT_SUNAT_WRITE_PER_MINUTE`, `MAX_REQUEST_BYTES`, `ALLOWED_ORIGINS`, `WEB_THREAD_POOL_SIZE`, `LOG_FORMAT`.

Para desarrollo local con recargas frecuentes (`--reload`), cada reinicio pide un token nuevo por password grant. Para reutilizar el refresh token entre reinicios:

```env
KC_CACHE_FILE=C:\ruta\fuera\del\repo\kc-token-cache.json
```

Es opt-in: sin esa variable todo sigue solo en memoria. El archivo se crea con permisos solo-propietario, vive fuera del repo (no commitearlo) y su contenido nunca se loguea.

## Ejecución local

Requiere Python 3.13+, ODBC Driver 18 para SQL Server y conectividad al GraphQL/SQL.

```bash
uv sync
uv run uvicorn app.main:app --reload
```

## Docker / Dokploy

En **Dokploy** puedes desplegar el repositorio directamente como **Application (Build Type: Dockerfile)** o como **Compose (`docker-compose.yml`)**:

1. **Puerto del contenedor**: `8000` (`EXPOSE 8000`). En la pestaña **Domains** de Dokploy apunta el dominio HTTPS al puerto `8000`.
2. **Traefik / Proxy headers**: el `Dockerfile` incluye `--proxy-headers --forwarded-allow-ips *` (`FORWARDED_ALLOW_IPS=*`) para que Uvicorn reconozca `X-Forwarded-Proto: https` y `X-Forwarded-For` enviados por el contenedor Traefik de Dokploy desde `dokploy-network`.
3. **Zona horaria**: el contenedor fija `TZ=America/Lima` para que los cálculos de ventana/SLA y fechas coincidan con la hora de SQL Server (`Punidas` y `Pu_synerpos`).
4. **Health check**: `GET /health` (ya declarado con `HEALTHCHECK` en el `Dockerfile`).
5. **Variables de entorno en Dokploy (pestaña Environment)**:
   - Puedes pegar el contenido de `.env` y verificar que no falte ninguna variable ejecutando en la terminal del contenedor en Dokploy:
     ```bash
     python scripts/compare_env.py --from-environ
     ```
   - Asegúrate de definir en producción:
     ```env
     APP_ENV=production
     AUTH_MODE=google
     SESSION_HTTPS_ONLY=true
     GOOGLE_REDIRECT_URI=https://TU_DOMINIO/auth/callback
     ```
   - Incluye las variables de `INTELISIS_*`, `SUNAT_*`, `DB_*`, `KC_*` y los kill switches (`MOVSYNERPOS_WRITE_ENABLED`, `INTELISIS_RESEND_ENABLED`) según `.env.example`.

Para probar con Docker Compose manualmente:

```bash
cp .env.example .env
# editar .env
docker compose up -d --build
```

## Endpoints

- `GET /` interfaz web
- `GET /health` health check
- `GET /auth/login` inicio Google
- `GET /auth/callback` callback Google
- `POST /auth/logout`
- `GET /api/me`
- `GET /api/summary`
- `GET /api/search`
- `GET /api/document/{tipo}/{oid}`

Swagger y ReDoc se desactivan en producción.
