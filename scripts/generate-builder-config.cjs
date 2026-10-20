#!/usr/bin/env node
// JSON is the portable input. The JS file is a generated synchronous projection.
const fs=require('node:fs');
const path=require('node:path');
const {validate}=require('../app/public/builder-config.js');
const args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const input=option('--input',path.join(__dirname,'../app/public/builder-config.json'));
const output=option('--output',path.join(__dirname,'../app/public/builder-config-data.js'));
const config=validate(JSON.parse(fs.readFileSync(input,'utf8')));
const content='// Generated from builder-config.json; do not edit.\n'+'globalThis.TBOX_BUILDER_CONFIG = '+JSON.stringify(config,null,2)+';\n';
if(args.includes('--check')) {
 if(fs.readFileSync(output,'utf8')!==content) throw new Error('Generated builder config has drifted; regenerate from the validated JSON projection.');
} else fs.writeFileSync(output,content);
