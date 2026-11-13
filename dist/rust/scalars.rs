// Code generated from dist/scalars.json by dev/codegen/rust.mjs. DO NOT EDIT.
// scalars.rs, catalogue version 0.3.0. Run `npm run build` in dev/ to regenerate.
// Requires Rust >= 1.80 (edition 2021) and the regex crate (tested with regex 1.13.1 on Rust 1.97.0).

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

/// Anything: Any value at all.
///
/// Deliberately unconstrained: passthrough payloads and escape hatches. Reach for it last - every consumer inherits the validation burden.
pub static ANY: Meta = Meta {
    name: "any",
    label: "Anything",
    hint: "Any value at all",
    error: "Any value is allowed here.",
    details: "Deliberately unconstrained: passthrough payloads and escape hatches. Reach for it last - every consumer inherits the validation burden.",
    level: "core",
    primitive: "any",
    aliases: &["json", "jsonb"],
};

/// List: Several values in order.
///
/// An ordered JSON list: tags, attachments, embedded collections. Prefer a separate table or repeated field when elements need identity or independent querying.
pub static ARRAY: Meta = Meta {
    name: "array",
    label: "List",
    hint: "Several values in order",
    error: "Please give a list of values.",
    details: "An ordered JSON list: tags, attachments, embedded collections. Prefer a separate table or repeated field when elements need identity or independent querying.",
    level: "core",
    primitive: "array",
    aliases: &["list"],
};

/// Base64 data: Bytes written as letters, + and /.
///
/// Binary content as standard base64 text: payloads embedded in JSON. Prefer binary for raw transport and base64url when the value travels in URLs or filenames.
pub static BASE64: Text = Text {
    meta: Meta {
        name: "base64",
        label: "Base64 data",
        hint: "Bytes written as letters, + and /",
        error: "Please use base64 with = padding, like SGVsbG8gd29ybGQ=.",
        details: "Binary content as standard base64 text: payloads embedded in JSON. Prefer binary for raw transport and base64url when the value travels in URLs or filenames.",
        level: "advanced",
        primitive: "binary",
        aliases: &["b64"],
    },
    steps: &[],
    pattern: Some(r"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"),
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// URL-safe base64: Bytes written as letters, - and _.
///
/// URL-safe base64 (no + or /): tokens and digests placed in URLs. Prefer base64 for ordinary embedded payloads.
pub static BASE64URL: Text = Text {
    meta: Meta {
        name: "base64url",
        label: "URL-safe base64",
        hint: "Bytes written as letters, - and _",
        error: "Please use letters, digits, - and _, like SGVsbG8gd29ybGQ.",
        details: "URL-safe base64 (no + or /): tokens and digests placed in URLs. Prefer base64 for ordinary embedded payloads.",
        level: "advanced",
        primitive: "binary",
        aliases: &["b64url"],
    },
    steps: &[],
    pattern: Some(r"^[A-Za-z0-9_-]*={0,2}$"),
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Bank code (BIC): 8 or 11 capital letters and digits.
///
/// A BIC/SWIFT code identifying a bank for payment routing. Routing, not identity - prefer lei to identify the legal entity itself.
pub static BIC: Text = Text {
    meta: Meta {
        name: "bic",
        label: "Bank code (BIC)",
        hint: "8 or 11 capital letters and digits",
        error: "Please use 8 or 11 capital letters and digits, like DEUTDEFF500.",
        details: "A BIC/SWIFT code identifying a bank for payment routing. Routing, not identity - prefer lei to identify the legal entity itself.",
        level: "domain",
        primitive: "string",
        aliases: &["swift", "swift_code"],
    },
    steps: &[Step::Trim, Step::Uppercase],
    pattern: Some(r"^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$"),
    min_len: 8,
    max_len: 11,
    re: OnceLock::new(),
};

/// File: Upload a file.
///
/// Raw bytes: file uploads, blobs, digests. Inside JSON they travel as standard base64 (RFC 4648); storage keeps the decoded bytes.
pub static BINARY: Text = Text {
    meta: Meta {
        name: "binary",
        label: "File",
        hint: "Upload a file",
        error: "Please choose a file.",
        details: "Raw bytes: file uploads, blobs, digests. Inside JSON they travel as standard base64 (RFC 4648); storage keeps the decoded bytes.",
        level: "core",
        primitive: "binary",
        aliases: &["bytes", "file", "blob"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Yes or no: Pick yes or no.
///
/// A true/false fact: flags, toggles, switches. Prefer enum if a third state could ever appear, rather than a nullable boolean.
pub static BOOLEAN: Bool = Bool {
    meta: Meta {
        name: "boolean",
        label: "Yes or no",
        hint: "Pick yes or no",
        error: "Please pick yes or no.",
        details: "A true/false fact: flags, toggles, switches. Prefer enum if a third state could ever appear, rather than a nullable boolean.",
        level: "core",
        primitive: "boolean",
        aliases: &["bool", "yes_no"],
    },
};

/// Single character: Exactly one character.
///
/// Exactly one character: a grade, flag, or single-letter code. Prefer string for anything that can grow, and enum when the values form a closed set.
pub static CHAR: Text = Text {
    meta: Meta {
        name: "char",
        label: "Single character",
        hint: "Exactly one character",
        error: "Please type exactly one character, like A.",
        details: "Exactly one character: a grade, flag, or single-letter code. Prefer string for anything that can grow, and enum when the values form a closed set.",
        level: "advanced",
        primitive: "string",
        aliases: &["character", "letter"],
    },
    steps: &[],
    pattern: None,
    min_len: 1,
    max_len: 1,
    re: OnceLock::new(),
};

/// Network range: An address and a size, like 192.0.2.0/24.
///
/// A network prefix of either IP family: allowlists, routing rules. Prefer ipv4 or ipv6 for a single host.
pub static CIDR: Text = Text {
    meta: Meta {
        name: "cidr",
        label: "Network range",
        hint: "An address and a size, like 192.0.2.0/24",
        error: "Please use an address, a slash and a size, like 192.0.2.0/24.",
        details: "A network prefix of either IP family: allowlists, routing rules. Prefer ipv4 or ipv6 for a single host.",
        level: "core",
        primitive: "string",
        aliases: &["subnet", "network"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Color: Pick a color.
///
/// An sRGB color as lowercase #rrggbb or #rrggbbaa - the exact form <input type="color"> produces, so it round-trips through forms, JSON, JS/TS and SQL unchanged. Prefer css_color only for wide-gamut or design-token values.
pub static COLOR: Text = Text {
    meta: Meta {
        name: "color",
        label: "Color",
        hint: "Pick a color",
        error: "Please use # and 6 small hex digits, like #1a2b3c.",
        details: "An sRGB color as lowercase #rrggbb or #rrggbbaa - the exact form <input type=\"color\"> produces, so it round-trips through forms, JSON, JS/TS and SQL unchanged. Prefer css_color only for wide-gamut or design-token values.",
        level: "core",
        primitive: "string",
        aliases: &["colour", "rgb", "hex_color"],
    },
    steps: &[Step::Trim, Step::Lowercase],
    pattern: Some(r"^#[0-9a-f]{6}([0-9a-f]{2})?$"),
    min_len: 7,
    max_len: 9,
    re: OnceLock::new(),
};

/// Markdown: Text with # headings and **bold**.
///
/// Markdown (CommonMark) source: user-authored rich content stored as written. Prefer html for already-rendered markup and text for plain prose.
pub static COMMONMARK: Text = Text {
    meta: Meta {
        name: "commonmark",
        label: "Markdown",
        hint: "Text with # headings and **bold**",
        error: "Please type some Markdown text.",
        details: "Markdown (CommonMark) source: user-authored rich content stored as written. Prefer html for already-rendered markup and text for plain prose.",
        level: "advanced",
        primitive: "text",
        aliases: &["markdown", "md"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Country: Pick a country.
///
/// An ISO 3166-1 alpha-2 country code (US): the interchange default for countries.
pub static COUNTRY: Text = Text {
    meta: Meta {
        name: "country",
        label: "Country",
        hint: "Pick a country",
        error: "Please use the 2-letter country code, like US.",
        details: "An ISO 3166-1 alpha-2 country code (US): the interchange default for countries.",
        level: "core",
        primitive: "string",
        aliases: &["country_code"],
    },
    steps: &[Step::Trim, Step::Uppercase],
    pattern: Some(r"^[A-Z]{2}$"),
    min_len: 2,
    max_len: 2,
    re: OnceLock::new(),
};

/// Country (3-letter): Three capital letters, like USA.
///
/// An ISO 3166-1 alpha-3 country code (USA): feeds and standards that require three letters. Prefer country (alpha-2) as the default.
pub static COUNTRY_ALPHA3: Text = Text {
    meta: Meta {
        name: "country_alpha3",
        label: "Country (3-letter)",
        hint: "Three capital letters, like USA",
        error: "Please use the 3-letter country code, like USA.",
        details: "An ISO 3166-1 alpha-3 country code (USA): feeds and standards that require three letters. Prefer country (alpha-2) as the default.",
        level: "advanced",
        primitive: "string",
        aliases: &["country_code3"],
    },
    steps: &[Step::Trim, Step::Uppercase],
    pattern: Some(r"^[A-Z]{3}$"),
    min_len: 3,
    max_len: 3,
    re: OnceLock::new(),
};

/// Schedule: Five fields, like 0 3 * * *.
///
/// A POSIX crontab expression (0 3 * * *): recurring schedules. Prefer duration for simple intervals and date_time for one-shot schedules.
pub static CRON: Text = Text {
    meta: Meta {
        name: "cron",
        label: "Schedule",
        hint: "Five fields, like 0 3 * * *",
        error: "Please use five fields, like 0 3 * * * (3 AM daily).",
        details: "A POSIX crontab expression (0 3 * * *): recurring schedules. Prefer duration for simple intervals and date_time for one-shot schedules.",
        level: "advanced",
        primitive: "string",
        aliases: &["cron_expression", "crontab"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// CSS color: Any CSS color, like oklch(70% 0.15 250).
///
/// Any single CSS Color 4 value: hex, named, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() or color(display-p3 ...). The pattern only checks the shape; validate for real with CSS.supports('color', value). Level 5 expressions (color-mix(), relative colors, light-dark(), var()) are computed in context and are deliberately not data.
pub static CSS_COLOR: Text = Text {
    meta: Meta {
        name: "css_color",
        label: "CSS color",
        hint: "Any CSS color, like oklch(70% 0.15 250)",
        error: "That doesn't look like a CSS color. Try oklch(70% 0.15 250).",
        details: "Any single CSS Color 4 value: hex, named, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() or color(display-p3 ...). The pattern only checks the shape; validate for real with CSS.supports('color', value). Level 5 expressions (color-mix(), relative colors, light-dark(), var()) are computed in context and are deliberately not data.",
        level: "advanced",
        primitive: "string",
        aliases: &["css_colour"],
    },
    steps: &[],
    pattern: Some(
        r"^(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|[a-zA-Z]+|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\))$",
    ),
    min_len: 1,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Currency: Pick a currency, like USD or EUR.
///
/// An ISO 4217 currency code (USD): pair it with a decimal amount to represent money. Never derive it from country or locale - people transact across borders.
pub static CURRENCY: Text = Text {
    meta: Meta {
        name: "currency",
        label: "Currency",
        hint: "Pick a currency, like USD or EUR",
        error: "Please use the 3-letter currency code, like USD.",
        details: "An ISO 4217 currency code (USD): pair it with a decimal amount to represent money. Never derive it from country or locale - people transact across borders.",
        level: "core",
        primitive: "string",
        aliases: &["currency_code"],
    },
    steps: &[Step::Trim, Step::Uppercase],
    pattern: Some(r"^[A-Z]{3}$"),
    min_len: 3,
    max_len: 3,
    re: OnceLock::new(),
};

/// Date: Year-month-day, like 2026-08-16.
///
/// A calendar date with no time or zone: birthdays, due dates, effective dates. Prefer date_time for an actual instant.
pub static DATE: Text = Text {
    meta: Meta {
        name: "date",
        label: "Date",
        hint: "Year-month-day, like 2026-08-16",
        error: "Please use year-month-day, like 2026-08-16.",
        details: "A calendar date with no time or zone: birthdays, due dates, effective dates. Prefer date_time for an actual instant.",
        level: "core",
        primitive: "date",
        aliases: &["day"],
    },
    steps: &[],
    pattern: Some(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"),
    min_len: 10,
    max_len: 10,
    re: OnceLock::new(),
};

/// Date and time: An exact moment, with its time zone.
///
/// An absolute instant with offset - the default for created/updated timestamps and anything that really happened. Prefer date_time_local only for deliberately floating times.
pub static DATE_TIME: Text = Text {
    meta: Meta {
        name: "date_time",
        label: "Date and time",
        hint: "An exact moment, with its time zone",
        error: "Please use date, T, time and zone, like 2026-08-16T14:30:00Z.",
        details: "An absolute instant with offset - the default for created/updated timestamps and anything that really happened. Prefer date_time_local only for deliberately floating times.",
        level: "core",
        primitive: "date_time",
        aliases: &["datetime", "timestamp", "instant"],
    },
    steps: &[],
    pattern: Some(
        r"^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$",
    ),
    min_len: 20,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Local date and time: A date and time on the clock, no zone.
///
/// A date and time with no offset: floating events like 'Jan 1 at midnight, wherever the user is'. Prefer date_time for real instants; pair with timezone to reconstruct one.
pub static DATE_TIME_LOCAL: Text = Text {
    meta: Meta {
        name: "date_time_local",
        label: "Local date and time",
        hint: "A date and time on the clock, no zone",
        error: "Please use date, T and time, like 2026-08-16T14:30:00.",
        details: "A date and time with no offset: floating events like 'Jan 1 at midnight, wherever the user is'. Prefer date_time for real instants; pair with timezone to reconstruct one.",
        level: "core",
        primitive: "date_time_local",
        aliases: &["local_datetime", "wall_time"],
    },
    steps: &[],
    pattern: Some(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?$"),
    min_len: 19,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Exact number: Exact amounts like money: 1234.56.
///
/// Exact decimal value represented as text. Use for money, rates, quantities, and other values where decimal precision must be preserved. Precision and scale are determined by the target system.
pub static DECIMAL: Text = Text {
    meta: Meta {
        name: "decimal",
        label: "Exact number",
        hint: "Exact amounts like money: 1234.56",
        error: "Please use digits and one dot, like 1234.56.",
        details: "Exact decimal value represented as text. Use for money, rates, quantities, and other values where decimal precision must be preserved. Precision and scale are determined by the target system.",
        level: "core",
        primitive: "decimal",
        aliases: &["money", "numeric"],
    },
    steps: &[],
    pattern: Some(r"^-?[0-9]+(\.[0-9]+)?$"),
    min_len: 1,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Very exact number: Up to 34 significant digits.
///
/// IEEE 754 decimal128: exact decimals with a defined 34-significant-digit width, for interchange with fixed-width financial systems. Prefer decimal when arbitrary precision is acceptable.
pub static DECIMAL128: Text = Text {
    meta: Meta {
        name: "decimal128",
        label: "Very exact number",
        hint: "Up to 34 significant digits",
        error: "Please use digits and one dot, like 1234.567890123456789012345678901234.",
        details: "IEEE 754 decimal128: exact decimals with a defined 34-significant-digit width, for interchange with fixed-width financial systems. Prefer decimal when arbitrary precision is acceptable.",
        level: "advanced",
        primitive: "decimal",
        aliases: &["dec128"],
    },
    steps: &[],
    pattern: Some(r"^-?[0-9]+(\.[0-9]+)?$"),
    min_len: 1,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// DOI: A paper ID, like 10.1000/182.
///
/// A Digital Object Identifier: citations to papers, datasets, publications. Prefer uri only for links that are not registered DOIs.
pub static DOI: Text = Text {
    meta: Meta {
        name: "doi",
        label: "DOI",
        hint: "A paper ID, like 10.1000/182",
        error: "Please start with 10., like 10.1000/182.",
        details: "A Digital Object Identifier: citations to papers, datasets, publications. Prefer uri only for links that are not registered DOIs.",
        level: "domain",
        primitive: "string",
        aliases: &["doi_name"],
    },
    steps: &[],
    pattern: Some(r"^10\.[0-9]{4,9}/[-._;()/:A-Za-z0-9]+$"),
    min_len: 9,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Safe whole number: Whole number JavaScript keeps exact.
///
/// Integers exactly representable in an IEEE double (up to 2^53-1): safe as a plain number for every JSON consumer, including JavaScript. Prefer int64 when the full 64-bit range matters and consumers accept strings.
pub static DOUBLE_INT: Int = Int {
    meta: Meta {
        name: "double_int",
        label: "Safe whole number",
        hint: "Whole number JavaScript keeps exact",
        error: "Please use a whole number between ±9007199254740991.",
        details: "Integers exactly representable in an IEEE double (up to 2^53-1): safe as a plain number for every JSON consumer, including JavaScript. Prefer int64 when the full 64-bit range matters and consumers accept strings.",
        level: "advanced",
        primitive: "int32",
        aliases: &["safe_integer"],
    },
    minimum: -9007199254740991,
    maximum: 9007199254740991,
};

/// Length of time: How long something lasts, like P3DT4H30M.
///
/// A span of time (ISO 8601): timeouts, retention windows, billing periods. A length, not a position - prefer date_time for points in time.
pub static DURATION: Text = Text {
    meta: Meta {
        name: "duration",
        label: "Length of time",
        hint: "How long something lasts, like P3DT4H30M",
        error: "Please write it like P3DT4H30M (3 days, 4 hours, 30 minutes).",
        details: "A span of time (ISO 8601): timeouts, retention windows, billing periods. A length, not a position - prefer date_time for points in time.",
        level: "core",
        primitive: "duration",
        aliases: &["interval", "timespan"],
    },
    steps: &[],
    pattern: Some(
        r"^P(([0-9]+Y([0-9]+M)?([0-9]+W)?([0-9]+D)?|[0-9]+M([0-9]+W)?([0-9]+D)?|[0-9]+W([0-9]+D)?|[0-9]+D)(T([0-9]+H([0-9]+M)?([0-9]+(\.[0-9]+)?S)?|[0-9]+M([0-9]+(\.[0-9]+)?S)?|[0-9]+(\.[0-9]+)?S))?|T([0-9]+H([0-9]+M)?([0-9]+(\.[0-9]+)?S)?|[0-9]+M([0-9]+(\.[0-9]+)?S)?|[0-9]+(\.[0-9]+)?S))$",
    ),
    min_len: 3,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Email address: Like name@example.com.
///
/// An email address: login and contact fields. Accepting internationalized mailboxes is a validation choice, not a separate type.
pub static EMAIL: Text = Text {
    meta: Meta {
        name: "email",
        label: "Email address",
        hint: "Like name@example.com",
        error: "That email looks wrong. Try user@example.com.",
        details: "An email address: login and contact fields. Accepting internationalized mailboxes is a validation choice, not a separate type.",
        level: "core",
        primitive: "string",
        aliases: &["email_address", "mail"],
    },
    steps: &[Step::Trim],
    pattern: Some(r"^[^@\x09-\x0D\x20]+@[^@\x09-\x0D\x20][^.@\x09-\x0D\x20]*\.[^@\x09-\x0D\x20]+$"),
    min_len: 5,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Choice: Pick one option from a fixed list.
///
/// One value from a closed, named set: statuses, roles, kinds. Prefer string for open-ended sets and boolean for exactly two states.
pub static ENUM: Text = Text {
    meta: Meta {
        name: "enum",
        label: "Choice",
        hint: "Pick one option from a fixed list",
        error: "Please pick one of the options.",
        details: "One value from a closed, named set: statuses, roles, kinds. Prefer string for open-ended sets and boolean for exactly two states.",
        level: "core",
        primitive: "string",
        aliases: &["choice", "select"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Small-precision number: Any number, stored with ~7 digits.
///
/// Single-precision floats: bulk sensor readings or ML weights where memory beats precision. Prefer float64 as the default floating-point type.
pub static FLOAT32: Number = Number {
    meta: Meta {
        name: "float32",
        label: "Small-precision number",
        hint: "Any number, stored with ~7 digits",
        error: "Please type a number, like 3.14.",
        details: "Single-precision floats: bulk sensor readings or ML weights where memory beats precision. Prefer float64 as the default floating-point type.",
        level: "advanced",
        primitive: "float64",
        aliases: &["real", "single"],
    },
    minimum: f64::MIN,
    maximum: f64::MAX,
};

/// Number: Any number, like 3.14.
///
/// The default floating-point number: measurements, ratios, scores. Never money or exact quantities - use decimal for anything where digits must be exact.
pub static FLOAT64: Number = Number {
    meta: Meta {
        name: "float64",
        label: "Number",
        hint: "Any number, like 3.14",
        error: "Please type a number, like 3.14.",
        details: "The default floating-point number: measurements, ratios, scores. Never money or exact quantities - use decimal for anything where digits must be exact.",
        level: "core",
        primitive: "float64",
        aliases: &["number", "float", "double"],
    },
    minimum: f64::MIN,
    maximum: f64::MAX,
};

/// Barcode number: 8, 12, 13 or 14 digits.
///
/// A GS1 GTIN (UPC/EAN family) identifying a retail product. Prefer isbn when the domain is specifically books.
pub static GTIN: Text = Text {
    meta: Meta {
        name: "gtin",
        label: "Barcode number",
        hint: "8, 12, 13 or 14 digits",
        error: "Please use 8, 12, 13 or 14 digits, like 0614141000036.",
        details: "A GS1 GTIN (UPC/EAN family) identifying a retail product. Prefer isbn when the domain is specifically books.",
        level: "domain",
        primitive: "string",
        aliases: &["barcode", "ean", "upc"],
    },
    steps: &[Step::RemoveSpaces, Step::RemoveHyphens],
    pattern: Some(r"^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$"),
    min_len: 8,
    max_len: 14,
    re: OnceLock::new(),
};

/// Website name: Like api.example.com.
///
/// A DNS hostname: servers and endpoints without scheme or path. Prefer uri when a full locator travels; internationalized names are a validation choice.
pub static HOSTNAME: Text = Text {
    meta: Meta {
        name: "hostname",
        label: "Website name",
        hint: "Like api.example.com",
        error: "Please use letters, digits, dots and dashes, like api.example.com.",
        details: "A DNS hostname: servers and endpoints without scheme or path. Prefer uri when a full locator travels; internationalized names are a validation choice.",
        level: "core",
        primitive: "string",
        aliases: &["domain", "domain_name", "host"],
    },
    steps: &[Step::Trim, Step::Lowercase],
    pattern: Some(
        r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$",
    ),
    min_len: 1,
    max_len: 253,
    re: OnceLock::new(),
};

/// HTML: Web page markup, like <p>Hello</p>.
///
/// HTML markup stored as-is: rendered output, email bodies. Sanitize on the way in; prefer commonmark when users author the content.
pub static HTML: Text = Text {
    meta: Meta {
        name: "html",
        label: "HTML",
        hint: "Web page markup, like <p>Hello</p>",
        error: "Please type some HTML.",
        details: "HTML markup stored as-is: rendered output, email bodies. Sanitize on the way in; prefer commonmark when users author the content.",
        level: "advanced",
        primitive: "text",
        aliases: &["markup"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// HTTP date: Like Sun, 16 Aug 2026 14:30:00 GMT.
///
/// The HTTP header date format (IMF-fixdate): Last-Modified, Expires, and friends. HTTP interchange only - prefer date_time everywhere else.
pub static HTTP_DATE: Text = Text {
    meta: Meta {
        name: "http_date",
        label: "HTTP date",
        hint: "Like Sun, 16 Aug 2026 14:30:00 GMT",
        error: "Please use the HTTP date form, like Sun, 16 Aug 2026 14:30:00 GMT.",
        details: "The HTTP header date format (IMF-fixdate): Last-Modified, Expires, and friends. HTTP interchange only - prefer date_time everywhere else.",
        level: "domain",
        primitive: "date_time",
        aliases: &["imf_fixdate"],
    },
    steps: &[],
    pattern: Some(
        r"^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$",
    ),
    min_len: 29,
    max_len: 29,
    re: OnceLock::new(),
};

/// Bank account (IBAN): Country code, 2 digits, then account.
///
/// An International Bank Account Number: identifying accounts for payments. Pair with bic for cross-border routing and treat as sensitive data.
pub static IBAN: Text = Text {
    meta: Meta {
        name: "iban",
        label: "Bank account (IBAN)",
        hint: "Country code, 2 digits, then account",
        error: "Please use capitals and digits, no spaces, like DE89370400440532013000.",
        details: "An International Bank Account Number: identifying accounts for payments. Pair with bic for cross-border routing and treat as sensitive data.",
        level: "domain",
        primitive: "string",
        aliases: &["bank_account"],
    },
    steps: &[Step::Trim, Step::RemoveSpaces, Step::Uppercase],
    pattern: Some(r"^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$"),
    min_len: 15,
    max_len: 34,
    re: OnceLock::new(),
};

/// International email: Email that may use any alphabet.
///
/// An internationalized email address: non-ASCII local parts and domains. Prefer email when every consumer requires ASCII.
pub static IDN_EMAIL: Text = Text {
    meta: Meta {
        name: "idn_email",
        label: "International email",
        hint: "Email that may use any alphabet",
        error: "That email looks wrong. Try ñoño@ejemplo.es.",
        details: "An internationalized email address: non-ASCII local parts and domains. Prefer email when every consumer requires ASCII.",
        level: "advanced",
        primitive: "string",
        aliases: &["unicode_email"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// International website name: A domain in any alphabet.
///
/// An internationalized (IDNA2008) hostname. Prefer hostname when values are guaranteed ASCII or already punycode-encoded.
pub static IDN_HOSTNAME: Text = Text {
    meta: Meta {
        name: "idn_hostname",
        label: "International website name",
        hint: "A domain in any alphabet",
        error: "That domain looks wrong. Try bücher.example.",
        details: "An internationalized (IDNA2008) hostname. Prefer hostname when values are guaranteed ASCII or already punycode-encoded.",
        level: "advanced",
        primitive: "string",
        aliases: &["unicode_domain"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Small whole number: From -32768 to 32767.
///
/// Signed 16-bit integers: compact numeric codes and small bounded quantities. Prefer int32 as the general-purpose default.
pub static INT16: Int = Int {
    meta: Meta {
        name: "int16",
        label: "Small whole number",
        hint: "From -32768 to 32767",
        error: "Please use a whole number from -32768 to 32767.",
        details: "Signed 16-bit integers: compact numeric codes and small bounded quantities. Prefer int32 as the general-purpose default.",
        level: "advanced",
        primitive: "int32",
        aliases: &["smallint", "short"],
    },
    minimum: -32768,
    maximum: 32767,
};

/// Whole number: A number with no decimal point, like 42.
///
/// The general-purpose signed integer: counts, quantities, offsets. Prefer int64 for identifiers or anything that can outgrow two billion.
pub static INT32: Int = Int {
    meta: Meta {
        name: "int32",
        label: "Whole number",
        hint: "A number with no decimal point, like 42",
        error: "Please use a whole number, like 42.",
        details: "The general-purpose signed integer: counts, quantities, offsets. Prefer int64 for identifiers or anything that can outgrow two billion.",
        level: "core",
        primitive: "int32",
        aliases: &["int", "integer"],
    },
    minimum: -2147483648,
    maximum: 2147483647,
};

/// Big whole number: A very big number with no decimal point.
///
/// Signed 64-bit integers: database keys, byte sizes, high-resolution counters. Values beyond 2^53 lose precision as JSON numbers, so they travel as strings; storage is still a native 64-bit integer.
pub static INT64: Text = Text {
    meta: Meta {
        name: "int64",
        label: "Big whole number",
        hint: "A very big number with no decimal point",
        error: "Please use only digits, like 9007199254740993.",
        details: "Signed 64-bit integers: database keys, byte sizes, high-resolution counters. Values beyond 2^53 lose precision as JSON numbers, so they travel as strings; storage is still a native 64-bit integer.",
        level: "core",
        primitive: "int64",
        aliases: &["bigint", "long"],
    },
    steps: &[],
    pattern: Some(r"^-?[0-9]+$"),
    min_len: 1,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Tiny whole number: From -128 to 127.
///
/// Tiny signed integers (-128..127) where the bound is part of the contract. Prefer int32 as the general-purpose default.
pub static INT8: Int = Int {
    meta: Meta {
        name: "int8",
        label: "Tiny whole number",
        hint: "From -128 to 127",
        error: "Please use a whole number from -128 to 127.",
        details: "Tiny signed integers (-128..127) where the bound is part of the contract. Prefer int32 as the general-purpose default.",
        level: "advanced",
        primitive: "int32",
        aliases: &["tinyint", "byte"],
    },
    minimum: -128,
    maximum: 127,
};

/// IP address (v4): Four numbers with dots, like 192.0.2.1.
///
/// A dotted-quad IPv4 host address. Prefer cidr for networks rather than hosts.
pub static IPV4: Text = Text {
    meta: Meta {
        name: "ipv4",
        label: "IP address (v4)",
        hint: "Four numbers with dots, like 192.0.2.1",
        error: "Please use four numbers from 0 to 255, like 192.0.2.1.",
        details: "A dotted-quad IPv4 host address. Prefer cidr for networks rather than hosts.",
        level: "core",
        primitive: "string",
        aliases: &["ip", "ip_address"],
    },
    steps: &[],
    pattern: Some(
        r"^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$",
    ),
    min_len: 7,
    max_len: 15,
    re: OnceLock::new(),
};

/// IPv4 network range: Like 192.0.2.0/24.
///
/// An IPv4 network prefix like 192.0.2.0/24. Prefer cidr when either family may appear, and ipv4 for a single host.
pub static IPV4_CIDR: Text = Text {
    meta: Meta {
        name: "ipv4_cidr",
        label: "IPv4 network range",
        hint: "Like 192.0.2.0/24",
        error: "Please use an IPv4 address, a slash and 0-32, like 192.0.2.0/24.",
        details: "An IPv4 network prefix like 192.0.2.0/24. Prefer cidr when either family may appear, and ipv4 for a single host.",
        level: "advanced",
        primitive: "string",
        aliases: &["ipv4_subnet"],
    },
    steps: &[],
    pattern: Some(
        r"^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])/(3[0-2]|[12]?[0-9])$",
    ),
    min_len: 9,
    max_len: 18,
    re: OnceLock::new(),
};

/// IP address (v6): Like 2001:db8::1.
///
/// An IPv6 host address. Prefer cidr for prefixes rather than hosts.
pub static IPV6: Text = Text {
    meta: Meta {
        name: "ipv6",
        label: "IP address (v6)",
        hint: "Like 2001:db8::1",
        error: "That IP address looks wrong. Try 2001:db8::1.",
        details: "An IPv6 host address. Prefer cidr for prefixes rather than hosts.",
        level: "core",
        primitive: "string",
        aliases: &["ipv6_address"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// IPv6 network range: Like 2001:db8::/32.
///
/// An IPv6 network prefix like 2001:db8::/32. Prefer cidr when either family may appear, and ipv6 for a single host.
pub static IPV6_CIDR: Text = Text {
    meta: Meta {
        name: "ipv6_cidr",
        label: "IPv6 network range",
        hint: "Like 2001:db8::/32",
        error: "Please use an IPv6 address, a slash and 0-128, like 2001:db8::/32.",
        details: "An IPv6 network prefix like 2001:db8::/32. Prefer cidr when either family may appear, and ipv6 for a single host.",
        level: "advanced",
        primitive: "string",
        aliases: &["ipv6_subnet"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// International link: A link that may use any alphabet.
///
/// An internationalized absolute URI: user-facing links in any script, unencoded. Prefer uri when consumers require ASCII with percent-encoding.
pub static IRI: Text = Text {
    meta: Meta {
        name: "iri",
        label: "International link",
        hint: "A link that may use any alphabet",
        error: "That link looks wrong. Try https://bücher.example/straße.",
        details: "An internationalized absolute URI: user-facing links in any script, unencoded. Prefer uri when consumers require ASCII with percent-encoding.",
        level: "advanced",
        primitive: "string",
        aliases: &["unicode_url"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// International link or path: A link or path in any alphabet.
///
/// An internationalized URI reference, absolute or relative. Prefer iri for absolute-only values and uri_reference for ASCII-only ones.
pub static IRI_REFERENCE: Text = Text {
    meta: Meta {
        name: "iri_reference",
        label: "International link or path",
        hint: "A link or path in any alphabet",
        error: "That link or path looks wrong. Try ../straße.",
        details: "An internationalized URI reference, absolute or relative. Prefer iri for absolute-only values and uri_reference for ASCII-only ones.",
        level: "advanced",
        primitive: "string",
        aliases: &["unicode_href"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Book number (ISBN): 10 or 13 digits.
///
/// An ISBN identifying a book edition. Prefer gtin for general retail products; every ISBN-13 is a GTIN, but not the reverse.
pub static ISBN: Text = Text {
    meta: Meta {
        name: "isbn",
        label: "Book number (ISBN)",
        hint: "10 or 13 digits",
        error: "Please use 10 or 13 digits, no dashes, like 9780306406157.",
        details: "An ISBN identifying a book edition. Prefer gtin for general retail products; every ISBN-13 is a GTIN, but not the reverse.",
        level: "domain",
        primitive: "string",
        aliases: &["isbn13", "isbn10"],
    },
    steps: &[Step::RemoveSpaces, Step::RemoveHyphens],
    pattern: Some(r"^([0-9]{9}[0-9Xx]|97[89][0-9]{10})$"),
    min_len: 10,
    max_len: 13,
    re: OnceLock::new(),
};

/// JSON Pointer: A path inside a document, like /users/0.
///
/// An absolute JSON Pointer (/users/0/email): addressing a location inside a document from its root.
pub static JSON_POINTER: Text = Text {
    meta: Meta {
        name: "json_pointer",
        label: "JSON Pointer",
        hint: "A path inside a document, like /users/0",
        error: "Start with / for each step, like /users/0/email.",
        details: "An absolute JSON Pointer (/users/0/email): addressing a location inside a document from its root.",
        level: "advanced",
        primitive: "string",
        aliases: &["pointer"],
    },
    steps: &[],
    pattern: Some(r"^(/([^~/]|~[01])*)*$"),
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Login token: Three parts joined by dots.
///
/// A compact JSON Web Token: signed claims passed between parties. Handle like secret in storage and logs; prefer secret for opaque credentials.
pub static JWT: Text = Text {
    meta: Meta {
        name: "jwt",
        label: "Login token",
        hint: "Three parts joined by dots",
        error: "Please paste the whole token, like eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig.",
        details: "A compact JSON Web Token: signed claims passed between parties. Handle like secret in storage and logs; prefer secret for opaque credentials.",
        level: "advanced",
        primitive: "string",
        aliases: &["json_web_token", "bearer_token"],
    },
    steps: &[],
    pattern: Some(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$"),
    min_len: 4,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Language: Two or three small letters, like en.
///
/// An ISO 639 language code (en): tagging what language content is in. Prefer locale when region or script variants matter.
pub static LANGUAGE: Text = Text {
    meta: Meta {
        name: "language",
        label: "Language",
        hint: "Two or three small letters, like en",
        error: "Please use the language code, like en.",
        details: "An ISO 639 language code (en): tagging what language content is in. Prefer locale when region or script variants matter.",
        level: "advanced",
        primitive: "string",
        aliases: &["language_code"],
    },
    steps: &[],
    pattern: Some(r"^[a-z]{2,3}$"),
    min_len: 2,
    max_len: 3,
    re: OnceLock::new(),
};

/// Legal Entity ID: 20 capital letters and digits.
///
/// A Legal Entity Identifier: organizations in financial and regulatory contexts. Identity, not routing - prefer bic for payment routing.
pub static LEI: Text = Text {
    meta: Meta {
        name: "lei",
        label: "Legal Entity ID",
        hint: "20 capital letters and digits",
        error: "Please use 20 capital letters and digits, like 5493001KJTIIGC8Y1R12.",
        details: "A Legal Entity Identifier: organizations in financial and regulatory contexts. Identity, not routing - prefer bic for payment routing.",
        level: "domain",
        primitive: "string",
        aliases: &["legal_entity_identifier"],
    },
    steps: &[],
    pattern: Some(r"^[A-Z0-9]{18}[0-9]{2}$"),
    min_len: 20,
    max_len: 20,
    re: OnceLock::new(),
};

/// Language and region: Like en-US or es-419.
///
/// A BCP 47 language tag (en, en-US): a language with optional script and region, for formatting, translations, and user preferences.
pub static LOCALE: Text = Text {
    meta: Meta {
        name: "locale",
        label: "Language and region",
        hint: "Like en-US or es-419",
        error: "Please use a language code, like en-US.",
        details: "A BCP 47 language tag (en, en-US): a language with optional script and region, for formatting, translations, and user preferences.",
        level: "core",
        primitive: "string",
        aliases: &["language_tag", "lang"],
    },
    steps: &[],
    pattern: Some(r"^[a-zA-Z]{2,3}(-[a-zA-Z]{4})?(-([a-zA-Z]{2}|[0-9]{3}))?$"),
    min_len: 2,
    max_len: 12,
    re: OnceLock::new(),
};

/// Hardware address: Six pairs of hex digits.
///
/// An EUI-48 hardware address: device inventory, DHCP leases. Never an identity for people or accounts - MACs are spoofable and privacy-sensitive.
pub static MAC_ADDRESS: Text = Text {
    meta: Meta {
        name: "mac_address",
        label: "Hardware address",
        hint: "Six pairs of hex digits",
        error: "Please use six hex pairs with : or -, like 00:1b:44:11:3a:b7.",
        details: "An EUI-48 hardware address: device inventory, DHCP leases. Never an identity for people or accounts - MACs are spoofable and privacy-sensitive.",
        level: "advanced",
        primitive: "string",
        aliases: &["mac", "mac_addr"],
    },
    steps: &[],
    pattern: Some(r"^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$"),
    min_len: 17,
    max_len: 17,
    re: OnceLock::new(),
};

/// Accepted file types: Like text/html or image/*.
///
/// An HTTP media range with wildcards and parameters: Accept-style negotiation. Prefer media_type for one concrete type.
pub static MEDIA_RANGE: Text = Text {
    meta: Meta {
        name: "media_range",
        label: "Accepted file types",
        hint: "Like text/html or image/*",
        error: "Please use kind/subkind or a *, like text/html;q=0.9.",
        details: "An HTTP media range with wildcards and parameters: Accept-style negotiation. Prefer media_type for one concrete type.",
        level: "domain",
        primitive: "string",
        aliases: &["accept"],
    },
    steps: &[],
    pattern: Some(
        r"^(\*/\*|[A-Za-z0-9!#$&^_.+-]+/\*|[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+)([\x09\x20]*;[^\x00-\x1F\x7F]*)?$",
    ),
    min_len: 3,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// File type: What kind of file, like application/json.
///
/// A concrete media type like application/json: labeling stored content.
pub static MEDIA_TYPE: Text = Text {
    meta: Meta {
        name: "media_type",
        label: "File type",
        hint: "What kind of file, like application/json",
        error: "Please write kind/subkind, like application/json.",
        details: "A concrete media type like application/json: labeling stored content.",
        level: "core",
        primitive: "string",
        aliases: &["mime_type", "content_type"],
    },
    steps: &[],
    pattern: Some(r"^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(;[^\x00-\x1F\x7F]*)?$"),
    min_len: 3,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Group of fields: Named values kept together.
///
/// A nested JSON object: structured payloads, settings blobs, documents. Prefer dedicated fields or columns once the shape is stable enough to query.
pub static OBJECT: Meta = Meta {
    name: "object",
    label: "Group of fields",
    hint: "Named values kept together",
    error: "Please give named values, like a small card of facts.",
    details: "A nested JSON object: structured payloads, settings blobs, documents. Prefer dedicated fields or columns once the shape is stable enough to query.",
    level: "core",
    primitive: "object",
    aliases: &["map", "dict", "record"],
};

/// ORCID iD: Four groups of four digits.
///
/// An ORCID iD identifying a researcher. Prefer lei for organizations and wikidata_qid for entities outside scholarly identity.
pub static ORCID: Text = Text {
    meta: Meta {
        name: "orcid",
        label: "ORCID iD",
        hint: "Four groups of four digits",
        error: "Please use four groups of 4 with dashes, like 0000-0002-1825-0097.",
        details: "An ORCID iD identifying a researcher. Prefer lei for organizations and wikidata_qid for entities outside scholarly identity.",
        level: "domain",
        primitive: "string",
        aliases: &["orcid_id"],
    },
    steps: &[],
    pattern: Some(r"^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$"),
    min_len: 19,
    max_len: 19,
    re: OnceLock::new(),
};

/// Phone number: Start with + and your country code.
///
/// An E.164 phone number (+country code, digits only): dialing and SMS. Store normalized; display formatting is presentation, not data.
pub static PHONE: Text = Text {
    meta: Meta {
        name: "phone",
        label: "Phone number",
        hint: "Start with + and your country code",
        error: "Start with + and the country code, no spaces, like +14155552671.",
        details: "An E.164 phone number (+country code, digits only): dialing and SMS. Store normalized; display formatting is presentation, not data.",
        level: "core",
        primitive: "string",
        aliases: &["tel", "telephone", "mobile", "phone_number"],
    },
    steps: &[Step::Trim, Step::RemoveSpaces, Step::RemoveHyphens],
    pattern: Some(r"^\+[1-9][0-9]{1,14}$"),
    min_len: 3,
    max_len: 16,
    re: OnceLock::new(),
};

/// Port number: From 0 to 65535, like 5432.
///
/// A TCP/UDP port number (0..65535): service endpoints and configuration. Prefer uint16 for 16-bit values that are not ports.
pub static PORT: Int = Int {
    meta: Meta {
        name: "port",
        label: "Port number",
        hint: "From 0 to 65535, like 5432",
        error: "Please use a whole number from 0 to 65535.",
        details: "A TCP/UDP port number (0..65535): service endpoints and configuration. Prefer uint16 for 16-bit values that are not ports.",
        level: "advanced",
        primitive: "int32",
        aliases: &["port_number"],
    },
    minimum: 0,
    maximum: 65535,
};

/// Text pattern: A regular expression, like ^[a-z]+$.
///
/// An ECMA-262 regular expression source: validation rules and matchers stored as data. Prefer enum when the acceptable values are simply a closed set.
pub static REGEX: Text = Text {
    meta: Meta {
        name: "regex",
        label: "Text pattern",
        hint: "A regular expression, like ^[a-z]+$",
        error: "That regular expression looks wrong. Try ^[a-z]+$.",
        details: "An ECMA-262 regular expression source: validation rules and matchers stored as data. Prefer enum when the acceptable values are simply a closed set.",
        level: "advanced",
        primitive: "string",
        aliases: &["regexp", "regular_expression"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Relative JSON Pointer: Steps up, then a path, like 1/name.
///
/// A JSON Pointer relative to a known position (1/name). Prefer json_pointer when addressing from the document root.
pub static RELATIVE_JSON_POINTER: Text = Text {
    meta: Meta {
        name: "relative_json_pointer",
        label: "Relative JSON Pointer",
        hint: "Steps up, then a path, like 1/name",
        error: "Please start with a number, like 1/name.",
        details: "A JSON Pointer relative to a known position (1/name). Prefer json_pointer when addressing from the document root.",
        level: "advanced",
        primitive: "string",
        aliases: &["relative_pointer"],
    },
    steps: &[],
    pattern: Some(r"^(0|[1-9][0-9]*)(#|(/([^~/]|~[01])*)*)$"),
    min_len: 1,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Secret: Kept hidden, like a password.
///
/// Sensitive text that must never be displayed or logged: passwords, API keys. The format is a masking hint, not protection - hash or encrypt at rest.
pub static SECRET: Text = Text {
    meta: Meta {
        name: "secret",
        label: "Secret",
        hint: "Kept hidden, like a password",
        error: "Please type the secret.",
        details: "Sensitive text that must never be displayed or logged: passwords, API keys. The format is a masking hint, not protection - hash or encrypt at rest.",
        level: "core",
        primitive: "string",
        aliases: &["password", "api_key"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Version number: Major.minor.patch, like 1.4.2.
///
/// A Semantic Version (1.4.2-rc.1): package and API versions with defined precedence. Prefer string for version-ish labels that do not follow SemVer.
pub static SEMVER: Text = Text {
    meta: Meta {
        name: "semver",
        label: "Version number",
        hint: "Major.minor.patch, like 1.4.2",
        error: "Please use three numbers with dots, like 1.4.2-rc.1.",
        details: "A Semantic Version (1.4.2-rc.1): package and API versions with defined precedence. Prefer string for version-ish labels that do not follow SemVer.",
        level: "advanced",
        primitive: "string",
        aliases: &["version", "semantic_version"],
    },
    steps: &[],
    pattern: Some(
        r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$",
    ),
    min_len: 5,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Header bytes: Base64 between colons.
///
/// An HTTP Structured Fields byte sequence (colon-delimited base64): binary members of structured headers. Prefer base64 outside header serialization.
pub static SF_BINARY: Text = Text {
    meta: Meta {
        name: "sf_binary",
        label: "Header bytes",
        hint: "Base64 between colons",
        error: "Please wrap base64 in colons, like :aGVsbG8=:.",
        details: "An HTTP Structured Fields byte sequence (colon-delimited base64): binary members of structured headers. Prefer base64 outside header serialization.",
        level: "domain",
        primitive: "binary",
        aliases: &["structured_binary"],
    },
    steps: &[],
    pattern: Some(r"^:[A-Za-z0-9+/]*={0,2}:$"),
    min_len: 2,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Header yes/no: True or false.
///
/// An HTTP Structured Fields boolean (?1 / ?0): flags in structured headers. Prefer boolean outside header serialization.
pub static SF_BOOLEAN: Bool = Bool {
    meta: Meta {
        name: "sf_boolean",
        label: "Header yes/no",
        hint: "True or false",
        error: "Please pick true or false.",
        details: "An HTTP Structured Fields boolean (?1 / ?0): flags in structured headers. Prefer boolean outside header serialization.",
        level: "domain",
        primitive: "boolean",
        aliases: &["structured_boolean"],
    },
};

/// Header decimal: Up to 3 digits after the dot.
///
/// An HTTP Structured Fields decimal (three fractional digits): weights and q-values in headers. Prefer decimal outside header serialization.
pub static SF_DECIMAL: Number = Number {
    meta: Meta {
        name: "sf_decimal",
        label: "Header decimal",
        hint: "Up to 3 digits after the dot",
        error: "Please use a number with at most 3 decimals, like 4.5.",
        details: "An HTTP Structured Fields decimal (three fractional digits): weights and q-values in headers. Prefer decimal outside header serialization.",
        level: "domain",
        primitive: "float64",
        aliases: &["structured_decimal"],
    },
    minimum: f64::MIN,
    maximum: f64::MAX,
};

/// Header number: Up to 15 digits.
///
/// An HTTP Structured Fields integer (15 digits max): numeric members of structured headers. Prefer int64 outside header serialization.
pub static SF_INTEGER: Int = Int {
    meta: Meta {
        name: "sf_integer",
        label: "Header number",
        hint: "Up to 15 digits",
        error: "Please use a whole number with up to 15 digits.",
        details: "An HTTP Structured Fields integer (15 digits max): numeric members of structured headers. Prefer int64 outside header serialization.",
        level: "domain",
        primitive: "int32",
        aliases: &["structured_integer"],
    },
    minimum: -999999999999999,
    maximum: 999999999999999,
};

/// Header text: Plain ASCII characters only.
///
/// An HTTP Structured Fields quoted string (printable ASCII): textual members of structured headers. Prefer string outside header serialization.
pub static SF_STRING: Text = Text {
    meta: Meta {
        name: "sf_string",
        label: "Header text",
        hint: "Plain ASCII characters only",
        error: "Please use plain ASCII characters, like hello world.",
        details: "An HTTP Structured Fields quoted string (printable ASCII): textual members of structured headers. Prefer string outside header serialization.",
        level: "domain",
        primitive: "string",
        aliases: &["structured_string"],
    },
    steps: &[],
    pattern: Some(r"^[\x20-\x7E]*$"),
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Header token: A short word like gzip.
///
/// An HTTP Structured Fields token like gzip: short symbolic header values. Prefer enum for closed sets outside HTTP.
pub static SF_TOKEN: Text = Text {
    meta: Meta {
        name: "sf_token",
        label: "Header token",
        hint: "A short word like gzip",
        error: "Please start with a letter, no spaces, like gzip.",
        details: "An HTTP Structured Fields token like gzip: short symbolic header values. Prefer enum for closed sets outside HTTP.",
        level: "domain",
        primitive: "string",
        aliases: &["structured_token"],
    },
    steps: &[],
    pattern: Some(r"^[A-Za-z*][A-Za-z0-9:/!#$%&'*+\-.^_`|~]*$"),
    min_len: 1,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// SHA-256 hash: 64 hex characters.
///
/// A SHA-256 digest: content addressing, integrity checks, dedup keys. Never for passwords - those take a dedicated password hash stored as secret.
pub static SHA256: Text = Text {
    meta: Meta {
        name: "sha256",
        label: "SHA-256 hash",
        hint: "64 hex characters",
        error: "Needs 64 hex characters, like e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.",
        details: "A SHA-256 digest: content addressing, integrity checks, dedup keys. Never for passwords - those take a dedicated password hash stored as secret.",
        level: "advanced",
        primitive: "string",
        aliases: &["hash", "digest"],
    },
    steps: &[],
    pattern: Some(r"^[A-Fa-f0-9]{64}$"),
    min_len: 64,
    max_len: 64,
    re: OnceLock::new(),
};

/// Web address name: Small letters, digits and dashes.
///
/// A lowercase-hyphen URL token (getting-started): readable path segments derived from a title. Presentation identity only - prefer uuid as the real key.
pub static SLUG: Text = Text {
    meta: Meta {
        name: "slug",
        label: "Web address name",
        hint: "Small letters, digits and dashes",
        error: "Use small letters, digits and single dashes, like getting-started.",
        details: "A lowercase-hyphen URL token (getting-started): readable path segments derived from a title. Presentation identity only - prefer uuid as the real key.",
        level: "core",
        primitive: "string",
        aliases: &["permalink", "url_name"],
    },
    steps: &[Step::Trim, Step::Lowercase],
    pattern: Some(r"^[a-z0-9]+(-[a-z0-9]+)*$"),
    min_len: 1,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Short text: A few words, like a name or a title.
///
/// Single-line text where a length bound is meaningful: names, titles, labels. Prefer text when there is no maximum, and enum when the values form a closed set.
pub static STRING: Text = Text {
    meta: Meta {
        name: "string",
        label: "Short text",
        hint: "A few words, like a name or a title",
        error: "Please type some text.",
        details: "Single-line text where a length bound is meaningful: names, titles, labels. Prefer text when there is no maximum, and enum when the values form a closed set.",
        level: "core",
        primitive: "string",
        aliases: &["short_text", "varchar"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// State or region: Country, dash, region, like US-CA.
///
/// An ISO 3166-2 subdivision code (US-CA): states, provinces, regions. Carries its country prefix, so no separate country field is needed to interpret it.
pub static SUBDIVISION: Text = Text {
    meta: Meta {
        name: "subdivision",
        label: "State or region",
        hint: "Country, dash, region, like US-CA",
        error: "Please use country-region, like US-CA.",
        details: "An ISO 3166-2 subdivision code (US-CA): states, provinces, regions. Carries its country prefix, so no separate country field is needed to interpret it.",
        level: "advanced",
        primitive: "string",
        aliases: &["region", "state", "province"],
    },
    steps: &[Step::Trim, Step::Uppercase],
    pattern: Some(r"^[A-Z]{2}-[A-Z0-9]{1,3}$"),
    min_len: 4,
    max_len: 6,
    re: OnceLock::new(),
};

/// Long text: As many lines as you need.
///
/// Unbounded prose: article bodies, comments, logs. Prefer string when a length limit is part of the contract.
pub static TEXT: Text = Text {
    meta: Meta {
        name: "text",
        label: "Long text",
        hint: "As many lines as you need",
        error: "Please type some text.",
        details: "Unbounded prose: article bodies, comments, logs. Prefer string when a length limit is part of the contract.",
        level: "core",
        primitive: "text",
        aliases: &["long_text", "paragraph"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Time with offset: Like 14:30:00Z or 14:30:00+02:00.
///
/// A wall-clock time with an explicit UTC offset. Prefer time_local for schedules that float with the local zone.
pub static TIME: Text = Text {
    meta: Meta {
        name: "time",
        label: "Time with offset",
        hint: "Like 14:30:00Z or 14:30:00+02:00",
        error: "Please add the zone offset, like 14:30:00Z.",
        details: "A wall-clock time with an explicit UTC offset. Prefer time_local for schedules that float with the local zone.",
        level: "advanced",
        primitive: "time_local",
        aliases: &["timetz", "offset_time"],
    },
    steps: &[],
    pattern: Some(r"^[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$"),
    min_len: 9,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Time of day: Hours:minutes:seconds, like 14:30:00.
///
/// A wall-clock time with no offset: daily schedules like 'every day at 14:30' that follow whatever zone applies. Pair with timezone when the zone is fixed.
pub static TIME_LOCAL: Text = Text {
    meta: Meta {
        name: "time_local",
        label: "Time of day",
        hint: "Hours:minutes:seconds, like 14:30:00",
        error: "Please use hours:minutes:seconds, like 14:30:00.",
        details: "A wall-clock time with no offset: daily schedules like 'every day at 14:30' that follow whatever zone applies. Pair with timezone when the zone is fixed.",
        level: "core",
        primitive: "time_local",
        aliases: &["time_of_day", "local_time"],
    },
    steps: &[],
    pattern: Some(r"^[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?$"),
    min_len: 8,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Time zone: A region and city, like America/New_York.
///
/// An IANA zone name like America/New_York: user preferences and scheduling context. Store the name, never a raw offset - offsets change with DST and law.
pub static TIMEZONE: Text = Text {
    meta: Meta {
        name: "timezone",
        label: "Time zone",
        hint: "A region and city, like America/New_York",
        error: "Please pick a time zone, like America/New_York.",
        details: "An IANA zone name like America/New_York: user preferences and scheduling context. Store the name, never a raw offset - offsets change with DST and law.",
        level: "core",
        primitive: "string",
        aliases: &["tz", "time_zone"],
    },
    steps: &[],
    pattern: Some(r"^(UTC|[A-Za-z_]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?)$"),
    min_len: 3,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Small count: From 0 to 65535.
///
/// Unsigned 16-bit integers (0..65535). Prefer port for network ports specifically, and int32 when a negative value could ever appear.
pub static UINT16: Int = Int {
    meta: Meta {
        name: "uint16",
        label: "Small count",
        hint: "From 0 to 65535",
        error: "Please use a whole number from 0 to 65535.",
        details: "Unsigned 16-bit integers (0..65535). Prefer port for network ports specifically, and int32 when a negative value could ever appear.",
        level: "advanced",
        primitive: "int32",
        aliases: &["ushort"],
    },
    minimum: 0,
    maximum: 65535,
};

/// Count: From 0 to 4294967295.
///
/// Unsigned 32-bit integers: large counters and IDs from systems that use them. Prefer int64 in new designs; signed types survive arithmetic and language boundaries better.
pub static UINT32: Int = Int {
    meta: Meta {
        name: "uint32",
        label: "Count",
        hint: "From 0 to 4294967295",
        error: "Please use a whole number from 0 to 4294967295.",
        details: "Unsigned 32-bit integers: large counters and IDs from systems that use them. Prefer int64 in new designs; signed types survive arithmetic and language boundaries better.",
        level: "advanced",
        primitive: "int32",
        aliases: &["uint", "unsigned"],
    },
    minimum: 0,
    maximum: 4294967295,
};

/// Huge count: Digits only, no minus sign.
///
/// The full unsigned 64-bit range: hashes and foreign systems' identifiers. Most languages and JSON cannot represent the upper half natively, so values travel as strings; prefer int64 unless the source really uses all 64 bits.
pub static UINT64: Text = Text {
    meta: Meta {
        name: "uint64",
        label: "Huge count",
        hint: "Digits only, no minus sign",
        error: "Please use only digits, like 18446744073709551615.",
        details: "The full unsigned 64-bit range: hashes and foreign systems' identifiers. Most languages and JSON cannot represent the upper half natively, so values travel as strings; prefer int64 unless the source really uses all 64 bits.",
        level: "advanced",
        primitive: "int64",
        aliases: &["ulong"],
    },
    steps: &[],
    pattern: Some(r"^[0-9]+$"),
    min_len: 1,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Tiny count: From 0 to 255.
///
/// Unsigned bytes (0..255): color channels, small numeric codes. Prefer int32 unless the byte range is intrinsic to the data.
pub static UINT8: Int = Int {
    meta: Meta {
        name: "uint8",
        label: "Tiny count",
        hint: "From 0 to 255",
        error: "Please use a whole number from 0 to 255.",
        details: "Unsigned bytes (0..255): color channels, small numeric codes. Prefer int32 unless the byte range is intrinsic to the data.",
        level: "advanced",
        primitive: "int32",
        aliases: &["ubyte"],
    },
    minimum: 0,
    maximum: 255,
};

/// Sortable ID: 26 letters and digits.
///
/// A lexically sortable 128-bit ID in Crockford Base32: time-ordered keys that stay readable as text. Prefer uuid_v7 where native UUID column types and tooling matter.
pub static ULID: Text = Text {
    meta: Meta {
        name: "ulid",
        label: "Sortable ID",
        hint: "26 letters and digits",
        error: "Please use 26 letters and digits, like 01ARZ3NDEKTSV4RRFFQ69G5FAV.",
        details: "A lexically sortable 128-bit ID in Crockford Base32: time-ordered keys that stay readable as text. Prefer uuid_v7 where native UUID column types and tooling matter.",
        level: "advanced",
        primitive: "string",
        aliases: &["sortable_id"],
    },
    steps: &[],
    pattern: Some(r"^[0-7][0-9A-HJKMNP-TV-Z]{25}$"),
    min_len: 26,
    max_len: 26,
    re: OnceLock::new(),
};

/// Unix timestamp: Seconds since 1970-01-01.
///
/// Seconds since the Unix epoch as an integer: compact machine timestamps and TTLs. Prefer date_time for anything humans or APIs read directly.
pub static UNIX_TIME: Int = Int {
    meta: Meta {
        name: "unix_time",
        label: "Unix timestamp",
        hint: "Seconds since 1970-01-01",
        error: "Please use whole seconds since 1970, like 1786000000.",
        details: "Seconds since the Unix epoch as an integer: compact machine timestamps and TTLs. Prefer date_time for anything humans or APIs read directly.",
        level: "advanced",
        primitive: "int32",
        aliases: &["epoch", "epoch_seconds"],
    },
    minimum: i64::MIN,
    maximum: i64::MAX,
};

/// Web link: Like https://example.com/page.
///
/// An absolute URI with scheme: links, webhooks, resource locators. Use string for relative paths.
pub static URI: Text = Text {
    meta: Meta {
        name: "uri",
        label: "Web link",
        hint: "Like https://example.com/page",
        error: "That link looks wrong. Try https://example.com/page.",
        details: "An absolute URI with scheme: links, webhooks, resource locators. Use string for relative paths.",
        level: "core",
        primitive: "string",
        aliases: &["url", "link", "website"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Link or path: A full link or a path like /a/b.
///
/// A URI reference, absolute or relative: redirect targets, in-site paths. Prefer uri when an absolute, scheme-carrying value is required.
pub static URI_REFERENCE: Text = Text {
    meta: Meta {
        name: "uri_reference",
        label: "Link or path",
        hint: "A full link or a path like /a/b",
        error: "That link or path looks wrong. Try /a/b?c=1.",
        details: "A URI reference, absolute or relative: redirect targets, in-site paths. Prefer uri when an absolute, scheme-carrying value is required.",
        level: "advanced",
        primitive: "string",
        aliases: &["relative_url", "href"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Link template: A link with {placeholders}.
///
/// An RFC 6570 URL pattern with {variables}: route and link templates. Prefer uri for concrete, already-expanded links.
pub static URI_TEMPLATE: Text = Text {
    meta: Meta {
        name: "uri_template",
        label: "Link template",
        hint: "A link with {placeholders}",
        error: "That template looks wrong. Try /users/{id}.",
        details: "An RFC 6570 URL pattern with {variables}: route and link templates. Prefer uri for concrete, already-expanded links.",
        level: "advanced",
        primitive: "string",
        aliases: &["url_template"],
    },
    steps: &[],
    pattern: None,
    min_len: 0,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Unique ID: A long ID with dashes, made by the computer.
///
/// A 128-bit universal identifier, any version: primary keys and references. Which version to mint (such as time-ordered v7) is a generation option, not a separate type.
pub static UUID: Text = Text {
    meta: Meta {
        name: "uuid",
        label: "Unique ID",
        hint: "A long ID with dashes, made by the computer",
        error: "That ID looks wrong. It should look like f81d4fae-7dec-11d0-a765-00a0c91e6bf6.",
        details: "A 128-bit universal identifier, any version: primary keys and references. Which version to mint (such as time-ordered v7) is a generation option, not a separate type.",
        level: "core",
        primitive: "string",
        aliases: &["guid", "unique_id"],
    },
    steps: &[Step::Trim, Step::Lowercase],
    pattern: Some(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"),
    min_len: 36,
    max_len: 36,
    re: OnceLock::new(),
};

/// Time-ordered ID: A unique ID that sorts by time.
///
/// A time-ordered UUID: new primary keys that index and sort by creation time. Prefer uuid when accepting identifiers you did not mint.
pub static UUID_V7: Text = Text {
    meta: Meta {
        name: "uuid_v7",
        label: "Time-ordered ID",
        hint: "A unique ID that sorts by time",
        error: "It needs a 7 after the second dash, like 018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e6f.",
        details: "A time-ordered UUID: new primary keys that index and sort by creation time. Prefer uuid when accepting identifiers you did not mint.",
        level: "advanced",
        primitive: "string",
        aliases: &["uuidv7"],
    },
    steps: &[Step::Trim, Step::Lowercase],
    pattern: Some(
        r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
    ),
    min_len: 36,
    max_len: 36,
    re: OnceLock::new(),
};

/// Wikidata ID: Q and a number, like Q42.
///
/// A Wikidata entity ID (Q42): linking records to globally known entities. Prefer the domain registry when one exists - doi, orcid, lei, isbn.
pub static WIKIDATA_QID: Text = Text {
    meta: Meta {
        name: "wikidata_qid",
        label: "Wikidata ID",
        hint: "Q and a number, like Q42",
        error: "Please use Q and a number, like Q42.",
        details: "A Wikidata entity ID (Q42): linking records to globally known entities. Prefer the domain registry when one exists - doi, orcid, lei, isbn.",
        level: "domain",
        primitive: "string",
        aliases: &["qid"],
    },
    steps: &[],
    pattern: Some(r"^Q[1-9][0-9]*$"),
    min_len: 2,
    max_len: usize::MAX,
    re: OnceLock::new(),
};

/// Every type, in catalogue order.
pub static ALL: &[&Meta] = &[
    &ANY,
    &ARRAY,
    &BASE64.meta,
    &BASE64URL.meta,
    &BIC.meta,
    &BINARY.meta,
    &BOOLEAN.meta,
    &CHAR.meta,
    &CIDR.meta,
    &COLOR.meta,
    &COMMONMARK.meta,
    &COUNTRY.meta,
    &COUNTRY_ALPHA3.meta,
    &CRON.meta,
    &CSS_COLOR.meta,
    &CURRENCY.meta,
    &DATE.meta,
    &DATE_TIME.meta,
    &DATE_TIME_LOCAL.meta,
    &DECIMAL.meta,
    &DECIMAL128.meta,
    &DOI.meta,
    &DOUBLE_INT.meta,
    &DURATION.meta,
    &EMAIL.meta,
    &ENUM.meta,
    &FLOAT32.meta,
    &FLOAT64.meta,
    &GTIN.meta,
    &HOSTNAME.meta,
    &HTML.meta,
    &HTTP_DATE.meta,
    &IBAN.meta,
    &IDN_EMAIL.meta,
    &IDN_HOSTNAME.meta,
    &INT16.meta,
    &INT32.meta,
    &INT64.meta,
    &INT8.meta,
    &IPV4.meta,
    &IPV4_CIDR.meta,
    &IPV6.meta,
    &IPV6_CIDR.meta,
    &IRI.meta,
    &IRI_REFERENCE.meta,
    &ISBN.meta,
    &JSON_POINTER.meta,
    &JWT.meta,
    &LANGUAGE.meta,
    &LEI.meta,
    &LOCALE.meta,
    &MAC_ADDRESS.meta,
    &MEDIA_RANGE.meta,
    &MEDIA_TYPE.meta,
    &OBJECT,
    &ORCID.meta,
    &PHONE.meta,
    &PORT.meta,
    &REGEX.meta,
    &RELATIVE_JSON_POINTER.meta,
    &SECRET.meta,
    &SEMVER.meta,
    &SF_BINARY.meta,
    &SF_BOOLEAN.meta,
    &SF_DECIMAL.meta,
    &SF_INTEGER.meta,
    &SF_STRING.meta,
    &SF_TOKEN.meta,
    &SHA256.meta,
    &SLUG.meta,
    &STRING.meta,
    &SUBDIVISION.meta,
    &TEXT.meta,
    &TIME.meta,
    &TIME_LOCAL.meta,
    &TIMEZONE.meta,
    &UINT16.meta,
    &UINT32.meta,
    &UINT64.meta,
    &UINT8.meta,
    &ULID.meta,
    &UNIX_TIME.meta,
    &URI.meta,
    &URI_REFERENCE.meta,
    &URI_TEMPLATE.meta,
    &UUID.meta,
    &UUID_V7.meta,
    &WIKIDATA_QID.meta,
];

/// The typed scalar with exactly this name, or None.
pub fn lookup(name: &str) -> Option<Kind> {
    Some(match name {
        "any" => Kind::Shape(&ANY),
        "array" => Kind::Shape(&ARRAY),
        "base64" => Kind::Text(&BASE64),
        "base64url" => Kind::Text(&BASE64URL),
        "bic" => Kind::Text(&BIC),
        "binary" => Kind::Text(&BINARY),
        "boolean" => Kind::Bool(&BOOLEAN),
        "char" => Kind::Text(&CHAR),
        "cidr" => Kind::Text(&CIDR),
        "color" => Kind::Text(&COLOR),
        "commonmark" => Kind::Text(&COMMONMARK),
        "country" => Kind::Text(&COUNTRY),
        "country_alpha3" => Kind::Text(&COUNTRY_ALPHA3),
        "cron" => Kind::Text(&CRON),
        "css_color" => Kind::Text(&CSS_COLOR),
        "currency" => Kind::Text(&CURRENCY),
        "date" => Kind::Text(&DATE),
        "date_time" => Kind::Text(&DATE_TIME),
        "date_time_local" => Kind::Text(&DATE_TIME_LOCAL),
        "decimal" => Kind::Text(&DECIMAL),
        "decimal128" => Kind::Text(&DECIMAL128),
        "doi" => Kind::Text(&DOI),
        "double_int" => Kind::Int(&DOUBLE_INT),
        "duration" => Kind::Text(&DURATION),
        "email" => Kind::Text(&EMAIL),
        "enum" => Kind::Text(&ENUM),
        "float32" => Kind::Number(&FLOAT32),
        "float64" => Kind::Number(&FLOAT64),
        "gtin" => Kind::Text(&GTIN),
        "hostname" => Kind::Text(&HOSTNAME),
        "html" => Kind::Text(&HTML),
        "http_date" => Kind::Text(&HTTP_DATE),
        "iban" => Kind::Text(&IBAN),
        "idn_email" => Kind::Text(&IDN_EMAIL),
        "idn_hostname" => Kind::Text(&IDN_HOSTNAME),
        "int16" => Kind::Int(&INT16),
        "int32" => Kind::Int(&INT32),
        "int64" => Kind::Text(&INT64),
        "int8" => Kind::Int(&INT8),
        "ipv4" => Kind::Text(&IPV4),
        "ipv4_cidr" => Kind::Text(&IPV4_CIDR),
        "ipv6" => Kind::Text(&IPV6),
        "ipv6_cidr" => Kind::Text(&IPV6_CIDR),
        "iri" => Kind::Text(&IRI),
        "iri_reference" => Kind::Text(&IRI_REFERENCE),
        "isbn" => Kind::Text(&ISBN),
        "json_pointer" => Kind::Text(&JSON_POINTER),
        "jwt" => Kind::Text(&JWT),
        "language" => Kind::Text(&LANGUAGE),
        "lei" => Kind::Text(&LEI),
        "locale" => Kind::Text(&LOCALE),
        "mac_address" => Kind::Text(&MAC_ADDRESS),
        "media_range" => Kind::Text(&MEDIA_RANGE),
        "media_type" => Kind::Text(&MEDIA_TYPE),
        "object" => Kind::Shape(&OBJECT),
        "orcid" => Kind::Text(&ORCID),
        "phone" => Kind::Text(&PHONE),
        "port" => Kind::Int(&PORT),
        "regex" => Kind::Text(&REGEX),
        "relative_json_pointer" => Kind::Text(&RELATIVE_JSON_POINTER),
        "secret" => Kind::Text(&SECRET),
        "semver" => Kind::Text(&SEMVER),
        "sf_binary" => Kind::Text(&SF_BINARY),
        "sf_boolean" => Kind::Bool(&SF_BOOLEAN),
        "sf_decimal" => Kind::Number(&SF_DECIMAL),
        "sf_integer" => Kind::Int(&SF_INTEGER),
        "sf_string" => Kind::Text(&SF_STRING),
        "sf_token" => Kind::Text(&SF_TOKEN),
        "sha256" => Kind::Text(&SHA256),
        "slug" => Kind::Text(&SLUG),
        "string" => Kind::Text(&STRING),
        "subdivision" => Kind::Text(&SUBDIVISION),
        "text" => Kind::Text(&TEXT),
        "time" => Kind::Text(&TIME),
        "time_local" => Kind::Text(&TIME_LOCAL),
        "timezone" => Kind::Text(&TIMEZONE),
        "uint16" => Kind::Int(&UINT16),
        "uint32" => Kind::Int(&UINT32),
        "uint64" => Kind::Text(&UINT64),
        "uint8" => Kind::Int(&UINT8),
        "ulid" => Kind::Text(&ULID),
        "unix_time" => Kind::Int(&UNIX_TIME),
        "uri" => Kind::Text(&URI),
        "uri_reference" => Kind::Text(&URI_REFERENCE),
        "uri_template" => Kind::Text(&URI_TEMPLATE),
        "uuid" => Kind::Text(&UUID),
        "uuid_v7" => Kind::Text(&UUID_V7),
        "wikidata_qid" => Kind::Text(&WIKIDATA_QID),
        _ => return None,
    })
}
