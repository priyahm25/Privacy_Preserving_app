/**
 * Deterministic on-device TXT scanner. There is no trained text model: the
 * verdict comes only from the rules below, and the reason codes say so.
 */
import { combineVerdict, type ScanFinding } from "./verdict";

export type TextScanVerdict = "SAFE" | "MALICIOUS" | "UNCERTAIN" | "CORRUPTED" | "UNSUPPORTED" | "ERROR";

export interface TextScanResult {
  verdict: TextScanVerdict;
  confidence: 0;
  reasonCode: string;
  error?: string;
  findings?: string[];
}

/** Larger text files are blocked rather than scanned partially. */
export const MAX_TEXT_BYTES = 20 * 1024 * 1024;

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/** UTF-16 with a byte-order mark (Windows Notepad "Unicode"), else strict UTF-8. */
function decodeText(bytes: Uint8Array, decode: (input: Uint8Array) => string): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(bytes.subarray(2));
  return decode(bytes);
}

/**
 * Normalize text before matching so rules can't be bypassed with invisible
 * characters or compatibility forms. Zero-width and bidirectional control
 * characters are deleted (they carry no meaning in plain text but can split a
 * keyword like `power<U+200B>shell`), then Unicode is folded with NFKC so
 * full-width and other compatibility glyphs collapse to their ASCII form.
 * The original text is kept for the binary-content check; only matching uses
 * this copy.
 */
export function normalizeForScan(text: string): string {
  const stripped = text.replace(/[­​-‏‪-‮⁠-⁤⁦-⁯﻿]/g, "");
  try {
    return stripped.normalize("NFKC");
  } catch {
    return stripped;
  }
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const MALICIOUS_RULES: [RegExp, string][] = [
  // Base64 / hex encodings of a Windows PE ("MZ" + DOS stub) or ELF header: an embedded executable payload.
  [/TVqQAAMAAAAEAAAA|TVpQAAIAAAAEAA|TVoAAAAAAAAAAAAA|f0VMRgIBAQ/, "TEXT_EMBEDDED_EXECUTABLE"],
  [/\b4d5a90000300000004000000\b/i, "TEXT_EMBEDDED_EXECUTABLE"],
];

const UNCERTAIN_RULES: [RegExp, string][] = [
  // PowerShell accepts any prefix of -EncodedCommand (plus the -ec alias),
  // "/" as well as "-", and a quoted argument. The payload must still look
  // like base64, so prose such as "-enc [placeholder]" is not matched.
  [/\b(powershell|pwsh)(\.exe)?\b[^\n]{0,120}?\s[-/](ec|e(n(c(o(d(e(d(c(o(m(m(a(n(d)?)?)?)?)?)?)?)?)?)?)?)?)?)\s+["']?[A-Za-z0-9+/]{20,}={0,2}/i, "TEXT_ENCODED_POWERSHELL"],
  [/\b(IEX|Invoke-Expression)\b[^\n]{0,120}(DownloadString|Net\.WebClient|Invoke-WebRequest|iwr)\b/i, "TEXT_DOWNLOAD_AND_EXECUTE"],
  [/\bcertutil(\.exe)?\s+(-urlcache|-decode)\b/i, "TEXT_LOLBIN_COMMAND"],
  [/\b(mshta|regsvr32|rundll32|wscript|cscript)(\.exe)?\s+\S*(https?:|\\\\|scrobj|javascript:)/i, "TEXT_LOLBIN_COMMAND"],
  [/\bbash\s+-i\s+>&\s*\/dev\/tcp\//, "TEXT_REVERSE_SHELL"],
  [/\b(nc|ncat)\s+(-e|--exec)\s+\S*(sh|cmd)/i, "TEXT_REVERSE_SHELL"],
  // A downloader piped straight into an interpreter, limited to IP-literal or
  // userinfo ("http://host@...") URLs so ordinary "curl https://site | bash"
  // install one-liners from a real domain are not flagged.
  [/\b(iwr|curl|wget|Invoke-WebRequest)\b[^\n|]{0,160}https?:\/\/(\d{1,3}(\.\d{1,3}){3}|[^\s/@]+@)[^\n|]{0,160}\|\s*(sh|bash|iex|powershell|pwsh|cmd)\b/i, "TEXT_DOWNLOAD_AND_EXECUTE"],
  [/<script\b[^>]*>[\s\S]{0,2000}?<\/script>/i, "TEXT_HTML_SCRIPT"],
  [/[A-Za-z0-9+/]{4000,}={0,2}/, "TEXT_LARGE_ENCODED_BLOB"],
  // Phishing: a credential/urgency request together with a deceptive link -
  // an IP-literal, userinfo ("@host") or punycode host. Prose that merely
  // discusses phishing has no such URL, so it stays SAFE.
  [/(verify|confirm|update|validate|reset|unlock|suspend)[^\n]{0,80}(password|account|credential|login|identity)[\s\S]{0,200}https?:\/\/([^\s/]*@|\d{1,3}(\.\d{1,3}){3}|xn--)/i, "TEXT_PHISHING_LINK"],
  [/(password|account|credential|login|identity)[^\n]{0,80}(verify|confirm|update|validate|reset|unlock|suspend)[\s\S]{0,200}https?:\/\/([^\s/]*@|\d{1,3}(\.\d{1,3}){3}|xn--)/i, "TEXT_PHISHING_LINK"],
  // A link to an executable served from an IP-literal or userinfo host.
  // Installer links from a normal domain (e.g. python.org/...python.exe) are
  // not matched.
  [/https?:\/\/([^\s/]*@|\d{1,3}(\.\d{1,3}){3})[^\s]*\.(exe|scr|hta|ps1|bat|cmd|vbs|js|jar|msi)\b/i, "TEXT_EXECUTABLE_URL"],
  // Prompt injection: an imperative to discard instructions or expose the
  // system prompt. Anchored to a clause start and to override verbs, so a
  // sentence describing prompt injection ("tries to override ... instructions")
  // is not flagged.
  [/(^|[.!?\n]\s*)(please\s+|kindly\s+|now\s+|you\s+(?:must|should|can|will)\s+)?(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier|preceding|your)\s+(instructions|prompts?|rules|directions|commands)/i, "TEXT_PROMPT_INJECTION"],
  [/(^|[.!?\n]\s*)(please\s+|kindly\s+|now\s+|you\s+(?:must|should|can|will)\s+)?(reveal|print|show|repeat|output|disclose)\s+(me\s+)?(your\s+|the\s+)(system\s+prompt|initial\s+instructions|hidden\s+instructions|developer\s+(prompt|message))/i, "TEXT_PROMPT_INJECTION"],
];

/** Validates TXT bytes and applies deterministic content rules. */
export function scanTextBytes(
  bytes: Uint8Array,
  decode: (input: Uint8Array) => string = decodeUtf8,
): TextScanResult {
  if (bytes.byteLength === 0) {
    return { verdict: "CORRUPTED", confidence: 0, reasonCode: "EMPTY_TEXT_FILE", error: "The selected text file is empty and cannot be scanned." };
  }
  if (bytes.byteLength > MAX_TEXT_BYTES) {
    return { verdict: "UNCERTAIN", confidence: 0, reasonCode: "TEXT_TOO_LARGE", error: "The text file is too large to scan completely on this device." };
  }

  let text: string;
  try {
    text = decodeText(bytes, decode);
  } catch (error) {
    if (error instanceof TypeError) {
      return { verdict: "CORRUPTED", confidence: 0, reasonCode: "INVALID_UTF8_TEXT", error: "The selected .txt file is not valid UTF-8 or UTF-16 text." };
    }
    return { verdict: "ERROR", confidence: 0, reasonCode: "TEXT_SCAN_ERROR", error: "The local text validation step failed." };
  }

  // Permit normal line endings and tabs. Other control characters are
  // characteristic of binary data and are not accepted as plain text.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(text)) {
    return { verdict: "UNSUPPORTED", confidence: 0, reasonCode: "TEXT_BINARY_CONTENT", error: "The .txt extension does not match the file's binary-looking content." };
  }

  // Match against a normalized copy so invisible-character and compatibility
  // obfuscation can't slip a keyword past the rules.
  const scanText = normalizeForScan(text);
  const findings: ScanFinding[] = [];
  if (scanText.includes(EICAR)) findings.push({ severity: "malicious", code: "TEXT_EICAR_TEST_SIGNATURE" });
  for (const [rule, code] of MALICIOUS_RULES) if (rule.test(scanText)) findings.push({ severity: "malicious", code });
  for (const [rule, code] of UNCERTAIN_RULES) if (rule.test(scanText) && !findings.some((f) => f.code === code)) findings.push({ severity: "uncertain", code });

  const result = combineVerdict(findings, null, "TEXT");
  return {
    verdict: result.verdict,
    confidence: 0,
    reasonCode: result.reasonCode,
    findings: result.findings,
    ...(result.verdict === "SAFE" ? {} : {
      error: result.verdict === "MALICIOUS"
        ? "The text contains a known malicious signature or an embedded executable payload."
        : "The text contains command or script content that needs further inspection before it can be shared.",
    }),
  };
}
