# Browser ISO qualification integration proposal

This is a review proposal, not qualification evidence or authorization to run,
publish, deploy, or change download routing.

## Reviewed sources

- iso-builder `f6a0bfa`: `.github/workflows/ci.yml`,
  `e2e/tests/builder.spec.js`, `e2e/tests/build-measurements.js`.
- tacklebox pin: `b2c917d7e896d49d095daefe6a812beb9d4398d6`.
- tunaOS draft #3431 `ed1d226a0aeff09f186a6a129a8ce9f029a18385`:
  `scripts/iso-e2e.sh`, `.github/workflows/iso-builder-parity.yml`.

These are fixed inspection revisions, not a live status table. Re-review the
harness and frontend revisions selected for an eventual run.

## Current blockers

1. The available GitHub connector exposes reads and failed-job reruns, but no
   workflow dispatch. A rerun cannot supply new dispatch inputs. Do not use a
   push, rerun, or production deployment as a surrogate dispatch.
2. `keep_iso=true` publishes to R2 only after guest verification succeeds.
   Failure discards the runner-local candidate. The parity workflow instead
   expects named GitHub artifacts with ISO files and experience manifests;
   the current full workflow creates neither of those artifacts.
3. The full workflow supplies none of the immutable overlay/engine identities,
   target variant/flavor, or measured browser version required by the newer
   strict harness. Merely changing the checkout pin cannot make it qualify.
4. The diagnostic record explicitly lacks producer and frontend identity.
   A valid ISO hash plus loaded WASM hash and engine observations do not fill
   those gaps. The legacy `qual-evidence` file uses catalog facts and is not an
   authenticated browser receipt.

## Exact existing dispatch shape

Workflow: `tuna-os/iso-builder/.github/workflows/ci.yml`.
For one flagship x86 target, existing syntactically valid inputs are:

```json
{"run_full":true,"only":"yellowfin-gnome","benchmark":false,"keep_iso":false}
```

This selects `tuna-os/yellowfin:gnome`, `linux/amd64/v2`. It does not pin mutable
image tags and does not preserve a failed candidate. `keep_iso=true` is also a
valid input, but means an R2 publication after successful guest verification,
not failure-safe retention. Do not describe it as a retention-only switch.
Do not leave `only` blank: that selects all eleven editions. Upstream reference
cells are `qualify=false` and prove neither TunaOS offline GUI parity nor a
qualified TunaOS target. `benchmark=true` creates three cold profiles, not a
cold/warm pair. No workflow was dispatched during this review.

## Integration stages

The bounded retention portion now has an opt-in draft implementation described
in [candidate retention](candidate-retention.md). The remaining producer and
strict qualification stages below remain proposals.

## Minimal proposed change, in reviewable stages

### A. Preserve and bind a single candidate

Add a dedicated candidate-retention option, default false and independent of
`keep_iso`. Review storage destination, access, quota and expiry before enabling
it: the current repo explicitly excludes multi-GB ISOs from Actions artifacts.
Do not silently switch to artifacts or move the existing R2 publisher ahead of
the gate. Do not write release paths, latest pointers, or existing object keys.

For an approved retention destination, save to a unique run-ID/run-attempt/
edition/sample key. Refuse overwrite; preserve the exact bytes exported from
the browser even if later strict qualification fails. Hash before and after
retention, and bind the independently verified remote artifact identity to the
receipt. R2 size equality alone is not a checksum verification. Never retain
private SSH keys, swtpm state, or installed qcow2 disks.

Preserve diagnostics outside `e2e/test-results/` before another Playwright
invocation clears it. Run retention/diagnostic finalization on failure as well
as success, without turning a failed build into success. A format-check failure
may retain a clearly labelled failed candidate but may not mint a build receipt.

### B. Add authenticated producer/frontend provenance

Record repository, immutable frontend checkout SHA, workflow path/revision,
run ID, attempt, job, selected target, and candidate artifact identity from the
trusted workflow context. Hash the exact served frontend assets plus the
compiler-matched WASM shim; record the loaded WASM measurement already observed
inside the page. Bind them to the saved ISO and operation-local BuildResult.

Keep two frontend identities distinct: builder UI assets versus the installed
GUI installer. Measure the installed installer frontend from the bundled image
or Flatpak commit; do not substitute the fisherman backend executable hash.
A checkout SHA alone does not prove which bytes the browser loaded.

A collector must validate these observations and authenticate the producer
before computing a browser-build receipt. Strings copied from the catalog,
request, a mutable tag, or arbitrary environment variables cannot supply missing
observations. Continue `qualification: not-assessed` until that integration
exists and succeeds.

### C. Run strict qualification on those same bytes

Review and pin a complete harness tree, including helper scripts, to an
immutable commit. `ed1d226a` is a reviewed candidate, not an approved automatic
pin bump. Use disposable VM disks only, under the dedicated output directory.
Rehash the retained ISO immediately before boot and require the expected hash.

Pass verified values explicitly through sudo; it otherwise sanitizes the
caller environment:

- `VARIANT=yellowfin`, `FLAVOR=gnome`.
- `TUNAOS_QUAL_PLATFORM=linux/amd64/v2`, CPU baseline `v2`, and the accurately
  measured VM scope. A QEMU result must never imply physical hardware support.
- `TUNAOS_QUAL_SOURCE_DIGEST`, `TUNAOS_QUAL_OVERLAY_DIGEST`,
  `TUNAOS_QUAL_INSTALLER_DIGEST`, `TUNAOS_QUAL_ENGINE_DIGEST`, and
  `TUNAOS_QUAL_MEDIA_DIGEST` from verified provenance/bytes.
- `TUNAOS_QUAL_BROWSER_NAME`, `TUNAOS_QUAL_BROWSER_VERSION`,
  `TUNAOS_QUAL_BROWSER_MEMORY_GIB`, `TUNAOS_QUAL_BROWSER_FREE_DISK_GIB`
  from the actual browser host/session, not the later VM runner.

Invoke `scripts/iso-e2e.sh <candidate> --strict-offline-gui --output <isolated-dir>`
with `TBOX_E2E_IMAGE` and `FISHERMAN_OVERRIDE` absent. The bare strict switch
requires both plain and encrypted installs. Keep guest `restrict=on`, the GUI
walkthrough, ISO-detached installed boots, and source digest/targetImgref checks.
No generic bootc CLI fallback, host OCI injection, or skipped assertions.

Review budget and dependencies: the old 25-minute guest cap is not evidence
that two strict installs plus cold/warm installed boots fit. The current parity
workflow uses a 90-minute job and includes OCR/SSH/image tools missing from the
old full workflow dependency list. Measure bounded phase times before setting
new caps; do not increase budgets to conceal stalled or missing prerequisites.

### D. Join evidence without qualifying prematurely

Require strict evidence for both modes and same-ISO binding to the authenticated
browser receipt. Compare with a CI-built counterpart using equal immutable
source, overlay, installer and engine inputs; media digests may differ but each
must match its own file. The current reusable parity workflow is x86-runner
specific; ARM qualification needs independently reviewed runner support.

Only after successful producer, browser, live/GUI, plain/encrypted and installed
boot checks may a target claim qualified. Keep status, R2 cutover and download
routing unchanged until the full freshness/admission policy accepts the receipt.
Cold/warm transfer measurement is separate: retain one browser profile with
identical immutable inputs and prove the warm build transfers zero complete
layers. Three fresh profiles or warm installed-system boots do not prove it.

## Regression checks required with implementation

- Fail before a multi-GB build for an invalid edition, missing immutable inputs,
  unavailable retention destination, or missing strict-harness dependencies.
- Saved/retained ISO byte mismatch, frontend mismatch, run-attempt mismatch,
  missing producer/installer identity, and replayed receipt all reject admission.
- A strict failure still preserves authorized candidate bytes and diagnostics;
  it never publishes release media or creates a qualified receipt.
- Plain-only, encrypted-only, injected payload, enabled guest egress, attached
  ISO on installed boot, wrong source digest and skipped GUI assertions fail.
- Warm profile recreation or any transferred complete layer fails warm reuse.
- No storage write, workflow dispatch, public claim or routing mutation occurs
  in unit tests; use tiny synthetic files, explicitly not boot evidence.

## Bounded retention consent proposal

Source inspection found only the secret-backed bucket and endpoint references;
no verified bucket name, public-access configuration, quota, or account-level
lifecycle policy is available here. The existing writer uses
`browser-iso/<run-id>/<slug>.iso`. The reviewed tunaOS `prune-r2.yml` expires
`live-isos/` after 14 days and `screenshots/` after 60 days, but does not expire
`browser-iso/`. Existing access must not be described as private or public
without verifying it.

Recommended scope for explicit consent: one Yellowfin GNOME candidate, at most
10 GiB, and at most 1 MiB of provenance, in the existing configured R2 bucket
under `browser-iso/candidates/<run-id>/<run-attempt>/yellowfin-gnome/s1/`.
Use bounded conditional-write chunks and a final combined provenance manifest. No overwrites, latest pointers, release
links, or access changes. This is a proposed cap, not a measured ISO size; fail
rather than upload if it exceeds the cap. No other candidates or repeated
uploads are covered by that one-candidate scope.

Seven days would be a reasonable proposed retention period, but the existing
code/tools cannot enforce or promise expiry. Without separately approved and
reviewed cleanup, it may remain stored and incur storage charges until removed.
Do not add an account lifecycle rule or delete objects under this proposal.
A bounded opt-in implementation is now described in [candidate retention](candidate-retention.md); no storage writes have occurred.

## Local producer-observation regression proposal

`scripts/collect-candidate-provenance.py` is intentionally not wired into CI.
It validates the manual-run context shape and checks the checkout SHA against
the claimed workflow/run SHA. It hashes tracked frontend files, the workflow,
and generated WASM/shim from the served tree, rejecting dirty tracked files,
unexpected untracked files, symlinks, empty files and concurrent file changes.
It independently hashes the candidate ISO and joins it to the browser's ISO and
loaded-WASM byte observations.

Run it on the trusted producer host, using the actual retained ISO and browser
diagnostic JSON; the existing GitHub job supplies its context fields:

```sh
python3 scripts/collect-candidate-provenance.py \
  --root "$GITHUB_WORKSPACE" --iso "$CANDIDATE_ISO" \
  --measurements "$BROWSER_MEASUREMENTS" > candidate-producer-observations.json
```

The output does not trust environment variables as authentication. It explicitly
keeps `qualification: not-assessed`, `authentication: not-verified`, browser
frontend delivery unverified, and remote artifact binding unverified. It emits
no receipt digest and removes no missing identity. An external verifier must
check the run/job/artifact, and a browser response observer must bind served
frontend bytes to what was actually loaded. Installed-installer frontend
identity remains a separate requirement. This useful local snapshot is not the
completed trusted producer/consumer protocol.
