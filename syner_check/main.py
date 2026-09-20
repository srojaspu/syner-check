import argparse
import sys
from datetime import datetime

from .comparison import parse_tipos, write_missing_csv
from .extractor import extract


def resolve_exit_code(per_tipo: dict | None) -> int:
    """0 when zero faltantes across requested tipos, else 1."""
    total = 0
    for stats in (per_tipo or {}).values():
        try:
            total += int((stats or {}).get("missing_in_sql", 0) or 0)
        except (TypeError, ValueError):
            continue
    return 1 if total > 0 else 0


def validate_date(value: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        raise argparse.ArgumentTypeError(
            f"Fecha inválida: {value}. Use YYYY-MM-DD."
        )

    return value


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Verifica que documentos GraphQL existan en "
        "SQL Server dbo.MovSynerPOS. Resumen en consola, sin JSON.",
        epilog="Codigos de salida: 0=limpio (sin faltantes), "
        "1=con faltantes, 2=error.",
    )

    parser.add_argument(
        "--start-date",
        required=True,
        type=validate_date,
        help="Fecha inicio YYYY-MM-DD.",
    )

    parser.add_argument(
        "--end-date",
        required=True,
        type=validate_date,
        help="Fecha fin YYYY-MM-DD.",
    )

    parser.add_argument(
        "--tipos",
        default="factura,boleta,nc",
        help="Tipos a verificar, separados por coma "
        "(factura,boleta,nc). Default: todos.",
    )

    parser.add_argument(
        "--detalle-lineas",
        action="store_true",
        default=False,
        help="Compara lineas (sku) solo en headers coincidentes "
        "con conteos distintos. Default: off.",
    )

    parser.add_argument(
        "--muestra",
        type=int,
        default=50,
        help="Maximo de faltantes a listar por tipo. Default: 50.",
    )

    parser.add_argument(
        "--export",
        default=None,
        help="Ruta CSV para exportar faltantes "
        "(columnas tipo,IDSynerPos,SerieNumero,fecha).",
    )

    args = parser.parse_args(argv)

    try:
        tipos = parse_tipos(args.tipos)
        result = extract(
            start_date=args.start_date,
            end_date=args.end_date,
            tipos=tipos,
            detalle_lineas=args.detalle_lineas,
            muestra=args.muestra,
        )
        per_tipo = (result or {}).get("per_tipo", {})

        if args.export:
            total_rows = write_missing_csv(
                per_tipo, args.export, order=tipos
            )
            if total_rows == 0:
                print("Sin faltantes, CSV con cabecera.")
            print(f"CSV exportado: {args.export} ({total_rows} filas)")

        return resolve_exit_code(per_tipo)

    except KeyboardInterrupt:
        print("\nProceso cancelado.")
        return 130

    except SystemExit:
        raise

    except Exception as exc:
        print(
            f"\nERROR: {exc}",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
