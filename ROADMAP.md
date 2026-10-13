# iso-builder Roadmap

**Last updated**: 2026-10-12 | **Maintainer**: tuna-os (hanthor) / tacklebox team

---

## Mission

Build a bootable **live ISO from any bootable container image — entirely in the
browser**. No server, no upload: the same engine CI uses (tacklebox) is compiled
to WebAssembly and runs client-side at <https://iso.tunaos.org>. The intended
experience: pick a base + desktop, inspect layers instantly, click build, and
stream a custom bootable ISO to local storage.

---

## Current Status (October 2026)

- Live at iso.tunaos.org; tacklebox compiled to `GOOS=js GOARCH=wasm` (`tbox.wasm`).
- Playwright E2E suite drives the real WASM engine against live registries.
- Native cross-platform desktop writer app (`native/`) implements multi-boot drive management across Linux, macOS, and Windows.
- Browser streaming and OPFS quota management implemented (#47, #48, #49).
- Browser build readiness verification ongoing (#126, full-matrix pipeline).
- **Q4 refresh note (2026-10-12)**: P0 browser verification (#126) status unclear; code signing pipeline not yet started; native writer packaging in progress.

### Priorities

| Priority | Item | Tracking | Status |
|----------|------|----------|--------|
| P0 | Fix browser download stall near 64 MiB (blocks all large builds) | #49 | 🟢 Complete |
| P0 | Stream downloads to disk instead of buffering in JS heap | #47 | 🟢 Complete |
| P1 | OPFS quota strategy for large editions (8 GB+ ceiling) | #48 | 🟢 Complete |
| P1 | Native cross-platform writer app (Fyne wrapping tacklebox) — write recipes directly to USB | #1 | 🟢 Complete |
| P2 | Default UX: persistent extendable multi-boot drive, not one-shot burn | #3, #2, #4 | 🟢 Complete |
| P0 | Verify every catalog edition builds, installs with encryption, and reboots on current `main` | #126, full-matrix workflow | 🔴 Stalled — #126 status needs refresh (no recent updates since Sept) |

---

## Quarterly Goals

### Current Quarter (2026 Q4) — "Mature"

**Theme**: Establish validated browser channel compatibility and release signed/notarized native desktop writer distribution packages.

| Goal | Owner | Tracking | Status |
|------|-------|----------|--------|
| Browser channel compatibility validation across all catalog editions | iso-builder | #126 | 🔴 Stalled — verification status unclear, no P0 gate decision |
| Native desktop writer versioned distribution release (Linux, macOS, Windows) | iso-builder | native/ | 🟢 In Progress |
| Code signing & macOS notarization integration for native desktop releases | iso-builder | native/package/ | 🔴 Blocked — decision needed on signing infrastructure |
| Multi-boot USB drive bundle format contract and restore/recovery verification | iso-builder | docs/ | ⚪ Planned — depends on native writer release |

**Q4 Status Summary**: Browser verification gate (#126) blocking Q4 release readiness. No infrastructure decision on code signing. Native writer in progress but release criteria undefined.

### Next Quarter (2027 Q1) — "Scale"

| Outcome | Evidence required | Status |
|---------|-------------------|--------|
| Multi-arch ISO build target support (`arm64` + `x86_64`) | CI matrix build artifacts published to release catalog | ⚪ Planned |
| Automated mirror & IPFS fallback distribution for ISO artifacts | Integrity checksums & automated sync verification | ⚪ Planned |

---

---

## Blocking Decisions (Q4 2026)

Three items must be decided before Q4 completion:

| Decision | Blocks | Timeline | Notes |
|----------|--------|----------|-------|
| Browser verification gate (#126) pass/fail criteria | Q4 release readiness | Immediate | Needs acceptance test matrix and current status |
| Code signing & notarization infrastructure | Native writer distribution | Week 1 | Choose: internal keys vs Apple/Windows services |
| Native writer release gate definition | Versioned release | Week 2 | Define: signing, installer format, platform coverage |

---

## Technical Debt Backlog

| Item | Issue | Priority | Effort |
|------|-------|----------|--------|
| Automated signing & notarization pipeline | native/package/ | P1 | M |
| Renovate dependency health tracking | #7 | P2 | L |

---

## How to Contribute

See the README for the [static browser-app development workflow](README.md#develop)
and `tbox.wasm` rebuild instructions. Native writer contributors should also read
the [platform-specific build and test guide](native/README.md). Pick an issue from
the priorities above or comment on a goal you would like to own.

---

## Roadmap Governance

This roadmap is maintained by the strategist agent. Updates are published after
major milestones or quarterly. Propose changes via PR to this file with an issue
reference.

---
*Refreshed by strategist agent at ACMM L6. Updated 2026-10-12.*

---

## Refresh Summary (2026-10-12)

ROADMAP currency updated to reflect Q4 stall points:

- **Browser verification (#126)**: Marked active since Sept, no recent progress. Needs pass/fail criteria and current matrix status.
- **Code signing**: Planned for Q4 but no infrastructure decision. Blocks native writer distribution.
- **Native writer release**: In progress but completion criterion undefined. Needs release readiness checklist.

Next step: Decision-required issues filed for each blocker to establish Q4 gate definitions.
