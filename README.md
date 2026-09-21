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
- SQL Server usado en modo de consulta; `ApplicationIntent=ReadOnly` configurable.
- Validación estricta de tipos, fechas, identificadores SQL y límites de búsqueda.
- No se exponen tokens GraphQL, credenciales SQL ni errores internos al navegador.
- Headers de seguridad, `Cache-Control: no-store` para API y request IDs para trazabilidad.
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
   └── pyodbc ── SQL Server (read-only)
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

En este modo `/auth/login` crea una sesión local de desarrollo. **No usar este modo en producción.**

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
DB_APPLICATION_INTENT_READ_ONLY=true
```

Si el SQL Server utiliza un certificado interno/autofirmado, `DB_TRUST_SERVER_CERTIFICATE=yes` puede ser necesario, pero es preferible instalar y validar el certificado correctamente.

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

## Docker / Dockploy

```bash
cp .env.example .env
# editar .env
docker compose up -d --build
```

Publica el puerto 8000 detrás de HTTPS mediante Dockploy/Traefik/Nginx/ALB.

Configura el health check:

`GET /health`

Y usa como callback de Google la URL HTTPS pública:

`https://TU_DOMINIO/auth/callback`

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
