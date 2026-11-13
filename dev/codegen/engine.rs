// A catalogue: callers use a few of the types, so unused ones must not warn in their crate.
#![allow(dead_code)]

use regex::Regex;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt;
use std::ops::Deref;
use std::sync::{LazyLock, OnceLock};

/// What every type carries, copied from dist/scalars.json. The examples stay in the JSON: Rust has no type to
/// hold them without a JSON crate.
#[derive(Debug)]
pub struct Meta {
    pub name: &'static str,
    pub label: &'static str,
    pub hint: &'static str,
    pub error: &'static str,
    pub details: &'static str,
    pub level: &'static str,
    pub primitive: &'static str,
    pub aliases: &'static [&'static str],
}

/// A value that failed a type's rule. It displays as the type's error text.
#[derive(Debug, Clone, Copy)]
pub struct ScalarError {
    pub scalar: &'static Meta,
}

impl fmt::Display for ScalarError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.scalar.error)
    }
}

impl std::error::Error for ScalarError {}

/// One normalize step. The generator writes each type's steps as these variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Trim,
    Lowercase,
    Uppercase,
    RemoveSpaces,
    RemoveHyphens,
}

/// A type whose values are text. Its regex is compiled on first use.
#[derive(Debug)]
pub struct Text {
    meta: Meta,
    steps: &'static [Step],
    pattern: Option<&'static str>,
    min_len: usize, // shortest length in code points
    max_len: usize, // longest length in code points, usize::MAX when unbounded
    re: OnceLock<Regex>,
}

impl Text {
    /// A text type with these steps, pattern and lengths in code points (`usize::MAX` for no limit).
    pub const fn new(
        meta: Meta,
        steps: &'static [Step],
        pattern: Option<&'static str>,
        min_len: usize,
        max_len: usize,
    ) -> Text {
        Text {
            meta,
            steps,
            pattern,
            min_len,
            max_len,
            re: OnceLock::new(),
        }
    }

    /// The normalize steps, in order.
    pub fn steps(&self) -> &'static [Step] {
        self.steps
    }

    /// Applies the type's normalize steps in order. Borrows `s` (or a slice of it) when nothing changed.
    pub fn normalize<'a>(&self, s: &'a str) -> Cow<'a, str> {
        self.steps
            .iter()
            .fold(Cow::Borrowed(s), |s, &step| apply(step, s))
    }

    /// Normalizes `s`, then checks length and pattern. Returns the clean text, borrowed when nothing changed
    /// beyond trimming, or the type's error.
    pub fn validate<'a>(&'static self, s: &'a str) -> Result<Cow<'a, str>, ScalarError> {
        self.check(s).ok_or(ScalarError { scalar: &self.meta })
    }

    /// Whether `validate` would succeed. It never builds an error.
    pub fn is_valid(&self, s: &str) -> bool {
        self.check(s).is_some()
    }

    fn check<'a>(&self, s: &'a str) -> Option<Cow<'a, str>> {
        // Text must be Unicode scalar values (WHATWG USVString, RFC 7493). A `&str` is always valid UTF-8 with no
        // surrogates, so there is nothing to check here; the other engines check it once trimmed.
        let mut s = Cow::Borrowed(s);
        let mut gated = false;
        for &step in self.steps {
            // Text already too long is refused before case mapping copies it. The gate waits for the first case
            // step because case mapping never shortens text, but RemoveSpaces and RemoveHyphens do.
            if !gated && matches!(step, Step::Lowercase | Step::Uppercase) {
                gated = true;
                if longer_than(&s, self.max_len) {
                    return None;
                }
            }
            s = apply(step, s);
        }
        if longer_than(&s, self.max_len) || shorter_than(&s, self.min_len) {
            return None;
        }
        if let Some(pattern) = self.pattern {
            let re = self
                .re
                .get_or_init(|| Regex::new(pattern).expect("the build checks every pattern"));
            if !re.is_match(&s) {
                return None;
            }
        }
        Some(s)
    }
}

/// A type whose values are whole numbers.
#[derive(Debug)]
pub struct Int {
    meta: Meta,
    minimum: i64,
    maximum: i64,
}

impl Int {
    /// Checks the bounds. Returns `n`, or the type's error.
    pub fn validate(&'static self, n: i64) -> Result<i64, ScalarError> {
        if self.is_valid(n) {
            Ok(n)
        } else {
            Err(ScalarError { scalar: &self.meta })
        }
    }

    /// Whether `validate` would succeed. It never builds an error.
    pub fn is_valid(&self, n: i64) -> bool {
        (self.minimum..=self.maximum).contains(&n)
    }
}

/// A type whose values are finite numbers.
#[derive(Debug)]
pub struct Number {
    meta: Meta,
    minimum: f64,
    maximum: f64,
}

impl Number {
    /// Checks that `f` is finite and within the bounds. Returns `f`, or the type's error.
    pub fn validate(&'static self, f: f64) -> Result<f64, ScalarError> {
        if self.is_valid(f) {
            Ok(f)
        } else {
            Err(ScalarError { scalar: &self.meta })
        }
    }

    /// Whether `validate` would succeed. It never builds an error.
    pub fn is_valid(&self, f: f64) -> bool {
        f.is_finite() && f >= self.minimum && f <= self.maximum
    }
}

/// A type whose values are true or false.
#[derive(Debug)]
pub struct Bool {
    meta: Meta,
}

impl Bool {
    /// Returns `b`: every bool is valid.
    pub fn validate(&'static self, b: bool) -> Result<bool, ScalarError> {
        Ok(b)
    }

    /// Whether `validate` would succeed, which it always does.
    pub fn is_valid(&self, _: bool) -> bool {
        true
    }
}

macro_rules! deref_meta {
    ($($kind:ty),*) => {$(
        impl Deref for $kind {
            type Target = Meta;
            fn deref(&self) -> &Meta {
                &self.meta
            }
        }
    )*};
}

deref_meta!(Text, Int, Number, Bool);

/// A typed scalar, as `lookup` returns it. Object, array and any types are only their `Meta`.
#[derive(Debug, Clone, Copy)]
pub enum Kind {
    Text(&'static Text),
    Int(&'static Int),
    Number(&'static Number),
    Bool(&'static Bool),
    Shape(&'static Meta),
}

/// Unicode White_Space, written out: the same set as the trim step in every other language.
const WS: &[char] = &[
    '\u{9}', '\u{a}', '\u{b}', '\u{c}', '\u{d}', ' ', '\u{85}', '\u{a0}', '\u{1680}', '\u{2000}',
    '\u{2001}', '\u{2002}', '\u{2003}', '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}',
    '\u{2009}', '\u{200a}', '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}',
];

fn apply(step: Step, s: Cow<'_, str>) -> Cow<'_, str> {
    match step {
        Step::Trim => trim(s),
        Step::Lowercase => replace_if(s, |s| {
            map_case(
                s,
                u8::is_ascii_uppercase,
                str::to_ascii_lowercase,
                str::to_lowercase,
            )
        }),
        Step::Uppercase => replace_if(s, |s| {
            map_case(
                s,
                u8::is_ascii_lowercase,
                str::to_ascii_uppercase,
                str::to_uppercase,
            )
        }),
        Step::RemoveSpaces => replace_if(s, |s| s.contains(' ').then(|| s.replace(' ', ""))),
        Step::RemoveHyphens => replace_if(s, |s| s.contains('-').then(|| s.replace('-', ""))),
    }
}

fn trim(s: Cow<'_, str>) -> Cow<'_, str> {
    match s {
        Cow::Borrowed(b) => Cow::Borrowed(b.trim_matches(WS)),
        Cow::Owned(o) => {
            let t = o.trim_matches(WS);
            if t.len() == o.len() {
                Cow::Owned(o)
            } else {
                Cow::Owned(t.to_owned())
            }
        }
    }
}

/// `s`, or the text `change` returns when it changes something.
fn replace_if<'a>(s: Cow<'a, str>, change: impl FnOnce(&str) -> Option<String>) -> Cow<'a, str> {
    match change(&s) {
        Some(new) => Cow::Owned(new),
        None => s,
    }
}

/// The case-mapped text, or None when it equals `s`. All-ASCII text is mapped byte by byte, which gives the same
/// result as the full mapping, and copies only when some byte `changes`. Other text takes the full Unicode
/// mapping ("ß" -> "SS", final sigma), kept only when it differs.
fn map_case(
    s: &str,
    changes: fn(&u8) -> bool,
    ascii: fn(&str) -> String,
    full: fn(&str) -> String,
) -> Option<String> {
    if s.is_ascii() {
        return s.bytes().any(|b| changes(&b)).then(|| ascii(s));
    }
    Some(full(s)).filter(|t| t != s)
}

/// Whether `s` has more than `limit` code points. A code point is 1 to 4 bytes, so the byte length settles most
/// cases; otherwise it counts, which is linear, allocates nothing, and stops past the limit.
fn longer_than(s: &str, limit: usize) -> bool {
    if s.len() <= limit {
        return false;
    }
    if s.len() / 4 > limit {
        return true;
    }
    s.chars().nth(limit).is_some()
}

/// Whether `s` has fewer than `limit` code points, settled by the byte length when it can be.
fn shorter_than(s: &str, limit: usize) -> bool {
    if s.len() < limit {
        return true;
    }
    if s.len() / 4 >= limit {
        return false;
    }
    s.chars().nth(limit - 1).is_none()
}

/// Every name and alias, built on the first `get`. A name wins over another type's alias.
static INDEX: LazyLock<HashMap<&'static str, &'static Meta>> = LazyLock::new(|| {
    let mut index = HashMap::with_capacity(2 * ALL.len());
    for &m in ALL {
        index.insert(m.name, m);
    }
    for &m in ALL {
        for &alias in m.aliases {
            index.entry(alias).or_insert(m);
        }
    }
    index
});

/// Finds a type by name or alias; spacing, hyphens and case are forgiven.
pub fn get(word: &str) -> Option<&'static Meta> {
    if let Some(&m) = INDEX.get(word) {
        return Some(m);
    }
    let key = clean(word);
    if key == word {
        return None;
    }
    INDEX.get(&*key).copied()
}

/// The lookup key: trim, lowercase, each run of spaces and hyphens becomes one underscore. One pass, no regex,
/// and one copy at most for ASCII words.
fn clean(word: &str) -> Cow<'_, str> {
    let s = trim(Cow::Borrowed(word));
    if !s.contains([' ', '-']) {
        return apply(Step::Lowercase, s);
    }
    // Non-ASCII text is lowercased first; the loop below then finds no upper-case ASCII left.
    let s = if s.is_ascii() {
        s
    } else {
        apply(Step::Lowercase, s)
    };
    let mut out = String::with_capacity(s.len());
    let mut gap = false;
    for c in s.chars() {
        if c == ' ' || c == '-' {
            gap = true;
            continue;
        }
        if gap {
            out.push('_');
            gap = false;
        }
        out.push(c.to_ascii_lowercase());
    }
    if gap {
        out.push('_');
    }
    Cow::Owned(out)
}
