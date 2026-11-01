/**
 * Final scan decision shared by every supported format.
 *
 * Deterministic findings come first and can only make a verdict stricter:
 *  - any "malicious" finding        -> MALICIOUS, whatever the model says
 *  - model score >= MALICIOUS_AT    -> MALICIOUS
 *  - any "uncertain" finding        -> UNCERTAIN (blocked for inspection)
 *  - model score in [UNCERTAIN_AT, MALICIOUS_AT) -> UNCERTAIN
 *  - otherwise                      -> SAFE (the BENIGN outcome)
 * Formats without a model (TXT, PPTX) pass `null` and rely on the rules alone.
 */

export type ScanVerdict = "SAFE" | "MALICIOUS" | "UNCERTAIN" | "CORRUPTED" | "UNSUPPORTED" | "ERROR";

export interface ScanFinding {
  severity: "malicious" | "uncertain";
  /** Stable machine-readable code, e.g. "PDF_LAUNCH_ACTION". */
  code: string;
}

/** Unchanged production decision threshold of the trained models. */
export const MALICIOUS_AT = 0.5;
/**
 * Scores between this and MALICIOUS_AT are blocked as UNCERTAIN. A
 * conservative policy band (it only blocks more), not a tuned threshold:
 * correctly scored model outputs are strongly bimodal on the training data.
 */
export const UNCERTAIN_AT = 0.2;

export interface CombinedVerdict {
  verdict: "SAFE" | "MALICIOUS" | "UNCERTAIN";
  /** Model probability of malicious, or 0 for rules-only formats. */
  confidence: number;
  reasonCode: string;
  findings: string[];
}

export function combineVerdict(findings: ScanFinding[], modelProbability: number | null, source: string): CombinedVerdict {
  if (modelProbability !== null && (!Number.isFinite(modelProbability) || modelProbability < 0 || modelProbability > 1)) {
    throw new Error("The model returned an invalid score.");
  }
  const codes = findings.map((f) => f.code);
  const confidence = modelProbability ?? 0;
  const malicious = findings.find((f) => f.severity === "malicious");
  if (malicious) return { verdict: "MALICIOUS", confidence, reasonCode: malicious.code, findings: codes };
  if (modelProbability !== null && modelProbability >= MALICIOUS_AT) {
    return { verdict: "MALICIOUS", confidence, reasonCode: `${source}_MODEL_MALICIOUS`, findings: codes };
  }
  const uncertain = findings.find((f) => f.severity === "uncertain");
  if (uncertain) return { verdict: "UNCERTAIN", confidence, reasonCode: uncertain.code, findings: codes };
  if (modelProbability !== null && modelProbability >= UNCERTAIN_AT) {
    return { verdict: "UNCERTAIN", confidence, reasonCode: `${source}_MODEL_UNCERTAIN`, findings: codes };
  }
  return {
    verdict: "SAFE",
    confidence,
    reasonCode: modelProbability === null ? `${source}_RULES_CLEAN` : `${source}_MODEL_BENIGN`,
    findings: codes,
  };
}
