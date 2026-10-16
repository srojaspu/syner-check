"""SUNAT cache wiring. Thin delegation to syner_check.sunat_store."""

from __future__ import annotations

from typing import Sequence


def sunat_available() -> bool:
    """True when validator + writer DB config is present (no secrets read)."""
    from syner_check import config as cfg

    try:
        cfg.get_sunat_validator_config()
        cfg.get_sunat_db_config()
    except RuntimeError:
        return False
    if not cfg.get_sunat_db_password():
        return False
    return True


def fetch_cache(
    keys: Sequence[tuple[str, str, str, str]],
) -> dict[tuple[str, str, str], dict]:
    from syner_check import sunat_store as store

    return store.fetch_many(keys)


def upsert_cache(row: dict) -> None:
    from syner_check import sunat_store as store

    store.upsert(row)
