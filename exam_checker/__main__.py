import argparse
import sys
from decimal import Decimal, InvalidOperation

from .offline import enable_network_guard


def main(argv=None):
    enable_network_guard()
    for stream in (sys.stdout, sys.stderr):
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(description="시험출제 통합점검기 — 파일은 PC 안에서만 처리합니다.")
    sub = parser.add_subparsers(dest="command")
    check = sub.add_parser("check", help="화면 없이 로컬 파일을 점검합니다.")
    check.add_argument("--exam", required=True, help="시험 원안지")
    check.add_argument("--info", required=True, help="문항정보표")
    check.add_argument("--expected-total", default="100", help="교사 지정 기준 총점(기본 100)")
    check.add_argument("--report", help="XLSX 보고서 저장 경로(원본과 다른 경로)")
    args = parser.parse_args(argv)
    if args.command is None:
        from .ui import run
        return run()
    from .models import Status
    from .report import save_report
    from .service import check_files

    try:
        try:
            total = Decimal(args.expected_total)
        except InvalidOperation as exc:
            raise ValueError("기준 총점은 숫자로 입력해 주세요. 예: --expected-total 100") from exc
        result = check_files(args.exam, args.info, total)
        if args.report:
            save_report(result, args.report)
        print(f"점검 완료: {result.status.value} | 오류 {result.count(Status.ERROR)} / 확인 필요 {result.count(Status.REVIEW)} / 정상 {result.count(Status.OK)} (점검 항목 수)")
        for item in result.findings:
            if item.status != Status.OK:
                print(f"[{item.status.value}] {item.number}: {item.title} — {item.message}")
        return 1 if result.status == Status.ERROR else 2 if result.status == Status.REVIEW else 0
    except (ValueError, OSError, InvalidOperation) as exc:
        print(f"점검할 수 없습니다: {exc}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())

