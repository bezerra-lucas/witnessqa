/**
 * Scenario format (YAML or JSON):
 *
 * name: login-blocked
 * app: https://meuapp.com
 * steps:
 *   - goto: /login
 *   - fill: {selector: "#email", value: "test@x.com"}
 *   - click: "button[type=submit]"
 *   - expectUrl: "/dashboard"
 *   - expectVisible: "h1"
 * checks:
 *   - noBrokenImages
 *   - noConsoleErrors
 * viewport: {width: 1440, height: 950}
 */

export function parseScenario(raw, yamlLib) {
  let doc;
  try {
    doc = typeof raw === "string" ? yamlLib.parse(raw) : raw;
  } catch {
    throw new Error("Cenário YAML/JSON inválido");
  }
  if (!doc?.name || !Array.isArray(doc.steps)) {
    throw new Error("Cenário inválido: precisa de `name` e `steps[]`");
  }
  return doc;
}
