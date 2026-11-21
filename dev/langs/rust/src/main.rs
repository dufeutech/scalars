// Uses the generated dist/rust/scalars.rs and checks every example plus cases.json.
// Run: cargo run -- <dist/scalars.json> <cases.json>
#[path = "../../../../dist/rust/scalars.rs"]
mod scalars;

use scalars::{Kind, Meta, Model, ModelError, Models, ModelsError, Problem, Step, Text};
use serde_json::{json, Map, Value};
use std::{borrow::Cow, collections::HashMap, fs, process, ptr, thread, time::Instant};

fn load(path: &str) -> Value {
    let text = fs::read_to_string(path).unwrap_or_else(|e| {
        println!("{path}: {e}");
        process::exit(2)
    });
    serde_json::from_str(&lone_surrogates_replaced(&text)).unwrap_or_else(|e| {
        println!("{path}: {e}");
        process::exit(2)
    })
}

/// `text` with each lone surrogate escape ("\ud800" without its pair) as "�". serde_json refuses a lone
/// surrogate in a string, and cases.json writes some for its "malformed" cases, which this runner skips: a Rust
/// `&str` cannot hold one. A pair ("😀") and an escaped backslash ("\\ud800") stay as they are.
fn lone_surrogates_replaced(text: &str) -> String {
    let b = text.as_bytes();
    let unit = |i: usize| -> Option<u16> {
        if b.get(i) == Some(&b'\\') && b.get(i + 1) == Some(&b'u') {
            u16::from_str_radix(text.get(i + 2..i + 6)?, 16).ok()
        } else {
            None
        }
    };
    let mut out = String::with_capacity(text.len());
    let (mut i, mut kept) = (0, 0);
    while i < b.len() {
        if b[i] != b'\\' {
            i += 1;
            continue;
        }
        let Some(u) = unit(i) else {
            i += 2; // another escape: "\\", "\"", "\n" and so on
            continue;
        };
        match u {
            0xd800..=0xdbff if matches!(unit(i + 6), Some(0xdc00..=0xdfff)) => i += 12,
            0xd800..=0xdfff => {
                out.push_str(&text[kept..i]);
                out.push_str("\\ufffd");
                i += 6;
                kept = i;
            }
            _ => i += 6,
        }
    }
    out.push_str(&text[kept..]);
    out
}

fn strs(v: &Value) -> Vec<&str> {
    v.as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default()
}

/// The Meta inside a typed scalar.
fn meta(kind: Kind) -> &'static Meta {
    match kind {
        Kind::Text(t) => t,
        Kind::Int(t) => t,
        Kind::Number(t) => t,
        Kind::Bool(t) => t,
        Kind::Shape(m) => m,
    }
}

/// A JSON number as an i64, when it is integral and fits; other values are not integers in Rust.
fn as_int(v: &Value) -> Option<i64> {
    if let Some(n) = v.as_i64() {
        return Some(n);
    }
    let f = v.as_f64()?;
    (f.fract() == 0.0 && f >= -(2f64.powi(63)) && f < 2f64.powi(63)).then_some(f as i64)
}

/// What validating v with a type gave: the output as JSON, or the error. None when Rust's types cannot express
/// v for the type (the compiler rejects it), or the type is an object, array or any, which has no validate.
type Outcome = Option<Result<Value, scalars::ScalarError>>;

fn run(kind: Kind, v: &Value, fails: &mut Vec<String>) -> Outcome {
    let (result, is_valid) = match kind {
        Kind::Text(t) => {
            let s = v.as_str()?;
            let r = t.validate(s);
            if let Ok(out) = &r {
                if matches!(out, Cow::Owned(_)) && out == s {
                    fails.push(format!("{} on {s:?}: nothing changed but validate copied the text", t.name));
                }
            }
            (r.map(|out| Value::from(out.into_owned())), t.is_valid(s))
        }
        Kind::Int(t) => {
            let n = as_int(v)?;
            (t.validate(n).map(Value::from), t.is_valid(n))
        }
        Kind::Number(t) => {
            let f = v.as_f64()?;
            (t.validate(f).map(Value::from), t.is_valid(f))
        }
        Kind::Bool(t) => {
            let b = v.as_bool()?;
            (t.validate(b).map(Value::from), t.is_valid(b))
        }
        Kind::Shape(_) => return None,
    };
    if result.is_ok() != is_valid {
        fails.push(format!("{} on {v}: validate and is_valid disagree", meta(kind).name));
    }
    Some(result)
}

/// Each normalize step by its name in dist.
fn step(name: &str) -> Option<Step> {
    Some(match name {
        "trim" => Step::Trim,
        "lowercase" => Step::Lowercase,
        "uppercase" => Step::Uppercase,
        "remove_spaces" => Step::RemoveSpaces,
        "remove_hyphens" => Step::RemoveHyphens,
        _ => return None,
    })
}

fn steps(names: &[&str], fails: &mut Vec<String>) -> Vec<Step> {
    names
        .iter()
        .filter_map(|n| {
            let s = step(n);
            if s.is_none() {
                fails.push(format!("unknown normalize step {n:?}"));
            }
            s
        })
        .collect()
}

/// Problems as the cases write them, through the library's own JSON conversion.
fn problems_json(problems: &[Problem]) -> Value {
    problems.iter().map(Value::from).collect()
}

/// The error text must be each problem's `pointer: message`, joined with "; ", and it must be a std error.
fn check_text(what: &str, problems: &[Problem], e: &dyn std::error::Error, fails: &mut Vec<String>) {
    let joined = problems.iter().map(|p| format!("{}: {}", p.pointer, p.message)).collect::<Vec<_>>().join("; ");
    if e.to_string() != joined {
        fails.push(format!("{what}: error text {:?} does not join its problems", e.to_string()));
    }
}

fn assert_send_sync<T: Send + Sync>() {}

/// The hostile payloads, built exactly as the Task 3 report describes.
fn hostile_payload(kind: &str, n: usize) -> Option<Value> {
    let address = || json!({"street": "a", "country": "US"});
    Some(match kind {
        "wide_list" => {
            let items: Vec<Value> = (0..n).map(|_| json!({"sku": "0614141000036", "qty": 1})).collect();
            json!({"bill_to": address(), "items": items, "status": "draft"})
        }
        "many_unknown" => {
            let mut p = address();
            let obj = p.as_object_mut().unwrap();
            for i in 0..n {
                obj.insert(format!("k{i}"), json!(1));
            }
            p
        }
        "long_decimal" => json!({"to": address(), "status": "draft", "total": format!("1{}", "0".repeat(n))}),
        "ref_chain" => Value::Object((0..n).map(|i| (format!("f{i}"), json!("a"))).collect()),
        _ => return None,
    })
}

/// The hostile models files built from the count, for the kinds without a load case.
fn hostile_models(kind: &str, n: usize) -> Option<Value> {
    match kind {
        "ref_chain" => {
            let mut c: Map<String, Value> = (0..n - 1).map(|i| (format!("f{i}"), json!(format!("c.f{}", i + 1)))).collect();
            c.insert(format!("f{}", n - 1), json!("string"));
            Some(json!({"app": {"c": c}}))
        }
        _ => None,
    }
}

/// Runs cases.models. Returns the slowest hostile case's time and kind.
fn check_models(cases: &Value, fails: &mut Vec<String>) -> (f64, String) {
    assert_send_sync::<Models>();
    assert_send_sync::<Model>();
    assert_send_sync::<ModelError>();
    assert_send_sync::<ModelsError>();
    let section = &cases["models"];
    let mut load_data: HashMap<&str, &Value> = HashMap::new();
    for c in section["load"].as_array().unwrap() {
        let name = c["name"].as_str().unwrap();
        load_data.insert(name, &c["data"]);
        let what = format!("models.load {name}");
        match (scalars::models(&c["data"]), c["ok"].as_bool().unwrap()) {
            (Ok(set), true) => {
                if json!(set.all()) != c["all"] {
                    fails.push(format!("{what}: all {:?}, want {}", set.all(), c["all"]));
                }
            }
            (Ok(_), false) => fails.push(format!("{what}: loaded, want problems {}", c["problems"])),
            (Err(e), true) => fails.push(format!("{what}: refused: {e}")),
            (Err(e), false) => {
                let got = problems_json(&e.problems);
                if got != c["problems"] {
                    fails.push(format!("{what}: problems {got}, want {}", c["problems"]));
                }
                check_text(&what, &e.problems, &e, fails);
            }
        }
    }

    let loaded: HashMap<&str, Result<Models, ModelsError>> = load_data.iter().map(|(&k, &v)| (k, scalars::models(v))).collect();
    for c in section["validate"].as_array().unwrap() {
        let what = format!("models.validate {}", c["name"].as_str().unwrap());
        let (load, name) = (c["load"].as_str().unwrap(), c["model"].as_str().unwrap());
        let Some(Ok(set)) = loaded.get(load) else {
            fails.push(format!("{what}: load case {load:?} must load"));
            continue;
        };
        let Some(m) = set.get(name) else {
            fails.push(format!("{what}: no model {name:?}"));
            continue;
        };
        if m.name() != name {
            fails.push(format!("{what}: model name {:?}", m.name()));
        }
        let ok = c["ok"].as_bool().unwrap();
        match m.validate(&c["in"]) {
            Ok(out) if ok => {
                if out != c["out"] {
                    fails.push(format!("{what}: out {out}, want {}", c["out"]));
                }
                // An int field puts an integer in the output.
                if c["name"] == "int_shapes_float" && out["qty"].as_i64() != Some(3) {
                    fails.push(format!("{what}: qty is {}, want the integer 3", out["qty"]));
                }
            }
            Ok(_) => fails.push(format!("{what}: passed, want problems {}", c["problems"])),
            Err(e) if ok => fails.push(format!("{what}: refused: {e}")),
            Err(e) => {
                let got = problems_json(&e.problems);
                if got != c["problems"] {
                    fails.push(format!("{what}: problems {got}, want {}", c["problems"]));
                }
                check_text(&what, &e.problems, &e, fails);
            }
        }
        if m.is_valid(&c["in"]) != ok {
            fails.push(format!("{what}: is_valid disagrees with ok"));
        }
    }

    // A number field returns the number as given: a whole number stays an integer (not 3.0).
    if let Some(Ok(set)) = loaded.get("scalar_kinds") {
        let out = set.get("app:k").map(|m| m.validate(&json!({"n": 3, "b": true, "o": {}, "y": 0})));
        if !matches!(&out, Some(Ok(v)) if v["n"].is_u64()) {
            fails.push(format!("models: a float64 field gave {out:?} for 3, want the integer 3"));
        }
    }

    // get takes the exact full name only.
    if let Some(Ok(spec)) = loaded.get("ok_spec_example") {
        for name in ["order", "shop:Order", "constructor", "__proto__", "toString", ""] {
            if spec.get(name).is_some() {
                fails.push(format!("models get({name:?}) found a model"));
            }
        }
        // One shared Model, validated from several threads at once.
        if let Some(order) = spec.get("billing:address") {
            let (good, bad) = (json!({"street": "a", "country": "us"}), json!({"street": 5, "x": 1}));
            thread::scope(|s| {
                let runs: Vec<_> = (0..8)
                    .map(|_| s.spawn(|| (0..200).all(|_| order.is_valid(&good) && order.validate(&bad).map_err(|e| e.problems.len()) == Err(3))))
                    .collect();
                if !runs.into_iter().all(|r| r.join().unwrap()) {
                    fails.push("models: a shared Model gave other results across threads".into());
                }
            });
        }
    }
    // The loaded settings never alias the caller's data.
    let mut owned = json!({"app": {"a": {"s": {"type": "enum", "values": ["x", "y"]}}}});
    match scalars::models(&owned) {
        Ok(set) => {
            owned["app"]["a"]["s"]["values"][0] = json!("w");
            let m = set.get("app:a").unwrap();
            if !m.is_valid(&json!({"s": "x"})) || m.is_valid(&json!({"s": "w"})) {
                fails.push("loaded settings alias the caller's values".into());
            }
        }
        Err(e) => fails.push(format!("models owned: refused: {e}")),
    }

    let (mut slowest, mut slowest_kind) = (0.0, String::new());
    for c in section["hostile"].as_array().unwrap() {
        let kind = c["kind"].as_str().unwrap();
        let what = format!("models.hostile {kind}");
        let count = c["count"].as_u64().unwrap() as usize;
        let Some(payload) = hostile_payload(kind, count) else {
            fails.push(format!("{what}: unknown kind"));
            continue;
        };
        let built;
        let data = match c["load"].as_str() {
            Some(load) => match load_data.get(load) {
                Some(&data) => data,
                None => {
                    fails.push(format!("{what}: no load case {load:?}"));
                    continue;
                }
            },
            None => match hostile_models(kind, count) {
                Some(data) => {
                    built = data;
                    &built
                }
                None => {
                    fails.push(format!("{what}: no load case and no models builder"));
                    continue;
                }
            },
        };
        let start = Instant::now(); // load and validate
        let set = match scalars::models(data) {
            Ok(set) => set,
            Err(e) => {
                fails.push(format!("{what}: refused at load: {:.200}", e.to_string()));
                continue;
            }
        };
        let Some(m) = set.get(c["model"].as_str().unwrap()) else {
            fails.push(format!("{what}: no model {}", c["model"]));
            continue;
        };
        let result = m.validate(&payload);
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        if ms > slowest {
            (slowest, slowest_kind) = (ms, kind.to_string());
        }
        match (result, c["ok"].as_bool().unwrap()) {
            (Ok(_), true) => {}
            (Ok(_), false) => fails.push(format!("{what}: passed, want problems")),
            (Err(e), true) => fails.push(format!("{what}: refused: {:.200}", e.to_string())),
            (Err(e), false) => {
                let first = e.problems.first();
                if json!(e.problems.len()) != c["problem_count"] || first.map(|p| p.code) != c["code"].as_str() || first.map(|p| p.pointer.as_str()) != c["pointer"].as_str() {
                    fails.push(format!("{what}: {} problems, first {:?}", e.problems.len(), first.map(|p| (p.code, &p.pointer))));
                }
            }
        }
        if ms >= 2000.0 {
            fails.push(format!("{what} took {ms:.0} ms"));
        }
    }
    (slowest, slowest_kind)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        println!("usage: scalars-check <dist/scalars.json> <cases.json>");
        process::exit(2);
    }
    let dist = load(&args[1]);
    let cases = load(&args[2]);
    let types = dist["types"].as_object().expect("types");
    let mut fails: Vec<String> = Vec::new();

    if scalars::ALL.len() != types.len() {
        fails.push(format!("ALL has {} types, dist has {}", scalars::ALL.len(), types.len()));
    }
    let mut names: Vec<&String> = types.keys().collect();
    names.sort();
    for (i, name) in names.iter().enumerate() {
        let spec = &types[name.as_str()];
        let Some(kind) = scalars::lookup(name) else {
            fails.push(format!("lookup({name:?}) found nothing"));
            continue;
        };
        let m = meta(kind);
        if scalars::ALL.get(i).is_some_and(|a| !ptr::eq(*a, m)) {
            fails.push(format!("ALL[{i}] is not {name}: ALL is not in catalogue order"));
        }
        if !scalars::get(name).is_some_and(|g| ptr::eq(g, m)) {
            fails.push(format!("get({name:?}) is not lookup({name:?})"));
        }
        let text = |k: &str| spec[k].as_str().unwrap_or_default();
        if [m.name, m.label, m.hint, m.error, m.details, m.level, m.primitive]
            != [name.as_str(), text("label"), text("hint"), text("error"), text("details"), text("level"), text("primitive")]
            || m.aliases != strs(&spec["aliases"]).as_slice()
            || m.params != strs(&spec["params"]).as_slice()
            || m.check != spec["check"].as_str()
        {
            fails.push(format!("{name} metadata differs from dist"));
        }
        if let Kind::Text(t) = kind {
            if t.steps() != steps(&strs(&spec["normalize"]), &mut fails) {
                fails.push(format!("{name} steps {:?} differ from dist", t.steps()));
            }
        }
        for v in spec["examples"]["valid"].as_array().into_iter().flatten() {
            if let Some(Err(_)) = run(kind, v, &mut fails) {
                fails.push(format!("{name} rejects valid {v}"));
            }
        }
        for v in spec["examples"]["invalid"].as_array().into_iter().flatten() {
            // Normalizing may repair an invalid example ("usa" -> "USA"), so only those may pass.
            let repaired = matches!((kind, v.as_str()), (Kind::Text(t), Some(s)) if t.normalize(s) != s);
            if let Some(Ok(_)) = run(kind, v, &mut fails) {
                if !repaired {
                    fails.push(format!("{name} accepts invalid {v}"));
                }
            }
        }
        for v in spec["examples"]["check_invalid"].as_array().into_iter().flatten() {
            if let Some(Ok(_)) = run(kind, v, &mut fails) {
                fails.push(format!("{name} accepts check_invalid {v}"));
            }
        }
        for alias in strs(&spec["aliases"]) {
            if !scalars::get(alias).is_some_and(|g| ptr::eq(g, m)) {
                fails.push(format!("get({alias:?}) is not {name}"));
            }
        }
    }
    if scalars::lookup("nothing").is_some() {
        fails.push("lookup(\"nothing\") is not None".into());
    }

    for c in cases["normalize"].as_array().unwrap() {
        let (input, want) = (c["in"].as_str().unwrap(), c["out"].as_str().unwrap());
        // normalize is a method of the type, so build a probe with the case's steps and no rule.
        let list: &'static [Step] = steps(&strs(&c["steps"]), &mut fails).leak();
        let meta = Meta { name: "probe", label: "", hint: "", error: "", details: "", level: "", primitive: "string", aliases: &[], params: &[], check: None };
        let probe = Text::new(meta, list, None, 0, usize::MAX, None);
        let got = probe.normalize(input);
        if got != want {
            fails.push(format!("normalize {input:?} {list:?} = {got:?}, want {want:?}"));
        }
    }

    for c in cases["lookup"].as_array().unwrap() {
        let (input, want) = (c["in"].as_str().unwrap(), c["out"].as_str());
        let got = scalars::get(input).map(|m| m.name);
        if got != want {
            fails.push(format!("lookup {input:?} = {got:?}, want {want:?}"));
        }
    }

    for c in cases["match"].as_array().unwrap() {
        let (name, input, ok) = (c["type"].as_str().unwrap(), c["in"].as_str().unwrap(), c["ok"].as_bool().unwrap());
        match scalars::lookup(name) {
            Some(Kind::Text(t)) if t.is_valid(input) == ok => {}
            _ => fails.push(format!("{name} on {input:?}: want {ok}")),
        }
    }

    for c in cases["validate"].as_array().unwrap() {
        if c["dynamic"].as_bool() == Some(true) {
            continue; // Rust's compiler rejects a value of the wrong kind
        }
        if c["malformed"].is_string() {
            continue; // a &str cannot hold a lone surrogate, so there is nothing to refuse
        }
        let name = c["type"].as_str().unwrap();
        let ok = c["ok"].as_bool().unwrap();
        let v = &c["in"];
        let Some(kind) = scalars::lookup(name) else {
            fails.push(format!("lookup({name:?}) found nothing"));
            continue;
        };
        // serde_json has no NaN or Infinity, so those go straight to the number type.
        let outcome = match (c["special"].as_str(), kind) {
            (Some(special @ ("NaN" | "Infinity")), Kind::Number(t)) => {
                let f = if special == "NaN" { f64::NAN } else { f64::INFINITY };
                if t.validate(f).is_ok() != t.is_valid(f) {
                    fails.push(format!("{name} on {special}: validate and is_valid disagree"));
                }
                Some(t.validate(f).map(Value::from))
            }
            (Some(special), _) => {
                fails.push(format!("{name}: special {special} is not a non-finite number for a number type"));
                continue;
            }
            _ => run(kind, v, &mut fails),
        };
        let shown = c.get("special").unwrap_or(v);
        match outcome {
            None => {} // an integer case that is not an i64, or an object, array or any
            Some(Err(e)) if ok => fails.push(format!("{name} rejects {shown}: {e}")),
            Some(Err(e)) => {
                if e.to_string() != types[name]["error"].as_str().unwrap() || !ptr::eq(e.scalar, meta(kind)) {
                    fails.push(format!("{name} error {e} is not the type's error"));
                } else if Some(e.reason.as_str()) != c["reason"].as_str() {
                    fails.push(format!("{name} on {shown}: reason {}, want {}", e.reason.as_str(), c["reason"]));
                }
            }
            Some(Ok(_)) if !ok => fails.push(format!("{name} accepts {shown}")),
            Some(Ok(out)) => {
                if let Some(want) = c.get("out") {
                    let want = match kind {
                        Kind::Int(_) => as_int(want).map(Value::from).unwrap_or(Value::Null),
                        _ => want.clone(),
                    };
                    if out != want {
                        fails.push(format!("{name} on {shown} = {out}, want {want}"));
                    }
                }
            }
        }
    }

    if !matches!(scalars::EMAIL.validate("  user@example.com "), Ok(Cow::Borrowed("user@example.com"))) {
        fails.push("EMAIL.validate on trimmed text did not borrow".into());
    }
    if !matches!(scalars::ENUM.validate("x"), Ok(Cow::Borrowed("x"))) {
        fails.push("ENUM.validate(\"x\") did not return a borrowed \"x\"".into());
    }
    if scalars::FLOAT64.validate(3.0).ok() != Some(3.0) {
        fails.push("FLOAT64.validate(3.0) did not return 3.0".into());
    }
    if scalars::BOOLEAN.validate(true).ok() != Some(true) {
        fails.push("BOOLEAN.validate(true) did not return true".into());
    }

    let (mut slowest, mut slowest_type) = (0.0, "");
    for c in cases["hostile"].as_array().unwrap() {
        if c["malformed"].is_string() {
            continue; // a &str cannot hold a lone surrogate
        }
        let name = c["type"].as_str().unwrap();
        let Some(Kind::Text(t)) = scalars::lookup(name) else {
            fails.push(format!("hostile {name} is not a text type"));
            continue;
        };
        let count = c["count"].as_u64().unwrap() as usize;
        let text = [c["prefix"].as_str().unwrap(), &c["repeat"].as_str().unwrap().repeat(count), c["suffix"].as_str().unwrap()].concat();
        let start = Instant::now();
        let got = t.is_valid(&text);
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        if ms > slowest {
            (slowest, slowest_type) = (ms, name);
        }
        if got != c["ok"].as_bool().unwrap() {
            fails.push(format!("hostile {name}: want {}", !got));
        }
        if let Err(e) = t.validate(&text) {
            if Some(e.reason.as_str()) != c["reason"].as_str() {
                fails.push(format!("hostile {name}: reason {}, want {}", e.reason.as_str(), c["reason"]));
            }
        }
        if ms >= 2000.0 {
            fails.push(format!("hostile {name} took {ms:.0} ms"));
        }
    }

    let (models_slowest, models_slowest_kind) = check_models(&cases, &mut fails);

    if !fails.is_empty() {
        println!("{}", fails.join("\n"));
        process::exit(1);
    }
    println!(
        "rust: ok, {} types, slowest hostile {slowest_type} {slowest:.1} ms, slowest models hostile {models_slowest_kind} {models_slowest:.1} ms",
        types.len()
    );
}
