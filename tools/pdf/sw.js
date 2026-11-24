// scripts/build-tool-pdf.mjs 가 만든 파일. 직접 고치지 않는다.
// 이 폴더(/tools/pdf/) 안의 도구 파일만 저장한다. 사이트의 다른 글에는 관여하지 않는다.
const CACHE = 'pdf-tool-8bd925cfa606';
const FILES = [
 "./",
 "app.css",
 "app.js",
 "fonts/do-hyeon-subset.woff2",
 "fonts/gowun-dodum-subset.woff2",
 "lib/pdfjs-4.4.168/pdf.min.mjs",
 "lib/pdfjs-4.4.168/pdf.worker.min.mjs",
 "lib/pyodide-0.26.4/pillow-10.2.0-cp312-cp312-pyodide_2024_0_wasm32.whl",
 "lib/pyodide-0.26.4/pyodide-lock.json",
 "lib/pyodide-0.26.4/pyodide.asm.js",
 "lib/pyodide-0.26.4/pyodide.asm.wasm",
 "lib/pyodide-0.26.4/pyodide.js",
 "lib/pyodide-0.26.4/python_stdlib.zip",
 "lib/pypdf-6.21.4-py3-none-any.whl",
 "pdf_core.py",
 "runner.py",
 "worker.js"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('pdf-tool-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const scope = new URL(self.registration.scope);
  if (e.request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (e.request.mode === 'navigate') {
    // 화면은 인터넷이 되면 새 것을, 안 되면 저장해 둔 것을 쓴다
    e.respondWith(fetch(e.request).catch(async () => (await caches.match(scope.href, { ignoreSearch: true })) || Response.error()));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(e.request, { ignoreSearch: true })) || fetch(e.request)));
});
