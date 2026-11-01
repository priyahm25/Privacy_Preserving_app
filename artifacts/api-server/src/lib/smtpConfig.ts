// SMTP settings from the environment, validated. Pure (no imports) so it can
// be unit tested; nothing returned here ever contains SMTP_PASS.

type Env = Record<string, string | undefined>;

export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string };
}

export interface SmtpConfig {
  /** Transport options, or null when email delivery is disabled. */
  transport: SmtpTransportOptions | null;
  from: string | null;
  /** Misconfigurations that will make sending fail. Safe to log. */
  errors: string[];
  /** Suspicious but possibly intentional settings. Safe to log. */
  warnings: string[];
  /** Non-secret summary for the startup log. */
  summary: { configured: boolean; host: string | null; port: number | null; secure: boolean | null; user: string | null };
}

/** "priya@gmail.com" -> "p***@gmail.com", so logs identify the account without spelling it out. */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf("@");
  return at > 0 ? `${address[0]}***${address.slice(at)}` : "***";
}

const isGmail = (host: string) => /(^|\.)gmail\.com$|(^|\.)googlemail\.com$/i.test(host);

export function resolveSmtpConfig(env: Env): SmtpConfig {
  const host = env.SMTP_HOST?.trim() ?? "";
  const user = env.SMTP_USER?.trim() ?? "";
  const rawPass = env.SMTP_PASS ?? "";
  const errors: string[] = [];
  const warnings: string[] = [];
  const disabled = (configured = false): SmtpConfig => ({
    transport: null, from: null, errors, warnings,
    summary: { configured, host: host || null, port: null, secure: null, user: user ? maskAddress(user) : null },
  });

  const present = [host, user, rawPass.trim()].filter(Boolean).length;
  if (present === 0) return disabled();
  if (present < 3) {
    const missing = [!host && "SMTP_HOST", !user && "SMTP_USER", !rawPass.trim() && "SMTP_PASS"].filter(Boolean);
    errors.push(`Incomplete SMTP configuration: ${missing.join(", ")} not set.`);
    return disabled();
  }

  const port = Number(env.SMTP_PORT?.trim() || 587);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    errors.push("SMTP_PORT must be a port number (587 for STARTTLS, 465 for implicit TLS).");
    return disabled();
  }

  const secureRaw = env.SMTP_SECURE?.trim().toLowerCase() ?? "";
  if (secureRaw && secureRaw !== "true" && secureRaw !== "false") {
    errors.push('SMTP_SECURE must be "true" or "false".');
    return disabled();
  }
  // Port 465 is implicit TLS; 587 starts in plaintext and upgrades via STARTTLS.
  const secure = secureRaw === "true" || port === 465;
  if (secureRaw === "true" && port === 587) {
    errors.push("SMTP_SECURE=true with SMTP_PORT=587 fails the TLS handshake: use SMTP_SECURE=false for 587 (STARTTLS), or port 465.");
    return disabled();
  }
  if (secureRaw === "false" && port === 465) {
    warnings.push("SMTP_PORT=465 always uses implicit TLS; SMTP_SECURE=false is ignored.");
  }

  // Google shows app passwords as four groups of four; the spaces are display only.
  const pass = isGmail(host) ? rawPass.replace(/\s+/g, "") : rawPass;
  if (isGmail(host)) {
    if (!/^[^\s@]+@[^\s@]+$/.test(user)) {
      errors.push("SMTP_USER must be the full Gmail address that created the app password.");
    }
    if (pass.length !== 16) {
      warnings.push(`SMTP_PASS is ${pass.length} characters; a Gmail app password is 16. The normal account password is rejected (535).`);
    }
  }

  const from = env.MAIL_FROM?.trim() || user;
  if (isGmail(host) && !from.toLowerCase().includes(user.toLowerCase())) {
    warnings.push("MAIL_FROM differs from SMTP_USER; Gmail rewrites the sender unless that address is a verified 'Send mail as' alias.");
  }

  if (errors.length) return disabled();
  return {
    // requireTLS: on 587, refuse to authenticate if STARTTLS isn't offered, so
    // credentials are never sent unencrypted.
    transport: { host, port, secure, requireTLS: !secure, auth: { user, pass } },
    from,
    errors,
    warnings,
    summary: { configured: true, host, port, secure, user: maskAddress(user) },
  };
}

/** What an SMTP failure most likely means, for the operator's log. */
export function smtpFailureHint(code: string | undefined, responseCode: number | undefined): string {
  if (code === "EAUTH" || responseCode === 535) {
    return "Login rejected. Use a 16-character app password created while signed in as SMTP_USER, with 2-Step Verification on; app passwords are revoked when the Google password changes.";
  }
  if (code === "ESOCKET" || code === "ETLS") return "TLS/socket error. For Gmail use port 587 with SMTP_SECURE=false, or 465 with true; check firewalls blocking outbound SMTP.";
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "EDNS") return "Could not reach the SMTP server. Check SMTP_HOST and that the network allows outbound port 587/465.";
  return "See the error code for details.";
}
