# SecureSphere PDF training pipeline reconstruction and local evaluation

**Date:** 2026-10-27
**Scope:** recover evidence from this repository and available Git history; add an isolated local evaluation tool. No training, model export, sample acquisition, or production scanner change was performed.

## Findings

The repository contains the PDF feature tables, training script, feature helper, serialized joblib model, JSON model, and JSON converter. Available Git history contains no deleted or renamed PDF training extractor beyond those files. The PDF training assets were introduced together in commit `7dd33bc` (`Complete SecureSphere secure upload and sharing`). The only later PDF training-code edit found is commit `f8dba63`, which changed the standalone helper's embedded-file count. Available branches are `main`, `origin/main`, and `backup/main`; no additional source code for creating the supplied feature tables was found.

The key limitation is that `train_pdf_model.py` loads `PDF_All_features.csv` and `PDFMalware2022.parquet` as already extracted feature tables. It never invokes `pdf_features.py` or extracts rows from PDFs. Therefore the helper documents an intended/reference extraction implementation, but does not establish how either dataset's feature values were actually produced. No row-level PDFs, source manifest, extraction environment, package versions, or lineage record links feature-table rows to this helper. We cannot claim recovered feature parity.

### Feature schema and evidence

The 24 names and order below are **verified** by both `common_features` in the training script and the bundled `pdf.json` metadata. The actual source-table generation behavior for each is **unknown**. The standalone helper's behavior is verified as code behavior, not as proof of how dataset values were generated. Status below is deliberately scoped to the training-table extraction question.

| # | Model feature | Training-table extraction status | Available helper behavior / evidence |
|---:|---|---|---|
| 1 | `file_size` | **Unknown** | Helper: filesystem byte size; app: `Uint8Array.byteLength`. CSV/table units and source generation are not documented. |
| 2 | `metadata_size` | **Unknown** | Helper: UTF-8 byte length of `str(doc.metadata or {})`; app: capped estimate from visible `/Info` reference token. |
| 3 | `page_count` | **Unknown** | Helper: `len(doc)` from PyMuPDF; app: raw `/Type /Page` spelling count with `/Pages` excluded. |
| 4 | `title_chars` | **Unknown** | Helper: Python `len()` of parsed metadata title; app: length of the first visible literal `/Title (...)` match. |
| 5 | `encrypted` | **Unknown** | Helper: `int(doc.is_encrypted)`; app: whether raw bytes contain `/Encrypt`. |
| 6 | `embedded_file_count` | **Unknown** | Original helper in `7dd33bc`: raw `/EmbeddedFile` substring count, matching app spelling-count behavior. In `f8dba63` the helper changed to `len(doc.embfile_names())`, except it returns 0 when all names equal `content credentials`; app was not changed. Which behavior produced dataset values is unknown. |
| 7 | `image_count` | **Unknown** | Helper: sum of `page.get_images(full=True)` references; app: raw `/Subtype /Image` substring count. |
| 8 | `object_count` | **Unknown** | Helper and app count raw `" obj"` occurrences. |
| 9 | `endstream_count` | **Unknown** | Helper and app count raw `"endstream"` occurrences. |
| 10 | `stream_count` | **Unknown** | Helper and app count raw `"stream"` occurrences, including the substring inside `endstream`. |
| 11 | `xref_count` | **Unknown** | Helper and app count raw `"xref"` occurrences, including those inside `startxref`. |
| 12 | `trailer_count` | **Unknown** | Helper and app count raw `"trailer"` occurrences. |
| 13 | `startxref_count` | **Unknown** | Helper and app count raw `"startxref"` occurrences. |
| 14 | `objstm_count` | **Unknown** | Helper and app count raw `/ObjStm` occurrences. |
| 15 | `js_count` | **Unknown** | Helper and app count raw `/JS` occurrences. |
| 16 | `javascript_count` | **Unknown** | Helper and app lowercase the Latin-1-mapped bytes and count `/javascript`. |
| 17 | `aa_count` | **Unknown** | Helper and app count raw `/AA` occurrences. |
| 18 | `openaction_count` | **Unknown** | Helper and app count raw `/OpenAction` occurrences. |
| 19 | `acroform_count` | **Unknown** | Helper and app count raw `/AcroForm` occurrences. |
| 20 | `jbig2decode_count` | **Unknown** | Helper and app count raw `/JBIG2Decode` occurrences. |
| 21 | `richmedia_count` | **Unknown** | Helper and app count raw `/RichMedia` occurrences. |
| 22 | `launch_count` | **Unknown** | Helper and app count raw `/Launch` occurrences. |
| 23 | `xfa_count` | **Unknown** | Helper and app count raw `/XFA` occurrences. |
| 24 | `colors_count` | **Unknown** | Helper and app count raw `/ColorSpace` occurrences. |

The earlier parity audit's statement that the helper left `embedded_file_count` at its initialized zero is stale. Git history shows that the original helper counted `/EmbeddedFile` raw substrings; the PyMuPDF attachment-name logic was introduced later in `f8dba63`. That later helper logic is still not evidence of feature-table provenance.

### Training, labels, and export

`train_pdf_model.py` renames source columns, concatenates two datasets, maps `PDFMalware2022` labels `Benign` to 0 and `Malicious` to 1, coerces 24 columns to numeric, fills nulls with each feature's median calculated over the combined data, removes missing labels, and uses a stratified random 80/20 `train_test_split` with `random_state=42`. It trains `LGBMClassifier(n_estimators=300, learning_rate=0.05, num_leaves=31, random_state=42, verbosity=-1)`. It prints accuracy, precision, recall, F1, ROC-AUC, confusion matrix, and classification report, then saves the model and feature-name list. The selected features are not scaled. No per-row provenance, duplicate grouping, leakage prevention, split manifest, pinned random/library versions, or saved evaluation report is present. The saved model is the model fitted on the 80% training split; the held-out 20% is only reported to stdout.

The training script's two inputs are already feature tables; their labels and values cannot be traced to source documents from repository metadata. `ml/pdf-malware/requirements.txt` is empty. `pdf_features.py` imports PyMuPDF (`pymupdf`) but no package version is pinned. The environment used for the committed model is unknown.

`ml/convert_to_json.py` loads the joblib model and feature order, calls the LightGBM booster `dump_model()`, serializes tree split/leaf information and each tree's `shrinkage`, and writes `artifacts/securesphere/assets/models/pdf.json`. The app inference implementation applies each serialized shrinkage value. That correction, the 24-feature order, the 0.5 decision threshold, and SAFE-only upload policy are unchanged by this work.

## Isolated evaluation harness

Added `scripts/src/pdf-evaluation.mjs`, which imports the existing app PDF extractor and LightGBM inference functions without changing them. It accepts a local directory, recursively considers `.pdf` files, deduplicates byte-identical files by SHA-256, checks the `%PDF-` header, validates all feature keys in exact model order and requires finite numeric values, then records probability and the existing 0.5 prediction. It never prints or writes source file paths or names. Output includes feature values and a content hash, so keep the chosen output folder private. A PDF header check is an evaluation-harness input guard, not a production scanner change or a full PDF validity check.

It writes `pdf-evaluation.json`, `pdf-evaluation.csv`, and `pdf-evaluation-report.md` in the specified local output directory. With no labels, the report explicitly does **not** calculate accuracy, false-positive rate, or false-negative rate. Extraction and inference failures are coded separately; it does not zero-fill absent features. An optional reference manifest maps the PDF SHA-256 digest to an exact 24-key feature object. The companion `scripts/src/pdf-reference-manifest.py` generates such a path-free manifest using the repository's PyMuPDF helper when the user's Python environment has the required library installed. This is a candidate-helper comparison, not proof that the helper generated the training tables.

From the repository root, run the app-side extractor and model evaluation on locally supplied files:

```powershell
node --experimental-strip-types .\scripts\src\pdf-evaluation.mjs --input-dir 'D:\private-pdf-evaluation\samples' --output-dir 'D:\private-pdf-evaluation\app-results'
```

If a local Python environment with PyMuPDF is available, generate helper features and compare them by hash:

```powershell
python .\scripts\src\pdf-reference-manifest.py --input-dir 'D:\private-pdf-evaluation\samples' --output 'D:\private-pdf-evaluation\reference-features.json'
node --experimental-strip-types .\scripts\src\pdf-evaluation.mjs --input-dir 'D:\private-pdf-evaluation\samples' --output-dir 'D:\private-pdf-evaluation\comparison' --reference-json 'D:\private-pdf-evaluation\reference-features.json'
```

No PDF sample corpus is present, so local tests use only small synthetic byte fixtures and a fixed model vector. Those checks demonstrate validation and repeatability only; they do not represent real PDFs or scanner accuracy. The application extractor itself is deliberately heuristic and does not parse/validate a full PDF grammar.

## Evaluation design before any model or extractor change

1. Resolve source, license, provenance, and permission for each benign and malicious sample collection before acquiring or redistributing samples. Keep source release, hash, date, label evidence, and license outside public logs.
2. Use independent benign PDFs representing ordinary documents, reports, forms, image/scanned files, embedded objects, encryption, metadata variants, and common authoring tools. Include benign security documentation containing suspicious-looking keywords.
3. Use inert, rights-cleared malicious PDFs with evidence-backed labels. Have independent reviewers label samples as confirmed malicious, benign, or uncertain; do not treat a JavaScript/action keyword as ground truth.
4. Deduplicate exact hashes and group near-duplicates, revisions, campaigns/families, source collections, and generating templates so related PDFs cannot cross split boundaries. Preserve an untouched locked test set.
5. Compare all 24 app/helper features with missing values and extraction failures reported explicitly. Then assess probabilities and threshold curves offline only; do not tune using the locked test set.
6. Report per-class precision, recall, F1, confusion matrix, and false-positive rate on independently labeled benign PDFs, with sample sizes and uncertainty intervals. Break out representative benign subgroups. Do not claim accuracy from synthetic tests or the current held-out split without its provenance and independent leakage review.

### Blockers to credible parity and model evaluation

- Original feature-generation code for the two source tables, table schemas/units, row IDs, labels, dataset provenance/licenses, and mapping from rows to source documents.
- The exact Python, PyMuPDF, pandas, scikit-learn, LightGBM, and PyArrow versions/environment used to make the tables and train/export the committed model.
- A rights-cleared, locally available, representative labeled PDF set with enough independent samples for useful false-positive and false-negative confidence intervals.
- The prior stratified random split has no saved IDs or grouping. Its metrics cannot be audited for duplicate/source leakage from repository artifacts alone.
- Python is not installed in the current execution environment; the reference manifest and PyMuPDF comparison could not be run here.

## Validation and change boundaries

The evaluation harness is independent tooling. It does not write model files or affect app code paths. The production PDF scanner, 0.5 threshold, inference/shrinkage behavior, feature order, verdict mapping, SAFE-only client/server upload gate, encryption, sharing, and secure search were not changed. No model was retrained, no sample or dataset was downloaded, and no external PDF was uploaded.

Synthetic test results must be reported only as harness behavior. This repository still does not establish real-world PDF model accuracy or training/application feature parity.
