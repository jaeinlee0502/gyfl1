/** 문항 본문의 명시적인 번호/배점을 읽는다. 정답을 추론하거나 선지에서 고르지 않는다. */
import { answer, header, lineNumber, note, number, points } from './core.js';

export const kindOf = n => n.startsWith('서답형 ') ? 'written' : 'choice';
export const kindLabel = kind => kind === 'written' ? '서답형' : kind === 'choice' ? '선택형' : '전체';
export const isAnswerReference = value => /^(?:서답형)?채점기준표(?:참조|참고)$|^별도(?:답안|정답|채점기준)표?(?:참조|참고)?$/.test(header(value));

export function collectSummaryTable(doc, rows) {
  const first = rows.find(r => r.values.some(v => /^(문항수|문항개수)$/.test(header(v))) && r.values.some(v => /^(총점|총배점)$/.test(header(v))));
  if (!first) return false;
  const countColumn = first.values.findIndex(v => /^(문항수|문항개수)$/.test(header(v)));
  const scoreColumn = first.values.findIndex(v => /^(총점|총배점)$/.test(header(v)));
  doc.expectedCounts ||= {};
  let found = false;
  for (const row of rows) {
    const label = header(row.values[0]);
    const scope = /^(선택형|객관식|선다형)$/.test(label) ? 'choice' : /^(서답형|서술형|단답형|논술형)$/.test(label) ? 'written' : /^(합계|총합계|총계)$/.test(label) ? 'all' : null;
    if (!scope) continue;
    const n = /^(\d+)\s*(?:문항)?$/.exec(String(row.values[countColumn]).trim());
    if (n) { doc.expectedCounts[scope] = +n[1]; found = true; }
    const score = points(row.values[scoreColumn]);
    if (score) doc.totals.push({ points:score, scope, evidence:row.evidence });
  }
  return found;
}

export function parseExamText(doc, lines) {
  doc.fieldAware = true;
  let currentKind='choice';
  const scored = /(?:배점\s*[:：]\s*|[\[【]\s*)(\d+(?:\.\d+)?)\s*점?\s*[\]】]?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i], label=header(first.text);
    const section=/^[\[【]?(선택형|객관식|선다형|서답형|서술형|단답형|논술형)(?:문항|문제)[\]】]?$/.exec(label) || /^[\[【](선택형|객관식|서답형|서술형|단답형|논술형)[\]】]$/.exec(label);
    if(section){currentKind=/^(서답형|서술형|단답형|논술형)$/.test(section[1])?'written':'choice';continue;}
    const start = lineNumber.exec(first.text.trim());
    if (!start || !number(start[1])) continue;
    let body = start[2].trim();
    const sources = [first];
    // 문항 발문과 바로 다음의 독립된 [배점] 문단/줄만 연결한다.
    for (let next = i+1; next < Math.min(lines.length,i+3); next++) {
      const value = lines[next].text.trim();
      if (lineNumber.test(value) || /^[①-⑩]/.test(value)) break;
      if (/^[\[【]\s*(?:배점\s*[:：]\s*)?\d+(?:\.\d+)?\s*점\s*[\]】]$/.test(value) && !scored.test(body)) {
        body += '\n'+value; sources.push(lines[next]); i = next; break;
      }
      if (!/[?？]/.test(body) && !scored.test(body) && value.length <= 300 && !/^(선택형|서답형)/.test(value)) {
        body += '\n'+value; sources.push(lines[next]);
        if (/[?？]/.test(body) || scored.test(body)) { i = next; break; }
      } else break;
    }
    // 숫자만 있는 페이지 번호/목록을 문항으로 취급하지 않는다.
    if (!/[?？]/.test(body) && !scored.test(body) && !/정답\s*[:：]/.test(body)) continue;
    const n = number(start[1],/^\d/.test(start[1])?(currentKind==='written'?'서답형':'객관식'):''), score = scored.exec(body);
    if(!n) continue;
    const matches = [...body.matchAll(/[\[【]\s*(?:배점\s*[:：]\s*)?(\d+(?:\.\d+)?)\s*점\s*[\]】]/g)];
    const rawAnswer = /정답\s*[:：]\s*([^\[\]【】;；|]+?)(?=\s+배점\s*[:：]|$|[\]】;；|])/.exec(body);
    const reference = rawAnswer && isAnswerReference(rawAnswer[1]);
    const ans = rawAnswer && !reference ? answer(rawAnswer[1]) : null;
    const value = score && matches.length <= 1 ? points(score[1]) : null;
    doc.questions.push({ number:n, answer:ans, points:value, reliable:false,
      numberReliable:true, pointsReliable:value != null, answerReliable:ans != null,
      answerState:reference ? 'reference' : !rawAnswer ? 'absent' : ans == null ? 'unreadable' : 'present',
      evidence:{ location:sources.map(s=>s.location).join(' → '),text:sources.map(s=>s.text).join('\n') } });
  }
  doc.numberingCompleteKinds = {};
  for (const kind of ['choice','written']) {
    const qs = doc.questions.filter(q => kindOf(q.number) === kind);
    const expected = doc.expectedCounts?.[kind];
    const nums=qs.map(q=>+q.number.replace('서답형 ','')).sort((a,b)=>a-b);
    doc.numberingCompleteKinds[kind] = expected != null && expected === qs.length && new Set(qs.map(q=>q.number)).size === qs.length && nums.every((n,i)=>n===i+1) && qs.every(q=>q.numberReliable);
    if (expected!=null && qs.length && !doc.numberingCompleteKinds[kind]) note(doc,`${kindLabel(kind)} 표기 문항 수와 본문 번호 범위를 확인해야 합니다.`,{location:doc.name,text:`표기 ${expected}문항 / 추출 ${qs.length}문항`});
  }
  doc.separateKinds = [];
  const text = lines.map(l=>l.text).join('\n');
  if (/서답형[\s\S]{0,40}별도|별도[\s\S]{0,40}서답형/.test(text) && !doc.questions.some(q=>kindOf(q.number)==='written')) {
    doc.separateKinds.push('written');
    doc.separateEvidence = lines.filter(l=>/서답형[\s\S]*별도|별도[\s\S]*서답형/.test(l.text)).map(l=>({location:l.location,text:l.text}));
  }
  if (!doc.questions.length) note(doc,'명시적인 문항번호와 배점 표시를 찾지 못했습니다. 자동번호/그림 안 문항은 별도 확인이 필요합니다.',{location:doc.name,text:'문항 본문 추출 범위 확인'});
}
