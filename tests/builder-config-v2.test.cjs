'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validate}=require('../app/public/builder-config.js');
const fixture=require('./fixtures/guided/stock-config-v2.json');
const copy=()=>structuredClone(fixture);
test('v2 policy validates independently of the v1 stock projection',()=>{const c=validate(copy());assert.equal(c.schema_version,2);assert.ok(Object.isFrozen(c.selection));assert.equal(c.default_selection.kind,'leaf');});
for(const [name,change] of [
 ['empty facets',c=>c.selection.facets=[]],['empty values',c=>c.selection.facets[0].values=[]],
 ['too many values',c=>c.selection.facets[0].values=Array.from({length:257},(_,i)=>({id:'v'+i,label:'Value'}))],
 ['markup label',c=>c.selection.facets[0].label='<script>'],['long label',c=>c.selection.facets[0].label='a'.repeat(2049)],
 ['invalid leaf',c=>c.default_selection.leaf_id='javascript:alert(1)'],
 ['extra color',c=>c.presentation.colors={background:'#000000',surface:'#111111',text:'#ffffff',muted:'#cccccc',accent:'#aaaaaa',accent_text:'#000000',css:'body{}'}],
 ['external font',c=>c.presentation.font_family='https://example.org/font.woff2'],
 ['CSS style',c=>c.presentation.choice_style='background:url(x)'],
 ['unsafe card',c=>c.selection.facets[0].values[0].card={image_url:'javascript:alert(1)',image_alt:'Image'}],
 ['unknown path facet',c=>c.selection.paths[0].facets=['unrecognized']],
 ['v1 choices in v2',c=>c.variants=[]],
])test(`v2 rejects ${name}`,()=>{const c=copy();change(c);assert.throws(()=>validate(c));});
test('bounded project palette and cards are declarative',()=>{const c=copy();c.presentation.colors={background:'#10151f',surface:'#1f2937',text:'#ffffff',muted:'#dddddd',accent:'#6c7ae9',accent_text:'#000000'};c.presentation.font_family='inter';c.presentation.choice_style='illustrated';c.selection.facets[0].values[0].card={image_url:'/assets/example.webp',image_alt:'Example art',badge:'Preview'};assert.equal(validate(c).presentation.choice_style,'illustrated');});
