# Independent local PDF structure verification

Only aggregate counts and distributions are included. This report omits document names, local paths, hashes, IDs, metadata values, attachment names, and document contents.

## Matching and parser

- Evaluation JSON contains 14 evaluated entries; 14 distinct SHA-256 contents were matched locally; PDF.js 4.10.38 parsed 14; parse failures 0. Duplicate local copies with the same digest were treated as the same byte-identical PDF content.
- The independent parser was the locally installed PDF.js legacy parser. Processing used in-memory bytes and disabled JavaScript evaluation; nothing was uploaded or executed.
- Re-running the current app extractor on matched bytes differed from saved evaluation features on 0 feature/file comparisons across 24 features.

## Direct and approximate comparisons

These counts compare app values to parser outputs over the parsed subset. App higher/lower compares numeric values. For presence comparisons, app raw count was reduced to present/absent and compared with parsed presence.

| Feature comparison | Result |
|---|---|
| page_count vs parsed page count | 13/14 exact; app higher 0; app lower 1; parse-unavailable 0 |
| legacy `/Type /Page` prefix count vs parsed page count | 3/14 exact; app higher 10; app lower 1; parse-unavailable 0 |
| title_chars vs parsed Info Title length (approximate encoding match) | 8/14 exact; app higher 4; app lower 2; parse-unavailable 0 |
| encrypted vs parsed encryption state | 14/14 exact; app higher 0; app lower 0; parse-unavailable 0 |
| embedded_file_count vs parsed attachment count (different counting semantics) | 12/14 exact; app higher 2; app lower 0; parse-unavailable 0 |
| image_count vs parsed image paint operations (approximate; draws vs raw image dictionaries) | 5/14 exact; app higher 1; app lower 8; parse-unavailable 0 |
| js/javascript raw-marker presence vs parsed document/page JavaScript action presence | 14/14 exact; app higher 0; app lower 0; parse-unavailable 0 |
| openaction_count presence vs parsed OpenAction/destination presence | 12/14 exact; app higher 2; app lower 0; parse-unavailable 0 |
| acroform_count presence vs parser AcroForm flag | 14/14 exact; app higher 0; app lower 0; parse-unavailable 0 |
| xfa_count presence vs parser XFA flag/data | 14/14 exact; app higher 0; app lower 0; parse-unavailable 0 |
| aa_count presence vs parsed JavaScript action presence only | 10/14 exact; app higher 2; app lower 2; parse-unavailable 0 |

## Features not directly comparable through PDF.js public APIs

- metadata_size: app emits a raw byte-text marker-occurrence count, while PDF.js does not expose an equivalent public count for the underlying generic PDF objects, streams, xref/trailer structures, or Launch action occurrences. No semantic equivalence is claimed.
- object_count: app emits a raw byte-text marker-occurrence count, while PDF.js does not expose an equivalent public count for the underlying generic PDF objects, streams, xref/trailer structures, or Launch action occurrences. No semantic equivalence is claimed.
- endstream_count: app emits a raw byte-text marker-occurrence count, while PDF.js does not expose an equivalent public count for the underlying generic PDF objects, streams, xref/trailer structures, or Launch action occurrences. No semantic equivalence is claimed.
- stream_count: app emits a raw byte-text marker-occurrence count, while PDF.js does not expose an equivalent public count for the underlying generic PDF objects, streams, xref/trailer structures, or Launch action occurrences. No semantic equivalence is claimed.
- xref_count: app emits a raw byte-text marker-occurrence count, while PDF.js does not expose an equivalent public count for the underlying generic PDF objects, streams, xref/trailer structures, or Launch action occurrences. No semantic equivalence is claimed.
- trailer_count: app emits a raw byte-text marker-occurrence count, while PDF.js does not expose an equivalent public count for the underlying generic PDF objects, streams, xref/trailer structures, or Launch action occurrences. No semantic equivalence is claimed.
- startxref_count: app emits a raw byte-text marker-occurrence count, while PDF.js does not expose an equivalent public count for the underlying generic PDF objects, streams, xref/trailer structures, or Launch action occurrences. No semantic equivalence is claimed.
- launch_count: app emits a raw byte-text marker-occurrence count, while PDF.js does not expose an equivalent public count for the underlying generic PDF objects, streams, xref/trailer structures, or Launch action occurrences. No semantic equivalence is claimed.
- `metadata_size`: the app estimates 4 times the matched `/Info n n R` reference-token length, capped at 512; it does not measure Info dictionary bytes. PDF.js exposes parsed Info fields, not an equivalent byte size.
- `aa_count`: only JavaScript actions recognized through PDF.js APIs were checked. Non-JavaScript Additional Actions are not covered by this presence comparison.

## Integrity and extractor findings

- Re-extraction on the matched bytes is identical to the saved evaluation feature values for all 24 fields. This verifies the current extractor's reproducibility on these local bytes, not correctness of every feature.
- page_count: 13/14 exact matches to PDF.js.
- The one page-count mismatch has app count 0 and PDF.js count 22. Its raw bytes contain 0 visible /Page name markers, 16 /ObjStm markers, and an xref stream: true. PDF.js page references with visible standalone object headers: 0/22. These signals support compressed page objects as the cause; no private structure details are emitted.
- A generated synthetic PDF with `/Pages` and `/Page` objects stored in a Flate-compressed object stream reproduces the discrepancy: current extractor 0, PDF.js 1. The regression test asserts both outcomes and contains no private PDF data.
- encrypted: 14/14 exact matches to parsed encryption state.
- Direct-check mismatches split by model output:
- MALICIOUS predictions (5): page-count mismatches 0; encryption-state mismatches 0; JavaScript-action presence mismatches 0; OpenAction-presence mismatches 2.
- SAFE predictions (9): page-count mismatches 1; encryption-state mismatches 0; JavaScript-action presence mismatches 0; OpenAction-presence mismatches 0.
- embedded attachments: app raw marker count mean 0.29, median 0, range 0-2; PDF.js parsed attachment count mean 0.14, median 0, range 0-1. Differences are confirmed count disagreements, but the two features count different concepts.
- image count: app raw marker count mean 12.57, median 0, range 0-109; PDF.js painted-image operation count mean 53.21, median 10.5, range 0-221. Differences are confirmed, but dictionary occurrences and painted operations differ by definition.
- App metadata_size: mean 47.43, median 44, range 44-56; PDF.js Info dictionary key count ranged 8-18. These quantities are not equivalent, so no numeric parity conclusion is made.
- App page_count distribution: mean 23.57, median 1.5, range 0-93; parsed count: mean 25.14, median 12, range 1-93.
- Active-action markers are lexical matches in the raw bytes. Parsed JavaScript/OpenAction checks establish parser-recognized action presence only; a marker can be inert text, and an action's presence does not establish maliciousness.

## Interpretation and limits

The legacy prefix counter matches PDF.js on 3/14 files and overcounts 10; counting /Type /Page with a word boundary avoids the /Pages prefix overcount but still misses page dictionaries hidden in compressed object streams. PDF.js's parsed page-tree count is the strongest available candidate for actual page count and conceptually matches the repository helper's len(doc); however, original training rows were precomputed and their generator is unknown. On the single mismatch, parser-based correction changes one model input from 0 to 22, which can affect tree splits and prediction; its score effect has not been evaluated here.
A parser-based correction can be proposed in isolation using the already installed PDF.js package, but the extractor is synchronous today and production scanner integration would need an async feature-extraction path plus explicit parser-error handling. Do not silently retain the raw value or fall back to SAFE if parsing fails.
A verified mismatch between app page_count and PDF.js parsed page count is an extraction inaccuracy for that matched PDF. It occurred in the SAFE-predicted group; none of the five MALICIOUS-predicted files had a page-count mismatch, so it does not explain the five false positives. A separate proposed extractor fix is justified for page counting, subject to checking training-feature compatibility before changing production. Mismatches for attachment and image metrics are confirmed semantic differences between the app's raw counter and parser-level counts, but do not by themselves establish which representation matches model training or prove the raw counter is defective.
The model was trained on precomputed feature tables whose extraction provenance remains unknown.
Recommendation: gather more training-pipeline evidence before changing the production extractor. The candidate correction is to use PDF.js's parsed page-tree count for page_count, with parser failures remaining explicit scan errors. Before adoption, obtain the original feature-generation script or training-table provenance, compare page_count values on a representative labeled PDF set, and assess score changes with the current model. The synthetic regression establishes the parser edge case but cannot establish compatibility with training values.
No production extractor, model, inference, threshold, scanner verdict, or upload security logic was modified. This inspection does not explain the five predictions causally, establish model accuracy, or establish training-time feature parity.
