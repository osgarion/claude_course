PYTEST = .venv/bin/pytest

test:
	$(PYTEST) tests/unit -q

test-v:
	$(PYTEST) tests/unit -v

test-db:
	$(PYTEST) tests/db -v

test-api:
	$(PYTEST) tests/api -v

test-arch:
	$(PYTEST) tests/arch -v

test-meta:
	$(PYTEST) tests/meta -v

test-all:
	$(PYTEST) tests/meta -q
	$(PYTEST) tests/arch -q
	$(PYTEST) tests/unit -q
	$(PYTEST) tests/db -q
	$(PYTEST) tests/api -q

.PHONY: test test-v test-db test-api test-arch test-meta test-all
