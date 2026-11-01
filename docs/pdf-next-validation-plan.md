# PDF model: provenance and next validation plan

**Scope:** read-only review of repository artifacts and recorded local evaluation results. No datasets or PDFs were downloaded or executed. No production behavior was changed.

## 1. Training provenance findings

### Finding: exact training-time feature generation is UNKNOWN

**Confidence: high** that the exact feature-generation process cannot be recovered from the available repository evidence.

- `ml/pdf-malware/training/train_pdf_model.py` reads two already-prepared feature tables: `PDF_All_features.csv` and `PDFMalware2022.parquet`. It selects 24 columns, renames the Parquet `Pages` column to `page_count`, converts values to numeric, imputes missing values with combined-table medians, maps labels, and fits the classifier. It does not open PDF files or call a feature extractor.
- The CSV header includes `page_count`, a numeric `label`, many additional engineered columns, and a `file_path` field. The path-like values do not establish document identity, extraction implementation, label review, licensing, or reproducible provenance. No row-to-document manifest was found.
- The training script maps the Parquet `Class` values `Benign` and `Malicious` to 0 and 1. This confirms the code's mapping only; it does not verify the source labels or their methodology.
- `ml/pdf-malware/pdf_features.py` is a separate PyMuPDF helper. Its `page_count = len(doc)` is parsed-document behavior, but the training script does not invoke it. It therefore cannot be attributed to the CSV or Parquet values.
- Git history shows the tables, helper, model, and training script were added together in commit `7dd33bc`. The available later change `f8dba63` changes embedded-file handling in the helper, not table generation or page counting. No deleted or renamed feature-generation file was found in available history or branches.
- No PDF training notebook, dataset manifest, extraction log, pinned PDF-extraction environment, row-level source mapping, dataset license/label card, or model-training metadata documenting feature extraction was found. The training requirements file is empty. Python is not installed in the current environment, so the Parquet footer/schema metadata could not be independently inspected; the training script reveals the column names it expects but no more lineage.
- The bundled model records its feature names/order and tree data, not source-document IDs or feature-generation provenance.

**Specific `page_count` status: UNKNOWN.** The repository helper uses PyMuPDF's parsed document length. The app currently counts visible `/Type /Page` spellings. The actual CSV and Parquet row-generation definitions are undocumented. Similar feature column names and the existence of the helper are not proof that it generated either table.

### What is established about current local PDFs

The existing reports record 14 locally matched PDFs identified by the user as benign, with five `MALICIOUS` outputs at the current threshold. Replacing only the current `page_count` with PDF.js's parsed page count changed one score from 0.45237368 to 0.41934713; no score crossed 0.5 and no verdict changed. The other 13 scores were unchanged. This is a counterfactual on a small user-selected set, not an accuracy estimate, and it does not establish that the evaluation samples are disjoint from the training data.

## 2. Local datasets and artifacts

| Artifact | What is verified | Evaluation suitability / unresolved issues |
|---|---|---|
| `PDF_All_features.csv` | Present and consumed by training; header has `page_count`, numeric `label`, engineered feature columns, and a `file_path` field. | Training input, not a standalone PDF evaluation corpus. No source manifest, license/permission record, label methodology, exact extraction pipeline, or linked source PDFs were found. |
| `PDFMalware2022.parquet` | Present and consumed by training; script expects `Pages` and `Class`. | Training input, not an independent evaluation set. Dataset provenance, label methodology, licensing, exact feature generation, and Parquet metadata remain unverified here. |
| `pdf_malware_model.joblib`, `pdf_features.joblib`, and bundled `pdf.json` | Model artifacts and feature schema are present. | Model artifacts do not establish training-row provenance, extraction semantics, or external evaluation quality. |
| 14-PDF local evaluation results | Existing evaluation has 14 user-identified benign inputs and saved features/scores; exact bytes were previously matched and parsed locally. | User identification is not an independent labeling protocol. No malicious evaluation set, source/usage permissions, or verified separation from training records is available. The set is too small and narrow for general performance claims. |

The training CSV and Parquet must not be reused as a held-out evaluation set: they are direct training inputs in the checked training script. The current 14-PDF set's disjointness from those inputs remains **UNKNOWN** because row-level source mappings and source files are unavailable.

## 3. Potential external evaluation sources

No specific external PDF evaluation corpus with verified license, source provenance, labeling methodology, structural coverage, and training-set separation is documented in the repository. Prior project notes recommend obtaining a rights-cleared institutional or research corpus, but do not name or clear a particular source.

The training input named `PDFMalware2022` is not cleared as an evaluation source: it is used for training, and its license, label provenance, row-level sources, and feature-generation procedure are unresolved. Public availability or a dataset name is not permission or evidence of independent labels.

## 4. Recommended next steps, in priority order

1. **Recover provenance before changing features.** Request or locate the original CSV and Parquet generation scripts, exact upstream dataset releases, source/row mapping, label definitions and review process, license/permission evidence, and pinned extraction/runtime versions. Record explicitly which evidence applies to each table.
2. **Establish evaluation rights and independence.** Select a separately sourced, rights-cleared corpus. Confirm permission for local analysis and model evaluation. Exclude training data and exact/near duplicates; if overlap cannot be ruled out, label independence UNKNOWN and do not call the result held out.
3. **Build a representative, inert fixture set.** Include independently verified benign ordinary documents, image-only/scanned PDFs, varied generators and metadata, forms/actions, encrypted and unencrypted PDFs, incremental updates, xref streams, compressed object streams, and malformed-but-parseable cases. Include confirmed malicious samples from a permitted source without executing them. Preserve uncertain labels instead of forcing binary ground truth.
4. **Validate labels independently.** Keep source provenance and evidence per item; have at least two qualified reviewers label independently, adjudicate disagreements, and retain an `uncertain` category. Do not use SecureSphere predictions or the current threshold as label evidence.
5. **Lock splits before comparing.** Deduplicate exact bytes; group revisions, templates, campaigns, and near-duplicates before splitting by source/group into development and locked evaluation sets. Keep the locked set untouched until acceptance criteria are declared.
6. **Run a pinned feature and model comparison.** Compare the current app extractor against the recovered training extractor on the same permitted PDFs. If the original extractor cannot be recovered, compare candidate definitions and mark training parity unresolved. Report all 24 feature differences, score/verdict deltas at the unchanged 0.5 threshold, per-class confusion counts, false-positive and false-negative rates, and uncertainty intervals.

## 5. Criteria before any production feature-extraction change

A production change should wait until all of the following are met:

- The training-time definition is supported by the original generation code or authoritative source documentation. If it cannot be established, explicitly treat the proposed extractor as a new feature contract; do not claim backward parity, and require separately versioned model validation/retraining before relying on it.
- Parser behavior is tested on valid ordinary PDFs, compressed object streams, xref streams, page-tree edge cases, encrypted files, and malformed inputs. Failures remain explicit errors; they never produce a fabricated page count or SAFE verdict.
- The exact candidate extractor and its runtime are verified on every supported app platform, with deterministic feature ordering and no plaintext sent off-device.
- A rights-cleared, independently labeled, source-disjoint locked evaluation reports per-class metrics and score/verdict changes with sample sizes and uncertainty. Acceptance limits are declared before inspecting locked results; no threshold lowering or upload-gate relaxation is allowed.
- Regression tests, workspace typecheck, scanner behavior checks, and review of all affected model inputs pass. Any material input-distribution change is evaluated with the unchanged model and, if necessary, a separately versioned and validated model rather than hidden by a heuristic override.

Until these criteria are satisfied, keep the current extractor, model, threshold, verdict handling, and fail-closed upload gate unchanged.
