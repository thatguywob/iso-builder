#!/usr/bin/env node
// The exact CatalogSnapshot owns target identity; pinned primary metadata owns
// flavor meaning. This projection creates no availability/qualification claims.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const model=require('../app/public/guided-catalog.js');
const args=process.argv.slice(2), root=path.join(__dirname,'../app/public');
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const flavorMetadata={},omitted=[];
let catalog;
if(args.includes('--catalog-input')) {
 const configFile=option('--config');if(!configFile)throw Error('--config is required for a preview catalog');
 const config=require('../app/public/builder-config.js').validate(read(configFile));
 if(config.schema_version!==2||!config.preview_only)throw Error('Preview catalog projection requires preview_only v2 config');
 catalog=read(option('--catalog-input'));
 if(!catalog.leaves?.every(leaf=>leaf.source?.kind==='preview'))throw Error('Imported example catalog must contain preview leaves only');
 model.createModel(catalog,null,config,{});
} else {
const snapshot=read(option('--snapshot',path.join(root,'catalog-snapshot.json')));
const metadata=read(option('--metadata',path.join(root,'builder-flavors.json')));
if(Object.keys(metadata).sort().join(',')!=='flavors,kind,schema_version'||metadata.schema_version!==1||metadata.kind!=='builder-flavor-metadata'||!Array.isArray(metadata.flavors))throw Error('Invalid primary flavor metadata');

for(const item of metadata.flavors){if(!item||Object.keys(item).sort().join(',')!=='desktop,edition,id'||Object.values(item).some(v=>typeof v!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(v))||flavorMetadata[item.id])throw Error('Invalid or duplicate flavor metadata');flavorMetadata[item.id]={desktop:item.desktop,edition:item.edition};}

const targets=snapshot.targets.filter(e=>{
 if(flavorMetadata[e.target.flavor])return true;
 if(e.availability?.available!==false)throw Error(`Available or unclassified target lacks primary flavor metadata: ${e.targetKey}`);
 omitted.push({targetKey:e.targetKey,reason:'Flavor absent from pinned primary metadata; snapshot record unavailable'});return false;
});
catalog={schemaVersion:1,kind:'guided-image-catalog',catalogId:'stock',generatedAt:snapshot.generatedAt,snapshotDigest:snapshot.snapshotDigest,leaves:targets.map(e=>({id:e.targetKey,source:{kind:'target',targetKey:e.targetKey},facets:{base:[e.target.variant],desktop:[flavorMetadata[e.target.flavor]?.desktop],hardware:[e.target.hardwareScope],platform:[e.target.platform],edition:[flavorMetadata[e.target.flavor]?.edition]},notices:[]}))};
model.validate(catalog,snapshot,{flavorMetadata,isOffered:e=>Boolean(e.scheduled||e.availability?.available)});
}
const out=option('--output-dir',root);
const files={'guided-catalog-omissions.json':JSON.stringify(omitted.sort((a,b)=>a.targetKey.localeCompare(b.targetKey)),null,2)+'\n','guided-catalog.json':JSON.stringify(catalog,null,2)+'\n','guided-catalog-data.js':'// Generated from validated guided catalog inputs; do not edit.\nglobalThis.TBOX_GUIDED_CATALOG = '+JSON.stringify(catalog)+';\nglobalThis.TBOX_FLAVOR_METADATA = '+JSON.stringify(flavorMetadata)+';\n'};
for(const [name,content]of Object.entries(files)){const file=path.join(out,name);if(args.includes('--check')){if(fs.readFileSync(file,'utf8')!==content)throw Error(`${name} has drifted`);}else fs.writeFileSync(file,content);}
