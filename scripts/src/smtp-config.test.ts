import assert from "node:assert/strict";
import test from "node:test";
import { maskAddress, resolveSmtpConfig, smtpFailureHint } from "../../artifacts/api-server/src/lib/smtpConfig.ts";

const PASS = "abcd efgh ijkl mnop"; // shaped like a Gmail app password; not a real one
const gmail = { SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_USER: "owner@gmail.com", SMTP_PASS: PASS };

test("Gmail on 587 uses STARTTLS with TLS required before login", () => {
  const config = resolveSmtpConfig(gmail);
  assert.deepEqual(config.errors, []);
  assert.deepEqual(config.warnings, []);
  assert.deepEqual(config.transport, {
    host: "smtp.gmail.com", port: 587, secure: false, requireTLS: true,
    auth: { user: "owner@gmail.com", pass: "abcdefghijklmnop" }, // display spaces removed
  });
  assert.equal(config.from, "owner@gmail.com");
});

test("port 465 uses implicit TLS", () => {
  const config = resolveSmtpConfig({ ...gmail, SMTP_PORT: "465", SMTP_SECURE: "true" });
  assert.equal(config.transport?.secure, true);
  assert.equal(config.transport?.requireTLS, false);
  assert.equal(resolveSmtpConfig({ ...gmail, SMTP_PORT: "465", SMTP_SECURE: "false" }).transport?.secure, true);
});

test("secure=true on 587 is rejected (it would fail the TLS handshake)", () => {
  const config = resolveSmtpConfig({ ...gmail, SMTP_SECURE: "true" });
  assert.equal(config.transport, null);
  assert.match(config.errors.join(), /SMTP_SECURE=false for 587/);
});

test("missing or partial configuration disables email without exposing values", () => {
  assert.equal(resolveSmtpConfig({}).transport, null);
  assert.deepEqual(resolveSmtpConfig({}).errors, []);
  const partial = resolveSmtpConfig({ SMTP_HOST: "smtp.gmail.com", SMTP_USER: "owner@gmail.com" });
  assert.equal(partial.transport, null);
  assert.match(partial.errors.join(), /SMTP_PASS not set/);
  assert.match(resolveSmtpConfig({ ...gmail, SMTP_PORT: "abc" }).errors.join(), /SMTP_PORT/);
  assert.match(resolveSmtpConfig({ ...gmail, SMTP_SECURE: "yes" }).errors.join(), /SMTP_SECURE/);
  assert.match(resolveSmtpConfig({ ...gmail, SMTP_USER: "owner" }).errors.join(), /full Gmail address/);
});

test("Gmail warnings: non-app-password length and a mismatched MAIL_FROM", () => {
  assert.match(resolveSmtpConfig({ ...gmail, SMTP_PASS: "normal-account-pw" }).warnings.join(), /16/);
  assert.match(resolveSmtpConfig({ ...gmail, MAIL_FROM: "SecureSphere <no-reply@securesphere.app>" }).warnings.join(), /MAIL_FROM/);
});

test("nothing loggable contains the password, and the address is masked", () => {
  for (const env of [gmail, { ...gmail, SMTP_SECURE: "true" }, { ...gmail, SMTP_PASS: "short pw" }]) {
    const { summary, errors, warnings } = resolveSmtpConfig(env);
    const loggable = JSON.stringify({ summary, errors, warnings });
    assert.ok(!loggable.includes(env.SMTP_PASS) && !loggable.includes(env.SMTP_PASS.replace(/\s/g, "")));
    assert.ok(!loggable.includes("owner@gmail.com"));
  }
  assert.equal(maskAddress("owner@gmail.com"), "o***@gmail.com");
});

test("failure hints identify the likely cause", () => {
  assert.match(smtpFailureHint("EAUTH", 535), /app password.*SMTP_USER.*2-Step/);
  assert.match(smtpFailureHint("ESOCKET", undefined), /587 with SMTP_SECURE=false/);
  assert.match(smtpFailureHint("ETIMEDOUT", undefined), /outbound port/);
});
