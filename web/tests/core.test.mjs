import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { zipSync, strToU8 } from 'fflate';
import { answer, compare, document, ERROR, number, OK, points, REVIEW } from '../src/core.js';
import { readXlsx, readDocx, readHwpx } from '../src/office.js';
import { reportBuffer } from '../src/report.js';

const bytes = async name => new Uint8Array(await readFile(new URL('../../samples/' + name, import.meta.url)));
const exam = async () => readDocx(await bytes('exam.docx'), 'exam.docx');
const info = async name => readXlsx(await bytes(name), name);

test('번호·유형·정답·소수점의 보수적인 정규화', () => {
  assert.equal(number('01번'), '1'); assert.equal(number('서술형 01-02'), '서답형 1-2');
  assert.equal(number(1, '알 수 없음'), null); assert.equal(number('서술형 1', '객관식'), null);
  assert.equal(answer('③①'), '1,3'); assert.equal(answer('3/1'), '1,3'); assert.equal(answer('=A1'), null);
  assert.equal(points('2.5점'), '2.5'); assert.equal(points('2,5'), null); assert.equal(points(true), null);
});
for (const [name, reader] of [['exam.docx', readDocx], ['info_ok.xlsx', readXlsx], ['exam_fixture.hwpx', readHwpx]]) test(`${name} 실제 가상 파일 추출`, async () => {
  const d = await reader(await bytes(name), name);
  assert.equal(d.questions.length, 5); assert.equal(d.complete, true); assert.equal(d.questions[1].answer, '2');
  assert.equal(d.questions[2].points, '20'); assert.equal(d.totals[0].points, '100');
  assert.ok(d.questions.every(q => q.evidence.location && q.evidence.text && q.reliable));
});
test('정상 사례: 5문항·14항목 정상', async () => {
  const r = compare(await exam(), await info('info_ok.xlsx'));
  assert.equal(r.status, OK); assert.equal(r.findings.length, 14);
});
test('누락/중복/정답/배점 오류 후보와 중복 총점 확인', async () => {
  const r = compare(await exam(), await info('info_errors.xlsx'));
  for (const [code,n] of [['answer','2'],['points','3'],['missing','4'],['duplicate','5']]) assert.ok(r.findings.some(f => f.code === code && f.number === n && f.status === ERROR));
  assert.ok(r.findings.some(f => f.code === 'total' && f.status === REVIEW));
});
test('총점 불일치와 교사 지정 총점', async () => {
  const r = compare(await exam(), await info('info_total_error.xlsx'));
  assert.ok(r.findings.some(f => f.code === 'total' && f.status === ERROR && f.message.includes('99')));
  assert.equal(compare(await exam(), await info('info_ok.xlsx'), '80').findings.filter(f => f.code === 'total' && f.status === ERROR).length, 2);
});
test('수식/정답 없음은 확인 필요', async () => {
  const d = await info('info_review.xlsx'); assert.equal(d.questions[1].points, null); assert.equal(d.questions[2].answer, null);
  assert.equal(compare(await exam(), d).status, REVIEW);
});
test('문항 0개를 정상으로 처리하지 않음', () => assert.equal(compare(document('가상1'), document('가상2')).status, REVIEW));
test('XML 외부 엔티티/손상은 거절', () => {
  const b = zipSync({ 'Contents/section0.xml': strToU8('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///fictional">]><x>&a;</x>') });
  assert.throws(() => readHwpx(b, '가상.hwpx'), /엔티티/);
  assert.throws(() => readDocx(new Uint8Array([1,2,3]), '가상.docx'));
});
test('배점 합계는 0.1 + 0.2를 정확히 처리', () => {
  const make = () => ({ ...document('가상'), questions: ['0.1','0.2'].map((p,i) => ({ number:String(i+1),answer:'1',points:p,reliable:true,evidence:{location:'가상',text:p} })) });
  assert.equal(compare(make(),make(),'0.3').status, OK);
});
test('XLSX 보고서 원문은 수식이 아닌 문자열', async () => {
  const r = compare(await exam(), await info('info_ok.xlsx'));
  const injection = '=HYPERLINK("https://invalid.example/", "fictional")';
  r.findings[0].title = injection;
  const buffer = await reportBuffer(r), book = new ExcelJS.Workbook(); await book.xlsx.load(buffer);
  assert.equal(book.worksheets.length,4); assert.equal(book.getWorksheet('점검 결과').getCell('C2').value,injection);
  book.eachSheet(s => s.eachRow(row => row.eachCell(c => assert.notEqual(c.type, ExcelJS.ValueType.Formula))));
});
