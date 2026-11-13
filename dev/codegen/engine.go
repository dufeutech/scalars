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
	gated, formed := false, false
	for _, st := range t.steps {
		// Once trimming is done, before any other step: trim cannot make invalid bytes valid, but removing a
		// space or hyphen between two stray bytes could.
		if !formed && st != stepTrim {
			formed = true
			if !t.wellFormed(s) {
				return "", false
			}
		}
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
	if !formed && !t.wellFormed(s) {
		return "", false
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

// wellFormed reports whether trimmed text is not already too long (settled by the byte length alone, unless a
// later step can shorten it) and is well-formed UTF-8: Unicode scalar values only (WHATWG USVString, RFC 7493).
// utf8.ValidString skips ASCII eight bytes at a time and allocates nothing.
func (t *TextScalar) wellFormed(s string) bool {
	if len(s)/utf8.UTFMax > t.maxLen && !t.shortens() {
		return false
	}
	return utf8.ValidString(s)
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
