import { compare, note } from './core.js';
import { readXlsx, readDocx, readHwpx } from './office.js';
import { readPdf } from './pdf.js';
import { readHwp } from './hwp.js';

// CSP에 더해 처리용 worker의 네트워크 API 자체를 차단한다.
const denied = () => { throw new Error('문서 처리 중 네트워크 통신은 허용하지 않습니다.'); };
self.fetch = denied;
for (const key of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport']) self[key] = class { constructor() { denied(); } };

async function extract(file) {
  const extension = file.name.split('.').at(-1).toLowerCase();
  if (!['xlsx', 'docx', 'hwpx', 'hwp', 'pdf'].includes(extension)) throw new Error('지원 형식은 XLSX, DOCX, HWPX, HWP 5, 텍스트 PDF입니다.');
  if (file.buffer.byteLength > 50 * 1024 * 1024) throw new Error('50MB 이하 파일을 선택해 주세요.');
  const doc = await ({ xlsx: readXlsx, docx: readDocx, hwpx: readHwpx, hwp:readHwp, pdf: readPdf })[extension](file.buffer, file.name);
  if (!doc.questions.length) note(doc, '문항을 추출하지 못했습니다. ‘문항번호 / 정답 / 배점’ 표 또는 안내된 본문 형식을 사용하세요.', { location: file.name, text: '추출 문항 0개 — 정상 판정 불가' });
  return doc;
}

self.addEventListener('message', async ({ data }) => {
  if (data?.kind !== 'check') return;
  try {
    self.postMessage({ kind: 'progress', text: '시험 원안지를 PC 안에서 읽고 있습니다…' });
    const exam = await extract(data.exam);
    self.postMessage({ kind: 'progress', text: '문항정보표를 읽고 대조하고 있습니다…' });
    const info = await extract(data.info);
    self.postMessage({ kind: 'result', result: compare(exam, info, data.expected) });
  } catch (error) {
    // 원문과 라이브러리 내부 오류를 로그/서버로 전송하지 않는다.
    const known = /지원|확인|HWP|PDF|DOCX|암호|텍스트|크기|한도|XML|문서|총점|50MB|변환/.test(error.message || '');
    self.postMessage({ kind: 'error', message: known ? error.message : '파일을 읽지 못했습니다. 손상·암호화 여부와 실제 파일 형식을 확인해 주세요.' });
  }
});
self.postMessage({ kind: 'ready' });
