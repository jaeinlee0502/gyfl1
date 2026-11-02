# 공개 배포 완료

2026-11-02: GitHub Pages 공개 배포를 완료했습니다.

**공개 주소: https://jaeinlee0502.github.io/gyfl1/**

GitHub의 실제 `pagesUrl`과 [Pages 배포 작업](https://github.com/jaeinlee0502/gyfl1/actions/runs/41372865632)의 `COMPLETED / SUCCESS` 상태를 공개 GitHub 화면에서 확인했습니다.

- 소스 최초 커밋 `c6819b0`을 `jaeinlee0502/gyfl1`의 `main`에 push했습니다.
- 테스트된 정적 빌드 파일 17개를 소스와 별도의 `gh-pages` 브랜치에 게시했습니다. 커밋은 `0043736b93184dfc466eab2f2e8cce98cde5ee43`입니다. 실제 원안지/학생 정보/점검 보고서를 포함하지 않습니다.
- 현재 환경에서 `api.github.com` 및 `jaeinlee0502.github.io` HTTPS 연결이 **프록시 CONNECT 단계에서 403 Forbidden**으로 거절됩니다. GitHub API에서 Pages를 활성화하거나 실행 중인 공개 사이트에 접속하는 검증은 이 차단을 해소해야 가능합니다.
- API 대신 `gh-pages`를 게시하자 GitHub가 Pages를 자동 활성화하여 배포에 성공했습니다. 사용자에게 별도 Pages 활성화를 요청할 필요가 없습니다. 불필요해진 네트워크 허용 목록 초안 변경은 원래대로 되돌렸습니다.
- 추후 설정은 저장소 [Settings → Pages](https://github.com/jaeinlee0502/gyfl1/settings/pages)에서 확인할 수 있습니다. 배포 소스는 **Deploy from a branch → gh-pages → / (root)**입니다.

이 환경에서는 사이트 도메인의 HTTPS CONNECT가 여전히 차단되어 공개 URL의 직접 HTTP 접속 검증은 수행하지 못했습니다. GitHub가 보고한 배포 성공과 실제 페이지 주소는 확인했고, 동일한 정적 파일의 로컬 Chromium 오프라인 테스트 5개는 통과했습니다. 사이트를 처음 사용할 때 가상 예제로 점검/보고서 다운로드를 확인하세요.

별도 소스 CI에서 Ubuntu 26으로 이동한 `ubuntu-latest`의 브라우저 설치/Qt 테스트 실패가 발견되어, 지원되는 Ubuntu 24.04로 고정하고 Linux Qt 실행 라이브러리 설치를 추가했습니다. Pages 게시 작업 자체는 성공한 상태입니다.
