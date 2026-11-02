import ExcelJS from 'exceljs';
import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { document, lineNumber, note, parseLines, parseRows, row, unknownTable } from './core.js';

const local = e => e.localName || e.nodeName.split(':').at(-1);
const children = (e, name) => Array.from(e.childNodes || []).filter(c => c.nodeType === 1 && (!name || local(c) === name));
const all = (e, name) => Array.from(e.getElementsByTagName('*')).filter(c => local(c) === name);
const ancestor = (e, name) => { for (let p = e.parentNode; p; p = p.parentNode) if (local(p) === name) return true; return false; };
const xmlText = e => all(e, 't').map(t => t.textContent).join('').trim();

export function checkedZip(buffer) {
  let count = 0, total = 0;
  const names = new Set();
  const zip = unzipSync(new Uint8Array(buffer), { filter(entry) {
    if (names.has(entry.name)) throw new Error('문서 안에 중복된 구성요소가 있습니다. 원본 프로그램에서 다시 저장해 주세요.');
    names.add(entry.name);
    count++; total += entry.originalSize;
    if (count > 5000 || total > 100 * 1024 * 1024) throw new Error('압축 해제 크기/구성요소가 지원 한도를 초과했습니다.');
    return /\.xml$/.test(entry.name);
  }});
  let actual = 0;
  for (const value of Object.values(zip)) actual += value.byteLength;
  if (actual > 100 * 1024 * 1024) throw new Error('문서 XML 크기가 지원 한도를 초과했습니다.');
  return zip;
}

function xml(bytes) {
  const content = strFromU8(bytes);
  if (/<!\s*(DOCTYPE|ENTITY)/i.test(content)) throw new Error('외부 참조/엔티티가 있는 XML은 지원하지 않습니다.');
  return new DOMParser({ onError(level) { if (level !== 'warning') throw new Error('XML 형식 오류'); } }).parseFromString(content, 'application/xml');
}

function cellValue(c) {
  const v = c.value;
  if (v == null) return '';
  if (typeof v !== 'object') return v;
  if ('formula' in v || 'sharedFormula' in v) return '=' + (v.formula || '공유 수식');
  if (v.richText) return v.richText.map(p => p.text).join('');
  if ('hyperlink' in v) return v.text || '';
  return '?';
}

export async function readXlsx(buffer, name) {
  checkedZip(buffer);
  const source = new ExcelJS.Workbook();
  await source.xlsx.load(buffer, { ignoreNodes: ['picture', 'drawing'] });
  const doc = document(name);
  for (const sheet of source.worksheets) {
    if (sheet.rowCount > 20000 || sheet.columnCount > 100) throw new Error('시트는 20,000행 / 100열 이내여야 합니다.');
    const rows = [];
    sheet.eachRow({ includeEmpty: true }, (r, i) => {
      const values = [], cells = [];
      for (let col = 1; col <= sheet.columnCount; col++) { const c = r.getCell(col); cells.push(c); values.push(cellValue(c)); }
      rows.push(row(values, `시트 ‘${sheet.name}’ · 행 ${i}`, cells.every(c => !c.isMerged && !(c.value && typeof c.value === 'object' && ('formula' in c.value || 'sharedFormula' in c.value)))));
    });
    const before = doc.questions.length;
    if (!parseRows(doc, rows)) unknownTable(doc, rows);
    if (sheet.state !== 'visible' && doc.questions.length > before) note(doc, '숨긴 시트의 문항도 포함했습니다. 추출 범위를 확인하세요.', { location: `시트 ‘${sheet.name}’`, text: '숨겨진 시트' });
  }
  return doc;
}

function readXmlTables(doc, root, hwpx, location) {
  const tables = all(root, hwpx ? 'tbl' : 'tbl').filter(t => !ancestor(t, 'tbl'));
  let matched = false;
  const unknown = [];
  for (const [ti, table] of tables.entries()) {
    const trs = children(table, 'tr');
    if (trs.length > 20000) throw new Error('표의 행 수가 지원 한도를 초과했습니다.');
    const rows = trs.map((tr, ri) => {
      const values = []; let reliable = true;
      for (const [ci, cell] of children(tr, 'tc').entries()) {
        if (hwpx) {
          if (children(cell, 'cellSpan').some(s => (s.getAttribute('rowSpan') || '1') !== '1' || (s.getAttribute('colSpan') || '1') !== '1')) reliable = false;
          if (children(cell, 'cellAddr').some(a => a.getAttribute('rowAddr') !== String(ri) || a.getAttribute('colAddr') !== String(ci))) reliable = false;
        } else if (all(cell, 'vMerge').length || all(cell, 'gridSpan').length) reliable = false;
        if (['tbl', 'pic', 'equation', 'ole', 'drawing', 'pict', 'instrText', 'fldSimple'].some(n => all(cell, n).length)) reliable = false;
        values.push(xmlText(cell));
      }
      if (values.length > 100) throw new Error('표는 100열 이내여야 합니다.');
      return row(values, `${location} · 표 ${ti+1} · 행 ${ri+1}`, reliable);
    });
    if (parseRows(doc, rows)) matched = true;
    else unknown.push(rows);
  }
  const lines = all(root, 'p').filter(p => !ancestor(p, 'tbl') && !all(p, 'tbl').length).flatMap((p, i) => xmlText(p).split(/\r?\n/).filter(Boolean).map(value => ({ location: `${location} · 문단 ${i+1}`, text: value })));
  return { matched, unknown, lines };
}

export function readDocx(buffer, name) {
  const zip = checkedZip(buffer);
  if (!zip['word/document.xml']) throw new Error('DOCX 본문을 찾지 못했습니다. Word에서 DOCX로 다시 저장해 주세요.');
  const root = xml(zip['word/document.xml']);
  const doc = document(name);
  if (['ins', 'del', 'sdt', 'txbxContent', 'altChunk'].some(n => all(root, n).length)) note(doc, '변경 추적/콘텐츠 컨트롤/텍스트 상자 등 기본 표·문단 외 구조가 있습니다.', { location: name, text: '추출 범위 확인 필요' });
  const parsed = readXmlTables(doc, root, false, '본문');
  finishXml(doc, parsed);
  return doc;
}

function finishXml(doc, parsed) {
  if (!parsed.matched) parseLines(doc, parsed.lines);
  else {
    for (const rows of parsed.unknown) unknownTable(doc, rows);
    if (parsed.lines.some(l => lineNumber.test(l.text))) note(doc, '문항 표와 번호가 있는 본문이 함께 있습니다. 표만 대조했으며 본문과의 일치는 별도 확인이 필요합니다.', { location: doc.name, text: '표 우선 추출 · 본문 대조 제외' });
  }
}

export function readHwpx(buffer, name) {
  const zip = checkedZip(buffer), doc = document(name);
  const sections = Object.keys(zip).filter(n => /^Contents\/section\d+\.xml$/.test(n)).sort((a,b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
  if (!sections.length) throw new Error('HWPX section XML을 찾을 수 없습니다. 한글에서 HWPX로 다시 저장해 주세요.');
  const parsed = { matched: false, unknown: [], lines: [] };
  for (const section of sections) {
    const part = readXmlTables(doc, xml(zip[section]), true, section);
    parsed.matched ||= part.matched; parsed.unknown.push(...part.unknown); parsed.lines.push(...part.lines);
  }
  finishXml(doc, parsed);
  return doc;
}
