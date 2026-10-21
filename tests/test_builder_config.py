"""Portable config generation and validation without a browser."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_runtime_projection_has_no_drift():
    subprocess.run(['node', 'scripts/generate-builder-config.cjs', '--check'], cwd=ROOT, check=True)
    subprocess.run(['node', 'scripts/sync-builder-config.cjs', '--check'], cwd=ROOT, check=True)


def test_examples_validate_and_generate_same_runtime(tmp_path):
    for name in ('bluefin', 'bazzite'):
        source = ROOT / 'examples' / name / 'builder-config.json'
        output = tmp_path / f'{name}.js'
        subprocess.run(['node', 'scripts/generate-builder-config.cjs', '--input', str(source), '--output', str(output)], cwd=ROOT, check=True)
        document = json.loads(source.read_text())
        rendered = output.read_text().split('globalThis.TBOX_BUILDER_CONFIG = ', 1)[1].rstrip(';\n')
        assert json.loads(rendered) == document


def test_runtime_validator_rejects_unsafe_and_malformed_config():
    subprocess.run(['node', '-e', r'''
const {validate}=require('./app/public/builder-config.js');
const stock=require('./app/public/builder-config.json');
const cases=[
 c=>c.brand.homepage_url='https://example.org:8443',
 c=>c.brand.homepage_url='https://example.org/has space',
 c=>c.brand.logo_url='/../secret',
 c=>c.brand.logo_url='//example.org/logo',
 c=>c.desktops[0].default_flatpaks=['not.anapp'],
 c=>c.ddi_channels=null,
 c=>c.default_selection.image='bad',
 c=>c.curated_app_sets[0].desktops=['gnome','gnome'],
 c=>{c.preview_only=true;delete c.brand.disclaimer;},
];
for (const edit of cases) {
 const c=JSON.parse(JSON.stringify(stock));edit(c);let rejected=false;
 try{validate(c);}catch{rejected=true;}
 if(!rejected)throw Error('Accepted invalid deployment');
}
'''], cwd=ROOT, check=True)


def test_shared_default_image_reference_vectors():
    subprocess.run(['node', '--test', 'tests/builder-config-image-references.test.cjs'], cwd=ROOT, check=True)


def test_shared_flatpak_id_contract():
    subprocess.run(['node', '--test', 'tests/builder-config-flatpak-ids.test.cjs'], cwd=ROOT, check=True)
