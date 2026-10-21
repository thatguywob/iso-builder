#!/usr/bin/env python3
"""Resolve every image the picker offers against the GHCR manifest API.

The catalog in app/public/app.js and native/catalog.go is typed by hand and
mirrors a matrix owned by another repository (tuna-os/tunaos's
.github/build-config.yml). native/catalog_variants_test.go pins the two local
copies to each other, which catches a one-sided edit but cannot catch an entry
that was never real, or one whose upstream tag went away. Both copies agreeing
on a nonexistent image is a green test and a broken product.

The registry is the only authority both frontends and the user actually share,
and it needs no cross-repo checkout and no package-listing permission: an
anonymous pull token plus a manifest HEAD answers "does this tag exist" for one
ref at a time.

Exit status:
  0  every ref resolved, or the only failures were inconclusive (see below)
  1  at least one ref returned a definitive 404
  2  the parser found no refs — a pass would have meant nothing

A ref that fails for any reason other than 404 (timeout, 5xx, rate limit,
network) is reported as INCONCLUSIVE and does not fail the run. This check
guards against catalog entries that are wrong, not against GitHub being down;
failing the build on a flaky HEAD would train people to ignore it.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_APP_JS = REPO_ROOT / "app" / "public" / "app.js"
APP_JS = DEFAULT_APP_JS
CATALOG_GO = REPO_ROOT / "native" / "catalog.go"
CATALOG_SNAPSHOT = REPO_ROOT / "app" / "public" / "catalog-snapshot.json"
GHCR = "https://ghcr.io"
MANIFEST_ACCEPT = ", ".join(
    [
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ]
)
TIMEOUT = 20
RETRIES = 3

VARIANTS_BLOCK = re.compile(r"const VARIANTS = \[(.*?)\n\];", re.S)
VARIANT_ENTRY = re.compile(
    r'id:\s*"([^"]+)",\s*name:\s*"[^"]*",\s*des:\s*\[([^\]]*)\]'
)
QUOTED = re.compile(r'"([^"]+)"')
GO_IMAGE_FIELD = re.compile(r'Image:\s*"ghcr\.io/([^"]+)"')

DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
VALID_STATUSES = {"qualified", "local-only", "unqualified", "unsupported"}
OFFERED_VARIANTS = {
    "yellowfin", "bonito", "sailfin", "flounder", "grouper",
    "marlin", "skipjack", "albacore", "guppy",
}
DESKTOP_IDS = {"gnome", "kde", "cosmic", "niri", "xfce"}


def qualification_provenance_complete(entry: dict) -> bool:
    """Minimum consumer admission, not a substitute for receipt verification."""
    from datetime import datetime

    q = entry.get("qualification") or {}
    ri = entry.get("resolvedInputs") or {}
    if not isinstance(q, dict) or not isinstance(ri, dict):
        return False
    browser = q.get("browser") or {}
    if not isinstance(browser, dict):
        return False
    digests = [ri.get(key) for key in ("platformManifestDigest", "liveOverlayDigest",
               "liveOverlayBaseDigest", "installerRevision", "engineRevision")]
    digests.extend(q.get(key) for key in ("receiptDigest", "browserBuildReceiptDigest", "isoDigest"))
    if q.get("buildOrigin") != "browser":
        return False
    if not all(isinstance(value, str) and DIGEST_RE.fullmatch(value) for value in digests):
        return False
    if ri["liveOverlayBaseDigest"] != ri["platformManifestDigest"]:
        return False
    try:
        stamp = q["qualifiedAt"]
        if not isinstance(stamp, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", stamp):
            return False
        datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError, AttributeError):
        return False
    if not all(isinstance(browser.get(key), str) and browser[key].strip() for key in ("name", "version")):
        return False
    if browser["name"].strip().lower().startswith("native") or browser["name"].strip().lower() in {"unknown", "none", "null", "n/a", "placeholder", "unspecified"}:
        return False
    if not re.fullmatch(r"[1-9][0-9]*(?:\.[0-9]+)*", browser["version"].strip()):
        return False
    import math
    if not all(type(browser.get(key)) in (int, float) and math.isfinite(browser[key])
               and browser[key] > 0 for key in ("memory_gib", "free_disk_gib")):
        return False
    availability = entry.get("availability")
    return isinstance(availability, dict) and availability.get("available") is True


def validate_snapshot(snapshot_path: Path | None = None) -> dict:
    """Load and validate a CatalogSnapshot v1 JSON file."""
    path = snapshot_path or CATALOG_SNAPSHOT
    try:
        doc = json.loads(path.read_text())
    except Exception as exc:
        sys.exit(f"failed to load catalog snapshot {path}: {exc}")
    if not isinstance(doc, dict) or doc.get("schemaVersion") != 1 or doc.get("kind") != "catalog-snapshot":
        sys.exit(f"invalid CatalogSnapshot v1 header in {path}")
    if not DIGEST_RE.match(str(doc.get("coverageDigest", ""))):
        sys.exit(f"invalid coverageDigest in {path}")
    snap_digest = str(doc.get("snapshotDigest", ""))
    if not DIGEST_RE.match(snap_digest):
        sys.exit(f"invalid snapshotDigest in {path}")
    targets = doc.get("targets")
    if not isinstance(targets, list) or not targets:
        sys.exit(f"empty targets list in {path}")
    canonical = json.dumps(targets, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("utf-8")
    expected_digest = "sha256:" + hashlib.sha256(canonical).hexdigest()
    if snap_digest != expected_digest:
        sys.exit(f"snapshotDigest mismatch in {path}: got {snap_digest}, expected {expected_digest}")
    for entry in targets:
        qual = entry.get("qualification") or {}
        if qual.get("status") not in VALID_STATUSES:
            sys.exit(f"invalid qualification.status in {path}: {qual.get('status')!r}")
        if qual.get("status") == "qualified" and not qualification_provenance_complete(entry):
            sys.exit(f"qualified entry {entry.get('targetKey')} has incomplete qualification provenance in {path}")
        avail = entry.get("availability") or {}
        pm_digest = (entry.get("resolvedInputs") or {}).get("platformManifestDigest")
        if avail.get("available") and not DIGEST_RE.match(str(pm_digest or "")):
            sys.exit(f"available entry {entry.get('targetKey')} missing platformManifestDigest in {path}")
    return doc


def snapshot_refs(snapshot_path: Path | None = None) -> list[tuple[str, str]]:
    """(ref, source) for every offered desktop ref in catalog-snapshot.json."""
    doc = validate_snapshot(snapshot_path)
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for entry in doc["targets"]:
        target = entry.get("target") or {}
        vid = target.get("variant")
        fid = target.get("flavor")
        if vid not in OFFERED_VARIANTS or fid not in DESKTOP_IDS:
            continue
        if not entry.get("scheduled") and not (entry.get("availability") or {}).get("available"):
            continue
        ref = str((entry.get("publication") or {}).get("ref", "")).removeprefix("ghcr.io/")
        if ref and ref not in seen:
            seen.add(ref)
            out.append((ref, "catalog-snapshot.json"))
    return out


def picker_refs() -> list[tuple[str, str]]:
    """(ref, source) for every ghcr.io/tuna-os/<variant>:<desktop> in app.js."""
    src = APP_JS.read_text()
    if APP_JS == DEFAULT_APP_JS and "TboxBuilderConfig.variants" in src:
        # Presentation order is a generated deployment config, while the snapshot
        # is still the authority for offered target cells and qualification.
        config_path = APP_JS.with_name("builder-config.json")
        config = json.loads(config_path.read_text())
        variants = {v["id"] for v in config["variants"]}
        desktops = {d["id"] for d in config["desktops"]}
        refs = snapshot_refs(CATALOG_SNAPSHOT)
        return [(ref, "builder-config.json + catalog-snapshot.json") for ref, _ in refs
                if ref.rsplit("/", 1)[-1].split(":", 1)[0] in variants
                and ref.rsplit(":", 1)[-1] in desktops]
    block = VARIANTS_BLOCK.search(src)
    if not block:
        sys.exit(
            "no `const VARIANTS = [...]` in app.js — the parser is broken, not "
            "the data; fix this regex before trusting a pass"
        )
    out = []
    for variant_id, desktops in VARIANT_ENTRY.findall(block.group(1)):
        for desktop in QUOTED.findall(desktops):
            out.append((f"tuna-os/{variant_id}:{desktop}", "app.js VARIANTS"))
    if APP_JS == DEFAULT_APP_JS and CATALOG_SNAPSHOT.exists():
        snap_set = {ref for ref, _ in snapshot_refs(CATALOG_SNAPSHOT)}
        js_set = {ref for ref, _ in out}
        if snap_set != js_set:
            sys.exit(
                f"app.js VARIANTS and catalog-snapshot.json disagree: "
                f"only in app.js={sorted(js_set - snap_set)}, "
                f"only in snapshot={sorted(snap_set - js_set)}"
            )
    return out
def external_refs() -> list[tuple[str, str]]:
    """(ref, source) for every literal ghcr.io ref in native/catalog.go.

    These are the curated non-TunaOS entries. They are not generated from the
    variant matrix, so the app.js check above never touches them, and they name
    tags on orgs this project does not control.
    """
    return [
        (ref, "catalog.go Image:")
        for ref in GO_IMAGE_FIELD.findall(CATALOG_GO.read_text())
    ]


def pull_token(repo: str) -> str | None:
    url = f"{GHCR}/token?scope=repository:{repo}:pull&service=ghcr.io"
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as resp:
            return json.load(resp).get("token")
    except (urllib.error.URLError, ValueError, TimeoutError):
        return None


def manifest_status(ref: str) -> tuple[int | None, str]:
    """HTTP status for a manifest HEAD, or (None, reason) if it never resolved."""
    repo, _, tag = ref.partition(":")
    last = "no attempt made"
    for attempt in range(RETRIES):
        if attempt:
            time.sleep(2**attempt)
        token = pull_token(repo)
        if token is None:
            last = "could not obtain an anonymous pull token"
            continue
        req = urllib.request.Request(
            f"{GHCR}/v2/{repo}/manifests/{tag}",
            method="HEAD",
            headers={"Authorization": f"Bearer {token}", "Accept": MANIFEST_ACCEPT},
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return resp.status, ""
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return 404, ""
            last = f"HTTP {err.code}"
        except (urllib.error.URLError, TimeoutError) as err:
            last = str(err)
    return None, last


def main() -> int:
    refs = picker_refs() + external_refs()
    if not refs:
        print("FAIL: parsed zero refs — nothing was checked", file=sys.stderr)
        return 2

    missing: list[tuple[str, str]] = []
    inconclusive: list[tuple[str, str]] = []

    print(f"resolving {len(refs)} catalog refs against {GHCR}\n")
    for ref, source in refs:
        status, reason = manifest_status(ref)
        if status == 404:
            missing.append((ref, source))
            print(f"  404  ghcr.io/{ref}  [{source}]")
        elif status is None:
            inconclusive.append((ref, reason))
            print(f"  ???  ghcr.io/{ref}  ({reason})")
        else:
            print(f"  {status}  ghcr.io/{ref}")

    print()
    if inconclusive:
        print(f"{len(inconclusive)} ref(s) did not resolve for reasons other than 404:")
        for ref, reason in inconclusive:
            print(f"  ghcr.io/{ref} — {reason}")
        print("Not treated as failures; the registry, not the catalog, was unreachable.\n")

    if missing:
        print(f"FAIL: {len(missing)} catalog ref(s) do not exist in the registry:")
        for ref, source in missing:
            print(f"  ghcr.io/{ref}  (declared in {source})")
        print(
            "\nThe picker offers these to users. Either the upstream tag was "
            "dropped, or the entry was never published. Remove the entry, or fix "
            "the ref."
        )
        return 1

    checked = len(refs) - len(inconclusive)
    print(f"OK: {checked} of {len(refs)} catalog refs resolved.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
