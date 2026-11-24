// 작업 스레드: 파이썬 준비와 합치기를 여기서 돌려, 그동안에도 화면이 움직이게 한다.
// 실행기·라이브러리는 모두 이 사이트(lib/)에서 받는다.
const BASE = new URL('./', location.href).href;
const PYODIDE = BASE + 'lib/pyodide-0.26.4/';
importScripts(PYODIDE + 'pyodide.js');

let py = null;
const ready = (async () => {
  py = await loadPyodide({ indexURL: PYODIDE });
  await py.loadPackage(['pillow', BASE + 'lib/pypdf-6.21.4-py3-none-any.whl'], { checkIntegrity: true });
  for (const f of ['pdf_core.py', 'runner.py']) {
    const r = await fetch(BASE + f);
    if (!r.ok) throw new Error(f + ' ' + r.status);
    py.FS.writeFile('/home/pyodide/' + f, new Uint8Array(await r.arrayBuffer()));
  }
  py.runPython('import runner');
  postMessage({ type: 'ready' });
})();
ready.catch((e) => postMessage({ type: 'fail', msg: String(e && e.message || e) }));

function clearIn() {
  try { py.FS.mkdir('/in'); } catch (e) {}
  for (const d of py.FS.readdir('/in')) {
    if (d === '.' || d === '..') continue;
    for (const n of py.FS.readdir('/in/' + d)) if (n !== '.' && n !== '..') py.FS.unlink('/in/' + d + '/' + n);
    py.FS.rmdir('/in/' + d);
  }
}

onmessage = async (e) => {
  await ready;
  const { files, limitMb } = e.data;
  let result;
  let bytes = null;
  try {
    clearIn();
    // 이름이 같은 파일이 서로 덮이지 않게 파일마다 폴더를 따로 둔다
    const names = files.map((f, i) => {
      py.FS.mkdir('/in/' + i);
      py.FS.writeFile('/in/' + i + '/' + f.name, f.bytes);
      return i + '/' + f.name;
    });
    py.globals.set('알림_js', (text) => postMessage({ type: 'step', text }));
    py.globals.set('names_js', py.toPy(names));
    py.globals.set('limit_js', limitMb || 0);
    result = JSON.parse(py.runPython('runner.실행(list(names_js), limit_js, 알림_js)'));
    if (result.ok) bytes = py.FS.readFile('/out.pdf');
    clearIn();
  } catch (err) {
    // 파이썬 쪽에서 예상하지 못한 오류가 나도 화면이 "만드는 중"에 멈추지 않게 결과로 돌려준다
    result = { ok: false, msg: '만드는 중에 오류가 났습니다(' + String(err).split('\n').filter(Boolean).pop().slice(0, 120) + ')' };
    bytes = null;
  }
  postMessage({ type: 'done', result, bytes }, bytes ? [bytes.buffer] : []);
};
