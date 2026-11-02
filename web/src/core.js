import Decimal from 'decimal.js';

export const ERROR = '오류', REVIEW = '확인 필요', OK = '정상';
const kinds = { 객관식: '', 선택형: '', 선다형: '', 서답형: '서답형', 서술형: '서답형', 단답형: '서답형', 논술형: '서답형' };
const choices = '①②③④⑤⑥⑦⑧⑨⑩';
export const text = value => value == null ? '' : String(value).normalize('NFC').trim();
export const header = value => text(value).replace(/[\s:：()（）._-]/g, '');

export function number(value, kind = '') {
  if (typeof value === 'boolean') return null;
  const raw = text(value).replace(/\s+/g, '').replace(/^(\d+)\.0$/, '$1');
  const m = /^(?:(객관식|선택형|선다형|서답형|서술형|단답형|논술형))?(\d{1,4})(?:[-－](\d{1,3}))?(?:번|[.)])?$/.exec(raw);
  const k = text(kind).replace(/\s+/g, '');
  if (!m || (k && !(k in kinds)) || (m[1] && k && kinds[m[1]] !== kinds[k]) || +m[2] < 1 || (m[3] && +m[3] < 1)) return null;
  const prefix = kinds[m[1] || k] || '';
  return `${prefix ? prefix + ' ' : ''}${+m[2]}${m[3] ? '-' + +m[3] : ''}`;
}

export function answer(value) {
  if (typeof value === 'boolean') return null;
  let raw = text(value).replace(/\s+/g, ' ');
  if (['', '?', '미정', '없음', '별도', '별도첨부', '해당없음', '-', '확인필요'].includes(header(raw)) || /^[=#]/.test(raw)) return null;
  if (/^[①-⑩\s,、/]+$/.test(raw)) return [...new Set([...raw].filter(c => choices.includes(c)).map(c => choices.indexOf(c) + 1))].sort((a,b) => a-b).join(',');
  raw = raw.replace(/[①-⑩]/g, c => choices.indexOf(c) + 1).replace(/^(\d+)\.0$/, '$1');
  if (/^\d+(?:\s*[,、/]\s*\d+)*$/.test(raw)) return [...new Set(raw.split(/\s*[,、/]\s*/).map(n => new Decimal(n).toFixed()))].sort((a,b) => new Decimal(a).comparedTo(b)).join(',');
  return /[?~|]/.test(raw) ? null : raw;
}

export function points(value) {
  if (typeof value === 'boolean') return null;
  const raw = text(value).replace(/\s+/g, '').replace(/점$/, '');
  if (raw.length > 32 || !/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(raw)) return null;
  const d = new Decimal(raw.replace(/,/g, ''));
  return d.gt(0) && d.lte(10000) ? d.toFixed() : null;
}

export function document(name) { return { name, questions: [], notes: [], totals: [], complete: true, method: '명시적 문항 표' }; }
export function answerDisplay(q) {
  return q.answer ?? (q.answerState==='absent'?'원문 정답 미기재':q.answerState==='reference'?'별도 채점기준표 참조':'읽지 못함');
}
export function confidenceDisplay(q) {
  if(q.numberReliable!=null) return `번호 ${q.numberReliable?'확인':'확인 필요'} · 배점 ${q.pointsReliable?'확인':'확인 필요'} · 정답 ${q.answerState==='absent'?'미기재':q.answerState==='reference'?'기준표 참조':q.answerReliable?'확인':'확인 필요'}`;
  return q.reliable?'표 값':'확인 필요';
}
export function note(doc, message, evidence) { doc.complete = false; doc.notes.push({ message, evidence }); }
export function row(values, location, reliable = true) { return { values, reliable, evidence: { location, text: values.map(text).join(' | ') } }; }
const headers = { number: ['문항번호', '문제번호', '문항', '번호'], answer: ['정답', '답', '모범답안', '예시답안'], points: ['배점', '점수'], kind: ['문항유형', '유형', '구분'] };
const totalHeaders = ['합계', '총점', '총배점', '배점합계'];

export function parseRows(doc, rows) {
  let columns = null, start = 0;
  for (const [i, r] of rows.slice(0, 30).entries()) {
    const found = Object.fromEntries(Object.entries(headers).map(([k, names]) => [k, r.values.flatMap((v, j) => names.includes(header(v)) ? [j] : [])]));
    if (found.number.length && (found.answer.length || found.points.length)) {
      if (Object.values(found).some(a => a.length > 1)) { note(doc, '같은 이름의 헤더가 여러 개입니다. 표를 분리해 주세요.', r.evidence); return true; }
      columns = Object.fromEntries(Object.entries(found).filter(([, a]) => a.length).map(([k, a]) => [k, a[0]])); start = i; break;
    }
  }
  if (!columns) return false;
  if (!rows[start].reliable) note(doc, '헤더에 병합/수식/좌표 이상이 있습니다. 열 배치를 확인해 주세요.', rows[start].evidence);
  if (!('answer' in columns) || !('points' in columns)) note(doc, '정답 또는 배점 열이 없습니다. 없는 값을 추정하지 않습니다.', rows[start].evidence);
  for (const r of rows.slice(start + 1)) {
    if (!r.values.some(v => text(v))) continue;
    const cell = key => r.values[columns[key]];
    if (headers.number.includes(header(cell('number')))) {
      if (Object.keys(columns).every(k => headers[k].includes(header(cell(k))))) continue;
      note(doc, '반복 헤더의 열 배치가 달라 이후 행 추출을 중단했습니다.', r.evidence); break;
    }
    if (totalHeaders.includes(header(cell('number'))) || (!text(cell('number')) && r.values.some(v => totalHeaders.includes(header(v))))) {
      const p = points(cell('points'));
      if (!p || !r.reliable) note(doc, '표기 총점이 수식이거나 불명확합니다.', r.evidence);
      else doc.totals.push({ points: p, evidence: r.evidence });
      continue;
    }
    const n = number(cell('number'), cell('kind'));
    if (!n) { note(doc, '문항번호/유형을 읽지 못한 행이 있습니다.', r.evidence); continue; }
    const a = answer(cell('answer')), p = points(cell('points'));
    if (a == null || p == null || !r.reliable) note(doc, `${n}번: 정답·배점·표 구조 확인 필요. 빈칸·수식·병합 값은 추정하지 않습니다.`, r.evidence);
    doc.questions.push({ number: n, answer: a, points: p, reliable: r.reliable, evidence: r.evidence });
  }
  return true;
}

export const lineNumber = /^\s*(?:문항\s*)?((?:(?:객관식|선택형|서답형|서술형|논술형|단답형)\s*)?\d{1,4}(?:-\d{1,3})?)\s*(?:[.)]|번|(?=\s))\s*(.*)$/;
export function parseLines(doc, lines, pdf = false) {
  doc.method = pdf ? 'PDF 텍스트 본문(추정)' : '명시적 본문(추정)';
  note(doc, '본문 추출은 읽기 순서/누락을 보장하지 않습니다. 원문과 추출 미리보기를 대조하세요.', { location: doc.name, text: doc.method });
  for (const { location, text: content } of lines) {
    const value = text(content), evidence = { location, text: value };
    const total = /^(?:총점|합계)\s*[:：]\s*(\d+(?:\.\d+)?)\s*점?$/.exec(value);
    if (total && points(total[1])) { doc.totals.push({ points: points(total[1]), evidence }); continue; }
    const m = lineNumber.exec(value);
    if (!m || !number(m[1])) continue;
    const a = /정답\s*[:：]\s*([^\[\]【】;；|]+?)(?=\s+배점\s*[:：]|$|[\]】;；|])/.exec(m[2]);
    const p = /배점\s*[:：]\s*(\d+(?:\.\d+)?)\s*점?/.exec(m[2]) || /[\[【]\s*(\d+(?:\.\d+)?)\s*점\s*[\]】]/.exec(m[2]);
    doc.questions.push({ number: number(m[1]), answer: a ? answer(a[1]) : null, points: p ? points(p[1]) : null, reliable: false, evidence });
    if (!a || !p) note(doc, `${m[1]}번의 정답 또는 배점을 읽지 못했습니다.`, evidence);
  }
}

export function unknownTable(doc, rows) {
  const candidate = rows.find(r => number(r.values[0]));
  if (candidate) note(doc, '문항 행처럼 보이지만 지원하는 헤더가 없는 표/시트가 있습니다.', candidate.evidence);
}

export function compare(exam, info, expected = '100') {
  expected = points(expected);
  if (!expected) throw new Error('교사 지정 기준 총점은 0보다 크고 10,000 이하인 숫자로 입력해 주세요.');
  const findings = [], group = d => { const g = new Map(); for (const q of d.questions) g.set(q.number, [...(g.get(q.number) || []), q]); return g; };
  const eg = group(exam), ig = group(info);
  const add = (status, code, n, title, message, e = [], i = []) => findings.push({ status, code, number: n, title, message, examEvidence: e, infoEvidence: i });
  for (const [side, doc, groups] of [['시험 원안지', exam, eg], ['문항정보표', info, ig]]) {
    const addSide = (status, code, n, title, message, evidence = []) => add(status, code, n, title, message, doc === exam ? evidence : [], doc === info ? evidence : []);
    for (const item of doc.notes) addSide(REVIEW, 'extraction', '—', `${side} 추출 확인`, item.message, [item.evidence]);
    if (!doc.questions.length && !doc.notes.length) addSide(REVIEW, 'empty', '—', `${side} 문항 없음`, '문항 0개는 정상 판정의 근거가 아닙니다.');
    if (!doc.complete && !doc.notes.length) addSide(REVIEW, 'coverage', '—', `${side} 추출 범위`, '추출의 완전성을 보장할 수 없습니다.');
    for (const [n, qs] of groups) if (qs.length > 1) addSide(doc.complete && qs.every(q => q.reliable) ? ERROR : REVIEW, 'duplicate', n, `${side} 중복 문항번호`, `같은 번호가 ${qs.length}회 있습니다. 유형 구분과 중복 여부를 확인하세요.`, qs.map(q => q.evidence));
    for (const prefix of ['', '서답형 ']) {
      const ns = [...groups.keys()].filter(n => prefix ? /^서답형 \d+$/.test(n) : /^\d+$/.test(n)).map(n => +n.replace(prefix, ''));
      if (ns.length) {
        const set = new Set(ns), missing = [];
        for (let n = 1; n <= Math.max(...ns); n++) if (!set.has(n)) missing.push(n);
        if (missing.length) addSide(REVIEW, 'sequence', '—', `${side} 번호 연속성`, `${prefix}${missing.slice(0,30).join(', ')}${missing.length > 30 ? ' …' : ''}번이 없습니다. 의도한 번호인지 확인하세요.`, doc.questions.slice(0,1).map(q => q.evidence));
      }
    }
  }
  for (const n of [...new Set([...eg.keys(), ...ig.keys()])].sort(new Intl.Collator('ko', { numeric: true }).compare)) {
    const e = eg.get(n) || [], i = ig.get(n) || [], ee = e.map(q => q.evidence), ie = i.map(q => q.evidence);
    if (!e.length || !i.length) {
      const sure = exam.questions.length && info.questions.length && exam.complete && info.complete && [...e,...i].every(q => q.reliable);
      add(sure ? ERROR : REVIEW, 'missing', n, '누락 문항 후보', `${!e.length ? '시험 원안지' : '문항정보표'}에서 대응 번호를 찾지 못했습니다.${sure ? '' : ' 추출 불확실성이 있어 원문 확인이 필요합니다.'}`, ee, ie); continue;
    }
    if (e.length !== 1 || i.length !== 1) { add(REVIEW, 'ambiguous_pair', n, '일대일 대조 불가', '중복 번호를 먼저 확인해 주세요.', ee, ie); continue; }
    for (const [code, label] of [['answer', '정답'], ['points', '배점']]) {
      const l = e[0][code], r = i[0][code], sure = e[0].reliable && i[0].reliable;
      if (l == null || r == null) add(REVIEW, code, n, `${label} 확인 필요`, '빈칸·수식·불명확한 값이 있어 대조하지 못했습니다.', ee, ie);
      else if (l !== r) add(sure && exam.complete && info.complete ? ERROR : REVIEW, code, n, `${label} 불일치 후보`, `원안지: ${l} / 정보표: ${r}. 원본과 대조해 주세요.`, ee, ie);
      else add(sure ? OK : REVIEW, code, n, `${label} ${sure ? '일치' : '추출값 일치·원문 확인'}`, `양쪽 추출값: ${l}.${sure ? '' : ' 추출 정확도는 보장하지 않습니다.'}`, ee, ie);
    }
  }
  for (const [side, doc, groups] of [['시험 원안지', exam, eg], ['문항정보표', info, ig]]) {
    const known = doc.questions.reduce((sum, q) => sum.plus(q.points || 0), new Decimal(0)).toFixed();
    const sure = doc.questions.length && doc.complete && doc.questions.every(q => q.reliable && q.points != null) && [...groups.values()].every(qs => qs.length === 1);
    const evidence = [...doc.questions, ...doc.totals].map(q => q.evidence);
    const addTotal = (status, title, message) => add(status, 'total', '합계', `${side} ${title}`, message, doc === exam ? evidence : [], doc === info ? evidence : []);
    if (!sure) { addTotal(REVIEW, '총점 확인 필요', `읽힌 행의 소계 ${known}점(중복 포함 가능). 추출 누락/중복/불확실성 때문에 총점 오류를 단정하지 않습니다.`); continue; }
    for (const [label, target] of [['교사 지정 기준 총점', expected], ...doc.totals.map((t, i) => [`원문 표기 총점 ${i+1}`, t.points])]) {
      const equal = new Decimal(known).eq(target);
      addTotal(equal ? OK : ERROR, equal ? '총점 일치' : '총점 불일치 후보', `배점 합계 ${known}점 / ${label} ${target}점.`);
    }
  }
  const status = findings.some(f => f.status === ERROR) ? ERROR : findings.some(f => f.status === REVIEW) ? REVIEW : OK;
  return { exam, info, expected, findings, status };
}
