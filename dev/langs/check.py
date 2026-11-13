"""Reads dist/scalars.json the way a Python tool would and checks every example plus cases.json.

Run: python check.py <dist/scalars.json> <cases.json>
"""
import json
import re
import sys

dist_path, cases_path = sys.argv[1:3]
with open(dist_path, encoding="utf-8") as f:
    types = json.load(f)["types"]
with open(cases_path, encoding="utf-8") as f:
    cases = json.load(f)

# The trim step's set (Unicode White_Space), written out: str.strip() also strips U+001C-U+001F.
WS = "\u0009-\u000d \u0085   -     　"
TRIM = re.compile(f"^[{WS}]+|[{WS}]+$")
STEPS = {
    "trim": lambda s: TRIM.sub("", s),
    "lowercase": str.lower,
    "uppercase": str.upper,
    "remove_spaces": lambda s: s.replace(" ", ""),
    "remove_hyphens": lambda s: s.replace("-", ""),
}


def normalize(steps, s):
    for step in steps:
        s = STEPS[step](s)
    return s


def lookup(word):
    key = re.sub("[ -]+", "_", STEPS["lowercase"](STEPS["trim"](word)))
    if key in types:
        return key
    return next((n for n, t in types.items() if key in t.get("aliases", [])), None)


regexes = {}


def matches(t, s):
    schema = t["schema"]
    if "minLength" in schema and len(s) < schema["minLength"]:  # len counts code points
        return False
    if "maxLength" in schema and len(s) > schema["maxLength"]:
        return False
    if "pattern" not in schema:
        return True
    r = regexes.setdefault(t["name"], re.compile(schema["pattern"]))
    return r.fullmatch(s) is not None  # not match/search: "$" also matches before a final "\n"


fails = []
for t in types.values():
    if t["schema"].get("type") != "string":
        continue
    for v in t["examples"]["valid"]:
        if isinstance(v, str) and not matches(t, v):
            fails.append(f"{t['name']} rejects valid {v!r}")
    for v in t["examples"].get("invalid", []):
        if isinstance(v, str) and matches(t, v):
            fails.append(f"{t['name']} accepts invalid {v!r}")
for c in cases["normalize"]:
    got = normalize(c["steps"], c["in"])
    if got != c["out"]:
        fails.append(f"normalize {c['in']!r} {c['steps']} = {got!r}, want {c['out']!r}")
for c in cases["lookup"]:
    got = lookup(c["in"])
    if got != c["out"]:
        fails.append(f"lookup {c['in']!r} = {got}, want {c['out']}")
for c in cases["match"]:
    if matches(types[c["type"]], c["in"]) != c["ok"]:
        fails.append(f"{c['type']} on {c['in']!r}: want {c['ok']}")

print("\n".join(fails) if fails else f"python: ok, {len(types)} types")
sys.exit(1 if fails else 0)
