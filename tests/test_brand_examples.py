"""Contract-independent invariants for the config-only, unofficial brand demos.

The shared portable schema/consumer tests additionally validate these inputs.
This test deliberately contains no alternate schema or frontend implementation.
"""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "examples"


class BrandExampleTests(unittest.TestCase):
    def test_examples_contain_configuration_only(self):
        for name in ("bluefin", "bazzite"):
            self.assertEqual(
                [p.name for p in (EXAMPLES / name).iterdir()],
                ["builder-config.json"],
                "Do not fork the shared frontend or copy unreviewed brand assets",
            )

    def test_previews_are_restrictive_and_explicitly_unofficial(self):
        for name in ("bluefin", "bazzite"):
            with self.subTest(name=name):
                config = json.loads((EXAMPLES / name / "builder-config.json").read_text())
                self.assertEqual(config["schema_version"], 1)
                self.assertIs(config["preview_only"], True)
                disclaimer = config["brand"]["disclaimer"].lower()
                for text in ("unofficial", "not affiliated", "preview only", "not qualified"):
                    self.assertIn(text, disclaimer)
                self.assertNotIn("logo_url", config["brand"])
                self.assertNotIn("favicon_url", config["brand"])
                self.assertEqual(config["variants"], [])
                self.assertEqual(config["curated_app_sets"], [])
                self.assertEqual(config["default_selection"]["kind"], "image")
                self.assertEqual(config["default_selection"]["platform"], "linux/amd64")
                self.assertEqual(config["output"]["filename_prefix"], name + "-demo")
                self.assertEqual(config["output"]["volume_label"], name.upper() + "_DEMO")

    def test_distinct_branding_and_verified_defaults(self):
        bluefin = json.loads((EXAMPLES / "bluefin/builder-config.json").read_text())
        bazzite = json.loads((EXAMPLES / "bazzite/builder-config.json").read_text())
        self.assertEqual(bluefin["brand"]["name"], "Bluefin")
        self.assertEqual(bazzite["brand"]["name"], "Bazzite")
        self.assertEqual(bluefin["default_selection"]["image"], "ghcr.io/projectbluefin/dakota:stable")
        self.assertEqual(bazzite["default_selection"]["image"], "ghcr.io/ublue-os/bazzite:stable")
        self.assertNotEqual(bluefin["presentation"]["accent_color"], bazzite["presentation"]["accent_color"])
        self.assertEqual(bluefin["desktops"][0]["id"], "gnome")
        self.assertEqual(bazzite["desktops"][0]["id"], "kde")

    def test_both_projects_have_primary_source_provenance(self):
        provenance = json.loads((EXAMPLES / "provenance.json").read_text())
        self.assertRegex(provenance["checked_at"], r"^\d{4}-\d{2}-\d{2}$")
        for name in ("bluefin", "bazzite"):
            record = provenance["projects"][name]
            self.assertGreaterEqual(len(record["sources"]), 3)
            self.assertEqual(record["assets"]["redistributed"], [])
            self.assertIsNone(record["assets"]["license_claim"])
            config = json.loads((EXAMPLES / name / "builder-config.json").read_text())
            self.assertEqual(config["brand"]["homepage_url"], record["homepage"])
            self.assertEqual(config["brand"]["documentation_url"], record["documentation"])


if __name__ == "__main__":
    unittest.main()
