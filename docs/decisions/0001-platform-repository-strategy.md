# OhMyDots 조직 이전과 저장소 분리

상태 · 제안

## 저장소별 역할

GitHub 조직 `omdots`를 여러 에이전트 제품을 관리할 수 있는 범위로 두고, OhMyDots를 첫 제품으로 둔다.

| 저장소 | 관리 범위 |
| --- | --- |
| `oh-my-dots` | 제품 설치, 통합 배포, 버전 조합, 통합 테스트와 설계 결정 기록 |
| `oh-my-dots-backend` | 계정, 세션, SQLite, 작업 상태, 도구 승인, REST API와 SSE |
| `oh-my-dots-frontend` | 웹 화면, 로그인과 설정, API 클라이언트, 렌더러 호스트 |
| `oh-my-dots-engine-adapters` | OpenCode와 Grok 연결 코드, 엔진별 준비 절차와 호환성 테스트 |

초기 스킬 목록과 엔진 평가 기록은 `oh-my-dots`에서 관리한다. 외부 엔진 후보에는 소스와 검토한 버전, 실험 결과, 채택 여부를 기록한다. 개인 계정의 Grok 재구성 포크는 연구 자료로 연결한다.

## 현재 코드에서 먼저 정리할 경계

- **프론트엔드와 백엔드.** 기본 서비스는 로그인 화면을 직접 제공하고 원본 렌더러를 같은 주소에서 프록시한다. 분리 후에도 로그인 쿠키, 쓰기 요청의 출처 검증, `/api/events` 재연결이 같은 공개 주소에서 동작해야 한다. 기존 서비스와 실제 렌더러가 사용하는 API부터 기준으로 삼는다. [계정 서비스](../../server/service.mjs) · [렌더러 호스트](../../exact-host/server.mjs) · [화면의 API 연결](../../exact-host/local-adapter.mjs)
- **백엔드와 엔진 어댑터.** `GrokRuntime`은 공통 `Runtime`을 상속하고 저장소와 컴퓨터 승인 경로에 연결된다. 백엔드가 소유하는 작업 상태·승인과 엔진이 담당하는 실행·취소·재개 사이의 호출 경계를 먼저 정한다. 두 엔진의 반환값과 오류를 기존 서비스 테스트로 검증한 뒤 어댑터를 추출한다. [공통 런타임](../../server/runtime.mjs) · [Grok 런타임](../../server/grok-runtime.mjs) · [OpenCode 연결](../../engine-adapters/opencode.mjs)

## 이전 순서

1. 새 조직의 이름과 소유자를 정한다. 기존 `oh-my-dots`는 GitHub 저장소 이전 기능으로 옮겨 이력과 이슈·PR을 이어간다. 이전 전후로 설치 스크립트의 다운로드 URL과 기존 설치의 업데이트 경로, Actions, Docker 빌드를 확인한다. [설치 스크립트](../../install.sh) · [CI](../../.github/workflows/checks.yml) · [Docker 빌드](../../deploy/Dockerfile)
2. 위 경계를 현재 저장소에서 정리하고, 서비스 테스트·빌드·자산 검증을 통과시킨다. 통합 확인에는 로그인, 메시지 전송, 승인, 작업 취소·재개, SSE 재연결을 포함한다.
3. 백엔드·프론트엔드·엔진 어댑터를 각각 추출하고, `oh-my-dots`에서 검증한 버전 조합을 고정한다. 새 저장소는 비공개로 시작한다. 원본 렌더러·폰트·캐릭터 자산 및 재구성 엔진 소스는 배포 범위가 확인된 파일만 옮긴다. [현재 자산 및 실행기 범위](../../README.md) · [Grok 연결](../grok-integration.md)
