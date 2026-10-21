// Explicit v1 compatibility coverage. New production v2 flow is covered by
// guided-catalog-ui and experience-switcher; engine lifecycle tests use real v2.
const config=require('../../tests/fixtures/guided/legacy-config-v1.json');
exports.useLegacyDeployment=test=>test.beforeEach(async({context})=>{
 await context.route('**/builder-config-data.js',route=>route.fulfill({contentType:'text/javascript',body:'globalThis.TBOX_BUILDER_CONFIG='+JSON.stringify(config)+';'}));
});
