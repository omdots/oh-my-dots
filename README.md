# OhMyDots

원본 Dots UI에 계정별 기록 저장, OpenCode·Grok Bot 실행기와 Docker 컴퓨터를 연결한 앱입니다. 저장소 루트의 기본 앱이며, 이전 Python API·Next.js 웹·PostgreSQL 실행 구성을 대체합니다.

![Grok이 실제 컴퓨터를 조작하고 결과를 확인한 화면](docs/qa/exact-ui/grok-computer-control.png)

## 한 줄로 서비스 설치

```sh
curl -fsSL https://raw.githubusercontent.com/omdots/oh-my-dots/refs/heads/main/install.sh | bash
```

설치기가 필요한 Node·OpenCode 2를 준비하고, 관리자 계정·모델 제공자·서버 주소·실행 방식을 안내합니다. API 키를 넣으면 모델 목록을 조회하고 검색·선택할 수 있습니다. OpenAI, Anthropic, OpenRouter, Ollama, OpenAI 호환 서버를 지원합니다. 자동 조회가 없는 서버는 고급 설정에서 모델을 직접 추가합니다.

로컬 실행, Linux systemd 사용자 서비스, Docker Compose + Caddy HTTPS 중 선택합니다. 공개 HTTPS에는 도메인의 DNS와 80·443 포트가 준비돼 있어야 합니다. 영구 디스크에 데이터를 보관하는 단일 서버 구성입니다. [설치·운영 안내](docs/service-setup.md)에 비대화형 설치·업데이트·백업 방법이 있습니다.

이미 이 저장소가 있다면 다음처럼 설정합니다.

```sh
npm ci
npm run setup
npm run service:setup
# 설정 후 다시 시작
npm start
```

기본 주소는 **[http://127.0.0.1:3420/login](http://127.0.0.1:3420/login)** 입니다. 설치 중 관리자를 만들지 않았다면 `/setup`에서 서버의 `.data/service/bootstrap.token` 코드를 입력하고 생성합니다. 이후 프로필 메뉴의 계정 화면에서 제공자·모델과 사용자를 관리합니다. 공개 회원가입은 기본으로 꺼져 있습니다.

**+ Dots** 버튼은 생성·관리 탭을 엽니다. Dot·대화·작업·캐릭터·화면 설정은 계정별 서버 저장소에 저장됩니다. 같은 계정으로 다른 브라우저에서 로그인하면 같은 기록을 사용합니다. 사용량에는 실제 Dot·메시지·완료 작업 수를 표시하고, 토큰·청구 금액은 제공자 대시보드에서 확인합니다.

기본 서비스 실행기는 OpenCode입니다. Grok을 선택하면 로컬 Grok 소스와 Node26이 필요합니다. 이전 단일 사용자 실행은 `npm run legacy:original`로 제공합니다. 설치된 ChatGPT/Codex의 계정 저장소를 읽거나 복사하지 않습니다.

## 컴퓨터 사용

```sh
npm run computer:start
# 사용 후 컴퓨터만 종료
npm run computer:stop
```

Dot 프로필의 **컴퓨터** 버튼에서 실제 1280×960 Linux 화면을 엽니다. 채팅으로 화면 확인이나 브라우저 조작을 요청하면 Grok의 원본 `computerUse` 지침·Task 위임·Computer/Screenshot 도구를 사용합니다. 원본 UI·CSS·폰트·캐릭터 자산은 해시로 검증합니다.

로컬에서는 클라우드 자동 심사 대신 원래 수동 승인 경로를 사용하고 실행 전에 상태를 재확인합니다. Dots 실행 승인도 별도로 받아 카드가 두 번 나타날 수 있습니다. 사용자가 제어권을 가져가면 봇 입력은 차단됩니다. 봇이 컴퓨터를 넘기면 **제어권 가져오기 → 제어권 반환**으로 돌려주며, Grok이 새 화면을 읽고 재개합니다.

이전 단일 사용자 모드에서는 모든 Dot이 하나의 Docker 데스크톱을 공유합니다. 계정 서비스에서는 기존 데이터를 연결한 소유자만 이 컴퓨터를 사용합니다. 다른 계정은 전용 컴퓨터를 준비하기 전까지 컴퓨터 기능이 비활성화됩니다. Docker의 포트 3480은 루프백에만 공개합니다.

## 데이터와 기존 버전

계정과 세션은 `.data/service/accounts.sqlite`, 계정별 기록은 `.data/service/accounts/<account-id>/`에 저장합니다. 설치 중 `--legacy-dir`를 선택하면 기존 기록을 첫 관리자 계정에 연결합니다. 이 소유자의 기존 브라우저 캐릭터·화면 설정은 첫 로그인 때 서버에 가져오며, 계정 화면에서 다시 가져올 수도 있습니다. `.data/`, 인증 정보와 빌드 캐시는 Git에 올리지 않습니다. 새 계정은 OpenCode 데이터 경로도 분리합니다. `legacyInference`를 명시한 기존 소유자만 기존에 허용한 로컬 OpenCode 연결을 계속 사용합니다.

이전 앱은 [codex/dots-pre-original-ui 브랜치](https://github.com/omdots/oh-my-dots/tree/codex/dots-pre-original-ui)에 남아 있습니다. 이전 `.local/`과 PostgreSQL 데이터는 자동 삭제하거나 새 SQLite로 변환하지 않습니다. 별도로 쓰던 이번 Dots의 `.data/`를 계속 사용하는 방법은 [이전 안내](docs/migration.md)에 있습니다.

설정·프로필 메뉴·플러그인 탐색 화면은 원본 구성요소를 사용합니다. 플러그인 설치·OAuth, 첨부·비밀 입력·Grok 에이전트 간 메시지의 Dots 동기화는 아직 연결하지 않았습니다. 원본 클라우드 하네스 전체가 복원된 것은 아닙니다.

## 검증과 구현 근거

```sh
npm test
npm run build
npm run original:verify
npm run assets:verify
# 로컬 Grok 소스가 있을 때 실제 도구 프로토콜도 검증
node --test tests/grok-protocol.mjs
```

- [계정 서비스·모델 조회 구현과 검증](docs/account-service.md)
- [Grok 실행기·컴퓨터 연결과 실제 검증](docs/grok-integration.md)
- [원본 UI 연결·검증 범위](docs/exact-ui/verification.md)
- [컴퓨터 서비스와 제어권](docs/computer.md)
- [백엔드·승인 경계](docs/backend.md)
- [캐릭터 원본·해시](docs/character-evidence.md)
- [선택형 macOS 데스크톱 셸](apps/desktop/README.md)

기준 원본은 `app.asar` SHA-256 `5b5cf52887cfd4de19cb5862155a8ef6cf58830c0a2fc592b72060cfcc3be869`입니다. 원본 앱 버전이 바뀌면 내부 계약도 달라질 수 있습니다. 원본 자산의 소유권이나 공개 배포 권한을 주장하지 않습니다.
