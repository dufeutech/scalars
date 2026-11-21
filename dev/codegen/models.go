// Models: a file of domains, models and fields (parsed JSON), loaded once, then payloads checked against a model.
// A port of dev/lib/models.mjs, the reference every engine copies. go.mjs appends this file after engine.go and
// merges this import block into the engine's. Load is O(file) and iterative: no recursion is driven by the input.
// Validate recurses, but load bounds a payload's depth at maxDepth levels. Go maps have no order, so every list a
// caller sees (Problems, All) is sorted.
package scalars

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"sync"
)

// maxDepth is how deep models may nest, each model and each `items` one level; deeper is refused at load.
const maxDepth = 64

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

// locate builds a problem at segments. A code without a template (invalid, whose text is the type's Error)
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

// check runs the typed scalar t on a JSON value: the cleaned value, or false when v is the wrong kind or breaks
// the type's rule.
func check(t any, v any) (any, bool) {
	switch t := t.(type) {
	case *TextScalar:
		if s, ok := v.(string); ok {
			return t.check(s)
		}
	case *IntScalar:
		if n, ok := modelInt(v); ok && t.IsValid(n) {
			return n, true
		}
	case *NumberScalar:
		if f, ok := v.(float64); ok && t.IsValid(f) {
			return f, true
		}
	case *BoolScalar:
		if b, ok := v.(bool); ok {
			return b, true
		}
	case *ShapeScalar[map[string]any]:
		if m, ok := v.(map[string]any); ok {
			return m, true
		}
	case *ShapeScalar[[]any]:
		if a, ok := v.([]any); ok {
			return a, true
		}
	case *ShapeScalar[any]:
		return v, true
	default:
		panic(fmt.Sprintf("scalars: no models check for scalar type %T", t))
	}
	return nil, false
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
		// Entries must be strings, unique, and already clean: the type's own check returns each unchanged. The
		// list is copied, so the loaded models never alias the caller's data.
		out := make([]string, 0, len(list))
		seen := make(map[string]struct{}, len(list))
		for i, entry := range list {
			s, isText := entry.(string)
			if isText {
				clean, valid := check(t.scalar, s)
				_, dup := seen[s]
				isText = valid && clean == s && !dup
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
		r, ok := check(t.scalar, v)
		if !ok {
			w.report(at, "invalid", map[string]any{"type": t.meta.Name}, t.meta.Error)
			return nil
		}
		if f.limited {
			s, _ := r.(string)
			if f.length > 0 && longerThan(s, int(f.length)) {
				w.report(at, "too_long", map[string]any{"max": f.length}, "")
			}
			if _, in := f.allowed[s]; f.values != nil && !in {
				w.report(at, "not_allowed", map[string]any{"values": slices.Clone(f.values)}, "")
			}
			if f.precision > 0 && !fitsNumeric(s, f.precision, f.scale) {
				w.report(at, "too_many_digits", map[string]any{"precision": f.precision, "scale": f.scale}, "")
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
