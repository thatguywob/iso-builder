"""Config/catalog example invariants; shared validators remain authoritative."""
import json
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / 'examples'
def read(path):
    return json.loads((EXAMPLES / path).read_text())

class BrandExampleTests(unittest.TestCase):
    def test_only_config_and_catalog_no_frontend_fork(self):
        for name in ('bluefin', 'bazzite'):
            self.assertEqual(sorted(p.name for p in (EXAMPLES / name).iterdir()), ['builder-config.json', 'guided-catalog.json'])

    def test_v2_preview_without_automatic_selection_or_build_authority(self):
        for name in ('bluefin', 'bazzite'):
            c = read(name + '/builder-config.json')
            self.assertEqual(c['schema_version'], 2)
            self.assertIs(c['preview_only'], True)
            for text in ('Unofficial', 'Not affiliated', 'No image inspection or ISO creation', 'not qualified'):
                self.assertIn(text, c['brand']['disclaimer'])
            self.assertEqual(c['default_selection'], {'kind': 'none'})
            self.assertEqual(c['curated_app_sets'], [])
            self.assertEqual(c['selection']['recommendations'], [])
            self.assertNotIn('variants', c)
            self.assertNotIn('ghcr.io/', json.dumps(c))
            self.assertEqual(c['output']['filename_prefix'], name + '-demo')
            self.assertEqual(c['output']['volume_label'], name.upper() + '_DEMO')

    def test_precise_preview_catalogs(self):
        for name, count in [('bluefin', 3), ('bazzite', 10)]:
            catalog = read(name + '/guided-catalog.json')
            self.assertIsNone(catalog['snapshotDigest'])
            self.assertEqual(len(catalog['leaves']), count)
            identities = set()
            for leaf in catalog['leaves']:
                source = leaf['source']
                self.assertEqual(source['kind'], 'preview')
                self.assertEqual(source['platform'], 'linux/amd64')
                self.assertTrue({'ref', 'platform'} <= {claim for ev in source['evidence'] for claim in ev['claims']})
                pair = (source['ref'], source['platform'])
                self.assertNotIn(pair, identities)
                identities.add(pair)
                self.assertFalse({'qualification', 'availability', 'resolvedInputs', 'targetKey'} & source.keys())

    def test_bluefin_statuses_and_distinct_identity(self):
        c = read('bluefin/builder-config.json')
        family = next(f for f in c['selection']['facets'] if f['id'] == 'family')
        self.assertEqual([v['id'] for v in family['values']], ['classic', 'dakota', 'utah'])
        badges = {v['id']: v['card']['badge'] for v in family['values']}
        self.assertEqual(badges['dakota'], 'Alpha')
        self.assertEqual(badges['utah'], 'Coming soon')
        utah = next(l for l in read('bluefin/guided-catalog.json')['leaves'] if l['facets']['family'] == ['utah'])
        self.assertEqual(utah['source']['ref'], 'ghcr.io/projectbluefin/utah:testing')
        self.assertNotIn(':stable', utah['source']['ref'])

    def test_bazzite_conditional_graphics_and_beta_ack(self):
        leaves = read('bazzite/guided-catalog.json')['leaves']
        self.assertEqual(sum('handheld' in l['facets']['hardware'] for l in leaves), 2)
        for leaf in leaves:
            facets = leaf['facets']
            if 'handheld' in facets['hardware']:
                self.assertEqual(facets['graphics'], ['amd-intel'])
            if facets['edition'] == ['gaming'] and facets['graphics'] == ['nvidia']:
                self.assertEqual(facets['hardware'], ['htpc'])
                self.assertEqual(facets['graphics_generation'], ['modern'])
                self.assertTrue(any(n.get('requiresAcknowledgement') is True for n in leaf['notices']))
            if facets.get('graphics_generation') == ['legacy']:
                self.assertEqual(facets['hardware'], ['desktop'])

    def test_all_card_assets_have_explicit_provenance(self):
        manifest = {a['url']: a for a in read('assets.json')['assets']}
        for name in ('bluefin', 'bazzite'):
            c = read(name + '/builder-config.json')
            for facet in c['selection']['facets']:
                for value in facet['values']:
                    if 'card' in value:
                        a = manifest[value['card']['image_url']]
                        self.assertTrue(a['source_url'].startswith('https://'))
                        self.assertEqual(a['delivery'], 'official-URL-reference-only')
                        self.assertIn('not', a['license_note'])
                        self.assertTrue(value['card']['image_alt'])

    def test_alternate_bounded_presentations(self):
        for name, style, font in [('bluefin', 'illustrated', 'inter'), ('bazzite', 'thumbnail', 'dm-sans')]:
            p = read(name + '/builder-config.json')['presentation']
            self.assertEqual(p['choice_style'], style)
            self.assertEqual(p['font_family'], font)
            self.assertTrue({'background', 'surface', 'text', 'muted', 'accent', 'accent_text'} <= set(p['colors']))
            self.assertTrue(set(p['colors']) <= {'background', 'surface', 'text', 'muted', 'accent', 'accent_text', 'border', 'hover_surface', 'focus', 'selected_surface'})
            self.assertEqual(p['accent_color'], p['colors']['accent'])

if __name__ == '__main__':
    unittest.main()
