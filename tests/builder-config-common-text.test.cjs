const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../app/public/builder-config.js');
const stock=require('../app/public/builder-config.json');
const fixture=require('./fixtures/builder-config-common-text.json');
function config(version){const c=structuredClone(stock);if(version===1){c.schema_version=1;delete c.selection;c.variants=[{id:'yellowfin',name:'Yellowfin'}];c.default_selection={kind:'catalog',variant:'yellowfin',flavor:'gnome',platform:'linux/amd64/v2'};for(const d of c.desktops){d.name=d.id;d.description='Desktop';}}return c;}
const common=[c=>[c.brand,'name'],c=>[c.brand,'disclaimer'],c=>[c.presentation,'headline'],c=>[c.presentation,'intro'],c=>[c.curated_app_sets[0],'label'],c=>[c.ddi_channels[0],'name']];
for(const version of [1,2]){const fields=[...common,...(version===1?[c=>[c.desktops[0],'name'],c=>[c.desktops[0],'description'],c=>[c.variants[0],'name']]:[])];
 for(const [i,field] of fields.entries())for(const {value,valid} of fixture.cases)test(`common v${version} field ${i}: ${JSON.stringify(value)}`,()=>{const c=config(version),[object,key]=field(c);object[key]=value;if(valid)assert.doesNotThrow(()=>validate(c));else assert.throws(()=>validate(c));});}
test('common whitespace class exactly mirrors producer',()=>{const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../app/public/builder-config.js'),'utf8');assert.ok(source.includes(JSON.stringify('[^'+fixture.python_whitespace_class+']')));});
