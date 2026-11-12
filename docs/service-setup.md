# OhMyDots 계정 서비스 설치

OhMyDots를 하나의 서버에 설치한 뒤 같은 주소와 계정으로 로그인하면, 브라우저가 바뀌어도 Dot·대화·작업·설정 기록을 이어서 사용할 수 있습니다. 로그인 비밀번호는 해시로, 세션과 계정 기록은 서버 SQLite로 저장합니다. 첫 관리자만 초기 설정 코드를 사용하며 공개 회원 가입은 기본적으로 꺼져 있습니다.

## 한 줄 설치

macOS 또는 Linux에서 다음을 실행합니다. `curl`과 `tar`가 필요합니다. 사용할 수 있는 Node.js 24.15+와 OpenCode 2가 없으면, 설치 폴더 안에 Node 24.22.1과 OpenCode 2.0.32를 준비합니다. Node 자동 다운로드는 macOS와 glibc Linux의 x64·arm64를 지원하며 Alpine/musl에서는 먼저 배포판 패키지로 Node24.15+를 준비합니다. Node 아카이브는 공식 배포 파일의 고정 SHA-256과 비교합니다. 기존 전역 런타임은 교체하지 않습니다.

```sh
curl -fsSL https://raw.githubusercontent.com/omdots/oh-my-dots/refs/heads/main/install.sh | bash
```

설치기는 실행기·공개 주소를 고른 뒤 제공자 연결 주소와 API 키를 받고, 해당 연결로 조회한 모델 목록에서 선택하도록 안내합니다. 목록은 검색과 페이지 이동을 지원합니다. 조회 실패나 빈 목록일 때만 모델 ID를 직접 입력해 계속할 수 있습니다. 질문과 숨김 비밀번호·API 키 입력은 `/dev/tty`를 사용하므로 파이프로 실행해도 스크립트 본문을 답변으로 읽지 않습니다. 연결을 나중에 설정하려면 `later`를 선택합니다. API 키는 설치 화면에 표시하거나 로그에 출력하지 않습니다.

```sh
# 별도 설치 위치, 파일만 준비
curl -fsSL https://raw.githubusercontent.com/omdots/oh-my-dots/refs/heads/main/install.sh | bash -s -- --dir "$HOME/ohmydots-server" --no-start

# 아무 변경도 하지 않는 설치 계획
bash install.sh --dry-run --dir /tmp/ohmydots-preview

# 기존 체크아웃에서 설정 다시 실행
npm run service:setup -- --no-start
```

기본 주소는 `http://127.0.0.1:3420/login`입니다. foreground 모드는 현재 터미널에서 실행합니다. 다시 시작할 때는 설치기가 출력하는 `.data/service/run.sh`를 실행합니다. 처음 관리자 계정을 건너뛰었다면 서비스를 시작한 뒤 `/setup`을 열고, 서버의 `.data/service/bootstrap.token` 파일에 있는 코드를 입력합니다. 이 코드를 원격 채팅이나 공개 로그에 붙여 넣지 마세요.

새 설치는 GitHub 소스 아카이브를 사용하므로 Git이 없어도 됩니다. 기존 동일 Git 저장소의 `main` 체크아웃에서는 변경 없는 상태에서만 fast-forward 업데이트합니다. 아카이브 설치 폴더에는 덮어쓰지 않습니다. 업그레이드할 때는 서비스를 정지하고 개인 데이터 전체를 백업한 뒤, 새 폴더에 설치하고 설정의 `directory`를 기존 저장 위치로 지정합니다.

## 제공자와 실행기

OpenAI, Anthropic, OpenRouter, Ollama와 OpenAI 호환 endpoint를 지원하며 여러 제공자를 연속으로 추가할 수 있습니다. OpenCode 2 설정의 `providers`, `settings`, `package` 계약을 사용합니다. 제공자 정보와 키는 `.data/service/providers.json`에 mode0600으로 저장합니다. 웹 API 응답이나 원격 Git에 이 파일을 포함하지 않습니다. 서비스 설정 `env.DOTS_PROVIDER_CONFIG`가 이 파일을 가리킵니다.

OpenAI 호환 제공자는 제공자 ID를 정하고 연결에서 반환하는 모델을 선택합니다. API 키가 있다고 모든 공개 모델을 사용할 수 있다고 표시하지 않으며, 실제 추론의 사용 가능 여부는 제공자의 계정 권한·결제·해당 API 정책에 따릅니다. 기본 제공자의 모델 이름을 최신 모델이라고 추정해서 자동 선택하지 않습니다. OpenRouter 모델처럼 ID 안에 `/`가 있는 경우도 지원합니다. Ollama 기본 endpoint는 로컬 실행에서 `http://127.0.0.1:11434/v1`, Docker 실행에서 `http://host.docker.internal:11434/v1`입니다. Ollama 자체가 해당 연결을 받을 수 있도록 설정되어 있어야 합니다.

기본 실행기는 `opencode`입니다. `grok`를 선택하려면 복원된 Grok 소스와 그 프로젝트의 의존성, Node26을 따로 준비해야 합니다. 설치기에서 `DOTS_GROK_SOURCE`와 `DOTS_GROK_NODE`를 참조해 호스트를 빌드합니다. Grok은 foreground 또는 systemd 설치에서 선택할 수 있습니다.

```sh
DOTS_GROK_SOURCE=/absolute/grok-source DOTS_GROK_NODE=/absolute/node26 \
  node tools/service-setup.mjs --engine grok --no-start
```

일반 계정은 공유 컴퓨터에 자동으로 연결되지 않습니다. 기존 데스크톱 기록을 연결한 관리자 외의 계정에서 컴퓨터를 사용하려면 계정 전용 endpoint·토큰·작업 공간을 별도로 준비해야 합니다. 로그인 계정이 다르다는 이유로 같은 데스크톱을 안전하게 공유할 수 있다고 표시하지 않습니다.

## Linux에서 상시 실행

```sh
curl -fsSL https://raw.githubusercontent.com/omdots/oh-my-dots/refs/heads/main/install.sh | bash -s -- --mode systemd
systemctl --user status ohmydots.service
journalctl --user -u ohmydots.service -f
```

사용자 systemd unit을 생성하고 `enable --now`로 시작합니다. systemd가 있는 Linux와 실행 중인 사용자 service manager가 필요합니다. 로그아웃 후와 재부팅 후에도 사용자 서비스를 유지하려면 서버 관리자 정책에 따라 `loginctl enable-linger "$USER"`를 설정합니다. 비밀번호와 제공자 키는 unit의 Environment에 넣지 않고 private 파일에 저장합니다.

공개 서비스 주소는 HTTPS를 사용해야 합니다. 기존 reverse proxy가 없다면 생성된 `.data/service/Caddyfile`을 Caddy에 전달합니다. systemd 설치기의 Caddyfile은 호스트에 설치된 Caddy를 위한 것이며, Caddy를 자동 설치하거나 포트80·443을 개방하지 않습니다.

## Docker Compose와 자동 HTTPS

Docker Engine 또는 Docker Desktop과 Compose V2가 준비되어 있어야 합니다. 설치기가 Docker daemon을 설치하거나 Docker socket을 앱 컨테이너에 전달하지 않습니다.

```sh
curl -fsSL https://raw.githubusercontent.com/omdots/oh-my-dots/refs/heads/main/install.sh | bash -s -- \
  --mode docker --public-url https://dots.example.com
```

DNS A/AAAA가 해당 서버를 가리키고 포트80·443이 열려 있으면 Caddy가 인증서를 발급하고 갱신합니다. 앱 컨테이너는 별도 사용자 UID/GID, 읽기 전용 root filesystem, `/tmp` tmpfs로 실행합니다. 계정·키·설정은 호스트 `.data/service`를 `/data`로 mount하며, Caddy의 인증서 볼륨도 유지합니다. Dockerfile 전용 ignore 파일은 `.data`, `.local`, 환경 파일, Git 기록과 사용자 실험 파일을 build context에서 제외합니다.

```sh
# 설치기가 생성하는 실행기
~/.ohmydots/.data/service/compose.sh logs -f
~/.ohmydots/.data/service/compose.sh down
~/.ohmydots/.data/service/compose.sh up -d --build
```

HTTPS URL을 선택하면 `tls` profile의 Caddy도 시작합니다. 루프백 HTTP URL에서는 앱만 시작합니다. Compose 배포는 OpenCode 실행기를 사용합니다. 실제 공개 DNS·TLS 발급과 서버 부팅 이후의 재시작 여부는 해당 서버에서 확인해야 합니다.

## 자동 설치 입력과 데이터 보존

TTY 없는 환경에서는 private JSON 입력 파일을 전달합니다. 실제 키·비밀번호는 Git에 저장하지 마세요. `--no-start`는 계정과 설정 파일 생성까지 수행하고 프로세스는 시작하지 않습니다. `--dry-run`은 이름·제공자 ID 등 안전한 계획만 출력하고 파일을 만들지 않습니다.

```json
{
  "mode": "foreground",
  "publicUrl": "http://127.0.0.1:3420",
  "port": 3420,
  "engine": "opencode",
  "registration": false,
  "providers": [{
    "type": "ollama",
    "model": "your-installed-model",
    "baseURL": "http://127.0.0.1:11434/v1"
  }]
}
```

```sh
chmod 600 /private/ohmydots-input.json
node tools/service-setup.mjs --non-interactive --input /private/ohmydots-input.json --no-start
```

필요하면 입력 JSON에 `admin: {username, displayName, password}`를 추가해 첫 관리자 계정을 만듭니다. `legacyDir` 또는 `--legacy-dir`에는 기존 `dots.sqlite`가 들어 있는 절대 경로를 지정할 수 있습니다. 첫 관리자 계정의 `data_path`가 그 폴더를 가리키며 기록을 복사·삭제하지 않습니다. `legacyInference: true`를 명시하면 이 기록을 연결한 관리자만 이미 승인된 운영자의 OpenCode 연결을 이어 사용할 수 있습니다. 새 계정의 추론 저장소는 계속 분리되며 인증 정보를 복사하지 않습니다. Docker 설치에서는 기존 호스트 경로 연결을 자동 변환하지 않으므로 이 옵션을 허용하지 않습니다.

기존 데이터 폴더를 지정했다면 예전 앱이 같은 SQLite를 동시에 쓰지 않도록 먼저 종료하세요. 새 계정 데이터는 `.data/service/accounts/<account-id>/`, 인증 DB는 `.data/service/accounts.sqlite`에 저장합니다. 서비스를 정지하고 설정·키·계정 폴더와 연결한 기존 데이터 폴더를 함께 백업합니다. SQLite의 WAL이 남아 있으면 본 파일과 함께 보존해야 합니다.

## 구현에 참고한 공식 문서

- [Open WebUI의 연결 주소·API 키 입력과 모델 조회 흐름](https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible/)
- [OpenCode 2 설정](https://dev.opencode.ai/v2/docs/config/), [제공자와 호환 endpoint](https://dev.opencode.ai/v2/docs/providers/), [독립 서버 CLI](https://dev.opencode.ai/v2/docs/cli/)
- [Node 공식 배포와 체크섬](https://nodejs.org/dist/v24.22.1/SHASUMS256.txt), [OpenCode 공식 설치기](https://opencode.ai/v2/install)
- [Caddy Docker Compose](https://caddyserver.com/docs/running#docker-compose), [자동 HTTPS 조건](https://caddyserver.com/docs/automatic-https), [Docker 운영 배포](https://docs.docker.com/compose/how-tos/production/)
- [systemd 실행 환경과 credential](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [OWASP 비밀번호 저장](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP 세션 관리](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

## 설치 검증 범위

2026-10-28 별도 임시 폴더에 새 설치를 두 번 수행해 의존성 설치, 빌드, 원본 UI 1,479개·캐릭터 자산465개 검증과 설정 생성을 완료했습니다. 테스트용 계정 생성과 기존 SQLite를 변경하지 않는 연결도 확인했습니다. 실제 TTY에서는 숨김 키 입력 뒤 로컬 HTTP 서버의45개 모델을 조회하고 페이지 이동·검색·선택한 모델 저장까지 확인했습니다.

Docker 이미지도 실제로 빌드하고 호스트 포트를 공개하지 않은 임시 컨테이너에서 `/healthz`, Node24.22.1, OpenCode2.0.32 실행을 확인한 뒤 컨테이너를 종료했습니다. 임의 UID와 읽기 전용 root filesystem에서 OpenCode가 실행되도록 기본 XDG 경로를 `/tmp`에 두며, 계정별 추론 경로는 영구 데이터 폴더로 분리합니다. 이미지에 기존 `.data`, `.local`, 실험 폴더, 이전 앱·가상환경이 포함되지 않는 것도 확인했습니다. 공개 DNS·인증서 발급, 실제 유료 제공자 호출, Linux 재부팅 이후의 systemd 실행은 이 로컬 검증에 포함하지 않았습니다.

## OhMyDots 공통 계정과 MCP Provider

[OhMyDots MCP 설치 안내](https://github.com/omdots/oh-my-dots-mcp#quick-start)에 따라 Auth와 MCP를 실행합니다. Auth의 `OMD_WEB_REDIRECT`는 서비스 공개 주소에 `/api/auth/omd/callback`을 붙인 URL입니다. `OMD_WEB_MCP=1`을 설정하면 OMD 웹 클라이언트에 읽기 도구 사용 권한을 요청할 수 있습니다.

OMD 서비스에는 다음 값을 넣고 다시 시작합니다.

- `DOTS_AUTH_ISSUER`에 공통 Auth 주소를 넣습니다. 로컬 주소는 `http://127.0.0.1:4380`입니다.
- `DOTS_AUTH_CLIENT_SECRET`에 Auth의 `OMD_WEB_SECRET`과 같은 값을 넣습니다.
- `DOTS_MCP_URL`에 Provider 주소를 넣습니다. 로컬 주소는 `http://127.0.0.1:4381/mcp`입니다.

기존 로컬 계정으로 로그인한 뒤 **설정 → 계정 → OhMyDots 계정**에서 연결합니다. 이후 로그인 화면의 **OhMyDots 계정으로 로그인**으로 같은 계정을 열 수 있습니다. Provider 연결은 계정 설정에서 확인할 수 있고 OpenCode 엔진에는 공개 GitHub 이슈 읽기 도구가 제공됩니다. Provider 인증을 갱신하려면 OhMyDots 계정으로 다시 로그인합니다.
