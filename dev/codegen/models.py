# Models: a file of domains, models and fields (parsed JSON), loaded once, then payloads checked against a model.
# A port of dev/lib/models.mjs, the reference every engine copies. Load is O(file) and iterative: no recursion is
# driven by the input. Validate recurses, but load bounds a payload's depth at _MAX_DEPTH levels.

from typing import NamedTuple as _NamedTuple

# _MAX_DEPTH, _DIGIT_SETTINGS, _NAME_PATTERN and _REF_PATTERN are emitted after this file, from dev/lib/models.mjs.
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
    10 differ, which the pointer text can't tell. A code without a template (a reason like `pattern`) needs `message`."""
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
        self.name = _re.compile(_NAME_PATTERN)
        self.ref = _re.compile(_REF_PATTERN)
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
                    r = typ._check(entry) if _b.isinstance(entry, _b.str) else _FAIL.WRONG_KIND  # type: ignore[union-attr]
                    fits = not _b.isinstance(r, _Failure) and (most is None or _b.len(entry.encode("utf-8")) <= most)
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
            # The reason is the code; a type-level too_long reads like the field's, with the type's limit as max.
            if _b.isinstance(r, _Failure):
                params: dict[str, _Any] = {"type": t.name}
                if r.reason == Reason.TOO_LONG:
                    params["max"] = t._max_len
                self.report(_at(up, seg), r.reason, params, t.error)
                return None
            if f.limited:
                length = f.length
                if length is not None and _b.len(r) > length:  # a str's len counts code points
                    self.report(_at(up, seg), Reason.TOO_LONG, {"type": t.name, "max": length})
                if f.allowed is not None and r not in f.allowed:
                    self.report(_at(up, seg), "not_allowed", {"type": t.name, "values": _b.list(f.values)})  # type: ignore[arg-type]
                if f.precision is not None and not _fits_numeric(r, f.precision, f.scale):
                    self.report(_at(up, seg), "too_many_digits", {"type": t.name, "precision": f.precision, "scale": f.scale})
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
