"""Scalar types: one `Scalar` per type, each with `normalize`, `validate` and `is_valid`."""

from __future__ import annotations

import builtins as _b
import math as _math
import re as _re
from typing import Any as _Any
from typing import Final, Generic, Literal, TypeVar

T = TypeVar("T")

# Each type is a module attribute named after the type (`any`, `object`, `all` already shadow builtins), so the
# engine reaches every builtin it calls as `_b.x`: a new type name can never change what the engine runs.

# Unicode White_Space, written out. `str.strip()` without an argument also strips U+001C-U+001F, which is not white space.
_WS: Final = (
    "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680\u2000\u2001\u2002\u2003"
    "\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"
)

_Obj = _b.object  # annotations say `object`, which the table below shadows
# Reason and _FAIL are emitted after this file, from $meta.reasons.


class _Failure:
    """What _check returns for "not valid": one module constant per reason (_FAIL), so it allocates nothing."""

    __slots__ = ("reason",)

    def __init__(self, reason: str) -> None:
        self.reason = reason


class ScalarError(_b.ValueError):
    """A value failed a type's rule. `str(error)` is the type's `error` text; `scalar` is the type; `reason` is the
    first rule the value broke (a `Reason`)."""

    def __init__(self, scalar: Scalar[_Any], reason: str) -> None:
        _b.super(ScalarError, self).__init__(scalar.error)
        self.scalar = scalar
        self.reason = reason


def _trim(s: str) -> str:
    return s.strip(_WS)


def _well_formed(s: str) -> bool:
    """True when `s` is Unicode scalar values only (no lone surrogate), as WHATWG USVString and RFC 7493 require.

    A Python str can hold U+D800-U+DFFF (from "\\ud800", surrogateescape, json.loads); strict UTF-8 encoding
    refuses exactly those. ASCII text is skipped in O(1): CPython records it when it builds the string.
    """
    if s.isascii():
        return True
    try:
        s.encode("utf-8")
    except _b.UnicodeEncodeError:
        return False
    return True


def _remove_spaces(s: str) -> str:
    return s.replace(" ", "")


def _remove_hyphens(s: str) -> str:
    return s.replace("-", "")


# Each step by name, resolved once per type in Scalar.__init__. No regex here: str.lower/upper are the full
# Unicode mapping, in C, and linear.
_STEPS: Final = {
    "trim": _trim,
    "lowercase": _b.str.lower,
    "uppercase": _b.str.upper,
    "remove_spaces": _remove_spaces,
    "remove_hyphens": _remove_hyphens,
}


# The checks of $meta.checks. Each runs on the normalized value after the pattern matched, so it reads ASCII of the
# pattern's shape: digits where the pattern put digits. All are O(n).
def _gs1_mod10(s: str) -> bool:
    n = _b.len(s)
    t = 0
    for i in _b.range(n):
        t += (_b.ord(s[n - 1 - i]) - 48) * (3 if i % 2 else 1)
    return t % 10 == 0


def _mod97(s: str, start: int) -> bool:
    """ISO 7064 MOD 97-10 over s[start:] then s[:start]: one pass, no rotated copy."""
    n = _b.len(s)
    r = 0
    for k in _b.range(n):
        c = _b.ord(s[(start + k) % n])
        r = (r * 100 + c - 55) % 97 if c >= 65 else (r * 10 + c - 48) % 97  # A-Z are 10-35
    return r == 1


def _isbn(s: str) -> bool:
    if _b.len(s) == 13:
        return _gs1_mod10(s)
    t = 0
    for i in _b.range(10):
        c = s[i]
        t += (10 if c in "Xx" else _b.ord(c) - 48) * (10 - i)
    return t % 11 == 0


def _mod11_2(s: str) -> bool:
    t = 0
    for c in s[:-1]:
        if c != "-":
            t = (t + _b.ord(c) - 48) * 2 % 11  # reduced each step: linear at any length
    r = (12 - t % 11) % 11
    return s[-1] == ("X" if r == 10 else _b.str(r))


def _at_most(s: str, start: int, top: str) -> bool:
    """Digits from start compared with top as text: leading zeros skipped, then fewer digits is smaller."""
    n = _b.len(s)
    i = start
    while i < n - 1 and s[i] == "0":
        i += 1
    if n - i != _b.len(top):
        return n - i < _b.len(top)
    return s[i:] <= top


_CHECKS: Final = {
    "gs1_mod10": _gs1_mod10,
    "iso7064_mod97_10": lambda s: _mod97(s, 0),
    "iban": lambda s: _mod97(s, 4),
    "isbn": _isbn,
    "iso7064_mod11_2": _mod11_2,
    "int64_range": lambda s: _at_most(s, 1, "9223372036854775808") if s[:1] == "-" else _at_most(s, 0, "9223372036854775807"),
    "uint64_range": lambda s: _at_most(s, 0, "18446744073709551615"),
}


class Scalar(Generic[T]):
    """One scalar type. Instances are plain records; the regex is compiled on first use.

    `examples["invalid"]` values break the type's raw rule (pattern, length or bounds) before any cleanup; a few
    become valid after `normalize` (country "us" -> "US").
    """

    __slots__ = (
        "name", "label", "hint", "error", "details", "level", "primitive", "aliases", "params", "examples", "check",
        "_kind", "_steps", "_case_at", "_form_at", "_early", "_pattern", "_min_len", "_max_len", "_minimum", "_maximum", "_re", "_test",
        "_list",
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
        params: tuple[str, ...] = (),
        kind: str = "any",
        steps: tuple[str, ...] = (),
        pattern: str | None = None,
        check: str | None = None,
        list: tuple[str, ...] | None = None,  # shadows the builtin here only: the engine calls builtins as _b.x
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
        self.params = params  # names from $meta.params that a field of this type can set
        self.examples = examples
        self._kind = kind
        self._steps = _b.tuple(_STEPS[s] for s in steps)  # a bad name fails here, not on first use
        # Index of the first case step: the length gate runs just before it, since case mapping never shortens
        # text but remove_spaces and remove_hyphens do.
        self._case_at = _b.next((i for i, s in _b.enumerate(steps) if s in ("lowercase", "uppercase")), -1)
        # Index of the first step that is not trim: the well-formed check runs just before it (or after the last
        # step). Trim cannot join two halves of a pair; remove_spaces and remove_hyphens could, so they come after.
        self._form_at = _b.next((i for i, s in _b.enumerate(steps) if s != "trim"), _b.len(steps))
        # Text already too long is refused there too, before the check reads it, unless a later step can shorten it.
        self._early = max_len is not None and not _b.any(s in ("remove_spaces", "remove_hyphens") for s in steps)
        self._pattern = pattern
        self.check = check  # the name of the rule beyond the pattern ($meta.checks), or None
        self._test = None if check is None else _CHECKS[check]  # a bad name fails here, not on first use
        self._list = None if list is None else _b.frozenset(list)  # the type's enum: a closed list, checked last
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
        if _b.isinstance(r, _Failure):
            raise ScalarError(self, r.reason)
        return r  # type: ignore[no-any-return]

    def is_valid(self, v: _Obj) -> bool:
        """True exactly when `validate(v)` would succeed. Never builds an error."""
        return not _b.isinstance(self._check(v), _Failure)

    def _in_range(self, n: float) -> bool:
        lo = self._minimum
        hi = self._maximum
        return (lo is None or n >= lo) and (hi is None or n <= hi)

    def _formed(self, s: str) -> _Failure | None:
        """Once trimmed: not already too long (O(1)), then well-formed Unicode. The failure, or None."""
        top = self._max_len
        if self._early and top is not None and _b.len(s) > top:
            return _FAIL.TOO_LONG
        return None if _well_formed(s) else _FAIL.MALFORMED

    def _check(self, v: _Any) -> _Any:
        kind = self._kind
        if kind == "text":
            if not _b.isinstance(v, _b.str):
                return _FAIL.WRONG_KIND
            top = self._max_len
            gate = self._case_at if top is not None else -1
            form = self._form_at
            i = 0
            for step in self._steps:
                if i == form:
                    f = self._formed(v)
                    if f is not None:
                        return f
                # Text already too long is refused before case mapping copies it.
                if i == gate and _b.len(v) > top:
                    return _FAIL.TOO_LONG
                v = step(v)
                i += 1
            if i == form:
                f = self._formed(v)
                if f is not None:
                    return f
            n = _b.len(v)
            if top is not None and n > top:
                return _FAIL.TOO_LONG
            if n < self._min_len:
                return _FAIL.TOO_SHORT
            pattern = self._pattern
            if pattern is not None:
                rx = self._re
                if rx is None:
                    rx = self._re = _re.compile(pattern)
                if rx.fullmatch(v) is None:  # not match/search: "$" would also accept a final "\n"
                    return _FAIL.PATTERN
            test = self._test
            if test is not None and not test(v):
                return _FAIL.CHECK
            codes = self._list
            if codes is not None and v not in codes:
                return _FAIL.NOT_IN_LIST
            return v
        if kind == "integer":
            if _b.isinstance(v, _b.bool):
                return _FAIL.WRONG_KIND
            if _b.isinstance(v, _b.float):
                if not _math.isfinite(v) or not v.is_integer():
                    return _FAIL.WRONG_KIND
                v = _b.int(v)
            elif not _b.isinstance(v, _b.int):
                return _FAIL.WRONG_KIND
            return v if self._in_range(v) else _FAIL.OUT_OF_RANGE
        if kind == "number":
            if _b.isinstance(v, _b.bool) or not _b.isinstance(v, (_b.int, _b.float)):
                return _FAIL.WRONG_KIND
            if _b.isinstance(v, _b.float) and not _math.isfinite(v):
                return _FAIL.OUT_OF_RANGE
            if not self._in_range(v):
                return _FAIL.OUT_OF_RANGE
            try:
                return _b.float(v)  # the native value of a number type is a float
            except _b.OverflowError:  # an int too large for a float
                return _FAIL.OUT_OF_RANGE
        if kind == "boolean":
            return v if _b.isinstance(v, _b.bool) else _FAIL.WRONG_KIND
        if kind == "object":
            return v if _b.isinstance(v, _b.dict) else _FAIL.WRONG_KIND
        if kind == "array":
            return v if _b.isinstance(v, _b.list) else _FAIL.WRONG_KIND
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
    if not _b.isinstance(word, _b.str):
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
