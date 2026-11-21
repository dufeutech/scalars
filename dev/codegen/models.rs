// Models: a file of domains, models and fields (parsed JSON), loaded once, then payloads checked against a model.
// A port of dev/lib/models.mjs, the reference every engine copies. rust.mjs appends this file after engine.rs, so it
// shares engine.rs's imports (HashMap, fmt) and items (Kind, lookup, get, longer_than, ERRORS, PARAM_RULES). Load is
// O(file) and iterative: no recursion is driven by the input. Validate recurses, but load bounds a payload's depth
// at MAX_DEPTH levels. serde_json's Map keeps no input order, so every list a caller sees (problems, all) is sorted.

use serde_json::{Map, Value};
use std::cmp::Ordering;
use std::collections::HashSet;
use std::sync::Arc;

/// How deep models may nest, each model and each `items` one level; deeper is refused at load.
const MAX_DEPTH: usize = 64;

/// One problem: an RFC 6901 `pointer`, a fixed `code`, the `params` its message needs (empty when there are none),
/// and the English `message`.
#[derive(Debug, Clone, PartialEq)]
pub struct Problem {
    pub pointer: String,
    pub code: &'static str,
    pub params: Map<String, Value>,
    pub message: String,
}

/// The problem as a JSON object, `{pointer, code, params, message}`, ready for an RFC 9457 response.
impl From<&Problem> for Value {
    fn from(p: &Problem) -> Value {
        let mut o = Map::with_capacity(4);
        o.insert("pointer".into(), Value::String(p.pointer.clone()));
        o.insert("code".into(), Value::String(p.code.into()));
        o.insert("params".into(), Value::Object(p.params.clone()));
        o.insert("message".into(), Value::String(p.message.clone()));
        Value::Object(o)
    }
}

fn join_problems(f: &mut fmt::Formatter<'_>, problems: &[Problem]) -> fmt::Result {
    for (i, p) in problems.iter().enumerate() {
        if i > 0 {
            f.write_str("; ")?;
        }
        write!(f, "{}: {}", p.pointer, p.message)?;
    }
    Ok(())
}

/// A refused models file. `problems` lists every problem in it, sorted by location.
#[derive(Debug, Clone)]
pub struct ModelsError {
    pub problems: Vec<Problem>,
}

impl fmt::Display for ModelsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        join_problems(f, &self.problems)
    }
}

impl std::error::Error for ModelsError {}

/// A payload that failed its model. `problems` lists every problem in it, sorted by location.
#[derive(Debug, Clone)]
pub struct ModelError {
    pub problems: Vec<Problem>,
}

impl fmt::Display for ModelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        join_problems(f, &self.problems)
    }
}

impl std::error::Error for ModelError {}

/// One step of a location: a key or a list index.
#[derive(Debug, Clone)]
enum Seg {
    Key(String),
    Index(usize),
}

fn key(s: &str) -> Seg {
    Seg::Key(s.to_owned())
}

/// A problem with its decoded segments, which its order needs: a key "10" and an index 10 differ.
struct Located {
    segments: Vec<Seg>,
    problem: Problem,
}

/// Params from pairs.
fn params<const N: usize>(pairs: [(&str, Value); N]) -> Map<String, Value> {
    pairs.into_iter().map(|(k, v)| (k.to_owned(), v)).collect()
}

/// The code's template with each "{name}" replaced: a list joined with ", ", a number in plain decimal.
fn fill(text: &str, code: &str, params: &Map<String, Value>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        let Some(len) = rest[open + 1..].find('}') else {
            break;
        };
        out.push_str(&rest[..open]);
        let name = &rest[open + 1..open + 1 + len];
        match params.get(name) {
            Some(Value::String(s)) => out.push_str(s),
            Some(Value::Number(n)) => out.push_str(&n.to_string()),
            Some(Value::Array(list)) => {
                for (i, v) in list.iter().enumerate() {
                    if i > 0 {
                        out.push_str(", ");
                    }
                    out.push_str(v.as_str().expect("a list param holds text"));
                }
            }
            Some(_) => panic!("scalars: param {name:?} of code {code:?} has no text form"),
            None => panic!("scalars: code {code:?} needs param {name:?}"),
        }
        rest = &rest[open + 1 + len + 1..];
    }
    out.push_str(rest);
    out
}

/// A problem at `segments`. The message is the code's ERRORS template, filled in; a code without a template
/// (`invalid`, whose text is the type's error) takes `message`.
fn locate(
    segments: Vec<Seg>,
    code: &'static str,
    params: Map<String, Value>,
    message: Option<&str>,
) -> Located {
    let message = match ERRORS.iter().find(|&&(c, _)| c == code) {
        Some(&(_, text)) => fill(text, code, &params),
        None => message
            .unwrap_or_else(|| {
                panic!("scalars: code {code:?} has no template, so it needs a message")
            })
            .to_owned(),
    };
    let mut pointer = String::new();
    for s in &segments {
        pointer.push('/');
        match s {
            Seg::Index(i) => pointer.push_str(&i.to_string()),
            Seg::Key(k) => {
                for c in k.chars() {
                    match c {
                        '~' => pointer.push_str("~0"),
                        '/' => pointer.push_str("~1"),
                        c => pointer.push(c),
                    }
                }
            }
        }
    }
    let problem = Problem {
        pointer,
        code,
        params,
        message,
    };
    Located { segments, problem }
}

/// Segment by segment: list indices numerically, keys by code point (Rust compares `str` by UTF-8 bytes, which is
/// code-point order), an index before a key; a parent first; then by code.
fn compare_located(a: &Located, b: &Located) -> Ordering {
    for (x, y) in a.segments.iter().zip(&b.segments) {
        let o = match (x, y) {
            (Seg::Index(i), Seg::Index(j)) => i.cmp(j),
            (Seg::Index(_), Seg::Key(_)) => Ordering::Less,
            (Seg::Key(_), Seg::Index(_)) => Ordering::Greater,
            (Seg::Key(k), Seg::Key(l)) => k.cmp(l),
        };
        if o != Ordering::Equal {
            return o;
        }
    }
    let by_length = a.segments.len().cmp(&b.segments.len());
    by_length.then_with(|| a.problem.code.cmp(b.problem.code))
}

fn sorted(mut list: Vec<Located>) -> Vec<Problem> {
    list.sort_by(compare_located);
    list.into_iter().map(|l| l.problem).collect()
}

/// Whether `s` is a name: a lowercase letter, then lowercase letters, digits and underscores.
fn is_name(s: &str) -> bool {
    let b = s.as_bytes();
    b.first().is_some_and(u8::is_ascii_lowercase)
        && b.iter()
            .all(|&c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_')
}

/// A written reference, `[domain:]name[.field]`, split into its parts, each a name. Names hold no ":" or ".", so
/// this is the reference's REF pattern without a regex.
fn parse_ref(s: &str) -> Option<(Option<&str>, &str, Option<&str>)> {
    let (domain, rest) = match s.split_once(':') {
        Some((d, r)) => (Some(d), r),
        None => (None, s),
    };
    let (name, field) = match rest.split_once('.') {
        Some((n, f)) => (n, Some(f)),
        None => (rest, None),
    };
    let optional = |part: Option<&str>| match part {
        Some(p) => is_name(p),
        None => true,
    };
    (optional(domain) && is_name(name) && optional(field)).then_some((domain, name, field))
}

/// The Meta inside a typed scalar.
fn meta_of(kind: Kind) -> &'static Meta {
    match kind {
        Kind::Text(t) => t,
        Kind::Int(t) => t,
        Kind::Number(t) => t,
        Kind::Bool(t) => t,
        Kind::Shape(m) => m,
    }
}

/// A JSON number as an i64, when its value is integral and fits: 3.0 counts as 3.
fn model_int(v: &Value) -> Option<i64> {
    // 2^63, the first value past i64::MAX; -2^63 is i64::MIN. Both are exact as f64.
    const LIMIT: f64 = 9_223_372_036_854_775_808.0;
    let Value::Number(n) = v else {
        return None;
    };
    if let Some(i) = n.as_i64() {
        return Some(i);
    }
    if n.is_u64() {
        return None; // past i64::MAX
    }
    let f = n.as_f64()?;
    (f.fract() == 0.0 && (-LIMIT..LIMIT).contains(&f)).then_some(f as i64)
}

/// Runs the typed scalar on a JSON value: the cleaned value, or None when `v` is the wrong kind or breaks the
/// type's rule.
fn check(kind: Kind, v: &Value) -> Option<Value> {
    match kind {
        Kind::Text(t) => Some(Value::String(t.check(v.as_str()?)?.into_owned())),
        Kind::Int(t) => model_int(v).filter(|&n| t.is_valid(n)).map(Value::from),
        Kind::Number(t) => v.as_f64().is_some_and(|f| t.is_valid(f)).then(|| v.clone()),
        Kind::Bool(_) => v.is_boolean().then(|| v.clone()),
        Kind::Shape(m) => match m.primitive {
            "object" => v.is_object(),
            "array" => v.is_array(),
            "any" => true,
            p => panic!("scalars: no models check for primitive {p:?}"),
        }
        .then(|| v.clone()),
    }
}

/// The ParamRule of a setting.
fn rule(name: &str) -> &'static ParamRule {
    PARAM_RULES
        .iter()
        .find(|r| r.name == name)
        .unwrap_or_else(|| panic!("scalars: setting {name:?} has no rule"))
}

/// A setting's value as load accepted it.
#[derive(Debug, Clone)]
enum Setting {
    Bool(bool),
    Int(i64),
    List(Arc<Values>),
}

/// A `values` list, copied from the file, and its set: built once per written list and shared by its copies.
#[derive(Debug)]
struct Values {
    list: Vec<String>,
    set: HashSet<String>,
}

#[derive(Debug)]
enum FieldKind {
    /// A type, with the settings written for it (copies keep them).
    Type {
        kind: Kind,
        meta: &'static Meta,
        settings: Vec<(&'static str, Setting)>,
    },
    /// A model, by its index in the Arena.
    Model(usize),
    /// An array of the field with this index in the Arena.
    Array(usize),
}

/// A resolved field.
#[derive(Debug)]
struct Field {
    kind: FieldKind,
    nullable: bool,
    // The settings validate reads, unpacked once here.
    length: Option<usize>,
    values: Option<Arc<Values>>,
    precision: Option<i64>,
    scale: i64,
}

impl Field {
    fn new(kind: FieldKind, nullable: bool) -> Field {
        let mut f = Field {
            kind,
            nullable,
            length: None,
            values: None,
            precision: None,
            scale: 0,
        };
        if let FieldKind::Type { settings, .. } = &f.kind {
            for (name, value) in settings {
                match (*name, value) {
                    ("length", &Setting::Int(n)) => f.length = usize::try_from(n).ok(),
                    ("values", Setting::List(v)) => f.values = Some(Arc::clone(v)),
                    ("precision", &Setting::Int(n)) => f.precision = Some(n),
                    ("scale", &Setting::Int(n)) => f.scale = n,
                    _ => {}
                }
            }
        }
        f
    }
}

/// A loaded model's fields: by name, and as a list built once, not per payload.
#[derive(Debug)]
struct Body {
    fields: HashMap<String, usize>,
    entries: Vec<(String, usize)>,
}

/// What every Model of one load shares: the resolved fields and the models, each found by index.
#[derive(Debug)]
struct Arena {
    fields: Vec<Field>,
    models: Vec<Body>,
}

/// One model of a loaded models file. It is safe to share between threads: nothing changes after load.
#[derive(Clone)]
pub struct Model {
    name: String,
    index: usize,
    arena: Arc<Arena>,
}

impl fmt::Debug for Model {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Model")
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

/// A loaded models file: `get("domain:model")`, and `all`, every full name, sorted.
#[derive(Debug)]
pub struct Models {
    all: Vec<String>,
    by_name: HashMap<String, Model>,
}

impl Models {
    /// The model with exactly this full "domain:model" name, or None.
    pub fn get(&self, name: &str) -> Option<&Model> {
        self.by_name.get(name)
    }

    /// Every full name, sorted.
    pub fn all(&self) -> &[String] {
        &self.all
    }
}

/// Loads a models file, parsed JSON (never a path). Returns its Models, or a ModelsError listing every problem in
/// the file, sorted.
pub fn models(data: &Value) -> Result<Models, ModelsError> {
    let Some(root) = data.as_object() else {
        let problems = sorted(vec![locate(vec![], "not_object", Map::new(), None)]);
        return Err(ModelsError { problems });
    };
    let mut l = Loader::default();
    l.names(root);
    for d in 0..l.written {
        l.parse(d);
    }
    l.resolve_all();
    l.depths();
    if !l.problems.is_empty() {
        return Err(ModelsError {
            problems: sorted(l.problems),
        });
    }
    let bodies = l
        .nodes
        .iter()
        .map(|n| {
            let entries: Vec<(String, usize)> = n
                .list
                .iter()
                .map(|&d| {
                    (
                        l.defs[d].at[2].to_owned(),
                        l.defs[d].field.expect("a loaded field resolved"),
                    )
                })
                .collect();
            Body {
                fields: entries.iter().cloned().collect(),
                entries,
            }
        })
        .collect();
    let arena = Arc::new(Arena {
        fields: l.fields,
        models: bodies,
    });
    let mut all: Vec<String> = l.nodes.iter().map(|n| n.name.clone()).collect();
    all.sort();
    let by_name = l
        .nodes
        .into_iter()
        .enumerate()
        .map(|(index, n)| {
            let arena = Arc::clone(&arena);
            (
                n.name.clone(),
                Model {
                    name: n.name,
                    index,
                    arena,
                },
            )
        })
        .collect();
    Ok(Models { all, by_name })
}

/// A node's Tarjan state; index 0 is unvisited.
#[derive(Debug, Default, Clone, Copy)]
struct Marks {
    index: usize,
    low: usize,
    on_stack: bool,
    done: bool,
    self_loop: bool,
}

/// What a written reference names, once parsed.
#[derive(Clone, Copy)]
enum Ref {
    None,
    Type(Kind, &'static Meta),
    Model(usize), // a Node
    Field(usize), // a Def
}

/// A written field, or an `items` definition (linked to its parent instead of copying the path), during load.
struct Def<'a> {
    at: [&'a str; 3], // domain, model, field; unused for an `items` def
    up: Option<usize>,
    raw: &'a Value,
    domain: &'a str,
    reference: Ref,
    items: Option<usize>,
    field: Option<usize>,
    leaf: Option<usize>, // the Node this field nests, through any `items`
    arrays: usize,       // how many `items` levels lie on the way to it
    failed: bool,
    marks: Marks,
}

impl<'a> Def<'a> {
    fn new(at: [&'a str; 3], up: Option<usize>, raw: &'a Value, domain: &'a str) -> Def<'a> {
        Def {
            at,
            up,
            raw,
            domain,
            reference: Ref::None,
            items: None,
            field: None,
            leaf: None,
            arrays: 0,
            failed: false,
            marks: Marks::default(),
        }
    }
}

/// A model during load.
struct Node<'a> {
    name: String,
    fields: HashMap<&'a str, usize>,
    list: Vec<usize>,
    marks: Marks,
}

/// A node of the resolution graph.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Vertex {
    Def(usize),
    Node(usize),
}

/// One frame of the explicit Tarjan stack: a node and how many of its edges it has followed.
struct Frame {
    node: Vertex,
    step: usize,
}

/// What a field starts from before its own settings: the type, model or field it names.
#[derive(Clone, Copy)]
enum BaseKind {
    Type(Kind, &'static Meta),
    Model(usize),
    Array,
}

/// Whether a field of this kind takes the setting `key`, besides `nullable`.
fn allowed(kind: BaseKind, key: &str) -> bool {
    match kind {
        // Settings refused on number-kind types: float text differs by language, so digit counts can't agree.
        BaseKind::Type(kind, meta) => {
            meta.params.contains(&key)
                && !(matches!(kind, Kind::Number(_)) && (key == "precision" || key == "scale"))
        }
        BaseKind::Array => key == "items",
        BaseKind::Model(_) => false,
    }
}

/// One load of a models file: the steps of dev/lib/models.mjs loadModels, in order.
#[derive(Default)]
struct Loader<'a> {
    problems: Vec<Located>,
    nodes: Vec<Node<'a>>,
    by_name: HashMap<String, usize>, // "domain:model" -> Node
    defs: Vec<Def<'a>>,              // the written fields first, then `items` defs as they're found
    written: usize,
    fields: Vec<Field>, // every field resolve built, `items` included
}

impl<'a> Loader<'a> {
    fn report(&mut self, segments: Vec<Seg>, code: &'static str, params: Map<String, Value>) {
        self.problems.push(locate(segments, code, params, None));
    }

    /// The def's segments then `extra`, built only for a problem, so a deep `items` chain stays linear.
    fn path(&self, d: usize, extra: &[Seg]) -> Vec<Seg> {
        let (mut d, mut tail) = (d, 0);
        while let Some(up) = self.defs[d].up {
            (d, tail) = (up, tail + 1);
        }
        let mut out: Vec<Seg> = self.defs[d].at.iter().map(|s| key(s)).collect();
        out.extend((0..tail).map(|_| key("items")));
        out.extend_from_slice(extra);
        out
    }

    fn marks(&mut self, v: Vertex) -> &mut Marks {
        match v {
            Vertex::Def(i) => &mut self.defs[i].marks,
            Vertex::Node(i) => &mut self.nodes[i].marks,
        }
    }

    /// Step 1. A badly named entry is reported and its content isn't examined.
    fn names(&mut self, data: &'a Map<String, Value>) {
        for (d, domain) in data {
            if d == "$schema" {
                continue;
            }
            if !is_name(d) {
                self.report(vec![key(d)], "bad_name", Map::new());
                continue;
            }
            let Some(models) = domain.as_object() else {
                self.report(vec![key(d)], "not_object", Map::new());
                continue;
            };
            for (m, fields) in models {
                if !is_name(m) {
                    self.report(vec![key(d), key(m)], "bad_name", Map::new());
                    continue;
                }
                if lookup(m).is_some() {
                    self.report(vec![key(d), key(m)], "type_name", Map::new());
                    continue;
                }
                let Some(fields) = fields.as_object() else {
                    self.report(vec![key(d), key(m)], "not_object", Map::new());
                    continue;
                };
                let mut node = Node {
                    name: format!("{d}:{m}"),
                    fields: HashMap::with_capacity(fields.len()),
                    list: Vec::with_capacity(fields.len()),
                    marks: Marks::default(),
                };
                for (f, raw) in fields {
                    if !is_name(f) {
                        self.report(vec![key(d), key(m), key(f)], "bad_name", Map::new());
                        continue;
                    }
                    let def = self.defs.len();
                    self.defs.push(Def::new(
                        [d.as_str(), m.as_str(), f.as_str()],
                        None,
                        raw,
                        d.as_str(),
                    ));
                    node.fields.insert(f.as_str(), def);
                    node.list.push(def);
                }
                self.by_name.insert(node.name.clone(), self.nodes.len());
                self.nodes.push(node);
            }
        }
        self.written = self.defs.len();
    }

    /// Step 2: a reference, read once in the domain where it's written. Sets its Ref, or reports and leaves it None.
    fn parse(&mut self, d: usize) {
        let raw = self.defs[d].raw;
        let written = match raw {
            Value::String(s) => s.as_str(),
            Value::Object(o) => match o.get("type") {
                Some(Value::String(t)) => t.as_str(),
                _ => {
                    let setting = params([("setting", "type".into())]);
                    return self.report(self.path(d, &[]), "missing_setting", setting);
                }
            },
            _ => return self.report(self.path(d, &[]), "bad_setting", Map::new()),
        };
        let Some((domain, name, field)) = parse_ref(written) else {
            return self.report(self.path(d, &[]), "unresolved", Map::new());
        };
        let home = format!("{}:{name}", domain.unwrap_or(self.defs[d].domain));
        let node = self.by_name.get(&home).copied();
        let reference = if let Some(field) = field {
            match node.and_then(|n| self.nodes[n].fields.get(field).copied()) {
                Some(target) => Ref::Field(target),
                None => return self.report(self.path(d, &[]), "unresolved", Map::new()),
            }
        } else if let (None, Some(kind)) = (domain, lookup(name)) {
            Ref::Type(kind, meta_of(kind))
        } else if let Some(n) = node {
            Ref::Model(n)
        } else if let (None, Some(m)) = (domain, get(name)) {
            let canonical = params([("canonical", m.name.into())]);
            return self.report(self.path(d, &[]), "alias", canonical);
        } else {
            return self.report(self.path(d, &[]), "unresolved", Map::new());
        };
        self.defs[d].reference = reference;
    }

    fn takes_items(&self, v: usize) -> bool {
        let d = &self.defs[v];
        if !d.raw.as_object().is_some_and(|o| o.contains_key("items")) {
            return false;
        }
        match d.reference {
            Ref::Type(_, meta) => meta.name == "array",
            Ref::Field(t) => {
                let t = &self.defs[t];
                let array = |f: usize| matches!(self.fields[f].kind, FieldKind::Array(_));
                t.marks.done && !t.failed && t.field.is_some_and(array)
            }
            _ => false,
        }
    }

    /// The next node the frame's node points to, or None once it has no more.
    fn successor(&mut self, frame: &mut Frame) -> Option<Vertex> {
        match frame.node {
            Vertex::Node(n) => {
                let next = self.nodes[n].list.get(frame.step).copied()?;
                frame.step += 1;
                Some(Vertex::Def(next))
            }
            Vertex::Def(v) => {
                while frame.step < 2 {
                    let step = frame.step;
                    frame.step += 1;
                    if step == 0 {
                        match self.defs[v].reference {
                            Ref::Model(n) => return Some(Vertex::Node(n)),
                            Ref::Field(t) => return Some(Vertex::Def(t)),
                            _ => {}
                        }
                    }
                    if step == 1 && self.takes_items(v) {
                        let (raw, domain) = (self.defs[v].raw, self.defs[v].domain);
                        let items = self.defs.len();
                        self.defs
                            .push(Def::new([""; 3], Some(v), &raw["items"], domain));
                        self.defs[v].items = Some(items);
                        self.parse(items);
                        return Some(Vertex::Def(items));
                    }
                }
                None
            }
        }
    }

    fn enter(
        &mut self,
        v: Vertex,
        counter: &mut usize,
        stack: &mut Vec<Vertex>,
        calls: &mut Vec<Frame>,
    ) {
        *counter += 1;
        let m = self.marks(v);
        (m.index, m.low, m.on_stack) = (*counter, *counter, true);
        stack.push(v);
        calls.push(Frame { node: v, step: 0 });
    }

    /// Step 3, resolution and cycles in one pass: Tarjan's strongly connected components over written fields and
    /// models, with an explicit stack. Edges: a model reference -> that model; a model -> its fields; a field
    /// reference -> the field it copies; an array field -> its `items`. A field's settings, `items` included, are
    /// read only once its type resolves, so `items` is an edge only when the resolved type is an array.
    /// Components finish dependencies-first, so each field resolves exactly once, after what it copies.
    fn resolve_all(&mut self) {
        let mut counter = 0;
        let mut stack: Vec<Vertex> = Vec::new();
        let mut calls: Vec<Frame> = Vec::new();
        for root in 0..self.written {
            if self.defs[root].marks.index != 0 {
                continue;
            }
            self.enter(Vertex::Def(root), &mut counter, &mut stack, &mut calls);
            while let Some(frame) = calls.last_mut() {
                let v = frame.node;
                if let Some(w) = self.successor(frame) {
                    let wm = *self.marks(w);
                    if wm.index == 0 {
                        self.enter(w, &mut counter, &mut stack, &mut calls);
                    } else if wm.on_stack {
                        let vm = self.marks(v);
                        vm.low = vm.low.min(wm.index);
                        vm.self_loop |= w == v;
                    }
                    continue;
                }
                calls.pop();
                let vm = *self.marks(v);
                if let Some(up) = calls.last() {
                    let um = self.marks(up.node);
                    um.low = um.low.min(vm.low);
                }
                if vm.low != vm.index {
                    continue;
                }
                let start = stack
                    .iter()
                    .rposition(|&u| u == v)
                    .expect("v is on the stack");
                let component = stack.split_off(start);
                for &u in &component {
                    let m = self.marks(u);
                    (m.on_stack, m.done) = (false, true);
                }
                if component.len() > 1 || vm.self_loop {
                    // A cycle: every field on it fails; the problem is reported at each reference on it.
                    for &u in &component {
                        if let Vertex::Def(d) = u {
                            self.defs[d].failed = true;
                            if !matches!(self.defs[d].reference, Ref::Type(..)) {
                                self.report(self.path(d, &[]), "cycle", Map::new());
                            }
                        }
                    }
                } else if let Vertex::Def(d) = v {
                    self.resolve(d);
                }
            }
        }
    }

    /// Builds the def's field from its resolved type plus the settings written next to it, or marks it failed.
    fn resolve(&mut self, v: usize) {
        let (reference, raw) = (self.defs[v].reference, self.defs[v].raw);
        // What the field starts from: its kind, settings (for a type), nullable and items.
        let (kind, base_settings, base_nullable, base_items) = match reference {
            Ref::None => {
                self.defs[v].failed = true;
                return;
            }
            Ref::Field(t) => match self.defs[t].field {
                Some(f) if !self.defs[t].failed => {
                    let f = &self.fields[f];
                    match &f.kind {
                        FieldKind::Type {
                            kind,
                            meta,
                            settings,
                        } => (
                            BaseKind::Type(*kind, meta),
                            Some(settings.clone()),
                            f.nullable,
                            None,
                        ),
                        &FieldKind::Model(n) => (BaseKind::Model(n), None, f.nullable, None),
                        &FieldKind::Array(items) => {
                            (BaseKind::Array, None, f.nullable, Some(items))
                        }
                    }
                }
                _ => {
                    self.defs[v].failed = true;
                    return;
                }
            },
            Ref::Model(n) => (BaseKind::Model(n), None, false, None),
            Ref::Type(_, meta) if meta.name == "array" => (BaseKind::Array, None, false, None),
            Ref::Type(kind, meta) => (BaseKind::Type(kind, meta), Some(Vec::new()), false, None),
        };
        let type_kind = match kind {
            BaseKind::Type(kind, _) => Some(kind),
            _ => None,
        };
        let empty = Map::new();
        let written = raw.as_object().unwrap_or(&empty);
        let mut settings = base_settings.clone();
        let (mut nullable, mut items) = (base_nullable, base_items);
        let mut failed = false;
        let before = self.problems.len();
        for k in written.keys() {
            let k = k.as_str();
            if k == "type" {
                continue;
            }
            if k == "nullable" {
                if let Some(Setting::Bool(b)) = self.check_setting(None, v, k) {
                    nullable = b;
                }
            } else if !allowed(kind, k) {
                self.report(self.path(v, &[key(k)]), "unknown_setting", Map::new());
            } else if k == "items" {
                let own = &self.defs[self.defs[v]
                    .items
                    .expect("an array's written items are visited")];
                if own.failed {
                    failed = true;
                } else {
                    items = own.field;
                }
            } else if let Some(value) = self.check_setting(type_kind, v, k) {
                let list = settings.as_mut().expect("only a type takes these settings");
                let name = rule(k).name;
                match list.iter_mut().find(|(n, _)| *n == name) {
                    Some(slot) => slot.1 = value,
                    None => list.push((name, value)),
                }
            }
        }
        // A written setting counts as present even when its value was refused, so it isn't also reported missing.
        let has = |key: &str| {
            written.contains_key(key)
                || base_settings
                    .as_ref()
                    .is_some_and(|s| s.iter().any(|(n, _)| *n == key))
        };
        if matches!(kind, BaseKind::Array) && items.is_none() && !has("items") {
            let setting = params([("setting", "items".into())]);
            self.report(self.path(v, &[]), "missing_setting", setting);
        }
        if matches!(kind, BaseKind::Type(_, meta) if meta.name == "enum") && !has("values") {
            let setting = params([("setting", "values".into())]);
            self.report(self.path(v, &[]), "missing_setting", setting);
        }
        if allowed(kind, "scale") && has("scale") && !has("precision") {
            let setting = params([("setting", "precision".into())]);
            self.report(self.path(v, &[key("scale")]), "missing_setting", setting);
        }
        if failed || self.problems.len() > before {
            self.defs[v].failed = true;
            return;
        }
        let field = match kind {
            BaseKind::Type(kind, meta) => FieldKind::Type {
                kind,
                meta,
                settings: settings.expect("a type has settings"),
            },
            BaseKind::Model(n) => FieldKind::Model(n),
            BaseKind::Array => FieldKind::Array(items.expect("an array has items")),
        };
        self.defs[v].field = Some(self.fields.len());
        self.fields.push(Field::new(field, nullable));
        // The model this field nests, through any `items` (an edge of the nesting graph), and how many `items`
        // levels lie on the way: each counts toward the depth limit like a model.
        let own_items = self.defs[v].items;
        let from = match (reference, kind) {
            (Ref::Model(_), _) => None,
            (_, BaseKind::Array) if items != base_items => own_items,
            (Ref::Field(t), _) => Some(t),
            _ => None,
        };
        self.defs[v].leaf = match reference {
            Ref::Model(n) => Some(n),
            _ => from.and_then(|f| self.defs[f].leaf),
        };
        self.defs[v].arrays = match from {
            None => 0,
            Some(f) if Some(f) == own_items => 1 + self.defs[f].arrays,
            Some(f) => self.defs[f].arrays,
        };
    }

    /// Checks the value the def's setting `k` holds against its PARAM_RULES rule: the value to keep (a list is
    /// copied, so the loaded models never alias the caller's data), or None after reporting it.
    fn check_setting(&mut self, kind: Option<Kind>, v: usize, k: &str) -> Option<Setting> {
        let rule = rule(k);
        let raw = self.defs[v].raw;
        let value = &raw[k];
        let accepted = match rule.kind {
            "boolean" => value.as_bool().map(Setting::Bool),
            "integer" => model_int(value)
                .filter(|&n| {
                    rule.minimum.unwrap_or(i64::MIN) <= n && n <= rule.maximum.unwrap_or(i64::MAX)
                })
                .map(Setting::Int),
            "array" => {
                let min = rule.min_items.unwrap_or(0);
                if let Some(list) = value.as_array().filter(|l| l.len() >= min) {
                    // Entries must be strings, unique, already clean (the type's check returns each unchanged), and
                    // within max_item_bytes as UTF-8.
                    let kind = kind.expect("a list setting belongs to a type");
                    let mut seen: HashSet<&str> = HashSet::with_capacity(list.len());
                    let mut ok = true;
                    for (i, entry) in list.iter().enumerate() {
                        let clean = entry.as_str().filter(|s| {
                            check(kind, entry).as_ref() == Some(entry)
                                && rule.max_item_bytes.map_or(true, |most| s.len() <= most)
                                && !seen.contains(s)
                        });
                        match clean {
                            Some(s) => {
                                seen.insert(s);
                            }
                            None => {
                                ok = false;
                                self.report(
                                    self.path(v, &[key(k), Seg::Index(i)]),
                                    "bad_setting",
                                    Map::new(),
                                );
                            }
                        }
                    }
                    let list: Vec<String> = list
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect();
                    let set = list.iter().cloned().collect();
                    return ok.then(|| Setting::List(Arc::new(Values { list, set })));
                }
                None
            }
            other => panic!("scalars: setting {k:?} has unknown kind {other:?}"),
        };
        if accepted.is_none() {
            self.report(self.path(v, &[key(k)]), "bad_setting", Map::new());
        }
        accepted
    }

    /// Step 4, nesting depth: the longest chain of levels, where each model and each `items` is one level (acyclic
    /// now: fields on cycles failed above). Post-order with an explicit stack. A model of plain fields has depth 1;
    /// a field adds its `items` levels plus the depth of the model it nests.
    fn depths(&mut self) {
        let count = self.nodes.len();
        let mut depth: Vec<Option<usize>> = vec![None; count];
        let field_depth = |d: &Def, depth: &[Option<usize>]| {
            d.arrays
                + d.leaf
                    .map_or(0, |l| depth[l].expect("the nested model is done"))
        };
        let mut open = vec![false; count];
        for start in 0..count {
            if depth[start].is_some() {
                continue;
            }
            let mut calls = vec![(start, 0, 1)]; // model, its next field, its depth so far
            open[start] = true;
            while let Some(&(model, i, d)) = calls.last() {
                let top = calls.len() - 1;
                if let Some(&def) = self.nodes[model].list.get(i) {
                    if let Some(leaf) = self.defs[def].leaf.filter(|&l| depth[l].is_none()) {
                        // Visit the nested model first, then come back to this field.
                        let name = &self.nodes[leaf].name;
                        assert!(
                            !open[leaf],
                            "scalars: model cycle through {name:?} survived resolution"
                        );
                        open[leaf] = true;
                        calls.push((leaf, 0, 1));
                        continue;
                    }
                    calls[top].1 += 1;
                    let def = &self.defs[def];
                    if !def.failed {
                        calls[top].2 = d.max(1 + field_depth(def, &depth));
                    }
                    continue;
                }
                open[model] = false;
                depth[model] = Some(d);
                calls.pop();
            }
        }
        // Reported once per too-deep chain: at the outermost too-deep model, on each field that makes it too deep.
        let depth: Vec<usize> = depth
            .into_iter()
            .map(|d| d.expect("every model is done"))
            .collect();
        let mut inner = vec![false; count];
        for m in (0..count).filter(|&m| depth[m] > MAX_DEPTH) {
            for &f in &self.nodes[m].list {
                if let Some(leaf) = self.defs[f].leaf.filter(|&l| depth[l] > MAX_DEPTH) {
                    inner[leaf] = true;
                }
            }
        }
        let mut deep = Vec::new();
        for m in (0..count).filter(|&m| depth[m] > MAX_DEPTH && !inner[m]) {
            for &f in &self.nodes[m].list {
                let def = &self.defs[f];
                if !def.failed && 1 + def.arrays + def.leaf.map_or(0, |l| depth[l]) > MAX_DEPTH {
                    deep.push(f);
                }
            }
        }
        for f in deep {
            let max = params([("max", MAX_DEPTH.into())]);
            self.report(self.path(f, &[]), "too_deep", max);
        }
    }
}

/// A location: a link to its parent, so a deep value costs nothing; the segments are built only for a problem.
struct Loc<'a> {
    up: Option<&'a Loc<'a>>,
    seg: At<'a>,
}

#[derive(Clone, Copy)]
enum At<'a> {
    Key(&'a str),
    Index(usize),
}

/// One validate or is_valid call. `first` stops the walk at the first problem.
struct Walker<'m> {
    arena: &'m Arena,
    problems: Vec<Located>,
    first: bool,
}

impl Model {
    /// The full "domain:model" name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Checks a payload. Returns the cleaned payload (declared keys only, normalized values, an int field as an
    /// integer, a missing nullable key as null), or a ModelError listing every problem, sorted.
    pub fn validate(&self, payload: &Value) -> Result<Value, ModelError> {
        let mut w = Walker {
            arena: &self.arena,
            problems: Vec::new(),
            first: false,
        };
        let out = w.root(self.index, payload);
        if w.problems.is_empty() {
            Ok(out)
        } else {
            Err(ModelError {
                problems: sorted(w.problems),
            })
        }
    }

    /// Whether `validate` would succeed. It stops at the first problem.
    pub fn is_valid(&self, payload: &Value) -> bool {
        let mut w = Walker {
            arena: &self.arena,
            problems: Vec::new(),
            first: true,
        };
        w.root(self.index, payload);
        w.problems.is_empty()
    }
}

impl<'m> Walker<'m> {
    fn report(
        &mut self,
        at: Option<&Loc<'_>>,
        code: &'static str,
        params: Map<String, Value>,
        message: Option<&str>,
    ) {
        let mut segments = Vec::new();
        let mut l = at;
        while let Some(here) = l {
            segments.push(match here.seg {
                At::Key(k) => key(k),
                At::Index(i) => Seg::Index(i),
            });
            l = here.up;
        }
        segments.reverse();
        self.problems.push(locate(segments, code, params, message));
    }

    fn stopped(&self) -> bool {
        self.first && !self.problems.is_empty()
    }

    fn root(&mut self, model: usize, payload: &Value) -> Value {
        match payload.as_object() {
            Some(obj) => self.model(model, obj, None),
            None => {
                self.report(None, "not_object", Map::new(), None);
                Value::Null
            }
        }
    }

    /// The cleaned object of the model with this index. Recursion follows the models, at most MAX_DEPTH levels,
    /// never the input.
    fn model(&mut self, model: usize, obj: &Map<String, Value>, at: Option<&Loc<'_>>) -> Value {
        let arena = self.arena;
        let body = &arena.models[model];
        let mut out = Map::new();
        let mut present = 0;
        for (name, f) in &body.entries {
            let value = obj.get(name);
            present += usize::from(value.is_some());
            let here = Loc {
                up: at,
                seg: At::Key(name),
            };
            let clean = self.walk(&arena.fields[*f], value, Some(&here));
            if self.stopped() {
                return Value::Null;
            }
            out.insert(name.clone(), clean);
        }
        // Every key is a declared field unless the payload has more keys than the declared ones it holds.
        if present < obj.len() {
            for k in obj.keys().filter(|k| !body.fields.contains_key(*k)) {
                let here = Loc {
                    up: at,
                    seg: At::Key(k),
                };
                self.report(Some(&here), "unknown_field", Map::new(), None);
                if self.stopped() {
                    return Value::Null;
                }
            }
        }
        Value::Object(out)
    }

    /// The cleaned `v` (None when the key is missing) at location `at`.
    fn walk(&mut self, field: &'m Field, v: Option<&Value>, at: Option<&Loc<'_>>) -> Value {
        let v = match v {
            None | Some(Value::Null) => {
                if !field.nullable {
                    self.report(at, "required", Map::new(), None);
                }
                return Value::Null;
            }
            Some(v) => v,
        };
        match field.kind {
            FieldKind::Type { kind, meta, .. } => {
                let Some(out) = check(kind, v) else {
                    let name = params([("type", meta.name.into())]);
                    self.report(at, "invalid", name, Some(meta.error));
                    return Value::Null;
                };
                if let Some(s) = out.as_str() {
                    self.limits(field, s, at);
                }
                out
            }
            FieldKind::Model(model) => match v.as_object() {
                Some(obj) => self.model(model, obj, at),
                None => {
                    self.report(at, "not_object", Map::new(), None);
                    Value::Null
                }
            },
            FieldKind::Array(items) => {
                let Some(list) = v.as_array() else {
                    self.report(at, "not_list", Map::new(), None);
                    return Value::Null;
                };
                let arena = self.arena;
                let items = &arena.fields[items];
                let mut out = Vec::with_capacity(list.len());
                for (i, x) in list.iter().enumerate() {
                    let here = Loc {
                        up: at,
                        seg: At::Index(i),
                    };
                    out.push(self.walk(items, Some(x), Some(&here)));
                    if self.stopped() {
                        return Value::Null;
                    }
                }
                Value::Array(out)
            }
        }
    }

    /// The settings checked on cleaned text, all of them, in order: length, values, precision.
    fn limits(&mut self, field: &Field, s: &str, at: Option<&Loc<'_>>) {
        if let Some(max) = field.length.filter(|&max| longer_than(s, max)) {
            self.report(at, "too_long", params([("max", max.into())]), None);
        }
        if let Some(values) = field.values.as_ref().filter(|v| !v.set.contains(s)) {
            let list = params([("values", values.list.clone().into())]);
            self.report(at, "not_allowed", list, None);
        }
        if let Some(precision) = field
            .precision
            .filter(|&p| !fits_numeric(s, p, field.scale))
        {
            let digits = params([
                ("precision", precision.into()),
                ("scale", field.scale.into()),
            ]);
            self.report(at, "too_many_digits", digits, None);
        }
    }
}

/// Rejects exactly what Postgres numeric(p, s) refuses, in one pass over the cleaned text `t`
/// (`-?[0-9]+(\.[0-9]+)?`): R = round(|value| * 10^s), half away from zero, must have at most p digits.
fn fits_numeric(t: &str, p: i64, s: i64) -> bool {
    let b = t.as_bytes();
    let start = usize::from(b.first() == Some(&b'-'));
    let dot = b[start..]
        .iter()
        .position(|&c| c == b'.')
        .map(|i| i + start);
    let int_len = dot.unwrap_or(b.len()) - start;
    let n = b.len() - start - usize::from(dot.is_some()); // digits, the point left out
    let digit = |i: usize| b[start + i + usize::from(dot.is_some() && i >= int_len)] - b'0';
    // Digits of the value R keeps (load bounds s to +-1000, so this can't overflow).
    let Ok(k) = usize::try_from(int_len as i64 + s) else {
        return true; // rounds to 0
    };
    let z = (0..n).find(|&i| digit(i) != 0).unwrap_or(n); // the first nonzero digit
    let kept = k.min(n);
    let width = if z < kept { k - z } else { 0 }; // digits of R before any carry (padding zeros count)
    let carry = k < n && digit(k) >= 5;
    let nines = k <= n && (z..kept).all(|i| digit(i) == 9); // padding zeros aren't 9s
    let width = width + usize::from(carry && nines);
    i64::try_from(width).is_ok_and(|w| w <= p)
}
