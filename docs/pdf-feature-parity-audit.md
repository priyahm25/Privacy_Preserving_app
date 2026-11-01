# SecureSphere PDF Feature Parity and False-Positive Validation Audit

**Checked:** 2026-10-27
**Scope:** read-only model/data inspection, code audit, and locally reproducible regression tests. No PDF sample or dataset was downloaded. No model, threshold, upload policy, or database was changed.

## Summary

- The bundled PDF model exists at `artifacts/securesphere/assets/models/pdf.json`; it has 24 ordered features and 300 trees. The serialized tree shrinkage values are `1` for the first tree and `0.05` for the remaining 299. Current `lgbmPredict` multiplies every tree value by its serialized shrinkage. That historic inference correction is preserved.
- `train_pdf_model.py` trains on two feature tables (CSV and Parquet), maps their column names into a shared 24-column matrix, converts values to numeric, and imputes missing training values with each combined feature's median. It uses LightGBM's default binary decision threshold (0.5) when it calls `model.predict`. The script does not generate most training features from PDF bytes. The source, exact feature-generation procedure, and provenance of the CSV/Parquet values are not documented in the repository.
- The standalone `pdf_features.py` helper uses PyMuPDF for document-derived values and raw Latin-1 substring counts for structural keywords. The app uses raw bytes for every PDF feature. Only the byte size and the raw substring features match that helper by implementation. PyMuPDF documents page count, document metadata, encryption state, and page-referenced images as parsed document APIs ([Document API](https://pymupdf.readthedocs.io/en/latest/document.html), [Page API](https://pymupdf.readthedocs.io/en/latest/page.html)).
- The app's recent page-count fix is present and tested: it excludes `/Pages` while counting `/Page` dictionary spellings. It is more accurate for ordinary visible object syntax than the old prefix count, but still is not equivalent to parsing the page tree (for example, objects may be compressed in object streams or represented with other valid syntax).
- The repo contains no PDF files or PDF-specific evaluation report. The CSV and Parquet files are feature data, not sample PDFs. No Python runtime is installed in this environment (`py` reports no installed Python), so the original extractor and `.joblib` model could not be run for a differential comparison. No false-positive or false-negative rate can be measured here.
- No further feature correction is made. The remaining metadata, image, encryption, embedded-file and page-tree differences cannot be safely calibrated against the model without the original feature provenance and labeled PDF fixtures. The app remains fail-closed unless the current model returns explicit `SAFE`; this audit does not establish that a passing PDF is safe in general.

## Model and inference path reviewed

The model feature order is exactly:

1. `file_size`
2. `metadata_size`
3. `page_count`
4. `title_chars`
5. `encrypted`
6. `embedded_file_count`
7. `image_count`
8. `object_count`
9. `endstream_count`
10. `stream_count`
11. `xref_count`
12. `trailer_count`
13. `startxref_count`
14. `objstm_count`
15. `js_count`
16. `javascript_count`
17. `aa_count`
18. `openaction_count`
19. `acroform_count`
20. `jbig2decode_count`
21. `richmedia_count`
22. `launch_count`
23. `xfa_count`
24. `colors_count`

The JSON names and order match `common_features` in `ml/pdf-malware/training/train_pdf_model.py`. The conversion script serializes each tree's `shrinkage`; current inference applies it before the sigmoid. The app supplies `fileBytes.byteLength` for `file_size` and does not use the picker-reported size for model features. `buildFeatureVector` supplies zero for absent/non-numeric features. The current PDF extractor returns all 24 numeric fields, so that fallback is not normally used. During training, missing input values instead receive the median computed over the combined CSV and Parquet data. This is a contract difference if any feature is missing; the current extractor usually masks parser absence by returning a number, often zero.

The training script trains an ordinary `LGBMClassifier` and does not record a custom threshold. The scanner labels class-1 probability `>= 0.5` as `MALICIOUS`, otherwise `SAFE`. It has no additional count-of-findings override. A present finding such as JavaScript, a link, annotation, form or embedded object is a numeric model input, not a separate deterministic malware verdict.

## Feature-by-feature parity

“Training value” below distinguishes the model-training script from the standalone PyMuPDF helper. The training script loads the feature columns from the provided datasets; it does not recompute them from files. Thus code-level equivalence to `pdf_features.py` is not proof of parity with every dataset row used to train the model.

| # | Feature | Training value / expected type | App value / missing behavior | Parity and possible effect |
|---:|---|---|---|---|
| 1 | `file_size` | Dataset column is numerically coerced; standalone helper uses filesystem byte size. Non-negative byte count. | Actual `Uint8Array.byteLength`; numeric, no missing value. | **Matches standalone helper** when the same byte sequence is read. Dataset source units are not documented in this repo. |
| 2 | `metadata_size` | Dataset-provided numeric column; standalone helper measures UTF-8 byte length of `str(doc.metadata or {})`. Non-negative byte count. | Estimates from the `/Info <n> <gen> R` reference token, capped at 512; zero without that token. | **Mismatch.** Does not measure parsed metadata and misses XMP, encrypted/no-password metadata and values referenced through Info. Can shift model splits substantially. |
| 3 | `page_count` | Dataset-provided numeric column; helper uses `len(doc)`. Non-negative integer. | Counts raw `/Type /Page` spellings with a word boundary; zero when syntax is not visible. | **Partial after fix.** It no longer counts `/Pages` as `/Page`, but is not page-tree parsing and misses compressed/alternate object encodings. |
| 4 | `title_chars` | Dataset-provided numeric column; helper uses `len(metadata.get("title") or "")`. Non-negative character count. | Counts characters in the first literal `/Title (...)` match. | **Mismatch.** Does not decode PDF strings, escaped parentheses, hex/UTF-16 strings, XMP or parsed metadata. JS string length counts UTF-16 code units, unlike Python Unicode code points for astral characters. |
| 5 | `encrypted` | Dataset-provided numeric; helper uses `int(doc.is_encrypted)`. Binary 0/1. | Returns 1 if raw bytes contain exact `/Encrypt`, else 0. | **Mismatch.** A substring is not parsed encryption state; it can be inside arbitrary bytes/content and can miss nonstandard/encoded objects. |
| 6 | `embedded_file_count` | Dataset-provided numeric column. Standalone helper initializes to 0 and never calculates it, so that helper emits constant 0. Expected count is unclear across the two training datasets. | Counts exact `/EmbeddedFile` substrings in raw bytes. | **Unresolved mismatch.** It may count inert text or compressed content and may miss encoded/compressed object dictionaries. Do not replace with constant 0 until source feature semantics are established. |
| 7 | `image_count` | Dataset-provided numeric column; helper sums `page.get_images(full=True)` across pages. Non-negative integer count of image references returned per page. | Counts exact `/Subtype /Image` substrings in all raw bytes. | **Mismatch.** Counts unreferenced or textual occurrences, can miss spacing/encoding variations, and does not model repeated references per page. PyMuPDF documents `Page.get_images()` as returning images referenced by the page; this differs from counting image dictionary spellings. |
| 8 | `object_count` | Dataset-provided numeric; helper counts raw decoded substring `" obj"`. Non-negative integer. | Same byte-to-Latin-1-equivalent decoding and substring count. | **Matches helper string-count semantics**, including matches in streams and historical/incremental data; not equivalent to active PDF object count. |
| 9 | `endstream_count` | Dataset-provided numeric; helper counts raw `"endstream"`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; compressed/literal data can include the spelling. |
| 10 | `stream_count` | Dataset-provided numeric; helper counts raw `"stream"`. Non-negative integer. | Same exact raw substring count. | **Matches helper semantics**, including the `stream` substring within `endstream`; this is not a parsed stream count. |
| 11 | `xref_count` | Dataset-provided numeric; helper counts raw `"xref"`. Non-negative integer. | Same exact raw substring count. | **Matches helper semantics**, including `xref` within `startxref`; not a parsed xref-section count. |
| 12 | `trailer_count` | Dataset-provided numeric; helper counts raw `"trailer"`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; not a parsed trailer count. |
| 13 | `startxref_count` | Dataset-provided numeric; helper counts raw `"startxref"`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; not a parsed startxref count. |
| 14 | `objstm_count` | Dataset-provided numeric; helper counts raw `/ObjStm`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; not a count of successfully parsed object streams. |
| 15 | `js_count` | Dataset-provided numeric; helper counts raw `/JS`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; a token occurrence is an indicator, not proof of executable JavaScript. |
| 16 | `javascript_count` | Dataset-provided numeric; helper lowercases raw text and counts `/javascript`. Non-negative integer. | Lowercases the same byte-mapped string and counts `/javascript`. | **Matches helper string-count semantics**; not a parsed action/MIME-name count. |
| 17 | `aa_count` | Dataset-provided numeric; helper counts raw `/AA`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; may match non-keyword text. |
| 18 | `openaction_count` | Dataset-provided numeric; helper counts raw `/OpenAction`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; does not establish whether an action is active or harmful. |
| 19 | `acroform_count` | Dataset-provided numeric; helper counts raw `/AcroForm`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; ordinary forms can contain it. |
| 20 | `jbig2decode_count` | Dataset-provided numeric; helper counts raw `/JBIG2Decode`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; not a parsed filter count. |
| 21 | `richmedia_count` | Dataset-provided numeric; helper counts raw `/RichMedia`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; not proof of exploit behavior. |
| 22 | `launch_count` | Dataset-provided numeric; helper counts raw `/Launch`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; occurrence alone does not establish an invoked or malicious action. |
| 23 | `xfa_count` | Dataset-provided numeric; helper counts raw `/XFA`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; ordinary forms can use XFA. |
| 24 | `colors_count` | Dataset-provided numeric; helper counts raw `/ColorSpace`. Non-negative integer. | Same exact raw substring count. | **Matches helper string-count semantics**; ordinary graphics routinely use color-space declarations. |

The training stage applies numeric conversion and median imputation, but no feature scaling or normalization. The app emits integers in raw units. Its substring features reproduce the helper's raw occurrence logic for the 17 features in rows 8–24, but that does not establish how the training CSV and Parquet values were generated. Training's CSV includes additional fields (including `valid_pdf_header`, `text_length`, URI/action counts and other derived indicators) that are not model inputs; the selected 24 columns are a subset.

## Confirmed discrepancy and changes

The old app expression counted `/Type /Pages` because it searched for the `/Type /Page` prefix. The test in `scripts/src/scanner-regression.test.ts` constructs two page dictionaries plus a `/Pages` tree and verifies the app returns two pages. The current boundary-aware regex fixes that reproducible overcount for this syntax. This test is a safe controlled feature test, not a full valid-PDF, model-verdict or false-positive test.

The metadata-size and image-count differences are confirmed by comparing code, but their impact on true PDF model probabilities is **not measured**. Several other differences are similarly unmeasured. No new correction is made because current app dependencies do not provide a demonstrated cross-platform parser implementation matching the training extraction. `pdfjs-dist` is present for browser PDF text extraction, while native text extraction uses a local limited parser; neither has been validated against the training feature contract. Do not substitute a different parser's approximations without differential fixture results.

## Repository artifacts and evaluation availability

- No `.pdf` files, labeled PDF fixture directories, or PDF model evaluation report were found in the repository. Existing scanner tests include a small byte string for the page-count boundary case and tests for HTML/Office; there is no benign or malicious PDF model fixture.
- `ml/pdf-malware/dataset/PDF_All_features.csv` (about 4.5 MB) and `PDFMalware2022.parquet` (about 0.9 MB) exist and are consumed by training as features. The CSV header includes a `file_path` field and engineered features, but no PDF document bytes are included in those feature tables. The repository has no source/license manifest, row-level provenance, or locked evaluation split report for these inputs.
- `ml/pdf-malware/models/pdf_malware_model.joblib` and `pdf_features.joblib` exist. There is no installed Python runtime here (`py -c ...` reports no installed Python), so the original extraction, model loading, train/test evaluation, and direct comparison to the JSON model could not be run.
- No actual PDFs were examined. No benign/malicious sample count or confusion-matrix metric is available. The real-world false-positive and false-negative rates remain unknown.

## Safe evaluation plan

1. **Establish permissions and provenance before acquisition.** For each external benign or suspicious PDF source, record the exact release/version, source URL, license or written permission covering local analysis, redistribution to evaluators, and model evaluation. Do not assume that malware sample availability implies permission. Prefer a university/security-lab sample corpus with a written research-use grant or a dataset whose source owner explicitly authorizes this evaluation. Do not use SecureSphere users' private documents without consent and a privacy review.
2. **Create a representative benign development set.** Use consented or licensed reports, forms, scanned/image-only PDFs, image-heavy documents, ordinary metadata and titles, links, annotations, form fields, embedded attachments, and PDFs generated by common authoring/export tools. Keep source/authoring-tool and template identifiers. Include benign security documentation that discusses JavaScript/actions without treating keyword presence as malicious.
3. **Create suspicious/malicious samples with evidence.** Obtain inert samples from a permitted institutional threat corpus with a sample hash, source/date, analyst or publisher label, and evidence record. Record whether the label is confirmed malicious, suspicious/unresolved, or benign. Do not execute samples on developer machines; use isolated analysis infrastructure under the corpus owner's terms. A JavaScript, link, annotation, embedded file, or launch action alone is not ground truth.
4. **Use independent review.** Two qualified reviewers should label samples independently using static analysis and source evidence, resolve disagreements, and retain an `uncertain` label instead of forcing a binary answer. Preserve only the minimum evidence needed; never place private user data in regression fixtures.
5. **Prevent leakage.** Deduplicate exact files by cryptographic hash and near-duplicates by normalized object/content signatures. Keep document revisions, campaign/family samples, and outputs of the same generating template/tool in one group. Split by source and group into development/validation and a separately locked evaluation set; do not tune thresholds or feature behavior on the locked set.
6. **Run a reproducible differential.** In an isolated, pinned environment install only the already-declared training requirements and record Python, PyMuPDF, LightGBM, pandas and model versions. On each approved fixture run `pdf_features.py`, compare all 24 values against the app extractor, then run the same vectors through the `.joblib` model and JSON inference. Record all feature diffs, probabilities, verdicts and exceptions. Do not change the threshold to compensate for extractor mismatch.
7. **Report outcomes and uncertainty.** Report confusion matrix counts, false-positive rate among benign documents, false-negative rate among confirmed malicious documents, precision/recall, and two-sided 95% binomial intervals. Break out ordinary metadata, image-heavy/scanned, forms/annotations, links, embedded-file, encrypted, and producer/source groups. State sample sizes and avoid percentage claims when the relevant sample count is too small.

No target sample count is prescribed here: compute the required locked-test size from a predeclared false-positive-rate precision goal and available independent source groups. If permissions or enough representative labeled source groups are unavailable, leave the live false-positive rate explicitly unknown and keep the existing gate unchanged.

## Current safety behavior and remaining work

- Upload UI checks `isUploadScanApproved(result.verdict)` before encryption, then rechecks before upload. The helper returns true only for exact `SAFE`.
- API `/api/files/upload` independently rejects any scan value other than `SAFE` with HTTP 422. Client-side encryption, API gate and database were not changed in this audit.
- Valid `.txt` content remains `UNSUPPORTED / TEXT_SCANNER_UNAVAILABLE`; this audit does not enable TXT uploads.
- The next useful step is to obtain a small, rights-cleared set of actual benign and suspicious PDFs plus their provenance/labels, then run a pinned differential comparison. Until then, the page-count regression is fixed, but the general PDF false-positive issue is **not validated as resolved**.

## Work and verification record

- No PDF samples or datasets were downloaded.
- No model files, training data, thresholds, application code, upload gate, encryption, database schema, or dependencies were changed for this Phase 2 audit. The page-count implementation and test referenced above were already present in the worktree before this audit.
- Relevant scanner tests and type checks were run after the preceding page-count change; see the current task's final report for the results. This audit adds documentation only.
