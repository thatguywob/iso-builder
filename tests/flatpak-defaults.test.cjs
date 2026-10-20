const {test}=require('node:test');
const assert=require('node:assert/strict');
const {suggestions,create}=require('../app/public/flatpak-defaults.js');
const A='org.example.Alpha', B='org.example.Beta';
test('inspection suggestions win; empty is explicit and declarations remain labelled',()=>{
 assert.deepEqual(suggestions({suggestedFlatpaks:[A,A,'bad']},[B]),{ids:[A],source:'image inspection'});
 assert.deepEqual(suggestions({suggestedFlatpaks:[]},[B]).ids,[]);
 assert.equal(suggestions({},[B]).source,'configuration declaration');
});
test('initial defaults prefill without making them an explicit user edit',()=>{
 const s=create(); assert.deepEqual(s.inspect('image-a',suggestions({suggestedFlatpaks:[A]})).selected,[A]);
 assert.equal(s.snapshot().edited,false);
});
test('edits and explicit none survive repeated inspection and target backtracking',()=>{
 const s=create(); s.inspect('a',suggestions({suggestedFlatpaks:[A]})); s.edit([]);
 for(const key of ['a','b','a']) { const r=s.inspect(key,suggestions({suggestedFlatpaks:[B]})); assert.deepEqual(r.selected,[]); assert.equal(r.pending,true); }
});
test('new target offers defaults without clobbering; restore accepts latest only',()=>{
 const s=create(); s.inspect('a',suggestions({suggestedFlatpaks:[A]}));
 assert.deepEqual(s.inspect('b',suggestions({suggestedFlatpaks:[B]})).selected,[A]);
 assert.deepEqual(s.inspect('b',suggestions({suggestedFlatpaks:[B]})).selected,[A]);
 assert.deepEqual(s.restore().selected,[B]); assert.equal(s.snapshot().pending,false);
});
