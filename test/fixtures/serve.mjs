import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "app");
const port = Number(process.env.PORT || 8765);

http
  .createServer(async (req, res) => {
    let p = (req.url || "/").split("?")[0];
    if (p === "/") p = "/index.html";
    const f = join(root, normalize(p).replace(/^(\.\.(\/|\\|$))+/, ""));
    try {
      const d = await readFile(f);
      res.writeHead(200, { "content-type": extname(f) === ".html" ? "text/html; charset=utf-8" : "text/plain" });
      res.end(d);
    } catch {
      res.writeHead(404);
      res.end("no");
    }
  })
  .listen(port, "127.0.0.1", function () {
    console.log(`fixture http://127.0.0.1:${this.address().port}`);
  });
