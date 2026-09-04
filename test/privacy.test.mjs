import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createEvidenceGuard, preparePrivateDirectory, PRIVACY_VERSION, REDACTED, securePrivateFile } from "../worker/src/privacy.mjs";

const secret = "unit-test-private-value";
const email = "private.person@example.test";

function guard() {
  return createEvidenceGuard({
    scenario: {
      steps: [
        { fill: { selector: "input[type=email]", value: "$LOGIN_EMAIL" } },
        { fill: ["input[type=password]", "$LOGIN_PASSWORD"] },
      ],
      redaction: { selectors: [".customer-name"] },
    },
    env: { LOGIN_EMAIL: email, LOGIN_PASSWORD: secret },
  });
}

test("evidence guard deeply redacts fills, credentials and common PII", () => {
  const safe = guard().redact({
    step: { fill: { selector: "#password", value: secret } },
    arrayStep: { fill: ["#email", email] },
    authorization: `Bearer ${secret}`,
    apiKey: "opaque-api-value",
    APIKey: "opaque-acronym-api-value",
    accessToken: "opaque-access-value",
    JWTToken: "opaque-jwt-value",
    sessionId: "opaque-session-value",
    nested: [`customer=${email}`, "CPF 529.982.247-25", "phone +55 (11) 99999-1234", "card 4111 1111 1111 1111"],
    url: `https://app.test/callback?token=${secret}&page=2`,
    basicAuthUrl: "https://private-user:private-password@app.test/path",
    keyed: { [email]: "visible" },
  });
  const serialized = JSON.stringify(safe);

  assert.equal(safe.step.fill.value, REDACTED);
  assert.equal(safe.arrayStep.fill[1], REDACTED);
  for (const forbidden of [secret, email, "opaque-api-value", "opaque-acronym-api-value", "opaque-access-value", "opaque-jwt-value", "opaque-session-value", "529.982.247-25", "+55 (11) 99999-1234", "4111 1111 1111 1111"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.equal(safe.url, "https://app.test/callback?token=%5BREDACTED%5D&page=2");
  assert.equal(safe.basicAuthUrl, "https://app.test/path");
  assert.ok(Object.hasOwn(safe.keyed, REDACTED));
});

test("evidence guard sanitizes HTML before persistence", () => {
  const html = `<html><body>
    <input name="email" value="${email}">
    <textarea>${secret}</textarea>
    <div data-witness-redact>Private Person</div>
    <iframe srcdoc="${secret}"></iframe>
    <script>window.token = "${secret}"</script>
    <p>${email} · 529.982.247-25</p>
  </body></html>`;
  const safe = guard().sanitizeHtml(html);

  for (const forbidden of [secret, email, "Private Person", "529.982.247-25"]) {
    assert.doesNotMatch(safe, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(safe, /data-witness-redacted/);
});

test("writes are sanitized and carry a privacy version", () => {
  const dir = mkdtempSync(join(tmpdir(), "wq-privacy-"));
  const path = join(dir, "result.json");
  guard().writeJson(path, { failure: { message: secret } });
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);

  assert.doesNotMatch(raw, new RegExp(secret));
  assert.equal(parsed.privacyVersion, PRIVACY_VERSION);
});

test("screenshot capture is fail-closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wq-shot-"));
  const path = join(dir, "unsafe.png");
  const page = {
    locator() { return { kind: "locator" }; },
    getByText() { return { kind: "text" }; },
    async screenshot() { throw new Error("capture failed"); },
  };

  assert.equal(await guard().captureScreenshot(page, path), false);
  assert.equal(existsSync(path), false);
});

test("auth material gets owner-only filesystem permissions", () => {
  const root = mkdtempSync(join(tmpdir(), "wq-auth-"));
  const dir = join(root, "auth");
  preparePrivateDirectory(dir);
  const file = join(dir, "state.json");
  writeFileSync(file, "{}");
  securePrivateFile(file);

  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(file).mode & 0o777, 0o600);
});
