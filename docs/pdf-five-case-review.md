# SecureSphere PDF five-case manual review

## Scope and handling

This is a preparation record for the five evaluation rows currently predicted `MALICIOUS`. It does not relabel them or change scanner behavior. Cases `F1`–`F5` are ordered by score ascending; ties retain evaluation JSON order. Local sample matching used evaluation content IDs internally, but this report contains no names, paths, hashes, contents, or personal metadata.

The evaluation JSON and CSV were compared internally: all 14 rows matched, with no score or verdict disagreements. All 14 rows matched local sample bytes; all five flagged PDFs parsed successfully in the existing PDF.js 4.10.38 static inspection. PDF.js was run with `isEvalSupported: false`; no document JavaScript was executed and no embedded file was opened or launched. Only structural presence/counts were collected. The static check did not inspect or publish action source text, attachment names/content, or personal metadata.

All five cases remain **UNCLASSIFIED — independent human review required**. The user identified the 14 PDFs as legitimate, but that identification is not an independent review of the documents' action/attachment behavior. Presence or absence of markers alone does not prove maliciousness or benignness.

## Per-case evidence

`metadata_size` below is the app's raw `/Info`-reference heuristic, not a parsed metadata byte size. `object_count` and app `image_count` are raw marker counts. PDF.js image paint-operation counts are an approximate, different concept and are not claimed as exact parity.

| Case | Model score / verdict | App features relevant to triage | PDF.js static evidence | Discrepancy and interpretation |
|---|---|---|---|---|
| F1 | 0.504578 / `MALICIOUS` | `page_count` 1; `metadata_size` 44; `object_count` 11; app `image_count` 0; `embedded_file_count` marker 2; JavaScript, AA, OpenAction, and Launch markers 0. | 1 page; no parsed JavaScript action or OpenAction; 1 parsed attachment; 0 image paint operations. | Page count and action-presence checks agree. The raw embedded marker count is higher than the parsed attachment count. No attachment content was opened, so its purpose and safety remain unknown. |
| F2 | 0.504578 / `MALICIOUS` | Same listed feature values as F1. | 1 page; no parsed JavaScript action or OpenAction; 1 parsed attachment; 0 image paint operations. | Same structural evidence as F1. The tied score and features do not establish that these are duplicate documents; content IDs are intentionally omitted. Attachment contents remain unreviewed. |
| F3 | 0.582157 / `MALICIOUS` | `page_count` 1; `metadata_size` 44; `object_count` 9; app `image_count` 0; no embedded-file, JavaScript, AA, OpenAction, or Launch markers. | 1 page; no parsed JavaScript action or OpenAction; no parsed attachment; 1 image paint operation. | Page count and action/attachment presence agree. The image marker count and paint-operation count differ, but measure different things. Absence of these markers does not establish that the PDF is benign. |
| F4 | 0.609358 / `MALICIOUS` | `page_count` 24; `metadata_size` 44; `object_count` 1030; app `image_count` 28; no embedded-file marker; `js_count` 1 and `javascript_count` 1; OpenAction marker 1; AA and Launch markers 0. | 24 pages; parsed JavaScript action present; no parsed OpenAction; no parsed attachment; 72 image paint operations. | Page count and JavaScript presence agree. The raw OpenAction marker was not confirmed as a parsed document OpenAction. Image counts are not directly comparable. Action code was not inspected; benign purpose versus harmful behavior remains unknown. |
| F5 | 0.612820 / `MALICIOUS` | `page_count` 59; `metadata_size` 44; `object_count` 1489; app `image_count` 109; no embedded-file marker; `js_count` 1 and `javascript_count` 1; OpenAction marker 1; AA and Launch markers 0. | 59 pages; parsed JavaScript action present; no parsed OpenAction; no parsed attachment; 221 image paint operations. | Same action-presence result as F4. Page count agrees. The app image marker count and PDF.js paint operations measure different concepts. Action code and document purpose remain unreviewed. |

### Model sensitivity checks (diagnostic only)

The following one-feature perturbations were run against the same bundled model. They show local model sensitivity, not causal attribution, a corrected feature vector, or a valid reclassification:

- F1 and F2: setting `embedded_file_count` from the app value 2 to the PDF.js attachment count 1 leaves the score unchanged at 0.504578. Setting it to 0 would lower the score below 0.5, but zero is not the parsed attachment count for these cases and is not a justified correction.
- F3: zeroing any one of the inspected nonzero features with the largest individual sensitivity did not move the score below 0.5.
- F4 and F5: setting `javascript_count` to 0 alone would lower the scores to approximately 0.428948 and 0.441332. PDF.js independently confirmed a JavaScript action in each, so that perturbation is unsupported as an extractor correction. Setting `openaction_count` to 0 alone lowers the scores to approximately 0.580091 and 0.584120; both remain above 0.5.

These perturbations change one input while holding all others fixed. They do not account for interactions among tree splits and must not be used to override a verdict. The per-tree split-path counts in the aggregate diagnostic likewise are not feature attributions.

## What this evidence establishes

- Saved app feature vectors for all five cases reproduce from the matched local bytes using the current app extractor. This establishes consistency between the saved evaluation and current extraction for these files, not semantic correctness of every feature.
- Current and PDF.js page counts agree for all five flagged cases. The known compressed-object-stream page-count miss occurred in a different, SAFE-predicted sample; it does not explain these five predictions.
- PDF.js confirms the JavaScript-action presence reported by raw markers in F4 and F5. It does not confirm an OpenAction in either case. A marker is not proof that an action is reachable, harmful, or benign.
- F1 and F2 each have one parsed attachment, while the app's raw `/EmbeddedFile` marker count is two. No content-level conclusion can be drawn without reviewing the attachment safely.
- F3 has no app JavaScript, OpenAction, or attachment markers, but still scores above threshold. Therefore those markers are not necessary to explain every flagged prediction.
- No direct feature attribution or trustworthy training-domain comparison is available. The training script consumes precomputed tables; the source data, label method, and training-time feature definitions remain unknown. The 14-document cohort is small and not verified as independent of training.

## Reviewer checklist

For each case, keep the reviewer record private and map the anonymized case to the local evaluation entry without copying filenames, paths, hashes, contents, action text, attachment names, or personal metadata into this report.

1. **Establish provenance and authorization.** Record an allowed source, owner/permission basis, document purpose, and any available independent security analysis. Do not treat the current model output as label evidence.
2. **Review statically and without execution.** In a controlled local environment, inspect PDF object/action relationships and JavaScript source strictly as data. Do not evaluate document code, open it in an active viewer, launch an attachment, or follow links. Record action type, reachability, trigger, and behavior in a restricted review log without copying payloads here.
3. **Review attachments separately.** For F1/F2, verify how the parsed attachment relates to the marker count and inspect it only with approved static tools. Do not extract-and-open it in a normal desktop workflow or execute it. If safe tooling/permission is unavailable, mark the case inconclusive.
4. **Check for exploit or deceptive behavior.** Determine whether any action or attachment performs a documented exploit, persistence, credential theft, unauthorized data access, or harmful delivery. A JavaScript action, attachment, image, object count, or marker by itself is insufficient.
5. **Use independent evidence.** Keep two independent reviewer decisions and evidence references; adjudicate disagreements with a third qualified reviewer. Preserve an `INCONCLUSIVE` outcome when source, behavior, or parser interpretation cannot be established.
6. **Do not infer safety from missing markers.** A no-marker result is only “these inspected checks did not find the listed structures.” It is not a guarantee the file is safe.

### Classification evidence standard

- **BENIGN:** documented source/purpose plus independent review finds the relevant code/actions/attachments serve legitimate behavior, with no unresolved suspicious payload or conflicting threat evidence. “Opens normally” or a clean single scanner result is insufficient.
- **MALICIOUS:** independently documented harmful behavior or intent supported by static analysis or reliable source-owner/threat-intelligence evidence. A model prediction or marker count alone is insufficient.
- **INCONCLUSIVE:** provenance is unavailable, action/attachment behavior is ambiguous, content cannot be safely inspected, reviewers disagree, or available evidence only confirms structure without intent/behavior.

## When a correction would be justified

- **Extractor correction:** establish a semantic mismatch for a named feature on the affected bytes using an independent parser or authoritative feature definition, verify that the candidate value is correct for the feature contract, test representative structures and parser failures, and assess all evaluation scores at the unchanged 0.5 threshold. Here, F1/F2's marker-count discrepancy does not change their scores when corrected to one parsed attachment; F4/F5's OpenAction discrepancy does not change their verdicts when that marker is removed; and page counts are correct in all five. Training-feature provenance is unknown, so even a confirmed semantic correction cannot currently be claimed compatible with model training.
- **Model/data correction:** if extraction is supported and independent review establishes these are benign, obtain rights-cleared, representative, independently labeled data with training overlap assessed, then evaluate a separately versioned model or other proposed change on a locked test set. Do not lower the threshold or use these five cases alone to retrain or tune.

No production scanner code, model, inference, threshold, or upload gate was changed. No PDF code or attachment was executed or launched.

## Reviewer-ready case questions

Keep answers and evidence references in a restricted case record keyed only by `F1`–`F5`. Do not add document text, original identifiers, paths, hashes, attachment names, or personal metadata to this report.

### F1

- **Questions:** What is the document's source and intended purpose? What is the single parsed attachment, and why does the raw marker count report two? Is the attachment expected for this document's purpose? Does it contain behavior or content that presents a concrete threat?
- **Evidence to record:** Source/owner evidence; static PDF object references connecting the attachment to the document; a separate static assessment of the attachment using approved tools; two independent reviewer rationales and confidence ratings. If the attachment cannot be inspected safely or its source cannot be established, classify `INCONCLUSIVE`.

### F2

- **Questions:** Answer the same questions as F1 independently. Do not assume the tied score or matching listed features means F1 and F2 are duplicates or share a source. Does the local duplicate/near-duplicate check establish a relationship?
- **Evidence to record:** Its own source and purpose evidence; its own attachment reference and static assessment; duplicate-cluster result in the restricted register; independent reviewer rationales and confidence. Do not reuse F1's label without evidence for F2.

### F3

- **Questions:** What is the document's purpose and source? What role does its image content play? Are there other suspicious structures or behaviors not represented by the listed markers? Does a safe, offline rendering or static view support the claimed purpose?
- **Evidence to record:** Source/owner evidence; a safe static structural review and, if appropriate, an offline render in an isolated viewer with active content disabled; relevant parser or independent threat-analysis evidence. The absence of listed action/attachment markers is not benign evidence by itself.

### F4

- **Questions:** What does the parsed JavaScript action do as data, what object/action references make it reachable, and what triggers it? Is the action required for a documented benign feature, or does its behavior perform a harmful operation? What raw bytes/object account for the OpenAction marker that PDF.js did not recognize as a document OpenAction?
- **Evidence to record:** Source and intended-purpose evidence; static action-reference and trigger analysis; safe, non-executing review of the action source; explanation of the OpenAction marker discrepancy; independent reviewer rationale and confidence. Do not infer either verdict from the JavaScript or marker alone.

### F5

- **Questions:** Answer F4's questions independently for F5. Do not transfer F4's interpretation because the two cases share action-presence results. Does the larger structural size/image count correspond to expected document content, or is there separate evidence of harmful behavior?
- **Evidence to record:** F5-specific source/purpose evidence, static action and trigger analysis, explanation of its raw OpenAction marker, and independent reviewer rationale/confidence. The high object/image counts are not, by themselves, malicious evidence.

## Review procedure and decision record

1. **Authorize and register.** Confirm that the reviewer is permitted to inspect the document and any embedded item. Maintain the mapping from `F1`–`F5` to local samples in an access-controlled local register, separate from this report. Record source/provenance and any relevant independent threat analysis.
2. **Blind independent review.** Where feasible, two qualified reviewers independently inspect each case without seeing the model score, verdict, or one another's notes. Each reviewer records `BENIGN`, `MALICIOUS`, or `INCONCLUSIVE`, a concise rationale, evidence references, and confidence (`LOW`, `MODERATE`, or `HIGH`) with a reason for that confidence.
3. **Static first.** Inspect object relationships, action dictionaries, JavaScript source strictly as text, and attachment structure with approved tools. Do not execute JavaScript, open an active viewer, launch an attachment, follow links, or send document data to a service. Record whether the action is reachable and what trigger invokes it; do not copy payloads into this report.
4. **Deeper behavior only in an isolated lab.** If static evidence is insufficient and behavioral analysis is necessary, refer the case to an authorized malware-analysis environment. Use a disposable, isolated virtual machine or equivalent with snapshots, no production credentials or shared folders, and blocked network access unless a separately approved protocol requires controlled egress. Never conduct this analysis on a normal workstation. If such a lab is unavailable or unauthorized, retain `INCONCLUSIVE`.
5. **Adjudicate disagreements.** If the two reviewers disagree, a third qualified reviewer examines the evidence and records the resolution. Preserve each original decision. If no third reviewer is available or evidence remains ambiguous, do not force a binary label.
6. **Keep the decision evidence-based.** A model score, parser marker, file opening successfully, or absence of a marker cannot serve as the sole rationale. Do not alter a feature value or verdict to obtain the desired label.

The evidence standards under **Classification evidence standard** remain in force. In particular, `BENIGN` requires evidence about the intended behavior and no unresolved suspicious behavior; `MALICIOUS` requires evidence of harmful intent or behavior; otherwise use `INCONCLUSIVE`.

## Current evidence status and production-correction gate

### Verified findings

- All five samples are matched to evaluation records, and their saved feature vectors reproduce from the local bytes with the current app extractor. This verifies repeatability for this sample set, not training-time parity.
- The app page counts match PDF.js for F1–F5. The known raw page-count miss on a compressed object-stream fixture and one SAFE-predicted evaluation sample is not present in these five cases.
- F1/F2 have two raw embedded-file marker occurrences but one parsed attachment each. The model score is unchanged when the feature is changed from 2 to 1 in an isolated one-feature calculation.
- F4/F5 have JavaScript actions recognized by PDF.js and a raw OpenAction marker that PDF.js did not recognize as a document OpenAction. Removing that one marker from the feature vector reduces each score but leaves both above 0.5.
- F3 has no listed action or attachment markers and is still predicted `MALICIOUS`; its image marker and parsed paint-operation counts differ because they measure different things.

These are structural observations. They do not establish what the JavaScript or attachment does, whether it is reachable or harmful, whether a particular document is benign, or whether one feature caused a prediction.

### Unconfirmed hypotheses

- F1/F2's attachment markers could reflect legitimate attached content or suspicious payloads; the attachment content and provenance have not been reviewed.
- F4/F5's JavaScript could support a legitimate document feature or implement harmful behavior. Presence alone does not distinguish those outcomes.
- The OpenAction marker could be inert or outside the parsed document-level action; its exact object-level explanation has not been established.
- Model sensitivity to one-feature perturbations suggests candidate areas for review but is not a causal feature attribution and does not justify changing the input.
- The user-provided benign identification is useful context but is not an independent content/behavior review.

### Evidence required before a production correction

- **Extractor change:** establish the intended training feature definition from original generation code or authoritative source evidence; verify a specific per-file extraction error and the correct replacement value; test representative valid, compressed, malformed, and parser-error cases; compare old/new vectors and scores across the complete existing evaluation plus a rights-cleared, independently labeled set. Preserve explicit errors and the SAFE-only gate. The unknown training provenance currently blocks a compatibility claim.
- **Model or data change:** first complete independent labels for these five cases. If labels support false positives while the feature extraction is valid, obtain rights-cleared representative data, establish training overlap, and evaluate any separately versioned model change on a locked test set with predeclared metrics. These five cases alone are not sufficient to retrain, tune, or change the 0.5 threshold.

Until those conditions are met, keep current production extraction, model weights, inference, threshold, verdict handling, and upload policy unchanged.
