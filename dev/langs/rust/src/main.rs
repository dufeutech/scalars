// Reads dist/scalars.json the way a Rust tool would and checks every example plus cases.json.
// Run: cargo run -- <dist/scalars.json> <cases.json>
use regex::Regex;
use serde_json::Value;
use std::{collections::HashMap, fs, process};

// The trim step's set (Unicode White_Space), written out.
const WS: &[char] = &[
    '\u{9}', '\u{a}', '\u{b}', '\u{c}', '\u{d}', ' ', '\u{85}', '\u{a0}', '\u{1680}', '\u{2000}', '\u{2001}',
    '\u{2002}', '\u{2003}', '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}', '\u{2009}', '\u{200a}',
    '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}',
];

fn step(name: &str, s: &str) -> String {
    match name {
        "trim" => s.trim_matches(WS).to_string(),
        "lowercase" => s.to_lowercase(), // full Unicode mapping, final sigma included
        "uppercase" => s.to_uppercase(),
        "remove_spaces" => s.replace(' ', ""),
        "remove_hyphens" => s.replace('-', ""),
        other => panic!("unknown normalize step {other}"),
    }
}

fn strs(v: &Value) -> Vec<&str> {
    v.as_array().map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default()
}

struct Checker<'a> {
    types: &'a serde_json::Map<String, Value>,
    regexes: HashMap<String, Regex>,
}

impl Checker<'_> {
    fn matches(&mut self, name: &str, s: &str) -> bool {
        let schema = &self.types[name]["schema"];
        let n = s.chars().count() as u64; // code points
        if schema["minLength"].as_u64().is_some_and(|m| n < m) || schema["maxLength"].as_u64().is_some_and(|m| n > m) {
            return false;
        }
        let Some(p) = schema["pattern"].as_str() else { return true };
        self.regexes.entry(name.to_string()).or_insert_with(|| Regex::new(p).expect("pattern compiles")).is_match(s)
    }

    fn lookup(&self, word: &str) -> Option<String> {
        let key = Regex::new("[ -]+").unwrap().replace_all(&step("lowercase", &step("trim", word)), "_").into_owned();
        if self.types.contains_key(&key) {
            return Some(key);
        }
        self.types.iter().find(|(_, t)| strs(&t["aliases"]).contains(&key.as_str())).map(|(n, _)| n.clone())
    }
}

fn load(path: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(path).expect("readable file")).expect("valid JSON")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dist = load(&args[1]);
    let cases = load(&args[2]);
    let types = dist["types"].as_object().expect("types");
    let mut c = Checker { types, regexes: HashMap::new() };
    let mut fails = Vec::new();

    for (name, t) in types {
        if t["schema"]["type"] != "string" {
            continue;
        }
        for v in strs(&t["examples"]["valid"]) {
            if !c.matches(name, v) {
                fails.push(format!("{name} rejects valid {v:?}"));
            }
        }
        for v in strs(&t["examples"]["invalid"]) {
            if c.matches(name, v) {
                fails.push(format!("{name} accepts invalid {v:?}"));
            }
        }
    }
    for k in cases["normalize"].as_array().unwrap() {
        let (input, want) = (k["in"].as_str().unwrap(), k["out"].as_str().unwrap());
        let got = strs(&k["steps"]).iter().fold(input.to_string(), |s, n| step(n, &s));
        if got != want {
            fails.push(format!("normalize {input:?} = {got:?}, want {want:?}"));
        }
    }
    for k in cases["lookup"].as_array().unwrap() {
        let (input, want) = (k["in"].as_str().unwrap(), k["out"].as_str().map(String::from));
        let got = c.lookup(input);
        if got != want {
            fails.push(format!("lookup {input:?} = {got:?}, want {want:?}"));
        }
    }
    for k in cases["match"].as_array().unwrap() {
        let (name, input, ok) = (k["type"].as_str().unwrap(), k["in"].as_str().unwrap(), k["ok"].as_bool().unwrap());
        if c.matches(name, input) != ok {
            fails.push(format!("{name} on {input:?}: want {ok}"));
        }
    }

    if !fails.is_empty() {
        println!("{}", fails.join("\n"));
        process::exit(1);
    }
    println!("rust: ok, {} types", types.len());
}
