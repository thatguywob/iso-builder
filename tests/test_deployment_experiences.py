"""Validate the local experience bundle and licensed font assets."""
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_experience_bundle_has_no_drift():
    subprocess.run(['node', 'scripts/generate-experiences.cjs', '--check'], cwd=ROOT, check=True)


def test_font_sources_and_license_notices_match_bundled_bytes():
    fonts = ROOT / 'app/public/fonts'
    manifest = json.loads((fonts / 'provenance.json').read_text())
    for item in manifest['files']:
        data = (fonts / item['path']).read_bytes()
        assert data[:4] == b'wOF2'
        assert hashlib.sha256(data).hexdigest() == item['sha256']
        assert item['source'].startswith('https://fonts.gstatic.com/')
        assert 'SIL OPEN FONT LICENSE Version 1.1' in (fonts / item['license_file']).read_text()


def test_experience_ids_never_become_configuration_urls():
    subprocess.run(['node', '-e', r'''
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync('app/public/experiences.js','utf8');
function boot(search){const c={URL,URLSearchParams,location:{href:'https://iso.example.org/'+search,search},TBOX_BUILDER_CONFIG:{brand:{name:'Default'}},TBOX_GUIDED_CATALOG:{id:'stock'},TBOX_FLAVOR_METADATA:{},TBOX_EXPERIENCES:{schema_version:1,default_id:'default',experiences:[{id:'default',use_default_assets:true},{id:'preview',config:{brand:{name:'Preview'}},catalog:{id:'preview'}}]}};vm.runInNewContext(code,c);return c;}
let c=boot('?experience=https://evil.example/config');assert.equal(c.TboxExperiences.id,'default');assert.equal(c.TBOX_GUIDED_CATALOG.id,'stock');assert.equal(c.TboxExperiences.target('invalid'),null);
c=boot('?experience=preview&image=old&label=old');assert.equal(c.TboxExperiences.id,'preview');assert.equal(c.TBOX_GUIDED_CATALOG.id,'preview');assert.equal(c.TboxExperiences.target('default'),'https://iso.example.org/');assert.equal(c.TboxExperiences.target('preview'),'https://iso.example.org/?experience=preview');
'''], cwd=ROOT, check=True)
