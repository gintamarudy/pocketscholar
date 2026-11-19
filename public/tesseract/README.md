# Vendored Tesseract.js runtime assets (self-hosted, no CDN)

PocketScholar's photo OCR runs fully on-device with Tesseract.js v6.0.1.
These files are served from our own origin so OCR works offline after the
first scan (the app never fetches OCR code or language data from a CDN).

- `worker.min.js` — tesseract.js v6.0.1 web worker
  (npm `tesseract.js@6.0.1`, `dist/worker.min.js`)
- `tesseract-core-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js` —
  tesseract.js-core v6.0.0 (LSTM-only builds; the worker picks SIMD vs
  non-SIMD at runtime). The `.wasm.js` files embed the WASM binary as
  base64, so no sibling `.wasm` files are needed.
- `lang/eng.traineddata.gz`, `lang/ind.traineddata.gz` — tessdata_fast
  (tesseract-ocr/tessdata_fast, 4.0.0_fast), downloaded from
  https://tessdata.projectnaptha.com/4.0.0_fast/ (the same source
  tesseract.js uses by default). On first use the worker caches them in
  IndexedDB, so later scans work offline.

To refresh: `npm install tesseract.js@6` then re-copy the files above and
re-download the traineddata. No build step reads this directory — Vite
copies `public/` verbatim into `dist/`.
