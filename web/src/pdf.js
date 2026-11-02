// PDF.js 및 CMap/폰트까지 로컬 번들에 포함. 문서 처리 중 fetch가 필요 없다.
import * as pdfjs from 'pdfjs-dist/build/pdf.mjs';
import * as worker from 'pdfjs-dist/build/pdf.worker.mjs';
import data from '../.generated/pdf-data.js';
import { document, note, parseLines } from './core.js';

globalThis.pdfjsWorker = worker;
function bytes(value) {
  if (!value) throw new Error('지원하지 않는 PDF 글꼴/문자맵입니다.');
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
class MemoryCMap {
  async fetch({ name }) { return { cMapData: bytes(data.cmaps[name + '.bcmap']), isCompressed: true }; }
}
class MemoryFont {
  async fetch({ filename }) { return bytes(data.standard_fonts[filename]); }
}

export async function readPdf(buffer, name) {
  const doc = document(name), lines = [], empty = [];
  let source;
  const loading = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useWorkerFetch: false,
    CMapReaderFactory: MemoryCMap, StandardFontDataFactory: MemoryFont,
    disableFontFace: true, useSystemFonts: false, disableAutoFetch: true, disableStream: true, verbosity: 0 });
  try {
    source = await loading.promise;
    if (source.numPages > 1000) throw new Error('1,000쪽을 초과하는 PDF는 지원하지 않습니다.');
    for (let p = 1; p <= source.numPages; p++) {
      const page = await source.getPage(p), content = await page.getTextContent();
      const groups = [];
      for (const item of content.items) {
        if (typeof item.str !== 'string' || !item.str.trim()) continue;
        const y = item.transform[5];
        let g = groups.find(g => Math.abs(g.y-y) < 2);
        if (!g) { g = { y, items: [] }; groups.push(g); }
        g.items.push(item);
      }
      if (!groups.length) empty.push(p);
      groups.sort((a,b) => b.y-a.y).forEach((g, i) => {
        const value = g.items.sort((a,b) => a.transform[4]-b.transform[4]).map(t => t.str).join(' ');
        lines.push({ location: `PDF ${p}쪽 · 줄 ${i+1}`, text: value });
        if (/[\ufffd\x00]/.test(value)) note(doc, '해석할 수 없는 PDF 문자가 있습니다.', { location: `PDF ${p}쪽`, text: '문자 매핑 오류' });
      });
      page.cleanup();
    }
    if (!lines.length) throw new Error('텍스트가 없는 PDF입니다. 스캔 PDF의 OCR은 지원하지 않습니다. 텍스트 PDF 또는 HWPX로 다시 저장해 주세요.');
    if (empty.length) note(doc, '텍스트 없는 쪽이 있습니다. 그림/스캔 속 문항은 읽지 못합니다.', { location: 'PDF', text: `쪽: ${empty.join(', ')}` });
    parseLines(doc, lines, true);
    return doc;
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('암호화된 PDF는 지원하지 않습니다. 복사본의 암호를 해제해 주세요.');
    throw error;
  } finally { await loading.destroy(); }
}
