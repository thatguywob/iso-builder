# Opt-in browser candidate retention

This retains diagnostic bytes, not release media or a qualified target.
It changes no download link, bucket access, credential, or cleanup policy.
No automatic expiry exists. Stored and incomplete candidates may incur storage
charges until separately authorized removal. Account quota, billing and access
settings are not established by source-code inspection.

## Dispatch exactly one candidate

Use `.github/workflows/ci.yml` at a reviewed immutable frontend revision:

```json
{"run_full":true,"only":"yellowfin-gnome","benchmark":false,"keep_iso":false,"retain_candidate":true}
```

Retention defaults false. The plan rejects other targets, multiple targets,
benchmark mode, or simultaneous legacy R2 publication before full-matrix runs.
Missing R2 configuration or an S3 SDK without conditional PUT support fails
before the expensive browser build. No dispatch occurs on push or PR.

A successful browser build can be retained even when the later guest check
fails. The guest failure stays a workflow failure; successful retention does
not qualify it. A failed browser build without complete byte measurements is
not retained. Runner loss, job cancellation or exhaustion of the job budget can
prevent retention; only the verified result file proves it ran.

The existing browser/guest budgets are unchanged. Opt-in retention adds a
five-minute dependency/configuration preflight and a twenty-minute upload/readback
step, with corresponding job headroom. These are explicit I/O budgets, not
relaxed build or boot watchdogs.

## Storage format and bounds

The existing secret-backed R2 bucket stores one slot per run/attempt:

```
browser-iso/candidates/<run-id>/<run-attempt>/yellowfin-gnome/s1/
  chunks/00000
  chunks/00001
  ...
  manifest.json
```

The slot is independent of the ISO hash so a second different candidate in the
same run/attempt cannot use another hash directory. At most 10 GiB of ISO bytes
and 1 MiB for the combined manifest/provenance are allowed. Chunks are at most
64 MiB, with at most 160 chunks. The original ISO SHA-256 and byte count bind the
ordered chunks; chunking does not change the ISO.

Every object uses `PutObject` with `If-None-Match: *`. Cloudflare documents this
as atomic against committed bucket state in its
[S3 API compatibility reference](https://developers.cloudflare.com/r2/api/s3/api/).
This avoids assuming that multipart completion provides the same condition.
The implementation never falls back to an unconditional write. A nonempty slot
is refused; an atomic conflict fails rather than resuming or overwriting.
SDK retries are disabled. There are no deletes, ACL writes or lifecycle changes.

Each uploaded chunk is read back and verified for size/SHA-256. Their combined
SHA-256 must match the independently measured browser-exported ISO. Only then is
`manifest.json` written as the commit marker, conditionally and last, and read
back for verification. `state: complete` means retained byte verification only.
It does not authenticate the producer, prove browser-loaded frontend assets,
or qualify boot/installation. No public URL is generated.

On upload, timeout or readback failure, the step fails. Partial chunks remain;
no cleanup or automatic retry occurs. An ambiguous final PUT may leave a valid
manifest even though the caller reports failure. Do not infer success or retry
writes from that outcome. Inspect the specific slot read-only first. Object
checks describe a verified snapshot, not an immutable access policy against
other writers.

## Reconstruct and verify

Use the manifest key and whole ISO SHA-256 from the successful workflow result
(or the original independently saved browser measurement). Do not take the
expected whole-file hash solely from the remote manifest being checked.
With the same existing R2 credentials configured in the environment:

```sh
python3 scripts/retain-browser-candidate.py \
  --restore-manifest browser-iso/candidates/RUN/ATTEMPT/yellowfin-gnome/s1/manifest.json \
  --expected-sha256 sha256:INDEPENDENT_ISO_HASH \
  --output candidate.iso
```

The script requires `boto3`, accepts only the candidate namespace, verifies each
chunk and the whole ISO, and exclusively creates the local output. It refuses
an existing output. A failed reconstruction leaves a partial local file and
returns failure; do not boot that file or treat it as verified.

## Provenance limits and tests

The local collector binds measured bytes to the committed served tree and
observed WASM/ISO. It rejects Git replacement refs, mutable-index omissions,
external-diff masking, hidden dirty files, symlinks and byte mismatches.
Its GitHub context remains an unverified claim until an independent run/artifact
verifier authenticates it. Frontend delivery and installer identity remain open.

Install test dependencies with `python3 -m pip install pytest PyYAML`, then run
the unit and workflow-contract suite with `python3 -m pytest -q tests`.
Fixtures are tiny and storage is in memory. They prove scope guards, atomic
conflict handling, missing/ambiguous writes, remote corruption detection,
reconstruction and failure preservation. They perform no live storage calls and
prove no real ISO build or installation.
