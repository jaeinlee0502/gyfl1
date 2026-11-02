# 가상 샘플

모두 개발용 가상 자료입니다. 실제 시험 문항이나 학생 정보가 없습니다.

| 파일 | 용도 / 예상 결과 |
| --- | --- |
| `exam.docx` | 1~5번, 각 20점, 정답 1~5인 가상 원안지. 명시적 메타데이터 표 포함 |
| `info_ok.xlsx` | 정상 대조. 기본 기준 총점 100점에서 모든 점검 항목 정상 |
| `info_errors.xlsx` | 2번 정답 불일치, 3번 배점 불일치, 4번 누락, 5번 중복. 총점은 중복 때문에 확인 필요 |
| `info_total_error.xlsx` | 1번 배점 19점. 합계 99점이므로 기준/원문 표기 총점 100점과 불일치 |
| `info_review.xlsx` | 2번 배점이 Excel 수식, 3번 정답 누락. 확인 필요 |
| `exam_text.pdf` | 텍스트 PDF 본문 추출 예제. 추출값이 맞더라도 항상 확인 필요 |
| `scan_only.pdf` | 텍스트 없는 그림 PDF. OCR 미지원 안내를 확인하는 음성 테스트 |
| `exam_fixture.hwpx` | HWPX XML **어댑터 테스트용 최소 fixture**. 한글 편집기에서 열 수 있는 완전한 문서로 보장하지 않음 |
| `exam_hwp_fixture.hwp` | 웹 HWP 5 압축 표 추출용 가상 CFB fixture. 1~5번, 정답 1~5, 각 20점. 항상 확인 필요 |
| `exam_hwp_uncompressed_fixture.hwp` | 같은 가상 표의 비압축 HWP 5 fixture |
| `exam_hwp_body_fixture.hwp` | 정답·배점이 명시된 한 줄 본문 HWP 5 fixture |
| `exam_school_fixture.hwp` | 가상 학교 양식: 선택형 5문항·서답형 2문항 요약 표, 실제 본문은 선택형만 포함. 배점 줄바꿈/정답 미기재/별도 시험지 안내 |
| `info_table_fixture.pdf` | 가상 2쪽 정보표: 첫 쪽 헤더, 다음 쪽 연속 표, 선택형·서답형 번호 구분, 줄바꿈 채점기준표 참조 및 페이지 번호 |

UI의 ‘예제 불러오기’ 후 ‘점검 시작’을 누르세요. 실제 한글 문서는 한글에서 HWPX로 저장한 복사본을 사용하세요. HWPX의 복잡한 배치·수식·병합 표는 지원 범위가 제한되어 있습니다.

HWP fixture 4개는 **유효한 CFB/FileHeader/BodyText 바이너리의 추출 테스트용 최소 문서**이며 한글 편집기에서 편집/인쇄 가능한 전체 문서를 생성하는 도구는 아닙니다. 기본 HWP fixture는 `info_ok.xlsx`와 대조할 수 있습니다. `exam_school_fixture.hwp`와 `info_table_fixture.pdf`를 대조하면 가상 배점 불일치 2개와 정답 미기재/별도 원안지 안내가 나옵니다. 실제 첨부 문항·정답·점수 조합이나 개인정보를 복사한 자료가 아닙니다.

다시 생성: `.venv\Scripts\python scripts\generate_samples.py --force` (기존 가상 샘플을 덮어씁니다).

HWP fixture 재생성: Node 의존성 설치 후 프로젝트 루트에서 `node web/scripts/generate-hwp-samples.mjs --force`.

2쪽 정보표 생성: `.venv\Scripts\python scripts\generate_table_pdf.py --output 새가상정보표.pdf`. 기존 파일은 덮어쓰지 않습니다.

