import * as pdfjs from './lib/pdfjs-4.4.168/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./lib/pdfjs-4.4.168/pdf.worker.min.mjs', import.meta.url).href;

const $ = (id) => document.getElementById(id);
const items = [];               // {file, bytes, kind, pages, bad}
let readySec = null;
const t0 = performance.now();
const mb = (n) => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + 'KB' : (n / 1048576).toFixed(1) + 'MB';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SVG = (d, w = 16) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const UP = SVG('<path d="M6 15l6-6 6 6"/>'), DOWN = SVG('<path d="M6 9l6 6 6-6"/>');
const GRIP = '<svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true"><circle cx="2" cy="3" r="1.4"/><circle cx="8" cy="3" r="1.4"/><circle cx="2" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="2" cy="13" r="1.4"/><circle cx="8" cy="13" r="1.4"/></svg>';

// 화면 테마(사이트와 같은 저장 값을 쓴다)
const THEMES = ['light', 'sepia', 'dark'];
const ICON = {
  light: SVG('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>', 20),
  sepia: SVG('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>', 20),
  dark: SVG('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>', 20),
};
const curTheme = () => THEMES.includes(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'light';
const paintTheme = () => { $('theme').innerHTML = ICON[curTheme()]; };
$('theme').onclick = () => {
  const next = THEMES[(THEMES.indexOf(curTheme()) + 1) % THEMES.length];
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch (e) {}
  paintTheme();
};
paintTheme();

// 파이썬 작업 스레드
const worker = new Worker(new URL('./worker.js', import.meta.url));
let onStep = null, resolveRun = null;
const ready = new Promise((res, rej) => {
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'ready') res((performance.now() - t0) / 1000);
    else if (m.type === 'step') onStep && onStep(m.text);
    else if (m.type === 'done') resolveRun({ result: m.result, bytes: m.bytes });
    else if (m.type === 'fail') rej(new Error(m.msg));
  };
  worker.onerror = (e) => {
    rej(new Error(e.message || '작업 스레드 오류'));
    // 만드는 중에 스레드가 죽어도(메모리 부족 등) 화면이 멈추지 않게 한다
    if (resolveRun) resolveRun({ result: { ok: false, msg: '만드는 중에 오류가 났습니다. 파일을 나눠 넣어 주세요' }, bytes: null });
  };
});
function run(files, limitMb, step) {
  onStep = step;
  return new Promise((res) => { resolveRun = res; worker.postMessage({ files, limitMb }); });
}

// 1 처음: 준비 중 표시
const openedOffline = !navigator.onLine;
const tick = setInterval(() => {
  if (readySec === null) $('status').textContent = `파이썬 준비 중 · ${((performance.now() - t0) / 1000).toFixed(0)}초 (그동안 파일은 넣어 둘 수 있습니다)`;
}, 500);
ready.then((sec) => {
  readySec = sec;
  clearInterval(tick);
  $('status').className = 'status ok';
  $('status').innerHTML = `준비됨 (${sec.toFixed(1)}초) · 파일은 이 기기 밖으로 나가지 않습니다<small id="offline"></small>`;
  if (openedOffline) $('offline').textContent = '인터넷 없이 열었습니다';
  window.__readySec = sec;
  refresh();
  saveForOffline();
}).catch((e) => {
  clearInterval(tick);
  $('status').className = 'status fail';
  $('status').textContent = '파이썬을 불러오지 못했습니다. 인터넷을 확인하고 새로고침해 주세요. (' + e.message.slice(0, 100) + ')';
});

// 준비가 끝난 다음 도구 파일을 브라우저에 저장해 둔다(이 폴더 안에서만, 넣은 PDF·사진은 저장하지 않음)
function saveForOffline() {
  if (!('serviceWorker' in navigator)) return;
  const done = () => { window.__offlineReady = true; if (!openedOffline) $('offline').textContent = '다음부터는 인터넷 없이도 열 수 있습니다'; };
  navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  navigator.serviceWorker.ready.then(done).catch(() => {});
}

// 2 파일 넣음
$('drop').onclick = () => $('pick').click();
$('pick').onchange = (e) => { add([...e.target.files]); e.target.value = ''; };
$('drop').ondragover = (e) => { e.preventDefault(); $('drop').classList.add('over'); };
$('drop').ondragleave = () => $('drop').classList.remove('over');
$('drop').ondrop = (e) => { e.preventDefault(); $('drop').classList.remove('over'); add([...e.dataTransfer.files]); };
$('order').onchange = () => { sortIfName(); render(); };

async function add(files) {
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = /\.pdf$/i.test(file.name) ? 'pdf' : /\.(jpe?g|png)$/i.test(file.name) ? 'photo' : 'other';
    const it = { file, bytes, kind, pages: kind === 'photo' ? 1 : null, bad: null, why: null, thumb: null };
    items.push(it);
    if (kind === 'other') {
      it.bad = 'PDF, JPG, PNG만 넣을 수 있습니다. 이 파일만 빼고 합칩니다.'; it.why = 'type';
    } else if (kind === 'photo') {
      it.thumb = URL.createObjectURL(file);  // 브라우저가 사진 회전 정보대로 세워 보여 준다
    } else {
      try {
        const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false }).promise;
        it.pages = doc.numPages;
        const page = await doc.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const v2 = page.getViewport({ scale: 120 / Math.max(vp.width, vp.height) });
        const c = document.createElement('canvas');
        c.width = v2.width; c.height = v2.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: v2 }).promise;
        it.thumb = c;
        doc.destroy();
      } catch (e) {
        if (e.name === 'PasswordException') { it.bad = '암호가 걸려 있어 넣을 수 없습니다. 이 파일만 빼고 합칩니다.'; it.why = 'pw'; }
        else { it.bad = '파일이 깨져 있어 열 수 없습니다. 이 파일만 빼고 합칩니다.'; it.why = 'broken'; }
      }
    }
  }
  sortIfName();
  render();
}

function sortIfName() {
  if ($('order').value === 'name') items.sort((a, b) => a.file.name.localeCompare(b.file.name, 'ko', { numeric: true }));
}

function render() {
  const ul = $('list');
  ul.innerHTML = '';
  items.forEach((it, i) => {
    const li = document.createElement('li');
    li.className = 'row' + (it.bad ? ' bad' : '');
    const th = document.createElement('div');
    th.className = 'thumb';
    if (it.thumb instanceof HTMLCanvasElement) th.appendChild(it.thumb);
    else if (it.thumb) { const im = document.createElement('img'); im.src = it.thumb; im.alt = ''; th.appendChild(im); }
    else th.textContent = it.why === 'pw' ? '암호' : it.bad ? '없음' : '…';
    const info = document.createElement('div');
    info.className = 'info';
    const meta = it.kind === 'photo' ? `사진 → 1쪽 · ${mb(it.file.size)}` : it.kind === 'other' ? `넣을 수 없는 파일 · ${mb(it.file.size)}` : it.bad ? `PDF · ${mb(it.file.size)}` : `PDF · ${it.pages}쪽 · ${mb(it.file.size)}`;
    info.innerHTML = `<div class="name"></div><div class="meta">${meta}${it.kind === 'photo' ? '<span class="tag">자동으로 세움</span>' : ''}</div>` + (it.bad ? `<div class="err">${it.bad}</div>` : '');
    info.querySelector('.name').textContent = it.file.name;
    info.querySelector('.name').title = it.file.name;
    const btns = document.createElement('div');
    btns.className = 'btns';
    if (!it.bad) btns.innerHTML = `<button type="button" title="위로" aria-label="위로">${UP}</button><button type="button" title="아래로" aria-label="아래로">${DOWN}</button>`;
    btns.insertAdjacentHTML('beforeend', '<button type="button" class="out" title="빼기">빼기</button>');
    const bs = btns.querySelectorAll('button');
    if (!it.bad) { bs[0].onclick = () => move(i, -1); bs[1].onclick = () => move(i, 1); }
    bs[bs.length - 1].onclick = () => { if (typeof it.thumb === 'string') URL.revokeObjectURL(it.thumb); items.splice(i, 1); render(); };
    const no = document.createElement('div'); no.className = 'no'; no.textContent = i + 1;
    const grip = document.createElement('div'); grip.className = 'grip'; grip.title = '끌어서 순서 바꾸기'; grip.innerHTML = GRIP;
    grip.onpointerdown = (e) => startDrag(e, li);
    li._item = it;
    li.append(grip, no, th, info, btns);
    ul.appendChild(li);
  });
  refresh();
}

// 줄 왼쪽 손잡이를 잡고 끌면 순서가 바뀐다(마우스와 손가락 모두 pointer 이벤트로 받는다)
function startDrag(e, li) {
  e.preventDefault();
  const ul = $('list');
  li.classList.add('dragging');
  // 줄을 옮기면 손잡이가 문서에서 잠깐 빠졌다 들어가 포인터를 놓친다. 그래서 움직임은 창 전체에서 받는다.
  const onMove = (ev) => {
    let before = null;
    for (const r of ul.children) {
      if (r === li) continue;
      const b = r.getBoundingClientRect();
      if (ev.clientY < b.top + b.height / 2) { before = r; break; }
    }
    if (li.nextSibling !== before) ul.insertBefore(li, before);
  };
  const onEnd = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onEnd);
    window.removeEventListener('pointercancel', onEnd);
    li.classList.remove('dragging');
    const order = [...ul.children].map((r) => r._item);
    if (order.some((x, k) => x !== items[k])) { items.splice(0, items.length, ...order); $('order').value = 'list'; }
    render();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onEnd);
  window.addEventListener('pointercancel', onEnd);
}

function move(i, d) {
  const j = i + d;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  $('order').value = 'list';
  render();
}

// 다 만든 뒤에는 만들기 버튼을 숨겨 내려받기 버튼 옆에 다른 버튼이 없게 한다.
// 목록·순서·용량이 바뀌면 완료 표시를 지우고 만들기 버튼을 다시 보인다.
const sig = () => items.map((it) => it.file.name + ':' + it.file.size + ':' + it.file.lastModified).join('|') + '#' + $('limit').value;
let doneSig = null, doneUrl = null;
$('limit').onchange = () => refresh();

function refresh() {
  const usable = items.filter((it) => !it.bad);
  const area = $('area');
  $('make').disabled = readySec === null || usable.length === 0 || !!area.dataset.busy;
  if (area.dataset.done && sig() !== doneSig) { delete area.dataset.done; area.innerHTML = ''; }
  $('make').hidden = !!area.dataset.done;
  if (area.dataset.done || area.dataset.busy) return;
  if (items.some((it) => it.bad)) {
    const of = (w) => items.filter((it) => it.why === w).map((it) => esc(it.file.name)).join(', ');
    const lines = [];
    if (of('pw')) lines.push(`암호가 걸린 파일: ${of('pw')}. 이 파일을 연 프로그램에서 암호를 풀고 다시 저장한 뒤 넣어 주세요.`);
    if (of('broken')) lines.push(`깨져서 열리지 않는 파일: ${of('broken')}. 원래 파일을 다시 받아 넣어 주세요.`);
    if (of('type')) lines.push(`PDF나 사진이 아닌 파일: ${of('type')}.`);
    area.innerHTML = `<div class="msg">${lines.join('<br>')} 나머지 ${usable.length}개는 그대로 합칠 수 있습니다.</div>`;
  } else area.innerHTML = '';
}

// 4 만드는 중 → 5 완료 / 6 오류
$('make').onclick = async () => {
  const usable = items.filter((it) => !it.bad);
  const limit = Number($('limit').value);
  const area = $('area');
  const startSig = sig();
  area.dataset.busy = '1'; delete area.dataset.done;
  $('make').disabled = true;
  const start = performance.now();
  area.innerHTML = `<div class="progress"><div class="now">만드는 중 · <span id="sec">0</span>초</div><div>목표 ${limit ? limit + 'MB 이하' : '제한 없음'}</div><ol id="steps"></ol></div>`;
  const timer = setInterval(() => { const s = document.getElementById('sec'); if (s) s.textContent = ((performance.now() - start) / 1000).toFixed(0); }, 250);
  const steps = [];
  const step = (text) => { steps.push(text); const ol = document.getElementById('steps'); if (ol) ol.innerHTML = steps.map((s) => `<li>${esc(s)}</li>`).join(''); };
  window.__steps = steps;
  await new Promise((r) => setTimeout(r, 50));
  const { result, bytes } = await run(usable.map((it) => ({ name: it.file.name, bytes: it.bytes })), limit, step);
  resolveRun = null;
  clearInterval(timer);
  const sec = (performance.now() - start) / 1000;
  window.__result = { ...result, wall: sec };
  delete area.dataset.busy;
  if (!result.ok) {
    area.innerHTML = `<div class="msg">${esc(result.msg)}. ${limit ? '결과 용량을 한 단계 올리거나 스캔 파일을 나눠 주세요.' : ''} 나머지 설정은 그대로 두었습니다.</div>`;
    $('make').disabled = false;
    return;
  }
  area.dataset.done = '1';
  if (doneUrl) URL.revokeObjectURL(doneUrl);
  doneUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  area.innerHTML = `<div class="done"><dl>
    <dt>쪽수</dt><dd>${result.pages}쪽</dd>
    <dt>용량</dt><dd>${mb(result.size)}${limit ? ` (목표 ${limit}MB 이하)` : ''}</dd>
    <dt>목차·링크</dt><dd>목차 ${result.outline}개 · 링크 ${result.links}개 남음</dd>
    <dt>걸린 시간</dt><dd>${sec.toFixed(1)}초</dd>
    <dt>만든 곳</dt><dd>이 기기 안(서버로 보내지 않음)</dd>
    </dl><a class="down" href="${doneUrl}" download="합친파일.pdf">내려받기</a>
    <p class="note">파일을 더 넣거나 순서·용량을 바꾸면 다시 만들 수 있습니다.</p></div>`;
  doneSig = startSig;
  refresh();
};
