#!/usr/bin/env node
// Copies the in-browser PDF reader (pdf.js) and OCR engine (Tesseract.js) from
// node_modules into vendor/, so the site serves them itself (CSP 'self') and
// nothing is fetched from a CDN. Run after changing their versions in
// package.json:   node scripts/vendor-ocr.js
// Prints a sha384 per file so a diff of the vendored copies is easy to review.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const NM = path.join(ROOT, "node_modules");
const version = (pkg) => JSON.parse(fs.readFileSync(path.join(NM, pkg, "package.json"), "utf8")).version;

const PDFJS = `vendor/pdfjs-${version("pdfjs-dist")}`;
const TESS = `vendor/tesseract-${version("tesseract.js")}`;

// Tesseract runs its LSTM engine only (OEM 1), so only the LSTM cores are needed;
// the worker picks relaxed-SIMD, SIMD or plain by what the browser supports.
const COPIES = [
  ["pdfjs-dist/build/pdf.min.mjs", `${PDFJS}/pdf.min.mjs`],
  ["pdfjs-dist/build/pdf.worker.min.mjs", `${PDFJS}/pdf.worker.min.mjs`],
  ["pdfjs-dist/LICENSE", `${PDFJS}/LICENSE`],
  ["tesseract.js/dist/tesseract.min.js", `${TESS}/tesseract.min.js`],
  ["tesseract.js/dist/worker.min.js", `${TESS}/worker.min.js`],
  ["tesseract.js/LICENSE.md", `${TESS}/LICENSE.md`],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", `${TESS}/core/tesseract-core-lstm.wasm.js`],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", `${TESS}/core/tesseract-core-simd-lstm.wasm.js`],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", `${TESS}/core/tesseract-core-relaxedsimd-lstm.wasm.js`],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", `${TESS}/lang/eng.traineddata.gz`],
];

for (const dir of fs.readdirSync(path.join(ROOT, "vendor"))) {
  if (/^(pdfjs|tesseract)-\d/.test(dir) && ![PDFJS, TESS].includes(`vendor/${dir}`)) {
    fs.rmSync(path.join(ROOT, "vendor", dir), { recursive: true, force: true }); // an older version
  }
}

for (const [from, to] of COPIES) {
  const src = path.join(NM, from);
  const dest = path.join(ROOT, to);
  if (!fs.existsSync(src)) {
    // Licence file names differ between releases; the code files must exist.
    if (/LICENSE/.test(from)) continue;
    console.error(`missing ${from} — run npm install first`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  const hash = crypto.createHash("sha384").update(fs.readFileSync(dest)).digest("base64");
  console.log(`${to}  sha384-${hash}`);
}
