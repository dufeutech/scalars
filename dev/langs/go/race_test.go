package main

import (
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
