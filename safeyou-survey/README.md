# 안전해YOU 사업장 기초조사

휴대전화와 노트북에서 작성하는 설치형 웹앱(PWA)입니다. 영업자 이름·휴대폰번호·6자리 PIN 회원가입, 계정별 조사서, 임시저장, 작성 완료, 엑셀 다운로드 기능을 포함합니다.

## 로컬에서 시작하기

Node.js 24 이상에서 다음 명령을 실행합니다.

```sh
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다. 미리보기 데이터베이스는 실행 중에만 유지되므로 확인용 데이터로 테스트합니다. `npm run build`는 `dist/server/index.js`에 배포용 Worker를 생성합니다.

## GitHub에 올리기

GitHub에서 빈 비공개 저장소를 만든 뒤, 압축을 풀고 이 README가 있는 폴더에서 아래 명령을 실행합니다. 마지막에서 두 번째 줄의 URL은 만든 저장소 주소로 바꿉니다.

```sh
git init -b main
git add .
git commit -m "Add SafetyYou survey app"
git remote add origin <GitHub 저장소 URL>
git push -u origin main
```

## 운영 환경

- Worker를 실행할 호스팅 환경에서 D1 바인딩 `DB`를 연결하고 `drizzle/`의 SQL 마이그레이션을 번호순으로 적용합니다. 새 Sites 프로젝트를 사용할 때는 해당 프로젝트 ID를 배포 설정에 등록합니다.
- 영업자 로그인은 서버 비밀값 `SURVEY_AUTH_PEPPER`가 필요합니다. 기존 운영 계정을 이전하는 경우에는 기존 비밀값도 보안 설정을 통해 이전해야 PIN 로그인이 유지됩니다. 신규 데이터베이스에서 시작하는 경우 새 비밀값을 생성합니다.
- 직접 이메일 발송에는 인증된 Resend 발신 주소 `MAIL_FROM`, 수신 주소 `MAIL_TO`, 발송 전용 비밀 키 `RESEND_API_KEY`가 필요합니다.
- 예전 ChatGPT 계정의 조사서 열기 기능은 호스팅 플랫폼이 검증해 전달하는 로그인 정보에 의존합니다. 다른 환경에 배포할 때는 외부 요청에서 해당 인증 헤더를 임의로 지정할 수 없도록 호스팅에서 제거하거나, 해당 기능을 끕니다.
- `worker/template.xlsx`는 비어 있는 조사서 양식입니다. 작성한 조사서, 가입자 정보, 운영 비밀값은 운영 환경에서 관리합니다.
