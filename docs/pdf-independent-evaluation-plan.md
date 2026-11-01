# Independent PDF evaluation dataset plan

## Purpose and current evidence

This plan is for an independent, rights-cleared evaluation of the current PDF scanner and a careful follow-up of the five false positives among the 14 PDFs the user identified as benign. It does not authorize a production change or model tuning.

The repository reports establish:

- The checked-in training script consumes `PDF_All_features.csv` and `PDFMalware2022.parquet` as feature tables. Their original source, licenses, row-level provenance, label process, and feature-generation pipeline remain unknown. They are not a valid held-out evaluation set. See [training provenance findings](pdf-training-provenance-findings.md) and [next validation plan](pdf-next-validation-plan.md).
- The 14-PDF local set has user-provided benign labels, five current `MALICIOUS` predictions, and no verified disjointness from training. The page-count counterfactual changed one score but no verdict at 0.5. This is a diagnostic challenge set, not an independent performance estimate. See [false-positive comparison](pdf-benign-false-positive-comparison.md) and [structure verification](pdf-structure-verification.md).
- The existing project documentation does not identify a specific external PDF evaluation corpus with verified rights, source provenance, label methodology, and training-set separation. The PDF training requirements file is empty; the app declares `pdfjs-dist` 4.10.38 for parsing, not an evaluation dataset. No corpus should be treated as cleared based on those dependencies.

**Verified data source status:** no qualifying independent source is currently documented. The training feature tables are training inputs with unresolved provenance; the 14 local PDFs are a user-labeled diagnostic set with unresolved rights and training overlap. Other possible sources are unverified and are intentionally not named here.

## Minimum dataset and clearance requirements

Before any sample is admitted, record evidence for each requirement below. A source is not cleared if the only evidence is public downloadability, a software repository license, or a dataset aggregate license that does not cover the underlying PDFs.

| Requirement | Evidence to retain |
|---|---|
| Independent labels | Labels and rationale established without viewing this model's prediction. Benign and malicious require separate explicit adjudication rules. |
| Source provenance | Owner, canonical source/release/version, acquisition date, source record identifier, and any transformation history. |
| Permitted evaluation use | Primary terms/license/permission that covers local scanning, storage for evaluation, reporting aggregate metrics, and retention of the minimum manifest. Record attribution, non-commercial, share-alike, privacy, and redistribution conditions separately. |
| Underlying document rights | Verify the rights for the PDF items themselves, not only the dataset wrapper or source-code repository. Identify embedded third-party content or personal data restrictions. |
| Training separation | Compare against training manifests or source IDs under the relevant permissions. Exact content deduplication alone cannot establish that related versions or source families are independent. If unavailable, mark separation **UNKNOWN**. |
| Structural coverage | Include ordinary and varied PDFs, including compressed object streams, incremental updates, object/xref streams, scanned and text PDFs, images, forms, encryption, attachments, and PDFs with no active actions. Coverage is descriptive; do not manufacture malicious labels from structural features. |
| Reproducibility | Freeze a manifest, label protocol, scanner/model artifact version, feature contract, threshold 0.5, and analysis script before the locked evaluation. Keep source files and any direct identifiers access-controlled. |

## Proposed initial protocol

### Pilot size and composition

Start with a **pilot of 100 benign and 100 malicious PDFs**, if rights-cleared, independently labeled material is available. Keep the two groups separately sampled and reported. This is a practical smoke-test and error-analysis set, not a claim of representative prevalence or general performance. Include the existing 14 user-identified benign PDFs only as a separate challenge cohort if their owners authorize evaluation and the documents can be independently reviewed; do not merge them into the primary cohort or claim they are training-disjoint.

Within each group, document source and structural strata before selection. The benign set should cover ordinary business, academic, public-information, scanned, image-heavy, forms, and structurally varied documents. Include benign PDFs that contain security terminology, quoted attack strings, JavaScript documentation, code examples, or inert action markers as hard negatives. The malicious set should cover independently confirmed malicious behavior or intent and relevant PDF delivery/active-content forms; do not label a PDF malicious merely because it has JavaScript, an attachment, an action marker, or a high model score. Include benign counterparts with similar structures.

If 100 per group cannot be sourced with rights and labels cleared, run a smaller **workflow pilot** and explicitly treat all rates as exploratory. Do not fill gaps with model-generated labels or unverified public files.

### Labeling and adjudication

1. Write a label guide before review. Use `BENIGN`, `MALICIOUS`, `UNCERTAIN`, and `OUT_OF_SCOPE/UNREADABLE`; record threat/behavior category, evidence source, and rationale. Keep uncertain, corrupt, unsupported, encrypted-but-unreviewable, and scanner-error cases out of the binary accuracy denominator while reporting their counts and coverage separately.
2. Have two qualified reviewers independently label each candidate without seeing model scores, predictions, or feature vectors. For malicious labels, require a cited source analysis or independently reproducible, documented static evidence under a defined rule. Do not execute samples as part of ordinary labeling. Escalate disagreements to a third reviewer; retain original votes and adjudication rationale.
3. For benign labels, record a credible source or content-owner confirmation and a review sufficient to rule out the threat scope. “Opens normally,” a benign filename, or a single antivirus clean result is insufficient by itself.
4. After labels are locked, run the scanner once with the current model and fixed threshold 0.5. Preserve scanner outcomes as `SAFE`, `MALICIOUS/POTENTIAL THREAT`, `MALFORMED`, `UNSUPPORTED`, or `SCAN ERROR`; do not convert failures to SAFE. Report coverage and each non-binary outcome separately.

### Duplicates, split control, and manifest

- Before assigning any evaluation cohort, compute exact-content hashes locally and collapse byte-identical copies to one sample. Keep the duplicate-group relationship in the restricted manifest.
- Detect near-duplicates using documented, deterministic methods such as normalized rendered/text fingerprints and structural similarity. Manually review clusters; keep every version of a document, campaign, template, or source-family cluster in one cohort. Do not let near-duplicates cross development and locked-test groups.
- Establish an evaluation-only development subset for protocol/tool debugging and a locked test subset held by a separate custodian. The model, threshold, feature extraction, and outcome rules must not be adjusted after viewing locked-test outcomes. If the purpose is strictly evaluation of the frozen current model, both subsets remain evaluation-only and neither is used for training or threshold selection.
- Keep a private, access-controlled manifest with pseudonymous sample ID, content digest, duplicate/near-duplicate group, source record and version, acquisition date, rights evidence reference, label votes/adjudication, rationale reference, structural strata, cohort assignment, scanner version, and outcome. Keep original filenames/paths in a separate restricted custody index only if operationally necessary.
- Reports should contain aggregate counts and rates only. Do not publish document contents, local paths, original filenames, personal metadata, or raw hashes. A sanitized manifest can use pseudonymous IDs and rights-safe source references; the restricted digest enables later integrity checks.

## Predefined metrics

Freeze these before the locked run and compute exact binomial confidence intervals (95%) for rates. Report numerators and denominators, not percentages alone.

| Metric | Definition / reporting |
|---|---|
| Benign false-positive rate | Labeled benign items predicted `MALICIOUS/POTENTIAL THREAT` divided by all labeled benign items with a completed binary assessment. Report Wilson or exact binomial 95% interval and subgroup rates. |
| Benign SAFE rate | Labeled benign items returning `SAFE` divided by all labeled benign items; report malformed, unsupported, and error outcomes separately so they cannot disappear from coverage. |
| Malicious recall / false-negative rate | Labeled malicious items predicted threat / labeled malicious items with completed binary assessment; report false negatives and confidence interval. A `SAFE` verdict is a false negative. |
| Precision / positive predictive value | True malicious predictions divided by all malicious predictions, with caveat that a deliberately balanced pilot does not estimate real-world prevalence or deployment precision. |
| Confusion matrix | Show benign/malicious versus SAFE/threat for binary-completed samples; add separate columns/counts for malformed, unsupported, and scan error. |
| Coverage and failure rate | Fraction receiving a binary verdict; separately report unsupported, malformed, and inference/scan error by label and structural stratum. |
| Structural and source-stratum performance | Report per predeclared strata only when denominators are shown; avoid overinterpreting tiny subgroups. |

With 100 benign samples, even zero observed false positives yields an approximate one-sided 95% upper bound near 3% (the exact interval must be calculated). Small pilots therefore cannot establish a low production false-positive rate. A 100/100 balanced set also cannot establish deployment precision, broad malicious-threat recall, or robustness to future distributions. Larger, independently sourced locked sets and ongoing drift monitoring would be needed for general claims.

## Clearance checklist and blockers

For every candidate source, use a row in a source register with: exact name/version; official owner documentation; underlying PDF rights; evaluation/storage/analysis permission; commercial and redistribution permission recorded separately; attribution/share-alike/non-commercial conditions; privacy constraints; source and label provenance; structural coverage; duplicate policy; and training overlap status. Status values should be `CLEARED FOR INTERNAL EVALUATION`, `CONDITIONAL`, or `NOT CLEARED`, with links to primary evidence and a named unresolved question. Do not infer clearance for training or model-weight distribution from permission to evaluate PDFs.

Current blockers:

- No already documented external corpus meets the clearance and label evidence requirements.
- The two local training tables cannot serve as independent test data and lack upstream provenance.
- The 14-PDF benign challenge cohort has no documented independent dual-review process, rights record, or verified training separation.
- No label adjudication record or source manifest is present for the original model data.

## Next actions, in priority order

1. Recover the original training source manifest and row-level identifiers if possible, so evaluation candidates can be checked for overlap without assuming source independence.
2. Identify candidate PDF corpora through their owners' primary documentation. Do not acquire samples until dataset-level and underlying-document rights, privacy restrictions, labels, source versions, and evaluation permissions are confirmed in writing or explicit terms.
3. Obtain a written evaluation-only permission record where public terms do not clearly cover underlying PDFs, local storage, scanner processing, and aggregate reporting. Keep evaluation permission separate from redistribution or training/model permissions.
4. Draft and pilot the label guide with two reviewers on a small rights-cleared sample; refine disagreements before selecting the locked set.
5. Build the private manifest, deduplicate and cluster by source/document family, predeclare strata and metrics, then freeze the current scanner/model/threshold and evaluate once.
6. Review false positives by aggregate feature/outcome patterns and independently reviewed document categories. Do not change the extractor, model, threshold, or verdict policy based only on this pilot; propose any change separately with compatibility evidence and regression tests.

No evaluation files were acquired, no model was run or trained for this plan, and no production code or upload gate was changed.
