# One frontend, deployment-owned configuration

`app/public/builder-config.json` is the portable v1 deployment input. The stock
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

The import checks exact bytes; CI verifies the pinned local receipt without
fetching a changing branch. The primary repository owns the schema, validation
and export. The browser validates the same bounded contract before initializing.
Missing/invalid configuration stops with an explicit error, without stock fallback.

Other projects can provide the portable JSON directly, then generate
`builder-config-data.js` with `--input` and `--output`. They do not need a TunaOS
checkout or its build matrix. Configuration is deployment-owned; URL parameters
cannot load a configuration or change transport policy. See
[the config-only examples](../examples/README.md).

Configuration supplies brand text/links/assets, color, displayed desktop and
variant order, defaults, curated app collections, optional DDI presentation and
output naming. The catalog remains the authority for offered targets and
qualification. Configured choices are intersected with the catalog; an unavailable
configured default leaves no image selected. An image reference is only an input
to existing inspection. Branding never grants relay admission or build support.

`preview_only: true` requires a visible disclaimer and blocks inspect/build/DDI
actions, including direct handler calls and autorun URLs. The Bluefin/Bazzite
examples exercise the same UI with no copied frontend or borrowed logos.

Flatpak search remains Flathub-only, backed by real metadata. Configuration does
not add arbitrary remotes. Transport trust, execution behavior, qualification,
and operation/result provenance remain engine concerns.
