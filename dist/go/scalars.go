// Code generated from dist/scalars.json by dev/codegen/go.mjs. DO NOT EDIT.
// scalars.go, catalogue version 0.6.1. Run `npm run build` in dev/ to regenerate.
// Requires Go >= 1.21 and golang.org/x/text (tested with v0.21.0 on Go 1.26.3).

// Package scalars has one typed value per scalar type, each with Normalize (text), Validate and IsValid.
package scalars

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
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
	Params                                              []string // names from $meta.params that a field of this type can set
	Valid, Invalid                                      []any
	Check                                               string // the rule beyond the pattern ($meta.checks), or ""
}

// paramRule is the limits of one setting in $meta.params. A limit it does not have is the widest int64
// (minimum, maximum) or 0 (minItems, maxItemBytes). Tables of these are arrays of literals, so Go builds them statically.
type paramRule struct {
	name, kind string
	minimum    int64
	maximum    int64
	minItems     int
	maxItemBytes int
}

// errorTemplate is the message template of one error code in $meta.errors; "{name}" is replaced by a param.
type errorTemplate struct{ code, text string }

// ScalarError is a value that failed a type's rule. Error returns the type's error text; Reason is the first
// rule the value broke.
type ScalarError struct {
	Scalar *Meta
	Reason Reason
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

// checkKind is one rule of $meta.checks. The generator writes each type's rule as these constants.
type checkKind uint8

const (
	checkNone checkKind = iota
	checkGs1Mod10
	checkIso7064Mod9710 // iso7064_mod97_10 (ISO 7064 MOD 97-10)
	checkIban
	checkIsbn
	checkIso7064Mod112 // iso7064_mod11_2 (ISO 7064 MOD 11-2)
	checkInt64Range
	checkUint64Range
)

// passes runs the rule on normalized text that matched the pattern, so it reads ASCII bytes of the pattern's
// shape: digits where the pattern put digits. Every rule is O(n).
func (k checkKind) passes(s string) bool {
	switch k {
	case checkGs1Mod10:
		return gs1Mod10(s)
	case checkIso7064Mod9710:
		return mod97(s, 0)
	case checkIban:
		return mod97(s, 4)
	case checkIsbn:
		if len(s) == 13 {
			return gs1Mod10(s)
		}
		t := 0
		for i := 0; i < 10; i++ {
			d := int(s[i]) - '0'
			if s[i] == 'X' || s[i] == 'x' {
				d = 10
			}
			t += d * (10 - i)
		}
		return t%11 == 0
	case checkIso7064Mod112:
		t := 0
		for i := 0; i < len(s)-1; i++ {
			if s[i] != '-' {
				t = (t + int(s[i]) - '0') * 2 % 11 // reduced each step: exact at any length
			}
		}
		r := (12 - t%11) % 11
		want := byte('0' + r)
		if r == 10 {
			want = 'X'
		}
		return s[len(s)-1] == want
	case checkInt64Range:
		if s[0] == '-' {
			return atMost(s[1:], "9223372036854775808")
		}
		return atMost(s, "9223372036854775807")
	case checkUint64Range:
		return atMost(s, "18446744073709551615")
	}
	return true
}

func gs1Mod10(s string) bool {
	t := 0
	for i := 0; i < len(s); i++ {
		w := 1
		if i%2 == 1 {
			w = 3
		}
		t += (int(s[len(s)-1-i]) - '0') * w
	}
	return t%10 == 0
}

// mod97 is ISO 7064 MOD 97-10 over s[from:] then s[:from]: one pass, no rotated copy.
func mod97(s string, from int) bool {
	r := 0
	for k := 0; k < len(s); k++ {
		c := int(s[(from+k)%len(s)])
		if c >= 'A' {
			r = (r*100 + c - 'A' + 10) % 97 // A-Z are 10-35
		} else {
			r = (r*10 + c - '0') % 97
		}
	}
	return r == 1
}

// atMost compares digits with max as text: leading zeros skipped, then fewer digits is smaller.
func atMost(digits, max string) bool {
	i := 0
	for i < len(digits)-1 && digits[i] == '0' {
		i++
	}
	d := digits[i:]
	if len(d) != len(max) {
		return len(d) < len(max)
	}
	return d <= max
}

// noMax is the longest length of a type with no limit.
const noMax = int(^uint(0) >> 1)

// TextScalar is a type whose values are text. Its regex is compiled on first use.
type TextScalar struct {
	Meta
	steps   []step
	pattern string // "" when the type has none
	minLen  int    // shortest length in code points
	maxLen  int    // longest length in code points, noMax when unbounded
	rule    checkKind
	list    []string // the type's enum, sorted: a closed list, checked last by binary search (no map, so no init code)
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
	out, reason := t.check(s)
	if reason == "" {
		return out, nil
	}
	return "", &ScalarError{&t.Meta, reason}
}

// IsValid reports whether Validate would succeed. It never builds an error.
func (t *TextScalar) IsValid(s string) bool {
	_, reason := t.check(s)
	return reason == ""
}

// check returns the clean text and "", or "" and the first rule s broke.
func (t *TextScalar) check(s string) (string, Reason) {
	gated, formed := false, false
	for _, st := range t.steps {
		// Once trimming is done, before any other step: trim cannot make invalid bytes valid, but removing a
		// space or hyphen between two stray bytes could.
		if !formed && st != stepTrim {
			formed = true
			if reason := t.wellFormed(s); reason != "" {
				return "", reason
			}
		}
		// Text already too long is refused before case mapping copies it. The gate waits for the first case
		// step because case mapping never shortens text, but stepRemoveSpaces and stepRemoveHyphens do.
		if !gated && (st == stepLowercase || st == stepUppercase) {
			gated = true
			if longerThan(s, t.maxLen) {
				return "", ReasonTooLong
			}
		}
		s = apply(st, s)
	}
	if !formed {
		if reason := t.wellFormed(s); reason != "" {
			return "", reason
		}
	}
	if longerThan(s, t.maxLen) {
		return "", ReasonTooLong
	}
	if shorterThan(s, t.minLen) {
		return "", ReasonTooShort
	}
	if t.pattern != "" {
		t.once.Do(t.compile)
		if !t.re.MatchString(s) {
			return "", ReasonPattern
		}
	}
	if !t.rule.passes(s) {
		return "", ReasonCheck
	}
	if t.list != nil {
		if _, found := slices.BinarySearch(t.list, s); !found {
			return "", ReasonNotInList
		}
	}
	return s, ""
}

// wellFormed returns ReasonTooLong when trimmed text is already too long (unless a later step can shorten it;
// counting stops once the limit is passed), ReasonMalformed when it is not well-formed UTF-8 (Unicode scalar
// values only: WHATWG USVString, RFC 7493), else "". utf8.ValidString skips ASCII eight bytes at a time and
// allocates nothing.
func (t *TextScalar) wellFormed(s string) Reason {
	if !t.shortens() && longerThan(s, t.maxLen) {
		return ReasonTooLong
	}
	if !utf8.ValidString(s) {
		return ReasonMalformed
	}
	return ""
}

// shortens reports whether a step of the type can make text shorter.
func (t *TextScalar) shortens() bool {
	for _, st := range t.steps {
		if st == stepRemoveSpaces || st == stepRemoveHyphens {
			return true
		}
	}
	return false
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
	return 0, &ScalarError{&t.Meta, ReasonOutOfRange}
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
	return 0, &ScalarError{&t.Meta, ReasonOutOfRange}
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
	return codePoints(s) > limit
}

// shorterThan reports whether s has fewer than limit code points, settled by the byte length when it can be.
func shorterThan(s string, limit int) bool {
	if len(s) < limit {
		return true
	}
	if len(s)/utf8.UTFMax >= limit {
		return false
	}
	return codePoints(s) < limit
}

// codePoints counts code points as JS and Python do: like utf8.RuneCountInString, except that a lone surrogate
// encoded in 3 bytes (ED A0-BF 80-BF) counts as one, not three. Linear, and allocates nothing.
func codePoints(s string) int {
	n := 0
	for i := 0; i < len(s); n++ {
		if s[i] == 0xed && i+2 < len(s) && s[i+1] >= 0xa0 && s[i+1] <= 0xbf && s[i+2] >= 0x80 && s[i+2] <= 0xbf {
			i += 3
			continue
		}
		_, size := utf8.DecodeRuneInString(s[i:])
		i += size
	}
	return n
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

// Problem is one problem: an RFC 6901 Pointer, a fixed Code, the Params its message needs (never nil; each value
// a string, an int64 or a []string), and the English Message.
type Problem struct {
	Pointer string         `json:"pointer"`
	Code    string         `json:"code"`
	Params  map[string]any `json:"params"`
	Message string         `json:"message"`
}

func joinProblems(problems []Problem) string {
	var b strings.Builder
	for i, p := range problems {
		if i > 0 {
			b.WriteString("; ")
		}
		b.WriteString(p.Pointer)
		b.WriteString(": ")
		b.WriteString(p.Message)
	}
	return b.String()
}

// ModelsError is a refused models file. Problems lists every problem in it, sorted by location.
type ModelsError struct{ Problems []Problem }

func (e *ModelsError) Error() string { return joinProblems(e.Problems) }

// ModelError is a payload that failed its model. Problems lists every problem in it, sorted by location.
type ModelError struct{ Problems []Problem }

func (e *ModelError) Error() string { return joinProblems(e.Problems) }

// segment is one step of a location: a list index when idx >= 0, else a key.
type segment struct {
	key string
	idx int
}

func key(k string) segment { return segment{k, -1} }

// located is a problem with its decoded segments, which its order needs: a key "10" and an index 10 differ.
type located struct {
	segments []segment
	problem  Problem
}

// escapeSegment writes s to b as RFC 6901 does: "~" as "~0", "/" as "~1".
func escapeSegment(b *strings.Builder, s string) {
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '~':
			b.WriteString("~0")
		case '/':
			b.WriteString("~1")
		default:
			b.WriteByte(s[i])
		}
	}
}

// fill is the code's template with each "{name}" replaced: a list joined with ", ", a number in plain decimal.
func fill(text, code string, params map[string]any) string {
	if !strings.Contains(text, "{") {
		return text
	}
	var b strings.Builder
	for {
		open := strings.IndexByte(text, '{')
		end := strings.IndexByte(text[open+1:], '}')
		if open < 0 || end < 0 {
			b.WriteString(text)
			return b.String()
		}
		b.WriteString(text[:open])
		name := text[open+1 : open+1+end]
		v, ok := params[name]
		if !ok {
			panic(`scalars: code "` + code + `" needs param "` + name + `"`)
		}
		switch v := v.(type) {
		case string:
			b.WriteString(v)
		case int64:
			b.WriteString(strconv.FormatInt(v, 10))
		case []string:
			b.WriteString(strings.Join(v, ", "))
		default:
			panic(`scalars: param "` + name + `" of code "` + code + `" has no text form`)
		}
		text = text[open+1+end+1:]
	}
}

// locate builds a problem at segments. A code without a template (a reason like pattern, whose text is the type's Error)
// takes message.
func locate(segments []segment, code string, params map[string]any, message string) located {
	text, ok := catalogue.errors[code]
	if ok {
		text = fill(text, code, params)
	} else if message == "" {
		panic(`scalars: code "` + code + `" has no template, so it needs a message`)
	} else {
		text = message
	}
	var b strings.Builder
	for _, s := range segments {
		b.WriteByte('/')
		if s.idx >= 0 {
			b.WriteString(strconv.Itoa(s.idx))
		} else {
			escapeSegment(&b, s.key)
		}
	}
	return located{segments, Problem{b.String(), code, params, text}}
}

// compareLocated orders segment by segment: list indices numerically, keys by code point (Go compares UTF-8
// bytes, which is code-point order), an index before a key; a parent first; then by code.
func compareLocated(a, b located) int {
	x, y := a.segments, b.segments
	for i := 0; i < len(x) && i < len(y); i++ {
		sx, sy := x[i], y[i]
		switch {
		case sx.idx >= 0 && sy.idx >= 0:
			if sx.idx != sy.idx {
				return sx.idx - sy.idx
			}
		case sx.idx >= 0:
			return -1
		case sy.idx >= 0:
			return 1
		default:
			if c := strings.Compare(sx.key, sy.key); c != 0 {
				return c
			}
		}
	}
	if len(x) != len(y) {
		return len(x) - len(y)
	}
	return strings.Compare(a.problem.Code, b.problem.Code)
}

func sortedProblems(list []located) []Problem {
	slices.SortStableFunc(list, compareLocated)
	out := make([]Problem, len(list))
	for i, l := range list {
		out[i] = l.problem
	}
	return out
}

// isName reports whether s is a name: a lowercase letter, then lowercase letters, digits and underscores.
func isName(s string) bool {
	if s == "" || s[0] < 'a' || s[0] > 'z' {
		return false
	}
	for i := 1; i < len(s); i++ {
		if c := s[i]; !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_') {
			return false
		}
	}
	return true
}

// parseRef splits a written reference, `[domain:]name[.field]`, each part a name. Names hold no ":" or ".", so
// this is the reference's REF pattern without a regex.
func parseRef(s string) (domain, name, field string, ok bool) {
	if i := strings.IndexByte(s, ':'); i >= 0 {
		domain, s = s[:i], s[i+1:]
		if !isName(domain) {
			return "", "", "", false
		}
	}
	name = s
	if i := strings.IndexByte(s, '.'); i >= 0 {
		name, field = s[:i], s[i+1:]
		if !isName(field) {
			return "", "", "", false
		}
	}
	return domain, name, field, isName(name)
}

// typeInfo is one type as models use it: the typed scalar from Lookup and the settings a field of it takes.
type typeInfo struct {
	scalar   any
	meta     *Meta
	settings []string
}

// catalogue is built on the first Models call, not at program start.
var (
	catalogueOnce sync.Once
	catalogue     struct {
		types  map[string]*typeInfo // canonical name -> type
		rules  map[string]*paramRule
		errors map[string]string // code -> template
	}
)

func buildCatalogue() {
	catalogue.types = make(map[string]*typeInfo, len(All))
	for _, m := range All {
		t := Lookup(m.Name)
		settings := m.Params
		// Settings refused on number-kind types: float text differs by language, so digit counts can't agree.
		if _, number := t.(*NumberScalar); number {
			settings = nil
			for _, p := range m.Params {
				if p != "precision" && p != "scale" {
					settings = append(settings, p)
				}
			}
		}
		catalogue.types[m.Name] = &typeInfo{t, m, settings}
	}
	catalogue.rules = make(map[string]*paramRule, len(paramRules))
	for i := range paramRules {
		catalogue.rules[paramRules[i].name] = &paramRules[i]
	}
	catalogue.errors = make(map[string]string, len(errorTemplates))
	for _, e := range errorTemplates {
		catalogue.errors[e.code] = e.text
	}
}

// modelInt is a JSON number as an int64, when its value is integral and fits: 3.0 counts as 3.
func modelInt(v any) (int64, bool) {
	f, ok := v.(float64)
	if !ok || f != math.Trunc(f) || f < -(1<<63) || f >= 1<<63 {
		return 0, false
	}
	return int64(f), true
}

// check runs the typed scalar t on a JSON value: the cleaned value and "", or nil and the reason it failed
// (ReasonWrongKind when v is not the type's kind).
func check(t any, v any) (any, Reason) {
	switch t := t.(type) {
	case *TextScalar:
		if s, ok := v.(string); ok {
			return t.check(s)
		}
	case *IntScalar:
		if n, ok := modelInt(v); ok {
			if !t.IsValid(n) {
				return nil, ReasonOutOfRange
			}
			return n, ""
		}
	case *NumberScalar:
		if f, ok := v.(float64); ok {
			if !t.IsValid(f) {
				return nil, ReasonOutOfRange
			}
			return f, ""
		}
	case *BoolScalar:
		if b, ok := v.(bool); ok {
			return b, ""
		}
	case *ShapeScalar[map[string]any]:
		if m, ok := v.(map[string]any); ok {
			return m, ""
		}
	case *ShapeScalar[[]any]:
		if a, ok := v.([]any); ok {
			return a, ""
		}
	case *ShapeScalar[any]:
		return v, ""
	default:
		panic(fmt.Sprintf("scalars: no models check for scalar type %T", t))
	}
	return nil, ReasonWrongKind
}

type fieldKind uint8

const (
	kindType fieldKind = iota
	kindModel
	kindArray
)

// field is a resolved field: a type and its settings, a model (by full name), or an array of items.
type field struct {
	kind     fieldKind
	nullable bool
	typ      *typeInfo
	settings map[string]any // int64 or []string, as written; nil unless kind is kindType
	model    string
	target   *Model // the loaded Model named model, bound once the file has loaded
	items    *field
	// The settings validate reads, unpacked once here.
	length    int64 // 0 when absent (the least length is 1)
	values    []string
	allowed   map[string]struct{} // the set of values, built once per written list and shared by its copies
	precision int64               // 0 when absent (the least precision is 1)
	scale     int64
	limited   bool // whether validate has a setting to check after the type's own
}

func (f *field) unpack() {
	f.length, _ = f.settings["length"].(int64)
	f.values, _ = f.settings["values"].([]string)
	f.precision, _ = f.settings["precision"].(int64)
	f.scale, _ = f.settings["scale"].(int64)
	f.limited = f.length > 0 || f.values != nil || f.precision > 0
}

// marks is a node's Tarjan state; index 0 is unvisited.
type marks struct {
	index, low              int
	onStack, done, selfLoop bool
}

// vertex is a node of the resolution graph: a *modelDef or a *modelNode.
type vertex interface{ tarjan() *marks }

type refKind uint8

const (
	refNone refKind = iota
	refType
	refModel
	refField
)

// modelDef is a written field, or an `items` definition (linked to its parent instead of copying the path),
// during load.
type modelDef struct {
	segments []segment // nil for an `items` def
	up       *modelDef
	raw      any
	domain   string
	ref      refKind
	refType  *typeInfo
	refModel *modelNode
	refField *modelDef
	items    *modelDef
	field    *field
	leaf     *modelNode // the model this field nests, through any `items`
	arrays   int        // how many `items` levels lie on the way to it
	failed   bool
	marks
}

func (d *modelDef) tarjan() *marks { return &d.marks }

// path is the def's segments then extra, built only for a problem, so a deep `items` chain stays linear.
func (d *modelDef) path(extra ...segment) []segment {
	tail := 0
	for ; d.up != nil; d = d.up {
		tail++
	}
	out := make([]segment, 0, len(d.segments)+tail+len(extra))
	out = append(out, d.segments...)
	for i := 0; i < tail; i++ {
		out = append(out, key("items"))
	}
	return append(out, extra...)
}

// modelNode is a model during load.
type modelNode struct {
	name   string
	fields map[string]*modelDef
	list   []*modelDef
	marks
}

func (n *modelNode) tarjan() *marks { return &n.marks }

// loader is one load of a models file: the steps of dev/lib/models.mjs loadModels, in order.
type loader struct {
	problems []located
	nodes    map[string]*modelNode // "domain:model" -> model node
	defs     []*modelDef           // every written field
	fields   []*field              // every field resolve built, `items` included: Models binds their targets
}

func (l *loader) report(segments []segment, code string, params map[string]any) {
	if params == nil {
		params = map[string]any{}
	}
	l.problems = append(l.problems, locate(segments, code, params, ""))
}

// names is step 1. A badly named entry is reported and its content isn't examined.
func (l *loader) names(data map[string]any) {
	for d, domain := range data {
		if d == "$schema" {
			continue
		}
		if !isName(d) {
			l.report([]segment{key(d)}, "bad_name", nil)
			continue
		}
		models, ok := domain.(map[string]any)
		if !ok {
			l.report([]segment{key(d)}, "not_object", nil)
			continue
		}
		for m, raw := range models {
			if !isName(m) {
				l.report([]segment{key(d), key(m)}, "bad_name", nil)
				continue
			}
			if _, isType := catalogue.types[m]; isType {
				l.report([]segment{key(d), key(m)}, "type_name", nil)
				continue
			}
			fields, ok := raw.(map[string]any)
			if !ok {
				l.report([]segment{key(d), key(m)}, "not_object", nil)
				continue
			}
			node := &modelNode{name: d + ":" + m, fields: make(map[string]*modelDef, len(fields))}
			l.nodes[node.name] = node
			for f, raw := range fields {
				if !isName(f) {
					l.report([]segment{key(d), key(m), key(f)}, "bad_name", nil)
					continue
				}
				def := &modelDef{segments: []segment{key(d), key(m), key(f)}, raw: raw, domain: d}
				node.fields[f] = def
				node.list = append(node.list, def)
				l.defs = append(l.defs, def)
			}
		}
	}
}

// parse is step 2: a reference, read once in the domain where it's written. Sets d.ref, or reports and leaves
// it refNone.
func (l *loader) parse(d *modelDef) {
	var written string
	switch raw := d.raw.(type) {
	case string:
		written = raw
	case map[string]any:
		t, ok := raw["type"].(string)
		if !ok {
			l.report(d.path(), "missing_setting", map[string]any{"setting": "type"})
			return
		}
		written = t
	default:
		l.report(d.path(), "bad_setting", nil)
		return
	}
	domain, name, fieldName, ok := parseRef(written)
	if !ok {
		l.report(d.path(), "unresolved", nil)
		return
	}
	home := domain
	if home == "" {
		home = d.domain
	}
	home += ":" + name
	node := l.nodes[home]
	if fieldName != "" {
		if node != nil {
			if target := node.fields[fieldName]; target != nil {
				d.ref, d.refField = refField, target
				return
			}
		}
		l.report(d.path(), "unresolved", nil)
		return
	}
	if t := catalogue.types[name]; domain == "" && t != nil {
		d.ref, d.refType = refType, t
	} else if node != nil {
		d.ref, d.refModel = refModel, node
	} else if m, alias := Get(name); domain == "" && alias {
		l.report(d.path(), "alias", map[string]any{"canonical": m.Name})
	} else {
		l.report(d.path(), "unresolved", nil)
	}
}

func (l *loader) takesItems(v *modelDef) bool {
	raw, ok := v.raw.(map[string]any)
	if !ok {
		return false
	}
	if _, has := raw["items"]; !has {
		return false
	}
	switch v.ref {
	case refType:
		return v.refType.meta.Name == "array"
	case refField:
		t := v.refField
		return t.done && !t.failed && t.field.kind == kindArray
	}
	return false
}

// frame is one frame of the explicit Tarjan stack: a node and how many of its edges it has followed.
type frame struct {
	node vertex
	step int
}

// successor is the next node the frame's node points to, or nil once it has no more.
func (l *loader) successor(f *frame) vertex {
	switch v := f.node.(type) {
	case *modelNode:
		if f.step < len(v.list) {
			f.step++
			return v.list[f.step-1]
		}
	case *modelDef:
		for f.step < 2 {
			step := f.step
			f.step++
			if step == 0 && v.ref == refModel {
				return v.refModel
			}
			if step == 0 && v.ref == refField {
				return v.refField
			}
			if step == 1 && l.takesItems(v) {
				v.items = &modelDef{raw: v.raw.(map[string]any)["items"], domain: v.domain, up: v}
				l.parse(v.items)
				return v.items
			}
		}
	}
	return nil
}

// resolveAll is step 3, resolution and cycles in one pass: Tarjan's strongly connected components over written
// fields and models, with an explicit stack. Edges: a model reference -> that model; a model -> its fields; a
// field reference -> the field it copies; an array field -> its `items`. A field's settings, `items` included,
// are read only once its type resolves, so `items` is an edge only when the resolved type is an array.
// Components finish dependencies-first, so each field resolves exactly once, after what it copies.
func (l *loader) resolveAll() {
	counter := 0
	var stack []vertex
	var calls []frame
	enter := func(v vertex) {
		counter++
		m := v.tarjan()
		m.index, m.low, m.onStack = counter, counter, true
		stack = append(stack, v)
		calls = append(calls, frame{node: v})
	}
	for _, root := range l.defs {
		if root.index != 0 {
			continue
		}
		enter(root)
		for len(calls) > 0 {
			f := &calls[len(calls)-1]
			v := f.node
			vm := v.tarjan()
			if w := l.successor(f); w != nil {
				wm := w.tarjan()
				if wm.index == 0 {
					enter(w)
				} else if wm.onStack {
					vm.low = min(vm.low, wm.index)
					if w == v {
						vm.selfLoop = true
					}
				}
				continue
			}
			calls = calls[:len(calls)-1]
			if len(calls) > 0 {
				up := calls[len(calls)-1].node.tarjan()
				up.low = min(up.low, vm.low)
			}
			if vm.low != vm.index {
				continue
			}
			start := len(stack) - 1
			for stack[start] != v {
				start--
			}
			component := stack[start:]
			stack = stack[:start]
			for _, u := range component {
				um := u.tarjan()
				um.onStack, um.done = false, true
			}
			if len(component) > 1 || vm.selfLoop {
				// A cycle: every field on it fails; the problem is reported at each reference on it.
				for _, u := range component {
					if d, isDef := u.(*modelDef); isDef {
						d.failed = true
						if d.ref != refType {
							l.report(d.path(), "cycle", nil)
						}
					}
				}
			} else if d, isDef := v.(*modelDef); isDef {
				l.resolve(d)
			}
		}
	}
}

// resolve builds v.field from its resolved type plus the settings written next to it, or marks v failed.
func (l *loader) resolve(v *modelDef) {
	if v.ref == refNone || (v.ref == refField && v.refField.failed) {
		v.failed = true
		return
	}
	var base *field
	switch {
	case v.ref == refField:
		base = v.refField.field
	case v.ref == refModel:
		base = &field{kind: kindModel, model: v.refModel.name}
	case v.refType.meta.Name == "array":
		base = &field{kind: kindArray}
	default:
		base = &field{kind: kindType, typ: v.refType, settings: map[string]any{}}
	}
	var allowed []string
	switch base.kind {
	case kindType:
		allowed = base.typ.settings
	case kindArray:
		allowed = []string{"items"}
	}
	written, _ := v.raw.(map[string]any)
	var settings map[string]any
	if base.kind == kindType {
		settings = make(map[string]any, len(base.settings)+len(written))
		for k, s := range base.settings {
			settings[k] = s
		}
	}
	nullable, items, valueSet := base.nullable, base.items, base.allowed
	failed := false
	before := len(l.problems)
	for k := range written {
		switch {
		case k == "type":
		case k == "nullable":
			if value, ok := l.checkSetting(nil, v, k); ok {
				nullable = value.(bool)
			}
		case !slices.Contains(allowed, k):
			l.report(v.path(key(k)), "unknown_setting", nil)
		case k == "items":
			if v.items.failed {
				failed = true
			} else {
				items = v.items.field
			}
		default:
			if value, ok := l.checkSetting(base.typ, v, k); ok {
				settings[k] = value
				if list, isList := value.([]string); isList && k == "values" {
					valueSet = make(map[string]struct{}, len(list))
					for _, s := range list {
						valueSet[s] = struct{}{}
					}
				}
			}
		}
	}
	// A written setting counts as present even when its value was refused, so it isn't also reported missing.
	has := func(k string) bool {
		if _, ok := written[k]; ok {
			return true
		}
		_, ok := base.settings[k]
		return settings != nil && ok
	}
	if base.kind == kindArray && items == nil && !has("items") {
		l.report(v.path(), "missing_setting", map[string]any{"setting": "items"})
	}
	if base.kind == kindType && base.typ.meta.Name == "enum" && !has("values") {
		l.report(v.path(), "missing_setting", map[string]any{"setting": "values"})
	}
	if slices.Contains(allowed, "scale") && has("scale") && !has("precision") {
		l.report(v.path(key("scale")), "missing_setting", map[string]any{"setting": "precision"})
	}
	if failed || len(l.problems) > before {
		v.failed = true
		return
	}
	v.field = &field{kind: base.kind, nullable: nullable, typ: base.typ, settings: settings, allowed: valueSet, model: base.model, items: items}
	v.field.unpack()
	l.fields = append(l.fields, v.field)
	// The model this field nests, through any `items` (an edge of the nesting graph), and how many `items`
	// levels lie on the way: each counts toward the depth limit like a model.
	var from *modelDef
	switch {
	case v.ref == refModel:
	case base.kind == kindArray:
		if items != base.items {
			from = v.items
		} else if v.ref == refField {
			from = v.refField
		}
	case v.ref == refField:
		from = v.refField
	}
	switch {
	case v.ref == refModel:
		v.leaf = v.refModel
	case from != nil:
		v.leaf = from.leaf
	}
	switch {
	case from == nil:
		v.arrays = 0
	case from == v.items:
		v.arrays = 1 + from.arrays
	default:
		v.arrays = from.arrays
	}
}

// checkSetting checks the value v's setting k holds against its paramRules rule: the value to keep (an int64,
// a bool, or a copied []string), or false after reporting it. A rule's absent limits are its sentinels: the
// widest int64, or 0 items.
func (l *loader) checkSetting(t *typeInfo, v *modelDef, k string) (any, bool) {
	rule, known := catalogue.rules[k]
	if !known {
		panic(`scalars: setting "` + k + `" has no rule`)
	}
	value := v.raw.(map[string]any)[k]
	switch rule.kind {
	case "boolean":
		if b, ok := value.(bool); ok {
			return b, true
		}
	case "integer":
		if n, ok := modelInt(value); ok && n >= rule.minimum && n <= rule.maximum {
			return n, true
		}
	case "array":
		list, ok := value.([]any)
		if !ok || len(list) < rule.minItems {
			break
		}
		// Entries must be strings, unique, already clean (the type's own check returns each unchanged), and within
		// maxItemBytes as UTF-8. The list is copied, so the loaded models never alias the caller's data.
		out := make([]string, 0, len(list))
		seen := make(map[string]struct{}, len(list))
		for i, entry := range list {
			s, isText := entry.(string)
			if isText {
				clean, reason := check(t.scalar, s)
				valid := reason == ""
				_, dup := seen[s]
				fits := rule.maxItemBytes == 0 || len(s) <= rule.maxItemBytes
				isText = valid && clean == s && fits && !dup
			}
			if !isText {
				l.report(v.path(key(k), segment{idx: i}), "bad_setting", nil)
				ok = false
				continue
			}
			seen[s] = struct{}{}
			out = append(out, s)
		}
		return out, ok
	default:
		panic(`scalars: setting "` + k + `" has unknown kind "` + rule.kind + `"`)
	}
	l.report(v.path(key(k)), "bad_setting", nil)
	return nil, false
}

// depthFrame is one frame of the depth walk: a model, its next field, and its depth so far.
type depthFrame struct {
	model *modelNode
	i, d  int
}

// depths is step 4, nesting depth: the longest chain of levels, where each model and each `items` is one level
// (acyclic now: fields on cycles failed above). Post-order with an explicit stack. A model of plain fields has
// depth 1; a field adds its `items` levels plus the depth of the model it nests.
func (l *loader) depths() {
	depth := make(map[*modelNode]int, len(l.nodes))
	fieldDepth := func(d *modelDef) int {
		if d.leaf == nil {
			return d.arrays
		}
		return d.arrays + depth[d.leaf]
	}
	open := map[*modelNode]bool{}
	for _, start := range l.nodes {
		if _, done := depth[start]; done {
			continue
		}
		calls := []depthFrame{{start, 0, 1}}
		open[start] = true
		for len(calls) > 0 {
			f := &calls[len(calls)-1]
			if f.i < len(f.model.list) {
				d := f.model.list[f.i]
				if _, done := depth[d.leaf]; d.leaf != nil && !done {
					// Visit the nested model first, then come back to this field.
					if open[d.leaf] {
						panic(`scalars: model cycle through "` + d.leaf.name + `" survived resolution`)
					}
					open[d.leaf] = true
					calls = append(calls, depthFrame{d.leaf, 0, 1})
					continue
				}
				f.i++
				if !d.failed {
					f.d = max(f.d, 1+fieldDepth(d))
				}
				continue
			}
			delete(open, f.model)
			depth[f.model] = f.d
			calls = calls[:len(calls)-1]
		}
	}
	// Reported once per too-deep chain: at the outermost too-deep model, on each field that makes it too deep.
	inner := map[*modelNode]bool{}
	for m, d := range depth {
		if d <= maxDepth {
			continue
		}
		for _, f := range m.list {
			if f.leaf != nil && depth[f.leaf] > maxDepth {
				inner[f.leaf] = true
			}
		}
	}
	for m, d := range depth {
		if d <= maxDepth || inner[m] {
			continue
		}
		for _, f := range m.list {
			if !f.failed && 1+fieldDepth(f) > maxDepth {
				l.report(f.segments, "too_deep", map[string]any{"max": int64(maxDepth)})
			}
		}
	}
}

// entry is one field of a Model: its name and its resolved field.
type entry struct {
	name  string
	field *field
}

// Model is one model of a loaded models file. It is safe for concurrent use: nothing changes after load. Only
// Models builds one; a zero Model is not usable.
type Model struct {
	name    string
	fields  map[string]*field
	entries []entry // built once, not per payload
	root    *field  // the payload itself, a value of this model
}

// Name is the model's full "domain:model" name.
func (m *Model) Name() string { return m.name }

// ModelSet is a loaded models file: Get("domain:model") and All, every full name, sorted. Only Models builds one.
type ModelSet struct {
	all    []string
	byName map[string]*Model
}

// All gives every full model name, sorted. The slice is a copy: changing it changes nothing in the set.
func (s *ModelSet) All() []string { return slices.Clone(s.all) }

// Get finds a model by its full "domain:model" name, exactly.
func (s *ModelSet) Get(name string) (*Model, bool) {
	m, ok := s.byName[name]
	return m, ok
}

// Models loads a models file, parsed JSON as encoding/json decodes it (never a path). It returns the set, or a
// *ModelsError listing every problem in the file, sorted.
func Models(data any) (*ModelSet, error) {
	catalogueOnce.Do(buildCatalogue)
	root, ok := data.(map[string]any)
	if !ok {
		return nil, &ModelsError{sortedProblems([]located{locate(nil, "not_object", map[string]any{}, "")})}
	}
	l := &loader{nodes: map[string]*modelNode{}}
	l.names(root)
	for _, d := range l.defs {
		l.parse(d)
	}
	l.resolveAll()
	l.depths()
	if len(l.problems) > 0 {
		return nil, &ModelsError{sortedProblems(l.problems)}
	}
	set := &ModelSet{all: make([]string, 0, len(l.nodes)), byName: make(map[string]*Model, len(l.nodes))}
	for name, node := range l.nodes {
		m := &Model{name: name, fields: make(map[string]*field, len(node.list)), entries: make([]entry, 0, len(node.list))}
		for _, d := range node.list {
			f := d.segments[2].key
			m.fields[f] = d.field
			m.entries = append(m.entries, entry{f, d.field})
		}
		m.root = &field{kind: kindModel, model: name, target: m}
		set.byName[name] = m
		set.all = append(set.all, name)
	}
	slices.Sort(set.all)
	// Each model field points at its Model once, here, so validate never looks a model up by name.
	for _, f := range l.fields {
		if f.kind == kindModel {
			f.target = set.byName[f.model]
		}
	}
	return set, nil
}

// loc is a location: a link to its parent, so a deep value costs nothing; the segments are built only for a
// problem.
type loc struct {
	up *loc
	segment
}

// walker is one Validate or IsValid call. first stops the walk at the first problem.
type walker struct {
	problems []located
	first    bool
}

func (w *walker) report(at *loc, code string, params map[string]any, message string) {
	n := 0
	for l := at; l != nil; l = l.up {
		n++
	}
	segments := make([]segment, n)
	for l := at; l != nil; l = l.up {
		n--
		segments[n] = l.segment
	}
	w.problems = append(w.problems, locate(segments, code, params, message))
}

func (w *walker) stopped() bool { return w.first && len(w.problems) > 0 }

// Validate checks a payload as encoding/json decodes it. It returns the cleaned payload (declared keys only,
// normalized values, an int field as an int64, a missing nullable key as nil), or a *ModelError listing every
// problem, sorted.
func (m *Model) Validate(payload any) (map[string]any, error) {
	w := walker{}
	out := w.root(m, payload)
	if len(w.problems) > 0 {
		return nil, &ModelError{sortedProblems(w.problems)}
	}
	return out, nil
}

// IsValid reports whether Validate would succeed. It stops at the first problem.
func (m *Model) IsValid(payload any) bool {
	w := walker{first: true}
	w.root(m, payload)
	return len(w.problems) == 0
}

func (w *walker) root(m *Model, payload any) map[string]any {
	if _, ok := payload.(map[string]any); !ok {
		w.report(nil, "not_object", map[string]any{}, "")
		return nil
	}
	out, _ := w.walk(m.root, payload, nil).(map[string]any)
	return out
}

// walk is the cleaned v, which sits at location at (nil for the root). Recursion follows the models, at most
// maxDepth levels, never the input.
func (w *walker) walk(f *field, v any, at *loc) any {
	if v == nil {
		if !f.nullable {
			w.report(at, "required", map[string]any{}, "")
		}
		return nil
	}
	switch f.kind {
	case kindType:
		t := f.typ
		r, reason := check(t.scalar, v)
		// The reason is the code; a type-level too_long reads like the field's, with the type's limit as max.
		if reason != "" {
			params := map[string]any{"type": t.meta.Name}
			if reason == ReasonTooLong {
				params["max"] = int64(t.scalar.(*TextScalar).maxLen)
			}
			w.report(at, string(reason), params, t.meta.Error)
			return nil
		}
		if f.limited {
			s, _ := r.(string)
			if f.length > 0 && longerThan(s, int(f.length)) {
				w.report(at, string(ReasonTooLong), map[string]any{"type": t.meta.Name, "max": f.length}, "")
			}
			if _, in := f.allowed[s]; f.values != nil && !in {
				w.report(at, "not_allowed", map[string]any{"type": t.meta.Name, "values": slices.Clone(f.values)}, "")
			}
			if f.precision > 0 && !fitsNumeric(s, f.precision, f.scale) {
				w.report(at, "too_many_digits", map[string]any{"type": t.meta.Name, "precision": f.precision, "scale": f.scale}, "")
			}
		}
		return r
	case kindModel:
		obj, ok := v.(map[string]any)
		if !ok {
			w.report(at, "not_object", map[string]any{}, "")
			return nil
		}
		model := f.target
		out := make(map[string]any, len(model.entries))
		present := 0
		for _, e := range model.entries {
			value, has := obj[e.name]
			if has {
				present++
			}
			here := loc{at, key(e.name)}
			out[e.name] = w.walk(e.field, value, &here)
			if w.stopped() {
				return nil
			}
		}
		// Every key is a declared field unless the payload has more keys than the declared ones it holds.
		if present < len(obj) {
			for k := range obj {
				if _, declared := model.fields[k]; !declared {
					w.report(&loc{at, key(k)}, "unknown_field", map[string]any{}, "")
					if w.stopped() {
						return nil
					}
				}
			}
		}
		return out
	}
	list, ok := v.([]any)
	if !ok {
		w.report(at, "not_list", map[string]any{}, "")
		return nil
	}
	out := make([]any, len(list))
	for i, x := range list {
		here := loc{at, segment{idx: i}}
		out[i] = w.walk(f.items, x, &here)
		if w.stopped() {
			return nil
		}
	}
	return out
}

// fitsNumeric rejects exactly what Postgres numeric(p, s) refuses, in one pass over the cleaned text t
// (`-?[0-9]+(\.[0-9]+)?`): R = round(|value| * 10^s), half away from zero, must have at most p digits.
func fitsNumeric(t string, p, s int64) bool {
	start := 0
	if strings.HasPrefix(t, "-") {
		start = 1
	}
	dot := strings.IndexByte(t[start:], '.')
	if dot >= 0 {
		dot += start
	}
	intLen := len(t) - start
	if dot >= 0 {
		intLen = dot - start
	}
	n := len(t) - start // digits, the point left out
	if dot >= 0 {
		n--
	}
	digitAt := func(i int) int {
		j := start + i
		if dot >= 0 && i >= intLen {
			j++
		}
		return int(t[j]) - '0'
	}
	k := intLen + int(s) // digits of the value R keeps (load bounds s, so this can't overflow)
	if k < 0 {
		return true // rounds to 0
	}
	z := 0 // the first nonzero digit
	for z < n && digitAt(z) == 0 {
		z++
	}
	kept := min(k, n)
	width := 0 // digits of R before any carry (padding zeros count)
	if z < kept {
		width = k - z
	}
	carry := k < n && digitAt(k) >= 5
	nines := k <= n // padding zeros aren't 9s
	for i := z; nines && i < kept; i++ {
		if digitAt(i) != 9 {
			nines = false
		}
	}
	extra := 0
	if carry && nines {
		extra = 1
	}
	return int64(width+extra) <= p
}

// Reason is why a value failed ($meta.reasons): the first rule the single pass trips, in this order.
type Reason string

const (
	// ReasonWrongKind: Not the type's primitive kind (TS, Python and models only; Go and Rust are typed by their signatures).
	ReasonWrongKind Reason = "wrong_kind"
	// ReasonMalformed: Text that isn't well-formed Unicode (a lone surrogate).
	ReasonMalformed Reason = "malformed"
	// ReasonTooLong: More code points than the type's maxLength (or a field's length).
	ReasonTooLong Reason = "too_long"
	// ReasonTooShort: Fewer code points than the type's minLength.
	ReasonTooShort Reason = "too_short"
	// ReasonPattern: Doesn't match the type's pattern.
	ReasonPattern Reason = "pattern"
	// ReasonOutOfRange: Below minimum, above maximum, or a non-finite number.
	ReasonOutOfRange Reason = "out_of_range"
	// ReasonCheck: Failed the type's check (a check digit, a 64-bit range).
	ReasonCheck Reason = "check"
	// ReasonNotInList: Not on the type's enum.
	ReasonNotInList Reason = "not_in_list"
)

// maxDepth is how deep models may nest, each model and each `items` one level; deeper is refused at load.
const maxDepth = 64

// paramRules holds the limits of each setting in $meta.params.
var paramRules = [...]paramRule{
	{"length", "integer", 1, 10485760, 0, 0},
	{"precision", "integer", 1, 1000, 0, 0},
	{"scale", "integer", -1000, 1000, 0, 0},
	{"fractional_seconds", "integer", 0, 6, 0, 0},
	{"values", "array", math.MinInt64, math.MaxInt64, 1, 63},
	{"nullable", "boolean", math.MinInt64, math.MaxInt64, 0, 0},
}

// errorTemplates holds the message template of each error code in $meta.errors.
var errorTemplates = [...]errorTemplate{
	{"required", "Required."},
	{"unknown_field", "Not a field of this model."},
	{"not_object", "Must be an object."},
	{"not_list", "Must be a list."},
	{"too_long", "At most {max} characters."},
	{"not_allowed", "Must be one of: {values}."},
	{"too_many_digits", "Too many digits for precision {precision}, scale {scale}."},
	{"bad_name", "Names are lowercase letters, digits and underscores, starting with a letter."},
	{"type_name", "A model can't take a type's name."},
	{"unresolved", "No type or model by this name."},
	{"alias", "This is an alias; write \"{canonical}\"."},
	{"unknown_setting", "This type takes no such setting."},
	{"bad_setting", "Out of range or the wrong kind of value."},
	{"missing_setting", "Needs \"{setting}\"."},
	{"cycle", "This reference leads back to itself."},
	{"too_deep", "Models nest more than {max} levels deep."},
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
// An ISO 3166-1 alpha-2 country code (US): the interchange default for countries. The list: ISO 3166-1 alpha-2 codes currently assigned, from Debian iso-codes v4.20.1 (data/iso_3166-1.json), copied 2026-11-21.
var Country = &scalarCountry

var scalarCountry = TextScalar{
	Meta: Meta{
		Name:      "country",
		Label:     "Country",
		Hint:      "Pick a country",
		Error:     "Please use the 2-letter country code, like US.",
		Details:   "An ISO 3166-1 alpha-2 country code (US): the interchange default for countries. The list: ISO 3166-1 alpha-2 codes currently assigned, from Debian iso-codes v4.20.1 (data/iso_3166-1.json), copied 2026-11-21.",
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
	list:    []string{"AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ", "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ", "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ", "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR", "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY", "HK", "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP", "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY", "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ", "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM", "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA", "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ", "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ", "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "YE", "YT", "ZA", "ZM", "ZW"},
}

// CountryAlpha3 is Country (3-letter): Three capital letters, like USA.
//
// An ISO 3166-1 alpha-3 country code (USA): feeds and standards that require three letters. Prefer country (alpha-2) as the default. The list: ISO 3166-1 alpha-3 codes currently assigned, from Debian iso-codes v4.20.1 (data/iso_3166-1.json), copied 2026-11-21.
var CountryAlpha3 = &scalarCountryAlpha3

var scalarCountryAlpha3 = TextScalar{
	Meta: Meta{
		Name:      "country_alpha3",
		Label:     "Country (3-letter)",
		Hint:      "Three capital letters, like USA",
		Error:     "Please use the 3-letter country code, like USA.",
		Details:   "An ISO 3166-1 alpha-3 country code (USA): feeds and standards that require three letters. Prefer country (alpha-2) as the default. The list: ISO 3166-1 alpha-3 codes currently assigned, from Debian iso-codes v4.20.1 (data/iso_3166-1.json), copied 2026-11-21.",
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
	list:    []string{"ABW", "AFG", "AGO", "AIA", "ALA", "ALB", "AND", "ARE", "ARG", "ARM", "ASM", "ATA", "ATF", "ATG", "AUS", "AUT", "AZE", "BDI", "BEL", "BEN", "BES", "BFA", "BGD", "BGR", "BHR", "BHS", "BIH", "BLM", "BLR", "BLZ", "BMU", "BOL", "BRA", "BRB", "BRN", "BTN", "BVT", "BWA", "CAF", "CAN", "CCK", "CHE", "CHL", "CHN", "CIV", "CMR", "COD", "COG", "COK", "COL", "COM", "CPV", "CRI", "CUB", "CUW", "CXR", "CYM", "CYP", "CZE", "DEU", "DJI", "DMA", "DNK", "DOM", "DZA", "ECU", "EGY", "ERI", "ESH", "ESP", "EST", "ETH", "FIN", "FJI", "FLK", "FRA", "FRO", "FSM", "GAB", "GBR", "GEO", "GGY", "GHA", "GIB", "GIN", "GLP", "GMB", "GNB", "GNQ", "GRC", "GRD", "GRL", "GTM", "GUF", "GUM", "GUY", "HKG", "HMD", "HND", "HRV", "HTI", "HUN", "IDN", "IMN", "IND", "IOT", "IRL", "IRN", "IRQ", "ISL", "ISR", "ITA", "JAM", "JEY", "JOR", "JPN", "KAZ", "KEN", "KGZ", "KHM", "KIR", "KNA", "KOR", "KWT", "LAO", "LBN", "LBR", "LBY", "LCA", "LIE", "LKA", "LSO", "LTU", "LUX", "LVA", "MAC", "MAF", "MAR", "MCO", "MDA", "MDG", "MDV", "MEX", "MHL", "MKD", "MLI", "MLT", "MMR", "MNE", "MNG", "MNP", "MOZ", "MRT", "MSR", "MTQ", "MUS", "MWI", "MYS", "MYT", "NAM", "NCL", "NER", "NFK", "NGA", "NIC", "NIU", "NLD", "NOR", "NPL", "NRU", "NZL", "OMN", "PAK", "PAN", "PCN", "PER", "PHL", "PLW", "PNG", "POL", "PRI", "PRK", "PRT", "PRY", "PSE", "PYF", "QAT", "REU", "ROU", "RUS", "RWA", "SAU", "SDN", "SEN", "SGP", "SGS", "SHN", "SJM", "SLB", "SLE", "SLV", "SMR", "SOM", "SPM", "SRB", "SSD", "STP", "SUR", "SVK", "SVN", "SWE", "SWZ", "SXM", "SYC", "SYR", "TCA", "TCD", "TGO", "THA", "TJK", "TKL", "TKM", "TLS", "TON", "TTO", "TUN", "TUR", "TUV", "TWN", "TZA", "UGA", "UKR", "UMI", "URY", "USA", "UZB", "VAT", "VCT", "VEN", "VGB", "VIR", "VNM", "VUT", "WLF", "WSM", "YEM", "ZAF", "ZMB", "ZWE"},
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
// An ISO 4217 currency code (USD): pair it with a decimal amount to represent money. Never derive it from country or locale - people transact across borders. The list: ISO 4217 List One active codes (with the X codes it assigns), from SIX list-one.xml published 2026-09-17, copied 2026-11-21.
var Currency = &scalarCurrency

var scalarCurrency = TextScalar{
	Meta: Meta{
		Name:      "currency",
		Label:     "Currency",
		Hint:      "Pick a currency, like USD or EUR",
		Error:     "Please use the 3-letter currency code, like USD.",
		Details:   "An ISO 4217 currency code (USD): pair it with a decimal amount to represent money. Never derive it from country or locale - people transact across borders. The list: ISO 4217 List One active codes (with the X codes it assigns), from SIX list-one.xml published 2026-09-17, copied 2026-11-21.",
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
	list:    []string{"AED", "AFN", "ALL", "AMD", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BHD", "BIF", "BMD", "BND", "BOB", "BOV", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHE", "CHF", "CHW", "CLF", "CLP", "CNY", "COP", "COU", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MXV", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "USN", "UYI", "UYU", "UYW", "UZS", "VED", "VES", "VND", "VUV", "WST", "XAD", "XAF", "XAG", "XAU", "XBA", "XBB", "XBC", "XBD", "XCD", "XCG", "XDR", "XOF", "XPD", "XPF", "XPT", "XSU", "XTS", "XUA", "XXX", "YER", "ZAR", "ZMW", "ZWG"},
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
		Params:    []string{"fractional_seconds"},
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
		Params:    []string{"fractional_seconds"},
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
		Params:    []string{"precision", "scale"},
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
		Params:    []string{"precision", "scale"},
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
		Params:    []string{"fractional_seconds"},
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
		Params:    []string{"values"},
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

// Gln is Location number (GLN): 13 digits.
//
// A GS1 GLN identifying a party or place: a company, a warehouse, a store, a dock door. Use gtin for the products themselves and lei for legal entities in finance.
var Gln = &scalarGln

var scalarGln = TextScalar{
	Meta: Meta{
		Name:      "gln",
		Label:     "Location number (GLN)",
		Hint:      "13 digits",
		Error:     "Please check the number: 13 digits, like 0614141000012.",
		Details:   "A GS1 GLN identifying a party or place: a company, a warehouse, a store, a dock door. Use gtin for the products themselves and lei for legal entities in finance.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"location_number", "global_location_number"},
		Valid:     []any{"0614141000012", "4000001000005"},
		Invalid:   []any{"061414100001", "06141410000123"},
		Check:     "gs1_mod10",
	},
	steps:   []step{stepRemoveSpaces, stepRemoveHyphens},
	pattern: `^[0-9]{13}$`,
	minLen:  13,
	maxLen:  13,
	rule:    checkGs1Mod10,
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
		Error:     "Please check the number: 8, 12, 13 or 14 digits, like 0614141000036.",
		Details:   "A GS1 GTIN (UPC/EAN family) identifying a retail product. Prefer isbn when the domain is specifically books.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"barcode", "ean", "upc"},
		Valid:     []any{"0614141000036", "96385074"},
		Invalid:   []any{"123456789", "0614141000036A"},
		Check:     "gs1_mod10",
	},
	steps:   []step{stepRemoveSpaces, stepRemoveHyphens},
	pattern: `^([0-9]{8}|[0-9]{12}|[0-9]{13}|[0-9]{14})$`,
	minLen:  8,
	maxLen:  14,
	rule:    checkGs1Mod10,
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
		Params:    []string{"fractional_seconds"},
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
		Error:     "Please check the account: capitals and digits, no spaces, like DE89370400440532013000.",
		Details:   "An International Bank Account Number: identifying accounts for payments. Pair with bic for cross-border routing and treat as sensitive data.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"bank_account"},
		Valid:     []any{"DE89370400440532013000", "GB82WEST12345698765432"},
		Invalid:   []any{"de89370400440532013000", "DE89 3704 0044 0532 0130 00"},
		Check:     "iban",
	},
	steps:   []step{stepTrim, stepRemoveSpaces, stepUppercase},
	pattern: `^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$`,
	minLen:  15,
	maxLen:  34,
	rule:    checkIban,
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
		Error:     "Please use a whole number that fits in 64 bits, digits only, like 9007199254740993.",
		Details:   "Signed 64-bit integers: database keys, byte sizes, high-resolution counters. Values beyond 2^53 lose precision as JSON numbers, so they travel as strings; storage is still a native 64-bit integer.",
		Level:     "core",
		Primitive: "int64",
		Aliases:   []string{"bigint", "long"},
		Valid:     []any{"9007199254740993", "-42", "0", "9223372036854775807", "-9223372036854775808"},
		Invalid:   []any{"12.5", 123.0},
		Check:     "int64_range",
	},
	steps:   []step{},
	pattern: `^-?[0-9]+$`,
	minLen:  1,
	maxLen:  noMax,
	rule:    checkInt64Range,
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
		Error:     "Please check the number: 10 or 13 digits, no dashes, like 9780306406157.",
		Details:   "An ISBN identifying a book edition. Prefer gtin for general retail products; every ISBN-13 is a GTIN, but not the reverse.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"isbn13", "isbn10"},
		Valid:     []any{"9780306406157", "080442957X", "0306406152"},
		Invalid:   []any{"978030640615", "0306406152XX"},
		Check:     "isbn",
	},
	steps:   []step{stepRemoveSpaces, stepRemoveHyphens, stepUppercase},
	pattern: `^([0-9]{9}[0-9Xx]|97[89][0-9]{10})$`,
	minLen:  10,
	maxLen:  13,
	rule:    checkIsbn,
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
// A BCP 47 language code (en): tagging what language content is in, with the 2-letter code where one exists. Prefer locale when region or script variants matter. The list: current language subtags (not deprecated, not private-use) from the IANA Language Subtag Registry, File-Date 2026-11-18, copied 2026-11-21.
var Language = &scalarLanguage

var scalarLanguage = TextScalar{
	Meta: Meta{
		Name:      "language",
		Label:     "Language",
		Hint:      "Two or three small letters, like en",
		Error:     "Please use the language code, like en.",
		Details:   "A BCP 47 language code (en): tagging what language content is in, with the 2-letter code where one exists. Prefer locale when region or script variants matter. The list: current language subtags (not deprecated, not private-use) from the IANA Language Subtag Registry, File-Date 2026-11-18, copied 2026-11-21.",
		Level:     "advanced",
		Primitive: "string",
		Aliases:   []string{"language_code"},
		Valid:     []any{"en", "haw", "mul", "cmn"},
		Invalid:   []any{"EN", "english"},
	},
	steps:   []step{},
	pattern: `^[a-z]{2,3}$`,
	minLen:  2,
	maxLen:  3,
	list:    []string{"aa", "aaa", "aab", "aac", "aad", "aae", "aaf", "aag", "aah", "aai", "aak", "aal", "aan", "aao", "aap", "aaq", "aas", "aat", "aau", "aav", "aaw", "aax", "aaz", "ab", "aba", "abb", "abc", "abd", "abe", "abf", "abg", "abh", "abi", "abj", "abl", "abm", "abn", "abo", "abp", "abq", "abr", "abs", "abt", "abu", "abv", "abw", "abx", "aby", "abz", "aca", "acb", "acd", "ace", "acf", "ach", "aci", "ack", "acl", "acm", "acn", "acp", "acq", "acr", "acs", "act", "acu", "acv", "acw", "acx", "acy", "acz", "ada", "adb", "add", "ade", "adf", "adg", "adh", "adi", "adj", "adl", "adn", "ado", "adq", "adr", "ads", "adt", "adu", "adw", "adx", "ady", "adz", "ae", "aea", "aeb", "aec", "aed", "aee", "aek", "ael", "aem", "aen", "aeq", "aer", "aes", "aeu", "aew", "aey", "aez", "af", "afa", "afb", "afd", "afe", "afg", "afh", "afi", "afk", "afn", "afo", "afp", "afs", "aft", "afu", "afz", "aga", "agb", "agc", "agd", "age", "agf", "agg", "agh", "agi", "agj", "agk", "agl", "agm", "agn", "ago", "agq", "agr", "ags", "agt", "agu", "agv", "agw", "agx", "agy", "agz", "aha", "ahb", "ahg", "ahh", "ahi", "ahk", "ahl", "ahm", "ahn", "aho", "ahp", "ahr", "ahs", "aht", "aia", "aib", "aic", "aid", "aie", "aif", "aig", "aih", "aii", "aij", "aik", "ail", "aim", "ain", "aio", "aip", "aiq", "air", "ait", "aiw", "aix", "aiy", "aja", "ajg", "aji", "ajn", "ajs", "aju", "ajw", "ajz", "ak", "akb", "akc", "akd", "ake", "akf", "akg", "akh", "aki", "akj", "akk", "akl", "akm", "ako", "akp", "akq", "akr", "aks", "akt", "aku", "akv", "akw", "akx", "aky", "akz", "ala", "alc", "ald", "ale", "alf", "alg", "alh", "ali", "alj", "alk", "all", "alm", "aln", "alo", "alp", "alq", "alr", "als", "alt", "alu", "alv", "alw", "alx", "aly", "alz", "am", "ama", "amb", "amc", "ame", "amf", "amg", "ami", "amj", "amk", "aml", "amm", "amn", "amo", "amp", "amq", "amr", "ams", "amt", "amu", "amv", "amw", "amx", "amy", "amz", "an", "ana", "anb", "anc", "and", "ane", "anf", "ang", "anh", "ani", "anj", "ank", "anl", "anm", "ann", "ano", "anp", "anq", "anr", "ans", "ant", "anu", "anv", "anw", "anx", "any", "anz", "aoa", "aob", "aoc", "aod", "aoe", "aof", "aog", "aoi", "aoj", "aok", "aol", "aom", "aon", "aor", "aos", "aot", "aou", "aox", "aoz", "apa", "apb", "apc", "apd", "ape", "apf", "apg", "aph", "api", "apj", "apk", "apl", "apm", "apn", "apo", "app", "apq", "apr", "aps", "apt", "apu", "apv", "apw", "apx", "apy", "apz", "aqa", "aqc", "aqd", "aqg", "aqk", "aql", "aqm", "aqn", "aqp", "aqr", "aqt", "aqz", "ar", "arb", "arc", "ard", "are", "arh", "ari", "arj", "ark", "arl", "arn", "aro", "arp", "arq", "arr", "ars", "art", "aru", "arv", "arw", "arx", "ary", "arz", "as", "asa", "asb", "asc", "ase", "asf", "asg", "ash", "asi", "asj", "ask", "asl", "asn", "aso", "asp", "asq", "asr", "ass", "ast", "asu", "asv", "asw", "asx", "asy", "asz", "ata", "atb", "atc", "atd", "ate", "atg", "ath", "ati", "atj", "atk", "atl", "atm", "atn", "ato", "atp", "atq", "atr", "ats", "att", "atu", "atv", "atw", "atx", "aty", "atz", "aua", "aub", "auc", "aud", "auf", "aug", "auh", "aui", "auj", "auk", "aul", "aum", "aun", "auo", "aup", "auq", "aur", "aus", "aut", "auu", "auw", "aux", "auy", "auz", "av", "avb", "avd", "avi", "avk", "avl", "avm", "avn", "avo", "avs", "avt", "avu", "avv", "awa", "awb", "awc", "awd", "awe", "awg", "awh", "awi", "awk", "awm", "awn", "awo", "awr", "aws", "awt", "awu", "awv", "aww", "awx", "awy", "axb", "axe", "axg", "axk", "axl", "axm", "axx", "ay", "aya", "ayb", "ayc", "ayd", "aye", "ayg", "ayh", "ayi", "ayk", "ayl", "ayn", "ayo", "ayp", "ayq", "ayr", "ays", "ayt", "ayu", "ayz", "az", "aza", "azb", "azc", "azd", "azg", "azj", "azm", "azn", "azo", "azt", "azz", "ba", "baa", "bab", "bac", "bad", "bae", "baf", "bag", "bah", "bai", "baj", "bal", "ban", "bao", "bap", "bar", "bas", "bat", "bau", "bav", "baw", "bax", "bay", "bba", "bbb", "bbc", "bbd", "bbe", "bbf", "bbg", "bbh", "bbi", "bbj", "bbk", "bbl", "bbm", "bbn", "bbo", "bbp", "bbq", "bbr", "bbs", "bbt", "bbu", "bbv", "bbw", "bbx", "bby", "bca", "bcb", "bcc", "bcd", "bce", "bcf", "bcg", "bch", "bci", "bcj", "bck", "bcl", "bcm", "bcn", "bco", "bcp", "bcq", "bcr", "bcs", "bct", "bcu", "bcv", "bcw", "bcy", "bcz", "bda", "bdb", "bdc", "bdd", "bde", "bdf", "bdg", "bdh", "bdi", "bdj", "bdk", "bdl", "bdm", "bdn", "bdo", "bdp", "bdq", "bdr", "bds", "bdt", "bdu", "bdv", "bdw", "bdx", "bdy", "bdz", "be", "bea", "beb", "bec", "bed", "bee", "bef", "beg", "beh", "bei", "bej", "bek", "bem", "beo", "bep", "beq", "ber", "bes", "bet", "beu", "bev", "bew", "bex", "bey", "bez", "bfa", "bfb", "bfc", "bfd", "bfe", "bff", "bfg", "bfh", "bfi", "bfj", "bfk", "bfl", "bfm", "bfn", "bfo", "bfp", "bfq", "bfr", "bfs", "bft", "bfu", "bfw", "bfx", "bfy", "bfz", "bg", "bga", "bgb", "bgc", "bgd", "bge", "bgf", "bgg", "bgi", "bgj", "bgk", "bgl", "bgn", "bgo", "bgp", "bgq", "bgr", "bgs", "bgt", "bgu", "bgv", "bgw", "bgx", "bgy", "bgz", "bha", "bhb", "bhc", "bhd", "bhe", "bhf", "bhg", "bhh", "bhi", "bhj", "bhl", "bhm", "bhn", "bho", "bhp", "bhq", "bhr", "bhs", "bht", "bhu", "bhv", "bhw", "bhx", "bhy", "bhz", "bi", "bia", "bib", "bid", "bie", "bif", "big", "bih", "bik", "bil", "bim", "bin", "bio", "bip", "biq", "bir", "bit", "biu", "biv", "biw", "bix", "biy", "biz", "bja", "bjb", "bjc", "bje", "bjf", "bjg", "bjh", "bji", "bjj", "bjk", "bjl", "bjm", "bjn", "bjo", "bjp", "bjr", "bjs", "bjt", "bju", "bjv", "bjw", "bjx", "bjy", "bjz", "bka", "bkc", "bkd", "bkf", "bkg", "bkh", "bki", "bkj", "bkk", "bkl", "bkm", "bkn", "bko", "bkp", "bkq", "bkr", "bks", "bkt", "bku", "bkv", "bkw", "bkx", "bky", "bkz", "bla", "blb", "blc", "bld", "ble", "blf", "blh", "bli", "blj", "blk", "bll", "blm", "bln", "blo", "blp", "blq", "blr", "bls", "blt", "blv", "blw", "blx", "bly", "blz", "bm", "bma", "bmb", "bmc", "bmd", "bme", "bmf", "bmg", "bmh", "bmi", "bmj", "bmk", "bml", "bmm", "bmn", "bmo", "bmp", "bmq", "bmr", "bms", "bmt", "bmu", "bmv", "bmw", "bmx", "bmz", "bn", "bna", "bnb", "bnc", "bnd", "bne", "bnf", "bng", "bni", "bnj", "bnk", "bnl", "bnm", "bnn", "bno", "bnp", "bnq", "bnr", "bns", "bnt", "bnu", "bnv", "bnw", "bnx", "bny", "bnz", "bo", "boa", "bob", "boe", "bof", "bog", "boh", "boi", "boj", "bok", "bol", "bom", "bon", "boo", "bop", "boq", "bor", "bot", "bou", "bov", "bow", "box", "boy", "boz", "bpa", "bpc", "bpd", "bpe", "bpg", "bph", "bpi", "bpj", "bpk", "bpl", "bpm", "bpn", "bpo", "bpp", "bpq", "bpr", "bps", "bpt", "bpu", "bpv", "bpw", "bpx", "bpy", "bpz", "bqa", "bqb", "bqc", "bqd", "bqf", "bqg", "bqh", "bqi", "bqj", "bqk", "bql", "bqm", "bqn", "bqo", "bqp", "bqq", "bqr", "bqs", "bqt", "bqu", "bqv", "bqw", "bqx", "bqy", "bqz", "br", "bra", "brb", "brc", "brd", "brf", "brg", "brh", "bri", "brj", "brk", "brl", "brm", "brn", "bro", "brp", "brq", "brr", "brs", "brt", "bru", "brv", "brw", "brx", "bry", "brz", "bs", "bsa", "bsb", "bsc", "bse", "bsf", "bsg", "bsh", "bsi", "bsj", "bsk", "bsl", "bsm", "bsn", "bso", "bsp", "bsq", "bsr", "bss", "bst", "bsu", "bsv", "bsw", "bsx", "bsy", "bta", "btc", "btd", "bte", "btf", "btg", "bth", "bti", "btj", "btk", "btm", "btn", "bto", "btp", "btq", "btr", "bts", "btt", "btu", "btv", "btw", "btx", "bty", "btz", "bua", "bub", "buc", "bud", "bue", "buf", "bug", "buh", "bui", "buj", "buk", "bum", "bun", "buo", "bup", "buq", "bus", "but", "buu", "buv", "buw", "bux", "buy", "buz", "bva", "bvb", "bvc", "bvd", "bve", "bvf", "bvg", "bvh", "bvi", "bvj", "bvk", "bvl", "bvm", "bvn", "bvo", "bvp", "bvq", "bvr", "bvt", "bvu", "bvv", "bvw", "bvx", "bvy", "bvz", "bwa", "bwb", "bwc", "bwd", "bwe", "bwf", "bwg", "bwh", "bwi", "bwj", "bwk", "bwl", "bwm", "bwn", "bwo", "bwp", "bwq", "bwr", "bws", "bwt", "bwu", "bww", "bwx", "bwy", "bwz", "bxa", "bxb", "bxc", "bxd", "bxe", "bxf", "bxg", "bxh", "bxi", "bxj", "bxk", "bxl", "bxm", "bxn", "bxo", "bxp", "bxq", "bxr", "bxs", "bxu", "bxv", "bxw", "bxz", "bya", "byb", "byc", "byd", "bye", "byf", "byg", "byh", "byi", "byj", "byk", "byl", "bym", "byn", "byo", "byp", "byq", "byr", "bys", "byt", "byv", "byw", "byx", "byz", "bza", "bzb", "bzc", "bzd", "bze", "bzf", "bzg", "bzh", "bzi", "bzj", "bzk", "bzl", "bzm", "bzn", "bzo", "bzp", "bzq", "bzr", "bzs", "bzt", "bzu", "bzv", "bzw", "bzx", "bzy", "bzz", "ca", "caa", "cab", "cac", "cad", "cae", "caf", "cag", "cah", "cai", "caj", "cak", "cal", "cam", "can", "cao", "cap", "caq", "car", "cas", "cau", "cav", "caw", "cax", "cay", "caz", "cba", "cbb", "cbc", "cbd", "cbg", "cbi", "cbj", "cbk", "cbl", "cbn", "cbo", "cbq", "cbr", "cbs", "cbt", "cbu", "cbv", "cbw", "cby", "ccc", "ccd", "cce", "ccg", "cch", "ccj", "ccl", "ccm", "ccn", "cco", "ccp", "ccr", "ccs", "cda", "cdc", "cdd", "cde", "cdf", "cdh", "cdi", "cdj", "cdm", "cdn", "cdo", "cdr", "cds", "cdy", "cdz", "ce", "cea", "ceb", "ceg", "cek", "cel", "cen", "cet", "cey", "cfa", "cfd", "cfg", "cfm", "cga", "cgc", "cgg", "cgk", "ch", "chb", "chc", "chd", "chf", "chg", "chh", "chj", "chk", "chl", "chm", "chn", "cho", "chp", "chq", "chr", "cht", "chw", "chx", "chy", "chz", "cia", "cib", "cic", "cid", "cie", "cih", "cik", "cim", "cin", "cip", "cir", "ciw", "ciy", "cja", "cje", "cjh", "cji", "cjk", "cjm", "cjn", "cjo", "cjp", "cjs", "cjv", "cjy", "ckb", "ckh", "ckl", "ckm", "ckn", "cko", "ckq", "ckr", "cks", "ckt", "cku", "ckv", "ckx", "cky", "ckz", "cla", "clc", "cld", "cle", "clh", "cli", "clj", "clk", "cll", "clm", "clo", "cls", "clt", "clu", "clw", "cly", "cma", "cmc", "cme", "cmg", "cmi", "cml", "cmm", "cmn", "cmo", "cmr", "cms", "cmt", "cna", "cnb", "cnc", "cng", "cnh", "cni", "cnk", "cnl", "cno", "cnp", "cnq", "cnr", "cns", "cnt", "cnu", "cnw", "cnx", "co", "coa", "cob", "coc", "cod", "coe", "cof", "cog", "coh", "coj", "cok", "col", "com", "con", "coo", "cop", "coq", "cot", "cou", "cov", "cow", "cox", "coz", "cpa", "cpb", "cpc", "cpe", "cpf", "cpg", "cpi", "cpn", "cpo", "cpp", "cps", "cpu", "cpx", "cpy", "cqd", "cr", "cra", "crb", "crc", "crd", "crf", "crg", "crh", "cri", "crj", "crk", "crl", "crm", "crn", "cro", "crp", "crq", "crr", "crs", "crt", "crv", "crw", "crx", "cry", "crz", "cs", "csa", "csb", "csc", "csd", "cse", "csf", "csg", "csh", "csi", "csj", "csk", "csl", "csm", "csn", "cso", "csp", "csq", "csr", "css", "cst", "csu", "csv", "csw", "csx", "csy", "csz", "cta", "ctc", "ctd", "cte", "ctg", "cth", "ctl", "ctm", "ctn", "cto", "ctp", "cts", "ctt", "ctu", "cty", "ctz", "cu", "cua", "cub", "cuc", "cuh", "cui", "cuj", "cuk", "cul", "cuo", "cup", "cuq", "cur", "cus", "cut", "cuu", "cuv", "cuw", "cux", "cuy", "cv", "cvg", "cvn", "cwa", "cwb", "cwd", "cwe", "cwg", "cwt", "cxh", "cy", "cya", "cyb", "cyo", "czh", "czk", "czn", "czo", "czt", "da", "daa", "dac", "dad", "dae", "dag", "dah", "dai", "daj", "dak", "dal", "dam", "dao", "daq", "dar", "das", "dau", "dav", "daw", "dax", "day", "daz", "dba", "dbb", "dbd", "dbe", "dbf", "dbg", "dbi", "dbj", "dbl", "dbm", "dbn", "dbo", "dbp", "dbq", "dbr", "dbt", "dbu", "dbv", "dbw", "dby", "dcc", "dcr", "dda", "ddd", "dde", "ddg", "ddi", "ddj", "ddn", "ddo", "ddr", "dds", "ddw", "de", "dec", "ded", "dee", "def", "deg", "deh", "dei", "del", "dem", "den", "dep", "deq", "der", "des", "dev", "dez", "dga", "dgb", "dgc", "dgd", "dge", "dgg", "dgh", "dgi", "dgk", "dgl", "dgn", "dgo", "dgr", "dgs", "dgt", "dgw", "dgx", "dgz", "dhd", "dhg", "dhi", "dhl", "dhm", "dhn", "dho", "dhr", "dhs", "dhu", "dhv", "dhw", "dhx", "dia", "dib", "dic", "did", "dif", "dig", "dih", "dii", "dij", "dik", "dil", "dim", "din", "dio", "dip", "diq", "dir", "dis", "diu", "diw", "dix", "diy", "diz", "dja", "djb", "djc", "djd", "dje", "djf", "dji", "djj", "djk", "djm", "djn", "djo", "djr", "dju", "djw", "dka", "dkg", "dkk", "dkr", "dks", "dkx", "dlg", "dlk", "dlm", "dln", "dma", "dmb", "dmc", "dmd", "dme", "dmf", "dmg", "dmk", "dml", "dmm", "dmn", "dmo", "dmr", "dms", "dmu", "dmv", "dmw", "dmx", "dmy", "dna", "dnd", "dne", "dng", "dni", "dnj", "dnk", "dnn", "dno", "dnr", "dnt", "dnu", "dnv", "dnw", "dny", "doa", "dob", "doc", "doe", "dof", "doh", "doi", "dok", "dol", "don", "doo", "dop", "doq", "dor", "dos", "dot", "dov", "dow", "dox", "doy", "doz", "dpp", "dra", "drb", "drc", "drd", "dre", "drg", "dri", "drl", "drn", "dro", "drq", "drs", "drt", "dru", "dry", "dsb", "dse", "dsh", "dsi", "dsk", "dsl", "dsn", "dso", "dsq", "dsz", "dta", "dtb", "dtd", "dth", "dti", "dtk", "dtm", "dtn", "dto", "dtp", "dtr", "dts", "dtt", "dtu", "dty", "dua", "dub", "duc", "due", "duf", "dug", "duh", "dui", "duk", "dul", "dum", "dun", "duo", "dup", "duq", "dur", "dus", "duu", "duv", "duw", "dux", "duy", "duz", "dv", "dva", "dwa", "dwk", "dwr", "dws", "dwu", "dww", "dwy", "dwz", "dya", "dyb", "dyd", "dyg", "dyi", "dyl", "dym", "dyn", "dyo", "dyr", "dyu", "dyy", "dz", "dza", "dzd", "dze", "dzg", "dzl", "dzn", "eaa", "ebc", "ebg", "ebk", "ebo", "ebr", "ebu", "ecr", "ecs", "ecy", "ee", "eee", "efa", "efe", "efi", "ega", "egl", "egm", "ego", "egx", "egy", "ehs", "ehu", "eip", "eit", "eiv", "eja", "eka", "eke", "ekg", "eki", "ekk", "ekl", "ekm", "eko", "ekp", "ekr", "eky", "el", "ele", "elh", "eli", "elk", "elm", "elo", "elu", "elx", "ema", "emb", "eme", "emg", "emi", "emk", "emm", "emn", "emp", "emq", "ems", "emu", "emw", "emx", "emy", "emz", "en", "ena", "enb", "enc", "end", "enf", "enh", "enl", "enm", "enn", "eno", "enq", "enr", "enu", "env", "enw", "enx", "eo", "eot", "epi", "era", "erg", "erh", "eri", "erk", "ero", "err", "ers", "ert", "erw", "es", "ese", "esg", "esh", "esi", "esk", "esl", "esm", "esn", "eso", "esq", "ess", "esu", "esx", "esy", "et", "etb", "etc", "eth", "etn", "eto", "etr", "ets", "ett", "etu", "etx", "etz", "eu", "eud", "euq", "eve", "evh", "evn", "ewo", "ext", "eya", "eyo", "eza", "eze", "fa", "faa", "fab", "fad", "faf", "fag", "fah", "fai", "faj", "fak", "fal", "fam", "fan", "fap", "far", "fat", "fau", "fax", "fay", "faz", "fbl", "fcs", "fer", "ff", "ffi", "ffm", "fgr", "fi", "fia", "fie", "fif", "fil", "fip", "fir", "fit", "fiu", "fiw", "fj", "fkk", "fkv", "fla", "flh", "fli", "fll", "fln", "flr", "fly", "fmp", "fmu", "fnb", "fng", "fni", "fo", "fod", "foi", "fom", "fon", "for", "fos", "fox", "fpe", "fqs", "fr", "frc", "frd", "frk", "frm", "fro", "frp", "frq", "frr", "frs", "frt", "fse", "fsl", "fss", "fub", "fuc", "fud", "fue", "fuf", "fuh", "fui", "fuj", "fum", "fun", "fuq", "fur", "fut", "fuu", "fuv", "fuy", "fvr", "fwa", "fwe", "fy", "ga", "gaa", "gab", "gac", "gad", "gae", "gaf", "gag", "gah", "gai", "gaj", "gak", "gal", "gam", "gan", "gao", "gap", "gaq", "gar", "gas", "gat", "gau", "gaw", "gax", "gay", "gaz", "gba", "gbb", "gbd", "gbe", "gbf", "gbg", "gbh", "gbi", "gbj", "gbk", "gbl", "gbm", "gbn", "gbo", "gbp", "gbq", "gbr", "gbs", "gbu", "gbv", "gbw", "gbx", "gby", "gbz", "gcc", "gcd", "gce", "gcf", "gcl", "gcn", "gcr", "gct", "gd", "gda", "gdb", "gdc", "gdd", "gde", "gdf", "gdg", "gdh", "gdi", "gdj", "gdk", "gdl", "gdm", "gdn", "gdo", "gdq", "gdr", "gds", "gdt", "gdu", "gdx", "gea", "geb", "gec", "ged", "gef", "geg", "geh", "gei", "gej", "gek", "gel", "gem", "geq", "ges", "gev", "gew", "gex", "gey", "gez", "gfk", "gft", "gga", "ggb", "ggd", "gge", "ggg", "ggk", "ggl", "ggt", "ggu", "ggw", "gha", "ghc", "ghe", "ghh", "ghk", "ghl", "ghn", "gho", "ghr", "ghs", "ght", "gia", "gib", "gic", "gid", "gie", "gig", "gih", "gii", "gil", "gim", "gin", "gip", "giq", "gir", "gis", "git", "giu", "giw", "gix", "giy", "giz", "gjk", "gjm", "gjn", "gjr", "gju", "gka", "gkd", "gke", "gkn", "gko", "gkp", "gku", "gl", "glb", "glc", "gld", "glh", "glj", "glk", "gll", "glo", "glr", "glu", "glw", "gly", "gma", "gmb", "gmd", "gme", "gmg", "gmh", "gml", "gmm", "gmn", "gmq", "gmr", "gmu", "gmv", "gmw", "gmx", "gmy", "gmz", "gn", "gna", "gnb", "gnc", "gnd", "gne", "gng", "gnh", "gni", "gnj", "gnk", "gnl", "gnm", "gnn", "gno", "gnq", "gnr", "gnt", "gnu", "gnw", "gnz", "goa", "gob", "goc", "god", "goe", "gof", "gog", "goh", "goi", "goj", "gok", "gol", "gom", "gon", "goo", "gop", "goq", "gor", "gos", "got", "gou", "gov", "gow", "gox", "goy", "goz", "gpa", "gpe", "gpn", "gqa", "gqi", "gqn", "gqr", "gqu", "gra", "grb", "grc", "grd", "grg", "grh", "gri", "grj", "grk", "grm", "gro", "grq", "grr", "grs", "grt", "gru", "grv", "grw", "grx", "gry", "grz", "gse", "gsg", "gsl", "gsm", "gsn", "gso", "gsp", "gss", "gsw", "gta", "gtu", "gu", "gua", "gub", "guc", "gud", "gue", "guf", "gug", "guh", "gui", "guk", "gul", "gum", "gun", "guo", "gup", "guq", "gur", "gus", "gut", "guu", "guw", "gux", "guz", "gv", "gva", "gvc", "gve", "gvf", "gvj", "gvl", "gvm", "gvn", "gvo", "gvp", "gvr", "gvs", "gvy", "gwa", "gwb", "gwc", "gwd", "gwe", "gwf", "gwg", "gwi", "gwj", "gwm", "gwn", "gwr", "gwt", "gwu", "gww", "gwx", "gxx", "gya", "gyb", "gyd", "gye", "gyf", "gyg", "gyi", "gyl", "gym", "gyn", "gyo", "gyr", "gyy", "gyz", "gza", "gzi", "gzn", "ha", "haa", "hab", "hac", "had", "hae", "haf", "hag", "hah", "hai", "haj", "hak", "hal", "ham", "han", "hao", "hap", "haq", "har", "has", "hav", "haw", "hax", "hay", "haz", "hba", "hbb", "hbn", "hbo", "hbu", "hca", "hch", "hdn", "hds", "hdy", "he", "hea", "hed", "heg", "heh", "hei", "hem", "hgm", "hgw", "hhi", "hhr", "hhy", "hi", "hia", "hib", "hid", "hif", "hig", "hih", "hii", "hij", "hik", "hil", "him", "hio", "hir", "hit", "hiw", "hix", "hji", "hka", "hke", "hkh", "hkk", "hkn", "hks", "hla", "hlb", "hld", "hle", "hlt", "hlu", "hma", "hmb", "hmc", "hmd", "hme", "hmf", "hmg", "hmh", "hmi", "hmj", "hmk", "hml", "hmm", "hmn", "hmp", "hmq", "hmr", "hms", "hmt", "hmu", "hmv", "hmw", "hmx", "hmy", "hmz", "hna", "hnd", "hne", "hng", "hnh", "hni", "hnj", "hnm", "hnn", "hno", "hns", "hnu", "ho", "hoa", "hob", "hoc", "hod", "hoe", "hoh", "hoi", "hoj", "hok", "hol", "hom", "hoo", "hop", "hor", "hos", "hot", "hov", "how", "hoy", "hoz", "hpo", "hps", "hr", "hra", "hrc", "hre", "hrk", "hrm", "hro", "hrp", "hrt", "hru", "hrw", "hrx", "hrz", "hsb", "hsh", "hsl", "hsn", "hss", "ht", "hti", "hto", "hts", "htu", "htx", "hu", "hub", "huc", "hud", "hue", "huf", "hug", "huh", "hui", "huj", "huk", "hul", "hum", "huo", "hup", "huq", "hur", "hus", "hut", "huu", "huv", "huw", "hux", "huy", "huz", "hvc", "hve", "hvk", "hvn", "hvv", "hwa", "hwc", "hwo", "hy", "hya", "hyw", "hyx", "hz", "ia", "iai", "ian", "iar", "iba", "ibb", "ibd", "ibe", "ibg", "ibh", "ibl", "ibm", "ibn", "ibr", "ibu", "iby", "ica", "ich", "icl", "icr", "id", "ida", "idb", "idc", "idd", "ide", "idi", "idr", "ids", "idt", "idu", "ie", "ifa", "ifb", "ife", "iff", "ifk", "ifm", "ifu", "ify", "ig", "igb", "ige", "igg", "igl", "igm", "ign", "igo", "igs", "igw", "ihb", "ihi", "ihp", "ihw", "ii", "iin", "iir", "ijc", "ije", "ijj", "ijn", "ijo", "ijs", "ik", "ike", "ikh", "iki", "ikk", "ikl", "iko", "ikp", "ikr", "iks", "ikt", "ikv", "ikw", "ikx", "ikz", "ila", "ilb", "ilg", "ili", "ilk", "ilm", "ilo", "ilp", "ils", "ilu", "ilv", "ima", "imi", "iml", "imn", "imo", "imr", "ims", "imt", "imy", "inb", "inc", "ine", "ing", "inh", "inj", "inl", "inm", "inn", "ino", "inp", "ins", "int", "inz", "io", "ior", "iou", "iow", "ipi", "ipo", "iqu", "iqw", "ira", "ire", "irh", "iri", "irk", "irn", "iro", "irr", "iru", "irx", "iry", "is", "isa", "isc", "isd", "ise", "isg", "ish", "isi", "isk", "ism", "isn", "iso", "isr", "ist", "isu", "isv", "it", "itb", "itc", "itd", "ite", "iti", "itk", "itl", "itm", "ito", "itr", "its", "itt", "itv", "itw", "itx", "ity", "itz", "iu", "ium", "ivb", "ivv", "iwk", "iwm", "iwo", "iws", "ixc", "ixl", "iya", "iyo", "iyx", "izh", "izm", "izr", "izz", "ja", "jaa", "jab", "jac", "jad", "jae", "jaf", "jah", "jaj", "jak", "jal", "jam", "jan", "jao", "jaq", "jas", "jat", "jau", "jax", "jay", "jaz", "jbe", "jbi", "jbj", "jbk", "jbm", "jbn", "jbo", "jbr", "jbt", "jbu", "jbw", "jcs", "jct", "jda", "jdg", "jdt", "jeb", "jee", "jeh", "jei", "jek", "jel", "jen", "jer", "jet", "jeu", "jgb", "jge", "jgk", "jgo", "jhi", "jhs", "jia", "jib", "jic", "jid", "jie", "jig", "jih", "jii", "jil", "jim", "jio", "jiq", "jit", "jiu", "jiv", "jiy", "jje", "jjr", "jka", "jkm", "jko", "jkp", "jkr", "jks", "jku", "jle", "jls", "jma", "jmb", "jmc", "jmd", "jmi", "jml", "jmn", "jmr", "jms", "jmw", "jmx", "jna", "jnd", "jng", "jni", "jnj", "jnl", "jns", "job", "jod", "jog", "jor", "jos", "jow", "jpa", "jpr", "jpx", "jqr", "jra", "jrb", "jrr", "jrt", "jru", "jsl", "jua", "jub", "juc", "jud", "juh", "jui", "juk", "jul", "jum", "jun", "juo", "jup", "jur", "jus", "jut", "juu", "juw", "juy", "jv", "jvd", "jvn", "jwi", "jya", "jye", "jyy", "ka", "kaa", "kab", "kac", "kad", "kae", "kaf", "kag", "kah", "kai", "kaj", "kak", "kam", "kao", "kap", "kaq", "kar", "kav", "kaw", "kax", "kay", "kba", "kbb", "kbc", "kbd", "kbe", "kbg", "kbh", "kbi", "kbj", "kbk", "kbl", "kbm", "kbn", "kbo", "kbp", "kbq", "kbr", "kbs", "kbt", "kbu", "kbv", "kbw", "kbx", "kby", "kbz", "kca", "kcb", "kcc", "kcd", "kce", "kcf", "kcg", "kch", "kci", "kcj", "kck", "kcl", "kcm", "kcn", "kco", "kcp", "kcq", "kcr", "kcs", "kct", "kcu", "kcv", "kcw", "kcx", "kcy", "kcz", "kda", "kdc", "kdd", "kde", "kdf", "kdg", "kdh", "kdi", "kdj", "kdk", "kdl", "kdm", "kdn", "kdo", "kdp", "kdq", "kdr", "kdt", "kdu", "kdw", "kdx", "kdy", "kdz", "kea", "keb", "kec", "ked", "kee", "kef", "keg", "keh", "kei", "kej", "kek", "kel", "kem", "ken", "keo", "kep", "keq", "ker", "kes", "ket", "keu", "kev", "kew", "kex", "key", "kez", "kfa", "kfb", "kfc", "kfd", "kfe", "kff", "kfg", "kfh", "kfi", "kfj", "kfk", "kfl", "kfm", "kfn", "kfo", "kfp", "kfq", "kfr", "kfs", "kft", "kfu", "kfv", "kfw", "kfx", "kfy", "kfz", "kg", "kga", "kgb", "kge", "kgf", "kgg", "kgi", "kgj", "kgk", "kgl", "kgn", "kgo", "kgp", "kgq", "kgr", "kgs", "kgt", "kgu", "kgv", "kgw", "kgx", "kgy", "kha", "khb", "khc", "khd", "khe", "khf", "khg", "khh", "khi", "khj", "khk", "khl", "khn", "kho", "khp", "khq", "khr", "khs", "kht", "khu", "khv", "khw", "khx", "khy", "khz", "ki", "kia", "kib", "kic", "kid", "kie", "kif", "kig", "kih", "kii", "kij", "kil", "kim", "kio", "kip", "kiq", "kis", "kit", "kiu", "kiv", "kiw", "kix", "kiy", "kiz", "kj", "kja", "kjb", "kjc", "kjd", "kje", "kjg", "kjh", "kji", "kjj", "kjk", "kjl", "kjm", "kjn", "kjo", "kjp", "kjq", "kjr", "kjs", "kjt", "kju", "kjv", "kjx", "kjy", "kjz", "kk", "kka", "kkb", "kkc", "kkd", "kke", "kkf", "kkg", "kkh", "kki", "kkj", "kkk", "kkl", "kkm", "kkn", "kko", "kkp", "kkq", "kkr", "kks", "kkt", "kku", "kkv", "kkw", "kkx", "kky", "kkz", "kl", "kla", "klb", "klc", "kld", "kle", "klf", "klg", "klh", "kli", "klj", "klk", "kll", "klm", "kln", "klo", "klp", "klq", "klr", "kls", "klt", "klu", "klv", "klw", "klx", "kly", "klz", "km", "kma", "kmb", "kmc", "kmd", "kme", "kmf", "kmg", "kmh", "kmi", "kmj", "kmk", "kml", "kmm", "kmn", "kmo", "kmp", "kmq", "kmr", "kms", "kmt", "kmu", "kmv", "kmw", "kmx", "kmy", "kmz", "kn", "kna", "knb", "knc", "knd", "kne", "knf", "kng", "kni", "knj", "knk", "knl", "knm", "knn", "kno", "knp", "knq", "knr", "kns", "knt", "knu", "knv", "knw", "knx", "kny", "knz", "ko", "koa", "koc", "kod", "koe", "kof", "kog", "koh", "koi", "kok", "kol", "koo", "kop", "koq", "kos", "kot", "kou", "kov", "kow", "koy", "koz", "kpa", "kpb", "kpc", "kpd", "kpe", "kpf", "kpg", "kph", "kpi", "kpj", "kpk", "kpl", "kpm", "kpn", "kpo", "kpq", "kpr", "kps", "kpt", "kpu", "kpv", "kpw", "kpx", "kpy", "kpz", "kqa", "kqb", "kqc", "kqd", "kqe", "kqf", "kqg", "kqh", "kqi", "kqj", "kqk", "kql", "kqm", "kqn", "kqo", "kqp", "kqq", "kqr", "kqs", "kqt", "kqu", "kqv", "kqw", "kqx", "kqy", "kqz", "kr", "kra", "krb", "krc", "krd", "kre", "krf", "krh", "kri", "krj", "krk", "krl", "krn", "kro", "krp", "krr", "krs", "krt", "kru", "krv", "krw", "krx", "kry", "krz", "ks", "ksb", "ksc", "ksd", "kse", "ksf", "ksg", "ksh", "ksi", "ksj", "ksk", "ksl", "ksm", "ksn", "kso", "ksp", "ksq", "ksr", "kss", "kst", "ksu", "ksv", "ksw", "ksx", "ksy", "ksz", "kta", "ktb", "ktc", "ktd", "kte", "ktf", "ktg", "kth", "kti", "ktj", "ktk", "ktl", "ktm", "ktn", "kto", "ktp", "ktq", "kts", "ktt", "ktu", "ktv", "ktw", "ktx", "kty", "ktz", "ku", "kub", "kuc", "kud", "kue", "kuf", "kug", "kuh", "kui", "kuj", "kuk", "kul", "kum", "kun", "kuo", "kup", "kuq", "kus", "kut", "kuu", "kuv", "kuw", "kux", "kuy", "kuz", "kv", "kva", "kvb", "kvc", "kvd", "kve", "kvf", "kvg", "kvh", "kvi", "kvj", "kvk", "kvl", "kvm", "kvn", "kvo", "kvp", "kvq", "kvr", "kvt", "kvu", "kvv", "kvw", "kvx", "kvy", "kvz", "kw", "kwa", "kwb", "kwc", "kwd", "kwe", "kwf", "kwg", "kwh", "kwi", "kwj", "kwk", "kwl", "kwm", "kwn", "kwo", "kwp", "kwr", "kws", "kwt", "kwu", "kwv", "kww", "kwx", "kwy", "kwz", "kxa", "kxb", "kxc", "kxd", "kxf", "kxh", "kxi", "kxj", "kxk", "kxm", "kxn", "kxo", "kxp", "kxq", "kxr", "kxs", "kxt", "kxv", "kxw", "kxx", "kxy", "kxz", "ky", "kya", "kyb", "kyc", "kyd", "kye", "kyf", "kyg", "kyh", "kyi", "kyj", "kyk", "kyl", "kym", "kyn", "kyo", "kyp", "kyq", "kyr", "kys", "kyt", "kyu", "kyv", "kyw", "kyx", "kyy", "kyz", "kza", "kzb", "kzc", "kzd", "kze", "kzf", "kzg", "kzi", "kzk", "kzl", "kzm", "kzn", "kzo", "kzp", "kzq", "kzr", "kzs", "kzu", "kzv", "kzw", "kzx", "kzy", "kzz", "la", "laa", "lab", "lac", "lad", "lae", "laf", "lag", "lah", "lai", "laj", "lal", "lam", "lan", "lap", "laq", "lar", "las", "lau", "law", "lax", "lay", "laz", "lb", "lbb", "lbc", "lbe", "lbf", "lbg", "lbi", "lbj", "lbk", "lbl", "lbm", "lbn", "lbo", "lbq", "lbr", "lbs", "lbt", "lbu", "lbv", "lbw", "lbx", "lby", "lbz", "lcc", "lcd", "lce", "lcf", "lch", "lcl", "lcm", "lcp", "lcq", "lcs", "lda", "ldb", "ldd", "ldg", "ldh", "ldi", "ldj", "ldk", "ldl", "ldm", "ldn", "ldo", "ldp", "ldq", "lea", "leb", "lec", "led", "lee", "lef", "leh", "lei", "lej", "lek", "lel", "lem", "len", "leo", "lep", "leq", "ler", "les", "let", "leu", "lev", "lew", "lex", "ley", "lez", "lfa", "lfb", "lfn", "lg", "lga", "lgb", "lgg", "lgh", "lgi", "lgk", "lgl", "lgm", "lgn", "lgo", "lgq", "lgr", "lgs", "lgt", "lgu", "lgz", "lha", "lhh", "lhi", "lhl", "lhm", "lhn", "lhp", "lhs", "lht", "lhu", "li", "lia", "lib", "lic", "lid", "lie", "lif", "lig", "lih", "lij", "lik", "lil", "lio", "lip", "liq", "lir", "lis", "liu", "liv", "liw", "lix", "liy", "liz", "lja", "lje", "lji", "ljl", "ljp", "ljw", "ljx", "lka", "lkb", "lkc", "lkd", "lke", "lkh", "lki", "lkj", "lkl", "lkm", "lkn", "lko", "lkr", "lks", "lkt", "lku", "lky", "lla", "llb", "llc", "lld", "lle", "llf", "llg", "llh", "lli", "llj", "llk", "lll", "llm", "lln", "llp", "llq", "lls", "llu", "llx", "lma", "lmb", "lmc", "lmd", "lme", "lmf", "lmg", "lmh", "lmi", "lmj", "lmk", "lml", "lmn", "lmo", "lmp", "lmq", "lmr", "lmu", "lmv", "lmw", "lmx", "lmy", "ln", "lna", "lnb", "lnd", "lng", "lnh", "lni", "lnj", "lnl", "lnm", "lnn", "lns", "lnu", "lnw", "lnz", "lo", "loa", "lob", "loc", "loe", "lof", "log", "loh", "loi", "loj", "lok", "lol", "lom", "lon", "loo", "lop", "loq", "lor", "los", "lot", "lou", "lov", "low", "lox", "loy", "loz", "lpa", "lpe", "lpn", "lpo", "lpx", "lqr", "lra", "lrc", "lre", "lrg", "lri", "lrk", "lrl", "lrm", "lrn", "lro", "lrr", "lrt", "lrv", "lrz", "lsa", "lsb", "lsc", "lsd", "lse", "lsh", "lsi", "lsl", "lsm", "lsn", "lso", "lsp", "lsr", "lss", "lst", "lsv", "lsw", "lsy", "lt", "ltc", "ltg", "lth", "lti", "ltn", "lto", "lts", "ltu", "lu", "lua", "luc", "lud", "lue", "luf", "luh", "lui", "luj", "luk", "lul", "lum", "lun", "luo", "lup", "luq", "lur", "lus", "lut", "luu", "luv", "luw", "luy", "luz", "lv", "lva", "lvi", "lvk", "lvl", "lvs", "lvu", "lwa", "lwe", "lwg", "lwh", "lwl", "lwm", "lwo", "lws", "lwt", "lwu", "lww", "lxm", "lya", "lyg", "lyn", "lzh", "lzl", "lzn", "lzz", "maa", "mab", "mad", "mae", "maf", "mag", "mai", "maj", "mak", "mam", "man", "map", "maq", "mas", "mat", "mau", "mav", "maw", "max", "maz", "mba", "mbb", "mbc", "mbd", "mbe", "mbf", "mbh", "mbi", "mbj", "mbk", "mbl", "mbm", "mbn", "mbo", "mbp", "mbq", "mbr", "mbs", "mbt", "mbu", "mbv", "mbw", "mbx", "mby", "mbz", "mca", "mcb", "mcc", "mcd", "mce", "mcf", "mcg", "mch", "mci", "mcj", "mck", "mcl", "mcm", "mcn", "mco", "mcp", "mcq", "mcr", "mcs", "mct", "mcu", "mcv", "mcw", "mcx", "mcy", "mcz", "mda", "mdb", "mdc", "mdd", "mde", "mdf", "mdg", "mdh", "mdi", "mdj", "mdk", "mdl", "mdm", "mdn", "mdp", "mdq", "mdr", "mds", "mdt", "mdu", "mdv", "mdw", "mdx", "mdy", "mdz", "mea", "meb", "mec", "med", "mee", "mef", "meh", "mei", "mej", "mek", "mel", "mem", "men", "meo", "mep", "meq", "mer", "mes", "met", "meu", "mev", "mew", "mey", "mez", "mfa", "mfb", "mfc", "mfd", "mfe", "mff", "mfg", "mfh", "mfi", "mfj", "mfk", "mfl", "mfm", "mfn", "mfo", "mfp", "mfq", "mfr", "mfs", "mft", "mfu", "mfv", "mfw", "mfx", "mfy", "mfz", "mg", "mga", "mgb", "mgc", "mgd", "mge", "mgf", "mgg", "mgh", "mgi", "mgj", "mgk", "mgl", "mgm", "mgn", "mgo", "mgp", "mgq", "mgr", "mgs", "mgt", "mgu", "mgv", "mgw", "mgy", "mgz", "mh", "mha", "mhb", "mhc", "mhd", "mhe", "mhf", "mhg", "mhi", "mhj", "mhk", "mhl", "mhm", "mhn", "mho", "mhp", "mhq", "mhr", "mhs", "mht", "mhu", "mhw", "mhx", "mhy", "mhz", "mi", "mia", "mib", "mic", "mid", "mie", "mif", "mig", "mih", "mii", "mij", "mik", "mil", "mim", "min", "mio", "mip", "miq", "mir", "mis", "mit", "miu", "miw", "mix", "miy", "miz", "mjb", "mjc", "mjd", "mje", "mjg", "mjh", "mji", "mjj", "mjk", "mjl", "mjm", "mjn", "mjo", "mjp", "mjq", "mjr", "mjs", "mjt", "mju", "mjv", "mjw", "mjx", "mjy", "mjz", "mk", "mka", "mkb", "mkc", "mke", "mkf", "mkg", "mkh", "mki", "mkj", "mkk", "mkl", "mkm", "mkn", "mko", "mkp", "mkq", "mkr", "mks", "mkt", "mku", "mkv", "mkw", "mkx", "mky", "mkz", "ml", "mla", "mlb", "mlc", "mle", "mlf", "mlh", "mli", "mlj", "mlk", "mll", "mlm", "mln", "mlo", "mlp", "mlq", "mlr", "mls", "mlu", "mlv", "mlw", "mlx", "mlz", "mma", "mmb", "mmc", "mmd", "mme", "mmf", "mmg", "mmh", "mmi", "mmj", "mmk", "mml", "mmm", "mmn", "mmo", "mmp", "mmq", "mmr", "mmt", "mmu", "mmv", "mmw", "mmx", "mmy", "mmz", "mn", "mna", "mnb", "mnc", "mnd", "mne", "mnf", "mng", "mnh", "mni", "mnj", "mnk", "mnl", "mnm", "mnn", "mno", "mnp", "mnq", "mnr", "mns", "mnu", "mnv", "mnw", "mnx", "mny", "mnz", "moa", "moc", "mod", "moe", "mog", "moh", "moi", "moj", "mok", "mom", "moo", "mop", "moq", "mor", "mos", "mot", "mou", "mov", "mow", "mox", "moy", "moz", "mpa", "mpb", "mpc", "mpd", "mpe", "mpg", "mph", "mpi", "mpj", "mpk", "mpl", "mpm", "mpn", "mpo", "mpp", "mpq", "mpr", "mps", "mpt", "mpu", "mpv", "mpw", "mpx", "mpy", "mpz", "mqa", "mqb", "mqc", "mqe", "mqf", "mqg", "mqh", "mqi", "mqj", "mqk", "mql", "mqm", "mqn", "mqo", "mqp", "mqq", "mqr", "mqs", "mqt", "mqu", "mqv", "mqw", "mqx", "mqy", "mqz", "mr", "mra", "mrb", "mrc", "mre", "mrf", "mrg", "mrh", "mrj", "mrk", "mrl", "mrm", "mrn", "mro", "mrp", "mrq", "mrr", "mrs", "mrt", "mru", "mrv", "mrw", "mrx", "mry", "mrz", "ms", "msb", "msc", "msd", "mse", "msf", "msg", "msh", "msi", "msj", "msk", "msl", "msm", "msn", "mso", "msp", "msq", "msr", "mss", "msu", "msv", "msw", "msx", "msy", "msz", "mt", "mta", "mtb", "mtc", "mtd", "mte", "mtf", "mtg", "mth", "mti", "mtj", "mtk", "mtl", "mtm", "mtn", "mto", "mtp", "mtq", "mtr", "mts", "mtt", "mtu", "mtv", "mtw", "mtx", "mty", "mua", "mub", "muc", "mud", "mue", "mug", "muh", "mui", "muj", "muk", "mul", "mum", "mun", "muo", "mup", "muq", "mur", "mus", "mut", "muu", "muv", "mux", "muy", "muz", "mva", "mvb", "mvd", "mve", "mvf", "mvg", "mvh", "mvi", "mvk", "mvl", "mvn", "mvo", "mvp", "mvq", "mvr", "mvs", "mvt", "mvu", "mvv", "mvw", "mvx", "mvy", "mvz", "mwa", "mwb", "mwc", "mwe", "mwf", "mwg", "mwh", "mwi", "mwk", "mwl", "mwm", "mwn", "mwo", "mwp", "mwq", "mwr", "mws", "mwt", "mwu", "mwv", "mww", "mwz", "mxa", "mxb", "mxc", "mxd", "mxe", "mxf", "mxg", "mxh", "mxi", "mxj", "mxk", "mxl", "mxm", "mxn", "mxo", "mxp", "mxq", "mxr", "mxs", "mxt", "mxu", "mxv", "mxw", "mxx", "mxy", "mxz", "my", "myb", "myc", "mye", "myf", "myg", "myh", "myj", "myk", "myl", "mym", "myn", "myo", "myp", "myr", "mys", "myu", "myv", "myw", "myx", "myy", "myz", "mza", "mzb", "mzc", "mzd", "mze", "mzg", "mzh", "mzi", "mzj", "mzk", "mzl", "mzm", "mzn", "mzo", "mzp", "mzq", "mzr", "mzs", "mzt", "mzu", "mzv", "mzw", "mzx", "mzy", "mzz", "na", "naa", "nab", "nac", "nae", "naf", "nag", "nah", "nai", "naj", "nak", "nal", "nam", "nan", "nao", "nap", "naq", "nar", "nas", "nat", "naw", "nax", "nay", "naz", "nb", "nba", "nbb", "nbc", "nbd", "nbe", "nbg", "nbh", "nbi", "nbj", "nbk", "nbm", "nbn", "nbo", "nbp", "nbq", "nbr", "nbs", "nbt", "nbu", "nbv", "nbw", "nby", "nca", "ncb", "ncc", "ncd", "nce", "ncf", "ncg", "nch", "nci", "ncj", "nck", "ncl", "ncm", "ncn", "nco", "ncq", "ncr", "ncs", "nct", "ncu", "ncx", "ncz", "nd", "nda", "ndb", "ndc", "ndd", "ndf", "ndg", "ndh", "ndi", "ndj", "ndk", "ndl", "ndm", "ndn", "ndp", "ndq", "ndr", "nds", "ndt", "ndu", "ndv", "ndw", "ndx", "ndy", "ndz", "ne", "nea", "neb", "nec", "ned", "nee", "nef", "neg", "neh", "nei", "nej", "nek", "nem", "nen", "neo", "neq", "ner", "nes", "net", "neu", "nev", "new", "nex", "ney", "nez", "nfa", "nfd", "nfl", "nfr", "nfu", "ng", "nga", "ngb", "ngc", "ngd", "nge", "ngf", "ngg", "ngh", "ngi", "ngj", "ngk", "ngl", "ngm", "ngn", "ngp", "ngq", "ngr", "ngs", "ngt", "ngu", "ngv", "ngw", "ngx", "ngy", "ngz", "nha", "nhb", "nhc", "nhd", "nhe", "nhf", "nhg", "nhh", "nhi", "nhk", "nhm", "nhn", "nho", "nhp", "nhq", "nhr", "nht", "nhu", "nhv", "nhw", "nhx", "nhy", "nhz", "nia", "nib", "nic", "nid", "nie", "nif", "nig", "nih", "nii", "nij", "nik", "nil", "nim", "nin", "nio", "niq", "nir", "nis", "nit", "niu", "niv", "niw", "nix", "niy", "niz", "nja", "njb", "njd", "njh", "nji", "njj", "njl", "njm", "njn", "njo", "njr", "njs", "njt", "nju", "njx", "njy", "njz", "nka", "nkb", "nkc", "nkd", "nke", "nkf", "nkg", "nkh", "nki", "nkj", "nkk", "nkm", "nkn", "nko", "nkp", "nkq", "nkr", "nks", "nkt", "nku", "nkv", "nkw", "nkx", "nkz", "nl", "nla", "nlc", "nle", "nlg", "nli", "nlj", "nlk", "nll", "nlm", "nlo", "nlq", "nlu", "nlv", "nlw", "nlx", "nly", "nlz", "nma", "nmb", "nmc", "nmd", "nme", "nmf", "nmg", "nmh", "nmi", "nmj", "nmk", "nml", "nmm", "nmn", "nmo", "nmp", "nmq", "nmr", "nms", "nmt", "nmu", "nmv", "nmw", "nmx", "nmy", "nmz", "nn", "nna", "nnb", "nnc", "nnd", "nne", "nnf", "nng", "nnh", "nni", "nnj", "nnk", "nnl", "nnm", "nnn", "nnp", "nnq", "nnr", "nnt", "nnu", "nnv", "nnw", "nny", "nnz", "no", "noa", "noc", "nod", "noe", "nof", "nog", "noh", "noi", "noj", "nok", "nol", "non", "nop", "noq", "nos", "not", "nou", "nov", "now", "noy", "noz", "npa", "npb", "npg", "nph", "npi", "npl", "npn", "npo", "nps", "npu", "npx", "npy", "nqg", "nqk", "nql", "nqm", "nqn", "nqo", "nqq", "nqt", "nqy", "nr", "nra", "nrb", "nrc", "nre", "nrf", "nrg", "nri", "nrk", "nrl", "nrm", "nrn", "nrp", "nrr", "nrt", "nru", "nrx", "nrz", "nsa", "nsb", "nsc", "nsd", "nse", "nsf", "nsg", "nsh", "nsi", "nsk", "nsl", "nsm", "nsn", "nso", "nsp", "nsq", "nsr", "nss", "nst", "nsu", "nsv", "nsw", "nsx", "nsy", "nsz", "ntd", "ntg", "nti", "ntj", "ntk", "ntm", "nto", "ntp", "ntr", "ntu", "ntw", "ntx", "nty", "ntz", "nua", "nub", "nuc", "nud", "nue", "nuf", "nug", "nuh", "nui", "nuj", "nuk", "nul", "num", "nun", "nuo", "nup", "nuq", "nur", "nus", "nut", "nuu", "nuv", "nuw", "nux", "nuy", "nuz", "nv", "nvh", "nvm", "nvo", "nwa", "nwb", "nwc", "nwe", "nwg", "nwi", "nwm", "nwo", "nwr", "nww", "nwx", "nwy", "nxa", "nxd", "nxe", "nxg", "nxi", "nxk", "nxl", "nxm", "nxn", "nxo", "nxq", "nxr", "nxx", "ny", "nyb", "nyc", "nyd", "nye", "nyf", "nyg", "nyh", "nyi", "nyj", "nyk", "nyl", "nym", "nyn", "nyo", "nyp", "nyq", "nyr", "nys", "nyt", "nyu", "nyv", "nyw", "nyx", "nyy", "nza", "nzb", "nzd", "nzi", "nzk", "nzm", "nzr", "nzs", "nzu", "nzy", "nzz", "oaa", "oac", "oak", "oar", "oav", "obi", "obk", "obl", "obm", "obo", "obr", "obt", "obu", "oc", "oca", "och", "ocm", "oco", "ocu", "oda", "odk", "odt", "odu", "ofo", "ofs", "ofu", "ogb", "ogc", "oge", "ogg", "ogo", "ogu", "oht", "ohu", "oia", "oie", "oin", "oj", "ojb", "ojc", "ojg", "ojp", "ojs", "ojv", "ojw", "oka", "okb", "okc", "okd", "oke", "okg", "okh", "oki", "okj", "okk", "okl", "okm", "okn", "oko", "okr", "oks", "oku", "okv", "okx", "okz", "ola", "olb", "old", "ole", "olk", "olm", "olo", "olr", "olt", "olu", "om", "oma", "omb", "omc", "omg", "omi", "omk", "oml", "omn", "omo", "omp", "omq", "omr", "omt", "omu", "omv", "omw", "omx", "omy", "ona", "onb", "one", "ong", "oni", "onj", "onk", "onn", "ono", "onp", "onr", "ons", "ont", "onu", "onw", "onx", "ood", "oog", "oon", "oor", "oos", "opa", "opk", "opm", "opo", "opt", "opy", "or", "ora", "orc", "ore", "org", "orh", "orn", "oro", "orr", "ors", "ort", "oru", "orv", "orw", "orx", "ory", "orz", "os", "osa", "osc", "osd", "osi", "osn", "oso", "osp", "ost", "osu", "osx", "ota", "otb", "otd", "ote", "oti", "otk", "otl", "otm", "otn", "oto", "otq", "otr", "ots", "ott", "otu", "otw", "otx", "oty", "otz", "oua", "oub", "oue", "oui", "oum", "ovd", "owi", "owl", "oyb", "oyd", "oym", "oyy", "ozm", "pa", "paa", "pab", "pac", "pad", "pae", "paf", "pag", "pah", "pai", "pak", "pal", "pam", "pao", "pap", "paq", "par", "pas", "pau", "pav", "paw", "pax", "pay", "paz", "pbb", "pbc", "pbe", "pbf", "pbg", "pbh", "pbi", "pbl", "pbm", "pbn", "pbo", "pbp", "pbr", "pbs", "pbt", "pbu", "pbv", "pby", "pca", "pcb", "pcc", "pcd", "pce", "pcf", "pcg", "pch", "pci", "pcj", "pck", "pcl", "pcm", "pcn", "pcp", "pcw", "pda", "pdc", "pdi", "pdn", "pdo", "pdt", "pdu", "pea", "peb", "ped", "pee", "pef", "peg", "peh", "pei", "pej", "pek", "pel", "pem", "peo", "pep", "peq", "pes", "pev", "pex", "pey", "pez", "pfa", "pfe", "pfl", "pga", "pgd", "pgg", "pgi", "pgk", "pgl", "pgn", "pgs", "pgu", "pgz", "pha", "phd", "phg", "phh", "phi", "phj", "phk", "phl", "phm", "phn", "pho", "phq", "phr", "pht", "phu", "phv", "phw", "pi", "pia", "pib", "pic", "pid", "pie", "pif", "pig", "pih", "pij", "pil", "pim", "pin", "pio", "pip", "pir", "pis", "pit", "piu", "piv", "piw", "pix", "piy", "piz", "pjt", "pka", "pkb", "pkc", "pkg", "pkh", "pkn", "pko", "pkp", "pkr", "pks", "pkt", "pku", "pl", "pla", "plb", "plc", "pld", "ple", "plf", "plg", "plh", "plk", "pll", "pln", "plo", "plq", "plr", "pls", "plt", "plu", "plv", "plw", "ply", "plz", "pma", "pmb", "pmd", "pme", "pmf", "pmh", "pmi", "pmj", "pml", "pmm", "pmn", "pmo", "pmq", "pmr", "pms", "pmt", "pmw", "pmx", "pmy", "pmz", "pna", "pnb", "pnc", "pnd", "pne", "png", "pnh", "pni", "pnj", "pnk", "pnl", "pnm", "pnn", "pno", "pnp", "pnq", "pnr", "pns", "pnt", "pnu", "pnv", "pnw", "pnx", "pny", "pnz", "poc", "poe", "pof", "pog", "poh", "poi", "pok", "pom", "pon", "poo", "pop", "poq", "pos", "pot", "pov", "pow", "pox", "poy", "poz", "ppe", "ppi", "ppk", "ppl", "ppm", "ppn", "ppo", "ppp", "ppq", "pps", "ppt", "ppu", "pqa", "pqe", "pqm", "pqw", "pra", "prc", "prd", "pre", "prf", "prg", "prh", "pri", "prk", "prl", "prm", "prn", "pro", "prq", "prr", "prs", "prt", "pru", "prw", "prx", "prz", "ps", "psa", "psc", "psd", "pse", "psg", "psh", "psi", "psl", "psm", "psn", "pso", "psp", "psq", "psr", "pss", "pst", "psu", "psw", "psy", "pt", "pta", "pth", "pti", "ptn", "pto", "ptp", "ptq", "ptr", "ptt", "ptu", "ptv", "ptw", "pty", "pua", "pub", "puc", "pud", "pue", "puf", "pug", "pui", "puj", "pum", "puo", "pup", "puq", "pur", "put", "puu", "puw", "pux", "puy", "pwa", "pwb", "pwg", "pwi", "pwm", "pwn", "pwo", "pwr", "pww", "pxm", "pye", "pym", "pyn", "pys", "pyu", "pyx", "pyy", "pze", "pzh", "pzn", "qu", "qua", "qub", "quc", "qud", "quf", "qug", "quh", "qui", "quk", "qul", "qum", "qun", "qup", "quq", "qur", "qus", "quv", "quw", "qux", "quy", "quz", "qva", "qvc", "qve", "qvh", "qvi", "qvj", "qvl", "qvm", "qvn", "qvo", "qvp", "qvs", "qvw", "qvy", "qvz", "qwa", "qwc", "qwe", "qwh", "qwm", "qws", "qwt", "qxa", "qxc", "qxh", "qxl", "qxn", "qxo", "qxp", "qxq", "qxr", "qxs", "qxt", "qxu", "qxw", "qya", "qyp", "raa", "rab", "rac", "rad", "raf", "rag", "rah", "rai", "raj", "rak", "ral", "ram", "ran", "rao", "rap", "raq", "rar", "ras", "rat", "rau", "rav", "raw", "rax", "ray", "raz", "rbb", "rbk", "rbl", "rbp", "rcf", "rdb", "rea", "reb", "ree", "reg", "rei", "rej", "rel", "rem", "ren", "rer", "res", "ret", "rey", "rga", "rge", "rgk", "rgn", "rgr", "rgs", "rgu", "rhg", "rhp", "ria", "rib", "rif", "ril", "rim", "rin", "rir", "rit", "riu", "rjg", "rji", "rjs", "rka", "rkb", "rkh", "rki", "rkm", "rkt", "rkw", "rm", "rma", "rmb", "rmc", "rmd", "rme", "rmf", "rmg", "rmh", "rmi", "rmk", "rml", "rmm", "rmn", "rmo", "rmp", "rmq", "rms", "rmt", "rmu", "rmv", "rmw", "rmx", "rmy", "rmz", "rn", "rnb", "rnd", "rng", "rnl", "rnn", "rnp", "rnr", "rnw", "ro", "roa", "rob", "roc", "rod", "roe", "rof", "rog", "rol", "rom", "roo", "rop", "ror", "rou", "row", "rpn", "rpt", "rri", "rrm", "rro", "rrt", "rsb", "rsk", "rsl", "rsm", "rsn", "rsw", "rtc", "rth", "rtm", "rts", "rtw", "ru", "rub", "ruc", "rue", "ruf", "rug", "ruh", "rui", "ruk", "ruo", "rup", "ruq", "rut", "ruu", "ruy", "ruz", "rw", "rwa", "rwk", "rwl", "rwm", "rwo", "rwr", "rxd", "rxw", "ryn", "rys", "ryu", "rzh", "sa", "saa", "sab", "sac", "sad", "sae", "saf", "sah", "sai", "saj", "sak", "sal", "sam", "sao", "saq", "sar", "sas", "sat", "sau", "sav", "saw", "sax", "say", "saz", "sba", "sbb", "sbc", "sbd", "sbe", "sbf", "sbg", "sbh", "sbi", "sbj", "sbk", "sbl", "sbm", "sbn", "sbo", "sbp", "sbq", "sbr", "sbs", "sbt", "sbu", "sbv", "sbw", "sbx", "sby", "sbz", "sc", "scb", "sce", "scf", "scg", "sch", "sci", "sck", "scl", "scn", "sco", "scp", "scq", "scs", "sct", "scu", "scv", "scw", "scx", "scz", "sd", "sda", "sdb", "sdc", "sde", "sdf", "sdg", "sdh", "sdj", "sdk", "sdl", "sdn", "sdo", "sdp", "sdq", "sdr", "sds", "sdt", "sdu", "sdv", "sdx", "sdz", "se", "sea", "seb", "sec", "sed", "see", "sef", "seg", "seh", "sei", "sej", "sek", "sel", "sem", "sen", "seo", "sep", "seq", "ser", "ses", "set", "seu", "sev", "sew", "sey", "sez", "sfb", "sfe", "sfm", "sfs", "sfw", "sg", "sga", "sgb", "sgc", "sgd", "sge", "sgg", "sgh", "sgi", "sgj", "sgk", "sgm", "sgn", "sgp", "sgr", "sgs", "sgt", "sgu", "sgw", "sgx", "sgy", "sgz", "sh", "sha", "shb", "shc", "shd", "she", "shg", "shh", "shi", "shj", "shk", "shm", "shn", "sho", "shp", "shq", "shr", "shs", "sht", "shu", "shv", "shw", "shx", "shy", "shz", "si", "sia", "sib", "sid", "sie", "sif", "sig", "sih", "sii", "sij", "sik", "sil", "sim", "sio", "sip", "siq", "sir", "sis", "sit", "siu", "siv", "siw", "six", "siy", "siz", "sja", "sjb", "sjc", "sjd", "sje", "sjg", "sjk", "sjl", "sjm", "sjn", "sjo", "sjp", "sjr", "sjs", "sjt", "sju", "sjw", "sk", "ska", "skb", "skc", "skd", "ske", "skf", "skg", "skh", "ski", "skj", "skm", "skn", "sko", "skp", "skq", "skr", "sks", "skt", "sku", "skv", "skw", "skx", "sky", "skz", "sl", "sla", "slc", "sld", "sle", "slf", "slg", "slh", "sli", "slj", "sll", "slm", "sln", "slp", "slr", "sls", "slt", "slu", "slw", "slx", "sly", "slz", "sm", "sma", "smb", "smc", "smf", "smg", "smh", "smi", "smj", "smk", "sml", "smm", "smn", "smp", "smq", "smr", "sms", "smt", "smu", "smv", "smw", "smx", "smy", "smz", "sn", "snc", "sne", "snf", "sng", "sni", "snj", "snk", "snl", "snm", "snn", "sno", "snp", "snq", "snr", "sns", "snu", "snv", "snw", "snx", "sny", "snz", "so", "soa", "sob", "soc", "sod", "soe", "sog", "soh", "soi", "soj", "sok", "sol", "son", "soo", "sop", "soq", "sor", "sos", "sou", "sov", "sow", "sox", "soy", "soz", "spb", "spc", "spd", "spe", "spg", "spi", "spk", "spl", "spm", "spn", "spo", "spp", "spq", "spr", "sps", "spt", "spu", "spv", "spx", "spy", "sq", "sqa", "sqh", "sqj", "sqk", "sqm", "sqn", "sqo", "sqq", "sqr", "sqs", "sqt", "squ", "sqx", "sr", "sra", "srb", "src", "sre", "srf", "srg", "srh", "sri", "srk", "srl", "srm", "srn", "sro", "srq", "srr", "srs", "srt", "sru", "srv", "srw", "srx", "sry", "srz", "ss", "ssa", "ssb", "ssc", "ssd", "sse", "ssf", "ssg", "ssh", "ssi", "ssj", "ssk", "ssl", "ssm", "ssn", "sso", "ssp", "ssq", "ssr", "sss", "sst", "ssu", "ssv", "ssx", "ssy", "ssz", "st", "sta", "stb", "std", "ste", "stf", "stg", "sth", "sti", "stj", "stk", "stl", "stm", "stn", "sto", "stp", "stq", "str", "sts", "stt", "stu", "stv", "stw", "sty", "su", "sua", "sub", "suc", "sue", "sug", "sui", "suj", "suk", "suo", "suq", "sur", "sus", "sut", "suv", "suw", "sux", "suy", "suz", "sv", "sva", "svb", "svc", "sve", "svk", "svm", "svs", "svx", "sw", "swb", "swc", "swf", "swg", "swh", "swi", "swj", "swk", "swl", "swm", "swn", "swo", "swp", "swq", "swr", "sws", "swt", "swu", "swv", "sww", "swx", "swy", "sxb", "sxc", "sxe", "sxg", "sxk", "sxl", "sxm", "sxn", "sxo", "sxr", "sxs", "sxu", "sxw", "sya", "syb", "syc", "syd", "syi", "syk", "syl", "sym", "syn", "syo", "syr", "sys", "syw", "syx", "syy", "sza", "szb", "szc", "sze", "szg", "szl", "szn", "szp", "szs", "szv", "szw", "szy", "ta", "taa", "tab", "tac", "tad", "tae", "taf", "tag", "tai", "taj", "tak", "tal", "tan", "tao", "tap", "taq", "tar", "tas", "tau", "tav", "taw", "tax", "tay", "taz", "tba", "tbc", "tbd", "tbe", "tbf", "tbg", "tbh", "tbi", "tbj", "tbk", "tbl", "tbm", "tbn", "tbo", "tbp", "tbq", "tbr", "tbs", "tbt", "tbu", "tbv", "tbw", "tbx", "tby", "tbz", "tca", "tcb", "tcc", "tcd", "tce", "tcf", "tcg", "tch", "tci", "tck", "tcl", "tcm", "tcn", "tco", "tcp", "tcq", "tcs", "tct", "tcu", "tcw", "tcx", "tcy", "tcz", "tda", "tdb", "tdc", "tdd", "tde", "tdf", "tdg", "tdh", "tdi", "tdj", "tdk", "tdl", "tdm", "tdn", "tdo", "tdq", "tdr", "tds", "tdt", "tdv", "tdx", "tdy", "te", "tea", "teb", "tec", "ted", "tee", "tef", "teg", "teh", "tei", "tek", "tem", "ten", "teo", "tep", "teq", "ter", "tes", "tet", "teu", "tev", "tew", "tex", "tey", "tez", "tfi", "tfn", "tfo", "tfr", "tft", "tg", "tga", "tgb", "tgc", "tgd", "tge", "tgf", "tgh", "tgi", "tgj", "tgn", "tgo", "tgp", "tgq", "tgr", "tgs", "tgt", "tgu", "tgv", "tgw", "tgx", "tgy", "tgz", "th", "thd", "the", "thf", "thh", "thi", "thk", "thl", "thm", "thn", "thp", "thq", "thr", "ths", "tht", "thu", "thv", "thy", "thz", "ti", "tia", "tic", "tif", "tig", "tih", "tii", "tij", "tik", "til", "tim", "tin", "tio", "tip", "tiq", "tis", "tit", "tiu", "tiv", "tiw", "tix", "tiy", "tiz", "tja", "tjg", "tji", "tjj", "tjl", "tjm", "tjn", "tjo", "tjp", "tjs", "tju", "tjw", "tk", "tka", "tkb", "tkd", "tke", "tkf", "tkg", "tkl", "tkm", "tkn", "tkp", "tkq", "tkr", "tks", "tkt", "tku", "tkv", "tkw", "tkx", "tkz", "tl", "tla", "tlb", "tlc", "tld", "tlf", "tlg", "tlh", "tli", "tlj", "tlk", "tll", "tlm", "tln", "tlo", "tlp", "tlq", "tlr", "tls", "tlt", "tlu", "tlv", "tlx", "tly", "tma", "tmb", "tmc", "tmd", "tme", "tmf", "tmg", "tmh", "tmi", "tmj", "tml", "tmm", "tmn", "tmo", "tmq", "tmr", "tms", "tmt", "tmu", "tmv", "tmw", "tmy", "tmz", "tn", "tna", "tnb", "tnc", "tnd", "tng", "tnh", "tni", "tnk", "tnl", "tnm", "tnn", "tno", "tnp", "tnq", "tnr", "tns", "tnt", "tnu", "tnv", "tnw", "tnx", "tny", "tnz", "to", "tob", "toc", "tod", "tof", "tog", "toh", "toi", "toj", "tok", "tol", "tom", "too", "top", "toq", "tor", "tos", "tou", "tov", "tow", "tox", "toy", "toz", "tpa", "tpc", "tpe", "tpf", "tpg", "tpi", "tpj", "tpk", "tpl", "tpm", "tpn", "tpo", "tpp", "tpq", "tpr", "tpt", "tpu", "tpv", "tpx", "tpy", "tpz", "tqb", "tql", "tqm", "tqn", "tqo", "tqp", "tqq", "tqr", "tqt", "tqu", "tqw", "tr", "tra", "trb", "trc", "trd", "tre", "trf", "trg", "trh", "tri", "trj", "trk", "trl", "trm", "trn", "tro", "trp", "trq", "trr", "trs", "trt", "tru", "trv", "trw", "trx", "try", "trz", "ts", "tsa", "tsb", "tsc", "tsd", "tse", "tsg", "tsh", "tsi", "tsj", "tsk", "tsl", "tsm", "tsp", "tsq", "tsr", "tss", "tst", "tsu", "tsv", "tsw", "tsx", "tsy", "tsz", "tt", "tta", "ttb", "ttc", "ttd", "tte", "ttf", "ttg", "tth", "tti", "ttj", "ttk", "ttl", "ttm", "ttn", "tto", "ttp", "ttq", "ttr", "tts", "ttt", "ttu", "ttv", "ttw", "tty", "ttz", "tua", "tub", "tuc", "tud", "tue", "tuf", "tug", "tuh", "tui", "tuj", "tul", "tum", "tun", "tuo", "tup", "tuq", "tus", "tut", "tuu", "tuv", "tuw", "tux", "tuy", "tuz", "tva", "tvd", "tve", "tvg", "tvi", "tvk", "tvl", "tvm", "tvn", "tvo", "tvs", "tvt", "tvu", "tvw", "tvx", "tvy", "tw", "twa", "twb", "twc", "twd", "twe", "twf", "twg", "twh", "twl", "twm", "twn", "two", "twp", "twq", "twr", "twt", "twu", "tww", "twx", "twy", "txa", "txb", "txc", "txe", "txg", "txh", "txi", "txj", "txm", "txn", "txo", "txq", "txr", "txs", "txt", "txu", "txx", "txy", "ty", "tya", "tye", "tyh", "tyi", "tyj", "tyl", "tyn", "typ", "tyr", "tys", "tyt", "tyu", "tyv", "tyx", "tyy", "tyz", "tza", "tzh", "tzj", "tzl", "tzm", "tzn", "tzo", "tzx", "uam", "uan", "uar", "uba", "ubi", "ubl", "ubr", "ubu", "uby", "uda", "ude", "udg", "udi", "udj", "udl", "udm", "udu", "ues", "ufi", "ug", "uga", "ugb", "uge", "ugh", "ugn", "ugo", "ugy", "uha", "uhn", "uis", "uiv", "uji", "uk", "uka", "ukg", "ukh", "uki", "ukk", "ukl", "ukp", "ukq", "uks", "uku", "ukv", "ukw", "uky", "ula", "ulb", "ulc", "ule", "ulf", "uli", "ulk", "ull", "ulm", "uln", "ulu", "ulw", "uly", "uma", "umb", "umc", "umd", "umg", "umi", "umm", "umn", "umo", "ump", "umr", "ums", "umu", "una", "und", "une", "ung", "uni", "unk", "unm", "unn", "unr", "unu", "unx", "unz", "uon", "upi", "upv", "ur", "ura", "urb", "urc", "ure", "urf", "urg", "urh", "uri", "urj", "urk", "url", "urm", "urn", "uro", "urp", "urr", "urt", "uru", "urv", "urw", "urx", "ury", "urz", "usa", "ush", "usi", "usk", "usp", "uss", "usu", "uta", "ute", "uth", "utp", "utr", "utu", "uum", "uur", "uuu", "uve", "uvh", "uvl", "uwa", "uya", "uz", "uzn", "uzs", "vaa", "vae", "vaf", "vag", "vah", "vai", "vaj", "val", "vam", "van", "vao", "vap", "var", "vas", "vau", "vav", "vay", "vbb", "vbk", "ve", "vec", "ved", "vel", "vem", "veo", "vep", "ver", "vgr", "vgt", "vi", "vic", "vid", "vif", "vig", "vil", "vin", "vis", "vit", "viv", "vjk", "vka", "vkj", "vkk", "vkl", "vkm", "vkn", "vko", "vkp", "vkt", "vku", "vkz", "vlp", "vls", "vma", "vmb", "vmc", "vmd", "vme", "vmf", "vmg", "vmh", "vmi", "vmj", "vmk", "vml", "vmm", "vmp", "vmq", "vmr", "vms", "vmu", "vmv", "vmw", "vmx", "vmy", "vmz", "vnk", "vnm", "vnp", "vo", "vor", "vot", "vra", "vro", "vrs", "vrt", "vsi", "vsl", "vsn", "vsv", "vto", "vum", "vun", "vut", "vwa", "wa", "waa", "wab", "wac", "wad", "wae", "waf", "wag", "wah", "wai", "waj", "wak", "wal", "wam", "wan", "wao", "wap", "waq", "war", "was", "wat", "wau", "wav", "waw", "wax", "way", "waz", "wba", "wbb", "wbe", "wbf", "wbh", "wbi", "wbj", "wbk", "wbl", "wbm", "wbp", "wbq", "wbr", "wbs", "wbt", "wbv", "wbw", "wca", "wci", "wdd", "wdg", "wdj", "wdk", "wdt", "wdu", "wdy", "wea", "wec", "wed", "weg", "weh", "wei", "wem", "wen", "weo", "wep", "wer", "wes", "wet", "weu", "wew", "wfg", "wga", "wgb", "wgg", "wgi", "wgo", "wgu", "wgy", "wha", "whg", "whk", "whu", "wib", "wic", "wie", "wif", "wig", "wih", "wii", "wij", "wik", "wil", "wim", "win", "wir", "wiu", "wiv", "wiy", "wja", "wji", "wka", "wkb", "wkd", "wkl", "wkr", "wku", "wkw", "wky", "wla", "wlc", "wle", "wlg", "wlh", "wli", "wlk", "wll", "wlm", "wlo", "wlr", "wls", "wlu", "wlv", "wlw", "wlx", "wly", "wma", "wmb", "wmc", "wmd", "wme", "wmg", "wmh", "wmi", "wmm", "wmn", "wmo", "wms", "wmt", "wmw", "wmx", "wnb", "wnc", "wnd", "wne", "wng", "wni", "wnk", "wnm", "wnn", "wno", "wnp", "wnu", "wnw", "wny", "wo", "woa", "wob", "woc", "wod", "woe", "wof", "wog", "woi", "wok", "wom", "won", "woo", "wor", "wos", "wow", "woy", "wpc", "wrb", "wrg", "wrh", "wri", "wrk", "wrl", "wrm", "wrn", "wro", "wrp", "wrr", "wrs", "wru", "wrv", "wrw", "wrx", "wry", "wrz", "wsa", "wsg", "wsi", "wsk", "wsr", "wss", "wsu", "wsv", "wtb", "wtf", "wth", "wti", "wtk", "wtm", "wtw", "wua", "wub", "wud", "wuh", "wul", "wum", "wun", "wur", "wut", "wuu", "wuv", "wux", "wuy", "wwa", "wwb", "wwo", "wwr", "www", "wxa", "wxw", "wyb", "wyi", "wym", "wyn", "wyr", "wyy", "xaa", "xab", "xac", "xad", "xae", "xag", "xai", "xaj", "xak", "xal", "xam", "xan", "xao", "xap", "xaq", "xar", "xas", "xat", "xau", "xav", "xaw", "xay", "xbb", "xbc", "xbd", "xbe", "xbg", "xbi", "xbj", "xbm", "xbn", "xbo", "xbp", "xbr", "xbw", "xby", "xcb", "xcc", "xce", "xcg", "xch", "xcl", "xcm", "xcn", "xco", "xcr", "xct", "xcu", "xcv", "xcw", "xcy", "xda", "xdc", "xdk", "xdm", "xdo", "xdq", "xdy", "xeb", "xed", "xeg", "xel", "xem", "xep", "xer", "xes", "xet", "xeu", "xfa", "xga", "xgb", "xgd", "xgf", "xgg", "xgi", "xgl", "xgm", "xgn", "xgr", "xgu", "xgw", "xh", "xha", "xhc", "xhd", "xhe", "xhm", "xhr", "xht", "xhu", "xhv", "xib", "xii", "xil", "xin", "xir", "xis", "xiv", "xiy", "xjb", "xjt", "xka", "xkb", "xkc", "xkd", "xke", "xkf", "xkg", "xki", "xkj", "xkk", "xkl", "xkn", "xko", "xkp", "xkq", "xkr", "xks", "xkt", "xku", "xkv", "xkw", "xkx", "xky", "xkz", "xla", "xlb", "xlc", "xld", "xle", "xlg", "xli", "xln", "xlo", "xlp", "xls", "xlu", "xly", "xma", "xmb", "xmc", "xmd", "xme", "xmf", "xmg", "xmh", "xmj", "xmk", "xml", "xmm", "xmn", "xmo", "xmp", "xmq", "xmr", "xms", "xmt", "xmu", "xmv", "xmw", "xmx", "xmy", "xmz", "xna", "xnb", "xnd", "xng", "xnh", "xni", "xnj", "xnk", "xnm", "xnn", "xno", "xnq", "xnr", "xns", "xnt", "xnu", "xny", "xnz", "xoc", "xod", "xog", "xoi", "xok", "xom", "xon", "xoo", "xop", "xor", "xow", "xpa", "xpb", "xpc", "xpd", "xpe", "xpf", "xpg", "xph", "xpi", "xpj", "xpk", "xpl", "xpm", "xpn", "xpo", "xpp", "xpq", "xpr", "xps", "xpt", "xpu", "xpv", "xpw", "xpx", "xpy", "xpz", "xqa", "xqt", "xra", "xrb", "xrd", "xre", "xrg", "xri", "xrm", "xrn", "xrr", "xrt", "xru", "xrw", "xsa", "xsb", "xsc", "xsd", "xse", "xsh", "xsi", "xsj", "xsl", "xsm", "xsn", "xso", "xsp", "xsq", "xsr", "xsu", "xsv", "xsy", "xta", "xtb", "xtc", "xtd", "xte", "xtg", "xth", "xti", "xtj", "xtl", "xtm", "xtn", "xto", "xtp", "xtq", "xtr", "xts", "xtt", "xtu", "xtv", "xtw", "xty", "xua", "xub", "xud", "xug", "xuj", "xul", "xum", "xun", "xuo", "xup", "xur", "xut", "xuu", "xve", "xvi", "xvn", "xvo", "xvs", "xwa", "xwc", "xwd", "xwe", "xwg", "xwj", "xwk", "xwl", "xwo", "xwr", "xwt", "xww", "xxb", "xxk", "xxm", "xxr", "xxt", "xya", "xyb", "xyj", "xyk", "xyl", "xyt", "xyy", "xzh", "xzm", "xzp", "yaa", "yab", "yac", "yad", "yae", "yaf", "yag", "yah", "yai", "yaj", "yak", "yal", "yam", "yan", "yao", "yap", "yaq", "yar", "yas", "yat", "yau", "yav", "yaw", "yax", "yay", "yaz", "yba", "ybb", "ybe", "ybh", "ybi", "ybj", "ybk", "ybl", "ybm", "ybn", "ybo", "ybx", "yby", "ych", "ycl", "ycn", "ycp", "ycr", "yda", "ydd", "yde", "ydg", "ydk", "yea", "yec", "yee", "yei", "yej", "yel", "yer", "yes", "yet", "yeu", "yev", "yey", "yga", "ygi", "ygl", "ygm", "ygp", "ygr", "ygs", "ygu", "ygw", "yha", "yhd", "yhl", "yhs", "yi", "yia", "yif", "yig", "yih", "yii", "yij", "yik", "yil", "yim", "yin", "yip", "yiq", "yir", "yis", "yit", "yiu", "yiv", "yix", "yiz", "yka", "ykg", "ykh", "yki", "ykk", "ykl", "ykm", "ykn", "yko", "ykr", "ykt", "yku", "yky", "yla", "ylb", "yle", "ylg", "yli", "yll", "ylm", "yln", "ylo", "ylr", "ylu", "yly", "ymb", "ymc", "ymd", "yme", "ymg", "ymh", "ymi", "ymk", "yml", "ymm", "ymn", "ymo", "ymp", "ymq", "ymr", "yms", "ymx", "ymz", "yna", "ynb", "ynd", "yne", "yng", "ynk", "ynl", "ynn", "yno", "ynq", "yns", "ynu", "yo", "yob", "yog", "yoi", "yok", "yom", "yon", "yot", "yox", "yoy", "ypa", "ypb", "ypg", "yph", "ypk", "ypm", "ypn", "ypo", "ypp", "ypz", "yra", "yrb", "yre", "yrk", "yrl", "yrm", "yrn", "yro", "yrs", "yrw", "yry", "ysc", "ysd", "ysg", "ysl", "ysm", "ysn", "yso", "ysp", "ysr", "yss", "ysy", "yta", "ytl", "ytp", "ytw", "yty", "yua", "yub", "yuc", "yud", "yue", "yuf", "yug", "yui", "yuj", "yuk", "yul", "yum", "yun", "yup", "yuq", "yur", "yut", "yuw", "yux", "yuy", "yuz", "yva", "yvt", "ywa", "ywg", "ywl", "ywn", "ywq", "ywr", "ywt", "ywu", "yww", "yxa", "yxg", "yxl", "yxm", "yxu", "yxy", "yyr", "yyu", "yyz", "yzg", "yzk", "za", "zaa", "zab", "zac", "zad", "zae", "zaf", "zag", "zah", "zai", "zaj", "zak", "zal", "zam", "zao", "zap", "zaq", "zar", "zas", "zat", "zau", "zav", "zaw", "zax", "zay", "zaz", "zba", "zbc", "zbe", "zbl", "zbt", "zbu", "zbw", "zca", "zcd", "zch", "zdj", "zea", "zeg", "zeh", "zem", "zen", "zga", "zgb", "zgh", "zgm", "zgn", "zgr", "zh", "zhb", "zhd", "zhi", "zhk", "zhn", "zhw", "zhx", "zia", "zib", "zik", "zil", "zim", "zin", "ziw", "ziz", "zka", "zkd", "zkg", "zkh", "zkk", "zkn", "zko", "zkp", "zkr", "zkt", "zku", "zkv", "zkz", "zla", "zle", "zlj", "zlm", "zln", "zlq", "zls", "zlu", "zlw", "zma", "zmb", "zmc", "zmd", "zme", "zmf", "zmg", "zmh", "zmi", "zmj", "zmk", "zml", "zmm", "zmn", "zmo", "zmp", "zmq", "zmr", "zms", "zmt", "zmu", "zmv", "zmw", "zmx", "zmy", "zmz", "zna", "znd", "zne", "zng", "znk", "zns", "zoc", "zoh", "zom", "zoo", "zoq", "zor", "zos", "zpa", "zpb", "zpc", "zpd", "zpe", "zpf", "zpg", "zph", "zpi", "zpj", "zpk", "zpl", "zpm", "zpn", "zpo", "zpp", "zpq", "zpr", "zps", "zpt", "zpu", "zpv", "zpw", "zpx", "zpy", "zpz", "zqe", "zra", "zrg", "zrn", "zro", "zrp", "zrs", "zsa", "zsk", "zsl", "zsm", "zsr", "zsu", "zte", "ztg", "ztl", "ztm", "ztn", "ztp", "ztq", "zts", "ztt", "ztu", "ztx", "zty", "zu", "zuh", "zum", "zun", "zuy", "zwa", "zxx", "zyb", "zyg", "zyj", "zyn", "zyp", "zza", "zzj"},
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
		Error:     "Please check the ID: 20 capital letters and digits, like 5493001KJTIIGC8Y1R12.",
		Details:   "A Legal Entity Identifier: organizations in financial and regulatory contexts. Identity, not routing - prefer bic for payment routing.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"legal_entity_identifier"},
		Valid:     []any{"5493001KJTIIGC8Y1R12", "529900T8BM49AURSDO55"},
		Invalid:   []any{"5493001KJTIIGC8Y1R1", "5493001kjtiigc8y1r12"},
		Check:     "iso7064_mod97_10",
	},
	steps:   []step{},
	pattern: `^[A-Z0-9]{18}[0-9]{2}$`,
	minLen:  20,
	maxLen:  20,
	rule:    checkIso7064Mod9710,
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
		Error:     "Please check the iD: four groups of 4 with dashes, like 0000-0002-1825-0097.",
		Details:   "An ORCID iD identifying a researcher. Prefer lei for organizations and wikidata_qid for entities outside scholarly identity.",
		Level:     "domain",
		Primitive: "string",
		Aliases:   []string{"orcid_id"},
		Valid:     []any{"0000-0002-1825-0097", "0000-0002-9079-593X"},
		Invalid:   []any{"0000-0002-1825-009", "0000000218250097"},
		Check:     "iso7064_mod11_2",
	},
	steps:   []step{},
	pattern: `^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$`,
	minLen:  19,
	maxLen:  19,
	rule:    checkIso7064Mod112,
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
		Params:    []string{"precision", "scale"},
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
		Params:    []string{"length"},
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
		Params:    []string{"fractional_seconds"},
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
		Params:    []string{"fractional_seconds"},
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
		Error:     "Please use only digits, up to 18446744073709551615.",
		Details:   "The full unsigned 64-bit range: hashes and foreign systems' identifiers. Most languages and JSON cannot represent the upper half natively, so values travel as strings; prefer int64 unless the source really uses all 64 bits.",
		Level:     "advanced",
		Primitive: "int64",
		Aliases:   []string{"ulong"},
		Params:    []string{"precision", "scale"},
		Valid:     []any{"18446744073709551615", "0"},
		Invalid:   []any{"-1", "1.5"},
		Check:     "uint64_range",
	},
	steps:   []step{},
	pattern: `^[0-9]+$`,
	minLen:  1,
	maxLen:  noMax,
	rule:    checkUint64Range,
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
		Invalid:   []any{9007199254740992.0, 1.5},
	},
	minimum: -9007199254740991,
	maximum: 9007199254740991,
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
	&scalarGln.Meta,
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
	case "gln":
		return Gln
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
