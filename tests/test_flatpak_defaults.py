"""Run app-request state regressions in the normal Python CI gate."""
import subprocess
from pathlib import Path


def test_flatpak_defaults_state():
    subprocess.run(
        ['node', '--test', 'tests/flatpak-defaults.test.cjs'],
        cwd=Path(__file__).resolve().parents[1], check=True,
    )
