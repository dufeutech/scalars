// Reads dist/scalars.json the way a Go tool would and checks every example plus cases.json.
// Run: go run . <dist/scalars.json> <cases.json>
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"unicode/utf8"

	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

type Type struct {
	Name      string   `json:"name"`
	Aliases   []string `json:"aliases"`
	Normalize []string `json:"normalize"`
	Schema    struct {
		Type      string `json:"type"`
		Pattern   string `json:"pattern"`
		MinLength *int   `json:"minLength"`
		MaxLength *int   `json:"maxLength"`
	} `json:"schema"`
	Examples struct {
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
}

// The trim step's set (Unicode White_Space), written out.
const ws = "\u0009\u000a\u000b\u000c\u000d \u0085                 　"

var steps = map[string]func(string) string{
	"trim":           func(s string) string { return strings.Trim(s, ws) },
	// Not strings.ToLower/ToUpper: they map one rune at a time, so "İ" -> "i" and "ß" stays "ß".
	"lowercase":      func(s string) string { return cases.Lower(language.Und).String(s) },
	"uppercase":      func(s string) string { return cases.Upper(language.Und).String(s) },
	"remove_spaces":  func(s string) string { return strings.ReplaceAll(s, " ", "") },
	"remove_hyphens": func(s string) string { return strings.ReplaceAll(s, "-", "") },
}

func normalize(names []string, s string) string {
	for _, n := range names {
		s = steps[n](s)
	}
	return s
}

var runs = regexp.MustCompile(`[ -]+`)

func lookup(types map[string]Type, word string) string {
	key := runs.ReplaceAllString(steps["lowercase"](steps["trim"](word)), "_")
	if _, ok := types[key]; ok {
		return key
	}
	for name, t := range types {
		for _, a := range t.Aliases {
			if a == key {
				return name
			}
		}
	}
	return ""
}

var regexes = map[string]*regexp.Regexp{}

func matches(t Type, s string) bool {
	n := utf8.RuneCountInString(s) // code points
	if t.Schema.MinLength != nil && n < *t.Schema.MinLength || t.Schema.MaxLength != nil && n > *t.Schema.MaxLength {
		return false
	}
	if t.Schema.Pattern == "" {
		return true
	}
	if regexes[t.Name] == nil {
		regexes[t.Name] = regexp.MustCompile(t.Schema.Pattern)
	}
	return regexes[t.Name].MatchString(s)
}

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

func main() {
	var dist struct{ Types map[string]Type }
	var cases Cases
	load(os.Args[1], &dist)
	load(os.Args[2], &cases)
	types := dist.Types

	var fails []string
	for _, t := range types {
		if t.Schema.Type != "string" {
			continue
		}
		for _, v := range t.Examples.Valid {
			if s, ok := v.(string); ok && !matches(t, s) {
				fails = append(fails, fmt.Sprintf("%s rejects valid %q", t.Name, s))
			}
		}
		for _, v := range t.Examples.Invalid {
			if s, ok := v.(string); ok && matches(t, s) {
				fails = append(fails, fmt.Sprintf("%s accepts invalid %q", t.Name, s))
			}
		}
	}
	for _, c := range cases.Normalize {
		if got := normalize(c.Steps, c.In); got != c.Out {
			fails = append(fails, fmt.Sprintf("normalize %q %v = %q, want %q", c.In, c.Steps, got, c.Out))
		}
	}
	for _, c := range cases.Lookup {
		want := ""
		if c.Out != nil {
			want = *c.Out
		}
		if got := lookup(types, c.In); got != want {
			fails = append(fails, fmt.Sprintf("lookup %q = %q, want %q", c.In, got, want))
		}
	}
	for _, c := range cases.Match {
		if matches(types[c.Type], c.In) != c.Ok {
			fails = append(fails, fmt.Sprintf("%s on %q: want %v", c.Type, c.In, c.Ok))
		}
	}

	if len(fails) > 0 {
		fmt.Println(strings.Join(fails, "\n"))
		os.Exit(1)
	}
	fmt.Printf("go: ok, %d types\n", len(types))
}
