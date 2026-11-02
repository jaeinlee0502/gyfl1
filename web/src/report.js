import ExcelJS from 'exceljs';

const evidenceText = values => values.map(e => `${e.location}\n${e.text}`).join('\n\n');
function append(sheet, values) {
  // 객체/수식을 전달하지 않고 문자열로만 쓰기. Excel 수식 주입 방지.
  sheet.addRow(values.map(v => v == null ? '' : String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0,32767)));
}
export async function reportBuffer(result) {
  const book = new ExcelJS.Workbook();
  const summary = book.addWorksheet('점검 요약');
  for (const values of [
    ['항목', '내용'], ['프로그램', '시험출제 통합점검기 · 브라우저 로컬 점검'],
    ['저장 시각(PC)', new Date().toLocaleString('ko-KR')], ['판정', result.status],
    ['시험 원안지', result.exam.name], ['문항정보표', result.info.name], ['기준 총점', result.expected],
    ['범위', '문항번호·정답·배점 메타데이터 대조. 내용/정답 타당성/AI 검증은 포함하지 않음.'],
    ['해석', '오류는 불일치 후보이며 정상도 출제 승인이 아닙니다. 교사가 원문을 확인하세요.'],
    ['보관', '이 보고서는 파일명과 원문 근거를 포함합니다. 학교 문서 보관 규정을 지켜 주세요.'],
    ['원문 한도', 'Excel 셀 한도 32,767자를 넘는 원문은 보고서에서 잘립니다. 원본/추출 미리보기를 확인하세요.'],
  ]) append(summary, values);
  const findings = book.addWorksheet('점검 결과');
  append(findings, ['구분','문항','점검 내용','판단 이유','원안지 근거','정보표 근거','규칙 코드']);
  for (const f of result.findings) append(findings, [f.status,f.number,f.title,f.message,evidenceText(f.examEvidence),evidenceText(f.infoEvidence),f.code]);
  for (const [title, doc] of [['원안지 추출', result.exam], ['정보표 추출', result.info]]) {
    const sheet = book.addWorksheet(title);
    append(sheet, ['문항번호','정답','배점','추출 수준','원본 위치','읽은 원문']);
    for (const q of doc.questions) append(sheet, [q.number,q.answer ?? '읽지 못함',q.points ?? '읽지 못함',q.reliable ? '표 값' : '확인 필요',q.evidence.location,q.evidence.text]);
  }
  for (const sheet of book.worksheets) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: { row: sheet.rowCount, column: sheet.columnCount } };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF214D45' } };
    for (let i = 1; i <= sheet.columnCount; i++) sheet.getColumn(i).width = i >= 4 ? 55 : 26;
    sheet.eachRow(r => r.eachCell(c => c.alignment = { wrapText: true, vertical: 'top' }));
  }
  summary.getColumn(2).width = 100;
  return book.xlsx.writeBuffer();
}

export function download(buffer, name) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function sampleFiles(errors = false) {
  const make = async (name, bad) => {
    const b = new ExcelJS.Workbook(), s = b.addWorksheet('가상 문항 표');
    s.addRow(['가상 자료 · 실제 시험/학생 정보 없음']);
    s.addRow(['문항번호', '정답', '배점']);
    const rows = bad ? [[1,'①',20],[2,'③',20],[3,'③',10],[5,'⑤',20],[5,'⑤',20]] : [1,2,3,4,5].map(n => [n,String(n),20]);
    rows.forEach(r => s.addRow(r)); s.addRow(['합계','',100]);
    return new File([await b.xlsx.writeBuffer()], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  };
  return [await make('가상_시험원안지.xlsx', false), await make(errors ? '가상_오류정보표.xlsx' : '가상_정상정보표.xlsx', errors)];
}
