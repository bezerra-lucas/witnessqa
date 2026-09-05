# Security and evidence privacy

WitnessQA treats credentials, browser sessions and captured product data as
sensitive. A passing test is not permission to publish its raw artifacts.

## Credentials

Scenario files must reference environment variables for login fields:

```yaml
steps:
  - fill: { selector: "input[type=email]", value: $APP_QA_EMAIL }
  - fill: { selector: "input[type=password]", value: $APP_QA_PASSWORD }
```

Provide those variables through a CI secret store or an ephemeral process
environment. Never commit their values, pass them on a command line, paste them
into an issue, or save them in a report. Missing variables make the step fail
without printing their value.

`witnessqa login` stores Playwright `storageState` under `.witness/auth`. That
file can contain cookies and tokens and is therefore equivalent to a credential.
On POSIX systems, WitnessQA creates the directory as `0700` and the state file
as `0600`. On Windows, keep the workspace under a private user profile and use
equivalent ACLs. In every environment, keep the directory ignored, do not upload
it, and delete it when the session is no longer needed.

## Sanitized evidence boundary

Every new run is marked with `privacyVersion: 1` and goes through one evidence
guard before persistence or external transmission:

- every `fill.value` is replaced, regardless of selector or content;
- HTML removes scripts and form values, masks configured elements, and redacts
  common credentials and PII patterns;
- screenshots mask form controls, editable regions, iframes, known filled
  values and elements marked with `data-witness-redact`;
- result JSON, Markdown reports, notifications, URLs and BYOK diagnostics are
  sanitized again at their sink;
- the report packer omits legacy screenshots without a privacy-version marker.
- CI creates a new allowlisted upload bundle, rejects traversal/symlinks and
  regenerates its HTML report instead of copying historical reports.
- visual diffs accept only referenced, privacy-versioned regular PNG files and
  render changed-pixel masks; unchanged source pixels are never copied forward.
- the local report server resolves only regular files contained in the selected
  run directory and rejects traversal or symlink resources.

Add selectors for PII rendered outside form controls:

```yaml
redaction:
  selectors:
    - "[data-customer-name]"
    - ".billing-address"
```

Application code may use `data-witness-redact` for stable masking. Custom
selectors only extend the defaults; they cannot disable them. If HTML or image
sanitization fails, WitnessQA omits that artifact instead of retrying without
protection.

No generic tool can recognize every name, address or sensitive pixel without
application context. Before publishing a dossier, inspect it and add selectors
for the tested application. Raw or historical evidence must remain private.

## BYOK

BYOK is optional. By default it sends only an allowlisted, sanitized diagnostic
summary. Sanitized HTML is excluded unless
`WITNESS_BYOK_INCLUDE_HTML=true` is explicitly set. Non-local provider endpoints
must use HTTPS. Provider responses are schema-limited, truncated and sanitized
before entering reports.

## Migration after the 2026-09 disclosure

The credentials found in tracked Domod scenarios were rotated and invalidated.
The current tree now uses environment references, and the tracked text demo is
synthetic. Previously exposed values must never be reused.

The invalid values still exist in public Git history and possibly in forks or
caches. Rewriting published history is a separate, coordinated and destructive
operation: revoke first, notify collaborators, rewrite all affected refs, force
push once, and require fresh clones. Rotation is the security boundary; history
rewriting only reduces accidental rediscovery.

Delete old local runs, auth state and copied artifacts after migration. Regenerate
public demos exclusively from synthetic fixtures through the current privacy
guard.
