// Synthetic provenance for UI state-machine tests only. Never used by @full,
// generated catalogs, or qualification evidence. Real catalog admission is
// separately tested without this route.
const catalog = require('../../app/public/catalog-snapshot.json');
async function qualifiedCatalogFixture(page) {
  const doc = structuredClone(catalog);
  for (const entry of doc.targets) {
    if (!entry.availability.available) continue;
    const digest = `sha256:${'1'.repeat(64)}`;
    Object.assign(entry.resolvedInputs, {
      liveOverlayDigest: digest,
      liveOverlayBaseDigest: entry.resolvedInputs.platformManifestDigest,
      engineRevision: digest,
      installerRevision: digest,
    });
    Object.assign(entry.qualification, {
      status: 'qualified', reason: null, receiptDigest: digest,
      qualifiedAt: '2026-10-19T00:00:00Z',
      browser: { name: 'chromium', version: 'test-fixture', memory_gib: 16, free_disk_gib: 40 },
    });
  }
  await page.route('**/catalog-snapshot.json', route => route.fulfill({ json: doc }));
  return doc;
}
module.exports = { qualifiedCatalogFixture };
