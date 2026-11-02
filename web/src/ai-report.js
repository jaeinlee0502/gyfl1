import ExcelJS from 'exceljs';
import { PROMPT_VERSION, compareReference, questionStatus } from './gemini.js';

export async function aiReportBuffer(result, reference) {
  const book=new ExcelJS.Workbook();
  const add=(sheet,values)=>sheet.addRow(values.map(v=>String(v??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').slice(0,32767)));
  const summary=book.addWorksheet('AI 검토 안내');
  for (const row of [
    ['항목','내용'],['종류','Google Gemini AI 검토 의견 · 정답 보장/출제 승인 아님'],
    ['원안지',result.name],['검토 시각',result.at],['모델',result.model],['프롬프트 버전',PROMPT_VERSION],
    ['수행 단계',result.secondComplete?'1차 풀이 + 2차 재검토 응답 수신':'1차만 수신 · 2차 미완료'],
    ['교사 지정 문항 수',result.expectedCount||'미지정'],['최종 응답 문항 수',result.review.questions.length],
    ['범위 확인',[...result.review.warnings,...result.review.document.notes,result.partialReason||''].filter(Boolean).join('\n')],
    ['문항정보표',reference?.name||'미선택'],['정보표 추출 주의',(reference?.notes||[]).map(n=>n.message).join('\n')],
    ['데이터 경로','선택 원안지/과목/학년 및 1차 결과는 Google API로 전송. 별도 정보표는 PC에서만 정답 비교.'],
    ['판정 해석','AI가 틀릴 수 있습니다. 원문 근거/풀이/불확실성을 교사가 직접 확인하세요. 근거와 쪽 번호도 AI의 제안입니다.'],
  ]) add(summary,row);
  for (const [title,review] of [['최종 검토 의견',result.review],['1차 검토 기록',result.first]]) {
    const sheet=book.addWorksheet(title);
    add(sheet,['문항','구분','AI 답 상태','AI 예상 답','정보표 정답','답 대조','파일 쪽','원문 발췌','풀이 요약','AI 신뢰도','오류 후보·근거·수정 제안','불확실성']);
    for (const q of review.questions) {
      const comparison=compareReference(q,reference);
      add(sheet,[q.canonical||q.id,questionStatus(q,reference),q.answerStatus,q.answers.join(' / '),comparison.answer,comparison.label,q.pages.join(', '),q.stemExcerpt,q.rationale,q.confidence,
        q.issues.map(i=>`${i.severity==='candidate'?'오류 후보':'확인 필요'}: ${i.description}\n파일 ${i.page||'?'}쪽 · ${i.location}\n인용: ${i.quote}\n제안: ${i.suggestion}`).join('\n\n'),q.uncertainties.join('\n')]);
    }
  }
  if (reference) {
    const sheet=book.addWorksheet('정보표 로컬 추출');
    add(sheet,['문항','정답','정답 추출 수준','위치','원문']);
    for (const q of reference.questions) add(sheet,[q.number,q.answer??'읽지 못함',(q.answerReliable??q.reliable)?'추출 값':'확인 필요',q.evidence?.location,q.evidence?.text]);
  }
  for (const sheet of book.worksheets) {
    sheet.views=[{state:'frozen',ySplit:1}]; sheet.getRow(1).font={bold:true};
    for (let c=1;c<=sheet.columnCount;c++) sheet.getColumn(c).width=c>=7?55:26;
    sheet.eachRow(r=>r.eachCell(c=>c.alignment={wrapText:true,vertical:'top'}));
  }
  summary.getColumn(2).width=100;
  return book.xlsx.writeBuffer();
}
