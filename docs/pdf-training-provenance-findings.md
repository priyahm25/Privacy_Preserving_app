# SecureSphere PDF training provenance findings

**Scope:** Local repository and the existing PDF evaluation workspace were inspected for the training feature tables and evidence of their provenance. No datasets were downloaded, no model was trained, and no production behavior was changed.

## Finding

**Overall status: PARTIALLY VERIFIED.** The repository contains two feature tables that the checked-in training script explicitly loads, along with a compatible feature-order artifact and trained model files. This verifies the repository's declared training inputs and the script's transformations. It does not establish the tables' upstream origin or how their feature values and labels were generated. In particular, the training-time `page_count` definition is **UNKNOWN**.

The exact 24 model features are verifiable from `ml/pdf-malware/training/train_pdf_model.py` and the bundled model metadata. The script reads feature values already present in the tables; it does not parse PDFs or call an extractor. Similar feature names in another script or table therefore do not establish extraction parity.

## Artifact inventory

| Relative path | File type / role | Original or derived status | What is verified | Missing provenance |
|---|---|---|---|---|
| `ml/pdf-malware/dataset/PDF_All_features.csv` | CSV feature table | Checked-in training input; upstream originality not established | The training script reads it and selects 24 common feature columns plus its numeric `label` column. Its header includes a path-like source field and additional features beyond the selected 24. | Source dataset/release, row-to-PDF mapping, source label meaning and review, feature-generation code, units, and `page_count` definition. |
| `ml/pdf-malware/dataset/PDFMalware2022.parquet` | Parquet feature table | Checked-in training input; upstream originality not established | The training script reads it, renames `Pages` to `page_count`, selects the 24 common features, and maps `Class` values `Benign` and `Malicious` to 0 and 1. | Dataset owner/release, source documents, label methodology, feature-generation code, exact page-count semantics, and row-level lineage. The local environment has no Python installation for inspecting Parquet footer metadata. |
| `ml/pdf-malware/training/train_pdf_model.py` | Python training script | Original checked-in training code for the repository workflow; execution/run binding not independently proven | It concatenates the two prepared tables, coerces selected features to numeric, imputes missing feature values using combined-table medians, drops missing labels, performs a stratified 80/20 random split (`random_state=42`), fits LightGBM, and saves a model plus feature-name list. It never opens PDF files or invokes `pdf_features.py`. | Run log, exact package environment, split membership, source table versions, output-to-input binding, and provenance of prepared columns/labels. |
| `ml/pdf-malware/pdf_features.py` | Python PDF feature helper | Separate helper; not verified as the table generator | It uses PyMuPDF and assigns `page_count = len(doc)`. Git history shows a later helper edit changed embedded-file handling. | No call site in the training script or record connects this helper to either table. Its page-count definition cannot be attributed to training. |
| `ml/pdf-malware/requirements.txt` | Dependency file | Training environment declaration | The file is empty. | Python, PyMuPDF, pandas, scikit-learn, LightGBM, and Parquet reader versions used for table preparation and model training. |
| `ml/pdf-malware/models/pdf_features.joblib` | Serialized feature-name list | Generated/export artifact by the training script's stated save path; exact run linkage not proven | The training code saves the selected feature order here. The PDF model metadata also records the 24 feature names/order. | Run ID or manifest binding this file and model weights to exact input table versions and extraction provenance. |
| `ml/pdf-malware/models/pdf_malware_model.joblib` | Serialized LightGBM model | Trained-model artifact; exact input/run linkage not proven | The training script saves a fitted model at this path. The artifacts were introduced alongside the script and tables in Git. | Training log, model metadata, source table fingerprints/version identifiers, and extraction/label lineage. |
| `ml/convert_to_json.py` and `artifacts/securesphere/assets/models/pdf.json` | Model conversion code and bundled JSON model | Derived deployment representation | The converter loads the joblib model and feature list, serializes tree data and feature order, and writes the app JSON model. | This conversion chain does not carry dataset or feature-generation provenance. |
| Existing local PDF evaluation files | Evaluation JSON/CSV/report and local PDF samples | Derived diagnostic artifacts, not training feature tables | The evaluation JSON describes the current model, feature names, threshold, sample count, and prediction rows. The local CSV differs in size and header from the training CSV and contains evaluation fields. | They do not establish training membership, source labels, or table-generation history. The locally matched benign PDFs are not evidence of training-data provenance. |

## Git and local artifact search

- The available refs are `main`, `origin/main`, and `backup/main`; no tags were present.
- Available history shows the two feature tables, training script, helper, feature list, and model added together in commit `7dd33bc` (`Complete SecureSphere secure upload and sharing`). The only later PDF-helper edit found is `f8dba63`; it changes helper behavior, not a table-generation pipeline. No deleted or renamed PDF feature-generation script, notebook, or manifest was found in the available history.
- The feature tables' presence in that commit and use by the training script support their role as the repository's intended inputs. They do not prove that the checked-in model was produced by a recorded execution of that script against those exact bytes.
- The targeted local evaluation workspace contains evaluation outputs and PDF samples, not a second copy of the training Parquet table or a training notebook/script. Its CSV is not byte-identical to, and has a different header/size from, the training feature table.
- No separate dataset manifest, source/license card, extraction log, row-level document mapping, training notebook, or saved training report was found in the inspected project locations.

## Feature and label provenance conclusions

| Question | Status | Evidence and boundary |
|---|---|---|
| Which 24 features and in what order did repository training code select? | **VERIFIED** | `common_features` in `train_pdf_model.py`; model feature-order metadata agrees. This verifies the code contract, not upstream feature semantics. |
| What did training code do with CSV `page_count`? | **VERIFIED** | It selected the numeric table column and passed it through numeric coercion and median imputation. No PDF parser is called. |
| What did training code do with Parquet `Pages`? | **VERIFIED** | It renamed `Pages` to `page_count`, then applied the same common-feature numeric preparation. |
| How was either table's page count measured? | **UNKNOWN** | No source-generation script, notebook, manifest, dataset documentation, or row-level extraction record connects either field to a parser or definition. |
| Did the PyMuPDF helper generate the training values? | **UNKNOWN; no evidence found** | The helper uses `len(doc)`, but the training script does not import or call it. A matching feature name is insufficient evidence. |
| What are the actual source datasets and versions? | **UNKNOWN** | Filenames and the training code's `PDFMalware2022` label map are not authoritative source or version records. No source URL/manifest was found. |
| How were labels assigned and independently reviewed? | **UNKNOWN** | The script passes through CSV numeric labels and maps Parquet class strings. It contains no label-generation, adjudication, or source-label validation process. |
| Which exact training run produced the committed model? | **PARTIALLY VERIFIED** | The training script writes the committed artifact paths and the model/table/script arrived together in Git. No run log or manifest binds those weights to exact input revisions, environment, or split membership. |

## Exact evidence still needed

To move from partial to verified provenance, recover the original training-run bundle or an authoritative record containing:

1. The upstream dataset names, owner/source URLs, release/version, and the exact downloaded source files used.
2. The table-generation scripts/notebook and preprocessing steps, including code that defines `page_count`/`Pages` and the generation environment/package versions.
3. A row-level mapping from each feature row to its source document and source label, with documented label definitions and any review/adjudication process.
4. A run record that ties exact versions of both feature tables, the training script, dependencies, train/test split, and resulting model/feature-order artifacts together.
5. Any license or permission record governing use of the underlying datasets and redistribution of the resulting model.

Do not infer a source URL from a table name or path-like column. Do not infer the extractor from `pdf_features.py`. If the original notebook, scripts, or run bundle cannot be recovered from the training owner or original project archive, retain training-time feature and label provenance as **UNKNOWN** and treat any future extractor change as a new, unverified input contract requiring separate validation.

## Most efficient next action

Request the original training notebook or source archive from the person/environment that produced commit `7dd33bc`, together with the two table-generation scripts, source dataset release records, and training stdout/run metadata. Ask specifically for the code that created the CSV `page_count` and Parquet `Pages` columns and the exact table/model versions used in the saved run. If that bundle is unavailable, stop claiming parity and proceed only with a separately documented, labeled validation plan; do not silently substitute the current PyMuPDF helper.
