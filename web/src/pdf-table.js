/** 텍스트 PDF의 명시적인 문항정보표: 헤더 열 좌표와 유형 경계를 사용한다. */
import { answer, header, note, number, points } from './core.js';
import { isAnswerReference, kindOf } from './exam-text.js';

const center = item => item.x + item.width/2;
const numeric = value => /^\d+(?:\.\d+)?(?:\s*점)?$/.test(value.trim());

export function textLines(items) {
  const groups = [];
  for (const item of [...items].sort((a,b)=>a.y-b.y || a.x-b.x)) {
    let line = groups.find(g=>Math.abs(g.y-item.y)<2);
    if (!line) { line={y:item.y,items:[]}; groups.push(line); }
    line.items.push(item);
  }
  return groups.sort((a,b)=>a.y-b.y).map(g=>({...g,items:g.items.sort((a,b)=>a.x-b.x),text:g.items.map(i=>i.str).join(' ')}));
}

function schemaFrom(items, width) {
  for (const n of items.filter(i=>/^(문항번호|문제번호)$/.test(header(i.str)))) {
    const p = items.find(i=>Math.abs(i.y-n.y)<16 && /^(배점|점수)(점)?$/.test(header(i.str)));
    const a = items.find(i=>Math.abs(i.y-n.y)<16 && /^(정답|모범답안)$/.test(header(i.str)));
    if (!p || !a || Math.abs(center(p)-center(a))<15 || center(n)>=Math.min(center(p),center(a))) continue;
    const distance = Math.abs(center(p)-center(a));
    return {width,top:Math.max(n.y,p.y,a.y)+8,
      number:{x:center(n),half:Math.max(12,n.width/2+3)},
      points:{x:center(p),half:Math.min(distance/2-1,Math.max(10,p.width/2+5))},
      answer:{x:center(a),half:distance/2-1},
      evidence:`${n.str} | ${p.str} | ${a.str}`};
  }
  return null;
}
const inColumn = (item,col) => Math.abs(center(item)-col.x)<=col.half;

export function parsePdfTable(doc, pages) {
  let schema = null, currentKind='choice', recognized=false;
  for (const page of pages) {
    const lines=textLines(page.items), fresh=schemaFrom(page.items,page.width);
    if (fresh) {schema=fresh;recognized=true;}
    if (!schema || Math.abs(page.width-schema.width)>1 || page.rotation%180!==0) continue;
    const threshold=fresh ? schema.top : 0;
    const headings=lines.flatMap(l=>{
      const key=header(l.text);
      const kind=/^(선택형|객관식|선다형)문항$/.test(key) ? 'choice' : /^(서답형|서술형|논술형|단답형)문항$/.test(key) ? 'written' : null;
      return kind ? [{y:l.y,kind}] : [];
    });
    doc.expectedCounts ||= {};
    for (const line of lines) {
      const count=/총\s*문항\s*수\s*[:：]?\s*(\d+)\s*문항/.exec(line.text);
      if (count) doc.expectedCounts.all=+count[1];
      if (/총\s*점|총\s*배\s*점/.test(line.text) && (!fresh || line.y<schema.top)) {
        for (const [scope,regex] of [['all',/총\s*점\s*[:：]?\s*(\d+(?:\.\d+)?)\s*점/],['choice',/선택형\s*[:：]?\s*(\d+(?:\.\d+)?)\s*점/],['written',/서답형\s*[:：]?\s*(\d+(?:\.\d+)?)\s*점/]]) {
          const match=regex.exec(line.text), p=match && points(match[1]);
          if (p) doc.totals.push({points:p,scope,evidence:{location:`PDF ${page.page}쪽 · y=${line.y.toFixed(1)}`,text:line.text}});
        }
      }
      if (line.items.some(i=>/^(총합계|총계|합계)$/.test(header(i.str)))) {
        const values=line.items.filter(i=>inColumn(i,schema.points) && numeric(i.str));
        if (values.length===1) doc.totals.push({points:points(values[0].str),scope:'all',evidence:{location:`PDF ${page.page}쪽 · 합계 행`,text:line.text}});
      }
    }
    const totalsY=lines.filter(l=>l.items.some(i=>/^(총합계|총계|합계|비율%)$/.test(header(i.str)))).map(l=>l.y);
    const candidates=[];
    for (const item of page.items.filter(i=>i.y>threshold && /^\d{1,4}$/.test(i.str.trim()) && inColumn(i,schema.number)).sort((a,b)=>a.y-b.y)) {
      const heading=headings.filter(h=>h.y<item.y).at(-1);
      const kind=heading?.kind || currentKind;
      if (totalsY.some(y=>y<item.y)) continue;
      const scores=page.items.filter(i=>Math.abs(i.y-item.y)<2.5 && inColumn(i,schema.points) && numeric(i.str));
      const answers=page.items.filter(i=>Math.abs(i.y-item.y)<2.5 && inColumn(i,schema.answer));
      if (!scores.length && !answers.length) continue; // 페이지 번호/기타 숫자를 문항으로 만들지 않는다.
      candidates.push({item,kind,scores,heading});
    }
    for (const [index,candidate] of candidates.entries()) {
      const {item,kind,scores,heading}=candidate, previous=candidates[index-1], next=candidates[index+1];
      const gap=next?.kind===kind ? next.item.y-item.y : previous?.kind===kind ? item.y-previous.item.y : 30;
      const lower=Math.max(previous?.kind===kind ? (previous.item.y+item.y)/2 : item.y-gap/2,heading?.y+2 || 0,threshold);
      const upper=Math.min(next?.kind===kind ? (next.item.y+item.y)/2 : item.y+gap/2,...headings.filter(h=>h.y>item.y).map(h=>h.y-2),...totalsY.filter(y=>y>item.y).map(y=>y-5));
      const cell=page.items.filter(i=>i.y>=lower && i.y<upper && inColumn(i,schema.answer)).sort((a,b)=>a.y-b.y || a.x-b.x);
      const rawAnswer=cell.map(i=>i.str).join(' ').trim(), reference=isAnswerReference(rawAnswer);
      const partialReference=/^(?:서답형)?채점/.test(header(rawAnswer));
      let ans=reference || partialReference ? null : answer(rawAnswer);
      if(kind==='choice' && (!/^\d+(?:,\d+)*$/.test(ans||'') || ans.split(',').some(n=>+n<1||+n>10))) ans=null;
      const p=scores.length===1 ? points(scores[0].str) : null;
      const n=number(item.str,kind==='written'?'서답형':'객관식');
      if (!n) continue;
      const rawRow=page.items.filter(i=>i.y>=lower && i.y<upper).sort((a,b)=>a.y-b.y || a.x-b.x).map(i=>i.str).join(' ');
      doc.questions.push({number:n,answer:ans,points:p,reliable:p!=null && (ans!=null || reference),
        numberReliable:true,pointsReliable:p!=null,answerReliable:ans!=null,
        answerState:reference?'reference':rawAnswer ? ans==null?'unreadable':'present':'unreadable',
        evidence:{location:`PDF ${page.page}쪽 · ${kind==='written'?'서답형':'선택형'} ${item.str.trim()}번 · y=${item.y.toFixed(1)} (헤더: ${schema.evidence})`,text:rawRow}});
    }
    if (headings.length) currentKind=headings.at(-1).kind;
  }
  if (!recognized) return false;
  doc.fieldAware=true;doc.method='PDF 문항정보표 · 헤더 열 좌표/문항 유형 기반 추출';
  const groups=['choice','written'].map(kind=>doc.questions.filter(q=>kindOf(q.number)===kind));
  const contiguous=groups.every(qs=>qs.length===0 || [...new Set(qs.map(q=>+q.number.replace('서답형 ','')))].sort((a,b)=>a-b).every((n,i)=>n===i+1) && new Set(qs.map(q=>q.number)).size===qs.length);
  const complete=doc.expectedCounts.all!=null && doc.questions.length===doc.expectedCounts.all && contiguous;
  doc.numberingCompleteKinds={choice:complete && groups[0].length>0,written:complete && groups[1].length>0};
  doc.complete=complete && doc.questions.every(q=>q.pointsReliable);
  if (!complete) note(doc,'정보표의 표기 문항 수와 추출 범위/번호 연속성을 확인해야 합니다.',{location:doc.name,text:`표기 ${doc.expectedCounts.all ?? '미확인'}문항 / 추출 ${doc.questions.length}문항`});
  return true;
}
