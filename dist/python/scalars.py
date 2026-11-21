# scalars.py, catalogue version 0.4.0.
# Generated from dist/scalars.json by dev/codegen/python.mjs. Do not edit: run `npm run build` in dev/.
# Requires Python >= 3.10 (tested on 3.14). No dependencies.
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
_NO: Final = _Obj()  # what _check returns for "not valid"; a value can never be this object


class ScalarError(_b.ValueError):
    """A value failed a type's rule. `str(error)` is the type's `error` text; `scalar` is the type."""

    def __init__(self, scalar: Scalar[_Any]) -> None:
        _b.super(ScalarError, self).__init__(scalar.error)
        self.scalar = scalar


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

    def _formed(self, s: str) -> bool:
        """Once trimmed: not already too long (O(1)), then well-formed Unicode."""
        top = self._max_len
        if self._early and top is not None and _b.len(s) > top:
            return False
        return _well_formed(s)

    def _check(self, v: _Any) -> _Any:
        kind = self._kind
        if kind == "text":
            if not _b.isinstance(v, _b.str):
                return _NO
            top = self._max_len
            gate = self._case_at if top is not None else -1
            form = self._form_at
            i = 0
            for step in self._steps:
                if i == form and not self._formed(v):
                    return _NO
                # Text already too long is refused before case mapping copies it.
                if i == gate and _b.len(v) > top:
                    return _NO
                v = step(v)
                i += 1
            if i == form and not self._formed(v):
                return _NO
            n = _b.len(v)
            if n < self._min_len or (top is not None and n > top):
                return _NO
            pattern = self._pattern
            if pattern is not None:
                rx = self._re
                if rx is None:
                    rx = self._re = _re.compile(pattern)
                if rx.fullmatch(v) is None:  # not match/search: "$" would also accept a final "\n"
                    return _NO
            test = self._test
            if test is not None and not test(v):
                return _NO
            return v
        if kind == "integer":
            if _b.isinstance(v, _b.bool):
                return _NO
            if _b.isinstance(v, _b.float):
                if not _math.isfinite(v) or not v.is_integer():
                    return _NO
                v = _b.int(v)
            elif not _b.isinstance(v, _b.int):
                return _NO
            return v if self._in_range(v) else _NO
        if kind == "number":
            if _b.isinstance(v, _b.bool) or not _b.isinstance(v, (_b.int, _b.float)):
                return _NO
            if _b.isinstance(v, _b.float) and not _math.isfinite(v):
                return _NO
            if not self._in_range(v):
                return _NO
            try:
                return _b.float(v)  # the native value of a number type is a float
            except _b.OverflowError:  # an int too large for a float
                return _NO
        if kind == "boolean":
            return v if _b.isinstance(v, _b.bool) else _NO
        if kind == "object":
            return v if _b.isinstance(v, _b.dict) else _NO
        if kind == "array":
            return v if _b.isinstance(v, _b.list) else _NO
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


# Models: a file of domains, models and fields (parsed JSON), loaded once, then payloads checked against a model.
# A port of dev/lib/models.mjs, the reference every engine copies. Load is O(file) and iterative: no recursion is
# driven by the input. Validate recurses, but load bounds a payload's depth at _MAX_DEPTH levels.

from typing import NamedTuple as _NamedTuple

_MAX_DEPTH: Final = 64  # nesting deeper than this, each model and each `items` one level, is refused at load
_DIGIT_SETTINGS: Final = ("precision", "scale")  # refused on number-kind types: float text differs by language
_INTERNAL: Final = _Obj()  # the key only models() holds: a Model or Models built by hand would skip load's checks


def _internal_only(key: _Obj, what: str) -> None:
    """Refuses a constructor call from outside this module."""
    if key is not _INTERNAL:
        raise _b.TypeError(f"{what} is built by models(), not called directly")


class Problem(_NamedTuple):
    """One problem: an RFC 6901 `pointer`, a fixed `code`, the `params` the message needs, the English `message`."""

    pointer: str
    code: str
    params: dict[str, _Any]
    message: str


def _joined(problems: tuple[Problem, ...]) -> str:
    return "; ".join(f"{p.pointer}: {p.message}" for p in problems)


class ModelsError(_b.ValueError):
    """A models file was refused. `problems` lists every problem in it, sorted by location."""

    def __init__(self, problems: tuple[Problem, ...]) -> None:
        _b.super(ModelsError, self).__init__(_joined(problems))
        self.problems = problems


class ModelError(_b.ValueError):
    """A payload failed its model. `problems` lists every problem in it, sorted by location."""

    def __init__(self, problems: tuple[Problem, ...]) -> None:
        _b.super(ModelError, self).__init__(_joined(problems))
        self.problems = problems


def _escape(s: _Any) -> str:
    return _b.str(s).replace("~", "~0").replace("/", "~1")


_PLACEHOLDER: _re.Pattern[str] | None = None  # compiled on the first template that has a placeholder


def _fill(code: str, params: dict[str, _Any]) -> str:
    """The code's `_ERRORS` template with each `{name}` replaced: a list joined with ", ", anything else as text."""
    global _PLACEHOLDER
    template: str = _ERRORS[code]
    if "{" not in template:
        return template
    rx = _PLACEHOLDER
    if rx is None:
        rx = _PLACEHOLDER = _re.compile(r"\{([a-z_]+)\}")

    def one(m: _re.Match[str]) -> str:
        name = m.group(1)
        if name not in params:
            raise _b.KeyError(f'Code "{code}" needs param "{name}"')
        v = params[name]
        return ", ".join(_b.str(x) for x in v) if _b.isinstance(v, _b.list) else _b.str(v)

    return rx.sub(one, template)


def _problem(segments: list[_Any], code: str, params: dict[str, _Any], message: str | None = None) -> tuple[_Any, Problem]:
    """A problem at `segments` (keys and list indices), paired with the key its order needs: a key "10" and an index
    10 differ, which the pointer text can't tell. A code without a template (`invalid`) needs `message`."""
    if code in _ERRORS:
        message = _fill(code, params)
    elif not _b.isinstance(message, _b.str):
        raise _b.KeyError(f'Code "{code}" has no template, so it needs a message')
    pointer = "".join("/" + _escape(s) for s in segments)
    # Segment by segment: an index before a key, indices numerically, keys by code point (Python's str order); a
    # parent before its children (the shorter tuple first); then by code.
    key = (_b.tuple((0, s) if _b.type(s) is _b.int else (1, _b.str(s)) for s in segments), code)
    return key, Problem(pointer, code, params, message)


def _sorted(problems: list[tuple[_Any, Problem]]) -> tuple[Problem, ...]:
    problems.sort(key=lambda kp: kp[0])
    return _b.tuple(p for _, p in problems)


class _Catalogue:
    """Built on the first models() call, not at import: the name patterns and the settings each type takes."""

    __slots__ = ("name", "ref", "settings")

    def __init__(self) -> None:
        # Used with fullmatch, not match: "$" would also accept a final "\n".
        self.name = _re.compile(r"[a-z][a-z0-9_]*")
        self.ref = _re.compile(r"(?:([a-z][a-z0-9_]*):)?([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?")
        self.settings: dict[str, tuple[str, ...]] = {}
        for t in all:  # the tuple of types, not the builtin
            p = t.params
            self.settings[t.name] = _b.tuple(x for x in p if x not in _DIGIT_SETTINGS) if t._kind == "number" else p


_catalogue: _Catalogue | None = None


def _type_named(name: str) -> Scalar[_Any] | None:
    """The type whose canonical name is exactly `name`, or None: get() forgives aliases, a models file doesn't."""
    found = get(name)
    return found if found is not None and found.name == name else None


def _is_integer(v: _Any) -> bool:
    if _b.isinstance(v, _b.bool):
        return False
    if _b.isinstance(v, _b.int):
        return True
    return _b.isinstance(v, _b.float) and _math.isfinite(v) and v.is_integer()


class _Field:
    """A resolved field: kind "type" (a scalar and its settings), "model" (a full model name) or "array" (`items`).
    The settings validate reads are unpacked here once, at load."""

    __slots__ = ("kind", "nullable", "type", "settings", "allowed", "model", "target", "items", "length", "values",
                 "precision", "scale", "limited")

    def __init__(self, kind: str, nullable: bool, *, type: Scalar[_Any] | None = None, settings: dict[str, _Any] | None = None,
                 allowed: frozenset[str] | None = None, model: str = "", items: _Field | None = None) -> None:
        self.kind = kind
        self.nullable = nullable
        self.type = type
        self.settings = settings
        self.allowed = allowed  # the set of `values`, built once per written list and shared by its copies
        self.model = model
        self.target: Model | None = None  # the loaded Model named `model`, bound once the file has loaded
        self.items = items
        s = {} if settings is None else settings
        self.length = s.get("length")
        self.values = s.get("values")
        self.precision = s.get("precision")
        self.scale = s.get("scale", 0)
        # Whether validate has any setting to check after the type's own: a plain field skips those reads.
        self.limited = self.length is not None or self.values is not None or self.precision is not None


class _Def:
    """A written field, or an `items` definition (linked to its parent instead of copying the path), during load."""

    __slots__ = ("segments", "up", "raw", "domain", "ref", "items", "field", "leaf", "arrays", "failed",
                 "index", "low", "on_stack", "done", "self_loop")
    is_model = False

    def __init__(self, segments: list[_Any] | None, raw: _Any, domain: str, up: _Def | None = None) -> None:
        self.segments = segments
        self.up = up
        self.raw = raw
        self.domain = domain
        self.ref: tuple[str, _Any] | None = None  # ("type", Scalar) | ("model", _Node) | ("field", _Def)
        self.items: _Def | None = None
        self.field: _Field | None = None
        self.leaf: _Node | None = None  # the model this field nests, through any `items`
        self.arrays = 0  # how many `items` levels lie on the way to it
        self.failed = False
        self.index = -1
        self.low = -1
        self.on_stack = False
        self.done = False
        self.self_loop = False

    def path(self, *extra: _Any) -> list[_Any]:
        """The segments, built only for a problem, so a deep `items` chain stays linear."""
        tail = 0
        d = self
        while d.up is not None:
            tail += 1
            d = d.up
        return [*d.segments, *(["items"] * tail), *extra]  # type: ignore[misc]


class _Node:
    """A model during load."""

    __slots__ = ("name", "fields", "list", "index", "low", "on_stack", "done", "self_loop")
    is_model = True

    def __init__(self, name: str) -> None:
        self.name = name
        self.fields: dict[str, _Def] = {}
        self.list: list[_Def] = []
        self.index = -1
        self.low = -1
        self.on_stack = False
        self.done = False
        self.self_loop = False


class _Loader:
    """One load of a models file: the steps of dev/lib/models.mjs loadModels, in order."""

    def __init__(self, data: dict[_Any, _Any], cat: _Catalogue) -> None:
        self.cat = cat
        self.problems: list[tuple[_Any, Problem]] = []
        self.nodes: dict[str, _Node] = {}  # "domain:model" -> model node
        self.defs: list[_Def] = []  # every written field, in file order
        self.fields: list[_Field] = []  # every field resolve built, `items` included: models() binds their targets
        self.names(data)
        for d in self.defs:
            self.parse(d)
        self.resolve_all()
        self.depths()

    def report(self, segments: list[_Any], code: str, params: dict[str, _Any] | None = None) -> None:
        self.problems.append(_problem(segments, code, {} if params is None else params))

    def named(self, k: _Any) -> bool:
        return _b.isinstance(k, _b.str) and self.cat.name.fullmatch(k) is not None

    def names(self, data: dict[_Any, _Any]) -> None:
        """1. Names. A badly named entry is reported and its content isn't examined."""
        for d, domain in data.items():
            if d == "$schema":
                continue
            if not self.named(d):
                self.report([d], "bad_name")
                continue
            if not _b.isinstance(domain, _b.dict):
                self.report([d], "not_object")
                continue
            for m, fields in domain.items():
                if not self.named(m):
                    self.report([d, m], "bad_name")
                    continue
                if _type_named(m) is not None:
                    self.report([d, m], "type_name")
                    continue
                if not _b.isinstance(fields, _b.dict):
                    self.report([d, m], "not_object")
                    continue
                node = _Node(f"{d}:{m}")
                self.nodes[node.name] = node
                for f, raw in fields.items():
                    if not self.named(f):
                        self.report([d, m, f], "bad_name")
                        continue
                    df = _Def([d, m, f], raw, d)
                    node.fields[f] = df
                    node.list.append(df)
                    self.defs.append(df)

    def parse(self, df: _Def) -> None:
        """2. A reference, read once in the domain where it's written. Sets df.ref, or reports and leaves it None."""
        raw = df.raw
        if _b.isinstance(raw, _b.str):
            written = raw
        elif not _b.isinstance(raw, _b.dict):
            return self.report(df.path(), "bad_setting")
        elif _b.isinstance(raw.get("type"), _b.str):
            written = raw["type"]
        else:
            return self.report(df.path(), "missing_setting", {"setting": "type"})
        m = self.cat.ref.fullmatch(written)
        if m is None:
            return self.report(df.path(), "unresolved")
        domain, name, field = m.groups()
        home = f"{df.domain if domain is None else domain}:{name}"
        if field is not None:
            node = self.nodes.get(home)
            target = None if node is None else node.fields.get(field)
            if target is None:
                return self.report(df.path(), "unresolved")
            df.ref = ("field", target)
            return None
        t = None if domain is not None else _type_named(name)
        alias = None if domain is not None or t is not None else get(name)
        if t is not None:
            df.ref = ("type", t)
        elif home in self.nodes:
            df.ref = ("model", self.nodes[home])
        elif alias is not None:
            self.report(df.path(), "alias", {"canonical": alias.name})
        else:
            self.report(df.path(), "unresolved")
        return None

    def takes_items(self, v: _Def) -> bool:
        ref = v.ref
        if ref is None or not _b.isinstance(v.raw, _b.dict) or "items" not in v.raw:
            return False
        if ref[0] == "type":
            return ref[1].name == "array"  # type: ignore[no-any-return]
        t = ref[1]
        return ref[0] == "field" and t.done and not t.failed and t.field.kind == "array"  # type: ignore[no-any-return]

    def successor(self, frame: list[_Any]) -> _Any:
        """The next node `frame`'s node points to, or None once it has no more."""
        v = frame[0]
        if v.is_model:
            step = frame[1]
            if step < _b.len(v.list):
                frame[1] = step + 1
                return v.list[step]
            return None
        while frame[1] < 2:
            step = frame[1]
            frame[1] = step + 1
            if step == 0 and v.ref is not None and v.ref[0] != "type":
                return v.ref[1]
            if step == 1 and self.takes_items(v):
                v.items = _Def(None, v.raw["items"], v.domain, v)
                self.parse(v.items)
                return v.items
        return None

    def resolve_all(self) -> None:
        """3. Resolution and cycles in one pass: Tarjan's strongly connected components over written fields and
        models, with an explicit stack. Edges: a model reference -> that model; a model -> its fields; a field
        reference -> the field it copies; an array field -> its `items`. A field's settings, `items` included, are
        read only once its type resolves, so `items` is an edge only when the resolved type is an array.
        Components finish dependencies-first, so each field resolves exactly once, after what it copies."""
        counter = 0
        stack: list[_Any] = []
        for root in self.defs:
            if root.index >= 0:
                continue
            root.index = root.low = counter
            counter += 1
            root.on_stack = True
            stack.append(root)
            calls: list[list[_Any]] = [[root, 0]]
            while calls:
                frame = calls[-1]
                v = frame[0]
                w = self.successor(frame)
                if w is not None:
                    if w.index < 0:
                        w.index = w.low = counter
                        counter += 1
                        w.on_stack = True
                        stack.append(w)
                        calls.append([w, 0])
                    elif w.on_stack:
                        v.low = _b.min(v.low, w.index)
                        if w is v:
                            v.self_loop = True
                    continue
                calls.pop()
                if calls:
                    up = calls[-1][0]
                    up.low = _b.min(up.low, v.low)
                if v.low != v.index:
                    continue
                component = []
                while True:
                    u = stack.pop()
                    u.on_stack = False
                    u.done = True
                    component.append(u)
                    if u is v:
                        break
                if _b.len(component) > 1 or v.self_loop:
                    # A cycle: every field on it fails; the problem is reported at each reference on it.
                    for n in component:
                        if n.is_model:
                            continue
                        n.failed = True
                        if n.ref[0] != "type":
                            self.report(n.path(), "cycle")
                elif not v.is_model:
                    self.resolve(v)

    def resolve(self, v: _Def) -> None:
        """Builds v.field from its resolved type plus the settings written next to it, or marks v failed."""
        ref = v.ref
        if ref is None or (ref[0] == "field" and ref[1].failed):
            v.failed = True
            return
        kind, target = ref
        if kind == "field":
            base: _Field = target.field
        elif kind == "model":
            base = _Field("model", False, model=target.name)
        elif target.name == "array":
            base = _Field("array", False)
        else:
            base = _Field("type", False, type=target, settings={})
        typ = base.type if base.kind == "type" else None
        allowed: tuple[str, ...] = self.cat.settings[typ.name] if typ is not None else ("items",) if base.kind == "array" else ()
        written: dict[_Any, _Any] = v.raw if _b.isinstance(v.raw, _b.dict) else {}
        settings = _b.dict(base.settings) if typ is not None else None  # type: ignore[arg-type]
        nullable = base.nullable
        items = base.items
        values_set = base.allowed
        failed = False
        before = _b.len(self.problems)
        for key in written:
            if key == "type":
                continue
            if key == "nullable":
                if self.check_setting(None, v, key):
                    nullable = written[key]
            elif key not in allowed:
                self.report(v.path(key), "unknown_setting")
            elif key == "items":
                if v.items.failed:  # type: ignore[union-attr]
                    failed = True
                else:
                    items = v.items.field  # type: ignore[union-attr]
            elif self.check_setting(typ, v, key):
                value = written[key]
                if _b.isinstance(value, _b.list):
                    # A list setting (`values`) is copied, so the loaded models never alias the caller's data.
                    value = _b.list(value)
                    if key == "values":
                        values_set = _b.frozenset(value)
                elif _b.isinstance(value, _b.float):
                    value = _b.int(value)  # an integral float (3.0) is the integer it holds
                settings[key] = value  # type: ignore[index]

        def has(key: str) -> bool:
            # A written setting counts as present even when its value was refused, so it isn't also reported missing.
            return key in written or (settings is not None and key in base.settings)  # type: ignore[operator]

        if base.kind == "array" and items is None and not has("items"):
            self.report(v.path(), "missing_setting", {"setting": "items"})
        if typ is not None and typ.name == "enum" and not has("values"):
            self.report(v.path(), "missing_setting", {"setting": "values"})
        if "scale" in allowed and has("scale") and not has("precision"):
            self.report(v.path("scale"), "missing_setting", {"setting": "precision"})
        if failed or _b.len(self.problems) > before:
            v.failed = True
            return
        if typ is not None:
            v.field = _Field("type", nullable, type=typ, settings=settings, allowed=values_set)
        elif base.kind == "array":
            v.field = _Field("array", nullable, items=items)
        else:
            v.field = _Field("model", nullable, model=base.model)
        self.fields.append(v.field)
        # The model this field nests, through any `items` (an edge of the nesting graph), and how many `items`
        # levels lie on the way: each counts toward the depth limit like a model.
        if kind == "model":
            src = None
        elif base.kind == "array":
            src = target if items is base.items else v.items
        elif kind == "field":
            src = target
        else:
            src = None
        v.leaf = target if kind == "model" else None if src is None else src.leaf
        v.arrays = 0 if src is None else 1 + src.arrays if src is v.items else src.arrays

    def check_setting(self, typ: Scalar[_Any] | None, v: _Def, key: str) -> bool:
        """Checks the value v's `key` holds against its `_PARAM_RULES` rule; reports and returns False when refused."""
        rule = _PARAM_RULES[key]
        value = v.raw[key]
        kind = rule["kind"]
        if kind == "boolean":
            ok = _b.isinstance(value, _b.bool)
        elif kind == "integer":
            lo = rule["minimum"]
            hi = rule["maximum"]
            ok = _is_integer(value) and (lo is None or value >= lo) and (hi is None or value <= hi)
        elif kind == "array":
            least = rule["minItems"]
            ok = _b.isinstance(value, _b.list) and (least is None or _b.len(value) >= least)
            # Entries must be strings, unique, already clean (the type's validate returns each unchanged), and
            # within maxItemBytes as UTF-8.
            if ok:
                seen: set[str] = _b.set()
                most = rule["maxItemBytes"]
                for i, entry in _b.enumerate(value):
                    r = typ._check(entry) if _b.isinstance(entry, _b.str) else _NO  # type: ignore[union-attr]
                    fits = r is not _NO and (most is None or _b.len(entry.encode("utf-8")) <= most)
                    if fits and r == entry and entry not in seen:
                        seen.add(entry)
                    else:
                        self.report(v.path(key, i), "bad_setting")
                        ok = False
                return ok
        else:
            raise _b.ValueError(f'Setting "{key}" has unknown kind "{kind}"')
        if not ok:
            self.report(v.path(key), "bad_setting")
        return ok

    def depths(self) -> None:
        """4. Nesting depth: the longest chain of levels, where each model and each `items` is one level (acyclic now:
        fields on cycles failed above). Post-order with an explicit stack. A model of plain fields has depth 1; a
        field adds its `items` levels plus the depth of the model it nests."""
        depth: dict[_Node, int] = {}

        def field_depth(d: _Def) -> int:
            return d.arrays + (0 if d.leaf is None else depth[d.leaf])

        for start in self.nodes.values():
            if start in depth:
                continue
            calls: list[list[_Any]] = [[start, 0, 1]]  # model, next field, depth so far
            open_ = {start}
            while calls:
                frame = calls[-1]
                model = frame[0]
                if frame[1] < _b.len(model.list):
                    d = model.list[frame[1]]
                    leaf = d.leaf
                    if leaf is not None and leaf not in depth:
                        # Visit the nested model first, then come back to this field.
                        if leaf in open_:
                            raise _b.AssertionError(f'Model cycle through "{leaf.name}" survived resolution')
                        open_.add(leaf)
                        calls.append([leaf, 0, 1])
                        continue
                    frame[1] += 1
                    if not d.failed:
                        frame[2] = _b.max(frame[2], 1 + field_depth(d))
                    continue
                calls.pop()
                open_.discard(model)
                depth[model] = frame[2]
        # Reported once per too-deep chain: at the outermost too-deep model, on each field that makes it too deep.
        deep = [m for m in self.nodes.values() if depth[m] > _MAX_DEPTH]
        inner = {d.leaf for m in deep for d in m.list if d.leaf is not None and depth[d.leaf] > _MAX_DEPTH}
        for m in deep:
            if m in inner:
                continue
            for d in m.list:
                if not d.failed and 1 + field_depth(d) > _MAX_DEPTH:
                    self.report(d.segments, "too_deep", {"max": _MAX_DEPTH})  # type: ignore[arg-type]


class Model:
    """One model of a loaded models file: `validate(payload)` and `is_valid(payload)`. Only `models()` builds one."""

    __slots__ = ("name", "_fields", "_entries", "_root")

    def __init__(self, key: _Obj, name: str, fields: dict[str, _Field]) -> None:
        _internal_only(key, "Model")
        self.name = name
        self._fields = fields
        self._entries = _b.tuple(fields.items())  # (name, field) in declared order, built once, not per payload
        self._root = _Field("model", False, model=name)  # the payload itself, a value of this model
        self._root.target = self

    def __repr__(self) -> str:
        return f"<Model {self.name}>"

    def validate(self, payload: _Obj) -> dict[str, _Any]:
        """The cleaned payload (declared keys only, normalized values, a missing nullable key as None), or raises
        ModelError listing every problem, sorted."""
        problems: list[tuple[_Any, Problem]] = []
        out = _Run(problems, False).root(self, payload)
        if problems:
            raise ModelError(_sorted(problems))
        return out  # type: ignore[no-any-return]

    def is_valid(self, payload: _Obj) -> bool:
        """True exactly when `validate(payload)` would succeed. Stops at the first problem."""
        problems: list[tuple[_Any, Problem]] = []
        try:
            _Run(problems, True).root(self, payload)
        except _Stop:
            return False
        return not problems


class _Stop(_b.Exception):
    """is_valid found a problem: nothing more needs checking."""


class _Run:
    """One payload's walk. A location is a link (parent, segment), so a deep value costs O(1); the segments are
    built only for a problem. Recursion follows the models, at most _MAX_DEPTH levels, never the input."""

    __slots__ = ("problems", "first")

    def __init__(self, problems: list[tuple[_Any, Problem]], first: bool) -> None:
        self.problems = problems
        self.first = first

    def report(self, at: _Any, code: str, params: dict[str, _Any] | None = None, message: str | None = None) -> None:
        if self.first:
            raise _Stop
        segments = []
        while at is not None:
            at, seg = at
            segments.append(seg)
        segments.reverse()
        self.problems.append(_problem(segments, code, {} if params is None else params, message))

    def root(self, model: Model, payload: _Any) -> _Any:
        if not _b.isinstance(payload, _b.dict):
            self.report(None, "not_object")
            return None
        return self.walk(model._root, payload, None, None)

    def walk(self, f: _Field, v: _Any, up: _Any, seg: _Any) -> _Any:
        """The cleaned `v`, which sits at segment `seg` under location `up` (the root: both None). Its own location
        link is made only when it's needed: for a problem, or as the parent of its entries."""
        if v is None:
            if not f.nullable:
                self.report(_at(up, seg), "required")
            return None
        kind = f.kind
        if kind == "type":
            t: Scalar[_Any] = f.type  # type: ignore[assignment]
            r = t._check(v)
            if r is _NO:
                self.report(_at(up, seg), "invalid", {"type": t.name}, t.error)
                return None
            if f.limited:
                length = f.length
                if length is not None and _b.len(r) > length:  # a str's len counts code points
                    self.report(_at(up, seg), "too_long", {"max": length})
                if f.allowed is not None and r not in f.allowed:
                    self.report(_at(up, seg), "not_allowed", {"values": _b.list(f.values)})  # type: ignore[arg-type]
                if f.precision is not None and not _fits_numeric(r, f.precision, f.scale):
                    self.report(_at(up, seg), "too_many_digits", {"precision": f.precision, "scale": f.scale})
            return r
        # A container's own link is the parent of its entries' links (inline: no call per container).
        at = up if seg is None else (up, seg)
        if kind == "model":
            if not _b.isinstance(v, _b.dict):
                self.report(at, "not_object")
                return None
            model: Model = f.target  # type: ignore[assignment]
            fields = model._fields
            if not fields.keys() >= v.keys():  # one C-level test; the loop below runs only when a key is unknown
                for k in v:
                    if k not in fields:
                        self.report((at, k), "unknown_field")
            walk = self.walk
            return {name: walk(sub, v.get(name), at, name) for name, sub in model._entries}
        if not _b.isinstance(v, _b.list):
            self.report(at, "not_list")
            return None
        items: _Field = f.items  # type: ignore[assignment]
        walk = self.walk
        return [walk(items, x, at, i) for i, x in _b.enumerate(v)]


def _at(up: _Any, seg: _Any) -> _Any:
    """The location link of the value at `seg` under `up`; the root (no segment) is None."""
    return up if seg is None else (up, seg)


def _fits_numeric(t: str, p: int, s: int) -> bool:
    """Rejects exactly what Postgres numeric(p, s) refuses, in one pass over the cleaned text `t`
    (`-?[0-9]+(\\.[0-9]+)?`): R = round(|value| * 10^s), half away from zero, must have at most p digits."""
    start = 1 if t[:1] == "-" else 0
    dot = t.find(".", start)
    int_len = (_b.len(t) if dot < 0 else dot) - start
    n = _b.len(t) - start - (0 if dot < 0 else 1)  # digits, the point left out
    skip = start + 1  # past the point

    def digit(i: int) -> int:
        return _b.ord(t[i + skip if dot >= 0 and i >= int_len else i + start]) - 48

    k = int_len + s  # digits of the value R keeps
    if k < 0:
        return True  # rounds to 0
    z = 0  # the first nonzero digit
    while z < n and digit(z) == 0:
        z += 1
    kept = _b.min(k, n)
    width = k - z if z < kept else 0  # digits of R before any carry (padding zeros count)
    carry = k < n and digit(k) >= 5
    nines = k <= n  # padding zeros aren't 9s
    i = z
    while nines and i < kept:
        if digit(i) != 9:
            nines = False
        i += 1
    return width + (1 if carry and nines else 0) <= p


class Models:
    """A loaded models file: `get("domain:model")` and `all`, every full name, sorted. Only `models()` builds one."""

    __slots__ = ("all", "_by_name")

    def __init__(self, key: _Obj, by_name: dict[str, Model]) -> None:
        _internal_only(key, "Models")
        self._by_name = by_name
        self.all: tuple[str, ...] = _b.tuple(_b.sorted(by_name))

    def __repr__(self) -> str:
        return f"<Models {_b.len(self.all)}>"

    def get(self, name: str) -> Model | None:
        """The model by its full `domain:model` name, exactly; nothing found gives None."""
        return self._by_name.get(name) if _b.isinstance(name, _b.str) else None


def models(data: _Obj) -> Models:
    """Loads a models file (parsed JSON, never a path). Returns its Models, or raises ModelsError listing every
    problem in the file, sorted."""
    global _catalogue
    if not _b.isinstance(data, _b.dict):
        raise ModelsError(_sorted([_problem([], "not_object", {})]))
    cat = _catalogue
    if cat is None:
        cat = _catalogue = _Catalogue()
    loaded = _Loader(data, cat)
    if loaded.problems:
        raise ModelsError(_sorted(loaded.problems))
    by_name: dict[str, Model] = {}
    for node in loaded.nodes.values():
        by_name[node.name] = Model(_INTERNAL, node.name, {f: d.field for f, d in node.fields.items()})  # type: ignore[misc]
    # Each model field points at its Model once, here, so validate never looks a model up by name.
    for field in loaded.fields:
        if field.kind == "model":
            field.target = by_name[field.model]
    return Models(_INTERNAL, by_name)


_PARAM_RULES: Final = {"length": {"kind": "integer", "minimum": 1, "maximum": 10485760, "minItems": None, "maxItemBytes": None}, "precision": {"kind": "integer", "minimum": 1, "maximum": 1000, "minItems": None, "maxItemBytes": None}, "scale": {"kind": "integer", "minimum": -1000, "maximum": 1000, "minItems": None, "maxItemBytes": None}, "fractional_seconds": {"kind": "integer", "minimum": 0, "maximum": 6, "minItems": None, "maxItemBytes": None}, "values": {"kind": "array", "minimum": None, "maximum": None, "minItems": 1, "maxItemBytes": 63}, "nullable": {"kind": "boolean", "minimum": None, "maximum": None, "minItems": None, "maxItemBytes": None}}
_ERRORS: Final = {"required": "Required.", "unknown_field": "Not a field of this model.", "not_object": "Must be an object.", "not_list": "Must be a list.", "too_long": "At most {max} characters.", "not_allowed": "Must be one of: {values}.", "too_many_digits": "Too many digits for precision {precision}, scale {scale}.", "bad_name": "Names are lowercase letters, digits and underscores, starting with a letter.", "type_name": "A model can't take a type's name.", "unresolved": "No type or model by this name.", "alias": "This is an alias; write \"{canonical}\".", "unknown_setting": "This type takes no such setting.", "bad_setting": "Out of range or the wrong kind of value.", "missing_setting": "Needs \"{setting}\".", "cycle": "This reference leads back to itself.", "too_deep": "Models nest more than {max} levels deep."}

any: Final[Scalar[_Any]] = Scalar(
    name="any",
    label="Anything",
    hint="Any value at all",
    error="Any value is allowed here.",
    details="Deliberately unconstrained: passthrough payloads and escape hatches. Reach for it last - every consumer inherits the validation burden.",
    level="core",
    primitive="any",
    aliases=("json", "jsonb"),
    examples={"valid": ({"anything": [1, "two", True]}, None, "text", 7), "invalid": ()},
    kind="any",
)
"""Anything

Any value at all

Deliberately unconstrained: passthrough payloads and escape hatches. Reach for it last - every consumer inherits the validation burden."""

array: Final[Scalar[list[_Any]]] = Scalar(
    name="array",
    label="List",
    hint="Several values in order",
    error="Please give a list of values.",
    details="An ordered JSON list: tags, attachments, embedded collections. Prefer a separate table or repeated field when elements need identity or independent querying.",
    level="core",
    primitive="array",
    aliases=("list",),
    examples={"valid": ([1, 2, 3], []), "invalid": ({"a": 1},)},
    kind="array",
)
"""List

Several values in order

An ordered JSON list: tags, attachments, embedded collections. Prefer a separate table or repeated field when elements need identity or independent querying."""

base64: Final[Scalar[str]] = Scalar(
    name="base64",
    label="Base64 data",
    hint="Bytes written as letters, + and /",
    error="Please use base64 with = padding, like SGVsbG8gd29ybGQ=.",
    details="Binary content as standard base64 text: payloads embedded in JSON. Prefer binary for raw transport and base64url when the value travels in URLs or filenames.",
    level="advanced",
    primitive="binary",
    aliases=("b64",),
    examples={"valid": ("SGVsbG8gd29ybGQ=", "", "YQ=="), "invalid": ("SGVsbG8gd29ybGQ", "SGVsbG8_d29ybGQ=")},
    kind="text",
    pattern="^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
)
"""Base64 data

Bytes written as letters, + and /

Binary content as standard base64 text: payloads embedded in JSON. Prefer binary for raw transport and base64url when the value travels in URLs or filenames."""

base64url: Final[Scalar[str]] = Scalar(
    name="base64url",
    label="URL-safe base64",
    hint="Bytes written as letters, - and _",
    error="Please use letters, digits, - and _, like SGVsbG8gd29ybGQ.",
    details="URL-safe base64 (no + or /): tokens and digests placed in URLs. Prefer base64 for ordinary embedded payloads.",
    level="advanced",
    primitive="binary",
    aliases=("b64url",),
    examples={"valid": ("SGVsbG8gd29ybGQ", "YQ", "-_-_"), "invalid": ("SGVsbG8+d29ybGQ", "SGVs/bG8")},
    kind="text",
    pattern="^[A-Za-z0-9_-]*={0,2}$",
)
"""URL-safe base64

Bytes written as letters, - and _

URL-safe base64 (no + or /): tokens and digests placed in URLs. Prefer base64 for ordinary embedded payloads."""

bic: Final[Scalar[str]] = Scalar(
    name="bic",
    label="Bank code (BIC)",
    hint="8 or 11 capital letters and digits",
    error="Please use 8 or 11 capital letters and digits, like DEUTDEFF500.",
    details="A BIC/SWIFT code identifying a bank for payment routing. Routing, not identity - prefer lei to identify the legal entity itself.",
    level="domain",
    primitive="string",
    aliases=("swift", "swift_code"),
    examples={"valid": ("DEUTDEFF500", "DEUTDEFF"), "invalid": ("DEUTDEFF5", "deutdeff")},
    kind="text",
    steps=("trim", "uppercase"),
    pattern="^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$",
    min_len=8,
    max_len=11,
)
"""Bank code (BIC)

8 or 11 capital letters and digits

A BIC/SWIFT code identifying a bank for payment routing. Routing, not identity - prefer lei to identify the legal entity itself."""

binary: Final[Scalar[str]] = Scalar(
    name="binary",
    label="File",
    hint="Upload a file",
    error="Please choose a file.",
    details="Raw bytes: file uploads, blobs, digests. Inside JSON they travel as standard base64 (RFC 4648); storage keeps the decoded bytes.",
    level="core",
    primitive="binary",
    aliases=("bytes", "file", "blob"),
    examples={"valid": ("SGVsbG8gd29ybGQ=", ""), "invalid": ()},
    kind="text",
)
"""File

Upload a file

Raw bytes: file uploads, blobs, digests. Inside JSON they travel as standard base64 (RFC 4648); storage keeps the decoded bytes."""

boolean: Final[Scalar[bool]] = Scalar(
    name="boolean",
    label="Yes or no",
    hint="Pick yes or no",
    error="Please pick yes or no.",
    details="A true/false fact: flags, toggles, switches. Prefer enum if a third state could ever appear, rather than a nullable boolean.",
    level="core",
    primitive="boolean",
    aliases=("bool", "yes_no"),
    examples={"valid": (True, False), "invalid": ("true", 1)},
    kind="boolean",
)
"""Yes or no

Pick yes or no

A true/false fact: flags, toggles, switches. Prefer enum if a third state could ever appear, rather than a nullable boolean."""

char: Final[Scalar[str]] = Scalar(
    name="char",
    label="Single character",
    hint="Exactly one character",
    error="Please type exactly one character, like A.",
    details="Exactly one character: a grade, flag, or single-letter code. Prefer string for anything that can grow, and enum when the values form a closed set.",
    level="advanced",
    primitive="string",
    aliases=("character", "letter"),
    examples={"valid": ("A", "é"), "invalid": ("", "AB")},
    kind="text",
    min_len=1,
    max_len=1,
)
"""Single character

Exactly one character

Exactly one character: a grade, flag, or single-letter code. Prefer string for anything that can grow, and enum when the values form a closed set."""

cidr: Final[Scalar[str]] = Scalar(
    name="cidr",
    label="Network range",
    hint="An address and a size, like 192.0.2.0/24",
    error="Please use an address, a slash and a size, like 192.0.2.0/24.",
    details="A network prefix of either IP family: allowlists, routing rules. Prefer ipv4 or ipv6 for a single host.",
    level="core",
    primitive="string",
    aliases=("subnet", "network"),
    examples={"valid": ("192.0.2.0/24", "2001:db8::/32", "10.0.0.0/8"), "invalid": ()},
    kind="text",
)
"""Network range

An address and a size, like 192.0.2.0/24

A network prefix of either IP family: allowlists, routing rules. Prefer ipv4 or ipv6 for a single host."""

color: Final[Scalar[str]] = Scalar(
    name="color",
    label="Color",
    hint="Pick a color",
    error="Please use # and 6 small hex digits, like #1a2b3c.",
    details="An sRGB color as lowercase #rrggbb or #rrggbbaa - the exact form <input type=\"color\"> produces, so it round-trips through forms, JSON, JS/TS and SQL unchanged. Prefer css_color only for wide-gamut or design-token values.",
    level="core",
    primitive="string",
    aliases=("colour", "rgb", "hex_color"),
    examples={"valid": ("#1a2b3c", "#1a2b3c80", "#000000"), "invalid": ("#ABC", "#1A2B3C", "red")},
    kind="text",
    steps=("trim", "lowercase"),
    pattern="^#[0-9a-f]{6}([0-9a-f]{2})?$",
    min_len=7,
    max_len=9,
)
"""Color

Pick a color

An sRGB color as lowercase #rrggbb or #rrggbbaa - the exact form <input type=\"color\"> produces, so it round-trips through forms, JSON, JS/TS and SQL unchanged. Prefer css_color only for wide-gamut or design-token values."""

commonmark: Final[Scalar[str]] = Scalar(
    name="commonmark",
    label="Markdown",
    hint="Text with # headings and **bold**",
    error="Please type some Markdown text.",
    details="Markdown (CommonMark) source: user-authored rich content stored as written. Prefer html for already-rendered markup and text for plain prose.",
    level="advanced",
    primitive="text",
    aliases=("markdown", "md"),
    examples={"valid": ("# Title\n\nSome **bold** text.", "- one\n- two"), "invalid": ()},
    kind="text",
)
"""Markdown

Text with # headings and **bold**

Markdown (CommonMark) source: user-authored rich content stored as written. Prefer html for already-rendered markup and text for plain prose."""

country: Final[Scalar[str]] = Scalar(
    name="country",
    label="Country",
    hint="Pick a country",
    error="Please use the 2-letter country code, like US.",
    details="An ISO 3166-1 alpha-2 country code (US): the interchange default for countries.",
    level="core",
    primitive="string",
    aliases=("country_code",),
    examples={"valid": ("US", "DE"), "invalid": ("us", "USA")},
    kind="text",
    steps=("trim", "uppercase"),
    pattern="^[A-Z]{2}$",
    min_len=2,
    max_len=2,
)
"""Country

Pick a country

An ISO 3166-1 alpha-2 country code (US): the interchange default for countries."""

country_alpha3: Final[Scalar[str]] = Scalar(
    name="country_alpha3",
    label="Country (3-letter)",
    hint="Three capital letters, like USA",
    error="Please use the 3-letter country code, like USA.",
    details="An ISO 3166-1 alpha-3 country code (USA): feeds and standards that require three letters. Prefer country (alpha-2) as the default.",
    level="advanced",
    primitive="string",
    aliases=("country_code3",),
    examples={"valid": ("USA", "DEU"), "invalid": ("usa", "US")},
    kind="text",
    steps=("trim", "uppercase"),
    pattern="^[A-Z]{3}$",
    min_len=3,
    max_len=3,
)
"""Country (3-letter)

Three capital letters, like USA

An ISO 3166-1 alpha-3 country code (USA): feeds and standards that require three letters. Prefer country (alpha-2) as the default."""

cron: Final[Scalar[str]] = Scalar(
    name="cron",
    label="Schedule",
    hint="Five fields, like 0 3 * * *",
    error="Please use five fields, like 0 3 * * * (3 AM daily).",
    details="A POSIX crontab expression (0 3 * * *): recurring schedules. Prefer duration for simple intervals and date_time for one-shot schedules.",
    level="advanced",
    primitive="string",
    aliases=("cron_expression", "crontab"),
    examples={"valid": ("0 3 * * *", "*/15 9-17 * * 1-5"), "invalid": ()},
    kind="text",
)
"""Schedule

Five fields, like 0 3 * * *

A POSIX crontab expression (0 3 * * *): recurring schedules. Prefer duration for simple intervals and date_time for one-shot schedules."""

css_color: Final[Scalar[str]] = Scalar(
    name="css_color",
    label="CSS color",
    hint="Any CSS color, like oklch(70% 0.15 250)",
    error="That doesn't look like a CSS color. Try oklch(70% 0.15 250).",
    details="Any single CSS Color 4 value: hex, named, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() or color(display-p3 ...). The pattern only checks the shape; validate for real with CSS.supports('color', value). Level 5 expressions (color-mix(), relative colors, light-dark(), var()) are computed in context and are deliberately not data.",
    level="advanced",
    primitive="string",
    aliases=("css_colour",),
    examples={"valid": ("oklch(70% 0.15 250)", "#fff", "rebeccapurple", "color(display-p3 1 0.5 0)", "rgb(10 20 30 / 50%)"), "invalid": ("color-mix(in srgb, red, blue)", "oklch(from var(--brand) l c h)", "#12")},
    kind="text",
    pattern="^(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|[a-zA-Z]+|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\([^()]*\\))$",
    min_len=1,
)
"""CSS color

Any CSS color, like oklch(70% 0.15 250)

Any single CSS Color 4 value: hex, named, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() or color(display-p3 ...). The pattern only checks the shape; validate for real with CSS.supports('color', value). Level 5 expressions (color-mix(), relative colors, light-dark(), var()) are computed in context and are deliberately not data."""

currency: Final[Scalar[str]] = Scalar(
    name="currency",
    label="Currency",
    hint="Pick a currency, like USD or EUR",
    error="Please use the 3-letter currency code, like USD.",
    details="An ISO 4217 currency code (USD): pair it with a decimal amount to represent money. Never derive it from country or locale - people transact across borders.",
    level="core",
    primitive="string",
    aliases=("currency_code",),
    examples={"valid": ("USD", "EUR"), "invalid": ("usd", "US")},
    kind="text",
    steps=("trim", "uppercase"),
    pattern="^[A-Z]{3}$",
    min_len=3,
    max_len=3,
)
"""Currency

Pick a currency, like USD or EUR

An ISO 4217 currency code (USD): pair it with a decimal amount to represent money. Never derive it from country or locale - people transact across borders."""

date: Final[Scalar[str]] = Scalar(
    name="date",
    label="Date",
    hint="Year-month-day, like 2026-08-16",
    error="Please use year-month-day, like 2026-08-16.",
    details="A calendar date with no time or zone: birthdays, due dates, effective dates. Prefer date_time for an actual instant.",
    level="core",
    primitive="date",
    aliases=("day",),
    examples={"valid": ("2026-08-16", "2024-02-29"), "invalid": ("2026-8-16", "16/08/2026")},
    kind="text",
    pattern="^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    min_len=10,
    max_len=10,
)
"""Date

Year-month-day, like 2026-08-16

A calendar date with no time or zone: birthdays, due dates, effective dates. Prefer date_time for an actual instant."""

date_time: Final[Scalar[str]] = Scalar(
    name="date_time",
    label="Date and time",
    hint="An exact moment, with its time zone",
    error="Please use date, T, time and zone, like 2026-08-16T14:30:00Z.",
    details="An absolute instant with offset - the default for created/updated timestamps and anything that really happened. Prefer date_time_local only for deliberately floating times.",
    level="core",
    primitive="date_time",
    aliases=("datetime", "timestamp", "instant"),
    examples={"valid": ("2026-08-16T14:30:00Z", "2026-08-16T14:30:00.123+02:00"), "invalid": ("2026-08-16T14:30:00", "2026-08-16 14:30:00Z")},
    kind="text",
    params=("fractional_seconds",),
    pattern="^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$",
    min_len=20,
)
"""Date and time

An exact moment, with its time zone

An absolute instant with offset - the default for created/updated timestamps and anything that really happened. Prefer date_time_local only for deliberately floating times."""

date_time_local: Final[Scalar[str]] = Scalar(
    name="date_time_local",
    label="Local date and time",
    hint="A date and time on the clock, no zone",
    error="Please use date, T and time, like 2026-08-16T14:30:00.",
    details="A date and time with no offset: floating events like 'Jan 1 at midnight, wherever the user is'. Prefer date_time for real instants; pair with timezone to reconstruct one.",
    level="core",
    primitive="date_time_local",
    aliases=("local_datetime", "wall_time"),
    examples={"valid": ("2026-08-16T14:30:00", "2026-08-16T09:00:00.5"), "invalid": ("2026-08-16T14:30:00Z", "2026-08-16")},
    kind="text",
    params=("fractional_seconds",),
    pattern="^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?$",
    min_len=19,
)
"""Local date and time

A date and time on the clock, no zone

A date and time with no offset: floating events like 'Jan 1 at midnight, wherever the user is'. Prefer date_time for real instants; pair with timezone to reconstruct one."""

decimal: Final[Scalar[str]] = Scalar(
    name="decimal",
    label="Exact number",
    hint="Exact amounts like money: 1234.56",
    error="Please use digits and one dot, like 1234.56.",
    details="Exact decimal value represented as text. Use for money, rates, quantities, and other values where decimal precision must be preserved. Precision and scale are determined by the target system.",
    level="core",
    primitive="decimal",
    aliases=("money", "numeric"),
    examples={"valid": ("1234.56", "-0.01", "42"), "invalid": ("1,234.56", "1e5")},
    kind="text",
    params=("precision", "scale"),
    pattern="^-?[0-9]+(\\.[0-9]+)?$",
    min_len=1,
)
"""Exact number

Exact amounts like money: 1234.56

Exact decimal value represented as text. Use for money, rates, quantities, and other values where decimal precision must be preserved. Precision and scale are determined by the target system."""

decimal128: Final[Scalar[str]] = Scalar(
    name="decimal128",
    label="Very exact number",
    hint="Up to 34 significant digits",
    error="Please use digits and one dot, like 1234.567890123456789012345678901234.",
    details="IEEE 754 decimal128: exact decimals with a defined 34-significant-digit width, for interchange with fixed-width financial systems. Prefer decimal when arbitrary precision is acceptable.",
    level="advanced",
    primitive="decimal",
    aliases=("dec128",),
    examples={"valid": ("1234.567890123456789012345678901234", "-1"), "invalid": ("1e10", "abc")},
    kind="text",
    params=("precision", "scale"),
    pattern="^-?[0-9]+(\\.[0-9]+)?$",
    min_len=1,
)
"""Very exact number

Up to 34 significant digits

IEEE 754 decimal128: exact decimals with a defined 34-significant-digit width, for interchange with fixed-width financial systems. Prefer decimal when arbitrary precision is acceptable."""

doi: Final[Scalar[str]] = Scalar(
    name="doi",
    label="DOI",
    hint="A paper ID, like 10.1000/182",
    error="Please start with 10., like 10.1000/182.",
    details="A Digital Object Identifier: citations to papers, datasets, publications. Prefer uri only for links that are not registered DOIs.",
    level="domain",
    primitive="string",
    aliases=("doi_name",),
    examples={"valid": ("10.1000/182", "10.1038/nphys1170"), "invalid": ("10.1/182", "doi:10.1000/182")},
    kind="text",
    pattern="^10\\.[0-9]{4,9}/[-._;()/:A-Za-z0-9]+$",
    min_len=9,
)
"""DOI

A paper ID, like 10.1000/182

A Digital Object Identifier: citations to papers, datasets, publications. Prefer uri only for links that are not registered DOIs."""

double_int: Final[Scalar[int]] = Scalar(
    name="double_int",
    label="Safe whole number",
    hint="Whole number JavaScript keeps exact",
    error="Please use a whole number between ±9007199254740991.",
    details="Integers exactly representable in an IEEE double (up to 2^53-1): safe as a plain number for every JSON consumer, including JavaScript. Prefer int64 when the full 64-bit range matters and consumers accept strings.",
    level="advanced",
    primitive="int32",
    aliases=("safe_integer",),
    examples={"valid": (9007199254740991, -9007199254740991), "invalid": (9007199254740992, 1.5)},
    kind="integer",
    minimum=-9007199254740991,
    maximum=9007199254740991,
)
"""Safe whole number

Whole number JavaScript keeps exact

Integers exactly representable in an IEEE double (up to 2^53-1): safe as a plain number for every JSON consumer, including JavaScript. Prefer int64 when the full 64-bit range matters and consumers accept strings."""

duration: Final[Scalar[str]] = Scalar(
    name="duration",
    label="Length of time",
    hint="How long something lasts, like P3DT4H30M",
    error="Please write it like P3DT4H30M (3 days, 4 hours, 30 minutes).",
    details="A span of time (ISO 8601): timeouts, retention windows, billing periods. A length, not a position - prefer date_time for points in time.",
    level="core",
    primitive="duration",
    aliases=("interval", "timespan"),
    examples={"valid": ("P3DT4H30M", "PT0.5S", "P1Y2M"), "invalid": ("P", "3 days")},
    kind="text",
    params=("fractional_seconds",),
    pattern="^P(([0-9]+Y([0-9]+M)?([0-9]+W)?([0-9]+D)?|[0-9]+M([0-9]+W)?([0-9]+D)?|[0-9]+W([0-9]+D)?|[0-9]+D)(T([0-9]+H([0-9]+M)?([0-9]+(\\.[0-9]+)?S)?|[0-9]+M([0-9]+(\\.[0-9]+)?S)?|[0-9]+(\\.[0-9]+)?S))?|T([0-9]+H([0-9]+M)?([0-9]+(\\.[0-9]+)?S)?|[0-9]+M([0-9]+(\\.[0-9]+)?S)?|[0-9]+(\\.[0-9]+)?S))$",
    min_len=3,
)
"""Length of time

How long something lasts, like P3DT4H30M

A span of time (ISO 8601): timeouts, retention windows, billing periods. A length, not a position - prefer date_time for points in time."""

email: Final[Scalar[str]] = Scalar(
    name="email",
    label="Email address",
    hint="Like name@example.com",
    error="That email looks wrong. Try user@example.com.",
    details="An email address: login and contact fields. Accepting internationalized mailboxes is a validation choice, not a separate type.",
    level="core",
    primitive="string",
    aliases=("email_address", "mail"),
    examples={"valid": ("user@example.com", "first.last+tag@sub.example.co.uk"), "invalid": ("user@", "user example.com")},
    kind="text",
    steps=("trim",),
    pattern="^[^@\\x09-\\x0D\\x20]+@[^@\\x09-\\x0D\\x20][^.@\\x09-\\x0D\\x20]*\\.[^@\\x09-\\x0D\\x20]+$",
    min_len=5,
)
"""Email address

Like name@example.com

An email address: login and contact fields. Accepting internationalized mailboxes is a validation choice, not a separate type."""

enum: Final[Scalar[str]] = Scalar(
    name="enum",
    label="Choice",
    hint="Pick one option from a fixed list",
    error="Please pick one of the options.",
    details="One value from a closed, named set: statuses, roles, kinds. Prefer string for open-ended sets and boolean for exactly two states.",
    level="core",
    primitive="string",
    aliases=("choice", "select"),
    examples={"valid": ("active", "draft", "archived"), "invalid": ()},
    kind="text",
    params=("values",),
)
"""Choice

Pick one option from a fixed list

One value from a closed, named set: statuses, roles, kinds. Prefer string for open-ended sets and boolean for exactly two states."""

float32: Final[Scalar[float]] = Scalar(
    name="float32",
    label="Small-precision number",
    hint="Any number, stored with ~7 digits",
    error="Please type a number, like 3.14.",
    details="Single-precision floats: bulk sensor readings or ML weights where memory beats precision. Prefer float64 as the default floating-point type.",
    level="advanced",
    primitive="float64",
    aliases=("real", "single"),
    examples={"valid": (3.14, -1.5), "invalid": ("3.14",)},
    kind="number",
)
"""Small-precision number

Any number, stored with ~7 digits

Single-precision floats: bulk sensor readings or ML weights where memory beats precision. Prefer float64 as the default floating-point type."""

float64: Final[Scalar[float]] = Scalar(
    name="float64",
    label="Number",
    hint="Any number, like 3.14",
    error="Please type a number, like 3.14.",
    details="The default floating-point number: measurements, ratios, scores. Never money or exact quantities - use decimal for anything where digits must be exact.",
    level="core",
    primitive="float64",
    aliases=("number", "float", "double"),
    examples={"valid": (3.141592653589793, -0.5, 1e+21), "invalid": ("3.14",)},
    kind="number",
)
"""Number

Any number, like 3.14

The default floating-point number: measurements, ratios, scores. Never money or exact quantities - use decimal for anything where digits must be exact."""

gln: Final[Scalar[str]] = Scalar(
    name="gln",
    label="Location number (GLN)",
    hint="13 digits",
    error="Please check the number: 13 digits, like 0614141000012.",
    details="A GS1 GLN identifying a party or place: a company, a warehouse, a store, a dock door. Use gtin for the products themselves and lei for legal entities in finance.",
    level="domain",
    primitive="string",
    aliases=("location_number", "global_location_number"),
    examples={"valid": ("0614141000012", "4000001000005"), "invalid": ("061414100001", "06141410000123")},
    kind="text",
    steps=("remove_spaces", "remove_hyphens"),
    pattern="^[0-9]{13}$",
    check="gs1_mod10",
    min_len=13,
    max_len=13,
)
"""Location number (GLN)

13 digits

A GS1 GLN identifying a party or place: a company, a warehouse, a store, a dock door. Use gtin for the products themselves and lei for legal entities in finance."""

gtin: Final[Scalar[str]] = Scalar(
    name="gtin",
    label="Barcode number",
    hint="8, 12, 13 or 14 digits",
    error="Please check the number: 8, 12, 13 or 14 digits, like 0614141000036.",
    details="A GS1 GTIN (UPC/EAN family) identifying a retail product. Prefer isbn when the domain is specifically books.",
    level="domain",
    primitive="string",
    aliases=("barcode", "ean", "upc"),
    examples={"valid": ("0614141000036", "96385074"), "invalid": ("123456789", "0614141000036A")},
    kind="text",
    steps=("remove_spaces", "remove_hyphens"),
    pattern="^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$",
    check="gs1_mod10",
    min_len=8,
    max_len=14,
)
"""Barcode number

8, 12, 13 or 14 digits

A GS1 GTIN (UPC/EAN family) identifying a retail product. Prefer isbn when the domain is specifically books."""

hostname: Final[Scalar[str]] = Scalar(
    name="hostname",
    label="Website name",
    hint="Like api.example.com",
    error="Please use letters, digits, dots and dashes, like api.example.com.",
    details="A DNS hostname: servers and endpoints without scheme or path. Prefer uri when a full locator travels; internationalized names are a validation choice.",
    level="core",
    primitive="string",
    aliases=("domain", "domain_name", "host"),
    examples={"valid": ("api.example.com", "localhost", "a-b.example"), "invalid": ("-api.example.com", "api..example.com", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")},
    kind="text",
    steps=("trim", "lowercase"),
    pattern="^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$",
    min_len=1,
    max_len=253,
)
"""Website name

Like api.example.com

A DNS hostname: servers and endpoints without scheme or path. Prefer uri when a full locator travels; internationalized names are a validation choice."""

html: Final[Scalar[str]] = Scalar(
    name="html",
    label="HTML",
    hint="Web page markup, like <p>Hello</p>",
    error="Please type some HTML.",
    details="HTML markup stored as-is: rendered output, email bodies. Sanitize on the way in; prefer commonmark when users author the content.",
    level="advanced",
    primitive="text",
    aliases=("markup",),
    examples={"valid": ("<p>Hello</p>", "<ul><li>one</li></ul>"), "invalid": ()},
    kind="text",
)
"""HTML

Web page markup, like <p>Hello</p>

HTML markup stored as-is: rendered output, email bodies. Sanitize on the way in; prefer commonmark when users author the content."""

http_date: Final[Scalar[str]] = Scalar(
    name="http_date",
    label="HTTP date",
    hint="Like Sun, 16 Aug 2026 14:30:00 GMT",
    error="Please use the HTTP date form, like Sun, 16 Aug 2026 14:30:00 GMT.",
    details="The HTTP header date format (IMF-fixdate): Last-Modified, Expires, and friends. HTTP interchange only - prefer date_time everywhere else.",
    level="domain",
    primitive="date_time",
    aliases=("imf_fixdate",),
    examples={"valid": ("Sun, 16 Aug 2026 14:30:00 GMT", "Mon, 01 Jan 2024 00:00:00 GMT"), "invalid": ("2026-08-16T14:30:00Z", "Sun, 16 Aug 2026 14:30:00 UTC")},
    kind="text",
    params=("fractional_seconds",),
    pattern="^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$",
    min_len=29,
    max_len=29,
)
"""HTTP date

Like Sun, 16 Aug 2026 14:30:00 GMT

The HTTP header date format (IMF-fixdate): Last-Modified, Expires, and friends. HTTP interchange only - prefer date_time everywhere else."""

iban: Final[Scalar[str]] = Scalar(
    name="iban",
    label="Bank account (IBAN)",
    hint="Country code, 2 digits, then account",
    error="Please check the account: capitals and digits, no spaces, like DE89370400440532013000.",
    details="An International Bank Account Number: identifying accounts for payments. Pair with bic for cross-border routing and treat as sensitive data.",
    level="domain",
    primitive="string",
    aliases=("bank_account",),
    examples={"valid": ("DE89370400440532013000", "GB82WEST12345698765432"), "invalid": ("de89370400440532013000", "DE89 3704 0044 0532 0130 00")},
    kind="text",
    steps=("trim", "remove_spaces", "uppercase"),
    pattern="^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$",
    check="iban",
    min_len=15,
    max_len=34,
)
"""Bank account (IBAN)

Country code, 2 digits, then account

An International Bank Account Number: identifying accounts for payments. Pair with bic for cross-border routing and treat as sensitive data."""

idn_email: Final[Scalar[str]] = Scalar(
    name="idn_email",
    label="International email",
    hint="Email that may use any alphabet",
    error="That email looks wrong. Try ñoño@ejemplo.es.",
    details="An internationalized email address: non-ASCII local parts and domains. Prefer email when every consumer requires ASCII.",
    level="advanced",
    primitive="string",
    aliases=("unicode_email",),
    examples={"valid": ("用户@例子.广告", "ñoño@ejemplo.es"), "invalid": ()},
    kind="text",
)
"""International email

Email that may use any alphabet

An internationalized email address: non-ASCII local parts and domains. Prefer email when every consumer requires ASCII."""

idn_hostname: Final[Scalar[str]] = Scalar(
    name="idn_hostname",
    label="International website name",
    hint="A domain in any alphabet",
    error="That domain looks wrong. Try bücher.example.",
    details="An internationalized (IDNA2008) hostname. Prefer hostname when values are guaranteed ASCII or already punycode-encoded.",
    level="advanced",
    primitive="string",
    aliases=("unicode_domain",),
    examples={"valid": ("例子.广告", "bücher.example"), "invalid": ()},
    kind="text",
)
"""International website name

A domain in any alphabet

An internationalized (IDNA2008) hostname. Prefer hostname when values are guaranteed ASCII or already punycode-encoded."""

int16: Final[Scalar[int]] = Scalar(
    name="int16",
    label="Small whole number",
    hint="From -32768 to 32767",
    error="Please use a whole number from -32768 to 32767.",
    details="Signed 16-bit integers: compact numeric codes and small bounded quantities. Prefer int32 as the general-purpose default.",
    level="advanced",
    primitive="int32",
    aliases=("smallint", "short"),
    examples={"valid": (1024, -32768), "invalid": (32768, -32769)},
    kind="integer",
    minimum=-32768,
    maximum=32767,
)
"""Small whole number

From -32768 to 32767

Signed 16-bit integers: compact numeric codes and small bounded quantities. Prefer int32 as the general-purpose default."""

int32: Final[Scalar[int]] = Scalar(
    name="int32",
    label="Whole number",
    hint="A number with no decimal point, like 42",
    error="Please use a whole number, like 42.",
    details="The general-purpose signed integer: counts, quantities, offsets. Prefer int64 for identifiers or anything that can outgrow two billion.",
    level="core",
    primitive="int32",
    aliases=("int", "integer"),
    examples={"valid": (42, -2147483648, 0), "invalid": (2147483648, 1.5)},
    kind="integer",
    minimum=-2147483648,
    maximum=2147483647,
)
"""Whole number

A number with no decimal point, like 42

The general-purpose signed integer: counts, quantities, offsets. Prefer int64 for identifiers or anything that can outgrow two billion."""

int64: Final[Scalar[str]] = Scalar(
    name="int64",
    label="Big whole number",
    hint="A very big number with no decimal point",
    error="Please use a whole number that fits in 64 bits, digits only, like 9007199254740993.",
    details="Signed 64-bit integers: database keys, byte sizes, high-resolution counters. Values beyond 2^53 lose precision as JSON numbers, so they travel as strings; storage is still a native 64-bit integer.",
    level="core",
    primitive="int64",
    aliases=("bigint", "long"),
    examples={"valid": ("9007199254740993", "-42", "0", "9223372036854775807", "-9223372036854775808"), "invalid": ("12.5", 123)},
    kind="text",
    pattern="^-?[0-9]+$",
    check="int64_range",
    min_len=1,
)
"""Big whole number

A very big number with no decimal point

Signed 64-bit integers: database keys, byte sizes, high-resolution counters. Values beyond 2^53 lose precision as JSON numbers, so they travel as strings; storage is still a native 64-bit integer."""

int8: Final[Scalar[int]] = Scalar(
    name="int8",
    label="Tiny whole number",
    hint="From -128 to 127",
    error="Please use a whole number from -128 to 127.",
    details="Tiny signed integers (-128..127) where the bound is part of the contract. Prefer int32 as the general-purpose default.",
    level="advanced",
    primitive="int32",
    aliases=("tinyint", "byte"),
    examples={"valid": (-7, -128, 127), "invalid": (128, -129)},
    kind="integer",
    minimum=-128,
    maximum=127,
)
"""Tiny whole number

From -128 to 127

Tiny signed integers (-128..127) where the bound is part of the contract. Prefer int32 as the general-purpose default."""

ipv4: Final[Scalar[str]] = Scalar(
    name="ipv4",
    label="IP address (v4)",
    hint="Four numbers with dots, like 192.0.2.1",
    error="Please use four numbers from 0 to 255, like 192.0.2.1.",
    details="A dotted-quad IPv4 host address. Prefer cidr for networks rather than hosts.",
    level="core",
    primitive="string",
    aliases=("ip", "ip_address"),
    examples={"valid": ("192.0.2.1", "0.0.0.0", "255.255.255.255"), "invalid": ("256.0.0.1", "192.0.2")},
    kind="text",
    pattern="^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$",
    min_len=7,
    max_len=15,
)
"""IP address (v4)

Four numbers with dots, like 192.0.2.1

A dotted-quad IPv4 host address. Prefer cidr for networks rather than hosts."""

ipv4_cidr: Final[Scalar[str]] = Scalar(
    name="ipv4_cidr",
    label="IPv4 network range",
    hint="Like 192.0.2.0/24",
    error="Please use an IPv4 address, a slash and 0-32, like 192.0.2.0/24.",
    details="An IPv4 network prefix like 192.0.2.0/24. Prefer cidr when either family may appear, and ipv4 for a single host.",
    level="advanced",
    primitive="string",
    aliases=("ipv4_subnet",),
    examples={"valid": ("192.0.2.0/24", "0.0.0.0/0"), "invalid": ("192.0.2.0/33", "192.0.2.0")},
    kind="text",
    pattern="^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])/(3[0-2]|[12]?[0-9])$",
    min_len=9,
    max_len=18,
)
"""IPv4 network range

Like 192.0.2.0/24

An IPv4 network prefix like 192.0.2.0/24. Prefer cidr when either family may appear, and ipv4 for a single host."""

ipv6: Final[Scalar[str]] = Scalar(
    name="ipv6",
    label="IP address (v6)",
    hint="Like 2001:db8::1",
    error="That IP address looks wrong. Try 2001:db8::1.",
    details="An IPv6 host address. Prefer cidr for prefixes rather than hosts.",
    level="core",
    primitive="string",
    aliases=("ipv6_address",),
    examples={"valid": ("2001:db8::1", "::1", "fe80::1ff:fe23:4567:890a"), "invalid": ()},
    kind="text",
)
"""IP address (v6)

Like 2001:db8::1

An IPv6 host address. Prefer cidr for prefixes rather than hosts."""

ipv6_cidr: Final[Scalar[str]] = Scalar(
    name="ipv6_cidr",
    label="IPv6 network range",
    hint="Like 2001:db8::/32",
    error="Please use an IPv6 address, a slash and 0-128, like 2001:db8::/32.",
    details="An IPv6 network prefix like 2001:db8::/32. Prefer cidr when either family may appear, and ipv6 for a single host.",
    level="advanced",
    primitive="string",
    aliases=("ipv6_subnet",),
    examples={"valid": ("2001:db8::/32", "::/0"), "invalid": ()},
    kind="text",
)
"""IPv6 network range

Like 2001:db8::/32

An IPv6 network prefix like 2001:db8::/32. Prefer cidr when either family may appear, and ipv6 for a single host."""

iri: Final[Scalar[str]] = Scalar(
    name="iri",
    label="International link",
    hint="A link that may use any alphabet",
    error="That link looks wrong. Try https://bücher.example/straße.",
    details="An internationalized absolute URI: user-facing links in any script, unencoded. Prefer uri when consumers require ASCII with percent-encoding.",
    level="advanced",
    primitive="string",
    aliases=("unicode_url",),
    examples={"valid": ("https://例子.广告/路径", "https://bücher.example/straße"), "invalid": ()},
    kind="text",
)
"""International link

A link that may use any alphabet

An internationalized absolute URI: user-facing links in any script, unencoded. Prefer uri when consumers require ASCII with percent-encoding."""

iri_reference: Final[Scalar[str]] = Scalar(
    name="iri_reference",
    label="International link or path",
    hint="A link or path in any alphabet",
    error="That link or path looks wrong. Try ../straße.",
    details="An internationalized URI reference, absolute or relative. Prefer iri for absolute-only values and uri_reference for ASCII-only ones.",
    level="advanced",
    primitive="string",
    aliases=("unicode_href",),
    examples={"valid": ("/路径?c=1", "../straße"), "invalid": ()},
    kind="text",
)
"""International link or path

A link or path in any alphabet

An internationalized URI reference, absolute or relative. Prefer iri for absolute-only values and uri_reference for ASCII-only ones."""

isbn: Final[Scalar[str]] = Scalar(
    name="isbn",
    label="Book number (ISBN)",
    hint="10 or 13 digits",
    error="Please check the number: 10 or 13 digits, no dashes, like 9780306406157.",
    details="An ISBN identifying a book edition. Prefer gtin for general retail products; every ISBN-13 is a GTIN, but not the reverse.",
    level="domain",
    primitive="string",
    aliases=("isbn13", "isbn10"),
    examples={"valid": ("9780306406157", "080442957X", "0306406152"), "invalid": ("978030640615", "0306406152XX")},
    kind="text",
    steps=("remove_spaces", "remove_hyphens", "uppercase"),
    pattern="^([0-9]{9}[0-9Xx]|97[89][0-9]{10})$",
    check="isbn",
    min_len=10,
    max_len=13,
)
"""Book number (ISBN)

10 or 13 digits

An ISBN identifying a book edition. Prefer gtin for general retail products; every ISBN-13 is a GTIN, but not the reverse."""

json_pointer: Final[Scalar[str]] = Scalar(
    name="json_pointer",
    label="JSON Pointer",
    hint="A path inside a document, like /users/0",
    error="Start with / for each step, like /users/0/email.",
    details="An absolute JSON Pointer (/users/0/email): addressing a location inside a document from its root.",
    level="advanced",
    primitive="string",
    aliases=("pointer",),
    examples={"valid": ("/users/0/email", "", "/a~1b/~0c"), "invalid": ("users/0", "/a~2b")},
    kind="text",
    pattern="^(/([^~/]|~[01])*)*$",
)
"""JSON Pointer

A path inside a document, like /users/0

An absolute JSON Pointer (/users/0/email): addressing a location inside a document from its root."""

jwt: Final[Scalar[str]] = Scalar(
    name="jwt",
    label="Login token",
    hint="Three parts joined by dots",
    error="Please paste the whole token, like eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig.",
    details="A compact JSON Web Token: signed claims passed between parties. Handle like secret in storage and logs; prefer secret for opaque credentials.",
    level="advanced",
    primitive="string",
    aliases=("json_web_token", "bearer_token"),
    examples={"valid": ("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0."), "invalid": ("eyJhbGciOiJIUzI1NiJ9", "not a token")},
    kind="text",
    pattern="^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]*$",
    min_len=4,
)
"""Login token

Three parts joined by dots

A compact JSON Web Token: signed claims passed between parties. Handle like secret in storage and logs; prefer secret for opaque credentials."""

language: Final[Scalar[str]] = Scalar(
    name="language",
    label="Language",
    hint="Two or three small letters, like en",
    error="Please use the language code, like en.",
    details="An ISO 639 language code (en): tagging what language content is in. Prefer locale when region or script variants matter.",
    level="advanced",
    primitive="string",
    aliases=("language_code",),
    examples={"valid": ("en", "haw"), "invalid": ("EN", "english")},
    kind="text",
    pattern="^[a-z]{2,3}$",
    min_len=2,
    max_len=3,
)
"""Language

Two or three small letters, like en

An ISO 639 language code (en): tagging what language content is in. Prefer locale when region or script variants matter."""

lei: Final[Scalar[str]] = Scalar(
    name="lei",
    label="Legal Entity ID",
    hint="20 capital letters and digits",
    error="Please check the ID: 20 capital letters and digits, like 5493001KJTIIGC8Y1R12.",
    details="A Legal Entity Identifier: organizations in financial and regulatory contexts. Identity, not routing - prefer bic for payment routing.",
    level="domain",
    primitive="string",
    aliases=("legal_entity_identifier",),
    examples={"valid": ("5493001KJTIIGC8Y1R12", "529900T8BM49AURSDO55"), "invalid": ("5493001KJTIIGC8Y1R1", "5493001kjtiigc8y1r12")},
    kind="text",
    pattern="^[A-Z0-9]{18}[0-9]{2}$",
    check="iso7064_mod97_10",
    min_len=20,
    max_len=20,
)
"""Legal Entity ID

20 capital letters and digits

A Legal Entity Identifier: organizations in financial and regulatory contexts. Identity, not routing - prefer bic for payment routing."""

locale: Final[Scalar[str]] = Scalar(
    name="locale",
    label="Language and region",
    hint="Like en-US or es-419",
    error="Please use a language code, like en-US.",
    details="A BCP 47 language tag (en, en-US): a language with optional script and region, for formatting, translations, and user preferences.",
    level="core",
    primitive="string",
    aliases=("language_tag", "lang"),
    examples={"valid": ("en-US", "en", "zh-Hant-TW", "es-419"), "invalid": ("english", "en_US")},
    kind="text",
    pattern="^[a-zA-Z]{2,3}(-[a-zA-Z]{4})?(-([a-zA-Z]{2}|[0-9]{3}))?$",
    min_len=2,
    max_len=12,
)
"""Language and region

Like en-US or es-419

A BCP 47 language tag (en, en-US): a language with optional script and region, for formatting, translations, and user preferences."""

mac_address: Final[Scalar[str]] = Scalar(
    name="mac_address",
    label="Hardware address",
    hint="Six pairs of hex digits",
    error="Please use six hex pairs with : or -, like 00:1b:44:11:3a:b7.",
    details="An EUI-48 hardware address: device inventory, DHCP leases. Never an identity for people or accounts - MACs are spoofable and privacy-sensitive.",
    level="advanced",
    primitive="string",
    aliases=("mac", "mac_addr"),
    examples={"valid": ("00:1b:44:11:3a:b7", "00-1B-44-11-3A-B7"), "invalid": ("00:1b:44:11:3a", "00:1b:44:11:3a:zz")},
    kind="text",
    pattern="^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$",
    min_len=17,
    max_len=17,
)
"""Hardware address

Six pairs of hex digits

An EUI-48 hardware address: device inventory, DHCP leases. Never an identity for people or accounts - MACs are spoofable and privacy-sensitive."""

media_range: Final[Scalar[str]] = Scalar(
    name="media_range",
    label="Accepted file types",
    hint="Like text/html or image/*",
    error="Please use kind/subkind or a *, like text/html;q=0.9.",
    details="An HTTP media range with wildcards and parameters: Accept-style negotiation. Prefer media_type for one concrete type.",
    level="domain",
    primitive="string",
    aliases=("accept",),
    examples={"valid": ("text/html;q=0.9", "*/*", "image/*"), "invalid": ("*/html", "text")},
    kind="text",
    pattern="^(\\*/\\*|[A-Za-z0-9!#$&^_.+-]+/\\*|[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+)([\\x09\\x20]*;[^\\x00-\\x1F\\x7F]*)?$",
    min_len=3,
)
"""Accepted file types

Like text/html or image/*

An HTTP media range with wildcards and parameters: Accept-style negotiation. Prefer media_type for one concrete type."""

media_type: Final[Scalar[str]] = Scalar(
    name="media_type",
    label="File type",
    hint="What kind of file, like application/json",
    error="Please write kind/subkind, like application/json.",
    details="A concrete media type like application/json: labeling stored content.",
    level="core",
    primitive="string",
    aliases=("mime_type", "content_type"),
    examples={"valid": ("application/json", "text/html; charset=utf-8", "image/svg+xml"), "invalid": ("json", "application/")},
    kind="text",
    pattern="^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(;[^\\x00-\\x1F\\x7F]*)?$",
    min_len=3,
)
"""File type

What kind of file, like application/json

A concrete media type like application/json: labeling stored content."""

object: Final[Scalar[dict[str, _Any]]] = Scalar(
    name="object",
    label="Group of fields",
    hint="Named values kept together",
    error="Please give named values, like a small card of facts.",
    details="A nested JSON object: structured payloads, settings blobs, documents. Prefer dedicated fields or columns once the shape is stable enough to query.",
    level="core",
    primitive="object",
    aliases=("map", "dict", "record"),
    examples={"valid": ({"key": "value"}, {}), "invalid": ([1, 2],)},
    kind="object",
)
"""Group of fields

Named values kept together

A nested JSON object: structured payloads, settings blobs, documents. Prefer dedicated fields or columns once the shape is stable enough to query."""

orcid: Final[Scalar[str]] = Scalar(
    name="orcid",
    label="ORCID iD",
    hint="Four groups of four digits",
    error="Please check the iD: four groups of 4 with dashes, like 0000-0002-1825-0097.",
    details="An ORCID iD identifying a researcher. Prefer lei for organizations and wikidata_qid for entities outside scholarly identity.",
    level="domain",
    primitive="string",
    aliases=("orcid_id",),
    examples={"valid": ("0000-0002-1825-0097", "0000-0002-9079-593X"), "invalid": ("0000-0002-1825-009", "0000000218250097")},
    kind="text",
    pattern="^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$",
    check="iso7064_mod11_2",
    min_len=19,
    max_len=19,
)
"""ORCID iD

Four groups of four digits

An ORCID iD identifying a researcher. Prefer lei for organizations and wikidata_qid for entities outside scholarly identity."""

phone: Final[Scalar[str]] = Scalar(
    name="phone",
    label="Phone number",
    hint="Start with + and your country code",
    error="Start with + and the country code, no spaces, like +14155552671.",
    details="An E.164 phone number (+country code, digits only): dialing and SMS. Store normalized; display formatting is presentation, not data.",
    level="core",
    primitive="string",
    aliases=("tel", "telephone", "mobile", "phone_number"),
    examples={"valid": ("+14155552671", "+442071838750"), "invalid": ("4155552671", "+1 415 555 2671")},
    kind="text",
    steps=("trim", "remove_spaces", "remove_hyphens"),
    pattern="^\\+[1-9][0-9]{1,14}$",
    min_len=3,
    max_len=16,
)
"""Phone number

Start with + and your country code

An E.164 phone number (+country code, digits only): dialing and SMS. Store normalized; display formatting is presentation, not data."""

port: Final[Scalar[int]] = Scalar(
    name="port",
    label="Port number",
    hint="From 0 to 65535, like 5432",
    error="Please use a whole number from 0 to 65535.",
    details="A TCP/UDP port number (0..65535): service endpoints and configuration. Prefer uint16 for 16-bit values that are not ports.",
    level="advanced",
    primitive="int32",
    aliases=("port_number",),
    examples={"valid": (5432, 0, 65535), "invalid": (65536, -1)},
    kind="integer",
    minimum=0,
    maximum=65535,
)
"""Port number

From 0 to 65535, like 5432

A TCP/UDP port number (0..65535): service endpoints and configuration. Prefer uint16 for 16-bit values that are not ports."""

regex: Final[Scalar[str]] = Scalar(
    name="regex",
    label="Text pattern",
    hint="A regular expression, like ^[a-z]+$",
    error="That regular expression looks wrong. Try ^[a-z]+$.",
    details="An ECMA-262 regular expression source: validation rules and matchers stored as data. Prefer enum when the acceptable values are simply a closed set.",
    level="advanced",
    primitive="string",
    aliases=("regexp", "regular_expression"),
    examples={"valid": ("^[a-z][a-z0-9_]*$", "\\d+"), "invalid": ()},
    kind="text",
)
"""Text pattern

A regular expression, like ^[a-z]+$

An ECMA-262 regular expression source: validation rules and matchers stored as data. Prefer enum when the acceptable values are simply a closed set."""

relative_json_pointer: Final[Scalar[str]] = Scalar(
    name="relative_json_pointer",
    label="Relative JSON Pointer",
    hint="Steps up, then a path, like 1/name",
    error="Please start with a number, like 1/name.",
    details="A JSON Pointer relative to a known position (1/name). Prefer json_pointer when addressing from the document root.",
    level="advanced",
    primitive="string",
    aliases=("relative_pointer",),
    examples={"valid": ("1/name", "0", "2#"), "invalid": ("/name", "01/name")},
    kind="text",
    pattern="^(0|[1-9][0-9]*)(#|(/([^~/]|~[01])*)*)$",
    min_len=1,
)
"""Relative JSON Pointer

Steps up, then a path, like 1/name

A JSON Pointer relative to a known position (1/name). Prefer json_pointer when addressing from the document root."""

secret: Final[Scalar[str]] = Scalar(
    name="secret",
    label="Secret",
    hint="Kept hidden, like a password",
    error="Please type the secret.",
    details="Sensitive text that must never be displayed or logged: passwords, API keys. The format is a masking hint, not protection - hash or encrypt at rest.",
    level="core",
    primitive="string",
    aliases=("password", "api_key"),
    examples={"valid": ("••••••••", "correct horse battery staple"), "invalid": ()},
    kind="text",
)
"""Secret

Kept hidden, like a password

Sensitive text that must never be displayed or logged: passwords, API keys. The format is a masking hint, not protection - hash or encrypt at rest."""

semver: Final[Scalar[str]] = Scalar(
    name="semver",
    label="Version number",
    hint="Major.minor.patch, like 1.4.2",
    error="Please use three numbers with dots, like 1.4.2-rc.1.",
    details="A Semantic Version (1.4.2-rc.1): package and API versions with defined precedence. Prefer string for version-ish labels that do not follow SemVer.",
    level="advanced",
    primitive="string",
    aliases=("version", "semantic_version"),
    examples={"valid": ("1.4.2-rc.1", "0.0.1", "2.0.0+build.5"), "invalid": ("1.4", "01.4.2")},
    kind="text",
    pattern="^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$",
    min_len=5,
)
"""Version number

Major.minor.patch, like 1.4.2

A Semantic Version (1.4.2-rc.1): package and API versions with defined precedence. Prefer string for version-ish labels that do not follow SemVer."""

sf_binary: Final[Scalar[str]] = Scalar(
    name="sf_binary",
    label="Header bytes",
    hint="Base64 between colons",
    error="Please wrap base64 in colons, like :aGVsbG8=:.",
    details="An HTTP Structured Fields byte sequence (colon-delimited base64): binary members of structured headers. Prefer base64 outside header serialization.",
    level="domain",
    primitive="binary",
    aliases=("structured_binary",),
    examples={"valid": (":aGVsbG8=:", "::"), "invalid": ("aGVsbG8=", "::x")},
    kind="text",
    pattern="^:[A-Za-z0-9+/]*={0,2}:$",
    min_len=2,
)
"""Header bytes

Base64 between colons

An HTTP Structured Fields byte sequence (colon-delimited base64): binary members of structured headers. Prefer base64 outside header serialization."""

sf_boolean: Final[Scalar[bool]] = Scalar(
    name="sf_boolean",
    label="Header yes/no",
    hint="True or false",
    error="Please pick true or false.",
    details="An HTTP Structured Fields boolean (?1 / ?0): flags in structured headers. Prefer boolean outside header serialization.",
    level="domain",
    primitive="boolean",
    aliases=("structured_boolean",),
    examples={"valid": (True, False), "invalid": ("?1",)},
    kind="boolean",
)
"""Header yes/no

True or false

An HTTP Structured Fields boolean (?1 / ?0): flags in structured headers. Prefer boolean outside header serialization."""

sf_decimal: Final[Scalar[float]] = Scalar(
    name="sf_decimal",
    label="Header decimal",
    hint="Up to 3 digits after the dot",
    error="Please use a number with at most 3 decimals, like 4.5.",
    details="An HTTP Structured Fields decimal (three fractional digits): weights and q-values in headers. Prefer decimal outside header serialization.",
    level="domain",
    primitive="float64",
    aliases=("structured_decimal",),
    examples={"valid": (4.5, -999999999999.999), "invalid": ("4.5",)},
    kind="number",
    params=("precision", "scale"),
)
"""Header decimal

Up to 3 digits after the dot

An HTTP Structured Fields decimal (three fractional digits): weights and q-values in headers. Prefer decimal outside header serialization."""

sf_integer: Final[Scalar[int]] = Scalar(
    name="sf_integer",
    label="Header number",
    hint="Up to 15 digits",
    error="Please use a whole number with up to 15 digits.",
    details="An HTTP Structured Fields integer (15 digits max): numeric members of structured headers. Prefer int64 outside header serialization.",
    level="domain",
    primitive="int32",
    aliases=("structured_integer",),
    examples={"valid": (42, -999999999999999), "invalid": (1000000000000000, 1.5)},
    kind="integer",
    minimum=-999999999999999,
    maximum=999999999999999,
)
"""Header number

Up to 15 digits

An HTTP Structured Fields integer (15 digits max): numeric members of structured headers. Prefer int64 outside header serialization."""

sf_string: Final[Scalar[str]] = Scalar(
    name="sf_string",
    label="Header text",
    hint="Plain ASCII characters only",
    error="Please use plain ASCII characters, like hello world.",
    details="An HTTP Structured Fields quoted string (printable ASCII): textual members of structured headers. Prefer string outside header serialization.",
    level="domain",
    primitive="string",
    aliases=("structured_string",),
    examples={"valid": ("hello world", ""), "invalid": ("tab\there", "café")},
    kind="text",
    pattern="^[\\x20-\\x7E]*$",
)
"""Header text

Plain ASCII characters only

An HTTP Structured Fields quoted string (printable ASCII): textual members of structured headers. Prefer string outside header serialization."""

sf_token: Final[Scalar[str]] = Scalar(
    name="sf_token",
    label="Header token",
    hint="A short word like gzip",
    error="Please start with a letter, no spaces, like gzip.",
    details="An HTTP Structured Fields token like gzip: short symbolic header values. Prefer enum for closed sets outside HTTP.",
    level="domain",
    primitive="string",
    aliases=("structured_token",),
    examples={"valid": ("gzip", "*", "text/html"), "invalid": ("1gzip", "gz ip")},
    kind="text",
    pattern="^[A-Za-z*][A-Za-z0-9:/!#$%&'*+\\-.^_`|~]*$",
    min_len=1,
)
"""Header token

A short word like gzip

An HTTP Structured Fields token like gzip: short symbolic header values. Prefer enum for closed sets outside HTTP."""

sha256: Final[Scalar[str]] = Scalar(
    name="sha256",
    label="SHA-256 hash",
    hint="64 hex characters",
    error="Needs 64 hex characters, like e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.",
    details="A SHA-256 digest: content addressing, integrity checks, dedup keys. Never for passwords - those take a dedicated password hash stored as secret.",
    level="advanced",
    primitive="string",
    aliases=("hash", "digest"),
    examples={"valid": ("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"), "invalid": ("e3b0", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")},
    kind="text",
    pattern="^[A-Fa-f0-9]{64}$",
    min_len=64,
    max_len=64,
)
"""SHA-256 hash

64 hex characters

A SHA-256 digest: content addressing, integrity checks, dedup keys. Never for passwords - those take a dedicated password hash stored as secret."""

slug: Final[Scalar[str]] = Scalar(
    name="slug",
    label="Web address name",
    hint="Small letters, digits and dashes",
    error="Use small letters, digits and single dashes, like getting-started.",
    details="A lowercase-hyphen URL token (getting-started): readable path segments derived from a title. Presentation identity only - prefer uuid as the real key.",
    level="core",
    primitive="string",
    aliases=("permalink", "url_name"),
    examples={"valid": ("getting-started", "a", "v2-release-notes"), "invalid": ("Getting-Started", "getting--started")},
    kind="text",
    steps=("trim", "lowercase"),
    pattern="^[a-z0-9]+(-[a-z0-9]+)*$",
    min_len=1,
)
"""Web address name

Small letters, digits and dashes

A lowercase-hyphen URL token (getting-started): readable path segments derived from a title. Presentation identity only - prefer uuid as the real key."""

string: Final[Scalar[str]] = Scalar(
    name="string",
    label="Short text",
    hint="A few words, like a name or a title",
    error="Please type some text.",
    details="Single-line text where a length bound is meaningful: names, titles, labels. Prefer text when there is no maximum, and enum when the values form a closed set.",
    level="core",
    primitive="string",
    aliases=("short_text", "varchar"),
    examples={"valid": ("hello", "Ada Lovelace"), "invalid": (42, None)},
    kind="text",
    params=("length",),
)
"""Short text

A few words, like a name or a title

Single-line text where a length bound is meaningful: names, titles, labels. Prefer text when there is no maximum, and enum when the values form a closed set."""

subdivision: Final[Scalar[str]] = Scalar(
    name="subdivision",
    label="State or region",
    hint="Country, dash, region, like US-CA",
    error="Please use country-region, like US-CA.",
    details="An ISO 3166-2 subdivision code (US-CA): states, provinces, regions. Carries its country prefix, so no separate country field is needed to interpret it.",
    level="advanced",
    primitive="string",
    aliases=("region", "state", "province"),
    examples={"valid": ("US-CA", "GB-ENG", "FR-75C"), "invalid": ("US_CA", "US-")},
    kind="text",
    steps=("trim", "uppercase"),
    pattern="^[A-Z]{2}-[A-Z0-9]{1,3}$",
    min_len=4,
    max_len=6,
)
"""State or region

Country, dash, region, like US-CA

An ISO 3166-2 subdivision code (US-CA): states, provinces, regions. Carries its country prefix, so no separate country field is needed to interpret it."""

text: Final[Scalar[str]] = Scalar(
    name="text",
    label="Long text",
    hint="As many lines as you need",
    error="Please type some text.",
    details="Unbounded prose: article bodies, comments, logs. Prefer string when a length limit is part of the contract.",
    level="core",
    primitive="text",
    aliases=("long_text", "paragraph"),
    examples={"valid": ("unbounded multi-line body", "Line one\nLine two"), "invalid": (["not", "text"],)},
    kind="text",
)
"""Long text

As many lines as you need

Unbounded prose: article bodies, comments, logs. Prefer string when a length limit is part of the contract."""

time: Final[Scalar[str]] = Scalar(
    name="time",
    label="Time with offset",
    hint="Like 14:30:00Z or 14:30:00+02:00",
    error="Please add the zone offset, like 14:30:00Z.",
    details="A wall-clock time with an explicit UTC offset. Prefer time_local for schedules that float with the local zone.",
    level="advanced",
    primitive="time_local",
    aliases=("timetz", "offset_time"),
    examples={"valid": ("14:30:00Z", "09:05:30.250+05:30"), "invalid": ("14:30:00", "2:30 PM")},
    kind="text",
    params=("fractional_seconds",),
    pattern="^[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$",
    min_len=9,
)
"""Time with offset

Like 14:30:00Z or 14:30:00+02:00

A wall-clock time with an explicit UTC offset. Prefer time_local for schedules that float with the local zone."""

time_local: Final[Scalar[str]] = Scalar(
    name="time_local",
    label="Time of day",
    hint="Hours:minutes:seconds, like 14:30:00",
    error="Please use hours:minutes:seconds, like 14:30:00.",
    details="A wall-clock time with no offset: daily schedules like 'every day at 14:30' that follow whatever zone applies. Pair with timezone when the zone is fixed.",
    level="core",
    primitive="time_local",
    aliases=("time_of_day", "local_time"),
    examples={"valid": ("14:30:00", "09:05:30.250"), "invalid": ("14:30", "14:30:00Z")},
    kind="text",
    params=("fractional_seconds",),
    pattern="^[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]+)?$",
    min_len=8,
)
"""Time of day

Hours:minutes:seconds, like 14:30:00

A wall-clock time with no offset: daily schedules like 'every day at 14:30' that follow whatever zone applies. Pair with timezone when the zone is fixed."""

timezone: Final[Scalar[str]] = Scalar(
    name="timezone",
    label="Time zone",
    hint="A region and city, like America/New_York",
    error="Please pick a time zone, like America/New_York.",
    details="An IANA zone name like America/New_York: user preferences and scheduling context. Store the name, never a raw offset - offsets change with DST and law.",
    level="core",
    primitive="string",
    aliases=("tz", "time_zone"),
    examples={"valid": ("America/New_York", "UTC", "America/Argentina/Buenos_Aires"), "invalid": ("New York", "America/New York")},
    kind="text",
    pattern="^(UTC|[A-Za-z_]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?)$",
    min_len=3,
)
"""Time zone

A region and city, like America/New_York

An IANA zone name like America/New_York: user preferences and scheduling context. Store the name, never a raw offset - offsets change with DST and law."""

uint16: Final[Scalar[int]] = Scalar(
    name="uint16",
    label="Small count",
    hint="From 0 to 65535",
    error="Please use a whole number from 0 to 65535.",
    details="Unsigned 16-bit integers (0..65535). Prefer port for network ports specifically, and int32 when a negative value could ever appear.",
    level="advanced",
    primitive="int32",
    aliases=("ushort",),
    examples={"valid": (8080, 65535), "invalid": (65536, -1)},
    kind="integer",
    minimum=0,
    maximum=65535,
)
"""Small count

From 0 to 65535

Unsigned 16-bit integers (0..65535). Prefer port for network ports specifically, and int32 when a negative value could ever appear."""

uint32: Final[Scalar[int]] = Scalar(
    name="uint32",
    label="Count",
    hint="From 0 to 4294967295",
    error="Please use a whole number from 0 to 4294967295.",
    details="Unsigned 32-bit integers: large counters and IDs from systems that use them. Prefer int64 in new designs; signed types survive arithmetic and language boundaries better.",
    level="advanced",
    primitive="int32",
    aliases=("uint", "unsigned"),
    examples={"valid": (3000000000, 4294967295), "invalid": (4294967296, -1)},
    kind="integer",
    minimum=0,
    maximum=4294967295,
)
"""Count

From 0 to 4294967295

Unsigned 32-bit integers: large counters and IDs from systems that use them. Prefer int64 in new designs; signed types survive arithmetic and language boundaries better."""

uint64: Final[Scalar[str]] = Scalar(
    name="uint64",
    label="Huge count",
    hint="Digits only, no minus sign",
    error="Please use only digits, up to 18446744073709551615.",
    details="The full unsigned 64-bit range: hashes and foreign systems' identifiers. Most languages and JSON cannot represent the upper half natively, so values travel as strings; prefer int64 unless the source really uses all 64 bits.",
    level="advanced",
    primitive="int64",
    aliases=("ulong",),
    examples={"valid": ("18446744073709551615", "0"), "invalid": ("-1", "1.5")},
    kind="text",
    params=("precision", "scale"),
    pattern="^[0-9]+$",
    check="uint64_range",
    min_len=1,
)
"""Huge count

Digits only, no minus sign

The full unsigned 64-bit range: hashes and foreign systems' identifiers. Most languages and JSON cannot represent the upper half natively, so values travel as strings; prefer int64 unless the source really uses all 64 bits."""

uint8: Final[Scalar[int]] = Scalar(
    name="uint8",
    label="Tiny count",
    hint="From 0 to 255",
    error="Please use a whole number from 0 to 255.",
    details="Unsigned bytes (0..255): color channels, small numeric codes. Prefer int32 unless the byte range is intrinsic to the data.",
    level="advanced",
    primitive="int32",
    aliases=("ubyte",),
    examples={"valid": (200, 0, 255), "invalid": (256, -1)},
    kind="integer",
    minimum=0,
    maximum=255,
)
"""Tiny count

From 0 to 255

Unsigned bytes (0..255): color channels, small numeric codes. Prefer int32 unless the byte range is intrinsic to the data."""

ulid: Final[Scalar[str]] = Scalar(
    name="ulid",
    label="Sortable ID",
    hint="26 letters and digits",
    error="Please use 26 letters and digits, like 01ARZ3NDEKTSV4RRFFQ69G5FAV.",
    details="A lexically sortable 128-bit ID in Crockford Base32: time-ordered keys that stay readable as text. Prefer uuid_v7 where native UUID column types and tooling matter.",
    level="advanced",
    primitive="string",
    aliases=("sortable_id",),
    examples={"valid": ("01ARZ3NDEKTSV4RRFFQ69G5FAV", "7ZZZZZZZZZZZZZZZZZZZZZZZZZ"), "invalid": ("01ARZ3NDEKTSV4RRFFQ69G5FA", "81ARZ3NDEKTSV4RRFFQ69G5FAV", "01ARZ3NDEKTSV4RRFFQ69G5FAI")},
    kind="text",
    pattern="^[0-7][0-9A-HJKMNP-TV-Z]{25}$",
    min_len=26,
    max_len=26,
)
"""Sortable ID

26 letters and digits

A lexically sortable 128-bit ID in Crockford Base32: time-ordered keys that stay readable as text. Prefer uuid_v7 where native UUID column types and tooling matter."""

unix_time: Final[Scalar[int]] = Scalar(
    name="unix_time",
    label="Unix timestamp",
    hint="Seconds since 1970-01-01",
    error="Please use whole seconds since 1970, like 1786000000.",
    details="Seconds since the Unix epoch as an integer: compact machine timestamps and TTLs. Prefer date_time for anything humans or APIs read directly.",
    level="advanced",
    primitive="int32",
    aliases=("epoch", "epoch_seconds"),
    examples={"valid": (1786000000, 0, -86400), "invalid": (9007199254740992, 1.5)},
    kind="integer",
    minimum=-9007199254740991,
    maximum=9007199254740991,
)
"""Unix timestamp

Seconds since 1970-01-01

Seconds since the Unix epoch as an integer: compact machine timestamps and TTLs. Prefer date_time for anything humans or APIs read directly."""

uri: Final[Scalar[str]] = Scalar(
    name="uri",
    label="Web link",
    hint="Like https://example.com/page",
    error="That link looks wrong. Try https://example.com/page.",
    details="An absolute URI with scheme: links, webhooks, resource locators. Use string for relative paths.",
    level="core",
    primitive="string",
    aliases=("url", "link", "website"),
    examples={"valid": ("https://example.com/a/b?c=1", "mailto:user@example.com", "urn:isbn:9780306406157"), "invalid": ()},
    kind="text",
)
"""Web link

Like https://example.com/page

An absolute URI with scheme: links, webhooks, resource locators. Use string for relative paths."""

uri_reference: Final[Scalar[str]] = Scalar(
    name="uri_reference",
    label="Link or path",
    hint="A full link or a path like /a/b",
    error="That link or path looks wrong. Try /a/b?c=1.",
    details="A URI reference, absolute or relative: redirect targets, in-site paths. Prefer uri when an absolute, scheme-carrying value is required.",
    level="advanced",
    primitive="string",
    aliases=("relative_url", "href"),
    examples={"valid": ("/a/b?c=1", "../up", "#fragment"), "invalid": ()},
    kind="text",
)
"""Link or path

A full link or a path like /a/b

A URI reference, absolute or relative: redirect targets, in-site paths. Prefer uri when an absolute, scheme-carrying value is required."""

uri_template: Final[Scalar[str]] = Scalar(
    name="uri_template",
    label="Link template",
    hint="A link with {placeholders}",
    error="That template looks wrong. Try /users/{id}.",
    details="An RFC 6570 URL pattern with {variables}: route and link templates. Prefer uri for concrete, already-expanded links.",
    level="advanced",
    primitive="string",
    aliases=("url_template",),
    examples={"valid": ("/users/{id}{?fields}", "https://api.example.com{/version}/items"), "invalid": ()},
    kind="text",
)
"""Link template

A link with {placeholders}

An RFC 6570 URL pattern with {variables}: route and link templates. Prefer uri for concrete, already-expanded links."""

uuid: Final[Scalar[str]] = Scalar(
    name="uuid",
    label="Unique ID",
    hint="A long ID with dashes, made by the computer",
    error="That ID looks wrong. It should look like f81d4fae-7dec-11d0-a765-00a0c91e6bf6.",
    details="A 128-bit universal identifier, any version: primary keys and references. Which version to mint (such as time-ordered v7) is a generation option, not a separate type.",
    level="core",
    primitive="string",
    aliases=("guid", "unique_id"),
    examples={"valid": ("f81d4fae-7dec-11d0-a765-00a0c91e6bf6", "F81D4FAE-7DEC-11D0-A765-00A0C91E6BF6"), "invalid": ("f81d4fae7dec11d0a76500a0c91e6bf6", "f81d4fae-7dec-11d0-a765-00a0c91e6bfg")},
    kind="text",
    steps=("trim", "lowercase"),
    pattern="^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
    min_len=36,
    max_len=36,
)
"""Unique ID

A long ID with dashes, made by the computer

A 128-bit universal identifier, any version: primary keys and references. Which version to mint (such as time-ordered v7) is a generation option, not a separate type."""

uuid_v7: Final[Scalar[str]] = Scalar(
    name="uuid_v7",
    label="Time-ordered ID",
    hint="A unique ID that sorts by time",
    error="It needs a 7 after the second dash, like 018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e6f.",
    details="A time-ordered UUID: new primary keys that index and sort by creation time. Prefer uuid when accepting identifiers you did not mint.",
    level="advanced",
    primitive="string",
    aliases=("uuidv7",),
    examples={"valid": ("018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e6f", "018F4B2C-9C1E-7A3B-BF2D-1A2B3C4D5E6F"), "invalid": ("f81d4fae-7dec-11d0-a765-00a0c91e6bf6", "018f4b2c-9c1e-7a3b-cf2d-1a2b3c4d5e6f")},
    kind="text",
    steps=("trim", "lowercase"),
    pattern="^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    min_len=36,
    max_len=36,
)
"""Time-ordered ID

A unique ID that sorts by time

A time-ordered UUID: new primary keys that index and sort by creation time. Prefer uuid when accepting identifiers you did not mint."""

wikidata_qid: Final[Scalar[str]] = Scalar(
    name="wikidata_qid",
    label="Wikidata ID",
    hint="Q and a number, like Q42",
    error="Please use Q and a number, like Q42.",
    details="A Wikidata entity ID (Q42): linking records to globally known entities. Prefer the domain registry when one exists - doi, orcid, lei, isbn.",
    level="domain",
    primitive="string",
    aliases=("qid",),
    examples={"valid": ("Q42", "Q1"), "invalid": ("Q0", "42")},
    kind="text",
    pattern="^Q[1-9][0-9]*$",
    min_len=2,
)
"""Wikidata ID

Q and a number, like Q42

A Wikidata entity ID (Q42): linking records to globally known entities. Prefer the domain registry when one exists - doi, orcid, lei, isbn."""

Name = Literal["any", "array", "base64", "base64url", "bic", "binary", "boolean", "char", "cidr", "color", "commonmark", "country", "country_alpha3", "cron", "css_color", "currency", "date", "date_time", "date_time_local", "decimal", "decimal128", "doi", "double_int", "duration", "email", "enum", "float32", "float64", "gln", "gtin", "hostname", "html", "http_date", "iban", "idn_email", "idn_hostname", "int16", "int32", "int64", "int8", "ipv4", "ipv4_cidr", "ipv6", "ipv6_cidr", "iri", "iri_reference", "isbn", "json_pointer", "jwt", "language", "lei", "locale", "mac_address", "media_range", "media_type", "object", "orcid", "phone", "port", "regex", "relative_json_pointer", "secret", "semver", "sf_binary", "sf_boolean", "sf_decimal", "sf_integer", "sf_string", "sf_token", "sha256", "slug", "string", "subdivision", "text", "time", "time_local", "timezone", "uint16", "uint32", "uint64", "uint8", "ulid", "unix_time", "uri", "uri_reference", "uri_template", "uuid", "uuid_v7", "wikidata_qid"]

all: Final[tuple[Scalar[_Any], ...]] = (any, array, base64, base64url, bic, binary, boolean, char, cidr, color, commonmark, country, country_alpha3, cron, css_color, currency, date, date_time, date_time_local, decimal, decimal128, doi, double_int, duration, email, enum, float32, float64, gln, gtin, hostname, html, http_date, iban, idn_email, idn_hostname, int16, int32, int64, int8, ipv4, ipv4_cidr, ipv6, ipv6_cidr, iri, iri_reference, isbn, json_pointer, jwt, language, lei, locale, mac_address, media_range, media_type, object, orcid, phone, port, regex, relative_json_pointer, secret, semver, sf_binary, sf_boolean, sf_decimal, sf_integer, sf_string, sf_token, sha256, slug, string, subdivision, text, time, time_local, timezone, uint16, uint32, uint64, uint8, ulid, unix_time, uri, uri_reference, uri_template, uuid, uuid_v7, wikidata_qid,)
