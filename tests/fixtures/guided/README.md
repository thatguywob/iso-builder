# Guided configuration fixtures

`stock-config-v2.json` records the v2 test policy from the primary export.
The production source receipt pins the same configuration to an immutable
published commit. Tests can change a copy without changing production input.

`legacy-config-v1.json` retains the previous contract for explicit compatibility
tests. The v2 browser tests use the actual guided catalog and experience bundle.

Generated target data joins the exact CatalogSnapshot to explicit flavor
metadata. It never grants qualification.
