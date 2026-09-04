import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { investigateFailure } from "../worker/src/byok.mjs";
import { createEvidenceGuard } from "../worker/src/privacy.mjs";

test("BYOK sends only sanitized diagnostics and sanitizes provider output", async () => {
  const secret = "unit-test-byok-private";
  const previousKey = process.env.WITNESS_KEY;
  process.env.WITNESS_KEY = "test-only-key";
  const dir = mkdtempSync(join(tmpdir(), "wq-byok-"));
  writeFileSync(join(dir, "page.html"), `<p>${secret}</p>`);
  const guard = createEvidenceGuard({ additionalSecrets: [secret] });
  let requestBody = "";
  const fetchImpl = async (_url, options) => {
    requestBody = options.body;
    return {
      ok: true,
      async json() {
        return { choices: [{ message: { content: JSON.stringify({
          cause: `provider echoed ${secret}`,
          isBug: true,
          confidence: 0.8,
          suggestion: `remove ${secret}`,
        }) } }] };
      },
    };
  };

  try {
    const result = await investigateFailure({
      name: `flow ${secret}`,
      steps: [{ index: 1, ok: false, step: { fill: { selector: "#password", value: secret } }, detail: secret }],
      consoleErrors: [secret],
      failure: { message: secret },
    }, dir, { fetchImpl, guard });

    assert.ok(requestBody, "the injected provider adapter must receive a request");
    assert.doesNotMatch(requestBody, new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
    assert.doesNotMatch(requestBody, /HTML no momento/);
  } finally {
    if (previousKey === undefined) delete process.env.WITNESS_KEY;
    else process.env.WITNESS_KEY = previousKey;
  }
});

test("BYOK HTML opt-in sends only the sanitized excerpt", async () => {
  const secret = "unit-test-byok-html-private";
  const previousKey = process.env.WITNESS_KEY;
  const previousHtml = process.env.WITNESS_BYOK_INCLUDE_HTML;
  process.env.WITNESS_KEY = "test-only-key";
  process.env.WITNESS_BYOK_INCLUDE_HTML = "true";
  const dir = mkdtempSync(join(tmpdir(), "wq-byok-html-"));
  writeFileSync(join(dir, "page.html"), `<input value="${secret}"><script>window.secret = "${secret}"</script>`);
  const guard = createEvidenceGuard({ additionalSecrets: [secret] });
  let requestBody = "";

  try {
    await investigateFailure({
      name: "html opt-in",
      steps: [{ index: 0, ok: false, step: { expectText: "ready" }, detail: "missing" }],
      consoleErrors: [],
    }, dir, {
      guard,
      fetchImpl: async (_url, options) => {
        requestBody = options.body;
        return {
          ok: true,
          async json() {
            return { choices: [{ message: { content: '{"cause":"safe","isBug":true,"confidence":1,"suggestion":"fix"}' } }] };
          },
        };
      },
    });

    assert.match(requestBody, /HTML no momento/);
    assert.match(requestBody, /\[REDACTED\]|data-witness-redacted/);
    assert.doesNotMatch(requestBody, new RegExp(secret));
  } finally {
    if (previousKey === undefined) delete process.env.WITNESS_KEY;
    else process.env.WITNESS_KEY = previousKey;
    if (previousHtml === undefined) delete process.env.WITNESS_BYOK_INCLUDE_HTML;
    else process.env.WITNESS_BYOK_INCLUDE_HTML = previousHtml;
  }
});
