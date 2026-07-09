"""Import-direction rules within catalog/: models is the foundation layer and
must not import from serializers/views/permissions; serializers must not import views.

Ratcheted: only violations not present in allowlist.BASELINE fail the build.
"""
import ast
from pathlib import Path

from tests.arch.allowlist import BASELINE

REPO_ROOT = Path(__file__).resolve().parents[2]

# module (without .py) -> catalog submodules it must not import from
FORBIDDEN = {
    "models": {"serializers", "views", "permissions"},
    "serializers": {"views"},
    "permissions": {"views", "serializers"},
}


def imported_top_level_modules(path):
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module:
            yield node.module.split(".")[-1]


def current_violations():
    violations = set()
    for module_name, forbidden in FORBIDDEN.items():
        path = REPO_ROOT / "catalog" / f"{module_name}.py"
        if not path.exists():
            continue
        for imported in imported_top_level_modules(path):
            if imported in forbidden:
                violations.add((f"catalog/{module_name}.py", imported))
    return violations


def test_no_new_upward_imports():
    new = current_violations() - BASELINE
    assert not new, f"new import-direction violations: {sorted(new)}"


def test_ratchet_baseline_is_not_stale():
    """Fixed debt must be removed from the allowlist, not silently kept."""
    stale = BASELINE - current_violations()
    assert not stale, f"allowlist entries no longer needed: {sorted(stale)}"
