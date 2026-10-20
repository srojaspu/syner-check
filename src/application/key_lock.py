"""Process-local locks striped by document key.

The SUNAT submit path is synchronous and runs inside the web thread pool. Two
clients can submit the same voucher at the same time; both may read an empty
cache before either writes its claim. A short, per-document lock closes that
window.

Collisions between keys are harmless: they only serialize two chunks that map
to the same stripe. Lock indexes are acquired in sorted order so two chunks
can never deadlock with each other.
"""

from __future__ import annotations

import threading
from collections.abc import Hashable, Iterable, Iterator
from contextlib import contextmanager


class StripedLock:
    """A fixed set of locks selected by ``hash(key) % stripes``."""

    def __init__(self, stripes: int = 1024) -> None:
        if stripes < 1:
            raise ValueError("stripes must be >= 1")
        self._locks = tuple(threading.Lock() for _ in range(stripes))

    @contextmanager
    def hold(self, keys: Iterable[Hashable]) -> Iterator[None]:
        indexes = sorted({hash(key) % len(self._locks) for key in keys})
        acquired: list[int] = []
        try:
            for index in indexes:
                self._locks[index].acquire()
                acquired.append(index)
            yield
        finally:
            for index in reversed(acquired):
                self._locks[index].release()
