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
    ) or t.aliases != tuple(spec.get("aliases", [])):
        fails.append(f"{name} metadata differs from dist")
    for v in spec["examples"]["valid"]:
        if not t.is_valid(v):
            fails.append(f"{name} rejects valid {v!r}")
    for v in spec["examples"].get("invalid", []):
        # Invalid examples break the raw pattern; normalizing may repair one ("usa" -> "USA"), so only those may pass.
        if t.is_valid(v) and not (isinstance(v, str) and t.normalize(v) != v):
            fails.append(f"{name} accepts invalid {v!r}")
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

print("\n".join(fails) if fails else f"python: ok, {len(types)} types, slowest hostile {slowest[1]} {slowest[0]:.1f} ms")
sys.exit(1 if fails else 0)
