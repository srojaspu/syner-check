# Documentación Técnica y Flujos de Integración: API GraphQL SynerCOM (v3.0 - 2026)

Este documento recopila la especificación técnica completa para la integración con la API GraphQL de SynerCOM / SynerPOS, diseñada para ser consumida por un agente MCP (Model Context Protocol) o desarrolladores del sistema.

## 1. Reglas Generales y Autenticación

* **Endpoint GraphQL:** `https://cliente.synercom.pe/api/graphql`
* **Servicio SSO / Token (OAuth2):** `https://sso.synercom.pe/auth/realms/SynerCOM/protocol/openid-connect/token`
  * **Grant Type:** `password`
* **Headers HTTP Obligatorios:**
  * `Authorization: Bearer <TOKEN>`
  * `X-CONTEXT-COMPANY: <ID_COMPAÑIA>` (**Crítico:** Define la empresa dentro del ambiente multitenant; su ausencia produce errores de contexto en base de datos).

---

## 2. Tipos de Datos y Objetos Compartidos

### 2.1. Escalares y Tipos Especiales
* `String`, `Int`, `Long`, `Boolean`
* `BigDecimal`: Representa valores numéricos decimales de alta precisión (totales, impuestos, cantidades, tasas de cambio).
* `Enum`: Valores predefinidos rígidos (ej. estados, almacenes, banderas BOM).

### 2.2. Objeto `Tax`
Representa los impuestos aplicados a un comprobante o ítem individual.
* `name`: `String` (Nombre del impuesto, ej. `"IGV"`)
* `amount`: `BigDecimal` (Monto total del impuesto)
* `factor`: `BigDecimal` (Tasa o factor del impuesto, ej. `0.18`)
* `base`: `BigDecimal` (Monto base imponible)
* `currency`: `Currency` (Objeto de moneda)

### 2.3. Objeto `Currency`
Representa la moneda de la transacción, impuesto o ítem.
* `isoCode`: `String` (ej. `"PEN"`, `"USD"`)
* `symbol`: `String` (ej. `"S/."`, `"$"` )
* `name`: `String` (ej. `"Sol"`, `"US Dollar"`)
* `isoNumber`: `String` (Código numérico ISO, ej. `"604"`)

### 2.4. Objeto `Contact`
Datos del cliente o proveedor asociado a una operación.
* `idTypeKey`: `String` (Tipo de documento de identidad, ej. `"DNI"`, `"RUC"`)
* `idTypeName`: `String` (Nombre descriptivo del tipo de documento)
* `idNumber`: `String` (Número de DNI/RUC/Pasaporte)
* `name`: `String` (Nombre completo o Razón Social)
* `email`: `String` (Correo electrónico)

### 2.5. Objeto `Classification`
Estructura jerárquica de clasificación de productos.
* `genero`: `String`
* `linea`: `String`
* `subcategoria`: `String`
* `marca`: `String`
* `abc`: `String`
* `subfamilia`: `String`
* `grupo`: `String`
* `categoria`: `String`
* `familia`: `String`

### 2.6. Objeto `Lote`
Información del lote o batch asignado a una posición de producto.
* `oid`: `String` (OID interno del lote)
* `sku`: `String` (Código SKU del producto asociado)
* `description`: `String` (Descripción o código del lote)

### 2.7. Objeto `Payment`
Detalle de medios de pago aplicados a una transacción o comprobante.
* `name`: `String` (Nombre del método de pago)
* `type`: `String` (Tipo de pago)
* `medio`: `String` (Medio utilizado)
* `amount`: `BigDecimal` (Monto pagado)
* `exchangeRate`: `BigDecimal` (Tasa de cambio aplicada)
* `authorization`: `String` (Código de autorización de la pasarela/pos)
* `transactionId`: `String` (ID de transacción)
* `merchantId`: `String` (ID de comercio)
* `cardProvider`: `String` (Proveedor de la tarjeta)
* `serviceProvider`: `String` (Proveedor del servicio de pago)
* `panMask`: `String` (Máscara del número de tarjeta)
* `message`: `String` (Mensaje de estado/respuesta)
* `pointsAmount`: `Int` (Cantidad de puntos utilizados, si aplica)
* `pointsPaymentTypeValue`: `String`
* `pointsPaymentTypeDesc`: `String`
* `pointsPaymentTypeKey`: `String`
* `currency`: `Currency` (Moneda del pago)

---

## 3. Flujos de Creación (Orden Estricto de Dependencias)

Para evitar fallos de integridad referencial, cualquier agente o servicio automatizado DEBE seguir esta secuencia exacta.

### FLUJO A: Creación de Productos y Carga de Stock Inicial

1. **PASO 1: Creación de Clasificadores**
   * Ejecutar las mutaciones `createClassification*` necesarias (ej. Familia, Marca, Línea).
   * **Retorno:** Un `oid` (`String`) por cada clasificador creado.

2. **PASO 2: Creación del Producto Maestro**
   * Ejecutar `createProduct` incluyendo los `oid` generados en el Paso 1.
   * **Retorno:** `oid` (`String`) del producto maestro.

3. **PASO 3: Creación de Lote / Batch**
   * Ejecutar `createBatch(productName: "<SKU>", batchName: "<LOTE>")`.
   * **Retorno:** `oid` (`String`) perteneciente al **Lote**.

4. **PASO 4: Registro de Transacción / Stock**
   * Ejecutar `createTransaction` pasando como `productoid` el **OID del Lote** obtenido en el Paso 3 (NO el OID del producto maestro).

### FLUJO B: Creación de Combos (Bill of Materials - BOM)

1. **Paso 1:** Crear el producto "Padre" mediante `createProduct`.
2. **Paso 2:** Asignar precio al padre mediante `updatePrice(sku: "<SKU_PADRE>", input: { price: "0.00", currency: "2" })`.
3. **Paso 3:** Asegurar que los productos "Hijos" / alternativas ya existan en el sistema.
4. **Paso 4:** Crear el grupo de configuración con `createBomGroupConfig(productoid: "<OID_PADRE>", input: { name: "...", flags: NONE|OPTIONAL|ONLYONE|OPTIONAL_ONLYONE })`.
5. **Paso 5:** Asociar cada producto hijo mediante `createConfigurationBom(productoid: "<OID_PADRE>", input: { bomGroupOid: "<OID_GRUPO>", toProductoid: "<OID_HIJO>", quantity: "1" })`.

---

## 4. Catálogo Completo de Consultas (Queries)

### 4.1. `contacts`
Consulta el directorio de clientes/contactos registrados.
* **Argumentos:**
  * `startDate`: `String` (Opcional, `YYYY-MM-DD`)
  * `endDate`: `String` (Opcional, `YYYY-MM-DD`)
* **Retorna:** `[Contact]`

### 4.2. `invoices`
Obtiene las facturas emitidas por la empresa.
* **Argumentos:**
  * `startDate`: `String` (Opcional)
  * `endDate`: `String` (Opcional)
  * `serie`: `String` (Opcional, soporta `%` como comodín, ej. `"F001%"`)
* **Campos del Tipo `Invoice`:**
  * `oid`: `String`
  * `number`: `String`
  * `date`: `String`
  * `createdDate`: `String`
  * `taxNumber`: `String`
  * `seller`: `String`
  * `netTotal`: `BigDecimal`
  * `crossTotal`: `BigDecimal`
  * `netTotalDiscount`: `BigDecimal`
  * `crossTotalDiscount`: `BigDecimal`
  * `currency`: `Currency`
  * `contact`: `Contact`
  * `taxes`: `[Tax]`
  * `payments`: `[Payment]`
  * `items`: `[InvoicePosition]`

### 4.3. `receipts`
Obtiene las boletas de venta emitidas.
* **Argumentos:**
  * `startDate`: `String` (Opcional)
  * `endDate`: `String` (Opcional)
  * `serie`: `String` (Opcional, ej. `"B001%"`)
* **Campos del Tipo `Receipt`:**
  * `oid`: `String`
  * `number`: `String`
  * `date`: `String`
  * `createdDate`: `String`
  * `contactName`: `String`
  * `seller`: `String`
  * `nota`: `String`
  * `netTotal`: `BigDecimal`
  * `crossTotal`: `BigDecimal`
  * `currency`: `Currency`
  * `contact`: `Contact`
  * `taxes`: `[Tax]`
  * `payments`: `[Payment]`
  * `items`: `[ReceiptPosition]`

### 4.4. `creditNotes`
Consulta las notas de crédito emitidas con desglose completo.
* **Argumentos:**
  * `startDate`: `String` (Opcional, fecha mínima inclusiva)
  * `endDate`: `String` (Opcional, fecha máxima inclusiva)
* **Estructura Completa del Tipo `CreditNote`:**
  * `oid`: `String`
  * `number`: `String`
  * `date`: `String`
  * `seller`: `String`
  * `contactName`: `String`
  * `netTotal`: `BigDecimal`
  * `crossTotal`: `BigDecimal`
  * `motivo`: `String`
  * `motivoAnulacion`: `String`
  * `docRef`: `String` (Documento de referencia afectado)
  * `currency`: `Currency`
  * `contact`: `Contact`
  * `taxes`: `[Tax]`
  * `payments`: `[Payment]`
  * `items`: `[CreditNotePosition]`
* **Estructura Completa de `CreditNotePosition` (`items`):**
  * `idx`: `Int`
  * `sku`: `String`
  * `sap`: `String`
  * `description`: `String`
  * `uom`: `String`
  * `quantity`: `BigDecimal`
  * `netUnitPrice`: `BigDecimal`
  * `crossUnitPrice`: `BigDecimal`
  * `netPrice`: `BigDecimal`
  * `crossPrice`: `BigDecimal`
  * `lote`: `Lote` (`oid`, `sku`, `description`)
  * `taxes`: `[Tax]` (`name`, `amount`, `factor`, `base`)
  * `currency`: `Currency` (`isoCode`, `symbol`, `name`, `isoNumber`)

### 4.5. `products`
Consulta el catálogo general de productos o busca por un SKU particular.
* **Argumentos:**
  * `sku`: `String` (Opcional)
* **Campos del Tipo `Product`:**
  * `oid`: `String`
  * `sku`: `String`
  * `description`: `String`
  * `clasificacion`: `Classification`

### 4.6. `inventory`
Consulta los niveles de stock por almacén.
* **Argumentos:**
  * `almacen`: `Almacenes` (ENUM Opcional)
  * *Valores válidos del ENUM:* `A104`, `REALPLAZA`, `CARACOL`, `SANMIGUEL`, `CAMINOSDELINCA`, `MEGAPLAZA`, `PLAZASUR`, `REALPLAZATRUJILLO`, `REALPLAZAPRIMAVERA`, `BOUTIQUECHANEL`, `SANBORJA`, `SWAROVSKIJOCKEYPLAZA`, `SWAROVSKISALAVERRY`, `REALPLAZASALAVERRY`, `AREQUIPACERROCOLORADO`, `TIENDAPURUCHUCO`, `MALLPLAZAAREQUIPA`, `PHARMAXSALAVERRY`, `PHARMAXELPOLO`, `A122`, `A120`.
* **Campos del Tipo `Inventory`:**
  * `almacen`: `String`
  * `uom`: `String`
  * `quantity`: `BigDecimal`
  * `product`: `Product`
* *Nota para Agentes MCP:* Evitar solicitar el subcampo `clasificacion` dentro de `product` al hacer esta query para optimizar el tiempo de respuesta.

### 4.7. `transactiones`
Consulta los movimientos de almacén e inventario.
* **Argumentos:**
  * `startDate`: `String` (Opcional)
  * `endDate`: `String` (Opcional)
  * `serie`: `String` (Opcional)
* **Campos del Tipo `ProductTransaction`:**
  * `oid`: `String`
  * `description`: `String`
  * `quantity`: `BigDecimal`
  * `almacen`: `String`
  * `created`: `String`
  * `product`: `Product`

### 4.8. `log`
Consulta la bitácora del sistema/transacciones para auditoría.
* **Argumentos:**
  * `startDate`: `String` (Opcional)
  * `endDate`: `String` (Opcional)
  * `sinceDate`: `String` (Opcional)
  * `order`: `String` (Opcional)
* **Campos del Tipo `Log`:**
  * `oid`: `String`
  * `logdatetime`: `String`
  * `fecha`: `String`
  * `key`: `String`
  * `level`: `String`
  * `message`: `String`
  * `value`: `String`

---

## 5. Catálogo Completo de Mutaciones (Mutations)

### 5.1. Operaciones sobre Productos y Precios

#### `createProduct`
Crea un nuevo producto maestro en el catálogo.
* **Argumento:** `input: CreateProduct (INPUT_OBJECT)`
  * `sku`: `String!`
  * `descripcion`: `String`
  * `DescripcionLarga`: `String`
  * `individual`: `Int` (`1`=Simple, `2`=Batch, `3`=Serie)
  * `salesUnit`: `BigDecimal`
  * `defaultUoM`: `Long`
  * `taxCategory`: `Long` (`1`=IGV, `3`=Gratuito)
  * `dimension`: `Long`
  * `barcodes`: `[Barcode]` (`BarcodeType`: `Long`, `code`: `String!`)
  * `clasificacion`: `Object` (Estructura con los OIDs de clasificadores)
* **Retorna:** `String` (OID del producto creado).

#### `updateProduct`
Actualiza un producto existente.
* **Argumentos:**
  * `sku`: `String!` (**Requerido, NON_NULL**)
  * `input`: `UpdateProduct (INPUT_OBJECT)`
    * `descripcion`: `String`
    * `DescripcionLarga`: `String`
    * `individual`: `Int`
    * `defaultUoM`: `Long`
    * `salesUnit`: `BigDecimal`
    * `taxCategory`: `Long`
    * `dimension`: `Long`
    * `activo`: `ProductStatusType!` (**Requerido, ENUM**: `ACTIVE` | `INACTIVE`)
    * `barcodes`: `[Barcode]`
    * `clasificacion`: `updateClassification (INPUT_OBJECT)`
* **Retorna:** `String`

#### `updatePrice`
Asigna o modifica el precio de lista de un producto.
* **Argumentos:**
  * `sku`: `String!` (**Requerido, NON_NULL**)
  * `input`: `UpdatePrice (INPUT_OBJECT)`
    * `price`: `String!` (Monto en formato String, ej. `"120.00"`)
    * `currency`: `String` (Ej: `"2"` para Soles - PEN)
* **Retorna:** `String`

### 5.2. Operaciones de Inventario y Lotes

#### `createBatch`
Crea un nuevo lote para un producto.
* **Argumentos:**
  * `productName`: `String` (SKU del producto maestro)
  * `batchName`: `String` (Código/identificador del lote)
* **Retorna:** `String` (OID del Lote generado).

#### `createTransaction`
Registra un movimiento de entrada/salida de inventario.
* **Argumentos:**
  * `input`: `CreateTransaction (INPUT_OBJECT)`
    * `productoid`: `String!` (OID del **Lote**, NO del producto maestro)
    * `warehouse`: `String!` (Ej: `"A104"`)
    * `quantity`: `String!` (Positivo para entrada, ej. `"100"`; negativo para salida, ej. `"-10"`)
    * `unit`: `Enum` (Ej. `ITEM`)
    * `date`: `String!` (`YYYY-MM-DD`)
    * `comment`: `String`
* **Retorna:** `String`

### 5.3. Operaciones de Contactos / Clientes

#### `createContact`
Crea un cliente o contacto en el sistema.
* **Argumentos:**
  * `input`: `CreateContact (INPUT_OBJECT)`
    * *Para Persona Natural:*
      * `person`: `{ idType: String, nombres: String, apellidoPaterno: String, apellidoMaterno: String, idNumber: String, name: String }` (Tipos: `DNI`, `CE`, `PASS`)
    * *Para Persona Jurídica:*
      * `name`: `String`
      * `company`: `{ ruc: String }`
* **Retorna:** `String` (OID del contacto).

### 5.4. Mutaciones de Clasificación (9 Operaciones)

Todas estas mutaciones comparten exactamente la misma estructura de argumentos e inputs:
* **Estructura del Input (`CreateClassfication`):**
  * `valor`: `String!` (Nombre del elemento de clasificación)
  * `claveMapeo`: `String!` (Código o clave externa de mapeo)
* **Retorna:** `String` (OID generado del clasificador).

**Listado de las 9 mutaciones:**
1. `createClassificationCategoria(input: CreateClassfication)`
2. `createClassificationFamilia(input: CreateClassfication)`
3. `createClassificationGenero(input: CreateClassfication)`
4. `createClassificationGrupo(input: CreateClassfication)`
5. `createClassificationLinea(input: CreateClassfication)`
6. `createClassificationMarca(input: CreateClassfication)`
7. `createClassificationSubCategoria(input: CreateClassfication)`
8. `createClassificationSubFamilia(input: CreateClassfication)`
9. `createClassificationABC(input: CreateClassfication)`

### 5.5. Mutaciones para Combos / Configuración BOM

#### `createBomGroupConfig`
Crea un grupo de opciones dentro de un producto combo.
* **Argumentos:**
  * `productoid`: `String!` (OID del producto padre)
  * `input`: `BomGroupInput`
    * `name`: `String`
    * `description`: `String`
    * `weight`: `Int`
    * `flags`: `Enum` (`NONE`, `OPTIONAL`, `ONLYONE`, `OPTIONAL_ONLYONE`)
* **Retorna:** `String` (OID del grupo BOM).

#### `createConfigurationBom`
Agrega un producto hijo a un grupo de un combo.
* **Argumentos:**
  * `productoid`: `String!` (OID del producto padre)
  * `input`: `BomConfigInput`
    * `bomGroupOid`: `String!` (OID del grupo generado)
    * `toProductoid`: `String!` (OID del producto alternativa/hijo)
    * `quantity`: `String!` (Cantidad por defecto)
    * `position`: `Int`
* **Retorna:** `String`