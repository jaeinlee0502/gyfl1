import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { fakeHwp } from '../../scripts/generate-hwp-samples.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sample = name => path.join(root, 'samples', name);
async function ready(page) { await page.goto('http://127.0.0.1:4173'); await expect(page.locator('#message')).toContainText('준비 완료'); }
async function choose(page, exam, info) { await page.locator('#exam').setInputFiles(sample(exam)); await page.locator('#info').setInputFiles(sample(info)); await page.locator('#check').click(); }
async function drop(page, target, names) {
  const payloads = await Promise.all(names.map(async item => typeof item === 'string' ? { name:item, bytes:Array.from(await readFile(sample(item))) } : item));
  const transfer = await page.evaluateHandle(values => {
    const dt = new DataTransfer();
    for (const value of values) dt.items.add(new File([new Uint8Array(value.bytes)],value.name));
    return dt;
  },payloads);
  await page.dispatchEvent(target,'dragenter',{dataTransfer:transfer});
  await page.dispatchEvent(target,'dragover',{dataTransfer:transfer});
  await page.dispatchEvent(target,'drop',{dataTransfer:transfer});
  await transfer.dispose();
}

test('오프라인 파일 점검·근거·보고서·입력 변경', async ({ page, context }) => {
  await ready(page);
  const requests = []; page.on('request', r => { if (/^https?:/.test(r.url())) requests.push([r.method(),r.url()]); });
  await context.setOffline(true);
  await choose(page, 'exam.docx', 'info_errors.xlsx');
  await expect(page.locator('#message')).toContainText('점검 완료');
  await expect(page.locator('#coverage')).toContainText('원안지 5개');
  await page.locator('#filter').selectOption('오류');
  await expect(page.locator('#findings-body tr')).toHaveCount(4);
  await page.locator('details summary').first().click();
  await expect(page.locator('details[open] pre')).toContainText('시트');
  const d = page.waitForEvent('download'); await page.locator('#export').click();
  const downloaded = await d, b = new ExcelJS.Workbook(); await b.xlsx.readFile(await downloaded.path());
  expect(b.worksheets.length).toBe(4);
  expect(requests).toEqual([]);
  await page.screenshot({ path: 'test-results/web-desktop.png', fullPage: true });
  await page.locator('#expected').fill('80'); await expect(page.locator('#results')).toBeHidden();
});

for (const exam of ['exam_fixture.hwpx','exam_text.pdf','exam_hwp_fixture.hwp','exam_hwp_uncompressed_fixture.hwp','exam_hwp_body_fixture.hwp']) test(`네트워크 없이 ${exam} 추출`, async ({ page, context }) => {
  await ready(page); await context.setOffline(true);
  await choose(page, exam, 'info_ok.xlsx');
  await expect(page.locator('#message')).toContainText('점검 완료');
  await page.locator('#tab-exam').click();
  await expect(page.locator('#exam-body tr')).toHaveCount(5);
  await expect(page.locator('#exam-body tr td:nth-child(2)')).toHaveText(['1','2','3','4','5']);
  await expect(page.locator('#exam-body tr td:nth-child(3)')).toHaveText(['20','20','20','20','20']);
  await expect(page.locator('#exam-body')).toContainText(/\.(pdf|hwp)$/.test(exam) ? '확인 필요' : '표 값');
});

test('HWP와 XLSX를 드래그해 오프라인 점검·근거·보고서 다운로드', async ({page,context}) => {
  await ready(page);
  const requests=[];page.on('request',r => {if (/^https?:/.test(r.url())) requests.push(r.url());});
  await context.setOffline(true);
  await drop(page,'#exam-dropzone',['exam_hwp_fixture.hwp']);
  await drop(page,'#info-dropzone',['info_ok.xlsx']);
  await expect(page.locator('#exam-name')).toHaveText('exam_hwp_fixture.hwp');
  await expect(page.locator('#info-name')).toHaveText('info_ok.xlsx');
  await page.locator('#check').click(); await expect(page.locator('#message')).toContainText('점검 완료');
  await expect(page.locator('.metric.error strong')).toHaveText('0');
  await expect(page.locator('.metric.review strong')).not.toHaveText('0');
  await page.locator('#findings-body details summary').first().click();
  await expect(page.locator('#findings-body details[open] pre')).toContainText('HWP');
  const wait=page.waitForEvent('download');await page.locator('#export').click();
  const file=await wait,book=new ExcelJS.Workbook();await book.xlsx.readFile(await file.path());
  expect(book.getWorksheet('원안지 추출').rowCount).toBe(6);
  expect(requests).toEqual([]);
  await page.screenshot({path:'test-results/web-hwp-drag.png',fullPage:true});
});

test('파일 교체 드롭은 역할을 유지하고 이전 결과 무효화', async ({page}) => {
  await ready(page);await choose(page,'exam.docx','info_errors.xlsx');
  await expect(page.locator('#message')).toContainText('점검 완료');
  await drop(page,'#info-dropzone',['info_ok.xlsx']);
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#exam-name')).toHaveText('exam.docx');
  await expect(page.locator('#info-name')).toHaveText('info_ok.xlsx');
  await page.locator('#check').click();await expect(page.locator('#message')).toContainText('점검 완료');
  await expect(page.locator('.metric.error strong')).toHaveText('0');
  await expect(page.locator('.metric.review strong')).toHaveText('0');
});

test('여러 파일·미지원 파일·영역 밖 드롭은 기존 선택을 보존', async ({page}) => {
  await ready(page);await choose(page,'exam.docx','info_ok.xlsx');
  await expect(page.locator('#message')).toContainText('점검 완료');
  await drop(page,'#exam-dropzone',['exam.docx','info_ok.xlsx']);
  await expect(page.locator('#message')).toContainText('한 개씩');
  await expect(page.locator('#exam-name')).toHaveText('exam.docx');
  await expect(page.locator('#results')).toBeVisible();
  await drop(page,'#exam-dropzone',[{name:'가상.exe',bytes:[1,2,3]}]);
  await expect(page.locator('#message')).toContainText('지원 형식');
  await expect(page.locator('#exam-name')).toHaveText('exam.docx');
  await drop(page,'body',['exam_hwp_fixture.hwp']);
  await expect(page.locator('#message')).toContainText('영역에');
  expect(page.url()).toBe('http://127.0.0.1:4173/');
  await expect(page.locator('#exam-name')).toHaveText('exam.docx');
});

test('점검 중 드롭은 파일을 교체하지 않음', async ({page}) => {
  await page.addInitScript(() => {
    const original=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(data,transfer){
      if (data?.kind === 'check') setTimeout(() => original.call(this,data,transfer),1000);
      else original.call(this,data,transfer);
    };
  });
  await ready(page);
  await page.locator('#exam').setInputFiles(sample('exam.docx'));
  await page.locator('#info').setInputFiles(sample('info_ok.xlsx'));
  await page.locator('#check').click();
  await expect(page.locator('#exam-dropzone')).toHaveAttribute('aria-busy','true');
  await drop(page,'#exam-dropzone',['exam_hwp_fixture.hwp']);
  await expect(page.locator('#message')).toContainText('점검 중');
  await expect(page.locator('#exam-name')).toHaveText('exam.docx');
  await expect(page.locator('#message')).toContainText('점검 완료');
});

test('보호 HWP는 드롭 후에도 명확한 안내로 거절', async ({page}) => {
  await ready(page);
  await drop(page,'#exam-dropzone',[{name:'가상_보호.hwp',bytes:Array.from(fakeHwp({flags:2}))}]);
  await drop(page,'#info-dropzone',['info_ok.xlsx']);
  await page.locator('#check').click();
  await expect(page.locator('#message')).toContainText('암호화');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#check')).toBeEnabled();
});

test('스캔 PDF는 OCR 미지원 안내·수정 전 결과 무효화', async ({ page }) => {
  await ready(page); await choose(page, 'exam.docx','info_ok.xlsx');
  await expect(page.locator('#message')).toContainText('점검 완료');
  await expect(page.locator('.metric.error strong')).toHaveText('0');
  await choose(page, 'scan_only.pdf', 'info_ok.xlsx');
  await expect(page.locator('#message')).toContainText('OCR');
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#check')).toBeEnabled();
});

test('가상 예제·모바일 화면·서버 통신 차단 정책', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page); await context.setOffline(true);
  await page.locator('#sample').click();
  await expect(page.locator('#exam-name')).toContainText('가상');
  await page.locator('#check').click();
  await expect(page.locator('#message')).toContainText('점검 완료');
  await expect(page.locator('.metric.error strong')).toHaveText('4');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path:'test-results/web-mobile.png', fullPage:true });
  const blocked = await page.evaluate(async () => { try { await fetch('/no-document-endpoint', { method:'POST',body:'fictional' }); return false; } catch { return true; } });
  expect(blocked).toBe(true);
  await page.locator('#clear').click();
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#exam-name')).toHaveText('선택한 파일 없음');
});
