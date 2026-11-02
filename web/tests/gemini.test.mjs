import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { API_ORIGIN,buildRequest,listModels,generateReview,validateReview,decodeResponse,reconcileReviews,compareReference,detectMime,questionStatus, toBase64 } from '../src/gemini.js';
import { aiReportBuffer } from '../src/ai-report.js';
import { reviewFixture,apiFixture,modelsFixture } from './ai-cases.mjs';

const args={file:{mime:'application/pdf',base64:'RklDVElPTkFM',pages:2},model:'models/gemini-test-flash',subject:'가상 과목',grade:'고등학교 2학년',expectedCount:2};
const ok=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
test('독립 풀이 요청은 별도 정답표를 받지 않고 문서와 시스템 지시를 분리',()=>{
  const r=buildRequest({...args,reference:{answer:'LOCAL_ONLY_SENTINEL'}});
  assert.equal(r.contents[0].parts[1].inlineData.data,args.file.base64);
  assert.ok(r.systemInstruction.parts[0].text.includes('(가),(나)'));
  assert.ok(!JSON.stringify(r).includes('LOCAL_ONLY_SENTINEL'));
  assert.equal(r.generationConfig.responseMimeType,'application/json');
  assert.throws(()=>buildRequest({...args,model:'models/other/../../evil'}),/모델/);
});
test('재검토 요청은 1차 의견과 원문을 포함하고 출력 한도를 존중',()=>{
  const r=buildRequest({...args,first:reviewFixture(),outputTokenLimit:8000});
  assert.equal(r.generationConfig.maxOutputTokens,8000);
  assert.ok(r.contents[0].parts[0].text.includes('1차 검토 데이터'));
});
test('요청은 Google HTTPS 고정 주소/헤더 인증만 사용하고 키는 본문에 없음',async()=>{
  const calls=[];const key='fictional-key-never-in-body';
  const r=await generateReview(key,args,{fetchImpl:async(url,options)=>{calls.push({url,options});return ok(apiFixture(reviewFixture()));}});
  assert.equal(r.questions.length,2);assert.equal(calls.length,1);
  const {url,options}=calls[0];assert.equal(url,API_ORIGIN+'/v1beta/models/gemini-test-flash:generateContent');
  assert.ok(!url.includes(key));assert.ok(!options.body.includes(key));assert.equal(options.headers['x-goog-api-key'],key);
  assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'strict-origin');
});
test('모델 목록은 generateContent용 Gemini만 추리며 키를 URL에 넣지 않음',async()=>{
  const found=await listModels('fictional',{fetchImpl:async url=>{
    assert.ok(!url.includes('fictional'));
    return ok({models:[...modelsFixture.models,{name:'models/gemini-test-tts',supportedGenerationMethods:['generateContent']},{name:'models/gemini-text-embedding',supportedGenerationMethods:['embedContent']}]});
  }});assert.equal(found.length,1);
});
for(const [status,pattern] of [[400,/모델/],[403,/권한/],[404,/목록/],[429,/한도/],[503,/서비스/]])test(`HTTP ${status}는 안전한 안내만 표시하고 자동 재시도하지 않음`,async()=>{
  let calls=0;
  await assert.rejects(generateReview('fictional',args,{fetchImpl:async()=>{calls++;return new Response('secret-provider-detail',{status});}}),pattern);
  assert.equal(calls,1);
});
test('호출 전 취소와 응답 대기 시간 초과',async()=>{
  const c=new AbortController();c.abort();let calls=0;
  await assert.rejects(generateReview('fictional',args,{signal:c.signal,fetchImpl:()=>{calls++;}}),{name:'AbortError'});assert.equal(calls,0);
  await assert.rejects(generateReview('fictional',args,{timeoutMs:10,fetchImpl:async(_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(new DOMException('cancel','AbortError'))))}),/시간/);
});
test('잘린 응답·차단·손상 JSON을 검토 완료로 취급하지 않음',()=>{
  for(const finishReason of ['MAX_TOKENS','SAFETY','OTHER'])assert.throws(()=>decodeResponse({candidates:[{finishReason}]},2,2),/완료|한도/);
  assert.throws(()=>decodeResponse({promptFeedback:{blockReason:'SAFETY'}},2,2),/응답/);
  assert.throws(()=>decodeResponse({candidates:[{finishReason:'STOP',content:{parts:[{text:'{bad json'}]}}]},2,2),/JSON/);
});
test('비공개 생각 파트 대신 최종 구조화 출력만 읽음',()=>{
  const r=apiFixture(reviewFixture());r.candidates[0].content.parts.unshift({thought:true,text:'internal-thought-not-JSON'});
  assert.equal(decodeResponse(r,2,2).questions.length,2);
});
test('기호 누락 후보와 불확실한 답을 검토 의견으로 유지',()=>{
  const r=validateReview(reviewFixture(),2,2);assert.equal(r.warnings.length,0);
  assert.equal(questionStatus(r.questions[0]),'오류 후보');assert.equal(questionStatus(r.questions[1]),'이상 징후 미발견');
});
test('0문항·부분 판독·교사 지정 문항 수 불일치는 범위 경고',()=>{
  const raw=reviewFixture();raw.questions=[];raw.document.readability='partial';
  const r=validateReview(raw,2,3);assert.ok(r.warnings.some(w=>w.includes('검토된 문항')));assert.ok(r.warnings.some(w=>w.includes('3문항')));
});
test('중복 번호·잘못된 쪽/근거·답 상태 모순은 확인 필요로 낮춤',()=>{
  const raw=reviewFixture();const q=raw.questions[1];q.id='1';q.pages=[999];q.answers=[];q.issues=[{...raw.questions[0].issues[0],page:999,quote:'',location:''}];
  const r=validateReview(raw,2,2);assert.ok(r.warnings.some(w=>w.includes('중복')));assert.equal(r.questions[1].confidence,'low');assert.equal(r.questions[1].answerStatus,'uncertain');assert.equal(r.questions[1].issues[0].severity,'check');
});
test('2차 누락 문항은 1차를 남기고 미검토 범위를 경고',()=>{
  const first=validateReview(reviewFixture(),2,2),raw=reviewFixture();raw.questions.pop();
  const merged=reconcileReviews(first,validateReview(raw,2,2));assert.equal(merged.questions.length,2);assert.equal(merged.questions[1].confidence,'low');assert.ok(merged.warnings.some(w=>w.includes('2차 검토')));
});
test('정보표 답과 비교하되 낮은 추출 신뢰도·복수 답·서답형 의미는 확정하지 않음',()=>{
  const q=validateReview(reviewFixture(),2,2).questions[1],ref={questions:[{number:'2',answer:'②',reliable:true}]};
  assert.match(compareReference(q,ref).label,/일치/);ref.questions[0].answer='①';assert.match(compareReference(q,ref).label,/불일치/);
  ref.questions[0].reliable=false;assert.match(compareReference(q,ref).label,/추출 확인/);
  ref.questions[0].reliable=true;assert.match(compareReference({...q,answerStatus:'multiple'},ref).label,/확정 어려움/);
  assert.match(compareReference({...q,kind:'written'},ref).label,/직접 검토/);
});
test('확장자 바꾸기·큰 파일을 거절하고 실제 PDF/이미지 매직 검증',()=>{
  assert.equal(detectMime(new Uint8Array([37,80,68,70,45]),'가상.pdf'),'application/pdf');
  assert.throws(()=>detectMime(new Uint8Array([1,2,3]),'가상.pdf'),/실제 PDF/);
  assert.throws(()=>detectMime(new Uint8Array(10*1024*1024+1),'가상.pdf'),/10MB/);
  assert.equal(toBase64(new Uint8Array([1,2,3])),'AQID');
});
test('선지 번호를 해석하지 못하면 정답 불일치로 단정하지 않음',()=>{
  const raw=reviewFixture();raw.questions[1].answers=['정답은 아마 ②번'];
  const q=validateReview(raw,2,2).questions[1];assert.equal(q.answerStatus,'uncertain');
  const ref={questions:[{number:'2',answer:'①',reliable:true}]};assert.match(compareReference(q,ref).label,/확정 어려움/);
  const clear=validateReview(reviewFixture(),2,2).questions[1];ref.questions[0].answer='별도 참고';assert.match(compareReference(clear,ref).label,/표기 확인/);
});
test('AI XLSX는 1차/최종을 보존하고 수식이나 API 키를 포함하지 않음',async()=>{
  const review=validateReview(reviewFixture(),2,2);review.questions[0].stemExcerpt='=HYPERLINK("fictional")';
  const b=new ExcelJS.Workbook();await b.xlsx.load(await aiReportBuffer({name:'가상.pdf',at:'가상 시각',model:args.model,secondComplete:false,first:review,review},null));
  assert.equal(b.worksheets.length,3);assert.equal(b.getWorksheet('최종 검토 의견').getCell('H2').value,'=HYPERLINK("fictional")');
  b.eachSheet(s=>s.eachRow(r=>r.eachCell(c=>assert.notEqual(c.type,ExcelJS.ValueType.Formula))));
  assert.match(b.getWorksheet('AI 검토 안내').getCell('B7').value,/미완료/);
});
