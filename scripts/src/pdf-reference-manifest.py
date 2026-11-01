"""Create a path-free feature manifest with the repository's PyMuPDF helper.

Requires the user-managed Python environment to provide the dependencies used
by ml/pdf-malware/pdf_features.py. It never uploads samples or logs paths.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ml" / "pdf-malware"))

from pdf_features import extract_pdf_features  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not args.input_dir.is_dir():
        parser.error("input directory does not exist")

    manifest = {}
    failures = 0
    for sample in sorted(args.input_dir.rglob("*")):
        if not sample.is_file() or sample.suffix.lower() != ".pdf":
            continue
        try:
            digest = hashlib.sha256(sample.read_bytes()).hexdigest()
            manifest[digest] = extract_pdf_features(sample)
        except Exception:
            failures += 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote features for {len(manifest)} unique PDF(s); {failures} extraction failure(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
