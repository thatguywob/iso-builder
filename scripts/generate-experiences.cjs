#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {validate}=require('../app/public/builder-config.js');
const model=require('../app/public/guided-catalog.js');
const root=path.join(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const manifest=read('app/deployment-experiences.json');
if(Object.keys(manifest).sort().join(',')!=='default_id,experiences,schema_version'||manifest.schema_version!==1||!Array.isArray(manifest.experiences)||!manifest.experiences.length||manifest.experiences.length>8)throw Error('Invalid deployment experience manifest');
const ids=new Set();
const experiences=manifest.experiences.map(entry=>{
 if(Object.keys(entry).sort().join(',')!=='catalog,config,id'||typeof entry.id!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(entry.id)||ids.has(entry.id))throw Error('Invalid or duplicate experience');ids.add(entry.id);
 for(const key of ['config','catalog'])if(typeof entry[key]!=='string'||!/^(app\/public|examples\/[a-z0-9-]+)\/[a-z0-9-]+\.json$/.test(entry[key]))throw Error('Experience assets must be repository-owned JSON paths');
 const config=validate(read(entry.config)),catalog=read(entry.catalog);
 if(entry.id!==manifest.default_id){if(!config.preview_only||config.schema_version!==2)throw Error('Additional experiences must remain v2 previews');model.createModel(catalog,null,config,{});}
 return {id:entry.id,...(entry.id===manifest.default_id?{use_default_assets:true}:{config,catalog})};
});
if(!ids.has(manifest.default_id))throw Error('Unknown default experience');
const output='// Generated from deployment-experiences.json and validated local projections; do not edit.\nglobalThis.TBOX_EXPERIENCES = '+JSON.stringify({schema_version:1,default_id:manifest.default_id,experiences})+';\n';
const file=path.join(root,'app/public/experience-data.js');if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==output)throw Error('Experience bundle has drifted');}else fs.writeFileSync(file,output);
