/* PDF intake — reading (browser only). Opens the planner's PDF on their own
 * computer: pdf.js takes each page's text layer; pages without text (scans,
 * image-only drawings) are rendered and read with Tesseract OCR. Both libraries
 * are self-hosted under vendor/ and load only when a PDF is chosen. The file
 * never leaves the browser.
 *
 *   DocReader.read(file, { onProgress({ page, pages, source }), signal })
 *     -> Promise<{ name, pages: [{ index, source: "text"|"ocr", items }], totalPages, truncated }>
 *   item = { str, x, y, w, h, rot, conf } (page units; y = text baseline, downward; conf 0–1)
 *   Text pages: up to LIMITS.pages. OCR (slow, memory-heavy) runs on at most
 *   LIMITS.ocrPages pages; later textless pages are skipped and counted.
 *   Errors are DocReader.DocReadError with kind:
 *     too_large | not_pdf | encrypted | unreadable | cancelled
 * Browser: window.DocReader.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.DocReader = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Every vendored path lives here (scripts/vendor-ocr.js writes these folders).
  const VENDOR = { pdfjs: "vendor/pdfjs-6.5.438/", tesseract: "vendor/tesseract-7.0.0/" };
  // ocrPixels: browsers (Safari/iOS especially) refuse canvases much over ~16 MP;
  // large drawings (A0/A1) are rendered at a lower scale to stay under it.
  const LIMITS = { bytes: 25 * 1024 * 1024, pages: 200, ocrPages: 40, minChars: 20, ocrScale: 2.5, ocrPixels: 16e6 };

  class DocReadError extends Error {
    constructor(kind, message) {
      super(message || kind);
      this.name = "DocReadError";
      this.kind = kind;
    }
  }

  const abs = (p) => new URL(p, document.baseURI).href;
  const yieldToPage = () => new Promise((r) => setTimeout(r, 0));

  let pdfjsLoading = null;
  function loadPdfjs() {
    if (!pdfjsLoading) {
      pdfjsLoading = import(abs(VENDOR.pdfjs + "pdf.min.mjs")).then((m) => {
        m.GlobalWorkerOptions.workerSrc = abs(VENDOR.pdfjs + "pdf.worker.min.mjs");
        return m;
      });
      pdfjsLoading.catch(() => { pdfjsLoading = null; });
    }
    return pdfjsLoading;
  }

  let tesseractLoading = null;
  function loadTesseract() {
    if (!tesseractLoading) {
      tesseractLoading = new Promise((resolve, reject) => {
        if (window.Tesseract) return resolve(window.Tesseract);
        const s = document.createElement("script");
        s.src = VENDOR.tesseract + "tesseract.min.js";
        s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error("OCR engine did not load")));
        s.onerror = () => reject(new Error("OCR engine did not load"));
        document.head.appendChild(s);
      });
      tesseractLoading.catch(() => { tesseractLoading = null; });
    }
    return tesseractLoading;
  }

  async function createOcrWorker() {
    const T = await loadTesseract();
    // Absolute URLs: the worker resolves relative paths against its own script.
    return T.createWorker("eng", 1, {
      workerPath: abs(VENDOR.tesseract + "worker.min.js"),
      corePath: abs(VENDOR.tesseract + "core"),
      langPath: abs(VENDOR.tesseract + "lang"),
      workerBlobURL: false, // blob: workers are blocked by the CSP
      gzip: true,
      cacheMethod: "none", // nothing about the document (or the model) is stored in the browser
    });
  }

  async function startsLikePdf(file) {
    const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
    const text = String.fromCharCode(...head);
    return text.includes("%PDF-");
  }

  // Text layer -> items; the viewport transform handles rotated pages. y is
  // the baseline: text of different sizes in one table row shares it.
  function textItems(pdfjs, content, viewport) {
    return content.items.filter((it) => it.str && it.str.trim()).map((it) => {
      const t = pdfjs.Util.transform(viewport.transform, it.transform);
      const h = Math.hypot(t[2], t[3]) || it.height || 10;
      return { str: it.str, x: t[4], y: t[5], w: it.width * viewport.scale, h, rot: Math.atan2(t[1], t[0]), conf: 1 };
    });
  }

  // OCR words (pixels at ocrScale) -> items in page units.
  function ocrItems(data, scale) {
    const out = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
      if (!w.text || !w.text.trim()) continue;
      const { x0, y0, x1, y1 } = w.bbox;
      const base = w.baseline && Number.isFinite(w.baseline.y0) ? w.baseline.y0 : y1;
      out.push({ str: w.text, x: x0 / scale, y: base / scale, w: (x1 - x0) / scale, h: (y1 - y0) / scale, rot: 0, conf: Math.max(0, Math.min(1, (w.confidence || 0) / 100)) });
    }
    return out;
  }

  async function read(file, { onProgress, signal } = {}) {
    const report = (p) => { if (onProgress) onProgress(p); };
    const check = () => { if (signal && signal.aborted) throw new DocReadError("cancelled"); };
    if (!file) throw new DocReadError("unreadable");
    if (file.size > LIMITS.bytes) throw new DocReadError("too_large");
    if (!(await startsLikePdf(file))) throw new DocReadError("not_pdf");
    check();

    const pdfjs = await loadPdfjs();
    // pdf.js 6 cleans up through the loading task (the document has no destroy()).
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
    let pdf;
    try {
      pdf = await task.promise;
    } catch (e) {
      task.destroy();
      throw new DocReadError(e && e.name === "PasswordException" ? "encrypted" : "unreadable");
    }

    let worker = null;
    const stop = () => { if (worker) worker.terminate(); };
    if (signal) signal.addEventListener("abort", stop, { once: true });
    const total = Math.min(pdf.numPages, LIMITS.pages);
    const pages = [];
    let ocrDone = 0;
    let ocrSkipped = 0;
    try {
      for (let i = 1; i <= total; i++) {
        check();
        report({ page: i, pages: total, source: "text" });
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1 });
        let items = textItems(pdfjs, await page.getTextContent(), viewport);
        let source = "text";
        const textless = items.reduce((n, it) => n + it.str.replace(/\s/g, "").length, 0) < LIMITS.minChars;
        if (textless && ocrDone >= LIMITS.ocrPages) { ocrSkipped++; source = "skipped"; items = []; }
        else if (textless) {
          ocrDone++;
          source = "ocr";
          report({ page: i, pages: total, source });
          // One page that can't be OCR'd (too big, engine failed to load) is
          // skipped and counted; it never discards the pages already read.
          const scale = Math.min(LIMITS.ocrScale, Math.sqrt(LIMITS.ocrPixels / (viewport.width * viewport.height)));
          const canvas = document.createElement("canvas");
          try {
            const big = page.getViewport({ scale });
            canvas.width = Math.ceil(big.width);
            canvas.height = Math.ceil(big.height);
            const ctx2d = canvas.getContext("2d");
            if (!ctx2d) throw new Error("canvas unavailable");
            await page.render({ canvasContext: ctx2d, viewport: big }).promise;
            check();
            if (!worker) worker = await createOcrWorker();
            check();
            const { data } = await worker.recognize(canvas, {}, { blocks: true, text: false });
            items = ocrItems(data, scale);
          } catch (e) {
            if ((signal && signal.aborted) || e instanceof DocReadError) throw e;
            ocrSkipped++;
            source = "skipped";
            items = [];
          } finally {
            canvas.width = 0; // release the bitmap (phones)
            canvas.height = 0;
          }
        }
        pages.push({ index: i, source, items });
        page.cleanup();
        await yieldToPage();
      }
    } catch (e) {
      if (signal && signal.aborted) throw new DocReadError("cancelled");
      throw e instanceof DocReadError ? e : new DocReadError("unreadable", e && e.message);
    } finally {
      if (signal) signal.removeEventListener("abort", stop);
      if (worker) await worker.terminate().catch(() => {});
      await task.destroy().catch(() => {});
    }
    return { name: file.name, pages, totalPages: pdf.numPages, truncated: pdf.numPages > total, ocrSkipped };
  }

  return { read, DocReadError, LIMITS, VENDOR };
});
