"""Imports the generated dist/python/scalars.py and checks every example plus cases.json.

Run: python -I -X utf8 check.py <dist/scalars.json> <cases.json>
"""
import json
import os
import sys
import time

dist_path, cases_path = sys.argv[1:3]
sys.dont_write_bytecode = True  # dist/ must stay free of __pycache__
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(dist_path)), "python"))
try:
    import scalars
except ImportError as e:
    print(f"python: cannot import the generated scalars.py: {e}")
    sys.exit(1)

with open(dist_path, encoding="utf-8") as f:
    types = json.load(f)["types"]
with open(cases_path, encoding="utf-8") as f:
    cases = json.load(f)

fails = []


def get(name):
    t = scalars.get(name)
    if t is None:
        fails.append(f"get({name!r}) found nothing")
    return t


def value(c):
    return {"NaN": float("nan"), "Infinity": float("inf")}[c["special"]] if "special" in c else c["in"]


# Nothing may be compiled at import.
for t in scalars.all:
    if t._re is not None:
        fails.append(f"{t.name} compiled its regex at import")

if scalars._index is not None:
    fails.append("the lookup index was built at import")
if scalars._catalogue is not None:
    fails.append("the models catalogue was built at import")

if len(scalars.all) != len(types):
    fails.append(f"all has {len(scalars.all)} types, dist has {len(types)}")

for name, spec in types.items():
    t = get(name)
    if t is None:
        continue
    if getattr(scalars, name, None) is not t:
        fails.append(f"scalars.{name} is not the type get({name!r}) returns")
    if (t.name, t.label, t.hint, t.error, t.details, t.level, t.primitive) != (
        name, spec["label"], spec["hint"], spec["error"], spec["details"], spec["level"], spec["primitive"],
    ) or t.aliases != tuple(spec.get("aliases", [])) or t.params != tuple(spec.get("params", [])) or t.check != spec.get("check"):
        fails.append(f"{name} metadata differs from dist")
    for v in spec["examples"]["valid"]:
        if not t.is_valid(v):
            fails.append(f"{name} rejects valid {v!r}")
    for v in spec["examples"].get("invalid", []):
        # Invalid examples break the raw pattern; normalizing may repair one ("usa" -> "USA"), so only those may pass.
        if t.is_valid(v) and not (isinstance(v, str) and t.normalize(v) != v):
            fails.append(f"{name} accepts invalid {v!r}")
    for v in spec["examples"].get("check_invalid", []):
        if t.is_valid(v):
            fails.append(f"{name} accepts check_invalid {v!r}")
    for alias in spec.get("aliases", []):
        if scalars.get(alias) is not t:
            fails.append(f"get({alias!r}) is not {name}")

for c in cases["normalize"]:
    # normalize is a method of the type, so borrow any text type's steps by building a probe.
    probe = scalars.Scalar(name="probe", label="", hint="", error="", details="", level="", primitive="string",
                           aliases=(), examples={}, kind="text", steps=tuple(c["steps"]))
    got = probe.normalize(c["in"])
    if got != c["out"]:
        fails.append(f"normalize {c['in']!r} {c['steps']} = {got!r}, want {c['out']!r}")

for c in cases["lookup"]:
    t = scalars.get(c["in"])
    got = t.name if t is not None else None
    if got != c["out"]:
        fails.append(f"lookup {c['in']!r} = {got}, want {c['out']}")

for c in cases["match"]:
    t = get(c["type"])
    if t is not None and t.is_valid(c["in"]) != c["ok"]:
        fails.append(f"{c['type']} on {c['in']!r}: want {c['ok']}")

for c in cases["validate"]:
    t = get(c["type"])
    if t is None:
        continue
    v = value(c)
    try:
        out = t.validate(v)
    except scalars.ScalarError as e:
        if c["ok"]:
            fails.append(f"{c['type']} rejects {v!r}")
        elif str(e) != types[c["type"]]["error"] or e.scalar is not t:
            fails.append(f"{c['type']} error {str(e)!r} is not the type's error")
        if t.is_valid(v):
            fails.append(f"{c['type']}: validate raised but is_valid said yes for {v!r}")
        continue
    if not c["ok"]:
        fails.append(f"{c['type']} accepts {v!r}")
    elif "out" in c and (out != c["out"] or type(out) is not type(c["out"])):
        fails.append(f"{c['type']} on {v!r} = {out!r}, want {c['out']!r}")
    elif not t.is_valid(v):
        fails.append(f"{c['type']}: validate passed but is_valid said no for {v!r}")

if scalars.any.validate([1]) != [1]:
    fails.append("any.validate([1]) did not return [1]")
if type(scalars.float64.validate(3)) is not float:
    fails.append("float64.validate(3) did not return a float")
if scalars.object.validate({}) != {}:
    fails.append("object.validate({}) did not return {}")
# The check runs before remove_spaces, as in every engine (in JS removing the space would join the pair).
joiner = scalars.Scalar(name="probe", label="", hint="", error="", details="", level="", primitive="string",
                        aliases=(), examples={}, kind="text", steps=("trim", "remove_spaces"))
if joiner.is_valid("\ud83d \ude00"):
    fails.append("remove_spaces joined a lone surrogate pair into valid text")

slowest = (0.0, "")
for c in cases["hostile"]:
    t = get(c["type"])
    if t is None:
        continue
    text = c["prefix"] + c["repeat"] * c["count"] + c["suffix"]
    start = time.perf_counter()
    ok = t.is_valid(text)
    ms = (time.perf_counter() - start) * 1000
    slowest = max(slowest, (ms, c["type"]))
    if ok != c["ok"]:
        fails.append(f"hostile {c['type']}: want {c['ok']}")
    if ms >= 2000:
        fails.append(f"hostile {c['type']} took {ms:.0f} ms")


def shape(problems):
    """Problems as JSON text: json.dumps tells 3 from 3.0 and True from 1, which == does not."""
    return json.dumps([p._asdict() for p in problems], sort_keys=True)


def want(problems):
    return json.dumps(problems, sort_keys=True)


load_cases = {c["name"]: c for c in cases["models"]["load"]}
for c in cases["models"]["load"]:
    try:
        loaded = scalars.models(c["data"])
    except scalars.ModelsError as e:
        if c["ok"]:
            fails.append(f"models.load {c['name']}: refused: {e}")
        elif shape(e.problems) != want(c["problems"]):
            fails.append(f"models.load {c['name']}: problems {shape(e.problems)}, want {want(c['problems'])}")
        elif not isinstance(e, ValueError) or not isinstance(e.problems, tuple):
            fails.append(f"models.load {c['name']}: ModelsError is not a ValueError with a tuple of problems")
        elif str(e) != "; ".join(f"{p.pointer}: {p.message}" for p in e.problems):
            fails.append(f"models.load {c['name']}: str(ModelsError) is {str(e)!r}")
        continue
    if not c["ok"]:
        fails.append(f"models.load {c['name']}: loaded, want problems {want(c['problems'])}")
    elif loaded.all != tuple(c["all"]):
        fails.append(f"models.load {c['name']}: all {loaded.all}, want {c['all']}")


def model_of(c):
    try:
        m = scalars.models(load_cases[c["load"]]["data"]).get(c["model"])
    except scalars.ModelsError as e:
        fails.append(f"{c['name']}: load case {c['load']!r} must load: {e}")
        return None
    if m is None:
        fails.append(f"{c['name']}: no model {c['model']!r}")
    elif m.name != c["model"]:
        fails.append(f"{c['name']}: model name {m.name!r}")
    return m


for c in cases["models"]["validate"]:
    m = model_of(c)
    if m is None:
        continue
    try:
        out = m.validate(c["in"])
    except scalars.ModelError as e:
        if c["ok"]:
            fails.append(f"models.validate {c['name']}: refused: {e}")
        elif shape(e.problems) != want(c["problems"]):
            fails.append(f"models.validate {c['name']}: problems {shape(e.problems)}, want {want(c['problems'])}")
        elif not isinstance(e, ValueError) or str(e) != "; ".join(f"{p.pointer}: {p.message}" for p in e.problems):
            fails.append(f"models.validate {c['name']}: ModelError is not a ValueError joining its problems")
    else:
        if not c["ok"]:
            fails.append(f"models.validate {c['name']}: passed, want problems {want(c['problems'])}")
        elif json.dumps(out, sort_keys=True) != json.dumps(c["out"], sort_keys=True):
            fails.append(f"models.validate {c['name']}: out {json.dumps(out)}, want {json.dumps(c['out'])}")
    if m.is_valid(c["in"]) != c["ok"]:
        fails.append(f"models.validate {c['name']}: is_valid disagrees with ok")

# get takes the exact full name only, and the loaded settings never alias the caller's data.
spec_models = scalars.models(load_cases["ok_spec_example"]["data"])
for name in ("order", "shop:Order", "constructor", 3, None):
    if spec_models.get(name) is not None:
        fails.append(f"models.get({name!r}) found a model")
owned = {"app": {"a": {"s": {"type": "enum", "values": ["x", "y"]}}}}
owned_model = scalars.models(owned).get("app:a")
owned["app"]["a"]["s"]["values"][0] = "w"
owned["app"]["a"]["s"]["values"].append("z")
if not owned_model.is_valid({"s": "x"}) or owned_model.is_valid({"s": "z"}):
    fails.append("loaded settings alias the caller's values")

ADDRESS = {"street": "a", "country": "US"}
HOSTILE = {
    "wide_list": lambda n: {"bill_to": dict(ADDRESS), "items": [{"sku": "0614141000036", "qty": 1} for _ in range(n)], "status": "draft"},
    "many_unknown": lambda n: {**ADDRESS, **{f"k{i}": 1 for i in range(n)}},
    "long_decimal": lambda n: {"to": dict(ADDRESS), "status": "draft", "total": "1" + "0" * n},
    "ref_chain": lambda n: {f"f{i}": "a" for i in range(n)},
}
HOSTILE_MODELS = {
    "ref_chain": lambda n: {"app": {"c": {**{f"f{i}": f"c.f{i + 1}" for i in range(n - 1)}, f"f{n - 1}": "string"}}},
}
models_slowest = (0.0, "")
for c in cases["models"]["hostile"]:
    if c["kind"] not in HOSTILE:
        fails.append(f"models.hostile: unknown kind {c['kind']!r}")
        continue
    data = load_cases[c["load"]]["data"] if "load" in c else HOSTILE_MODELS[c["kind"]](c["count"])
    payload = HOSTILE[c["kind"]](c["count"])
    start = time.perf_counter()  # load and validate
    try:
        m = scalars.models(data).get(c["model"])
        if m is None:
            fails.append(f"models.hostile {c['kind']}: no model {c['model']!r}")
            continue
        try:
            m.validate(payload)
            problems = None
        except scalars.ModelError as e:
            problems = e.problems
    except scalars.ModelsError as e:
        fails.append(f"models.hostile {c['kind']}: refused at load: {e}")
        continue
    ms = (time.perf_counter() - start) * 1000
    models_slowest = max(models_slowest, (ms, c["kind"]))
    if (problems is None) != c["ok"]:
        fails.append(f"models.hostile {c['kind']}: want ok {c['ok']}")
    elif problems is not None and (len(problems), problems[0].code, problems[0].pointer) != (c["problem_count"], c["code"], c["pointer"]):
        fails.append(f"models.hostile {c['kind']}: {len(problems)} problems, first {problems[0].code} at {problems[0].pointer!r}")
    if ms >= 2000:
        fails.append(f"models.hostile {c['kind']} took {ms:.0f} ms")

print("\n".join(fails) if fails else (
    f"python: ok, {len(types)} types, slowest hostile {slowest[1]} {slowest[0]:.1f} ms, "
    f"slowest models hostile {models_slowest[1]} {models_slowest[0]:.1f} ms"
))
sys.exit(1 if fails else 0)
