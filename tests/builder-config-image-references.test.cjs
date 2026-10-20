const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../app/public/builder-config.js');
const legacy=require('./fixtures/guided/legacy-config-v1.json');
// Shared verbatim with the primary producer's Python/JSON Schema validators.
const cases=require('./fixtures/builder-config-image-references.json');
for (const {reference,valid} of cases) test(`default image reference ${JSON.stringify(reference)}`,()=>{
 const config=structuredClone(legacy);
 config.default_selection={kind:'image',image:reference,platform:'linux/amd64'};
 if(valid) assert.equal(validate(config).default_selection.image,reference);
 else assert.throws(()=>validate(config),/default image/);
});
