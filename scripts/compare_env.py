"""Compara las variables de ``.env`` con las de ``.env.example``.

Nunca imprime valores: solo nombres de variables. Sirve para detectar, antes
de arrancar, que no falte ninguna variable que la app espera.

Criterio:

* **obligatoria** = asignacion activa en ``.env.example`` (``KEY=...``).
* **opcional**   = solo aparece comentada en ``.env.example`` (``# KEY=...``).
* **desactivada** = esta en ``.env`` pero comentada (``# KEY=...``): para la app
  es lo mismo que faltar, asi que se reporta aparte.

Uso::

    .venv\\Scripts\\python.exe scripts\\compare_env.py
    python scripts/compare_env.py --env .env.local --strict

Codigos de salida: ``0`` todo bien, ``1`` falta algo (o hay warnings con
``--strict``), ``2`` no se pudo leer algun archivo.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

_ASSIGN = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")
_DISABLED = re.compile(r"^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")


@dataclass
class EnvFile:
    path: Path
    active: dict[str, str] = field(default_factory=dict)
    disabled: set[str] = field(default_factory=set)
    duplicates: dict[str, int] = field(default_factory=dict)
    malformed: list[int] = field(default_factory=list)


def _unquote(raw: str) -> str:
    value = raw.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    return value.strip()


def parse_env(path: Path) -> EnvFile:
    """Lee el archivo sin exponer valores: solo claves y si estan vacias."""
    # utf-8-sig: los .env editados en Windows suelen traer BOM.
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    env = EnvFile(path=path)

    for numero, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        asignacion = _ASSIGN.match(line)
        if asignacion:
            key, raw = asignacion.group(1), asignacion.group(2)
            if key in env.active:
                env.duplicates[key] = env.duplicates.get(key, 1) + 1
            env.active[key] = raw
            continue
        desactivada = _DISABLED.match(line)
        if desactivada:
            env.disabled.add(desactivada.group(1))
            continue
        if line.lstrip().startswith("#"):
            continue
        env.malformed.append(numero)

    return env


def _empty(env: EnvFile, key: str) -> bool:
    return _unquote(env.active[key]) == ""


def _seccion(titulo: str, claves: list[str]) -> None:
    if not claves:
        return
    print(f"\n{titulo}")
    for clave in claves:
        print(f"  - {clave}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Compara .env con .env.example sin imprimir valores."
    )
    parser.add_argument("--env", default=".env", help="archivo real (default: .env)")
    parser.add_argument(
        "--example", default=".env.example", help="plantilla (default: .env.example)"
    )
    parser.add_argument(
        "--from-environ",
        action="store_true",
        help="valida os.environ en vez de un archivo .env (util en Dokploy/Docker)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="tambien falla con variables vacias, sobrantes o duplicadas",
    )
    args = parser.parse_args(argv)

    ruta_ejemplo = Path(args.example).resolve()
    if not ruta_ejemplo.is_file():
        print(f"No existe: {ruta_ejemplo}", file=sys.stderr)
        return 2

    ejemplo = parse_env(ruta_ejemplo)
    known_keys = set(ejemplo.active) | set(ejemplo.disabled)

    if args.from_environ:
        env = EnvFile(
            path=Path("<os.environ>"),
            active={k: v for k, v in os.environ.items() if k in known_keys},
        )
        origen_label = "<os.environ>"
    else:
        ruta_env = Path(args.env).resolve()
        if not ruta_env.is_file():
            print(
                f"No existe: {ruta_env} (usa --from-environ en Docker/Dokploy)",
                file=sys.stderr,
            )
            return 2
        env = parse_env(ruta_env)
        origen_label = str(ruta_env)

    obligatorias = list(ejemplo.active)
    opcionales = sorted(ejemplo.disabled - set(ejemplo.active))

    forzadas = [k for k in env.duplicates]
    faltan = [k for k in obligatorias if k not in env.active and k not in env.disabled]
    desactivadas = [k for k in obligatorias if k in env.disabled and k not in env.active]
    vacias = [k for k in obligatorias if k in env.active and _empty(env, k)]
    sobran = sorted(set(env.active) - set(ejemplo.active) - set(ejemplo.disabled))

    print(f".env         : {origen_label}")
    print(f".env.example : {ruta_ejemplo}")
    print(f"\nVariables obligatorias : {len(obligatorias)}")
    print(f"Definidas en .env      : {len(env.active)}")

    _seccion("FALTAN (obligatorias que no estan en .env)", faltan)
    _seccion("DESACTIVADAS EN .env (comentadas: la app las ve como faltantes)", desactivadas)
    _seccion("VACIAS (obligatorias sin valor)", vacias)
    _seccion("DUPLICADAS (gana la ultima aparicion)", forzadas)
    _seccion(
        "NO DOCUMENTADAS EN .env.example (revisa que no sea un typo de nombre)",
        sobran,
    )
    _seccion("OPCIONALES NO DEFINIDAS (documentadas, sin default)", opcionales)

    lineas_malas = [str(n) for n in env.malformed]
    _seccion(
        "LINEAS NO RECONOCIDAS EN .env (se ignoran)",
        [f"linea {n}" for n in lineas_malas],
    )

    errores = bool(faltan or desactivadas or env.malformed)
    avisos = bool(vacias or sobran or forzadas)

    if not errores and not avisos:
        print(f"\nOK: las {len(obligatorias)} variables obligatorias estan definidas.")
        return 0

    if errores:
        print("\nResultado: FALTA configuracion.")
        return 1

    print("\nResultado: completo, con avisos.")
    return 1 if args.strict and avisos else 0


if __name__ == "__main__":
    raise SystemExit(main())
