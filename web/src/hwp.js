// HWP 5 바이너리는 메모리에서만 읽는다. 미리보기 스트림을 본문 대신 사용하지 않는다.
import * as CFB from 'cfb';
import { Inflate } from 'fflate';
import { parseHwp } from 'hwp-convert/browser';
import { document, lineNumber, note, parseRows, row, unknownTable } from './core.js';
import { collectSummaryTable, parseExamText } from './exam-text.js';

export class HwpInputError extends Error {}
const fail = message => { throw new HwpInputError(message); };
const MAX_EXPANDED = 100 * 1024 * 1024;

function boundedInflate(raw, budget) {
  const chunks = []; let length = 0;
  const inflate = new Inflate((chunk) => {
    length += chunk.length; budget.used += chunk.length;
    if (budget.used > budget.limit) fail('HWP 압축 해제 크기가 100MB 지원 한도를 초과했습니다.');
    chunks.push(chunk);
  });
  // 한 번에 전체 압축 데이터를 넘기지 않아 과도한 확장을 조기에 중단한다.
  for (let i = 0; i < raw.length; i += 1024) inflate.push(raw.subarray(i, i+1024), i+1024 >= raw.length);
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

function validateRecords(bytes, budget, body = false) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (offset < bytes.length) {
    if (offset+4 > bytes.length) fail('HWP 레코드가 잘렸습니다. 복사본을 HWPX로 다시 저장해 주세요.');
    const h = view.getUint32(offset, true); offset += 4;
    const tag = h & 0x3ff, level = (h >>> 10) & 0x3ff;
    let size = h >>> 20;
    if (size === 0xfff) {
      if (offset+4 > bytes.length) fail('HWP 확장 레코드 헤더가 손상되었습니다.');
      size = view.getUint32(offset, true); offset += 4;
    }
    if (offset+size > bytes.length) fail('HWP 레코드 크기가 본문을 벗어납니다. 손상 여부를 확인해 주세요.');
    if (level > 64 || ++budget.records > 200000) fail('HWP의 중첩 구조/레코드 수가 지원 한도를 초과했습니다.');
    if (body && tag === 67) {
      budget.text += size;
      if (size % 2 || budget.text > 4 * 1024 * 1024) fail('HWP 텍스트 형식 또는 텍스트 크기가 지원 범위를 벗어났습니다.');
    }
    offset += size;
  }
}

export function preflightHwp(input, maxExpanded = MAX_EXPANDED) {
  const bytes = new Uint8Array(input);
  if (new TextDecoder().decode(bytes.subarray(0,17)) === 'HWP Document File') fail('HWP 97/3.x는 지원하지 않습니다. 한글에서 HWPX 또는 HWP 5 형식으로 다시 저장해 주세요.');
  if (bytes.length < 512 || ![0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1].every((v,i) => bytes[i] === v)) fail('유효한 HWP 5 파일이 아닙니다. 확장자만 바꾼 파일은 지원하지 않습니다.');
  if (bytes.length > 50 * 1024 * 1024) fail('HWP 파일은 50MB 이하여야 합니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorShift = view.getUint16(30,true), major = view.getUint16(26,true);
  if (view.getUint16(28,true) !== 0xfffe || !((major === 3 && sectorShift === 9) || (major === 4 && sectorShift === 12))) fail('HWP 컨테이너 구조를 인식하지 못했습니다. HWPX로 변환해 주세요.');
  const sectorCount = Math.floor(bytes.length / (2 ** sectorShift)) - 1;
  if ([40,44,64,72].some(at => view.getUint32(at,true) > sectorCount)) fail('HWP 컨테이너의 섹터 정보가 손상되었습니다.');
  let container;
  try { container = CFB.read(bytes, { type:'array' }); }
  catch { fail('HWP 컨테이너를 읽지 못했습니다. 손상·암호화 여부를 확인해 주세요.'); }
  if (container.FileIndex.length > 5000) fail('HWP 구성요소가 5,000개 한도를 초과했습니다.');
  const stored = container.FileIndex.reduce((sum, e) => sum + (e.content?.length || 0), 0);
  if (stored > MAX_EXPANDED) fail('HWP 구성요소 크기가 지원 한도를 초과했습니다.');
  const find = path => {
    const entry = CFB.find(container, '/' + path);
    return entry?.type === 2 ? new Uint8Array(entry.content) : null;
  };
  const header = find('FileHeader');
  if (!header || header.length < 256 || new TextDecoder().decode(header.subarray(0,17)) !== 'HWP Document File' || header[17] !== 0) fail('HWP FileHeader가 없거나 손상되었습니다.');
  if (header[35] !== 5 || ![0,1].includes(header[34])) fail('HWP 5.0/5.1 계열만 지원합니다. HWPX로 다시 저장해 주세요.');
  const flags = new DataView(header.buffer,header.byteOffset,header.byteLength).getUint32(36,true);
  if (flags & (2|16|256|1024)) fail('암호화/DRM으로 보호된 HWP는 읽지 않습니다. 권한이 있는 복사본을 보호 해제하거나 HWPX로 저장해 주세요.');
  if (flags & 4) fail('배포용 HWP(ViewText)는 지원하지 않습니다. 편집 가능한 원본 또는 HWPX를 선택해 주세요.');
  const sections = [], names = new Set();
  for (let i = 0; i < container.FullPaths.length; i++) {
    if (container.FileIndex[i]?.type !== 2) continue;
    const path = container.FullPaths[i].replace(/^[^/]+\//,'');
    if (names.has(path.toLowerCase())) fail('HWP에 중복된 구성요소가 있습니다. 복사본을 다시 저장해 주세요.');
    names.add(path.toLowerCase());
    const m = /^BodyText\/Section(\d+)$/.exec(path);
    if (m) sections.push(+m[1]);
  }
  sections.sort((a,b) => a-b);
  if (!sections.length || sections.length > 1000 || sections.some((n,i) => n !== i)) fail('HWP 본문 섹션이 없거나 불연속/지원 한도 초과 상태입니다. HWPX로 다시 저장해 주세요.');
  const budget = { used:0, limit:maxExpanded, records:0, text:0 };
  const bodyOnly = CFB.utils.cfb_new();
  const plainHeader = header.slice();
  new DataView(plainHeader.buffer).setUint32(36,flags & ~1,true);
  CFB.utils.cfb_add(bodyOnly,'FileHeader',plainHeader);
  const unpack = (path, required = true) => {
    const raw = find(path);
    if (!raw) { if (required) fail('HWP 필수 구성요소가 없습니다: ' + path); return null; }
    if (!(flags & 1)) { budget.used += raw.length; if (budget.used > budget.limit) fail('HWP 본문 크기가 지원 한도를 초과했습니다.'); return raw; }
    try { return boundedInflate(raw, budget); }
    catch (error) { if (error instanceof HwpInputError) throw error; fail('HWP 압축 데이터가 손상되었습니다. HWPX로 다시 저장해 주세요.'); }
  };
  const info = unpack('DocInfo'); validateRecords(info,budget); CFB.utils.cfb_add(bodyOnly,'DocInfo',info);
  for (const section of sections) {
    const path = 'BodyText/Section'+section, bytes = unpack(path);
    validateRecords(bytes,budget,true); CFB.utils.cfb_add(bodyOnly,path,bytes);
  }
  // 그림/스크립트/미리보기는 파서에 전달하지 않는다. 메모리 안의 본문 전용 컨테이너이며 원본은 변경하지 않는다.
  return { sections:sections.length, version:`${header[35]}.${header[34]}.${header[33]}.${header[32]}`, body:new Uint8Array(CFB.write(bodyOnly,{type:'array'})) };
}

export function readHwp(buffer, name) {
  const checked = preflightHwp(buffer);
  let source;
  try { source = parseHwp(checked.body); }
  catch { fail('HWP 본문을 해석하지 못했습니다. 한글에서 HWPX로 저장한 복사본으로 다시 시도해 주세요.'); }
  const doc = document(name), lines = [], unknown = [];
  doc.method = `HWP ${checked.version} 로컬 본문·표 추출(확인 필요)`;
  note(doc, 'HWP의 그림·자동번호·복잡한 배치와 문항 내용은 별도 확인이 필요합니다. 명시적으로 읽힌 번호·배점은 항목별 신뢰도로 대조합니다.', { location:name, text:doc.method });
  let tableIndex = 0, matched = false;
  function paragraphs(values, location, body = false, depth = 0) {
    if (depth > 32) fail('HWP 표의 중첩이 지원 한도를 초과했습니다.');
    for (const [pi, p] of values.entries()) {
      if (body && p.text?.trim()) for (const value of p.text.split(/\r?\n/)) if (value.trim()) lines.push({ location:`${location} · 문단 ${pi+1}`,text:value });
      for (const control of p.controls || []) {
        if (control.kind !== 'table') continue;
        const ti = ++tableIndex, at = `${location} · 표 ${ti}`;
        const { rowCount:rc, colCount:cc, cells } = control;
        if (!Number.isInteger(rc) || !Number.isInteger(cc) || rc < 1 || cc < 1 || rc > 20000 || cc > 100 || rc*cc > 100000) { note(doc, 'HWP 표의 행/열 구조가 지원 범위를 벗어났습니다.', { location:at,text:'표 구조 확인 필요' }); continue; }
        const rows = Array.from({length:rc},(_,i) => row(Array(cc).fill(''), `${at} · 행 ${i+1}`));
        const coordinates = new Set(); let bad = false;
        for (const cell of cells) {
          const key = `${cell.row},${cell.col}`;
          if (!Number.isInteger(cell.row) || !Number.isInteger(cell.col) || cell.row < 0 || cell.row >= rc || cell.col < 0 || cell.col >= cc || coordinates.has(key)) { bad = true; continue; }
          coordinates.add(key);
          rows[cell.row].values[cell.col] = cell.paragraphs.map(p => p.text).join('\n').trim();
          if (cell.rowSpan !== 1 || cell.colSpan !== 1 || cell.paragraphs.some(p => p.controls?.some(c => !['sectionDef','columnDef'].includes(c.kind)))) rows[cell.row].reliable = false;
          paragraphs(cell.paragraphs, `${at} · 셀 ${cell.row+1},${cell.col+1}`, false, depth+1);
        }
        for (const r of rows) r.evidence.text = r.values.join(' | ');
        if (bad) { note(doc, 'HWP 표에 잘못되거나 중복된 셀 좌표가 있어 대조에서 제외했습니다.', { location:at,text:'표 좌표 확인 필요' }); continue; }
        if (collectSummaryTable(doc,rows)) continue;
        if (parseRows(doc,rows)) matched = true; else unknown.push(rows);
      }
    }
  }
  if (source.sections.length !== checked.sections) note(doc,'일부 HWP 섹션을 읽지 못했습니다.',{location:name,text:'섹션 누락 가능'});
  source.sections.forEach((section,i) => {
    if (!section.paragraphs.length) note(doc,'비어 있거나 해석하지 못한 HWP 섹션이 있습니다.',{location:`BodyText/Section${i}`,text:'원문 확인 필요'});
    paragraphs(section.paragraphs,`BodyText/Section${i}`,true);
  });
  if (!matched) { parseExamText(doc,lines); doc.method = `HWP ${checked.version} 명시적 문항번호·배점 추출`; }
  else {
    unknown.forEach(rows => unknownTable(doc,rows));
    if (lines.some(l => lineNumber.test(l.text))) note(doc,'HWP 문항 표만 대조했습니다. 번호가 있는 본문과 표의 일치는 별도로 확인하세요.',{location:name,text:'표 우선 추출 · 본문 대조 제외'});
  }
  // 전체 렌더링 완전성과 명시적 필드 신뢰도(number/points/answerReliable)는 별개이다.
  doc.questions.forEach(q => q.reliable = false);
  return doc;
}
