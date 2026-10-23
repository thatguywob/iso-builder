# Contributing to TunaOS ISO Builder

Thank you for your interest in the **TunaOS ISO Builder**! This document gives guidelines and instructions to send contributions to this repository.

---

<!-- hive-contribute-plea: donated-compute appeal, keep in sync across repos -->
## Contribute compute — no code needed

**[Donate time with your AI CLI](https://hub.tunaos.org/#contribute).**

Your machine runs one task at a time using your signed-in AI coding CLI.
The relay alternates between eligible **School** (OS) and **Reef** (apps)
hives after each task. If one hive has no work, the other can continue.

The guide covers prerequisites, verified `just` setup, credentials, provider
costs, and how to stop with Ctrl+C. Your subscription quota or API charges apply.
Never post account credentials or API keys in issues or pull requests.

## Development Setup & Verification

Before you open a pull request, test your changes locally in each affected component.

### 1. Web Application (`app/public`)
- Put `tbox.wasm` and `wasm_exec.js` in place, as [README.md](README.md#develop) describes.
- Serve locally:
  ```sh
  cd app/public && python3 -m http.server 8080
  ```

### 2. End-to-End Tests (`e2e/`)
- Run Playwright test suite to verify UI and WASM functionality:
  ```sh
  cd e2e
  npm ci
  npx playwright install --with-deps chromium
  npx playwright test --grep-invert @full
  ```

### 3. Native Application (`native/`)
- Run tests (see [`native/README.md`](native/README.md) for platform build prerequisites):
  ```sh
  cd native
  go vet ./...
  go test ./...
  ```
- `native/` also carries a [`.golangci.yml`](.golangci.yml) (schema `version: "2"`, so it needs
  golangci-lint v2, e.g. `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest`).
  CI does not run this yet, so lint it yourself before you open a PR. The
  `formatters` section of the config also runs `gofmt`/`goimports`:
  ```sh
  cd native
  golangci-lint run
  ```

### 4. Qualification contract tests (`tests/`)
- Install the Python test dependencies:
  ```sh
  python3 -m pip install pytest PyYAML
  ```
- From the repository root, run the fixture and workflow-contract suite:
  ```sh
  python3 -m pytest -q tests
  ```
  These tests do not build or install a real ISO.

### 5. Relay Worker (`worker/`)
- The relay unit tests use Node.js's built-in `node:test` runner. With Node.js
  installed, run:
  ```sh
  cd worker
  npm test
  ```

---

## Submitting Pull Requests

1. **Branch Naming & DCO**: Create a feature or bugfix branch. Sign all commits with Developer Certificate of Origin (`git commit -s`).
2. **Pull Requests**: Open a pull request against the `main` branch. Provide a clear description of the changes and link any related issues.
3. **CI Pipeline**: All PRs must pass the automated checks — `native-linux`/`native-windows`/`native-macos`
   (`go vet` + `go test`) and the `e2e` inspect-tier suite. The repository has a golangci-lint config, but CI
   does not run it yet. Run it locally, as the native step above shows.
