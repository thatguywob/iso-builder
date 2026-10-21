# Configuration-only project demos

These **unofficial, preview-only** Bluefin and Bazzite examples exercise the same
ISO Builder frontend. They are not affiliated with or endorsed by either project.
They do not establish browser ISO creation, boot, installation, Secure Boot,
hardware compatibility, or image-size qualification.

Each directory contains only `builder-config.json`. There is no project-specific
HTML, JavaScript, stylesheet, engine, relay, or deployment. The deployment-owned
configuration is validated and compiled with the common builder configuration
pipeline. Change the configuration file, not the UI source, to switch examples.

`preview_only: true` is a restrictive UI gate. It must disable image inspection
and ISO building in the shared consumer. It does not grant any new permission,
registry access, signing trust, or qualification. These examples must not be
served with a consumer that ignores this field. A disclaimer alone is not a gate.

## What differs

| Setting | Bluefin | Bazzite |
| --- | --- | --- |
| Project links | projectbluefin.io / docs.projectbluefin.io | bazzite.gg / docs.bazzite.gg |
| Example reference | ghcr.io/projectbluefin/dakota:stable | ghcr.io/ublue-os/bazzite:stable |
| Requested platform | linux/amd64 | linux/amd64 |
| Desktop metadata | GNOME | KDE Plasma |
| Accent | #4285f4 (press-kit brand accent) | #8b5cf6 (demo design choice, not an asserted official color) |
| Proposed output prefix | bluefin-demo | bazzite-demo |

No third-party logos, mascots, fonts, or favicons are redistributed or hotlinked.
Plain-text project names identify the examples. Project repository licenses do
not by themselves establish artwork or trademark permissions. Official press-kit
links are recorded for a future asset review; no license is guessed.

## Reference scope and freshness

Sources were read on **2026-10-20**; see `provenance.json`. Mutable tags are examples,
not pins. No OCI manifest, digest, signature, layer, or published platform was
resolved by these configuration previews. The requested `linux/amd64` target
maps from upstream x86-64 documentation/source; it does not assert that this
builder supports or has tested that image. There are intentionally no fabricated
sizes, checksums, release versions, recommended apps, or compatibility badges.

The live Bluefin catalog distinguishes **Bluefin** (`projectbluefin/dakota`) from
**Bluefin Classic** (`ublue-os/bluefin`). Older indexed documentation may show other
names. This example follows the live catalog, not a synthesized image reference.
Bluefin's source README also describes remaining installation/upgrade gaps;
consult the current upstream guidance rather than treating the `stable` tag as
proof that this builder is qualified.

Bazzite's official README documents desktop and Deck images, and its FAQ lists
GNOME/NVIDIA variants. This minimal example chooses only its ordinary KDE desktop
reference. It does not offer a cross-product of desktop, GPU, and architecture
choices that upstream has not verified. Refer to Bazzite's official download
selector for actual hardware-specific installation media.

## Render locally with the shared consumer

From the repository root, after the shared configuration consumer is present:

```sh
# Choose bluefin or bazzite. The app source is identical in both cases.
example=bluefin
stage=$(mktemp -d)
cp -a app/public/. "$stage/"
node scripts/generate-builder-config.cjs \
  --input "examples/$example/builder-config.json" \
  --output "$stage/builder-config-data.js"
node scripts/generate-builder-config.cjs \
  --input "examples/$example/builder-config.json" \
  --output "$stage/builder-config-data.js" --check
python3 -m http.server 8932 --bind 127.0.0.1 --directory "$stage"
```

Open `http://127.0.0.1:8932`. Repeat with `example=bazzite` in a fresh staging
directory after stopping the first server. This copies the shared application
artifact into temporary local staging; it does not create a maintained frontend
fork. The committed example directories must remain configuration-only. Do not
copy the generated preview runtime data over the stock production configuration.

The generator validates the portable contract and emits
`globalThis.TBOX_BUILDER_CONFIG`. Its `--check` option checks for stale generated
output. The browser reads the fixed local `builder-config-data.js` file; there
is no arbitrary query-string configuration loader.

Run the focused configuration-only checks:

```sh
python3 -m unittest discover -s tests -p test_brand_examples.py -v
```

## Verification requirements

Use the shared schema validator for both JSON files. Render the exact same shared
frontend twice, substituting only its validated deployment-owned configuration.
Check branding, links, disclaimer, default image/platform, output names, and the
preview gate on desktop and mobile. Screenshot evidence must show the shared UI,
not a separate mockup. Tests should reject unknown configuration keys and drift
between the JSON and generated runtime configuration. Do not enable registry
requests, downloads, production builds, deployment, or custom domains to capture
these previews.
