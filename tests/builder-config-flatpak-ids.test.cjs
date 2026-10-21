const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {validate,validFlatpakId}=require('../app/public/builder-config.js');
const stock=require('../app/public/builder-config.json');
// Shared verbatim with the primary producer's Python/JSON Schema validators.
const cases=require('./fixtures/builder-config-flatpak-ids.json');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app/public/app.js'),'utf8');
const context={validFlatpakId};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function parseCuratedSet('),source.indexOf('function curatedSetsFor(')),context);
for(const {id,valid} of cases) test(`canonical Flatpak ID ${JSON.stringify(id)}`,()=>{
 assert.equal(validFlatpakId(id),valid);
 const config=structuredClone(stock);config.desktops[0].default_flatpaks=[id];
 if(valid) assert.equal(validate(config).desktops[0].default_flatpaks[0],id);
 else assert.throws(()=>validate(config),/Flatpak ID/);
 assert.equal(JSON.stringify(context.parseCuratedSet(`flatpak "${id}"`)),JSON.stringify(valid?[id]:[]));
});
test('Flatpak ID helper rejects nonstring inputs',()=>{
 for(const id of [null,undefined,42,{},['org.example.App']])assert.equal(validFlatpakId(id),false);
});
