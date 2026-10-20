// Synthetic engine observations. No production media or qualification claims.
function observedBuildFixture(bytesWritten = 4) {
  return {
    bytesWritten,
    observedInputs: {
      schemaVersion: 1,
      source: {
        manifestDigest: `sha256:${"2".repeat(64)}`,
        indexDigest: `sha256:${"3".repeat(64)}`,
        platformDescriptor: { architecture: "amd64", variant: "v2" },
        config: {
          descriptor: { digest: `sha256:${"4".repeat(64)}`, size: 128,
            mediaType: "application/vnd.oci.image.config.v1+json" },
          bytesVerified: false,
        },
      },
      overlay: { status: "applied", manifestDigest: `sha256:${"5".repeat(64)}`,
        layersApplied: true, baseAnnotationMatched: false },
    },
  };
}
module.exports = { observedBuildFixture };
