import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const sample = name => path.join(root, 'samples', name);
async function ready(page) { await page.goto('http://127.0.0.1:4173'); await expect(page.locator('#message')).toContainText('준비 완료'); }
async function choose(page, exam, info) { await page.locator('#exam').setInputFiles(sample(exam)); await page.locator('#info').setInputFiles(sample(info)); await page.locator('#check').click(); }

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

for (const exam of ['exam_fixture.hwpx','exam_text.pdf']) test(`네트워크 없이 ${exam} 추출`, async ({ page, context }) => {
  await ready(page); await context.setOffline(true);
  await choose(page, exam, 'info_ok.xlsx');
  await expect(page.locator('#message')).toContainText('점검 완료');
  await page.locator('#tab-exam').click();
  await expect(page.locator('#exam-body tr')).toHaveCount(5);
  await expect(page.locator('#exam-body tr td:nth-child(2)')).toHaveText(['1','2','3','4','5']);
  await expect(page.locator('#exam-body tr td:nth-child(3)')).toHaveText(['20','20','20','20','20']);
  await expect(page.locator('#exam-body')).toContainText(exam.endsWith('pdf') ? '확인 필요' : '표 값');
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
