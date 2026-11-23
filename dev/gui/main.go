package main

import (
	"log"
	"net/http"
)

// Run from dev/gui/: go run .
func main() {
	http.Handle("/", http.FileServer(http.Dir(".")))
	http.HandleFunc("/scalars.json", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "../../dist/scalars.json")
	})

	log.Println("Server running at http://localhost:8080")

	if err := http.ListenAndServe(":8080", nil); err != nil {
		log.Fatal(err)
	}
}
