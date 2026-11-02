import { ERROR, REVIEW, OK, points, answerDisplay, confidenceDisplay } from './core.js';
import { download, reportBuffer, sampleFiles } from './report.js';

const $ = id => document.getElementById(id);
let files = [null, null], result = null, worker, ready = false, busy = false, timer, generation = 0;
const classes = { [ERROR]: 'error', [REVIEW]: 'review', [OK]: 'ok' };
const setMessage = (message, error = false) => { $('message').textContent = message; $('message').classList.toggle('error', error); };

function updateButtons() {
  $('check').disabled = !ready || busy;
  for (const id of ['exam','info','expected','sample']) $(id).disabled = busy;
  document.querySelectorAll('[data-drop-index]').forEach(zone => {
    zone.setAttribute('aria-busy', String(busy));
    if (busy) zone.classList.remove('drag-active');
  });
}
function startWorker(preserveMessage = false) {
  ready = false; updateButtons();
  const workerUrl = new URL('./worker.js', import.meta.url);
  workerUrl.searchParams.set('v',__APP_VERSION__);
  const current = new Worker(workerUrl, { type: 'module' });
  worker = current;
  current.onmessage = ({ data }) => {
    if (current !== worker) return;
    if (data.kind === 'ready') { ready = true; updateButtons(); if (!busy && !preserveMessage) setMessage('준비 완료 · 파일을 선택해 주세요. 문서는 서버로 전송하지 않습니다.'); }
    if (data.kind === 'progress') setMessage(data.text);
    if (data.kind === 'result') { clearTimeout(timer); busy = false; result = data.result; render(); updateButtons(); setMessage('점검 완료 · 아래 결과와 추출 미리보기를 원본과 대조해 주세요.'); }
    if (data.kind === 'error') { clearTimeout(timer); busy = false; updateButtons(); setMessage(data.message, true); }
  };
  current.onerror = () => { clearTimeout(timer); busy = false; ready = false; updateButtons(); setMessage('점검 도구를 실행하지 못했습니다. 최신 Edge/Chrome에서 페이지를 다시 열어 주세요.', true); };
}
function invalidate() {
  generation++; result = null; $('results').hidden = true;
  for (const id of ['findings-body','exam-body','info-body','metrics']) $(id).replaceChildren();
}
function showFiles() {
  ['exam', 'info'].forEach((id, i) => $(id + '-name').textContent = files[i] ? files[i].name : '선택한 파일 없음');
}
function acceptFiles(index, candidates) {
  if (busy) { setMessage('점검 중에는 파일을 바꿀 수 없습니다. 완료 후 다시 놓아 주세요.', true); return; }
  const selected = Array.from(candidates || []);
  if (selected.length !== 1) { setMessage('각 영역에 파일을 한 개씩 놓아 주세요. 여러 파일은 한 번에 받지 않습니다.', true); return; }
  const file = selected[0];
  if (!/\.(xlsx|docx|hwpx|hwp|pdf)$/i.test(file.name)) { setMessage('지원 형식은 XLSX, DOCX, HWP 5, HWPX, 텍스트 PDF입니다.', true); return; }
  if (!file.size) { setMessage('빈 파일이나 폴더는 읽을 수 없습니다. 문서 파일 한 개를 선택해 주세요.', true); return; }
  if (file.size > 50*1024*1024) { setMessage('파일은 각각 50MB 이하여야 합니다.', true); return; }
  files[index] = file;
  invalidate(); showFiles();
  setMessage(`${index === 0 ? '시험 원안지' : '문항정보표'}를 선택했습니다. 두 문서를 준비한 뒤 점검을 시작하세요.`);
}
for (const [i, id] of ['exam','info'].entries()) $(id).addEventListener('change', () => {
  const selected = Array.from($(id).files);
  // 같은 파일을 다시 선택해도 change가 발생하고, 실제 File 참조는 앱에서만 관리한다.
  $(id).value = '';
  if (selected.length) acceptFiles(i,selected);
});
const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes('Files');
for (const zone of document.querySelectorAll('[data-drop-index]')) {
  let entered = 0;
  zone.addEventListener('dragenter', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopPropagation(); entered++;
    if (!busy) zone.classList.add('drag-active');
  });
  zone.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
  });
  zone.addEventListener('dragleave', event => {
    if (!hasFiles(event)) return;
    event.stopPropagation(); entered = Math.max(0,entered-1);
    if (!entered) zone.classList.remove('drag-active');
  });
  zone.addEventListener('drop', event => {
    event.preventDefault(); event.stopPropagation(); entered = 0; zone.classList.remove('drag-active');
    if (busy) { setMessage('점검 중에는 파일을 바꿀 수 없습니다. 완료 후 다시 놓아 주세요.',true); return; }
    if (!hasFiles(event)) { setMessage('링크나 글이 아닌 PC의 문서 파일을 놓아 주세요.',true); return; }
    const items = Array.from(event.dataTransfer.items || []);
    if (items.some(item => item.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory)) { setMessage('폴더는 지원하지 않습니다. 폴더 안의 문서 파일 한 개를 놓아 주세요.',true); return; }
    acceptFiles(Number(zone.dataset.dropIndex),event.dataTransfer.files);
  });
}
// 영역 밖으로 놓아도 브라우저가 문서로 이동해 기존 결과를 잃지 않도록 막는다.
document.addEventListener('dragover', event => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'none'; } });
document.addEventListener('drop', event => {
  event.preventDefault();
  setMessage(busy ? '점검이 끝난 뒤 원안지 또는 문항정보표 영역에 파일을 놓아 주세요.' : '위의 시험 원안지 또는 문항정보표 영역에 파일을 한 개씩 놓아 주세요.',true);
});
$('expected').addEventListener('input', () => { invalidate(); setMessage('기준 총점이 바뀌었습니다. 다시 점검해 주세요.'); });
$('sample').addEventListener('click', async () => {
  const token = generation; $('sample').disabled = true;
  try {
    const samples = await sampleFiles(true);
    if (token !== generation) return;
    files = samples; $('exam').value = ''; $('info').value = ''; $('expected').value = '100';
    invalidate(); showFiles(); setMessage('가상 원안지와 오류 정보표를 준비했습니다. ‘두 문서 점검하기’를 눌러 주세요.');
  } catch { setMessage('가상 예제를 만들지 못했습니다. 페이지를 다시 열어 주세요.', true); }
  finally { updateButtons(); }
});
$('check').addEventListener('click', async () => {
  if (busy || !ready) return;
  if (!files.every(Boolean)) { setMessage('시험 원안지와 문항정보표를 각각 선택해 주세요.', true); return; }
  if (files.some(f => f.size > 50 * 1024 * 1024)) { setMessage('파일은 각각 50MB 이하여야 합니다.', true); return; }
  if (!points($('expected').value)) { setMessage('교사 지정 기준 총점은 0보다 크고 10,000 이하인 숫자로 입력해 주세요.', true); return; }
  invalidate(); busy = true; updateButtons(); setMessage('파일을 브라우저 안에서 읽고 있습니다…');
  const token = generation;
  timer = setTimeout(() => { worker.terminate(); busy = false; invalidate(); setMessage('파일 처리 시간을 초과했습니다. 필요한 문항 표만 별도 파일로 준비한 뒤 다시 시도하세요.', true); startWorker(true); }, 45000);
  try {
    const [e, i] = await Promise.all(files.map(f => f.arrayBuffer()));
    if (token !== generation || !busy) return;
    // 같은 파일을 이름만 달리 선택한 경우도 정상 비교로 오인하지 않는다.
    const left = new Uint8Array(e), right = new Uint8Array(i);
    if (left.length === right.length && left.every((v, n) => v === right[n])) throw new Error('같은 내용의 파일을 두 번 선택했습니다. 서로 다른 원안지와 문항정보표를 선택해 주세요.');
    worker.postMessage({ kind: 'check', exam: { name: files[0].name, buffer: e }, info: { name: files[1].name, buffer: i }, expected: $('expected').value }, [e, i]);
  } catch (error) { clearTimeout(timer); busy = false; updateButtons(); setMessage(error.message || '파일을 읽을 수 없습니다. 다시 선택해 주세요.', true); }
});
$('clear').addEventListener('click', () => { invalidate(); files = [null,null]; $('exam').value = ''; $('info').value = ''; showFiles(); worker.terminate(); startWorker(true); setMessage('선택한 파일과 결과를 화면에서 지웠습니다.'); });
$('filter').addEventListener('change', renderFindings);
for (const name of ['findings','exam','info']) $('tab-' + name).addEventListener('click', () => selectTab(name));
function selectTab(name) {
  for (const n of ['findings','exam','info']) { $('view-' + n).hidden = n !== name; $('tab-' + n).classList.toggle('active', n === name); $('tab-' + n).setAttribute('aria-selected', String(n === name)); }
}
function td(value) { const cell = document.createElement('td'); cell.textContent = value; return cell; }
function badge(status) { const b = document.createElement('span'); b.className = 'badge ' + classes[status]; b.textContent = status; return b; }
function renderFindings() {
  $('findings-body').replaceChildren(); if (!result) return;
  const rank = { [ERROR]: 0, [REVIEW]: 1, [OK]: 2 };
  for (const f of result.findings.filter(f => $('filter').value === '전체' || f.status === $('filter').value).sort((a,b) => rank[a.status] - rank[b.status])) {
    const tr = document.createElement('tr'), status = td(''); status.append(badge(f.status));
    tr.append(status, td(f.number), td(f.title), td(f.message));
    const e = td(''), details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
    summary.textContent = '원문 근거 보기';
    pre.textContent = [['시험 원안지', result.exam, f.examEvidence], ['문항정보표', result.info, f.infoEvidence]].map(([label, doc, items]) => `${label}: ${doc.name}\n추출: ${doc.method}\n${items.map(e => `${e.location}\n${e.text}`).join('\n\n') || '대응하는 추출 근거 없음 — 원문 확인 필요'}`).join('\n\n');
    details.append(summary, pre); e.append(details); tr.append(e); $('findings-body').append(tr);
  }
}
function render() {
  $('results').hidden = false; $('metrics').replaceChildren();
  for (const status of [ERROR, REVIEW, OK]) { const card = document.createElement('div'), count = document.createElement('strong'), label = document.createElement('span'); card.className = 'metric ' + classes[status]; label.textContent = status; count.textContent = result.findings.filter(f => f.status === status).length; card.append(label,count); $('metrics').append(card); }
  $('coverage').textContent = `추출 행: 원안지 ${result.exam.questions.length}개 / 정보표 ${result.info.questions.length}개 · 위 숫자는 문항 수가 아닌 점검 항목 수입니다. 번호·정답·배점은 추출 탭에서 확인하세요.`;
  $('coverage-details').textContent=(result.summary||[]).join('\n');
  $('coverage-details').hidden=!(result.summary?.length);
  renderFindings();
  for (const [name, doc] of [['exam', result.exam], ['info', result.info]]) {
    $(name + '-body').replaceChildren();
    for (const q of doc.questions) { const tr = document.createElement('tr'); tr.append(td(q.number),td(answerDisplay(q)),td(q.points ?? '읽지 못함'),td(confidenceDisplay(q)),td(`${q.evidence.location}\n${q.evidence.text}`)); $(name + '-body').append(tr); }
  }
  selectTab('findings');
}
$('export').addEventListener('click', async () => {
  if (!result) return;
  const current = result, token = generation; $('export').disabled = true;
  try { const buffer = await reportBuffer(current); if (token === generation) { download(buffer, '시험출제_점검보고서.xlsx'); setMessage('보고서를 PC에 내려받았습니다. 원문 근거가 포함되어 있으니 안전하게 보관하세요.'); } }
  catch { setMessage('보고서를 만들지 못했습니다. 브라우저 다운로드 권한을 확인해 주세요.', true); }
  finally { $('export').disabled = false; }
});
// 로컬 문서에는 innerHTML/eval/브라우저 저장소/API를 사용하지 않는다.
if (!window.Worker || !window.File || !window.BigInt) setMessage('최신 Edge 또는 Chrome을 사용해 주세요.', true);
else startWorker();
