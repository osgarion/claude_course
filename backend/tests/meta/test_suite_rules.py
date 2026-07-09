"""Meta-testy: pravidla o samotné test suite."""
import ast
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parents[1]
UNIT_DIR = TESTS_DIR / "unit"

DB_FIXTURES = {"db", "transactional_db", "django_db_setup", "make_product",
               "make_address", "user", "staff_user", "auth_client", "django_user_model"}


def test_unit_tests_stay_off_the_database():
    for path in UNIT_DIR.rglob("test_*.py"):
        source = path.read_text()
        assert "django_db" not in source, f"{path.name} uses the django_db marker"
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name.startswith("test"):
                args = {a.arg for a in node.args.args}
                used = args & DB_FIXTURES
                assert not used, f"{path.name}::{node.name} uses db fixture(s) {used}"


def test_unit_tests_do_not_use_the_api_client():
    for path in UNIT_DIR.rglob("test_*.py"):
        source = path.read_text()
        assert "rest_framework.test" not in source, (
            f"{path.name} imports APIClient — request-cycle tests belong in tests/api/")


def test_all_test_files_are_collected():
    """Every test_*.py must live in a folder the Makefile targets actually run."""
    known = {"unit", "db", "api", "arch", "meta"}
    for path in TESTS_DIR.rglob("test_*.py"):
        folder = path.relative_to(TESTS_DIR).parts[0]
        assert folder in known, f"{path} is outside the known suite folders"
