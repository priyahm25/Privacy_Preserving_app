# PDF page-count counterfactual impact

## Training-time provenance

**Training-time page-count extractor: UNKNOWN. Training-time page-count definition: UNKNOWN.**

Evidence reviewed:

- `ml/pdf-malware/training/train_pdf_model.py` loads `PDF_All_features.csv` and `PDFMalware2022.parquet` as already prepared tables. It selects the CSV `page_count` column and renames the Parquet `Pages` column to `page_count`. It performs numeric coercion and median imputation, but does not open PDFs or call a feature extractor.
- `ml/pdf-malware/pdf_features.py` defines a separate helper that sets `page_count = len(doc)` using PyMuPDF. The training script does not invoke this helper, so it is not evidence of how either table's values were produced.
- Git history shows the training script, helper, model, and feature tables arriving together in commit `7dd33bc`. The later PDF-helper change in `f8dba63` concerns embedded-file counting; no earlier training-table generation pipeline or page-count lineage was found in available history.
- The CSV header and training script identify the input columns, but no extraction manifest, row-level source mapping, generation log, pinned extractor environment, or dataset metadata describing how `page_count`/`Pages` were computed was found. The Parquet table's source-generation provenance is not established by its filename or column name.

Accordingly, the helper's parsed-document count is a plausible intended meaning, but attributing that implementation to the training data would be a guess. Training-time extractor and definition remain **UNKNOWN**.

## Counterfactual method

- Matched all 14 evaluated PDF contents locally to the saved evaluation rows using SHA-256 internally; hashes and local identifiers are omitted here. No file names, paths, PDF content, or document metadata are included.
- Re-extracted the existing 24-feature vector with the current app extractor. All vectors matched the saved evaluation features, and current model probabilities reproduced the saved scores exactly (maximum absolute difference 0).
- For the candidate only, replaced `page_count` with PDF.js 4.10.38 `document.numPages`. The other 23 features were held constant. Both scores use the bundled current model, current inference implementation, and the existing 0.5 threshold.
- PDF.js parsed all 14 PDFs. This is a one-feature counterfactual, not a retraining or accuracy evaluation.

## Per-sample results

Rows are numbered in the evaluation JSON order. They are pseudonymous row numbers only; no file identifiers are included.

| Sample | Existing page_count | PDF.js page_count | Existing score | Candidate score | Existing verdict | Candidate verdict |
|---:|---:|---:|---:|---:|---|---|
| 1 | 64 | 64 | 0.42476381 | 0.42476381 | SAFE | SAFE |
| 2 | 58 | 58 | 0.41743264 | 0.41743264 | SAFE | SAFE |
| 3 | 1 | 1 | 0.44394026 | 0.44394026 | SAFE | SAFE |
| 4 | 1 | 1 | 0.58215666 | 0.58215666 | MALICIOUS | MALICIOUS |
| 5 | 2 | 2 | 0.46494232 | 0.46494232 | SAFE | SAFE |
| 6 | 1 | 1 | 0.50457828 | 0.50457828 | MALICIOUS | MALICIOUS |
| 7 | 93 | 93 | 0.44561907 | 0.44561907 | SAFE | SAFE |
| 8 | 24 | 24 | 0.46583239 | 0.46583239 | SAFE | SAFE |
| 9 | 1 | 1 | 0.50457828 | 0.50457828 | MALICIOUS | MALICIOUS |
| 10 | 59 | 59 | 0.61282010 | 0.61282010 | MALICIOUS | MALICIOUS |
| 11 | 0 | 22 | 0.45237368 | 0.41934713 | SAFE | SAFE |
| 12 | 24 | 24 | 0.60935830 | 0.60935830 | MALICIOUS | MALICIOUS |
| 13 | 1 | 1 | 0.45187069 | 0.45187069 | SAFE | SAFE |
| 14 | 1 | 1 | 0.46046797 | 0.46046797 | SAFE | SAFE |

## Results and limitations

- Page counts differed in 1 of 14 samples. Its score decreased by approximately 0.03302655 when the candidate page count was used.
- Scores were unchanged for the other 13 samples. No sample crossed the existing 0.5 threshold; the verdict changed for 0 of 14 samples.
- All 14 PDFs were independently identified by the user as benign. Five remain MALICIOUS under both feature inputs. This small, user-selected set cannot measure general false-positive rate, model quality, or effects on malicious PDFs.
- Only one feature was changed. The candidate does not establish training parity, and no inference/tree behavior, model, threshold, production extractor, scanner verdict logic, or upload gate was changed.
- A score remaining on the same side of 0.5 in these 14 cases does not prove that changing the production feature is compatible or harmless on other files.

## Recommendation

Gather more evidence before changing the production extractor. Obtain the original table-generation pipeline or authoritative dataset documentation for the `page_count`/`Pages` columns, then compare both candidate definitions on a representative, labeled PDF set and review score changes. Keep the current production behavior until that compatibility question is resolved.

No production code was changed for this counterfactual.
