# K-Insurance — Gopang AI 보험 시스템
## 종래의 보험을 대체하는 AI 쌍둥이 v1.0

> **저장소:** `Openhash-Gopang/insurance`  
> **도메인:** `insurance.hondi.net`  
> **운영:** AI City Inc. / OpenHash Network  
> **최초 서비스:** 2026년 (제주 시범)  
> **법적 성격:** 고팡 플랫폼 내 상황 기반 자동 보험 Agent

---

## § 1. 핵심 원칙

| 원칙 | 내용 |
|------|------|
| **상황 기반 자동 적용** | 이동·결제·의료 이벤트 발생 시 AI가 필요한 보험을 자동 판단·적용 |
| **청구 자동화** | 사고 발생 → 증거(PDV + OpenHash) → 청구 서류 자동 생성 → 자동 지급 |
| **무심사 마이크로 보험** | ₮1 단위 소액 보험. 가입·지급 전 과정 AI 처리. 심사 기간 0 |
| **PDV 연동** | 모든 보험 이벤트는 PDV에 6하 원칙으로 기록, OpenHash 앵커링 |
| **재무제표 = 신용** | `user_profiles.extra.fs` 재무제표 기반 보험료 산출 |
| **무지점·무설계사** | 지점·설계사 없음 → 사업비 절감 → 보험료 현저히 낮음, 보험금 빠름 |

---

## § 2. 보험 상품 체계

```
K-Insurance 상품군
├── [AUTO] 자동 적용 보험 (이벤트 트리거)
│   ├── 탑승 보험      — K-Traffic 카풀·택시 탑승 시 자동
│   ├── 배달 보험      — K-Market 배달 주문 시 자동
│   ├── 응급 의료 보험 — K-119 출동 시 자동
│   └── 거래 사기 보험 — GDC 고액 이체 시 자동
│
├── [LIFE] 생명 보험
│   ├── 정기 생명보험   — 사망·고도 장해
│   ├── 종신 보험       — OpenHash 신탁 연동
│   └── 연금 보험       — GDC POOL 투자 연동
│
├── [HEALTH] 건강 보험
│   ├── 실손 의료보험   — K-Health 진료기록 자동 연동
│   ├── 암 보험         — AI 정밀 심사
│   └── 간병 보험       — K-Health 장기 돌봄 연동
│
├── [PROPERTY] 재산 보험
│   ├── 화재 보험       — K-119 화재 감지 자동 연동
│   ├── 도난 보험       — K-Security CCTV 연동
│   └── 여행자 보험     — K-Traffic 해외 이동 감지
│
└── [LIABILITY] 배상 책임
    ├── 개인 배상책임   — K-Law 자동 분석
    ├── 사업자 배상책임 — K-Market 업체 전용
    └── 사이버 보험     — K-Security 해킹·랜섬웨어
```

---

## § 3. 모듈 구조

```
insurance/
├── index.html                  ← K-Insurance 랜딩 (소개·상품 목록·가입)
├── dashboard.html              ← 관리자 대시보드 (계약·청구·지급 현황)
├── webapp.html                 ← 사용자 보험 앱 (내 보험·청구·보험금 조회)
│
├── js/
│   ├── ins-core.js             ← 보험 계약 조회·생성·해지·변경
│   ├── ins-premium.js          ← 보험료 계산 (재무제표·나이·이력 기반)
│   ├── ins-claim.js            ← 청구 접수·처리·보험금 지급 자동화
│   ├── ins-auto.js             ← 이벤트 트리거 자동 보험 적용 엔진
│   ├── ins-risk.js             ← AI 리스크 평가·언더라이팅
│   └── ins-crypto.js           ← ED25519 서명 검증 (GDC 연동)
│
├── prompts/
│   └── SP-INS_agent_v1.0.txt  ← K-Insurance AI Agent 시스템 프롬프트
│
├── sql/
│   ├── 01_ins_schema.sql       ← Supabase 테이블 스키마
│   └── 02_ins_rls.sql          ← RLS 정책 (보안)
│
├── api/
│   └── ins-proxy.js            ← Cloudflare Worker (외부 데이터 프록시)
│
├── CNAME                       ← insurance.hondi.net
└── docs/
    ├── DESIGN.md               ← 상세 설계
    ├── WHITEPAPER.md           ← K-Insurance 백서
    └── API.md                  ← REST API 명세
```

---

## § 4. Supabase 데이터 모델

### 기존 연동 테이블 (gopang 공유)
| 테이블 | 역할 |
|--------|------|
| `user_profiles.extra.fs` | 재무제표 (보험료 산출 근거) |
| `pdv_log` | PDV 6하 원칙 기록 |
| `fs_ledger` | GDC 보험료·보험금 원장 |

### 신규 테이블
| 테이블 | 역할 |
|--------|------|
| `ins_policies` | 보험 계약 원장 |
| `ins_claims` | 보험 청구 원장 |
| `ins_events` | 자동 보험 트리거 이벤트 로그 |
| `ins_payouts` | 보험금 지급 원장 |

---

## § 5. 타 Agent 연동

| 연동 Agent | 연동 내용 |
|-----------|---------|
| **K-119** | 응급출동 → 자동 의료보험 청구 서류 생성 |
| **K-Traffic** | 탑승 이벤트 → 자동 탑승 보험 적용 |
| **K-Health** | 진료기록 → 실손보험 자동 청구 |
| **K-Security** | CCTV 사고 영상 → 도난·화재보험 증거 패키지 |
| **K-Law** | 사고 법적 분석 → 배상 책임 판단 |
| **K-Police** | 범죄 사건번호(KP-) → 보험 사기 탐지 |
| **GDC** | 보험료 자동 출금·보험금 자동 입금 (₮) |
| **OpenHash** | 모든 청구·지급 이벤트 앵커링 (법적 증거) |

---

## § 6. 자동 보험 플로우 (예시: 교통사고)

```
K-Traffic 탑승 이벤트 감지
        │
        ▼
ins-auto.js → 탑승 보험 자동 적용
  ├── 보험료: ₮0.5 (GDC 자동 출금)
  └── 보험번호: INS-20260604-XXXX 발급
        │
        ▼
[사고 발생]
K-119 출동 → K-Police 연동
        │
        ▼
K-Insurance 자동 감지
  ├── PDV 사고 기록 추출 (6하원칙)
  ├── OpenHash 앵커 참조값 수집
  ├── K-Security 영상 증거 패키지
  ├── K-Law AI 법적 책임 분석
  └── 청구 서류 자동 생성
        │
        ▼
AI 심사 (ins-risk.js) → 0.3초
  ├── 정상 → 보험금 GDC 자동 지급
  └── 이상 → K-Police 사기 의심 연동
        │
        ▼
전 과정 PDV + OpenHash 앵커링
```

---

## § 7. AI 모델 구성

| 서비스 단계 | 사용 모델 | 역할 |
|------------|----------|------|
| 기본 상담·안내 | DeepSeek V4 Pro | 보험 상품 안내, FAQ, 청구 절차 안내 |
| 리스크 평가·언더라이팅 | DeepSeek V4 Pro | 보험료 산출, 인수 심사 |
| 복잡 청구 심사 | Claude Opus | 고액·분쟁 청구, 사기 탐지, 법적 해석 |
| 배상책임 분석 | Claude Opus + K-Law v15.1 | 법적 책임 판단, 소송 예측 |

---

## § 8. 보안 모델

| 계층 | 위협 | 대응 |
|------|------|------|
| 보험 계약 | 위변조 | OpenHash 앵커링 + ED25519 서명 |
| 청구 심사 | 보험 사기 | K-Police 연동 + AI 이상 탐지 |
| 개인정보 | 무단 열람 | PDV 암호화 + RLS 정책 |
| 보험금 지급 | 이중 지급 | GDC BIVM Σδ=0 + 원장 검증 |
| AI 판단 | 프롬프트 인젝션 | 입력 검증 + K-Law 백그라운드 모니터 |

---

## § 9. 라이선스 및 기여

- **라이선스:** GPL v3.0
- **AI 시스템 프롬프트:** `prompts/SP-INS_agent_v1.0.txt` 공개
- **기여:** DAWN 투표로 상품·요율 변경
- **문의:** tensor.city@gmail.com

---

*K-Insurance v1.0 — AI City Inc. / OpenHash Network*  
*hondi.net 하위 시스템 | 제주 시범 운영 2026*
