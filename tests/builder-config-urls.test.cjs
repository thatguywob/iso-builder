const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../app/public/builder-config.js');
const stock=require('../app/public/builder-config.json');
// Shared verbatim with the primary producer's Python/JSON Schema validators.
const fixture=require('./fixtures/builder-config-urls.json');
for(const {url,asset,valid} of fixture.cases) test(`canonical configuration URL ${JSON.stringify(url)}`,()=>{
 const config=structuredClone(stock);config.brand[asset?'logo_url':'homepage_url']=url;
 if(valid) assert.doesNotThrow(()=>validate(config));
 else assert.throws(()=>validate(config));
});
test('the browser mirrors the exact producer URL pattern',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../app/public/builder-config.js'),'utf8');
 assert.ok(source.includes(JSON.stringify(fixture.https_pattern)));
});
