const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validate}=require('../app/public/builder-config.js');
const stock=require('../app/public/builder-config.json');
const fixture=require('./fixtures/builder-config-selection-text.json');
const fields=[
 c=>[c.selection.facets[0],'label'], c=>[c.selection.facets[0],'description'],
 c=>[c.selection.facets[0].values[0],'label'], c=>[c.selection.facets[0].values[0],'description'],
 c=>[c.selection.facets[0].values[0].card={image_url:'/logo.png',image_alt:'Logo'},'image_alt'],
 c=>[c.selection.facets[0].values[0].card={image_url:'/logo.png',image_alt:'Logo'},'badge'],
 c=>[c.selection.paths[0],'label'],c=>[c.selection.recommendations[0],'label'],c=>[c.selection.recommendations[0],'reason'],
];
for(const [i,field] of fields.entries())for(const {value,valid} of fixture.cases)test(`selection text field ${i}: ${JSON.stringify(value)}`,()=>{
 const c=structuredClone(stock),[object,key]=field(c);object[key]=value;
 if(valid)assert.doesNotThrow(()=>validate(c));else assert.throws(()=>validate(c));
});
test('selection whitespace class exactly mirrors producer',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../app/public/builder-config.js'),'utf8');
 assert.ok(source.includes(JSON.stringify('[^'+fixture.python_whitespace_class+']')));
});
test('common text behavior is unchanged',()=>{
 for(const [value,valid] of [['\u0085',true],['\ufeff',false]]){const c=structuredClone(stock);c.brand.name=value;if(valid)assert.doesNotThrow(()=>validate(c));else assert.throws(()=>validate(c));}
});

for(const [i,field] of fields.entries())for(const size of [2048,2049])test(`selection field ${i} Unicode codepoint boundary ${size}`,()=>{
 const c=structuredClone(stock),[object,key]=field(c);object[key]='😀'.repeat(size);
 if(size===2048)assert.doesNotThrow(()=>validate(c));else assert.throws(()=>validate(c));
});
