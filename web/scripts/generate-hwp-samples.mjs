/** 가상 HWP 5 바이너리 추출 fixture. 한글 편집기 호환 문서 생성기는 아니다. */
import * as CFB from 'cfb';
import { deflateSync } from 'fflate';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

function record(tag, level, payload) {
  const body = Buffer.from(payload), extended = body.length >= 0xfff;
  const header = Buffer.alloc(extended ? 8 : 4);
  header.writeUInt32LE((((extended ? 0xfff : body.length) << 20) | (level << 10) | tag) >>> 0);
  if (extended) header.writeUInt32LE(body.length,4);
  return Buffer.concat([header,body]);
}
function paragraph(text, level = 0) {
  const bytes = Buffer.from(text+'\r','utf16le'), header = Buffer.alloc(22);
  header.writeUInt32LE(bytes.length/2);
  return Buffer.concat([record(66,level,header),record(67,level+1,bytes)]);
}

export function fakeHwp({ compressed = true, flags = 0, rows, bodyOnly = false, badBody = false, merge = false, extraSection = false, extendedText = false, previewOnly = false } = {}) {
  rows ||= [['문항번호','정답','배점'],...[1,2,3,4,5].map(n => [n,String(n),20]),['합계','',100]];
  const header = Buffer.alloc(256); header.write('HWP Document File',0,'ascii');
  header[35] = 5; header[33] = 3;
  header.writeUInt32LE((compressed ? 1 : 0) | flags,36);
  const properties = Buffer.alloc(26); properties.writeUInt16LE(1);
  const docInfo = record(16,0,properties);
  let body;
  if (bodyOnly) {
    body = Buffer.concat([paragraph('개발용 가상 시험 · 실제 학생/시험 정보 없음'),...[1,2,3,4,5].map(n => paragraph(`${n}. 가상 색종이 ${n}개의 개수는? [정답: ${n}] [배점: 20점]`))]);
  } else {
    const anchor = Buffer.alloc(22), control = Buffer.alloc(44), table = Buffer.alloc(22 + rows.length*2);
    control.writeUInt32LE(0x74626c20); // 'tbl '의 LE 저장
    table.writeUInt16LE(rows.length,4); table.writeUInt16LE(3,6);
    for (let i = 0; i < rows.length; i++) table.writeUInt16LE(3,18+i*2);
    const pieces = [paragraph('개발용 가상 문항 표 · 실제 학생/시험 정보 없음'),record(66,0,anchor),record(71,1,control),record(77,2,table)];
    for (const [r, values] of rows.entries()) for (const [c,value] of values.entries()) {
      const cell = Buffer.alloc(38); cell.writeUInt16LE(1);
      cell.writeUInt16LE(c,8); cell.writeUInt16LE(r,10);
      cell.writeUInt16LE(1,12); cell.writeUInt16LE(merge && r === 1 && c === 2 ? 2 : 1,14);
      cell.writeUInt32LE(10000,16); cell.writeUInt32LE(2000,20);
      pieces.push(record(72,2,cell),paragraph(String(value),2));
    }
    body = Buffer.concat(pieces);
  }
  if (extendedText) body = Buffer.concat([body,paragraph('가상 긴 설명 '.repeat(500))]);
  if (badBody) body = Buffer.concat([body,Buffer.from([0x43,0,0xf0,0xff])]);
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb,'FileHeader',header);
  CFB.utils.cfb_add(cfb,'DocInfo',compressed ? deflateSync(docInfo) : docInfo);
  if (!previewOnly) CFB.utils.cfb_add(cfb,'BodyText/Section0',compressed ? deflateSync(body) : body);
  else CFB.utils.cfb_add(cfb,'PrvText',Buffer.from('1. 가상 미리보기 [정답: ①] [배점: 100점]','utf16le'));
  if (extraSection) CFB.utils.cfb_add(cfb,'BodyText/Section2',compressed ? deflateSync(body) : body);
  return new Uint8Array(CFB.write(cfb,{type:'buffer'}));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = fileURLToPath(new URL('../../samples/',import.meta.url));
  await mkdir(dir,{recursive:true});
  for (const [name, options] of [['exam_hwp_fixture.hwp',{}],['exam_hwp_uncompressed_fixture.hwp',{compressed:false}],['exam_hwp_body_fixture.hwp',{bodyOnly:true}]]) await writeFile(path.join(dir,name),fakeHwp(options),{flag:process.argv.includes('--force') ? 'w' : 'wx'});
  console.log('가상 HWP 5 추출 fixture 3개 생성 완료');
}
