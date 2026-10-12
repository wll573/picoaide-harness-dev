package main

import "testing"

func TestResolvePgDSNPrefersFlag(t *testing.T) {
	t.Setenv("PICOAI_PG_DSN", "postgres://env/db")
	got := resolvePgDSN("postgres://flag/db")
	if got != "postgres://flag/db" {
		t.Fatalf("got %q", got)
	}
}

func TestResolvePgDSNFallsBackToEnv(t *testing.T) {
	t.Setenv("PICOAI_PG_DSN", "postgres://env/db")
	got := resolvePgDSN("")
	if got != "postgres://env/db" {
		t.Fatalf("got %q", got)
	}
}

func TestResolvePgDSNEmpty(t *testing.T) {
	t.Setenv("PICOAI_PG_DSN", "")
	got := resolvePgDSN("  ")
	if got != "" {
		t.Fatalf("got %q", got)
	}
}
