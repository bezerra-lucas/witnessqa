/**
 * Serve o laudo self-contained. Sempre imprime URL http://127.0.0.1.
 * Uso: node src/serve.mjs <run-dir> [porta]
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { safeContainedEvidencePath } from "./safe-evidence-path.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".css": "text/css",
};

export function resolveServedFile(dir, requestUrl) {
  try {
    const raw = decodeURIComponent((requestUrl ?? "/").split("?")[0]);
    const rel = raw === "/" ? "REPORT.html" : raw.replace(/^\/+/, "");
    return safeContainedEvidencePath(dir, rel);
  } catch {
    return null;
  }
}

function serve(dir, port) {
  const server = createServer((req, res) => {
    const file = resolveServedFile(dir, req.url);
    if (!file || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${port}/REPORT.html`);
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const dir = process.argv[2];
  const port = Number(process.argv[3] || process.env.WITNESS_REPORT_PORT || 8765);
  if (!dir || !existsSync(dir)) {
    console.error("uso: node src/serve.mjs <run-dir> [porta]");
    process.exit(1);
  }
  serve(dir, port);
}
