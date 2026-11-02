/** 항목별 신뢰도와 선택형/서답형의 점검 범위를 구분하는 대조. */
import Decimal from 'decimal.js';
import { compare as legacyCompare, ERROR, OK, REVIEW, points } from './core.js';
import { kindLabel, kindOf } from './exam-text.js';

const sure = (q,field) => Boolean(q?.[field+'Reliable'] ?? q?.reliable);
const qsOf = (d,k) => d.questions.filter(q=>kindOf(q.number)===k);
function group(doc) { const g=new Map();for(const q of doc.questions) g.set(q.number,[...(g.get(q.number)||[]),q]);return g; }
function covered(doc,kind) {
  if (kind==='all') return ['choice','written'].every(k=>!doc.expectedCounts?.[k] && !qsOf(doc,k).length || covered(doc,k)) && (doc.expectedCounts?.all == null ? doc.complete : doc.expectedCounts.all===doc.questions.length);
  if (doc.numberingCompleteKinds && kind in doc.numberingCompleteKinds) return doc.numberingCompleteKinds[kind];
  return doc.complete && qsOf(doc,kind).length>0;
}

export function compareDocuments(exam,info,expected='100') {
  if (!exam.fieldAware && !info.fieldAware) return legacyCompare(exam,info,expected);
  expected=points(expected);if(!expected) throw new Error('교사 지정 기준 총점을 숫자로 입력해 주세요.');
  const findings=[],summary=[],eg=group(exam),ig=group(info),skipKinds=new Set(),skipAnswers=new Set();
  const add=(status,code,number,title,message,e=[],i=[])=>findings.push({status,code,number,title,message,examEvidence:e,infoEvidence:i});
  const evidence=qs=>qs.map(q=>q.evidence);
  for (const [label,doc,g] of [['시험 원안지',exam,eg],['문항정보표',info,ig]]) {
    const side=(es)=>doc===exam?[es,[]]:[[],es];
    for(const n of doc.notes) add(REVIEW,'extraction','—',`${label} 추출 범위`,n.message,...side([n.evidence]));
    for(const [number,items] of g) if(items.length>1) add(items.every(q=>sure(q,'number'))?ERROR:REVIEW,'duplicate',number,`${label} 중복 문항번호`,`${items.length}개 행이 같은 문항번호를 사용합니다.`,...side(evidence(items)));
    if (!doc.questions.length && !doc.notes.length) add(REVIEW,'empty','—',`${label} 문항 없음`,'문항을 추출하지 못했으므로 정상으로 판정하지 않습니다.');
  }
  for (const kind of ['choice','written']) {
    const left=qsOf(exam,kind),right=qsOf(info,kind);
    if (!left.length && right.length || left.length && !right.length) {
      const absent=!left.length?exam:info,label=!left.length?'시험 원안지':'문항정보표',present=left.length?left:right;
      const separate=absent.separateKinds?.includes(kind);
      const message=separate ? `${label}에 ${kindLabel(kind)} 문항은 별도 시험지로 안내되어 있습니다. 해당 유형 원안지와 정보표를 별도로 선택해야 ${present.length}문항을 대조할 수 있습니다.` : `${label}에서 ${kindLabel(kind)} ${present.length}문항을 읽지 못했습니다. 별도 문서/추출 범위를 확인해 주세요.`;
      add(REVIEW,'missing_section',`${kindLabel(kind)} 전체`,`${kindLabel(kind)} 대조 범위 확인`,message,!left.length?absent.separateEvidence||[]:evidence(left),!right.length?absent.separateEvidence||[]:evidence(right));
      skipKinds.add(kind);summary.push(message);
    }
    const pairs=[...eg.keys()].filter(n=>kindOf(n)===kind && eg.get(n).length===1 && ig.get(n)?.length===1);
    const noAnswers = doc => qsOf(doc,kind).length>0 && qsOf(doc,kind).every(q=>q.answer==null && ['absent','reference'].includes(q.answerState));
    if (pairs.length && (noAnswers(exam)||noAnswers(info))) {
      const label=noAnswers(exam)?'시험 원안지':'문항정보표';
      const message=`${label}에서 명시적인 정답을 확인할 수 없어 ${kindLabel(kind)} ${pairs.length}문항의 정답 대조는 하지 않았습니다. 정답표 또는 채점기준표가 필요합니다.`;
      add(REVIEW,'answer_unavailable',`${kindLabel(kind)} 전체`,'정답 대조 불가',message,evidence(left),evidence(right));
      skipAnswers.add(kind);summary.push(message);
    }
  }
  for(const n of [...new Set([...eg.keys(),...ig.keys()])].sort(new Intl.Collator('ko',{numeric:true}).compare)) {
    const kind=kindOf(n);if(skipKinds.has(kind)) continue;
    const left=eg.get(n)||[],right=ig.get(n)||[],ee=evidence(left),ie=evidence(right);
    if (!left.length || !right.length) {const certain=covered(exam,kind)&&covered(info,kind);add(certain?ERROR:REVIEW,'missing',n,'누락 문항 후보',`${!left.length?'시험 원안지':'문항정보표'}에 대응 문항이 없습니다.${certain?'':' 추출 범위가 불확실하여 원문 확인이 필요합니다.'}`,ee,ie);continue;}
    if (left.length!==1 || right.length!==1) {add(REVIEW,'ambiguous_pair',n,'일대일 대조 불가','중복 번호를 먼저 확인해 주세요.',ee,ie);continue;}
    for(const [field,label] of [['answer','정답'],['points','배점']]) {
      if(field==='answer' && skipAnswers.has(kind)) continue;
      const l=left[0],r=right[0],ls=l[field],rs=r[field],certain=sure(l,'number')&&sure(r,'number')&&sure(l,field)&&sure(r,field);
      if(ls==null || rs==null) add(REVIEW,field,n,`${label} 대조 불가`,'원문 미기재·별도 기준표 참조·해석 불가 값이 있어 대조하지 않았습니다.',ee,ie);
      else if(ls!==rs) add(certain?ERROR:REVIEW,field,n,`${label} 불일치 후보`,`원안지 ${ls} / 정보표 ${rs}. ${certain?'양쪽 원문에 명시된 값을 확인하세요.':'추출 정확도를 원문과 확인하세요.'}`,ee,ie);
      else add(certain?OK:REVIEW,field,n,`${label} ${certain?'일치':'추출값 일치·원문 확인'}`,`양쪽 추출값: ${ls}.`,ee,ie);
    }
  }
  for(const [label,doc] of [['시험 원안지',exam],['문항정보표',info]]) {
    const targets=new Map();
    for(const total of doc.totals) {
      const scope=total.scope||'all',key=scope+':'+total.points;
      const value=targets.get(key)||{scope,points:total.points,labels:['원문 표기'],evidence:[]};value.evidence.push(total.evidence);targets.set(key,value);
    }
    const key='all:'+expected,target=targets.get(key)||{scope:'all',points:expected,labels:[],evidence:[]};target.labels.push('교사 지정 기준');targets.set(key,target);
    for(const target of targets.values()) {
      const qs=target.scope==='all'?doc.questions:qsOf(doc,target.scope);
      if (!qs.length && target.scope!=='all') continue;
      const sum=qs.reduce((s,q)=>s.plus(q.points||0),new Decimal(0)).toFixed();
      const unique=new Set(qs.map(q=>q.number)).size===qs.length;
      const certain=qs.length>0 && covered(doc,target.scope) && unique && qs.every(q=>sure(q,'number')&&sure(q,'points')&&q.points!=null);
      const es=[...evidence(qs),...target.evidence],e=doc===exam?es:[],i=doc===info?es:[];
      if(!certain) add(REVIEW,'total',`${kindLabel(target.scope)} 합계`,`${label} ${kindLabel(target.scope)} 총점 범위 확인`,`읽힌 배점 소계 ${sum}점 / ${target.labels.join('·')} ${target.points}점. 별도 문항이나 추출 누락이 있어 전체 총점 오류로 단정하지 않습니다.`,e,i);
      else {const equal=new Decimal(sum).eq(target.points);add(equal?OK:ERROR,'total',`${kindLabel(target.scope)} 합계`,`${label} ${kindLabel(target.scope)} 총점 ${equal?'일치':'불일치 후보'}`,`배점 합계 ${sum}점 / ${target.labels.join('·')} ${target.points}점.`,e,i);}
    }
  }
  const status=findings.some(f=>f.status===ERROR)?ERROR:findings.some(f=>f.status===REVIEW)?REVIEW:OK;
  return {exam,info,expected,findings,status,summary};
}
