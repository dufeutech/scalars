// Uses the generated dist/go package and checks every example plus cases.json.
// Run: go run . <dist/scalars.json> <cases.json>
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"reflect"
	"sort"
	"strings"
	"time"
	"unsafe"

	"scalars"
)

type Type struct {
	Label     string   `json:"label"`
	Hint      string   `json:"hint"`
	Error     string   `json:"error"`
	Details   string   `json:"details"`
	Level     string   `json:"level"`
	Primitive string   `json:"primitive"`
	Aliases   []string `json:"aliases"`
	Normalize []string `json:"normalize"`
	Examples  struct {
		Valid   []any `json:"valid"`
		Invalid []any `json:"invalid"`
	} `json:"examples"`
}

type Cases struct {
	Normalize []struct {
		Steps   []string `json:"steps"`
		In, Out string
	} `json:"normalize"`
	Lookup []struct {
		In  string  `json:"in"`
		Out *string `json:"out"`
	} `json:"lookup"`
	Match []struct {
		Type, In string
		Ok       bool
	} `json:"match"`
	Validate []struct {
		Type    string `json:"type"`
		In      any    `json:"in"`
		Out     *any   `json:"out"` // nil when the case gives no output
		Ok      bool   `json:"ok"`
		Special string `json:"special"`
		Dynamic bool   `json:"dynamic"`
	} `json:"validate"`
	Hostile []struct {
		Type, Prefix, Repeat, Suffix string
		Count                        int
		Ok                           bool
	} `json:"hostile"`
}

var fails []string

func fail(format string, args ...any) { fails = append(fails, fmt.Sprintf(format, args...)) }

func load(path string, v any) {
	b, err := os.ReadFile(path)
	if err == nil {
		err = json.Unmarshal(b, v)
	}
	if err != nil {
		fmt.Println(err)
		os.Exit(2)
	}
}

// asInt is a JSON number as an int64, when it is integral and fits; other values are not integers in Go.
func asInt(v any) (int64, bool) {
	f, ok := v.(float64)
	if !ok || f != math.Trunc(f) || f < -(1<<63) || f >= 1<<63 {
		return 0, false
	}
	return int64(f), true
}

// result is what validating v with t gave. checked is false when Go's types cannot express v for t
// (the compiler rejects it, so there is nothing to run).
type result struct {
	checked, ok, isValid bool
	out                  any
	err                  error
}

func run(t any, v any) (r result) {
	r.checked = true
	switch t := t.(type) {
	case *scalars.TextScalar:
		s, ok := v.(string)
		if !ok {
			return result{}
		}
		r.out, r.err = t.Validate(s)
		r.isValid = t.IsValid(s)
	case *scalars.IntScalar:
		n, ok := asInt(v)
		if !ok {
			return result{}
		}
		r.out, r.err = t.Validate(n)
		r.isValid = t.IsValid(n)
	case *scalars.NumberScalar:
		f, ok := v.(float64)
		if !ok {
			return result{}
		}
		r.out, r.err = t.Validate(f)
		r.isValid = t.IsValid(f)
	case *scalars.BoolScalar:
		b, ok := v.(bool)
		if !ok {
			return result{}
		}
		r.out, r.err = t.Validate(b)
		r.isValid = t.IsValid(b)
	case *scalars.ShapeScalar[map[string]any]:
		m, ok := v.(map[string]any)
		if !ok {
			return result{}
		}
		r.out, r.err = t.Validate(m)
		r.isValid = t.IsValid(m)
	case *scalars.ShapeScalar[[]any]:
		a, ok := v.([]any)
		if !ok {
			return result{}
		}
		r.out, r.err = t.Validate(a)
		r.isValid = t.IsValid(a)
	case *scalars.ShapeScalar[any]:
		r.out, r.err = t.Validate(v)
		r.isValid = t.IsValid(v)
	default:
		fail("Lookup gave an unknown scalar type %T", t)
		return result{}
	}
	r.ok = r.err == nil
	if r.ok != r.isValid {
		fail("%T on %#v: Validate and IsValid disagree", t, v)
	}
	return r
}

// meta is the Meta embedded in a typed scalar.
func meta(t any) *scalars.Meta {
	v := reflect.ValueOf(t)
	if v.Kind() != reflect.Pointer || v.IsNil() {
		return nil
	}
	f := v.Elem().FieldByName("Meta")
	if !f.IsValid() {
		return nil
	}
	return f.Addr().Interface().(*scalars.Meta)
}

// hasObject reports whether v is or holds a JSON object.
func hasObject(v any) bool {
	switch v := v.(type) {
	case map[string]any:
		return true
	case []any:
		for _, x := range v {
			if hasObject(x) {
				return true
			}
		}
	}
	return false
}

// scalarExamples drops examples holding a JSON object: a map literal is built at run time, so the generated
// table leaves them out.
func scalarExamples(list []any) []any {
	out := []any{}
	for _, v := range list {
		if !hasObject(v) {
			out = append(out, v)
		}
	}
	return out
}

// stepsOf reads a text scalar's unexported step list: the runner learns each step's code from the catalogue.
func stepsOf(t *scalars.TextScalar) reflect.Value {
	f := reflect.ValueOf(t).Elem().FieldByName("steps")
	return reflect.NewAt(f.Type(), unsafe.Pointer(f.UnsafeAddr())).Elem()
}

// probe is a text scalar with the given steps and no rule, to check normalize on its own.
func probe(codes map[string]uint64, names []string) *scalars.TextScalar {
	t := &scalars.TextScalar{}
	steps := stepsOf(t)
	list := reflect.MakeSlice(steps.Type(), len(names), len(names))
	for i, n := range names {
		code, ok := codes[n]
		if !ok {
			fail("no type uses step %q, so its code is unknown", n)
		}
		list.Index(i).SetUint(code)
	}
	steps.Set(list)
	return t
}

func main() {
	var dist struct{ Types map[string]Type }
	var cases Cases
	load(os.Args[1], &dist)
	load(os.Args[2], &cases)
	types := dist.Types
	names := make([]string, 0, len(types))
	for name := range types {
		names = append(names, name)
	}
	sort.Strings(names)

	if len(scalars.All) != len(types) {
		fail("All has %d types, dist has %d", len(scalars.All), len(types))
	}
	codes := map[string]uint64{}
	for i, name := range names {
		spec := types[name]
		t := scalars.Lookup(name)
		m := meta(t)
		if m == nil {
			fail("Lookup(%q) gave %T", name, t)
			continue
		}
		if i < len(scalars.All) && scalars.All[i] != m {
			fail("All[%d] is not %s: All is not in catalogue order", i, name)
		}
		if got, ok := scalars.Get(name); !ok || got != m {
			fail("Get(%q) is not Lookup(%q)", name, name)
		}
		if [7]string{m.Name, m.Label, m.Hint, m.Error, m.Details, m.Level, m.Primitive} !=
			[7]string{name, spec.Label, spec.Hint, spec.Error, spec.Details, spec.Level, spec.Primitive} ||
			strings.Join(m.Aliases, "\x00") != strings.Join(spec.Aliases, "\x00") {
			fail("%s metadata differs from dist", name)
		}
		if !reflect.DeepEqual(m.Valid, scalarExamples(spec.Examples.Valid)) ||
			!reflect.DeepEqual(m.Invalid, scalarExamples(spec.Examples.Invalid)) {
			fail("%s examples differ from dist: %#v %#v", name, m.Valid, m.Invalid)
		}
		if text, ok := t.(*scalars.TextScalar); ok {
			// Nothing may be compiled at load.
			if !reflect.ValueOf(text).Elem().FieldByName("re").IsNil() {
				fail("%s compiled its regex at load", name)
			}
			steps := stepsOf(text)
			if steps.Len() != len(spec.Normalize) {
				fail("%s has %d steps, dist has %d", name, steps.Len(), len(spec.Normalize))
			} else {
				for j, n := range spec.Normalize {
					code := steps.Index(j).Uint()
					if old, seen := codes[n]; seen && old != code {
						fail("step %q has two codes", n)
					}
					codes[n] = code
				}
			}
		}
		for _, v := range spec.Examples.Valid {
			if r := run(t, v); r.checked && !r.ok {
				fail("%s rejects valid %#v", name, v)
			}
		}
		for _, v := range spec.Examples.Invalid {
			// Normalizing may repair an invalid example ("usa" -> "USA"), so only those may pass.
			r := run(t, v)
			if s, isText := v.(string); r.checked && r.ok && !(isText && t.(*scalars.TextScalar).Normalize(s) != s) {
				fail("%s accepts invalid %#v", name, v)
			}
		}
		for _, alias := range spec.Aliases {
			if got, ok := scalars.Get(alias); !ok || got != m {
				fail("Get(%q) is not %s", alias, name)
			}
		}
	}
	if scalars.Lookup("nothing") != nil {
		fail(`Lookup("nothing") is not nil`)
	}

	for _, c := range cases.Normalize {
		if got := probe(codes, c.Steps).Normalize(c.In); got != c.Out {
			fail("normalize %q %v = %q, want %q", c.In, c.Steps, got, c.Out)
		}
	}

	for _, c := range cases.Lookup {
		want := ""
		if c.Out != nil {
			want = *c.Out
		}
		got := ""
		if m, ok := scalars.Get(c.In); ok {
			got = m.Name
		}
		if got != want {
			fail("lookup %q = %q, want %q", c.In, got, want)
		}
	}

	for _, c := range cases.Match {
		if r := run(scalars.Lookup(c.Type), c.In); !r.checked || r.isValid != c.Ok {
			fail("%s on %q: want %v", c.Type, c.In, c.Ok)
		}
	}

	for _, c := range cases.Validate {
		if c.Dynamic {
			continue // Go's compiler rejects a value of the wrong kind
		}
		v := c.In
		switch c.Special {
		case "NaN":
			v = math.NaN()
		case "Infinity":
			v = math.Inf(1)
		}
		t := scalars.Lookup(c.Type)
		r := run(t, v)
		if !r.checked {
			continue // an integer case that is not an int64
		}
		if !r.ok {
			var e *scalars.ScalarError
			if c.Ok {
				fail("%s rejects %#v", c.Type, v)
			} else if !errors.As(r.err, &e) || e.Error() != types[c.Type].Error || e.Scalar != meta(t) {
				fail("%s error %v is not the type's error", c.Type, r.err)
			}
			continue
		}
		if !c.Ok {
			fail("%s accepts %#v", c.Type, v)
			continue
		}
		if c.Out == nil {
			continue
		}
		want := *c.Out
		if _, isInt := t.(*scalars.IntScalar); isInt {
			want, _ = asInt(want)
		}
		if !reflect.DeepEqual(r.out, want) {
			fail("%s on %#v = %#v, want %#v", c.Type, v, r.out, want)
		}
	}

	if out, err := scalars.Any.Validate([]any{1}); err != nil || !reflect.DeepEqual(out, []any{1}) {
		fail("Any.Validate([1]) did not return [1]")
	}
	if out, err := scalars.Float64.Validate(3); err != nil || out != 3 {
		fail("Float64.Validate(3) did not return 3")
	}
	if out, err := scalars.Object.Validate(map[string]any{}); err != nil || out == nil {
		fail("Object.Validate({}) did not return {}")
	}
	if out, err := scalars.Enum.Validate("x"); err != nil || out != "x" {
		fail(`Enum.Validate("x") did not return "x"`)
	}

	slowest, slowestType := 0.0, ""
	for _, c := range cases.Hostile {
		t, ok := scalars.Lookup(c.Type).(*scalars.TextScalar)
		if !ok {
			fail("hostile %s is not a text type", c.Type)
			continue
		}
		text := c.Prefix + strings.Repeat(c.Repeat, c.Count) + c.Suffix
		start := time.Now()
		got := t.IsValid(text)
		ms := float64(time.Since(start).Microseconds()) / 1000
		if ms > slowest {
			slowest, slowestType = ms, c.Type
		}
		if got != c.Ok {
			fail("hostile %s: want %v", c.Type, c.Ok)
		}
		if ms >= 2000 {
			fail("hostile %s took %.0f ms", c.Type, ms)
		}
	}

	if len(fails) > 0 {
		fmt.Println(strings.Join(fails, "\n"))
		os.Exit(1)
	}
	fmt.Printf("go: ok, %d types, slowest hostile %s %.1f ms\n", len(types), slowestType, slowest)
}
