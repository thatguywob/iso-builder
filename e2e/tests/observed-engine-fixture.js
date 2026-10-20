// Tiny, deliberately non-bootable OCI image for the production WASM engine.
// Mirrors tacklebox's observed_result_test.go fixture, without an OPFS shim.
const crypto = require("node:crypto");
const digest = bytes => `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
function tar(files) {
  const chunks = [];
  for (const [name, text] of files) {
    const data = Buffer.from(text); const header = Buffer.alloc(512);
    const field = (offset, length, value) => header.write(value, offset, length, "ascii");
    const octal = (offset, length, value) => field(offset, length, value.toString(8).padStart(length - 1, "0") + "\0");
    field(0, 100, name); octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0);
    octal(124, 12, data.length); octal(136, 12, 0); header.fill(32, 148, 156);
    field(156, 1, "0"); field(257, 6, "ustar\0"); field(263, 2, "00");
    const sum = header.reduce((a, b) => a + b, 0);
    field(148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}
function observedEngineFixture() {
  const layer = tar([
    ["etc/passwd", "root:x:0:0:root:/root:/bin/bash\n"],
    ["etc/shadow", "root:!:20000:0:99999:7:::\n"],
    ["etc/group", "root:x:0:\n"], ["etc/gshadow", "root:!::\n"],
    ["etc/skel/.fixture", "keep the introspected tree immutable\n"],
    ["usr/lib/modules/test/vmlinuz", "not a bootable kernel\n"],
    ["usr/lib/modules/test/initramfs.img", "not a bootable initramfs\n"],
    ["usr/lib/systemd/boot/efi/systemd-bootx64.efi", "not an EFI executable\n"],
  ]);
  const json = value => Buffer.from(JSON.stringify(value));
  const config = json({ architecture: "amd64", os: "linux", config: {}, rootfs: { type: "layers", diff_ids: [] } });
  const descriptor = { mediaType: "application/vnd.oci.image.config.v1+json", digest: digest(config), size: config.length };
  const manifest = json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json", config: descriptor,
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar", digest: digest(layer), size: layer.length }] });
  const index = Buffer.from(" \n" + JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json",
    manifests: [{ mediaType: "application/vnd.oci.image.manifest.v1+json", digest: digest(manifest), size: manifest.length,
      platform: { architecture: "amd64", os: "linux" } }] }) + "\n");
  const documents = new Map([
    ["/token", json({ token: "fixture-token" })], ["/v2/fixture/boot/manifests/test", index],
    [`/v2/fixture/boot/manifests/${digest(index)}`, index], [`/v2/fixture/boot/manifests/${digest(manifest)}`, manifest],
    [`/v2/fixture/boot/blobs/${digest(config)}`, config], [`/v2/fixture/boot/blobs/${digest(layer)}`, layer],
  ]);
  return { documents, manifestDigest: digest(manifest), indexDigest: digest(index), descriptor };
}
module.exports = { observedEngineFixture };
