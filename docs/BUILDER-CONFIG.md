# One frontend, deployment-owned configuration

`app/public/builder-config.json` is the portable input for a deployment (v1). The stock
copy is an exact export of `[iso_builder]` in `tuna-os/tunaOS`'s `tunaos.toml`.
`builder-config-source.json` records its immutable source commit, path and SHA-256.
Do not edit the stock projection or generated JavaScript by hand.

To import a reviewed primary export:

```sh
node scripts/sync-builder-config.cjs /path/to/iso-builder.config.json --source-commit COMMIT_SHA
node scripts/generate-builder-config.cjs
node scripts/sync-builder-config.cjs --check
node scripts/generate-builder-config.cjs --check
```

The importer compares bytes. CI checks the receipt. It does not fetch a branch. The primary repository owns the schema, validation
and export. The browser validates the same bounded contract before it starts.
Missing/invalid configuration stops with an explicit error, without stock fallback.

Other projects can provide the portable JSON directly, then generate
`builder-config-data.js` with `--input` and `--output`. They do not need a TunaOS
checkout or its build matrix. Configuration is deployment-owned; a URL
cannot load a configuration or change transport policy. See
[the config-only examples](../examples/README.md).

Configuration supplies brand text/links/assets, color, displayed desktop and
variant order, defaults, curated app collections, optional DDI presentation and
output naming. The catalog remains the authority for offered targets and
qualification. The UI matches choices to catalog records. If the default is unavailable,
the UI selects no image. An image reference is only an input
to existing inspection. Brand configuration never grants relay admission or build support.

`preview_only: true` needs a visible disclaimer and blocks inspect/build/DDI
actions, including direct handler calls and autorun URLs. The Bluefin/Bazzite
examples exercise the same UI with no copied frontend or borrowed logos.

Flatpak search remains Flathub-only, backed by real metadata. Configuration does
not add arbitrary remotes. Transport trust, execution behavior, qualification,
and operation/result provenance remain engine concerns.
