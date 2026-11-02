import { test,expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { reviewFixture,apiFixture,modelsFixture } from '../ai-cases.mjs';
import { API_ORIGIN } from '../../src/gemini.js';

const sample=name=>fileURLToPath(new URL('../../../samples/'+name,import.meta.url));
const KEY='fictional-browser-key-not-a-secret';
async function mockApi(page,generate=()=>({status:200,json:apiFixture(reviewFixture())})) {
  const calls=[];
  await page.route(API_ORIGIN+'/**',async route=>{
    const request=route.request();
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type,x-goog-api-key','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
    if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    if(request.method()==='GET'){await route.fulfill({json:modelsFixture,headers});return;}
    calls.push({url:request.url(),headers:request.headers(),body:request.postDataJSON()});
    const response=await generate(calls.length,route);
    if(response)await route.fulfill({...response,headers});
  });
  return calls;
}
async function prepare(page,{image=false,reference=false}={}) {
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#ai-key').fill(KEY);await page.locator('#ai-models').click();
  await expect(page.locator('#ai-message')).toContainText('모델 목록을 불러왔습니다');
  await page.locator('#ai-model').selectOption('models/gemini-test-flash');
  await page.locator('#ai-file').setInputFiles(sample(image?'ai_review_fixture.png':'ai_review_fixture.pdf'));
  await expect(page.locator('#ai-message')).toContainText('원안지를 준비했습니다');
  // 준비 상태만으로 빈 캔버스를 통과시키지 않는다. 가상 문항의 글자 픽셀을 확인한다.
  const ink=await page.locator('#ai-canvas').evaluate(canvas=>{
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let n=0;for(let i=0;i<data.length;i+=4)if(data[i+3]>0&&data[i]<100&&data[i+1]<100&&data[i+2]<100)n++;
    return n;
  });
  expect(ink).toBeGreaterThan(100);
  await page.locator('#ai-count').fill('2');
  if(reference){await page.locator('#ai-info').setInputFiles(sample('ai_info_fixture.xlsx'));await expect(page.locator('#ai-reference-status')).toContainText('2행 추출');}
}

test('전송 동의 전에는 문서 요청 없음 · 2단계 검토 · 정보표 비전송 · 근거·보고서',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const calls=await mockApi(page);
  await prepare(page,{reference:true});
  await expect(page.locator('#ai-preview')).toBeVisible();await expect(page.locator('#ai-page-label')).toHaveText('파일 1 / 2쪽');
  await page.locator('#ai-next').click();await expect(page.locator('#ai-page-label')).toHaveText('파일 2 / 2쪽');
  await expect(page.locator('#ai-run')).toBeDisabled();expect(calls.length).toBe(0);
  await page.locator('#ai-consent').check();await page.locator('#ai-run').click();
  await expect(page.locator('#ai-message')).toContainText('AI 검토 의견을 받았습니다');
  await expect(page.locator('.ai-result-card')).toHaveCount(2);
  await expect(page.locator('#ai-cards')).toContainText('자료에는 (가)만');
  await expect(page.locator('#ai-cards')).toContainText('AI 답과 정보표 불일치 후보');
  await expect(page.locator('#ai-summary')).toContainText('오류 후보 2문항');
  expect(calls.length).toBe(2);
  for(const c of calls){const s=JSON.stringify(c.body);expect(c.headers['x-goog-api-key']).toBe(KEY);expect(s).not.toContain(KEY);expect(s).not.toContain('LOCAL_ONLY_SENTINEL_8F31');expect(s).not.toContain('ai_info_fixture');expect(c.body.contents[0].parts[1].inlineData.mimeType).toBe('application/pdf');expect(c.body.contents[0].parts[1].inlineData.data.length).toBeGreaterThan(100);}
  expect(calls[0].body.contents[0].parts[0].text).not.toContain('1차 검토 데이터');
  expect(calls[1].body.contents[0].parts[0].text).toContain('1차 검토 데이터');
  const d=page.waitForEvent('download');await page.locator('#ai-export').click();const file=await d,book=new ExcelJS.Workbook();await book.xlsx.readFile(await file.path());
  expect(book.worksheets.length).toBe(4);expect(book.getWorksheet('최종 검토 의견').rowCount).toBe(3);
  expect(JSON.stringify(book.model)).not.toContain(KEY);
  await page.screenshot({path:'test-results/web-gemini-review.png',fullPage:true});
  await page.locator('#ai-subject').fill('가상 과목 변경');await expect(page.locator('#ai-results')).toBeHidden();await expect(page.locator('#ai-consent')).not.toBeChecked();
  await page.locator('#ai-forget').click();await expect(page.locator('#ai-key')).toHaveValue('');
  expect(await page.evaluate(()=>[localStorage.length,sessionStorage.length,document.cookie])).toEqual([0,0,'']);expect(errors).toEqual([]);
});

test('목록 조회도 명시적 클릭 전에는 호출하지 않고 이미지 미리보기는 로컬',async({page})=>{
  const requests=[];await mockApi(page);await page.goto('http://127.0.0.1:4173');
  page.on('request',r=>{if(r.url().startsWith(API_ORIGIN))requests.push(r.url());});
  await page.locator('#ai-key').fill(KEY);await page.locator('#ai-file').setInputFiles(sample('ai_review_fixture.png'));
  await expect(page.locator('#ai-message')).toContainText('원안지를 준비했습니다');
  expect(requests).toEqual([]);expect(await page.locator('#ai-canvas').evaluate(c=>c.width)).toBeGreaterThan(100);
  await page.locator('#ai-models').click();await expect(page.locator('#ai-message')).toContainText('모델 목록을 불러왔습니다');
  expect(requests.length).toBe(1);
  await page.locator('#ai-clear').click();await expect(page.locator('#ai-preview')).toBeHidden();
});

test('이미지를 드래그해서 1문항 검토 · PNG 원본 전송',async({page})=>{
  const response=reviewFixture();response.questions.pop();response.document.detectedQuestionCount=1;
  const calls=await mockApi(page,()=>({status:200,json:apiFixture(response)}));
  await page.goto('http://127.0.0.1:4173');await page.locator('#ai-key').fill(KEY);await page.locator('#ai-models').click();
  await expect(page.locator('#ai-message')).toContainText('모델 목록을 불러왔습니다');await page.locator('#ai-model').selectOption('models/gemini-test-flash');
  const bytes=Array.from(await readFile(sample('ai_review_fixture.png')));
  const dt=await page.evaluateHandle(bytes=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(bytes)],'가상문항.png',{type:'image/png'}));return d;},bytes);
  await page.dispatchEvent('#ai-dropzone','drop',{dataTransfer:dt});await dt.dispose();
  await expect(page.locator('#ai-message')).toContainText('원안지를 준비했습니다');await page.locator('#ai-count').fill('1');
  await page.locator('#ai-consent').check();await page.locator('#ai-run').click();await expect(page.locator('#ai-message')).toContainText('AI 검토 의견을 받았습니다');
  expect(calls.length).toBe(2);expect(calls[0].body.contents[0].parts[1].inlineData.mimeType).toBe('image/png');
  await expect(page.locator('.ai-result-card')).toHaveCount(1);
});

test('할당량 오류는 안내하고 자동 재시도하지 않음',async({page})=>{
  const calls=await mockApi(page,()=>({status:429,json:{error:{message:'sensitive-detail-must-not-display'}}}));
  await prepare(page);await page.locator('#ai-consent').check();await page.locator('#ai-run').click();
  await expect(page.locator('#ai-message')).toContainText('한도를 초과');await expect(page.locator('#ai-message')).not.toContainText('sensitive-detail');
  await expect(page.locator('#ai-results')).toBeHidden();await expect(page.locator('#ai-run')).toBeEnabled();expect(calls.length).toBe(1);
});

test('1차 출력 잘림은 완료 처리하지 않고 2차도 호출하지 않음',async({page})=>{
  const calls=await mockApi(page,()=>({status:200,json:{candidates:[{finishReason:'MAX_TOKENS'}]}}));
  await prepare(page);await page.locator('#ai-consent').check();await page.locator('#ai-run').click();
  await expect(page.locator('#ai-message')).toContainText('잘렸습니다');await expect(page.locator('#ai-results')).toBeHidden();expect(calls.length).toBe(1);
});

test('2차 실패는 1차 의견과 미완료 표시를 보존',async({page})=>{
  const calls=await mockApi(page,n=>n===1?{status:200,json:apiFixture(reviewFixture())}:{status:503,json:{error:{}}});
  await prepare(page);await page.locator('#ai-consent').check();await page.locator('#ai-run').click();
  await expect(page.locator('#ai-summary')).toContainText('2차 검토 미완료');await expect(page.locator('#ai-warning')).toContainText('1차 검토 의견');
  await expect(page.locator('.ai-result-card')).toHaveCount(2);expect(calls.length).toBe(2);
});

test('중단한 요청의 늦은 응답이 결과를 복원하지 않음',async({page})=>{
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const calls=await mockApi(page,async()=>{await pending;return {status:200,json:apiFixture(reviewFixture())};});
  await prepare(page);await page.locator('#ai-consent').check();await page.locator('#ai-run').click();
  await expect.poll(()=>calls.length).toBe(1);await page.locator('#ai-cancel').click();release();
  await expect(page.locator('#ai-message')).toContainText('중단했습니다');await expect(page.locator('#ai-results')).toBeHidden();
  await page.locator('#ai-forget').click();await expect(page.locator('#ai-key')).toHaveValue('');expect(calls.length).toBe(1);
});

test('HWP AI 입력은 PDF 변환 안내 · 손상 정보표는 제외 전까지 전송 차단 · 모바일',async({page})=>{
  await page.setViewportSize({width:390,height:844});const calls=await mockApi(page);await prepare(page);
  await page.locator('#ai-file').setInputFiles(sample('exam_hwp_fixture.hwp'));await expect(page.locator('#ai-message')).toContainText('HWP');await expect(page.locator('#ai-run')).toBeDisabled();
  await page.locator('#ai-file').setInputFiles(sample('ai_review_fixture.pdf'));await expect(page.locator('#ai-message')).toContainText('원안지를 준비했습니다');
  await page.locator('#ai-info').setInputFiles({name:'가상손상.xlsx',mimeType:'application/octet-stream',buffer:Buffer.from('fictional bad zip')});
  await expect(page.locator('#ai-message')).toContainText('정보표를 읽지 못했습니다');await page.locator('#ai-consent').check();await expect(page.locator('#ai-run')).toBeDisabled();
  await page.locator('#ai-info-clear').click();await page.locator('#ai-consent').check();await expect(page.locator('#ai-run')).toBeEnabled();expect(calls.length).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/web-gemini-mobile.png',fullPage:true});
});
