.PHONY: all frontend build run dev clean

# Build everything: frontend then Go binary
all: frontend build

# Install and build the React + Tailwind frontend
frontend:
	cd frontend && npm install && npm run build

# Build the Go binary (requires dist/ to exist)
build:
	go build -ldflags="-s -w" -o app .

# Run the compiled binary
run: all
	./app

# Dev mode: run Go server + Vite dev server concurrently
# Requires: go install github.com/air-verse/air@latest (optional live reload)
dev:
	@echo "Start Go server:   go run ."
	@echo "Start Vite:        cd frontend && npm run dev"
	@echo "---"
	@echo "Running both with & ..."
	go run . & cd frontend && npm run dev

# Cross-compile for common targets
build-linux:
	GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o app-linux .

build-darwin:
	GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o app-darwin-arm64 .

build-windows:
	GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o app.exe .

# Build for all platforms
release: frontend build-linux build-darwin build-windows

clean:
	rm -rf dist app app-linux app-darwin-arm64 app.exe
