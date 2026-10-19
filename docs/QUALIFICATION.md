# Browser qualification admission

Catalog availability and an ISO format check do not prove live-install parity.
A browser-qualified target needs a current, producer-validated strict receipt
for its exact source, live overlay, installer and engine inputs: live desktop,
GUI installation with network disabled, both plain and encrypted installs,
and target-only installed reboot. Browser/version and resource prerequisites
must accompany that evidence. Three cold samples are not a cold/warm benchmark.

## Incomplete catalog provenance

Symptom: edition cards and Inspect say `qualified` despite absent live-overlay
identity or browser/version prerequisites. At iso-builder commit `622fc34`,
54 shipped rows had this status with null live-overlay digests and the strings
`tacklebox-1.0` / `remora-1.0`. The public catalog fetched on 2026-10-19 had
SHA-256 `2ca80ba998082eeed685521c6c0f630c7a0c5e061d302a1820e4e34d4903a691`,
identical to that source catalog. The deploy job in
[run 39104556492](https://github.com/tuna-os/iso-builder/actions/runs/39104556492)
succeeded; its full-matrix job was skipped. That run does not prove installation.

Cause: consumer validation checked the snapshot checksum, status enum and
source digest, then trusted the status. A digest-shaped receipt identifier did
not establish a complete receipt. The bundled app fallback carried the same
claims as the JSON catalog.

Fix: withdraw those incomplete readiness claims in web, native and embedded
fallback catalogs without removing target/publication records. Require exact
source/overlay/base binding, digest identities for installer/engine, a receipt
digest/date, and browser name/version plus positive memory/disk prerequisites
before the browser admits `qualified`. Invalid incoming metadata is downgraded
and keeps the exact local BuildRequest fallback; the CI validator rejects it.

This consumer minimum is **not cryptographic verification of a receipt**, proof
of the underlying installation, or verification that observed inputs remain
current. The producer must validate strict observed evidence and bind its
receipt to independently collected current inputs before republishing status.
No target is newly qualified by this change. Synthetic metadata lives only in
explicit UI test fixtures and cannot qualify a runtime target.

## Strict harness handoff

The pinned tunaOS harness at `e89bf562d7488242295bf02c228bbba4c509b388`
rejects `TBOX_E2E_IMAGE` in strict mode because it enables the generic CLI install
fallback. Pass it only to the upstream-reference LUKS path; explicitly unset it
for strict GUI qualification. Do not remove the harness guard.

Remaining blockers for #270: bind actual browser output and producer input
identities into the strict harness, support isolated candidate builds without
claiming public qualification first, preserve each benchmark sample outside
Playwright's cleared output directory, and measure paired unchanged-warm layer
transfers. The current three independent profiles are cold-only. The pinned
harness also needs review against the newer strict receipt contract in
[tunaOS #3431](https://github.com/tuna-os/tunaOS/pull/3431).

This source repair does not deploy, change public download routing, or alter R2
publication or retention. Existing download objects remain retained. A maintainer
must review and approve deployment; merging main automatically deploys the app
and relay.

Admission timestamps use UTC whole seconds (YYYY-MM-DDTHH:MM:SSZ), matching
the strict harness emitter. Both consumers reject invalid calendar dates and
non-ISO or timezone-free strings. Browser names are trimmed before native checks.
