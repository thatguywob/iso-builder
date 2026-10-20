# Browser qualification admission

Catalog availability and an ISO format check do not prove live-install parity.
A qualified target needs a strict receipt for its exact source, overlay,
installer and engine. The receipt must prove a live desktop and GUI installs
with the network disabled. It must cover plain and encrypted disks, then a
reboot from each installed disk alone.

The evidence needs the browser name, version and resource prerequisites.
Three cold samples do not measure cold and warm performance.

## Incomplete catalog provenance

Symptom: edition cards and Inspect claim `qualified` with no overlay identity
or browser prerequisites. At commit `622fc34`, 54 catalog rows had null overlay
digests and the strings `tacklebox-1.0` and `remora-1.0`.
The public catalog fetched on 2026-10-19 matched the source file.
Its SHA-256 was `2ca80ba998082eeed685521c6c0f630c7a0c5e061d302a1820e4e34d4903a691`.

The deploy job in [run 39104556492](https://github.com/tuna-os/iso-builder/actions/runs/39104556492)
succeeded. That run skipped full-matrix and did not prove installation.

Cause: the consumer checked the snapshot checksum, status enum and source
digest, then trusted the status. A digest-shaped identifier does not establish
a complete receipt. The app also embedded these claims as fallback data.

Fix: withdraw these claims from the web, native and embedded catalogs.
Keep all targets and publication records. The gate checks source, overlay and
base identities. It checks digests for the installer, engine and receipt.
It also checks the date, browser name and version, and positive memory and disk
values.

The app rejects metadata that is incomplete and keeps the local fallback.
That fallback exports the exact BuildRequest. The CI validator rejects the
incomplete claim.

This is **not cryptographic verification of a receipt**. It does not prove an
installation or that the inputs remain current. The producer must validate
the observed evidence and bind the receipt to inputs collected independently.
Only then can it publish a qualified status. This change qualifies no target.
Synthetic metadata exists only in UI fixtures, never as runtime evidence.

## Strict harness handoff

The pinned tunaOS harness at `e89bf562d7488242295bf02c228bbba4c509b388`
rejects `TBOX_E2E_IMAGE` in strict mode because it enables the generic CLI install
fallback. Pass it only to the upstream-reference LUKS path. Explicitly unset it
for strict GUI qualification. Keep the harness guard.

Issue #270 still needs these steps:

- Bind the browser output and producer inputs to the strict harness.
- Support isolated candidate builds before any public claim of qualification.
- Preserve each sample outside the output directory that Playwright clears.
- Measure transfers for paired cold and warm runs with unchanged inputs.
- Review the harness pin against the newer strict contract in
  [tunaOS #3431](https://github.com/tuna-os/tunaOS/pull/3431).

The current benchmark uses three cold profiles. It does not prove warm reuse.

A maintainer must review and approve deployment. A merge to main automatically
deploys the app and relay. Public download routes, R2 publication, retention and existing objects stay intact.

Admission timestamps use UTC whole seconds (`YYYY-MM-DDTHH:MM:SSZ`), as the
strict harness emits. Both consumers reject dates that are invalid and strings
without this format. Both trim browser names before the native checks.

The minimum gate also needs browser origin, a build receipt digest and the final
ISO digest. The producer must match these to a separate observation from a
trusted browser-build workflow and artifact. A self-asserted origin flag does
not prove that association. The current producer lacks this integration and
must keep targets unqualified. A native install result does not establish
browser origin. Placeholder browser names and versions cannot pass the gate.

## Browser build diagnostic measurements

The existing `@full` test writes a separate `build-measurements-*.json` file
beside its legacy evidence. The full diagnostics artifact includes this file;
the qualification-evidence validator does not consume it.

The record contains the SHA-256 and byte count of the saved ISO. If the test
retains a separate copy for later steps, it hashes that copy too and needs
an exact match. The file checks describe the observed snapshot; they do not
prevent later mutation or authenticate a published artifact.

A test-page observer clones the exact Response passed to native
`WebAssembly.instantiateStreaming`. It reads at most 64 MiB, hashes those bytes,
and needs exactly one call that loads `tbox.wasm` from the same origin.
The call must succeed without a redirect. Missing, failed or ambiguous observations prevent the record.
This records bytes supplied to `instantiateStreaming`, not an authenticated engine.

The observer exists only in the test page. It leaves the native result and
failure independent of the hash operation. Its memory and timing overhead
means these samples do not qualify performance.

Chromium product/version and user agent come from the same page's CDP session.
Stage durations use a monotonic clock and exclude navigation. The record has
kind `diagnostic-build-measurements`, with `qualification: not-assessed`.
Tiny fixtures test the observer and file checks without a multi-GB ISO build.
They do not establish a real browser build or installation result.

The engine at [the tacklebox pin](https://github.com/tuna-os/tacklebox/blob/d36fdb8417819a7075cecfd6cf062b442c07335a/cmd/tbwasm/main.go) resolves a platform manifest digest and checks
its applied overlay internally. Its browser build API returns only a byte
count. A later contract for engine results needs review. It must expose identities
for the consumed source, overlay and installed frontend. These observations cannot come from the catalog or tags. This diagnostic record is not a v2 receipt,
and it changes no catalog admission or download route.
