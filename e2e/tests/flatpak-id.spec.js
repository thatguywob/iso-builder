const { test, expect } = require('@playwright/test');

test('URL and Flathub choices use the bounded canonical app ID grammar', async ({ page }) => {
  await page.route('**/wasm_exec.js', r => r.fulfill({ body: '' }));
  await page.route('**/tbox.wasm', r => r.abort());
  const ids = ['org.example.App', 'org.example.-App', 'org.123.App', 'org.bad-name.App', 'org.example.123', 'org.example.App\n'];
  await page.route('**/flathub/search', r => r.fulfill({ json: { hits: ids.map(app_id => ({ app_id, name: app_id })) } }));
  await page.goto('/?flatpaks=' + encodeURIComponent(ids.join(',')));
  await page.locator('#apps-options > summary').click();
  await expect(page.locator('#fplist input:checked')).toHaveCount(2);
  await expect(page.locator('#fplist')).toContainText('org.example.-App');
  await page.locator('#fpsearch').fill('example');
  await expect(page.locator('#fpresults .app-card')).toHaveCount(2);
  await expect(page.locator('#fpresults')).not.toContainText('org.123.App');
  await expect(page.locator('#fpresults')).not.toContainText('org.bad-name.App');
  const parsed = await page.evaluate(() => parseCuratedSet('flatpak "org.example.App"\nflatpak "org.123.App"\nflatpak "org.example.-App"'));
  expect(parsed).toEqual(['org.example.App', 'org.example.-App']);
});
