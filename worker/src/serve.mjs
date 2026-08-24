/**
 * Serve o laudo self-contained. Sempre imprime URL http://127.0.0.1.
 * Uso: node src/serve.mjs <run-dir> [porta]
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";

const dir = process.argv[2];
const port = Number(process.argv[3] || process.env.WITNESS_REPORT_PORT || 8765);
if (!dir || !existsSync(dir)) {
  console.error("uso: node src/serve.mjs <run-dir> [porta]");
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".css": "text/css",
};

const server = createServer((req, res) => {
  const raw = decodeURIComponent((req.url ?? "/").split("?")[0]);
  const rel = raw === "/" ? "REPORT.html" : raw.replace(/^\/+/, "");
  const file = normalize(join(dir, rel));
  if (!file.startsWith(normalize(dir))) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
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
