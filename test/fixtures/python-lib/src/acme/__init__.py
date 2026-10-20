import os

HOME = os.environ.get("ACME_HOME", ".")


def load_manifest(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        return {"path": path}
