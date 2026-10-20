# Guided project previews: one frontend, two configurations

These **unofficial, preview-only** Bluefin and Bazzite examples use the same ISO
Builder frontend. Neither project endorses these examples. No image inspection,
ISO creation, browser-build qualification, boot/installation testing, or deployment
is provided by them.

Each project directory contains exactly two data files:
- `builder-config.json`: portable presentation config v2; branding, six-color
  palette, bounded font/card styles, question order and facet labels.
- `guided-catalog.json`: guided catalog v1; documented image identities, facets,
  source evidence, upstream-status notices and required beta acknowledgement.

There is no project-specific HTML, JavaScript, stylesheet, engine, relay or hosted
site. Configuration does not contain registry references or admission policy.
Catalog leaves are documentation-backed **preview** records, never production
targets. `preview_only: true` blocks inspect/build/autorun. Both examples use
`default_selection: {kind: "none"}` so the visitor starts with the first question.

## Bluefin

Illustrated cards and Inter typography identify **Classic**, **Dakota**, and
**Utah**. Dakota preserves the official picker's Alpha badge. Utah preserves
Coming soon and the repository's experimental pre-alpha status; its preview
reference is `ghcr.io/projectbluefin/utah:testing`, never an invented stable tag.
Classic and Dakota refer to their documented stable streams. Upstream channel
names do not imply this builder is qualified. The limited three-leaf example
does not claim to be Bluefin's complete GPU/edition matrix.

## Bazzite

Thumbnail cards and DM Sans typography follow the documented device-first path:
- Desktop/laptop → graphics → NVIDIA generation when applicable → KDE/GNOME
- HTPC → graphics → KDE/GNOME; NVIDIA is the modern path with a required beta notice
- Handheld → KDE/GNOME; no redundant graphics question

The ten explicit image leaves own the valid combinations. No suffixes or
Cartesian-product image references are manufactured. Older NVIDIA is desktop-only;
NVIDIA HTPC is not promoted to ordinary supported status by acknowledging the beta
notice. Handheld is the documented x86-64 path, not a claim that every handheld
or integrated GPU works. Single-valued channel/platform facts remain visible in
the review rather than adding unnecessary questions.

## Artwork, typography and provenance

`assets.json` records exact official card-art URLs, source pages, review date and
individual licensing gaps. The demos reference those public URLs; **no artwork
bytes are redistributed**. A missing image must retain its text label/description.
Do not treat a project repository's license as blanket permission for transformed
website artwork. In particular, the exact license of the website dinosaur and
Bazzite device/GPU/desktop assets has not been established. Public redistribution
or vendoring needs a separate review. This local preview is not publication.

Palette values reproduce inspected upstream background/surface/accent choices,
with readable example text colors. `choice_style` is limited to illustrated or
thumbnail; `font_family` to the shared implementation's system/inter/dm-sans
choices. Configuration cannot inject CSS, font imports, scripts or markup. Font
files, if used, are managed once by the shared frontend with its own license
notices. The Bazzite wordmark is referenced from its official URL with verified press-kit
license provenance; its aspect ratio and colors must be preserved. Bluefin keeps a
plain-text header because the verified wordmark is specifically Classic, while
this example contains three families. No favicon is copied.

Sources were checked on **2026-10-20**. `provenance.json` records project/branding
sources; each catalog leaf embeds its own image/platform evidence. Mutable tags
are not digest pins. No OCI manifests, signatures or layer sizes were verified.
Do not infer published ARM availability from a source build option.

## Render locally using the exact shared frontend

From an integrated repository with the v2 consumer and both common generators:

```sh
example=bluefin  # or bazzite
stage=$(mktemp -d)
cp -a app/public/. "$stage/"
node scripts/generate-builder-config.cjs \
  --input "examples/$example/builder-config.json" \
  --output "$stage/builder-config-data.js"
node scripts/generate-guided-catalog.cjs \
  --catalog-input "examples/$example/guided-catalog.json" \
  --config "examples/$example/builder-config.json" --output-dir "$stage"
node scripts/generate-builder-config.cjs \
  --input "examples/$example/builder-config.json" \
  --output "$stage/builder-config-data.js" --check
node scripts/generate-guided-catalog.cjs \
  --catalog-input "examples/$example/guided-catalog.json" \
  --config "examples/$example/builder-config.json" --output-dir "$stage" --check
python3 -m http.server 8932 --bind 127.0.0.1 --directory "$stage"
```

Open `http://127.0.0.1:8932`. Stop the server and use fresh staging for the other
example. This copies one shared application artifact temporarily; it does not
create a maintained frontend fork or overwrite production configuration. Runtime
reads fixed `builder-config-data.js` and `guided-catalog-data.js` files; arbitrary
query-string config/catalog loading is not supported. Both generators validate
before emission, and `--check` detects generated-output drift.

## Tests and evidence boundaries

```sh
python3 -m unittest discover -s tests -p test_brand_examples.py -v
```

Focused tests cover data-only directories, preview/no-default constraints, exact
3/10 leaf counts, Bluefin status badges, Bazzite conditional combinations and beta
acknowledgement metadata, bounded alternate styles, and all card provenance.
Shared schema, browser validator and catalog-model tests remain authoritative;
these focused tests do not duplicate them. UI QA must additionally prove the
same frontend displays each example on desktop/mobile, skips resolved questions,
preserves warnings, rejects production use of preview leaves, and blocks inspect,
build and autorun, including Advanced controls. Screenshots prove presentation,
not image installation support. No deployment or custom domain is authorized.
