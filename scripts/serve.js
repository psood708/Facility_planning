#!/usr/bin/env node
// Serve a build with the same headers Vercel sends (from vercel.json), so the
// CSP and friends are exercised locally. For a LOCAL_BUILD the Supabase origin
// is http://127.0.0.1:54321, which the production CSP does not allow; pass it
// with --allow-connect to add it to connect-src.
//
//   node scripts/serve.js [--dir dist] [--port 8000] [--allow-connect http://127.0.0.1:54321]
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback; };
const dir = path.resolve(arg("--dir", path.join(ROOT, "dist")));
const port = Number(arg("--port", 8000));
const extraConnect = arg("--allow-connect", null);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

function headersFor(urlPath) {
  const out = {};
  for (const block of vercel.headers) {
    const re = new RegExp("^" + block.source.replace(/\./g, "\\.") + "$");
    if (!re.test(urlPath)) continue;
    for (const { key, value } of block.headers) out[key] = value;
  }
  if (extraConnect && out["Content-Security-Policy"]) {
    out["Content-Security-Policy"] = out["Content-Security-Policy"].replace(/connect-src ([^;]*)/, `connect-src $1 ${extraConnect}`);
  }
  delete out["Strict-Transport-Security"]; // meaningless over local http
  return out;
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", ...headersFor(urlPath) });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, "127.0.0.1", () => console.log(`serving ${path.relative(ROOT, dir) || dir} at http://127.0.0.1:${port}/ with vercel.json headers`));
