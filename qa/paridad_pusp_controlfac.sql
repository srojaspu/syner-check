/* ============================================================================
   Contraste de paridad: nuestra copia de dbo.PUSP_ControlFac vs el SP original.

   Que compara
   ------------
   - "SP"   : el cuerpo del SP tal cual (mismos joins, mismo WHERE, incluido
               `Ejercicio`/`periodo`/`day(FechaEmision)`), ejecutado como SELECT.
               No hace falta permiso EXECUTE: se compara el resultado, no se
               invoca el procedimiento.
   - "Nues" : el universo de nuestra copia (syner_check/db_client.py,
               INTELISIS_UFE_QUERY), que es lo que lee la pantalla.

   Diferencias esperadas (documentadas en el plan, decision D22):
   - La copia filtra `Empresa = 'PU'`; el SP no lo hace. Hoy solo PU tiene
     ventas del universo, asi que no hay diferencia.
   - La copia usa rango de fechas sargable en vez de `day(FechaEmision)`.
   - La copia usa `EXISTS` sobre MovTipo.Clave en vez de `LEFT JOIN` + filtro.
   - La copia NO filtra por `Ejercicio`/`periodo`: si una venta del universo
     los tuviera en NULL, el SP la excluiria y la copia no. El script lo
     verifica explicitamente al final.

   Uso: pegarlo en una sesion de SQL Server con SELECT sobre Venta, MovTipo y
   Cte (sirve el login de lectura de la app). No escribe nada.
   ============================================================================ */

SET NOCOUNT ON;

DECLARE @Dias INT = 14;          -- dias a contrastar (hacia atras)
DECLARE @Fecha date = DATEADD(DAY, -1, CAST(GETDATE() AS date));
DECLARE @i INT = 0;
DECLARE @Ejercicio INT;
DECLARE @Periodo VARCHAR(2);

IF OBJECT_ID('tempdb..#Paridad') IS NOT NULL DROP TABLE #Paridad;
CREATE TABLE #Paridad (
    Dia            date        NOT NULL PRIMARY KEY,
    Ejercicio      int         NULL,
    Periodo        varchar(2)  NULL,
    EnSP           int         NOT NULL,
    EnNuestro      int         NOT NULL,
    SoloEnSP       int         NOT NULL,
    SoloEnNuestro  int         NOT NULL
);

WHILE @i < @Dias
BEGIN
    SET @Ejercicio = NULL;
    SET @Periodo = NULL;

    /* El SP recibe (Ejercicio, Periodo, Dia): se toman los del propio dia.
       Se excluyen a proposito las filas con Ejercicio/periodo en NULL (hay
       ventas asi): sin ORDER BY, TOP 1 podria tomar una de ellas y el dia
       quedaria sin contrastar. */
    SELECT TOP 1
        @Ejercicio = V.Ejercicio,
        @Periodo   = CONVERT(varchar(2), V.periodo)
    FROM dbo.Venta V WITH (NOLOCK)
    WHERE V.FechaEmision >= @Fecha
      AND V.FechaEmision < DATEADD(DAY, 1, @Fecha)
      AND V.Ejercicio IS NOT NULL
      AND V.periodo IS NOT NULL
    ORDER BY V.Ejercicio, V.periodo;

    IF @Ejercicio IS NOT NULL
    BEGIN
        IF OBJECT_ID('tempdb..#Sp') IS NOT NULL DROP TABLE #Sp;
        IF OBJECT_ID('tempdb..#Nues') IS NOT NULL DROP TABLE #Nues;

        /* --- Cuerpo del SP, verbatim (con esquema explicito) --- */
        SELECT a.id, a.mov, a.movid, a.estatus, a.empresa
        INTO #Sp
        FROM dbo.Venta a (NOLOCK)
        LEFT OUTER JOIN dbo.MovTipo b (NOLOCK) ON b.Modulo = 'VTAS' AND a.Mov = b.Mov
        LEFT OUTER JOIN dbo.Cte c (NOLOCK) ON a.Cliente = c.Cliente
        WHERE a.Ejercicio = @Ejercicio
          AND a.periodo = @Periodo
          AND day(a.fechaemision) = CONVERT(varchar(2), DAY(@Fecha))
          AND a.estatus IN ('concluido', 'PENDIENTE')
          AND b.clave in ('VTAS.F', 'VTAS.FC', 'VTAS.B', 'VTAS.FB',
                          'VTAS.D', 'VTAS.DC', 'VTAS.FG')
          AND a.mov not in ('RECIBO GIFT CARD', 'Reversion N-Credito',
                            'Reversion Vta', 'SE-Boleta', 'SE-Factura',
                            'SE-Nota Credito', 'Recibo');

        /* --- Nuestra copia (lo que lee la app) --- */
        SELECT a.ID AS id, a.Mov AS mov, a.MovID AS movid, a.Estatus AS estatus,
               a.Empresa AS empresa
        INTO #Nues
        FROM dbo.Venta a WITH (NOLOCK)
        LEFT JOIN dbo.MovTipo b WITH (NOLOCK) ON b.Modulo = 'VTAS' AND a.Mov = b.Mov
        LEFT JOIN dbo.Cte c WITH (NOLOCK) ON a.Cliente = c.Cliente
        WHERE a.Empresa = 'PU'
          AND a.Estatus IN ('CONCLUIDO', 'PENDIENTE')
          AND a.FechaEmision >= @Fecha
          AND a.FechaEmision < DATEADD(DAY, 1, @Fecha)
          AND a.Mov NOT IN ('RECIBO GIFT CARD', 'Reversion N-Credito',
                            'Reversion Vta', 'SE-Boleta', 'SE-Factura',
                            'SE-Nota Credito', 'Recibo')
          AND EXISTS (
                SELECT 1
                FROM dbo.MovTipo X WITH (NOLOCK)
                WHERE X.Modulo = 'VTAS' AND X.Mov = a.Mov
                  AND X.Clave IN ('VTAS.F', 'VTAS.FC', 'VTAS.B', 'VTAS.FB',
                                  'VTAS.D', 'VTAS.DC', 'VTAS.FG'));

        INSERT INTO #Paridad
        SELECT @Fecha, @Ejercicio, @Periodo,
            (SELECT COUNT(*) FROM #Sp),
            (SELECT COUNT(*) FROM #Nues),
            (SELECT COUNT(*) FROM #Sp WHERE id NOT IN (SELECT id FROM #Nues)),
            (SELECT COUNT(*) FROM #Nues WHERE id NOT IN (SELECT id FROM #Sp));
    END

    SET @Fecha = DATEADD(DAY, -1, @Fecha);
    SET @i = @i + 1;
END;

/* ============================================================================
   1) Resultado del contraste
   ============================================================================ */
SELECT
    Dia,
    Ejercicio,
    Periodo,
    EnSP,
    EnNuestro,
    SoloEnSP,
    SoloEnNuestro,
    Resultado = CASE WHEN SoloEnSP = 0 AND SoloEnNuestro = 0
                     THEN 'PARIDAD' ELSE 'DIFERENCIA' END
FROM #Paridad
ORDER BY Dia DESC;

/* Detalle de las diferencias (deberia salir vacio) */
IF OBJECT_ID('tempdb..#Sp') IS NOT NULL DROP TABLE #Sp;
IF OBJECT_ID('tempdb..#Nues') IS NOT NULL DROP TABLE #Nues;

/* ============================================================================
   2) Riesgo conocido: ventas del universo con Ejercicio/periodo en NULL
   --------------------------------------------------------------------------
   El SP las excluye (WHERE a.Ejercicio = @Ejercicio); nuestra copia no las
   filtra. Si esta consulta devuelve filas, hay una divergencia posible.
   ============================================================================ */
SELECT TOP 20
    V.ID AS id, V.Mov, V.MovID, V.Estatus, V.FechaEmision,
    V.Ejercicio, V.periodo
FROM dbo.Venta V WITH (NOLOCK)
WHERE V.Empresa = 'PU'
  AND V.Estatus IN ('CONCLUIDO', 'PENDIENTE')
  AND V.FechaEmision >= DATEADD(DAY, -60, CAST(GETDATE() AS date))
  AND V.Mov NOT IN ('RECIBO GIFT CARD', 'Reversion N-Credito', 'Reversion Vta',
                    'SE-Boleta', 'SE-Factura', 'SE-Nota Credito', 'Recibo')
  AND EXISTS (
        SELECT 1
        FROM dbo.MovTipo X WITH (NOLOCK)
        WHERE X.Modulo = 'VTAS' AND X.Mov = V.Mov
          AND X.Clave IN ('VTAS.F', 'VTAS.FC', 'VTAS.B', 'VTAS.FB',
                          'VTAS.D', 'VTAS.DC', 'VTAS.FG'))
  AND (V.Ejercicio IS NULL OR V.periodo IS NULL);
