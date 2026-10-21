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
test('stale inspection is rejected while same-operation removal keeps its diagnostic',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const code=fs.readFileSync(require('node:path').join(__dirname,'../app/public/app.js'),'utf8');
 const helper=code.slice(code.indexOf('function inspectionStillCurrent(op)'),code.indexOf('async function inspect()'));
 const op={}, logs=[];
 const context={currentOp:op,operationMatchesForm:()=>false,log:message=>logs.push(message)};
 vm.createContext(context);vm.runInContext(helper,context);
 assert.equal(context.inspectionStillCurrent(op),false);assert.match(logs[0],/no longer available/);
 logs.length=0;assert.equal(context.inspectionStillCurrent({}),false);assert.equal(logs.length,0);
 context.operationMatchesForm=()=>true;assert.equal(context.inspectionStillCurrent(op),true);
});

test('all suggested and declared IDs follow the shared canonical grammar',()=>{
 const cases=require('./fixtures/builder-config-flatpak-ids.json');
 const ids=cases.map(c=>c.id), accepted=cases.filter(c=>c.valid).map(c=>c.id);
 assert.deepEqual(suggestions({suggestedFlatpaks:ids}).ids,accepted);
 assert.deepEqual(suggestions({},ids).ids,accepted);
});
