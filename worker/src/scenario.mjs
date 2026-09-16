/**
 * Scenario format (YAML or JSON):
 *
 * name: login-blocked
 * title: Reject invalid credentials
 * flow: { id: authentication, title: Access an account }
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

import { validateMidsceneScenario } from './midscene.mjs';

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
  if (doc.flow !== undefined) {
    const flow = typeof doc.flow === 'string' ? { id: doc.flow, title: doc.flow } : doc.flow;
    if (!flow || Array.isArray(flow) || typeof flow.id !== 'string' || !flow.id.trim() ||
        typeof flow.title !== 'string' || !flow.title.trim() ||
        (flow.description !== undefined && typeof flow.description !== 'string')) {
      throw new Error('Fluxo inválido: use uma string ou { id, title, description? }');
    }
  }
  for (const key of ['title', 'testId']) {
    if (doc[key] !== undefined && (typeof doc[key] !== 'string' || !doc[key].trim())) {
      throw new Error(`Teste inválido: ${key} precisa ser uma string não vazia`);
    }
  }
  if (doc.assertionTimeoutMs !== undefined && (!Number.isInteger(doc.assertionTimeoutMs) || doc.assertionTimeoutMs < 1 || doc.assertionTimeoutMs > 30000)) {
    throw new Error('assertionTimeoutMs must be an integer from 1 to 30000');
  }
  if (doc.ready !== undefined) {
    const ready = typeof doc.ready === 'string' ? { selector: doc.ready } : doc.ready;
    if (!ready || typeof ready.selector !== 'string' || !ready.selector.trim() ||
        (ready.text !== undefined && (typeof ready.text !== 'string' || !ready.text.trim())) ||
        (ready.timeout !== undefined && (!Number.isInteger(ready.timeout) || ready.timeout < 1 || ready.timeout > 30000))) {
      throw new Error('ready must be a selector or { selector, text?, timeout? }');
    }
  }
  for (const step of doc.steps) {
    if (step?.evidence === undefined) continue;
    const evidence = step.evidence;
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
        (evidence.label !== undefined && (typeof evidence.label !== 'string' || !evidence.label.trim())) ||
        (evidence.highlight !== undefined && typeof evidence.highlight !== 'boolean')) {
      throw new Error('Metadados da evidência inválidos: use { label?, highlight? }');
    }
  }
  validateMidsceneScenario(doc);
  return doc;
}
