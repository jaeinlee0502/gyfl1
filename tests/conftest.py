import os

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest

from scripts.generate_samples import generate


@pytest.fixture(scope="session")
def samples(tmp_path_factory):
    return generate(tmp_path_factory.mktemp("fictional_samples"))

