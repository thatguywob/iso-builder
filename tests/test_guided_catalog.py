"""Exercise the shared browser model and deterministic producer in CI without a browser."""
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_guided_catalog_model_and_producer():
    subprocess.run([
        'node', '--test', 'tests/guided-catalog.test.cjs',
        'tests/guided-generator.test.cjs', 'tests/builder-config-v2.test.cjs',
    ], cwd=ROOT, check=True)


def test_guided_projection_has_no_drift():
    subprocess.run(['node', 'scripts/generate-guided-catalog.cjs', '--check'], cwd=ROOT, check=True)
