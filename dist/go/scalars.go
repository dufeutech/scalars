// Code generated from dist/scalars.json by dev/codegen/go.mjs. DO NOT EDIT.
// scalars.go, catalogue version 0.3.0. Run `npm run build` in dev/ to regenerate.
// Requires Go >= 1.21 and golang.org/x/text (tested with v0.21.0 on Go 1.26.3).

// Package scalars has one typed value per scalar type, each with Normalize (text), Validate and IsValid.
package scalars

import (
	"math"
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

// Meta is what every type carries, copied from dist/scalars.json. Valid and Invalid hold the examples as
// encoding/json decodes them (numbers are float64), less any that is or holds a JSON object: a map literal
// would run code at program start. Invalid values break the type's raw rule (pattern, length or bounds) before
// any cleanup; a few become valid after Normalize (country "us" -> "US").
type Meta struct {
	Name, Label, Hint, Error, Details, Level, Primitive string
	Aliases                                             []string
	Valid, Invalid                                      []any
}

// ScalarError is a value that failed a type's rule. Error returns the type's error text.
type ScalarError struct {
	Scalar *Meta
}

func (e *ScalarError) Error() string { return e.Scalar.Error }

// step is one normalize step. The generator writes each type's steps as these constants.
type step uint8

const (
	stepTrim step = iota + 1
	stepLowercase
	stepUppercase
	stepRemoveSpaces
	stepRemoveHyphens
)

// noMax is the longest length of a type with no limit.
const noMax = int(^uint(0) >> 1)

// TextScalar is a type whose values are text. Its regex is compiled on first use.
type TextScalar struct {
	Meta
	steps   []step
	pattern string // "" when the type has none
	minLen  int    // shortest length in code points
	maxLen  int    // longest length in code points, noMax when unbounded
	once    sync.Once
	re      *regexp.Regexp
}

// Normalize applies the type's normalize steps in order.
func (t *TextScalar) Normalize(s string) string {
	for _, st := range t.steps {
		s = apply(st, s)
	}
	return s
}

// Validate normalizes s, then checks length and pattern. It returns the clean text (a substring of s when only
// trimming applied), or a *ScalarError.
func (t *TextScalar) Validate(s string) (string, error) {
	if out, ok := t.check(s); ok {
		return out, nil
	}
	return "", &ScalarError{&t.Meta}
}

// IsValid reports whether Validate would succeed. It never builds an error.
func (t *TextScalar) IsValid(s string) bool {
	_, ok := t.check(s)
	return ok
}

func (t *TextScalar) check(s string) (string, bool) {
	gated := false
	for _, st := range t.steps {
		// Text already too long is refused before case mapping copies it. The gate waits for the first case
		// step because case mapping never shortens text, but stepRemoveSpaces and stepRemoveHyphens do.
		if !gated && (st == stepLowercase || st == stepUppercase) {
			gated = true
			if longerThan(s, t.maxLen) {
				return "", false
			}
		}
		s = apply(st, s)
	}
	if longerThan(s, t.maxLen) || shorterThan(s, t.minLen) {
		return "", false
	}
	if t.pattern != "" {
		t.once.Do(t.compile)
		if !t.re.MatchString(s) {
			return "", false
		}
	}
	return s, true
}

func (t *TextScalar) compile() { t.re = regexp.MustCompile(t.pattern) }

// IntScalar is a type whose values are whole numbers.
type IntScalar struct {
	Meta
	minimum, maximum int64
}

// Validate checks the bounds. It returns n, or a *ScalarError.
func (t *IntScalar) Validate(n int64) (int64, error) {
	if t.IsValid(n) {
		return n, nil
	}
	return 0, &ScalarError{&t.Meta}
}

// IsValid reports whether Validate would succeed. It never builds an error.
func (t *IntScalar) IsValid(n int64) bool { return n >= t.minimum && n <= t.maximum }

// NumberScalar is a type whose values are finite numbers.
type NumberScalar struct {
	Meta
	minimum, maximum float64
}

// Validate checks that f is finite and within the bounds. It returns f, or a *ScalarError.
func (t *NumberScalar) Validate(f float64) (float64, error) {
	if t.IsValid(f) {
		return f, nil
	}
	return 0, &ScalarError{&t.Meta}
}

// IsValid reports whether Validate would succeed. It never builds an error.
func (t *NumberScalar) IsValid(f float64) bool {
	return !math.IsNaN(f) && !math.IsInf(f, 0) && f >= t.minimum && f <= t.maximum
}

// BoolScalar is a type whose values are true or false.
type BoolScalar struct {
	Meta
}

// Validate returns b: every bool is valid.
func (t *BoolScalar) Validate(b bool) (bool, error) { return b, nil }

// IsValid reports whether Validate would succeed, which it always does.
func (t *BoolScalar) IsValid(bool) bool { return true }

// ShapeScalar is a type whose values are JSON objects, arrays or anything: the Go type is the whole rule.
type ShapeScalar[T any] struct {
	Meta
}

// Validate returns v: the compiler has already checked its kind.
func (t *ShapeScalar[T]) Validate(v T) (T, error) { return v, nil }

// IsValid reports whether Validate would succeed, which it always does.
func (t *ShapeScalar[T]) IsValid(T) bool { return true }

func apply(st step, s string) string {
	switch st {
	case stepTrim:
		return strings.TrimFunc(s, isWhiteSpace)
	case stepLowercase:
		return toLower(s)
	case stepUppercase:
		return toUpper(s)
	case stepRemoveSpaces:
		return strings.ReplaceAll(s, " ", "")
	case stepRemoveHyphens:
		return strings.ReplaceAll(s, "-", "")
	}
	return s
}

// isWhiteSpace is Unicode White_Space, written out: the same set as the trim step in every other language.
func isWhiteSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0x85, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}

// Casers are not safe to share between goroutines, so each case step keeps a pool of them.
var (
	lowerCasers = sync.Pool{New: newLower}
	upperCasers = sync.Pool{New: newUpper}
)

func newLower() any {
	c := cases.Lower(language.Und)
	return &c
}

func newUpper() any {
	c := cases.Upper(language.Und)
	return &c
}

// Not strings.ToLower/ToUpper on non-ASCII text: they map one rune at a time, so "İ" -> "i" and "ß" stays "ß".
// On all-ASCII text they give the same result as the full mapping, and return s when nothing changes.
func toLower(s string) string {
	if isASCII(s) {
		return strings.ToLower(s)
	}
	return mapCase(&lowerCasers, s)
}

func toUpper(s string) string {
	if isASCII(s) {
		return strings.ToUpper(s)
	}
	return mapCase(&upperCasers, s)
}

func mapCase(pool *sync.Pool, s string) string {
	c := pool.Get().(*cases.Caser)
	s = c.String(s)
	pool.Put(c)
	return s
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= utf8.RuneSelf {
			return false
		}
	}
	return true
}

// longerThan reports whether s has more than limit code points. A code point is 1 to 4 bytes, so the byte
// length settles most cases; otherwise it counts, which is linear and allocates nothing.
func longerThan(s string, limit int) bool {
	if len(s) <= limit {
		return false
	}
	if len(s)/utf8.UTFMax > limit {
		return true
	}
	return utf8.RuneCountInString(s) > limit
}

// shorterThan reports whether s has fewer than limit code points, settled by the byte length when it can be.
func shorterThan(s string, limit int) bool {
	if len(s) < limit {
		return true
	}
	if len(s)/utf8.UTFMax >= limit {
		return false
	}
	return utf8.RuneCountInString(s) < limit
}

var (
	indexOnce sync.Once
	index     map[string]*Meta // every name and alias, built on the first Get
)

func buildIndex() {
	index = make(map[string]*Meta, 2*len(All))
	for _, m := range All {
		index[m.Name] = m
	}
	for _, m := range All {
		for _, alias := range m.Aliases {
			if _, taken := index[alias]; !taken {
				index[alias] = m
			}
		}
	}
}

// Get finds a type by name or alias; spacing, hyphens and case are forgiven.
func Get(word string) (*Meta, bool) {
	indexOnce.Do(buildIndex)
	if m, ok := index[word]; ok {
		return m, true
	}
	key := clean(word)
	if key == word {
		return nil, false
	}
	m, ok := index[key]
	return m, ok
}

// clean is the lookup key: trim, lowercase, each run of spaces and hyphens becomes one underscore. One pass,
// no regex, and one copy at most for ASCII words.
func clean(word string) string {
	s := strings.TrimFunc(word, isWhiteSpace)
	if !strings.ContainsAny(s, " -") {
		return toLower(s)
	}
	if !isASCII(s) {
		s = toLower(s) // then the loop below finds no upper-case ASCII left
	}
	var b strings.Builder
	b.Grow(len(s))
	gap := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == ' ' || c == '-':
			gap = true
			continue
		case 'A' <= c && c <= 'Z':
			c += 'a' - 'A'
		}
		if gap {
			b.WriteByte('_')
			gap = false
		}
		b.WriteByte(c)
	}
	if gap {
		b.WriteByte('_')
	}
	return b.String()
}

// Any is Anything: Any value at all.
//
// Deliberately unconstrained: passthrough payloads and escape hatches. Reach for it last - every consumer inherits the validation burden.
var Any = &scalarAny

var scalarAny = ShapeScalar[any]{
	Meta: Meta{
		Name:      "any",
		Label:     "Anything",
		Hint:      "Any value at all",
		Error:     "Any value is allowed here.",
		Details:   "Deliberately unconstrained: passthrough payloads and escape hatches. Reach for it last - every consumer inherits the validation burden.",
		Level:     "core",
		Primitive: "any",
		Aliases:   []string{"json", "jsonb"},
		Valid:     []any{nil, "text", 7.0},
		Invalid:   []any{},
	},
}

// Array is List: Several values in order.
//
// An ordered JSON list: tags, attachments, embedded collections. Prefer a separate table or repeated field when elements need identity or independent querying.
var Array = &scalarArray

var scalarArray = ShapeScalar[[]any]{
	Meta: Meta{
		Name:      "array",
		Label:     "List",
		Hint:      "Several values in order",
		Error:     "Please give a list of values.",
		Details:   "An ordered JSON list: tags, attachments, embedded collections. Prefer a separate table or repeated field when elements need identity or independent querying.",
		Level:     "core",
		Primitive: "array",
		Aliases:   []string{"list"},
		Valid:     []any{[]any{1.0, 2.0, 3.0}, []any{}},
		Invalid:   []any{},
	},
}

// Base64 is Base64 data: Bytes written as letters, + and /.
//
// Binary content as standard base64 text: payloads embedded in JSON. Prefer binary for raw transport and base64url when the value travels in URLs or filenames.
var Base64 = &scalarBase64

var scalarBase64 = TextScalar{
	Meta: Meta{
		Name:      "base64",
		Label:     "Base64 data",
		Hint:      "Bytes written as letters, + and /",
		Error:     "Please use base64 with = padding, like SGVsbG8gd29ybGQ=.",
		Details:   "Binary content as standard base64 text: payloads embedded in JSON. Prefer binary for raw transport and base64url when the value travels in URLs or filenames.",
		Level:     "advanced",
		Primitive: "binary",
		Aliases:   []string{"b64"},
		Valid:     []any{"SGVsbG8gd29ybGQ=", "", "YQ=="},
		Invalid:   []any{"SGVsbG8gd29ybGQ", "SGVsbG8_d29ybGQ="},
	},
	steps:   []step{},
	pattern: `^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$`,
	minLen:  0,
	maxLen:  noMax,
}

// Base64url is URL-safe base64: Bytes written as letters, - and _.
//
// URL-safe base64 (no + or /): tokens and digests placed in URLs. Prefer base64 for ordinary embedded payloads.
var Base64url = &scalarBase64url

var scalarBase64url = TextScalar{
	Meta: Meta{
		Name:      "base64url",
		Label:     "URL-safe base64",
		Hint:      "Bytes written as letters, - and _",
		Error:     "Please use letters, digits, - and _, like SGVsbG8gd29ybGQ.",
		Details:   "URL-safe base64 (no + or /): tokens and digests placed in URLs. Prefer base64 for ordinary embedded payloads.",
		Level:     "advanced",
		Primitive: "binary",
		Aliases:   []string{"b64url"},
		Valid:     []any{"SGVsbG8gd29ybGQ", "YQ", "-_-_"},
		Invalid:   []any{"SGVsbG8+d29ybGQ", "SGVs/bG8"},
	},
	steps:   []step{},
	pattern: `^[A-Za-z0-9_-]*={0,2}$`,
	minLen:  0,
	maxLen:  noMax,
}

// Bic is Bank code (BIC): 8 or 11 capital letters and digits.
//
// A BIC/SWIFT code identifying a bank for payment routing. Routing, not identity - prefer lei to identify the legal entity itself.
var Bic = &scalarBic

var scalarBic = TextScalar{
	Meta: Meta{
		Name:      "bic",
		Label:     "Bank code (BIC)",
		Hint:      "8 or 11 capital letters and digits",
		Error:     "Please use 8 or 11 capital letters and digits, like DEUTDEFF500.",
		Details:   "A BIC/SWIFT code identifying a bank for payment routing. Routing, not identity - prefer lei to identify the legal entity itself.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"swift", "swift_code"},
		Valid:     []any{"DEUTDEFF500", "DEUTDEFF"},
		Invalid:   []any{"DEUTDEFF5", "deutdeff"},
	},
	steps:   []step{stepTrim, stepUppercase},
	pattern: `^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$`,
	minLen:  8,
	maxLen:  11,
}

// Binary is File: Upload a file.
//
// Raw bytes: file uploads, blobs, digests. Inside JSON they travel as standard base64 (RFC 4648); storage keeps the decoded bytes.
var Binary = &scalarBinary

var scalarBinary = TextScalar{
	Meta: Meta{
		Name:      "binary",
		Label:     "File",
		Hint:      "Upload a file",
		Error:     "Please choose a file.",
		Details:   "Raw bytes: file uploads, blobs, digests. Inside JSON they travel as standard base64 (RFC 4648); storage keeps the decoded bytes.",
		Level:     "core",
		Primitive: "binary",
		Aliases:   []string{"bytes", "file", "blob"},
		Valid:     []any{"SGVsbG8gd29ybGQ=", ""},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Boolean is Yes or no: Pick yes or no.
//
// A true/false fact: flags, toggles, switches. Prefer enum if a third state could ever appear, rather than a nullable boolean.
var Boolean = &scalarBoolean

var scalarBoolean = BoolScalar{
	Meta: Meta{
		Name:      "boolean",
		Label:     "Yes or no",
		Hint:      "Pick yes or no",
		Error:     "Please pick yes or no.",
		Details:   "A true/false fact: flags, toggles, switches. Prefer enum if a third state could ever appear, rather than a nullable boolean.",
		Level:     "core",
		Primitive: "boolean",
		Aliases:   []string{"bool", "yes_no"},
		Valid:     []any{true, false},
		Invalid:   []any{"true", 1.0},
	},
}

// Char is Single character: Exactly one character.
//
// Exactly one character: a grade, flag, or single-letter code. Prefer string for anything that can grow, and enum when the values form a closed set.
var Char = &scalarChar

var scalarChar = TextScalar{
	Meta: Meta{
		Name:      "char",
		Label:     "Single character",
		Hint:      "Exactly one character",
		Error:     "Please type exactly one character, like A.",
		Details:   "Exactly one character: a grade, flag, or single-letter code. Prefer string for anything that can grow, and enum when the values form a closed set.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"character", "letter"},
		Valid:     []any{"A", "é"},
		Invalid:   []any{"", "AB"},
	},
	steps:   []step{},
	pattern: "",
	minLen:  1,
	maxLen:  1,
}

// Cidr is Network range: An address and a size, like 192.0.2.0/24.
//
// A network prefix of either IP family: allowlists, routing rules. Prefer ipv4 or ipv6 for a single host.
var Cidr = &scalarCidr

var scalarCidr = TextScalar{
	Meta: Meta{
		Name:      "cidr",
		Label:     "Network range",
		Hint:      "An address and a size, like 192.0.2.0/24",
		Error:     "Please use an address, a slash and a size, like 192.0.2.0/24.",
		Details:   "A network prefix of either IP family: allowlists, routing rules. Prefer ipv4 or ipv6 for a single host.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"subnet", "network"},
		Valid:     []any{"192.0.2.0/24", "2001:db8::/32", "10.0.0.0/8"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Color is Color: Pick a color.
//
// An sRGB color as lowercase #rrggbb or #rrggbbaa - the exact form <input type="color"> produces, so it round-trips through forms, JSON, JS/TS and SQL unchanged. Prefer css_color only for wide-gamut or design-token values.
var Color = &scalarColor

var scalarColor = TextScalar{
	Meta: Meta{
		Name:      "color",
		Label:     "Color",
		Hint:      "Pick a color",
		Error:     "Please use # and 6 small hex digits, like #1a2b3c.",
		Details:   "An sRGB color as lowercase #rrggbb or #rrggbbaa - the exact form <input type=\"color\"> produces, so it round-trips through forms, JSON, JS/TS and SQL unchanged. Prefer css_color only for wide-gamut or design-token values.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"colour", "rgb", "hex_color"},
		Valid:     []any{"#1a2b3c", "#1a2b3c80", "#000000"},
		Invalid:   []any{"#ABC", "#1A2B3C", "red"},
	},
	steps:   []step{stepTrim, stepLowercase},
	pattern: `^#[0-9a-f]{6}([0-9a-f]{2})?$`,
	minLen:  7,
	maxLen:  9,
}

// Commonmark is Markdown: Text with # headings and **bold**.
//
// Markdown (CommonMark) source: user-authored rich content stored as written. Prefer html for already-rendered markup and text for plain prose.
var Commonmark = &scalarCommonmark

var scalarCommonmark = TextScalar{
	Meta: Meta{
		Name:      "commonmark",
		Label:     "Markdown",
		Hint:      "Text with # headings and **bold**",
		Error:     "Please type some Markdown text.",
		Details:   "Markdown (CommonMark) source: user-authored rich content stored as written. Prefer html for already-rendered markup and text for plain prose.",
		Level:     "advanced",
		Primitive: "text",
		Aliases:   []string{"markdown", "md"},
		Valid:     []any{"# Title\n\nSome **bold** text.", "- one\n- two"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Country is Country: Pick a country.
//
// An ISO 3166-1 alpha-2 country code (US): the interchange default for countries.
var Country = &scalarCountry

var scalarCountry = TextScalar{
	Meta: Meta{
		Name:      "country",
		Label:     "Country",
		Hint:      "Pick a country",
		Error:     "Please use the 2-letter country code, like US.",
		Details:   "An ISO 3166-1 alpha-2 country code (US): the interchange default for countries.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"country_code"},
		Valid:     []any{"US", "DE"},
		Invalid:   []any{"us", "USA"},
	},
	steps:   []step{stepTrim, stepUppercase},
	pattern: `^[A-Z]{2}$`,
	minLen:  2,
	maxLen:  2,
}

// CountryAlpha3 is Country (3-letter): Three capital letters, like USA.
//
// An ISO 3166-1 alpha-3 country code (USA): feeds and standards that require three letters. Prefer country (alpha-2) as the default.
var CountryAlpha3 = &scalarCountryAlpha3

var scalarCountryAlpha3 = TextScalar{
	Meta: Meta{
		Name:      "country_alpha3",
		Label:     "Country (3-letter)",
		Hint:      "Three capital letters, like USA",
		Error:     "Please use the 3-letter country code, like USA.",
		Details:   "An ISO 3166-1 alpha-3 country code (USA): feeds and standards that require three letters. Prefer country (alpha-2) as the default.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"country_code3"},
		Valid:     []any{"USA", "DEU"},
		Invalid:   []any{"usa", "US"},
	},
	steps:   []step{stepTrim, stepUppercase},
	pattern: `^[A-Z]{3}$`,
	minLen:  3,
	maxLen:  3,
}

// Cron is Schedule: Five fields, like 0 3 * * *.
//
// A POSIX crontab expression (0 3 * * *): recurring schedules. Prefer duration for simple intervals and date_time for one-shot schedules.
var Cron = &scalarCron

var scalarCron = TextScalar{
	Meta: Meta{
		Name:      "cron",
		Label:     "Schedule",
		Hint:      "Five fields, like 0 3 * * *",
		Error:     "Please use five fields, like 0 3 * * * (3 AM daily).",
		Details:   "A POSIX crontab expression (0 3 * * *): recurring schedules. Prefer duration for simple intervals and date_time for one-shot schedules.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"cron_expression", "crontab"},
		Valid:     []any{"0 3 * * *", "*/15 9-17 * * 1-5"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// CssColor is CSS color: Any CSS color, like oklch(70% 0.15 250).
//
// Any single CSS Color 4 value: hex, named, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() or color(display-p3 ...). The pattern only checks the shape; validate for real with CSS.supports('color', value). Level 5 expressions (color-mix(), relative colors, light-dark(), var()) are computed in context and are deliberately not data.
var CssColor = &scalarCssColor

var scalarCssColor = TextScalar{
	Meta: Meta{
		Name:      "css_color",
		Label:     "CSS color",
		Hint:      "Any CSS color, like oklch(70% 0.15 250)",
		Error:     "That doesn't look like a CSS color. Try oklch(70% 0.15 250).",
		Details:   "Any single CSS Color 4 value: hex, named, rgb(), hsl(), hwb(), lab(), lch(), oklab(), oklch() or color(display-p3 ...). The pattern only checks the shape; validate for real with CSS.supports('color', value). Level 5 expressions (color-mix(), relative colors, light-dark(), var()) are computed in context and are deliberately not data.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"css_colour"},
		Valid:     []any{"oklch(70% 0.15 250)", "#fff", "rebeccapurple", "color(display-p3 1 0.5 0)", "rgb(10 20 30 / 50%)"},
		Invalid:   []any{"color-mix(in srgb, red, blue)", "oklch(from var(--brand) l c h)", "#12"},
	},
	steps:   []step{},
	pattern: `^(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|[a-zA-Z]+|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\))$`,
	minLen:  1,
	maxLen:  noMax,
}

// Currency is Currency: Pick a currency, like USD or EUR.
//
// An ISO 4217 currency code (USD): pair it with a decimal amount to represent money. Never derive it from country or locale - people transact across borders.
var Currency = &scalarCurrency

var scalarCurrency = TextScalar{
	Meta: Meta{
		Name:      "currency",
		Label:     "Currency",
		Hint:      "Pick a currency, like USD or EUR",
		Error:     "Please use the 3-letter currency code, like USD.",
		Details:   "An ISO 4217 currency code (USD): pair it with a decimal amount to represent money. Never derive it from country or locale - people transact across borders.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"currency_code"},
		Valid:     []any{"USD", "EUR"},
		Invalid:   []any{"usd", "US"},
	},
	steps:   []step{stepTrim, stepUppercase},
	pattern: `^[A-Z]{3}$`,
	minLen:  3,
	maxLen:  3,
}

// Date is Date: Year-month-day, like 2026-08-16.
//
// A calendar date with no time or zone: birthdays, due dates, effective dates. Prefer date_time for an actual instant.
var Date = &scalarDate

var scalarDate = TextScalar{
	Meta: Meta{
		Name:      "date",
		Label:     "Date",
		Hint:      "Year-month-day, like 2026-08-16",
		Error:     "Please use year-month-day, like 2026-08-16.",
		Details:   "A calendar date with no time or zone: birthdays, due dates, effective dates. Prefer date_time for an actual instant.",
		Level:     "core",
		Primitive: "date",
		Aliases:   []string{"day"},
		Valid:     []any{"2026-08-16", "2024-02-29"},
		Invalid:   []any{"2026-8-16", "16/08/2026"},
	},
	steps:   []step{},
	pattern: `^[0-9]{4}-[0-9]{2}-[0-9]{2}$`,
	minLen:  10,
	maxLen:  10,
}

// DateTime is Date and time: An exact moment, with its time zone.
//
// An absolute instant with offset - the default for created/updated timestamps and anything that really happened. Prefer date_time_local only for deliberately floating times.
var DateTime = &scalarDateTime

var scalarDateTime = TextScalar{
	Meta: Meta{
		Name:      "date_time",
		Label:     "Date and time",
		Hint:      "An exact moment, with its time zone",
		Error:     "Please use date, T, time and zone, like 2026-08-16T14:30:00Z.",
		Details:   "An absolute instant with offset - the default for created/updated timestamps and anything that really happened. Prefer date_time_local only for deliberately floating times.",
		Level:     "core",
		Primitive: "date_time",
		Aliases:   []string{"datetime", "timestamp", "instant"},
		Valid:     []any{"2026-08-16T14:30:00Z", "2026-08-16T14:30:00.123+02:00"},
		Invalid:   []any{"2026-08-16T14:30:00", "2026-08-16 14:30:00Z"},
	},
	steps:   []step{},
	pattern: `^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$`,
	minLen:  20,
	maxLen:  noMax,
}

// DateTimeLocal is Local date and time: A date and time on the clock, no zone.
//
// A date and time with no offset: floating events like 'Jan 1 at midnight, wherever the user is'. Prefer date_time for real instants; pair with timezone to reconstruct one.
var DateTimeLocal = &scalarDateTimeLocal

var scalarDateTimeLocal = TextScalar{
	Meta: Meta{
		Name:      "date_time_local",
		Label:     "Local date and time",
		Hint:      "A date and time on the clock, no zone",
		Error:     "Please use date, T and time, like 2026-08-16T14:30:00.",
		Details:   "A date and time with no offset: floating events like 'Jan 1 at midnight, wherever the user is'. Prefer date_time for real instants; pair with timezone to reconstruct one.",
		Level:     "core",
		Primitive: "date_time_local",
		Aliases:   []string{"local_datetime", "wall_time"},
		Valid:     []any{"2026-08-16T14:30:00", "2026-08-16T09:00:00.5"},
		Invalid:   []any{"2026-08-16T14:30:00Z", "2026-08-16"},
	},
	steps:   []step{},
	pattern: `^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?$`,
	minLen:  19,
	maxLen:  noMax,
}

// Decimal is Exact number: Exact amounts like money: 1234.56.
//
// Exact decimal value represented as text. Use for money, rates, quantities, and other values where decimal precision must be preserved. Precision and scale are determined by the target system.
var Decimal = &scalarDecimal

var scalarDecimal = TextScalar{
	Meta: Meta{
		Name:      "decimal",
		Label:     "Exact number",
		Hint:      "Exact amounts like money: 1234.56",
		Error:     "Please use digits and one dot, like 1234.56.",
		Details:   "Exact decimal value represented as text. Use for money, rates, quantities, and other values where decimal precision must be preserved. Precision and scale are determined by the target system.",
		Level:     "core",
		Primitive: "decimal",
		Aliases:   []string{"money", "numeric"},
		Valid:     []any{"1234.56", "-0.01", "42"},
		Invalid:   []any{"1,234.56", "1e5"},
	},
	steps:   []step{},
	pattern: `^-?[0-9]+(\.[0-9]+)?$`,
	minLen:  1,
	maxLen:  noMax,
}

// Decimal128 is Very exact number: Up to 34 significant digits.
//
// IEEE 754 decimal128: exact decimals with a defined 34-significant-digit width, for interchange with fixed-width financial systems. Prefer decimal when arbitrary precision is acceptable.
var Decimal128 = &scalarDecimal128

var scalarDecimal128 = TextScalar{
	Meta: Meta{
		Name:      "decimal128",
		Label:     "Very exact number",
		Hint:      "Up to 34 significant digits",
		Error:     "Please use digits and one dot, like 1234.567890123456789012345678901234.",
		Details:   "IEEE 754 decimal128: exact decimals with a defined 34-significant-digit width, for interchange with fixed-width financial systems. Prefer decimal when arbitrary precision is acceptable.",
		Level:     "advanced",
		Primitive: "decimal",
		Aliases:   []string{"dec128"},
		Valid:     []any{"1234.567890123456789012345678901234", "-1"},
		Invalid:   []any{"1e10", "abc"},
	},
	steps:   []step{},
	pattern: `^-?[0-9]+(\.[0-9]+)?$`,
	minLen:  1,
	maxLen:  noMax,
}

// Doi is DOI: A paper ID, like 10.1000/182.
//
// A Digital Object Identifier: citations to papers, datasets, publications. Prefer uri only for links that are not registered DOIs.
var Doi = &scalarDoi

var scalarDoi = TextScalar{
	Meta: Meta{
		Name:      "doi",
		Label:     "DOI",
		Hint:      "A paper ID, like 10.1000/182",
		Error:     "Please start with 10., like 10.1000/182.",
		Details:   "A Digital Object Identifier: citations to papers, datasets, publications. Prefer uri only for links that are not registered DOIs.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"doi_name"},
		Valid:     []any{"10.1000/182", "10.1038/nphys1170"},
		Invalid:   []any{"10.1/182", "doi:10.1000/182"},
	},
	steps:   []step{},
	pattern: `^10\.[0-9]{4,9}/[-._;()/:A-Za-z0-9]+$`,
	minLen:  9,
	maxLen:  noMax,
}

// DoubleInt is Safe whole number: Whole number JavaScript keeps exact.
//
// Integers exactly representable in an IEEE double (up to 2^53-1): safe as a plain number for every JSON consumer, including JavaScript. Prefer int64 when the full 64-bit range matters and consumers accept strings.
var DoubleInt = &scalarDoubleInt

var scalarDoubleInt = IntScalar{
	Meta: Meta{
		Name:      "double_int",
		Label:     "Safe whole number",
		Hint:      "Whole number JavaScript keeps exact",
		Error:     "Please use a whole number between ±9007199254740991.",
		Details:   "Integers exactly representable in an IEEE double (up to 2^53-1): safe as a plain number for every JSON consumer, including JavaScript. Prefer int64 when the full 64-bit range matters and consumers accept strings.",
		Level:     "advanced",
		Primitive: "int32",
		Aliases:   []string{"safe_integer"},
		Valid:     []any{9007199254740991.0, -9007199254740991.0},
		Invalid:   []any{9007199254740992.0, 1.5},
	},
	minimum: -9007199254740991,
	maximum: 9007199254740991,
}

// Duration is Length of time: How long something lasts, like P3DT4H30M.
//
// A span of time (ISO 8601): timeouts, retention windows, billing periods. A length, not a position - prefer date_time for points in time.
var Duration = &scalarDuration

var scalarDuration = TextScalar{
	Meta: Meta{
		Name:      "duration",
		Label:     "Length of time",
		Hint:      "How long something lasts, like P3DT4H30M",
		Error:     "Please write it like P3DT4H30M (3 days, 4 hours, 30 minutes).",
		Details:   "A span of time (ISO 8601): timeouts, retention windows, billing periods. A length, not a position - prefer date_time for points in time.",
		Level:     "core",
		Primitive: "duration",
		Aliases:   []string{"interval", "timespan"},
		Valid:     []any{"P3DT4H30M", "PT0.5S", "P1Y2M"},
		Invalid:   []any{"P", "3 days"},
	},
	steps:   []step{},
	pattern: `^P(([0-9]+Y([0-9]+M)?([0-9]+W)?([0-9]+D)?|[0-9]+M([0-9]+W)?([0-9]+D)?|[0-9]+W([0-9]+D)?|[0-9]+D)(T([0-9]+H([0-9]+M)?([0-9]+(\.[0-9]+)?S)?|[0-9]+M([0-9]+(\.[0-9]+)?S)?|[0-9]+(\.[0-9]+)?S))?|T([0-9]+H([0-9]+M)?([0-9]+(\.[0-9]+)?S)?|[0-9]+M([0-9]+(\.[0-9]+)?S)?|[0-9]+(\.[0-9]+)?S))$`,
	minLen:  3,
	maxLen:  noMax,
}

// Email is Email address: Like name@example.com.
//
// An email address: login and contact fields. Accepting internationalized mailboxes is a validation choice, not a separate type.
var Email = &scalarEmail

var scalarEmail = TextScalar{
	Meta: Meta{
		Name:      "email",
		Label:     "Email address",
		Hint:      "Like name@example.com",
		Error:     "That email looks wrong. Try user@example.com.",
		Details:   "An email address: login and contact fields. Accepting internationalized mailboxes is a validation choice, not a separate type.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"email_address", "mail"},
		Valid:     []any{"user@example.com", "first.last+tag@sub.example.co.uk"},
		Invalid:   []any{"user@", "user example.com"},
	},
	steps:   []step{stepTrim},
	pattern: `^[^@\x09-\x0D\x20]+@[^@\x09-\x0D\x20][^.@\x09-\x0D\x20]*\.[^@\x09-\x0D\x20]+$`,
	minLen:  5,
	maxLen:  noMax,
}

// Enum is Choice: Pick one option from a fixed list.
//
// One value from a closed, named set: statuses, roles, kinds. Prefer string for open-ended sets and boolean for exactly two states.
var Enum = &scalarEnum

var scalarEnum = TextScalar{
	Meta: Meta{
		Name:      "enum",
		Label:     "Choice",
		Hint:      "Pick one option from a fixed list",
		Error:     "Please pick one of the options.",
		Details:   "One value from a closed, named set: statuses, roles, kinds. Prefer string for open-ended sets and boolean for exactly two states.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"choice", "select"},
		Valid:     []any{"active", "draft", "archived"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Float32 is Small-precision number: Any number, stored with ~7 digits.
//
// Single-precision floats: bulk sensor readings or ML weights where memory beats precision. Prefer float64 as the default floating-point type.
var Float32 = &scalarFloat32

var scalarFloat32 = NumberScalar{
	Meta: Meta{
		Name:      "float32",
		Label:     "Small-precision number",
		Hint:      "Any number, stored with ~7 digits",
		Error:     "Please type a number, like 3.14.",
		Details:   "Single-precision floats: bulk sensor readings or ML weights where memory beats precision. Prefer float64 as the default floating-point type.",
		Level:     "advanced",
		Primitive: "float64",
		Aliases:   []string{"real", "single"},
		Valid:     []any{3.14, -1.5},
		Invalid:   []any{"3.14"},
	},
	minimum: -math.MaxFloat64,
	maximum: math.MaxFloat64,
}

// Float64 is Number: Any number, like 3.14.
//
// The default floating-point number: measurements, ratios, scores. Never money or exact quantities - use decimal for anything where digits must be exact.
var Float64 = &scalarFloat64

var scalarFloat64 = NumberScalar{
	Meta: Meta{
		Name:      "float64",
		Label:     "Number",
		Hint:      "Any number, like 3.14",
		Error:     "Please type a number, like 3.14.",
		Details:   "The default floating-point number: measurements, ratios, scores. Never money or exact quantities - use decimal for anything where digits must be exact.",
		Level:     "core",
		Primitive: "float64",
		Aliases:   []string{"number", "float", "double"},
		Valid:     []any{3.141592653589793, -0.5, 1e+21},
		Invalid:   []any{"3.14"},
	},
	minimum: -math.MaxFloat64,
	maximum: math.MaxFloat64,
}

// Gtin is Barcode number: 8, 12, 13 or 14 digits.
//
// A GS1 GTIN (UPC/EAN family) identifying a retail product. Prefer isbn when the domain is specifically books.
var Gtin = &scalarGtin

var scalarGtin = TextScalar{
	Meta: Meta{
		Name:      "gtin",
		Label:     "Barcode number",
		Hint:      "8, 12, 13 or 14 digits",
		Error:     "Please use 8, 12, 13 or 14 digits, like 0614141000036.",
		Details:   "A GS1 GTIN (UPC/EAN family) identifying a retail product. Prefer isbn when the domain is specifically books.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"barcode", "ean", "upc"},
		Valid:     []any{"0614141000036", "96385074"},
		Invalid:   []any{"123456789", "0614141000036A"},
	},
	steps:   []step{stepRemoveSpaces, stepRemoveHyphens},
	pattern: `^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$`,
	minLen:  8,
	maxLen:  14,
}

// Hostname is Website name: Like api.example.com.
//
// A DNS hostname: servers and endpoints without scheme or path. Prefer uri when a full locator travels; internationalized names are a validation choice.
var Hostname = &scalarHostname

var scalarHostname = TextScalar{
	Meta: Meta{
		Name:      "hostname",
		Label:     "Website name",
		Hint:      "Like api.example.com",
		Error:     "Please use letters, digits, dots and dashes, like api.example.com.",
		Details:   "A DNS hostname: servers and endpoints without scheme or path. Prefer uri when a full locator travels; internationalized names are a validation choice.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"domain", "domain_name", "host"},
		Valid:     []any{"api.example.com", "localhost", "a-b.example"},
		Invalid:   []any{"-api.example.com", "api..example.com", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
	},
	steps:   []step{stepTrim, stepLowercase},
	pattern: `^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$`,
	minLen:  1,
	maxLen:  253,
}

// Html is HTML: Web page markup, like <p>Hello</p>.
//
// HTML markup stored as-is: rendered output, email bodies. Sanitize on the way in; prefer commonmark when users author the content.
var Html = &scalarHtml

var scalarHtml = TextScalar{
	Meta: Meta{
		Name:      "html",
		Label:     "HTML",
		Hint:      "Web page markup, like <p>Hello</p>",
		Error:     "Please type some HTML.",
		Details:   "HTML markup stored as-is: rendered output, email bodies. Sanitize on the way in; prefer commonmark when users author the content.",
		Level:     "advanced",
		Primitive: "text",
		Aliases:   []string{"markup"},
		Valid:     []any{"<p>Hello</p>", "<ul><li>one</li></ul>"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// HttpDate is HTTP date: Like Sun, 16 Aug 2026 14:30:00 GMT.
//
// The HTTP header date format (IMF-fixdate): Last-Modified, Expires, and friends. HTTP interchange only - prefer date_time everywhere else.
var HttpDate = &scalarHttpDate

var scalarHttpDate = TextScalar{
	Meta: Meta{
		Name:      "http_date",
		Label:     "HTTP date",
		Hint:      "Like Sun, 16 Aug 2026 14:30:00 GMT",
		Error:     "Please use the HTTP date form, like Sun, 16 Aug 2026 14:30:00 GMT.",
		Details:   "The HTTP header date format (IMF-fixdate): Last-Modified, Expires, and friends. HTTP interchange only - prefer date_time everywhere else.",
		Level:     "domain",
		Primitive: "date_time",
		Aliases:   []string{"imf_fixdate"},
		Valid:     []any{"Sun, 16 Aug 2026 14:30:00 GMT", "Mon, 01 Jan 2024 00:00:00 GMT"},
		Invalid:   []any{"2026-08-16T14:30:00Z", "Sun, 16 Aug 2026 14:30:00 UTC"},
	},
	steps:   []step{},
	pattern: `^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [0-9]{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$`,
	minLen:  29,
	maxLen:  29,
}

// Iban is Bank account (IBAN): Country code, 2 digits, then account.
//
// An International Bank Account Number: identifying accounts for payments. Pair with bic for cross-border routing and treat as sensitive data.
var Iban = &scalarIban

var scalarIban = TextScalar{
	Meta: Meta{
		Name:      "iban",
		Label:     "Bank account (IBAN)",
		Hint:      "Country code, 2 digits, then account",
		Error:     "Please use capitals and digits, no spaces, like DE89370400440532013000.",
		Details:   "An International Bank Account Number: identifying accounts for payments. Pair with bic for cross-border routing and treat as sensitive data.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"bank_account"},
		Valid:     []any{"DE89370400440532013000", "GB82WEST12345698765432"},
		Invalid:   []any{"de89370400440532013000", "DE89 3704 0044 0532 0130 00"},
	},
	steps:   []step{stepTrim, stepRemoveSpaces, stepUppercase},
	pattern: `^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$`,
	minLen:  15,
	maxLen:  34,
}

// IdnEmail is International email: Email that may use any alphabet.
//
// An internationalized email address: non-ASCII local parts and domains. Prefer email when every consumer requires ASCII.
var IdnEmail = &scalarIdnEmail

var scalarIdnEmail = TextScalar{
	Meta: Meta{
		Name:      "idn_email",
		Label:     "International email",
		Hint:      "Email that may use any alphabet",
		Error:     "That email looks wrong. Try ñoño@ejemplo.es.",
		Details:   "An internationalized email address: non-ASCII local parts and domains. Prefer email when every consumer requires ASCII.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"unicode_email"},
		Valid:     []any{"用户@例子.广告", "ñoño@ejemplo.es"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// IdnHostname is International website name: A domain in any alphabet.
//
// An internationalized (IDNA2008) hostname. Prefer hostname when values are guaranteed ASCII or already punycode-encoded.
var IdnHostname = &scalarIdnHostname

var scalarIdnHostname = TextScalar{
	Meta: Meta{
		Name:      "idn_hostname",
		Label:     "International website name",
		Hint:      "A domain in any alphabet",
		Error:     "That domain looks wrong. Try bücher.example.",
		Details:   "An internationalized (IDNA2008) hostname. Prefer hostname when values are guaranteed ASCII or already punycode-encoded.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"unicode_domain"},
		Valid:     []any{"例子.广告", "bücher.example"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Int16 is Small whole number: From -32768 to 32767.
//
// Signed 16-bit integers: compact numeric codes and small bounded quantities. Prefer int32 as the general-purpose default.
var Int16 = &scalarInt16

var scalarInt16 = IntScalar{
	Meta: Meta{
		Name:      "int16",
		Label:     "Small whole number",
		Hint:      "From -32768 to 32767",
		Error:     "Please use a whole number from -32768 to 32767.",
		Details:   "Signed 16-bit integers: compact numeric codes and small bounded quantities. Prefer int32 as the general-purpose default.",
		Level:     "advanced",
		Primitive: "int32",
		Aliases:   []string{"smallint", "short"},
		Valid:     []any{1024.0, -32768.0},
		Invalid:   []any{32768.0, -32769.0},
	},
	minimum: -32768,
	maximum: 32767,
}

// Int32 is Whole number: A number with no decimal point, like 42.
//
// The general-purpose signed integer: counts, quantities, offsets. Prefer int64 for identifiers or anything that can outgrow two billion.
var Int32 = &scalarInt32

var scalarInt32 = IntScalar{
	Meta: Meta{
		Name:      "int32",
		Label:     "Whole number",
		Hint:      "A number with no decimal point, like 42",
		Error:     "Please use a whole number, like 42.",
		Details:   "The general-purpose signed integer: counts, quantities, offsets. Prefer int64 for identifiers or anything that can outgrow two billion.",
		Level:     "core",
		Primitive: "int32",
		Aliases:   []string{"int", "integer"},
		Valid:     []any{42.0, -2147483648.0, 0.0},
		Invalid:   []any{2147483648.0, 1.5},
	},
	minimum: -2147483648,
	maximum: 2147483647,
}

// Int64 is Big whole number: A very big number with no decimal point.
//
// Signed 64-bit integers: database keys, byte sizes, high-resolution counters. Values beyond 2^53 lose precision as JSON numbers, so they travel as strings; storage is still a native 64-bit integer.
var Int64 = &scalarInt64

var scalarInt64 = TextScalar{
	Meta: Meta{
		Name:      "int64",
		Label:     "Big whole number",
		Hint:      "A very big number with no decimal point",
		Error:     "Please use only digits, like 9007199254740993.",
		Details:   "Signed 64-bit integers: database keys, byte sizes, high-resolution counters. Values beyond 2^53 lose precision as JSON numbers, so they travel as strings; storage is still a native 64-bit integer.",
		Level:     "core",
		Primitive: "int64",
		Aliases:   []string{"bigint", "long"},
		Valid:     []any{"9007199254740993", "-42", "0"},
		Invalid:   []any{"12.5", 123.0},
	},
	steps:   []step{},
	pattern: `^-?[0-9]+$`,
	minLen:  1,
	maxLen:  noMax,
}

// Int8 is Tiny whole number: From -128 to 127.
//
// Tiny signed integers (-128..127) where the bound is part of the contract. Prefer int32 as the general-purpose default.
var Int8 = &scalarInt8

var scalarInt8 = IntScalar{
	Meta: Meta{
		Name:      "int8",
		Label:     "Tiny whole number",
		Hint:      "From -128 to 127",
		Error:     "Please use a whole number from -128 to 127.",
		Details:   "Tiny signed integers (-128..127) where the bound is part of the contract. Prefer int32 as the general-purpose default.",
		Level:     "advanced",
		Primitive: "int32",
		Aliases:   []string{"tinyint", "byte"},
		Valid:     []any{-7.0, -128.0, 127.0},
		Invalid:   []any{128.0, -129.0},
	},
	minimum: -128,
	maximum: 127,
}

// Ipv4 is IP address (v4): Four numbers with dots, like 192.0.2.1.
//
// A dotted-quad IPv4 host address. Prefer cidr for networks rather than hosts.
var Ipv4 = &scalarIpv4

var scalarIpv4 = TextScalar{
	Meta: Meta{
		Name:      "ipv4",
		Label:     "IP address (v4)",
		Hint:      "Four numbers with dots, like 192.0.2.1",
		Error:     "Please use four numbers from 0 to 255, like 192.0.2.1.",
		Details:   "A dotted-quad IPv4 host address. Prefer cidr for networks rather than hosts.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"ip", "ip_address"},
		Valid:     []any{"192.0.2.1", "0.0.0.0", "255.255.255.255"},
		Invalid:   []any{"256.0.0.1", "192.0.2"},
	},
	steps:   []step{},
	pattern: `^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$`,
	minLen:  7,
	maxLen:  15,
}

// Ipv4Cidr is IPv4 network range: Like 192.0.2.0/24.
//
// An IPv4 network prefix like 192.0.2.0/24. Prefer cidr when either family may appear, and ipv4 for a single host.
var Ipv4Cidr = &scalarIpv4Cidr

var scalarIpv4Cidr = TextScalar{
	Meta: Meta{
		Name:      "ipv4_cidr",
		Label:     "IPv4 network range",
		Hint:      "Like 192.0.2.0/24",
		Error:     "Please use an IPv4 address, a slash and 0-32, like 192.0.2.0/24.",
		Details:   "An IPv4 network prefix like 192.0.2.0/24. Prefer cidr when either family may appear, and ipv4 for a single host.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"ipv4_subnet"},
		Valid:     []any{"192.0.2.0/24", "0.0.0.0/0"},
		Invalid:   []any{"192.0.2.0/33", "192.0.2.0"},
	},
	steps:   []step{},
	pattern: `^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])/(3[0-2]|[12]?[0-9])$`,
	minLen:  9,
	maxLen:  18,
}

// Ipv6 is IP address (v6): Like 2001:db8::1.
//
// An IPv6 host address. Prefer cidr for prefixes rather than hosts.
var Ipv6 = &scalarIpv6

var scalarIpv6 = TextScalar{
	Meta: Meta{
		Name:      "ipv6",
		Label:     "IP address (v6)",
		Hint:      "Like 2001:db8::1",
		Error:     "That IP address looks wrong. Try 2001:db8::1.",
		Details:   "An IPv6 host address. Prefer cidr for prefixes rather than hosts.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"ipv6_address"},
		Valid:     []any{"2001:db8::1", "::1", "fe80::1ff:fe23:4567:890a"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Ipv6Cidr is IPv6 network range: Like 2001:db8::/32.
//
// An IPv6 network prefix like 2001:db8::/32. Prefer cidr when either family may appear, and ipv6 for a single host.
var Ipv6Cidr = &scalarIpv6Cidr

var scalarIpv6Cidr = TextScalar{
	Meta: Meta{
		Name:      "ipv6_cidr",
		Label:     "IPv6 network range",
		Hint:      "Like 2001:db8::/32",
		Error:     "Please use an IPv6 address, a slash and 0-128, like 2001:db8::/32.",
		Details:   "An IPv6 network prefix like 2001:db8::/32. Prefer cidr when either family may appear, and ipv6 for a single host.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"ipv6_subnet"},
		Valid:     []any{"2001:db8::/32", "::/0"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Iri is International link: A link that may use any alphabet.
//
// An internationalized absolute URI: user-facing links in any script, unencoded. Prefer uri when consumers require ASCII with percent-encoding.
var Iri = &scalarIri

var scalarIri = TextScalar{
	Meta: Meta{
		Name:      "iri",
		Label:     "International link",
		Hint:      "A link that may use any alphabet",
		Error:     "That link looks wrong. Try https://bücher.example/straße.",
		Details:   "An internationalized absolute URI: user-facing links in any script, unencoded. Prefer uri when consumers require ASCII with percent-encoding.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"unicode_url"},
		Valid:     []any{"https://例子.广告/路径", "https://bücher.example/straße"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// IriReference is International link or path: A link or path in any alphabet.
//
// An internationalized URI reference, absolute or relative. Prefer iri for absolute-only values and uri_reference for ASCII-only ones.
var IriReference = &scalarIriReference

var scalarIriReference = TextScalar{
	Meta: Meta{
		Name:      "iri_reference",
		Label:     "International link or path",
		Hint:      "A link or path in any alphabet",
		Error:     "That link or path looks wrong. Try ../straße.",
		Details:   "An internationalized URI reference, absolute or relative. Prefer iri for absolute-only values and uri_reference for ASCII-only ones.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"unicode_href"},
		Valid:     []any{"/路径?c=1", "../straße"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Isbn is Book number (ISBN): 10 or 13 digits.
//
// An ISBN identifying a book edition. Prefer gtin for general retail products; every ISBN-13 is a GTIN, but not the reverse.
var Isbn = &scalarIsbn

var scalarIsbn = TextScalar{
	Meta: Meta{
		Name:      "isbn",
		Label:     "Book number (ISBN)",
		Hint:      "10 or 13 digits",
		Error:     "Please use 10 or 13 digits, no dashes, like 9780306406157.",
		Details:   "An ISBN identifying a book edition. Prefer gtin for general retail products; every ISBN-13 is a GTIN, but not the reverse.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"isbn13", "isbn10"},
		Valid:     []any{"9780306406157", "030640615X"},
		Invalid:   []any{"978030640615", "0306406152XX"},
	},
	steps:   []step{stepRemoveSpaces, stepRemoveHyphens},
	pattern: `^([0-9]{9}[0-9Xx]|97[89][0-9]{10})$`,
	minLen:  10,
	maxLen:  13,
}

// JsonPointer is JSON Pointer: A path inside a document, like /users/0.
//
// An absolute JSON Pointer (/users/0/email): addressing a location inside a document from its root.
var JsonPointer = &scalarJsonPointer

var scalarJsonPointer = TextScalar{
	Meta: Meta{
		Name:      "json_pointer",
		Label:     "JSON Pointer",
		Hint:      "A path inside a document, like /users/0",
		Error:     "Start with / for each step, like /users/0/email.",
		Details:   "An absolute JSON Pointer (/users/0/email): addressing a location inside a document from its root.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"pointer"},
		Valid:     []any{"/users/0/email", "", "/a~1b/~0c"},
		Invalid:   []any{"users/0", "/a~2b"},
	},
	steps:   []step{},
	pattern: `^(/([^~/]|~[01])*)*$`,
	minLen:  0,
	maxLen:  noMax,
}

// Jwt is Login token: Three parts joined by dots.
//
// A compact JSON Web Token: signed claims passed between parties. Handle like secret in storage and logs; prefer secret for opaque credentials.
var Jwt = &scalarJwt

var scalarJwt = TextScalar{
	Meta: Meta{
		Name:      "jwt",
		Label:     "Login token",
		Hint:      "Three parts joined by dots",
		Error:     "Please paste the whole token, like eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig.",
		Details:   "A compact JSON Web Token: signed claims passed between parties. Handle like secret in storage and logs; prefer secret for opaque credentials.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"json_web_token", "bearer_token"},
		Valid:     []any{"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig", "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0."},
		Invalid:   []any{"eyJhbGciOiJIUzI1NiJ9", "not a token"},
	},
	steps:   []step{},
	pattern: `^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$`,
	minLen:  4,
	maxLen:  noMax,
}

// Language is Language: Two or three small letters, like en.
//
// An ISO 639 language code (en): tagging what language content is in. Prefer locale when region or script variants matter.
var Language = &scalarLanguage

var scalarLanguage = TextScalar{
	Meta: Meta{
		Name:      "language",
		Label:     "Language",
		Hint:      "Two or three small letters, like en",
		Error:     "Please use the language code, like en.",
		Details:   "An ISO 639 language code (en): tagging what language content is in. Prefer locale when region or script variants matter.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"language_code"},
		Valid:     []any{"en", "haw"},
		Invalid:   []any{"EN", "english"},
	},
	steps:   []step{},
	pattern: `^[a-z]{2,3}$`,
	minLen:  2,
	maxLen:  3,
}

// Lei is Legal Entity ID: 20 capital letters and digits.
//
// A Legal Entity Identifier: organizations in financial and regulatory contexts. Identity, not routing - prefer bic for payment routing.
var Lei = &scalarLei

var scalarLei = TextScalar{
	Meta: Meta{
		Name:      "lei",
		Label:     "Legal Entity ID",
		Hint:      "20 capital letters and digits",
		Error:     "Please use 20 capital letters and digits, like 5493001KJTIIGC8Y1R12.",
		Details:   "A Legal Entity Identifier: organizations in financial and regulatory contexts. Identity, not routing - prefer bic for payment routing.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"legal_entity_identifier"},
		Valid:     []any{"5493001KJTIIGC8Y1R12", "529900T8BM49AURSDO55"},
		Invalid:   []any{"5493001KJTIIGC8Y1R1", "5493001kjtiigc8y1r12"},
	},
	steps:   []step{},
	pattern: `^[A-Z0-9]{18}[0-9]{2}$`,
	minLen:  20,
	maxLen:  20,
}

// Locale is Language and region: Like en-US or es-419.
//
// A BCP 47 language tag (en, en-US): a language with optional script and region, for formatting, translations, and user preferences.
var Locale = &scalarLocale

var scalarLocale = TextScalar{
	Meta: Meta{
		Name:      "locale",
		Label:     "Language and region",
		Hint:      "Like en-US or es-419",
		Error:     "Please use a language code, like en-US.",
		Details:   "A BCP 47 language tag (en, en-US): a language with optional script and region, for formatting, translations, and user preferences.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"language_tag", "lang"},
		Valid:     []any{"en-US", "en", "zh-Hant-TW", "es-419"},
		Invalid:   []any{"english", "en_US"},
	},
	steps:   []step{},
	pattern: `^[a-zA-Z]{2,3}(-[a-zA-Z]{4})?(-([a-zA-Z]{2}|[0-9]{3}))?$`,
	minLen:  2,
	maxLen:  12,
}

// MacAddress is Hardware address: Six pairs of hex digits.
//
// An EUI-48 hardware address: device inventory, DHCP leases. Never an identity for people or accounts - MACs are spoofable and privacy-sensitive.
var MacAddress = &scalarMacAddress

var scalarMacAddress = TextScalar{
	Meta: Meta{
		Name:      "mac_address",
		Label:     "Hardware address",
		Hint:      "Six pairs of hex digits",
		Error:     "Please use six hex pairs with : or -, like 00:1b:44:11:3a:b7.",
		Details:   "An EUI-48 hardware address: device inventory, DHCP leases. Never an identity for people or accounts - MACs are spoofable and privacy-sensitive.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"mac", "mac_addr"},
		Valid:     []any{"00:1b:44:11:3a:b7", "00-1B-44-11-3A-B7"},
		Invalid:   []any{"00:1b:44:11:3a", "00:1b:44:11:3a:zz"},
	},
	steps:   []step{},
	pattern: `^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$`,
	minLen:  17,
	maxLen:  17,
}

// MediaRange is Accepted file types: Like text/html or image/*.
//
// An HTTP media range with wildcards and parameters: Accept-style negotiation. Prefer media_type for one concrete type.
var MediaRange = &scalarMediaRange

var scalarMediaRange = TextScalar{
	Meta: Meta{
		Name:      "media_range",
		Label:     "Accepted file types",
		Hint:      "Like text/html or image/*",
		Error:     "Please use kind/subkind or a *, like text/html;q=0.9.",
		Details:   "An HTTP media range with wildcards and parameters: Accept-style negotiation. Prefer media_type for one concrete type.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"accept"},
		Valid:     []any{"text/html;q=0.9", "*/*", "image/*"},
		Invalid:   []any{"*/html", "text"},
	},
	steps:   []step{},
	pattern: `^(\*/\*|[A-Za-z0-9!#$&^_.+-]+/\*|[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+)([\x09\x20]*;[^\x00-\x1F\x7F]*)?$`,
	minLen:  3,
	maxLen:  noMax,
}

// MediaType is File type: What kind of file, like application/json.
//
// A concrete media type like application/json: labeling stored content.
var MediaType = &scalarMediaType

var scalarMediaType = TextScalar{
	Meta: Meta{
		Name:      "media_type",
		Label:     "File type",
		Hint:      "What kind of file, like application/json",
		Error:     "Please write kind/subkind, like application/json.",
		Details:   "A concrete media type like application/json: labeling stored content.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"mime_type", "content_type"},
		Valid:     []any{"application/json", "text/html; charset=utf-8", "image/svg+xml"},
		Invalid:   []any{"json", "application/"},
	},
	steps:   []step{},
	pattern: `^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(;[^\x00-\x1F\x7F]*)?$`,
	minLen:  3,
	maxLen:  noMax,
}

// Object is Group of fields: Named values kept together.
//
// A nested JSON object: structured payloads, settings blobs, documents. Prefer dedicated fields or columns once the shape is stable enough to query.
var Object = &scalarObject

var scalarObject = ShapeScalar[map[string]any]{
	Meta: Meta{
		Name:      "object",
		Label:     "Group of fields",
		Hint:      "Named values kept together",
		Error:     "Please give named values, like a small card of facts.",
		Details:   "A nested JSON object: structured payloads, settings blobs, documents. Prefer dedicated fields or columns once the shape is stable enough to query.",
		Level:     "core",
		Primitive: "object",
		Aliases:   []string{"map", "dict", "record"},
		Valid:     []any{},
		Invalid:   []any{[]any{1.0, 2.0}},
	},
}

// Orcid is ORCID iD: Four groups of four digits.
//
// An ORCID iD identifying a researcher. Prefer lei for organizations and wikidata_qid for entities outside scholarly identity.
var Orcid = &scalarOrcid

var scalarOrcid = TextScalar{
	Meta: Meta{
		Name:      "orcid",
		Label:     "ORCID iD",
		Hint:      "Four groups of four digits",
		Error:     "Please use four groups of 4 with dashes, like 0000-0002-1825-0097.",
		Details:   "An ORCID iD identifying a researcher. Prefer lei for organizations and wikidata_qid for entities outside scholarly identity.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"orcid_id"},
		Valid:     []any{"0000-0002-1825-0097", "0000-0002-9079-593X"},
		Invalid:   []any{"0000-0002-1825-009", "0000000218250097"},
	},
	steps:   []step{},
	pattern: `^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$`,
	minLen:  19,
	maxLen:  19,
}

// Phone is Phone number: Start with + and your country code.
//
// An E.164 phone number (+country code, digits only): dialing and SMS. Store normalized; display formatting is presentation, not data.
var Phone = &scalarPhone

var scalarPhone = TextScalar{
	Meta: Meta{
		Name:      "phone",
		Label:     "Phone number",
		Hint:      "Start with + and your country code",
		Error:     "Start with + and the country code, no spaces, like +14155552671.",
		Details:   "An E.164 phone number (+country code, digits only): dialing and SMS. Store normalized; display formatting is presentation, not data.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"tel", "telephone", "mobile", "phone_number"},
		Valid:     []any{"+14155552671", "+442071838750"},
		Invalid:   []any{"4155552671", "+1 415 555 2671"},
	},
	steps:   []step{stepTrim, stepRemoveSpaces, stepRemoveHyphens},
	pattern: `^\+[1-9][0-9]{1,14}$`,
	minLen:  3,
	maxLen:  16,
}

// Port is Port number: From 0 to 65535, like 5432.
//
// A TCP/UDP port number (0..65535): service endpoints and configuration. Prefer uint16 for 16-bit values that are not ports.
var Port = &scalarPort

var scalarPort = IntScalar{
	Meta: Meta{
		Name:      "port",
		Label:     "Port number",
		Hint:      "From 0 to 65535, like 5432",
		Error:     "Please use a whole number from 0 to 65535.",
		Details:   "A TCP/UDP port number (0..65535): service endpoints and configuration. Prefer uint16 for 16-bit values that are not ports.",
		Level:     "advanced",
		Primitive: "int32",
		Aliases:   []string{"port_number"},
		Valid:     []any{5432.0, 0.0, 65535.0},
		Invalid:   []any{65536.0, -1.0},
	},
	minimum: 0,
	maximum: 65535,
}

// Regex is Text pattern: A regular expression, like ^[a-z]+$.
//
// An ECMA-262 regular expression source: validation rules and matchers stored as data. Prefer enum when the acceptable values are simply a closed set.
var Regex = &scalarRegex

var scalarRegex = TextScalar{
	Meta: Meta{
		Name:      "regex",
		Label:     "Text pattern",
		Hint:      "A regular expression, like ^[a-z]+$",
		Error:     "That regular expression looks wrong. Try ^[a-z]+$.",
		Details:   "An ECMA-262 regular expression source: validation rules and matchers stored as data. Prefer enum when the acceptable values are simply a closed set.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"regexp", "regular_expression"},
		Valid:     []any{"^[a-z][a-z0-9_]*$", "\\d+"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// RelativeJsonPointer is Relative JSON Pointer: Steps up, then a path, like 1/name.
//
// A JSON Pointer relative to a known position (1/name). Prefer json_pointer when addressing from the document root.
var RelativeJsonPointer = &scalarRelativeJsonPointer

var scalarRelativeJsonPointer = TextScalar{
	Meta: Meta{
		Name:      "relative_json_pointer",
		Label:     "Relative JSON Pointer",
		Hint:      "Steps up, then a path, like 1/name",
		Error:     "Please start with a number, like 1/name.",
		Details:   "A JSON Pointer relative to a known position (1/name). Prefer json_pointer when addressing from the document root.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"relative_pointer"},
		Valid:     []any{"1/name", "0", "2#"},
		Invalid:   []any{"/name", "01/name"},
	},
	steps:   []step{},
	pattern: `^(0|[1-9][0-9]*)(#|(/([^~/]|~[01])*)*)$`,
	minLen:  1,
	maxLen:  noMax,
}

// Secret is Secret: Kept hidden, like a password.
//
// Sensitive text that must never be displayed or logged: passwords, API keys. The format is a masking hint, not protection - hash or encrypt at rest.
var Secret = &scalarSecret

var scalarSecret = TextScalar{
	Meta: Meta{
		Name:      "secret",
		Label:     "Secret",
		Hint:      "Kept hidden, like a password",
		Error:     "Please type the secret.",
		Details:   "Sensitive text that must never be displayed or logged: passwords, API keys. The format is a masking hint, not protection - hash or encrypt at rest.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"password", "api_key"},
		Valid:     []any{"••••••••", "correct horse battery staple"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Semver is Version number: Major.minor.patch, like 1.4.2.
//
// A Semantic Version (1.4.2-rc.1): package and API versions with defined precedence. Prefer string for version-ish labels that do not follow SemVer.
var Semver = &scalarSemver

var scalarSemver = TextScalar{
	Meta: Meta{
		Name:      "semver",
		Label:     "Version number",
		Hint:      "Major.minor.patch, like 1.4.2",
		Error:     "Please use three numbers with dots, like 1.4.2-rc.1.",
		Details:   "A Semantic Version (1.4.2-rc.1): package and API versions with defined precedence. Prefer string for version-ish labels that do not follow SemVer.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"version", "semantic_version"},
		Valid:     []any{"1.4.2-rc.1", "0.0.1", "2.0.0+build.5"},
		Invalid:   []any{"1.4", "01.4.2"},
	},
	steps:   []step{},
	pattern: `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$`,
	minLen:  5,
	maxLen:  noMax,
}

// SfBinary is Header bytes: Base64 between colons.
//
// An HTTP Structured Fields byte sequence (colon-delimited base64): binary members of structured headers. Prefer base64 outside header serialization.
var SfBinary = &scalarSfBinary

var scalarSfBinary = TextScalar{
	Meta: Meta{
		Name:      "sf_binary",
		Label:     "Header bytes",
		Hint:      "Base64 between colons",
		Error:     "Please wrap base64 in colons, like :aGVsbG8=:.",
		Details:   "An HTTP Structured Fields byte sequence (colon-delimited base64): binary members of structured headers. Prefer base64 outside header serialization.",
		Level:     "domain",
		Primitive: "binary",
		Aliases:   []string{"structured_binary"},
		Valid:     []any{":aGVsbG8=:", "::"},
		Invalid:   []any{"aGVsbG8=", "::x"},
	},
	steps:   []step{},
	pattern: `^:[A-Za-z0-9+/]*={0,2}:$`,
	minLen:  2,
	maxLen:  noMax,
}

// SfBoolean is Header yes/no: True or false.
//
// An HTTP Structured Fields boolean (?1 / ?0): flags in structured headers. Prefer boolean outside header serialization.
var SfBoolean = &scalarSfBoolean

var scalarSfBoolean = BoolScalar{
	Meta: Meta{
		Name:      "sf_boolean",
		Label:     "Header yes/no",
		Hint:      "True or false",
		Error:     "Please pick true or false.",
		Details:   "An HTTP Structured Fields boolean (?1 / ?0): flags in structured headers. Prefer boolean outside header serialization.",
		Level:     "domain",
		Primitive: "boolean",
		Aliases:   []string{"structured_boolean"},
		Valid:     []any{true, false},
		Invalid:   []any{"?1"},
	},
}

// SfDecimal is Header decimal: Up to 3 digits after the dot.
//
// An HTTP Structured Fields decimal (three fractional digits): weights and q-values in headers. Prefer decimal outside header serialization.
var SfDecimal = &scalarSfDecimal

var scalarSfDecimal = NumberScalar{
	Meta: Meta{
		Name:      "sf_decimal",
		Label:     "Header decimal",
		Hint:      "Up to 3 digits after the dot",
		Error:     "Please use a number with at most 3 decimals, like 4.5.",
		Details:   "An HTTP Structured Fields decimal (three fractional digits): weights and q-values in headers. Prefer decimal outside header serialization.",
		Level:     "domain",
		Primitive: "float64",
		Aliases:   []string{"structured_decimal"},
		Valid:     []any{4.5, -999999999999.999},
		Invalid:   []any{"4.5"},
	},
	minimum: -math.MaxFloat64,
	maximum: math.MaxFloat64,
}

// SfInteger is Header number: Up to 15 digits.
//
// An HTTP Structured Fields integer (15 digits max): numeric members of structured headers. Prefer int64 outside header serialization.
var SfInteger = &scalarSfInteger

var scalarSfInteger = IntScalar{
	Meta: Meta{
		Name:      "sf_integer",
		Label:     "Header number",
		Hint:      "Up to 15 digits",
		Error:     "Please use a whole number with up to 15 digits.",
		Details:   "An HTTP Structured Fields integer (15 digits max): numeric members of structured headers. Prefer int64 outside header serialization.",
		Level:     "domain",
		Primitive: "int32",
		Aliases:   []string{"structured_integer"},
		Valid:     []any{42.0, -999999999999999.0},
		Invalid:   []any{1000000000000000.0, 1.5},
	},
	minimum: -999999999999999,
	maximum: 999999999999999,
}

// SfString is Header text: Plain ASCII characters only.
//
// An HTTP Structured Fields quoted string (printable ASCII): textual members of structured headers. Prefer string outside header serialization.
var SfString = &scalarSfString

var scalarSfString = TextScalar{
	Meta: Meta{
		Name:      "sf_string",
		Label:     "Header text",
		Hint:      "Plain ASCII characters only",
		Error:     "Please use plain ASCII characters, like hello world.",
		Details:   "An HTTP Structured Fields quoted string (printable ASCII): textual members of structured headers. Prefer string outside header serialization.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"structured_string"},
		Valid:     []any{"hello world", ""},
		Invalid:   []any{"tab\there", "café"},
	},
	steps:   []step{},
	pattern: `^[\x20-\x7E]*$`,
	minLen:  0,
	maxLen:  noMax,
}

// SfToken is Header token: A short word like gzip.
//
// An HTTP Structured Fields token like gzip: short symbolic header values. Prefer enum for closed sets outside HTTP.
var SfToken = &scalarSfToken

var scalarSfToken = TextScalar{
	Meta: Meta{
		Name:      "sf_token",
		Label:     "Header token",
		Hint:      "A short word like gzip",
		Error:     "Please start with a letter, no spaces, like gzip.",
		Details:   "An HTTP Structured Fields token like gzip: short symbolic header values. Prefer enum for closed sets outside HTTP.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"structured_token"},
		Valid:     []any{"gzip", "*", "text/html"},
		Invalid:   []any{"1gzip", "gz ip"},
	},
	steps:   []step{},
	pattern: "^[A-Za-z*][A-Za-z0-9:/!#$%&'*+\\-.^_`|~]*$",
	minLen:  1,
	maxLen:  noMax,
}

// Sha256 is SHA-256 hash: 64 hex characters.
//
// A SHA-256 digest: content addressing, integrity checks, dedup keys. Never for passwords - those take a dedicated password hash stored as secret.
var Sha256 = &scalarSha256

var scalarSha256 = TextScalar{
	Meta: Meta{
		Name:      "sha256",
		Label:     "SHA-256 hash",
		Hint:      "64 hex characters",
		Error:     "Needs 64 hex characters, like e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.",
		Details:   "A SHA-256 digest: content addressing, integrity checks, dedup keys. Never for passwords - those take a dedicated password hash stored as secret.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"hash", "digest"},
		Valid:     []any{"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855"},
		Invalid:   []any{"e3b0", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"},
	},
	steps:   []step{},
	pattern: `^[A-Fa-f0-9]{64}$`,
	minLen:  64,
	maxLen:  64,
}

// Slug is Web address name: Small letters, digits and dashes.
//
// A lowercase-hyphen URL token (getting-started): readable path segments derived from a title. Presentation identity only - prefer uuid as the real key.
var Slug = &scalarSlug

var scalarSlug = TextScalar{
	Meta: Meta{
		Name:      "slug",
		Label:     "Web address name",
		Hint:      "Small letters, digits and dashes",
		Error:     "Use small letters, digits and single dashes, like getting-started.",
		Details:   "A lowercase-hyphen URL token (getting-started): readable path segments derived from a title. Presentation identity only - prefer uuid as the real key.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"permalink", "url_name"},
		Valid:     []any{"getting-started", "a", "v2-release-notes"},
		Invalid:   []any{"Getting-Started", "getting--started"},
	},
	steps:   []step{stepTrim, stepLowercase},
	pattern: `^[a-z0-9]+(-[a-z0-9]+)*$`,
	minLen:  1,
	maxLen:  noMax,
}

// String is Short text: A few words, like a name or a title.
//
// Single-line text where a length bound is meaningful: names, titles, labels. Prefer text when there is no maximum, and enum when the values form a closed set.
var String = &scalarString

var scalarString = TextScalar{
	Meta: Meta{
		Name:      "string",
		Label:     "Short text",
		Hint:      "A few words, like a name or a title",
		Error:     "Please type some text.",
		Details:   "Single-line text where a length bound is meaningful: names, titles, labels. Prefer text when there is no maximum, and enum when the values form a closed set.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"short_text", "varchar"},
		Valid:     []any{"hello", "Ada Lovelace"},
		Invalid:   []any{42.0, nil},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Subdivision is State or region: Country, dash, region, like US-CA.
//
// An ISO 3166-2 subdivision code (US-CA): states, provinces, regions. Carries its country prefix, so no separate country field is needed to interpret it.
var Subdivision = &scalarSubdivision

var scalarSubdivision = TextScalar{
	Meta: Meta{
		Name:      "subdivision",
		Label:     "State or region",
		Hint:      "Country, dash, region, like US-CA",
		Error:     "Please use country-region, like US-CA.",
		Details:   "An ISO 3166-2 subdivision code (US-CA): states, provinces, regions. Carries its country prefix, so no separate country field is needed to interpret it.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"region", "state", "province"},
		Valid:     []any{"US-CA", "GB-ENG", "FR-75C"},
		Invalid:   []any{"US_CA", "US-"},
	},
	steps:   []step{stepTrim, stepUppercase},
	pattern: `^[A-Z]{2}-[A-Z0-9]{1,3}$`,
	minLen:  4,
	maxLen:  6,
}

// Text is Long text: As many lines as you need.
//
// Unbounded prose: article bodies, comments, logs. Prefer string when a length limit is part of the contract.
var Text = &scalarText

var scalarText = TextScalar{
	Meta: Meta{
		Name:      "text",
		Label:     "Long text",
		Hint:      "As many lines as you need",
		Error:     "Please type some text.",
		Details:   "Unbounded prose: article bodies, comments, logs. Prefer string when a length limit is part of the contract.",
		Level:     "core",
		Primitive: "text",
		Aliases:   []string{"long_text", "paragraph"},
		Valid:     []any{"unbounded multi-line body", "Line one\nLine two"},
		Invalid:   []any{[]any{"not", "text"}},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Time is Time with offset: Like 14:30:00Z or 14:30:00+02:00.
//
// A wall-clock time with an explicit UTC offset. Prefer time_local for schedules that float with the local zone.
var Time = &scalarTime

var scalarTime = TextScalar{
	Meta: Meta{
		Name:      "time",
		Label:     "Time with offset",
		Hint:      "Like 14:30:00Z or 14:30:00+02:00",
		Error:     "Please add the zone offset, like 14:30:00Z.",
		Details:   "A wall-clock time with an explicit UTC offset. Prefer time_local for schedules that float with the local zone.",
		Level:     "advanced",
		Primitive: "time_local",
		Aliases:   []string{"timetz", "offset_time"},
		Valid:     []any{"14:30:00Z", "09:05:30.250+05:30"},
		Invalid:   []any{"14:30:00", "2:30 PM"},
	},
	steps:   []step{},
	pattern: `^[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?([Zz]|[+-][0-9]{2}:[0-9]{2})$`,
	minLen:  9,
	maxLen:  noMax,
}

// TimeLocal is Time of day: Hours:minutes:seconds, like 14:30:00.
//
// A wall-clock time with no offset: daily schedules like 'every day at 14:30' that follow whatever zone applies. Pair with timezone when the zone is fixed.
var TimeLocal = &scalarTimeLocal

var scalarTimeLocal = TextScalar{
	Meta: Meta{
		Name:      "time_local",
		Label:     "Time of day",
		Hint:      "Hours:minutes:seconds, like 14:30:00",
		Error:     "Please use hours:minutes:seconds, like 14:30:00.",
		Details:   "A wall-clock time with no offset: daily schedules like 'every day at 14:30' that follow whatever zone applies. Pair with timezone when the zone is fixed.",
		Level:     "core",
		Primitive: "time_local",
		Aliases:   []string{"time_of_day", "local_time"},
		Valid:     []any{"14:30:00", "09:05:30.250"},
		Invalid:   []any{"14:30", "14:30:00Z"},
	},
	steps:   []step{},
	pattern: `^[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?$`,
	minLen:  8,
	maxLen:  noMax,
}

// Timezone is Time zone: A region and city, like America/New_York.
//
// An IANA zone name like America/New_York: user preferences and scheduling context. Store the name, never a raw offset - offsets change with DST and law.
var Timezone = &scalarTimezone

var scalarTimezone = TextScalar{
	Meta: Meta{
		Name:      "timezone",
		Label:     "Time zone",
		Hint:      "A region and city, like America/New_York",
		Error:     "Please pick a time zone, like America/New_York.",
		Details:   "An IANA zone name like America/New_York: user preferences and scheduling context. Store the name, never a raw offset - offsets change with DST and law.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"tz", "time_zone"},
		Valid:     []any{"America/New_York", "UTC", "America/Argentina/Buenos_Aires"},
		Invalid:   []any{"New York", "America/New York"},
	},
	steps:   []step{},
	pattern: `^(UTC|[A-Za-z_]+/[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)?)$`,
	minLen:  3,
	maxLen:  noMax,
}

// Uint16 is Small count: From 0 to 65535.
//
// Unsigned 16-bit integers (0..65535). Prefer port for network ports specifically, and int32 when a negative value could ever appear.
var Uint16 = &scalarUint16

var scalarUint16 = IntScalar{
	Meta: Meta{
		Name:      "uint16",
		Label:     "Small count",
		Hint:      "From 0 to 65535",
		Error:     "Please use a whole number from 0 to 65535.",
		Details:   "Unsigned 16-bit integers (0..65535). Prefer port for network ports specifically, and int32 when a negative value could ever appear.",
		Level:     "advanced",
		Primitive: "int32",
		Aliases:   []string{"ushort"},
		Valid:     []any{8080.0, 65535.0},
		Invalid:   []any{65536.0, -1.0},
	},
	minimum: 0,
	maximum: 65535,
}

// Uint32 is Count: From 0 to 4294967295.
//
// Unsigned 32-bit integers: large counters and IDs from systems that use them. Prefer int64 in new designs; signed types survive arithmetic and language boundaries better.
var Uint32 = &scalarUint32

var scalarUint32 = IntScalar{
	Meta: Meta{
		Name:      "uint32",
		Label:     "Count",
		Hint:      "From 0 to 4294967295",
		Error:     "Please use a whole number from 0 to 4294967295.",
		Details:   "Unsigned 32-bit integers: large counters and IDs from systems that use them. Prefer int64 in new designs; signed types survive arithmetic and language boundaries better.",
		Level:     "advanced",
		Primitive: "int32",
		Aliases:   []string{"uint", "unsigned"},
		Valid:     []any{3000000000.0, 4294967295.0},
		Invalid:   []any{4294967296.0, -1.0},
	},
	minimum: 0,
	maximum: 4294967295,
}

// Uint64 is Huge count: Digits only, no minus sign.
//
// The full unsigned 64-bit range: hashes and foreign systems' identifiers. Most languages and JSON cannot represent the upper half natively, so values travel as strings; prefer int64 unless the source really uses all 64 bits.
var Uint64 = &scalarUint64

var scalarUint64 = TextScalar{
	Meta: Meta{
		Name:      "uint64",
		Label:     "Huge count",
		Hint:      "Digits only, no minus sign",
		Error:     "Please use only digits, like 18446744073709551615.",
		Details:   "The full unsigned 64-bit range: hashes and foreign systems' identifiers. Most languages and JSON cannot represent the upper half natively, so values travel as strings; prefer int64 unless the source really uses all 64 bits.",
		Level:     "advanced",
		Primitive: "int64",
		Aliases:   []string{"ulong"},
		Valid:     []any{"18446744073709551615", "0"},
		Invalid:   []any{"-1", "1.5"},
	},
	steps:   []step{},
	pattern: `^[0-9]+$`,
	minLen:  1,
	maxLen:  noMax,
}

// Uint8 is Tiny count: From 0 to 255.
//
// Unsigned bytes (0..255): color channels, small numeric codes. Prefer int32 unless the byte range is intrinsic to the data.
var Uint8 = &scalarUint8

var scalarUint8 = IntScalar{
	Meta: Meta{
		Name:      "uint8",
		Label:     "Tiny count",
		Hint:      "From 0 to 255",
		Error:     "Please use a whole number from 0 to 255.",
		Details:   "Unsigned bytes (0..255): color channels, small numeric codes. Prefer int32 unless the byte range is intrinsic to the data.",
		Level:     "advanced",
		Primitive: "int32",
		Aliases:   []string{"ubyte"},
		Valid:     []any{200.0, 0.0, 255.0},
		Invalid:   []any{256.0, -1.0},
	},
	minimum: 0,
	maximum: 255,
}

// Ulid is Sortable ID: 26 letters and digits.
//
// A lexically sortable 128-bit ID in Crockford Base32: time-ordered keys that stay readable as text. Prefer uuid_v7 where native UUID column types and tooling matter.
var Ulid = &scalarUlid

var scalarUlid = TextScalar{
	Meta: Meta{
		Name:      "ulid",
		Label:     "Sortable ID",
		Hint:      "26 letters and digits",
		Error:     "Please use 26 letters and digits, like 01ARZ3NDEKTSV4RRFFQ69G5FAV.",
		Details:   "A lexically sortable 128-bit ID in Crockford Base32: time-ordered keys that stay readable as text. Prefer uuid_v7 where native UUID column types and tooling matter.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"sortable_id"},
		Valid:     []any{"01ARZ3NDEKTSV4RRFFQ69G5FAV", "7ZZZZZZZZZZZZZZZZZZZZZZZZZ"},
		Invalid:   []any{"01ARZ3NDEKTSV4RRFFQ69G5FA", "81ARZ3NDEKTSV4RRFFQ69G5FAV", "01ARZ3NDEKTSV4RRFFQ69G5FAI"},
	},
	steps:   []step{},
	pattern: `^[0-7][0-9A-HJKMNP-TV-Z]{25}$`,
	minLen:  26,
	maxLen:  26,
}

// UnixTime is Unix timestamp: Seconds since 1970-01-01.
//
// Seconds since the Unix epoch as an integer: compact machine timestamps and TTLs. Prefer date_time for anything humans or APIs read directly.
var UnixTime = &scalarUnixTime

var scalarUnixTime = IntScalar{
	Meta: Meta{
		Name:      "unix_time",
		Label:     "Unix timestamp",
		Hint:      "Seconds since 1970-01-01",
		Error:     "Please use whole seconds since 1970, like 1786000000.",
		Details:   "Seconds since the Unix epoch as an integer: compact machine timestamps and TTLs. Prefer date_time for anything humans or APIs read directly.",
		Level:     "advanced",
		Primitive: "int32",
		Aliases:   []string{"epoch", "epoch_seconds"},
		Valid:     []any{1786000000.0, 0.0, -86400.0},
		Invalid:   []any{1.5},
	},
	minimum: math.MinInt64,
	maximum: math.MaxInt64,
}

// Uri is Web link: Like https://example.com/page.
//
// An absolute URI with scheme: links, webhooks, resource locators. Use string for relative paths.
var Uri = &scalarUri

var scalarUri = TextScalar{
	Meta: Meta{
		Name:      "uri",
		Label:     "Web link",
		Hint:      "Like https://example.com/page",
		Error:     "That link looks wrong. Try https://example.com/page.",
		Details:   "An absolute URI with scheme: links, webhooks, resource locators. Use string for relative paths.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"url", "link", "website"},
		Valid:     []any{"https://example.com/a/b?c=1", "mailto:user@example.com", "urn:isbn:9780306406157"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// UriReference is Link or path: A full link or a path like /a/b.
//
// A URI reference, absolute or relative: redirect targets, in-site paths. Prefer uri when an absolute, scheme-carrying value is required.
var UriReference = &scalarUriReference

var scalarUriReference = TextScalar{
	Meta: Meta{
		Name:      "uri_reference",
		Label:     "Link or path",
		Hint:      "A full link or a path like /a/b",
		Error:     "That link or path looks wrong. Try /a/b?c=1.",
		Details:   "A URI reference, absolute or relative: redirect targets, in-site paths. Prefer uri when an absolute, scheme-carrying value is required.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"relative_url", "href"},
		Valid:     []any{"/a/b?c=1", "../up", "#fragment"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// UriTemplate is Link template: A link with {placeholders}.
//
// An RFC 6570 URL pattern with {variables}: route and link templates. Prefer uri for concrete, already-expanded links.
var UriTemplate = &scalarUriTemplate

var scalarUriTemplate = TextScalar{
	Meta: Meta{
		Name:      "uri_template",
		Label:     "Link template",
		Hint:      "A link with {placeholders}",
		Error:     "That template looks wrong. Try /users/{id}.",
		Details:   "An RFC 6570 URL pattern with {variables}: route and link templates. Prefer uri for concrete, already-expanded links.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"url_template"},
		Valid:     []any{"/users/{id}{?fields}", "https://api.example.com{/version}/items"},
		Invalid:   []any{},
	},
	steps:   []step{},
	pattern: "",
	minLen:  0,
	maxLen:  noMax,
}

// Uuid is Unique ID: A long ID with dashes, made by the computer.
//
// A 128-bit universal identifier, any version: primary keys and references. Which version to mint (such as time-ordered v7) is a generation option, not a separate type.
var Uuid = &scalarUuid

var scalarUuid = TextScalar{
	Meta: Meta{
		Name:      "uuid",
		Label:     "Unique ID",
		Hint:      "A long ID with dashes, made by the computer",
		Error:     "That ID looks wrong. It should look like f81d4fae-7dec-11d0-a765-00a0c91e6bf6.",
		Details:   "A 128-bit universal identifier, any version: primary keys and references. Which version to mint (such as time-ordered v7) is a generation option, not a separate type.",
		Level:     "core",
		Primitive: "string",
		Aliases:   []string{"guid", "unique_id"},
		Valid:     []any{"f81d4fae-7dec-11d0-a765-00a0c91e6bf6", "F81D4FAE-7DEC-11D0-A765-00A0C91E6BF6"},
		Invalid:   []any{"f81d4fae7dec11d0a76500a0c91e6bf6", "f81d4fae-7dec-11d0-a765-00a0c91e6bfg"},
	},
	steps:   []step{stepTrim, stepLowercase},
	pattern: `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`,
	minLen:  36,
	maxLen:  36,
}

// UuidV7 is Time-ordered ID: A unique ID that sorts by time.
//
// A time-ordered UUID: new primary keys that index and sort by creation time. Prefer uuid when accepting identifiers you did not mint.
var UuidV7 = &scalarUuidV7

var scalarUuidV7 = TextScalar{
	Meta: Meta{
		Name:      "uuid_v7",
		Label:     "Time-ordered ID",
		Hint:      "A unique ID that sorts by time",
		Error:     "It needs a 7 after the second dash, like 018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e6f.",
		Details:   "A time-ordered UUID: new primary keys that index and sort by creation time. Prefer uuid when accepting identifiers you did not mint.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"uuidv7"},
		Valid:     []any{"018f4b2c-9c1e-7a3b-8f2d-1a2b3c4d5e6f", "018F4B2C-9C1E-7A3B-BF2D-1A2B3C4D5E6F"},
		Invalid:   []any{"f81d4fae-7dec-11d0-a765-00a0c91e6bf6", "018f4b2c-9c1e-7a3b-cf2d-1a2b3c4d5e6f"},
	},
	steps:   []step{stepTrim, stepLowercase},
	pattern: `^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`,
	minLen:  36,
	maxLen:  36,
}

// WikidataQid is Wikidata ID: Q and a number, like Q42.
//
// A Wikidata entity ID (Q42): linking records to globally known entities. Prefer the domain registry when one exists - doi, orcid, lei, isbn.
var WikidataQid = &scalarWikidataQid

var scalarWikidataQid = TextScalar{
	Meta: Meta{
		Name:      "wikidata_qid",
		Label:     "Wikidata ID",
		Hint:      "Q and a number, like Q42",
		Error:     "Please use Q and a number, like Q42.",
		Details:   "A Wikidata entity ID (Q42): linking records to globally known entities. Prefer the domain registry when one exists - doi, orcid, lei, isbn.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"qid"},
		Valid:     []any{"Q42", "Q1"},
		Invalid:   []any{"Q0", "42"},
	},
	steps:   []step{},
	pattern: `^Q[1-9][0-9]*$`,
	minLen:  2,
	maxLen:  noMax,
}

// All is every type, in catalogue order.
var All = []*Meta{
	&scalarAny.Meta,
	&scalarArray.Meta,
	&scalarBase64.Meta,
	&scalarBase64url.Meta,
	&scalarBic.Meta,
	&scalarBinary.Meta,
	&scalarBoolean.Meta,
	&scalarChar.Meta,
	&scalarCidr.Meta,
	&scalarColor.Meta,
	&scalarCommonmark.Meta,
	&scalarCountry.Meta,
	&scalarCountryAlpha3.Meta,
	&scalarCron.Meta,
	&scalarCssColor.Meta,
	&scalarCurrency.Meta,
	&scalarDate.Meta,
	&scalarDateTime.Meta,
	&scalarDateTimeLocal.Meta,
	&scalarDecimal.Meta,
	&scalarDecimal128.Meta,
	&scalarDoi.Meta,
	&scalarDoubleInt.Meta,
	&scalarDuration.Meta,
	&scalarEmail.Meta,
	&scalarEnum.Meta,
	&scalarFloat32.Meta,
	&scalarFloat64.Meta,
	&scalarGtin.Meta,
	&scalarHostname.Meta,
	&scalarHtml.Meta,
	&scalarHttpDate.Meta,
	&scalarIban.Meta,
	&scalarIdnEmail.Meta,
	&scalarIdnHostname.Meta,
	&scalarInt16.Meta,
	&scalarInt32.Meta,
	&scalarInt64.Meta,
	&scalarInt8.Meta,
	&scalarIpv4.Meta,
	&scalarIpv4Cidr.Meta,
	&scalarIpv6.Meta,
	&scalarIpv6Cidr.Meta,
	&scalarIri.Meta,
	&scalarIriReference.Meta,
	&scalarIsbn.Meta,
	&scalarJsonPointer.Meta,
	&scalarJwt.Meta,
	&scalarLanguage.Meta,
	&scalarLei.Meta,
	&scalarLocale.Meta,
	&scalarMacAddress.Meta,
	&scalarMediaRange.Meta,
	&scalarMediaType.Meta,
	&scalarObject.Meta,
	&scalarOrcid.Meta,
	&scalarPhone.Meta,
	&scalarPort.Meta,
	&scalarRegex.Meta,
	&scalarRelativeJsonPointer.Meta,
	&scalarSecret.Meta,
	&scalarSemver.Meta,
	&scalarSfBinary.Meta,
	&scalarSfBoolean.Meta,
	&scalarSfDecimal.Meta,
	&scalarSfInteger.Meta,
	&scalarSfString.Meta,
	&scalarSfToken.Meta,
	&scalarSha256.Meta,
	&scalarSlug.Meta,
	&scalarString.Meta,
	&scalarSubdivision.Meta,
	&scalarText.Meta,
	&scalarTime.Meta,
	&scalarTimeLocal.Meta,
	&scalarTimezone.Meta,
	&scalarUint16.Meta,
	&scalarUint32.Meta,
	&scalarUint64.Meta,
	&scalarUint8.Meta,
	&scalarUlid.Meta,
	&scalarUnixTime.Meta,
	&scalarUri.Meta,
	&scalarUriReference.Meta,
	&scalarUriTemplate.Meta,
	&scalarUuid.Meta,
	&scalarUuidV7.Meta,
	&scalarWikidataQid.Meta,
}

// Lookup returns the typed scalar (*TextScalar, *IntScalar, ...) with exactly this name, or nil.
func Lookup(name string) any {
	switch name {
	case "any":
		return Any
	case "array":
		return Array
	case "base64":
		return Base64
	case "base64url":
		return Base64url
	case "bic":
		return Bic
	case "binary":
		return Binary
	case "boolean":
		return Boolean
	case "char":
		return Char
	case "cidr":
		return Cidr
	case "color":
		return Color
	case "commonmark":
		return Commonmark
	case "country":
		return Country
	case "country_alpha3":
		return CountryAlpha3
	case "cron":
		return Cron
	case "css_color":
		return CssColor
	case "currency":
		return Currency
	case "date":
		return Date
	case "date_time":
		return DateTime
	case "date_time_local":
		return DateTimeLocal
	case "decimal":
		return Decimal
	case "decimal128":
		return Decimal128
	case "doi":
		return Doi
	case "double_int":
		return DoubleInt
	case "duration":
		return Duration
	case "email":
		return Email
	case "enum":
		return Enum
	case "float32":
		return Float32
	case "float64":
		return Float64
	case "gtin":
		return Gtin
	case "hostname":
		return Hostname
	case "html":
		return Html
	case "http_date":
		return HttpDate
	case "iban":
		return Iban
	case "idn_email":
		return IdnEmail
	case "idn_hostname":
		return IdnHostname
	case "int16":
		return Int16
	case "int32":
		return Int32
	case "int64":
		return Int64
	case "int8":
		return Int8
	case "ipv4":
		return Ipv4
	case "ipv4_cidr":
		return Ipv4Cidr
	case "ipv6":
		return Ipv6
	case "ipv6_cidr":
		return Ipv6Cidr
	case "iri":
		return Iri
	case "iri_reference":
		return IriReference
	case "isbn":
		return Isbn
	case "json_pointer":
		return JsonPointer
	case "jwt":
		return Jwt
	case "language":
		return Language
	case "lei":
		return Lei
	case "locale":
		return Locale
	case "mac_address":
		return MacAddress
	case "media_range":
		return MediaRange
	case "media_type":
		return MediaType
	case "object":
		return Object
	case "orcid":
		return Orcid
	case "phone":
		return Phone
	case "port":
		return Port
	case "regex":
		return Regex
	case "relative_json_pointer":
		return RelativeJsonPointer
	case "secret":
		return Secret
	case "semver":
		return Semver
	case "sf_binary":
		return SfBinary
	case "sf_boolean":
		return SfBoolean
	case "sf_decimal":
		return SfDecimal
	case "sf_integer":
		return SfInteger
	case "sf_string":
		return SfString
	case "sf_token":
		return SfToken
	case "sha256":
		return Sha256
	case "slug":
		return Slug
	case "string":
		return String
	case "subdivision":
		return Subdivision
	case "text":
		return Text
	case "time":
		return Time
	case "time_local":
		return TimeLocal
	case "timezone":
		return Timezone
	case "uint16":
		return Uint16
	case "uint32":
		return Uint32
	case "uint64":
		return Uint64
	case "uint8":
		return Uint8
	case "ulid":
		return Ulid
	case "unix_time":
		return UnixTime
	case "uri":
		return Uri
	case "uri_reference":
		return UriReference
	case "uri_template":
		return UriTemplate
	case "uuid":
		return Uuid
	case "uuid_v7":
		return UuidV7
	case "wikidata_qid":
		return WikidataQid
	}
	return nil
}
