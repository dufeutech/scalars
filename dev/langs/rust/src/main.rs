// Uses the generated dist/rust/scalars.rs and checks every example plus cases.json.
// Run: cargo run -- <dist/scalars.json> <cases.json>
#[path = "../../../../dist/rust/scalars.rs"]
mod scalars;

use scalars::{Kind, Meta, Step, Text};
use serde_json::Value;
use std::{borrow::Cow, fs, process, ptr, time::Instant};

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
        let meta = Meta { name: "probe", label: "", hint: "", error: "", details: "", level: "", primitive: "string", aliases: &[] };
        let probe = Text::new(meta, list, None, 0, usize::MAX);
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
        if ms >= 2000.0 {
            fails.push(format!("hostile {name} took {ms:.0} ms"));
        }
    }

    if !fails.is_empty() {
        println!("{}", fails.join("\n"));
        process::exit(1);
    }
    println!("rust: ok, {} types, slowest hostile {slowest_type} {slowest:.1} ms", types.len());
}
