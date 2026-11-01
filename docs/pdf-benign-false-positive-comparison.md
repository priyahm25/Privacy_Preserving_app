# Local PDF benign false-positive feature comparison

This report contains group-level statistics only. It intentionally omits PDF names, paths, hashes, identifiers, and contents.
The user identified all evaluation PDFs as legitimate; this is a small local set, not a representative accuracy estimate.

## Summary

- Total rows: 14; evaluated feature rows: 14; user-labelled benign: 14.
- Model predictions at threshold 0.5: 9 SAFE, 5 MALICIOUS (false positives within this user-labelled sample).
- Flagged probability range: 0.5046 to 0.6128.
- Flagged scores descending (ties retained): 0.6128, 0.6094, 0.5822, 0.5046, 0.5046.
- Inference recomputation mismatches against saved probabilities: 0.
- Reference-comparison rows carrying a `feature_differences` field: 0/14; recorded differing feature instances: 0.
- A zero reference-difference count alone does not show that a reference manifest was supplied. No per-row comparison field means no matched reference comparison was recorded; the evaluation format does not record whether a manifest argument was omitted or supplied without matching hashes.

## All 24 feature distributions ranked by standardized group difference

Mean/median and population SD are shown for MALICIOUS-predicted (flagged) versus SAFE-predicted. Standardized difference is (flagged mean - SAFE mean) / pooled SD; it is descriptive and sensitive to this small sample.

| Feature | Flagged mean (median, range) | SAFE mean (median, range) | Mean delta | Std. difference | Nonzero flagged / SAFE | Flagged top 1 / top 2 share; SAFE top 1 / top 2 share | Avg. traversed splits per file, flagged / SAFE |
|---|---:|---:|---:|---:|---:|---:|---:|
| `metadata_size` | 44 (44, 44-44) | 49.3333 (52, 44-56) | -5.3333 | -1.5119 | 5/5 / 9/9 | 20% top1, 40% top2; 13% top1, 25% top2 | 232.8000 / 208.4444 |
| `embedded_file_count` | 0.8000 (0, 0-2) | 0 (0, 0-0) | 0.8000 | 1.1547 | 2/5 / 0/9 | 50% top1, 100% top2; n/a | 65.2000 / 68.8889 |
| `js_count` | 0.4000 (0, 0-1) | 0 (0, 0-0) | 0.4000 | 1.1547 | 2/5 / 0/9 | 50% top1, 100% top2; n/a | 31.2000 / 34.1111 |
| `javascript_count` | 0.4000 (0, 0-1) | 0 (0, 0-0) | 0.4000 | 1.1547 | 2/5 / 0/9 | 50% top1, 100% top2; n/a | 134 / 144.5556 |
| `objstm_count` | 0 (0, 0-0) | 9.6667 (0, 0-36) | -9.6667 | -0.9656 | 0/5 / 4/9 | n/a; 41% top1, 79% top2 | 34.4000 / 47.8889 |
| `object_count` | 510 (11, 9-1489) | 110.6667 (107, 0-288) | 399.3333 | 0.8877 | 5/5 / 7/9 | 58% top1, 99% top2; 29% top1, 54% top2 | 265.2000 / 268.8889 |
| `image_count` | 27.4000 (0, 0-109) | 4.3333 (0, 0-21) | 23.0667 | 0.7587 | 2/5 / 2/9 | 80% top1, 100% top2; 54% top1, 100% top2 | 65.4000 / 49.5556 |
| `aa_count` | 0 (0, 0-0) | 0.2222 (0, 0-1) | -0.2222 | -0.7559 | 0/5 / 2/9 | n/a; 50% top1, 100% top2 | 10.4000 / 3.4444 |
| `xref_count` | 2.4000 (2, 1-4) | 1.7778 (2, 1-2) | 0.6222 | 0.6202 | 5/5 / 9/9 | 33% top1, 67% top2; 13% top1, 25% top2 | 4.2000 / 4.1111 |
| `title_chars` | 4.8000 (0, 0-12) | 11.1111 (0, 0-54) | -6.3111 | -0.4116 | 2/5 / 2/9 | 50% top1, 100% top2; 54% top1, 100% top2 | 172 / 171.6667 |
| `openaction_count` | 0.4000 (0, 0-1) | 0.2222 (0, 0-1) | 0.1778 | 0.3913 | 2/5 / 2/9 | 50% top1, 100% top2; 50% top1, 100% top2 | 37 / 19.4444 |
| `startxref_count` | 1.4000 (1, 1-2) | 1.2222 (1, 1-2) | 0.1778 | 0.3913 | 5/5 / 9/9 | 29% top1, 57% top2; 18% top1, 36% top2 | 27.4000 / 34.8889 |
| `page_count` | 17.2000 (1, 1-59) | 27.1111 (2, 0-93) | -9.9111 | -0.3466 | 5/5 / 8/9 | 69% top1, 97% top2; 38% top1, 64% top2 | 91 / 118 |
| `trailer_count` | 1 (1, 0-2) | 0.7778 (1, 0-1) | 0.2222 | 0.3186 | 3/5 / 7/9 | 40% top1, 80% top2; 14% top1, 29% top2 | 0 / 0.1111 |
| `endstream_count` | 69 (3, 2-244) | 89.7778 (93, 7-222) | -20.7778 | -0.2451 | 5/5 / 9/9 | 71% top1, 98% top2; 27% top1, 51% top2 | 46.2000 / 50.7778 |
| `stream_count` | 138 (6, 4-488) | 179.5556 (186, 14-444) | -41.5556 | -0.2451 | 5/5 / 9/9 | 71% top1, 98% top2; 27% top1, 51% top2 | 55 / 58.3333 |
| `file_size` | 1039975.4000 (1439423, 26748-2260650) | 1169347 (800575, 58025-3406380) | -129371.6000 | -0.1321 | 5/5 / 9/9 | 43% top1, 71% top2; 32% top1, 57% top2 | 221 / 264.5556 |
| `colors_count` | 27.6000 (1, 0-109) | 29.6667 (18, 0-110) | -2.0667 | -0.0517 | 3/5 / 6/9 | 79% top1, 99% top2; 41% top1, 73% top2 | 47.8000 / 102.4444 |
| `encrypted` | 0 (0, 0-0) | 0 (0, 0-0) | 0 | 0 | 0/5 / 0/9 | n/a; n/a | 29.8000 / 23.1111 |
| `acroform_count` | 0 (0, 0-0) | 0 (0, 0-0) | 0 | 0 | 0/5 / 0/9 | n/a; n/a | 22.2000 / 7.4444 |
| `jbig2decode_count` | 0 (0, 0-0) | 0 (0, 0-0) | 0 | 0 | 0/5 / 0/9 | n/a; n/a | 0 / 0 |
| `richmedia_count` | 0 (0, 0-0) | 0 (0, 0-0) | 0 | 0 | 0/5 / 0/9 | n/a; n/a | 24.6000 / 27.8889 |
| `launch_count` | 0 (0, 0-0) | 0 (0, 0-0) | 0 | 0 | 0/5 / 0/9 | n/a; n/a | 5.4000 / 8 |
| `xfa_count` | 0 (0, 0-0) | 0 (0, 0-0) | 0 | 0 | 0/5 / 0/9 | n/a; n/a | 81 / 129.6667 |

The largest flagged-group means for `object_count` and `image_count` are concentrated in the largest one or two values (see top-share column); medians are 11 and 0 respectively. Their mean gaps are therefore not uniform across all five flagged files.

The split counts are how often a feature was tested on the selected path through the 300 trees. They are not feature attributions and do not show causal contribution or direction.

## Focused structural and active-action features

| Feature | Flagged nonzero | SAFE nonzero | Flagged range | SAFE range |
|---|---:|---:|---:|---:|
| `metadata_size` | 5/5 | 9/9 | 44-44 | 44-56 |
| `page_count` | 5/5 | 8/9 | 1-59 | 0-93 |
| `encrypted` | 0/5 | 0/9 | 0-0 | 0-0 |
| `embedded_file_count` | 2/5 | 0/9 | 0-2 | 0-0 |
| `image_count` | 2/5 | 2/9 | 0-109 | 0-21 |
| `object_count` | 5/5 | 7/9 | 9-1489 | 0-288 |
| `endstream_count` | 5/5 | 9/9 | 2-244 | 7-222 |
| `stream_count` | 5/5 | 9/9 | 4-488 | 14-444 |
| `xref_count` | 5/5 | 9/9 | 1-4 | 1-2 |
| `trailer_count` | 3/5 | 7/9 | 0-2 | 0-1 |
| `startxref_count` | 5/5 | 9/9 | 1-2 | 1-2 |
| `js_count` | 2/5 | 0/9 | 0-1 | 0-0 |
| `javascript_count` | 2/5 | 0/9 | 0-1 | 0-0 |
| `aa_count` | 0/5 | 2/9 | 0-0 | 0-1 |
| `openaction_count` | 2/5 | 2/9 | 0-1 | 0-1 |
| `launch_count` | 0/5 | 0/9 | 0-0 | 0-0 |
| `xfa_count` | 0/5 | 0/9 | 0-0 | 0-0 |

## Group-consistent presence differences

- No feature is nonzero in every file of one group and zero in every file of the other.
- JavaScript indicators: js_count and javascript_count are both nonzero in 2/5 flagged and 0/9 SAFE files; both plus embedded_file_count are nonzero in 0/5 flagged and 0/9 SAFE files.

## Extractor consistency checks

- stream_count is exactly twice endstream_count in 14/14 rows, consistent with each raw endstream spelling also containing a stream substring plus an opening stream spelling. This is a lexical relationship, not a parsed stream count.
- xref_count is at least startxref_count in 14/14 rows, as expected from the startxref substring overlap in this raw counter.
- metadata_size is 44 in all 5 flagged files and ranges 44-56 among SAFE files. This is the current extractor's 4x Info-reference-token-length heuristic, not a measured metadata payload size; the groups overlap at 44.
- encrypted is zero for all 14 files, but current extraction only searches raw bytes for the Encrypt marker; it does not parse encryption state.
- page_count is zero in 1/9 SAFE files and ranges from 1 to 59 for flagged files. Zero can reflect syntax the raw regex missed; the PDF bytes are unavailable for checking.
- No impossible values were found for the checked extractor invariants: `encrypted` is binary; `metadata_size` is 0 or a multiple of 4 capped at 512; `stream_count` includes the `stream` substring within `endstream`; `xref_count` includes the `xref` substring within `startxref`; and all 24 features are finite non-negative integers.
- These checks validate numeric consistency with the current raw-byte extractor only. They do not establish that a feature semantically describes the PDF or matches the unknown training-table extraction.
- `page_count`, metadata/title parsing, encryption, image count, and embedded-file count are raw-byte heuristics; plausible values are not proof of a parsed PDF structure.

## Evidence limits and interpretation

- The saved JSON contains features and predictions but no PDF bytes. The five individual feature vectors cannot be independently re-extracted from this output alone.
- Training extraction provenance for all 24 features remains unknown. Earlier documents record mismatches between the current app extractor and the PyMuPDF helper for metadata size, page count, title, encryption, image count, and the later-modified embedded-file logic.
- The local prediction scores are reproducible with the bundled JSON model and current inference implementation; this checks consistency, not model quality.
- Do not infer that active-action counts caused the predictions solely because the model has those features. Per-tree path usage is descriptive; without original training feature semantics and labeled comparative data it cannot identify a root cause.
