"""Scalar types: one `Scalar` per type, each with `normalize`, `validate` and `is_valid`."""

from __future__ import annotations

import builtins as _b
import math as _math
import re as _re
from typing import Any as _Any
from typing import Final, Generic, Literal, TypeVar

T = TypeVar("T")

# Module attributes named `any`, `object` and `all` shadow the builtins: the engine reaches them as `_b.x`.

# Unicode White_Space, written out. `str.strip()` without an argument also strips U+001C-U+001F, which is not white space.
_WS: Final = (
    "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680\u2000\u2001\u2002\u2003"
    "\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"
)

_Obj = _b.object  # annotations say `object`, which the table below shadows
_NO: Final = _Obj()  # what _check returns for "not valid"; a value can never be this object


class ScalarError(ValueError):
    """A value failed a type's rule. `str(error)` is the type's `error` text; `scalar` is the type."""

    def __init__(self, scalar: Scalar[_Any]) -> None:
        super().__init__(scalar.error)
        self.scalar = scalar


def _trim(s: str) -> str:
    return s.strip(_WS)


def _remove_spaces(s: str) -> str:
    return s.replace(" ", "")


def _remove_hyphens(s: str) -> str:
    return s.replace("-", "")


# Each step by name, resolved once per type in Scalar.__init__. No regex here: str.lower/upper are the full
# Unicode mapping, in C, and linear.
_STEPS: Final = {
    "trim": _trim,
    "lowercase": str.lower,
    "uppercase": str.upper,
    "remove_spaces": _remove_spaces,
    "remove_hyphens": _remove_hyphens,
}


class Scalar(Generic[T]):
    """One scalar type. Instances are plain records; the regex is compiled on first use."""

    __slots__ = (
        "name", "label", "hint", "error", "details", "level", "primitive", "aliases", "examples",
        "_kind", "_steps", "_case_at", "_pattern", "_min_len", "_max_len", "_minimum", "_maximum", "_re",
    )

    def __init__(
        self,
        *,
        name: str,
        label: str,
        hint: str,
        error: str,
        details: str,
        level: str,
        primitive: str,
        aliases: tuple[str, ...],
        examples: dict[str, tuple[_Any, ...]],
        kind: str = "any",
        steps: tuple[str, ...] = (),
        pattern: str | None = None,
        min_len: int = 0,
        max_len: int | None = None,
        minimum: float | None = None,
        maximum: float | None = None,
    ) -> None:
        self.name = name
        self.label = label
        self.hint = hint
        self.error = error
        self.details = details
        self.level = level
        self.primitive = primitive
        self.aliases = aliases
        self.examples = examples
        self._kind = kind
        self._steps = tuple(_STEPS[s] for s in steps)  # a bad name fails here, not on first use
        # Index of the first case step: the length gate runs just before it, since case mapping never shortens
        # text but remove_spaces and remove_hyphens do.
        self._case_at = next((i for i, s in enumerate(steps) if s in ("lowercase", "uppercase")), -1)
        self._pattern = pattern
        self._min_len = min_len
        self._max_len = max_len
        self._minimum = minimum
        self._maximum = maximum
        self._re: _re.Pattern[str] | None = None

    def __repr__(self) -> str:
        return f"<Scalar {self.name}>"

    def normalize(self, s: str) -> str:
        """Apply the type's normalize steps in order. Identity for types that are not text."""
        if self._kind == "text":
            for step in self._steps:
                s = step(s)
        return s

    def validate(self, v: _Obj) -> T:
        """Normalize (text), then check kind, length, pattern and bounds. Returns the clean value or raises ScalarError."""
        r = self._check(v)
        if r is _NO:
            raise ScalarError(self)
        return r  # type: ignore[no-any-return]

    def is_valid(self, v: _Obj) -> bool:
        """True exactly when `validate(v)` would succeed. Never builds an error."""
        return self._check(v) is not _NO

    def _in_range(self, n: float) -> bool:
        lo = self._minimum
        hi = self._maximum
        return (lo is None or n >= lo) and (hi is None or n <= hi)

    def _check(self, v: _Any) -> _Any:
        kind = self._kind
        if kind == "text":
            if not _b.isinstance(v, str):
                return _NO
            top = self._max_len
            gate = self._case_at if top is not None else -1
            i = 0
            for step in self._steps:
                # Text already too long is refused before case mapping copies it.
                if i == gate and len(v) > top:
                    return _NO
                v = step(v)
                i += 1
            n = len(v)
            if n < self._min_len or (top is not None and n > top):
                return _NO
            pattern = self._pattern
            if pattern is not None:
                rx = self._re
                if rx is None:
                    rx = self._re = _re.compile(pattern)
                if rx.fullmatch(v) is None:  # not match/search: "$" would also accept a final "\n"
                    return _NO
            return v
        if kind == "integer":
            if _b.isinstance(v, bool):
                return _NO
            if _b.isinstance(v, float):
                if not _math.isfinite(v) or not v.is_integer():
                    return _NO
                v = int(v)
            elif not _b.isinstance(v, int):
                return _NO
            return v if self._in_range(v) else _NO
        if kind == "number":
            if _b.isinstance(v, bool) or not _b.isinstance(v, (int, float)):
                return _NO
            if _b.isinstance(v, float) and not _math.isfinite(v):
                return _NO
            if not self._in_range(v):
                return _NO
            try:
                return float(v)  # the native value of a number type is a float
            except OverflowError:  # an int too large for a float
                return _NO
        if kind == "boolean":
            return v if _b.isinstance(v, bool) else _NO
        if kind == "object":
            return v if _b.isinstance(v, dict) else _NO
        if kind == "array":
            return v if _b.isinstance(v, list) else _NO
        return v


_index: dict[str, Scalar[_Any]] | None = None  # every name and alias, built on the first get()


def _clean(word: str) -> str:
    """The lookup key: trim, lowercase, each run of spaces and hyphens becomes one underscore. One pass, no regex."""
    s = word.strip(_WS).lower()
    if " " not in s and "-" not in s:
        return s
    out: list[str] = []
    gap = False
    for ch in s:
        if ch == " " or ch == "-":
            gap = True
        else:
            if gap:
                out.append("_")
                gap = False
            out.append(ch)
    if gap:
        out.append("_")
    return "".join(out)


def get(word: Name | str) -> Scalar[_Any] | None:
    """Find a type by name or alias; spacing, hyphens and case are forgiven. Nothing found gives None."""
    global _index
    if not _b.isinstance(word, str):
        return None
    index = _index
    if index is None:
        index = {}
        for t in all:  # the tuple below, not the builtin
            index[t.name] = t
        for t in all:
            for alias in t.aliases:
                index.setdefault(alias, t)
        _index = index
    found = index.get(word)
    if found is None:
        key = _clean(word)
        if key != word:
            found = index.get(key)
    return found
