package main

import (
	"errors"
	"sync"
	"testing"

	"scalars"
)

// Slug's lowercase step maps non-ASCII text through pooled casers, which must not be shared between goroutines.
// Run with -race.
func TestConcurrentCaseMapping(t *testing.T) {
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 1000; i++ {
				// Validate lowercases before the pattern, which then refuses the accents.
				if _, err := scalars.Slug.Validate("Ünïcödé-Slug"); err == nil {
					t.Error("Slug.Validate accepted accents")
					return
				}
				if got := scalars.Slug.Normalize("Ünïcödé-Slug"); got != "ünïcödé-slug" {
					t.Errorf("Slug.Normalize = %q", got)
					return
				}
			}
		}()
	}
	wg.Wait()
}

// One loaded *Model is shared by every goroutine: Validate and IsValid must keep no state between calls.
// Run with -race.
func TestConcurrentModels(t *testing.T) {
	set, err := scalars.Models(map[string]any{
		"billing": map[string]any{
			"address": map[string]any{"$value": true, "street": map[string]any{"type": "string", "length": 20.0}, "country": "country"},
			"invoice": map[string]any{
				"to":     "address",
				"status": map[string]any{"type": "enum", "values": []any{"draft", "sent"}},
				"total":  map[string]any{"type": "decimal", "precision": 5.0, "scale": 2.0},
				"lines":  map[string]any{"type": "array", "items": "int32"},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	m, ok := set.Get("billing:invoice")
	if !ok {
		t.Fatal("no billing:invoice")
	}
	good := map[string]any{"to": map[string]any{"street": " a ", "country": "us"}, "status": "draft", "total": "1.5", "lines": []any{1.0, 2.0}}
	bad := map[string]any{"to": map[string]any{"street": "a", "zz": 1.0}, "status": "void", "total": "1234.5", "lines": []any{"x"}}
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 500; i++ {
				out, err := m.Validate(good)
				if err != nil || out["to"].(map[string]any)["country"] != "US" || !m.IsValid(good) {
					t.Errorf("good payload: %v %v", out, err)
					return
				}
				var e *scalars.ModelError
				if _, err := m.Validate(bad); !errors.As(err, &e) || len(e.Problems) != 5 || m.IsValid(bad) {
					t.Errorf("bad payload: %v", err)
					return
				}
			}
		}()
	}
	wg.Wait()
}
