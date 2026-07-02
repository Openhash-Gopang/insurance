# K-Insurance 상세 설계 v1.0
## insurance.hondi.net — AI 보험 Agent 설계 문서

---

## 1. 설계 철학

K-Insurance는 종래의 보험회사를 AI로 완전 대체한다. 설계의 핵심 원칙:

- **No 심사역**: 보험금 지급 결정은 AI가 내린다 (표준: DeepSeek V4 Pro, 고액: Claude Opus)
- **No 설계사**: 상품 안내·가입·변경·해지 전 과정 AI 자동 처리
- **No 지점**: 물리적 인프라 없음. 100% 온라인
- **No 서류**: PDV + OpenHash = 법적 증거. 별도 서류 제출 불필요
- **No 대기**: 표준 청구 목표 처리 시간 0.3초

---

## 2. AI 모델 선택 기준

| 상황 | 모델 | 이유 |
|------|------|------|
| 일반 상담·FAQ | DeepSeek V4 Pro | 비용 효율, 빠른 응답 |
| 표준 청구 심사 | DeepSeek V4 Pro | 구조화된 판단, 속도 |
| 리스크 평가 | DeepSeek V4 Pro | 수치 계산 |
| 고액 청구 (₮1M+) | Claude Opus | 심층 추론, 높은 신뢰도 |
| 배상 책임 분석 | Claude Opus + K-Law v15.1 | 법적 판단 정확도 |
| 사기 탐지 분석 | Claude Opus | 패턴 인식, 판단력 |

---

## 3. 이벤트 트리거 자동 보험 상세

### 탑승 보험 (AUTO_RIDE)
```
트리거: K-Traffic이 hondi.net에 RIDE_START 이벤트 전송
         → hondi.net이 GWP 프로토콜로 insurance.hondi.net에 전달
처리:   ins-auto.js handleAutoTrigger()
보험료: ₮0.5 기준 × 리스크 조정계수
보장:   탑승 시작~하차 완료 + 30분 여유
종료:   K-Traffic의 RIDE_END 이벤트 수신 시 자동 종료
```

### 응급 의료 보험 (AUTO_EMERGENCY)
```
트리거: K-119 출동 번호(FD-) 발급 즉시
처리:   ins-auto.js → ins_policies 생성
보장:   응급처치·입원·수술비 실손
기간:   K-119 출동 시작~응급처치 완료 + 24시간
청구:   K-Health 진료기록 연동 자동 청구
```

---

## 4. 청구 처리 상태 다이어그램

```
received
    │
    ▼
evidence_check ── 증거 불충분 ──► evidence_insufficient (거절)
    │
    ▼
fraud_check ── 사기 의심 ──► escalated ──► K-Police 연동
    │
    ▼
under_review
    ├── 표준 (DeepSeek V4 Pro, 목표 0.3초)
    └── 고액/분쟁 (Claude Opus, 에스컬레이션)
    │
    ▼
approved ──► GDC 자동 지급 ──► paid
    │
    └── rejected ──► 거절 사유 통보 + 이의 신청 안내
```

---

## 5. K-Law v15.1 연동 (배상 책임)

배상 책임 청구 시 K-Law v15.1 판결 방법론을 호출한다.

```
K-Insurance → klaw.hondi.net/api/analyze
  입력:
    - caseType: LIABILITY
    - 사고 경위 (PDV 기록)
    - 당사자 정보
    - 연동 Agent 증거 (K-Traffic·K-Security)
  
  출력:
    - faultRatio: 0.0~1.0 (피보험자 과실 비율)
    - analysis: K-Law v15.1 법적 분석 전문
    - confidence: 확신도

  적용:
    승인 보험금 = 청구 보험금 × (1 - faultRatio)
```

K-Law 분석 없이 배상 책임 결론 제시 불가 (강제규칙 6).

---

## 6. GDC 연동

모든 보험료·보험금은 GDC(₮)로 처리된다.

```
보험료 납부:
  ins-auto.js → window.opener.postMessage(GDC_DEDUCT) → hondi.net → gdc.hondi.net

보험금 지급:
  ins-claim.js payoutGdc() → window.opener.postMessage(GDC_CREDIT) → hondi.net → gdc.hondi.net
  + ins_payouts 원장 기록
  + OpenHash 앵커링
```

GDC BIVM Σδ=0 원칙에 의해 보험료 합계 = 보험금 + 운영비 + 준비금.

---

## 7. PDV 레코드 구조 (보험)

```json
{
  "svc":   "insurance",
  "type":  "policy | claim | payout",
  "who":   { "ipv6": "사용자 GUID", "role": "user", "level": "L0" },
  "when":  { "period_start": "ISO8601", "period_end": "ISO8601" },
  "where": { "svc_url": "https://insurance.hondi.net", "trigger": "K-Traffic:RIDE_START" },
  "what":  { "summary": "탑승 보험 자동 적용, ₮0.5 납부" },
  "how":   { "method": "ins-auto.js 이벤트 트리거" },
  "why":   { "goal": "이동 리스크 자동 보장" }
}
```

---

## 8. 보안 설계

### API Key 보호
- DeepSeek / Anthropic API Key는 Cloudflare Worker(ins-proxy.js)에서만 사용
- 클라이언트(브라우저)에 API Key 노출 없음

### RLS 정책
- 모든 테이블에 RLS 활성화
- 사용자는 자신의 계약·청구·지급만 조회
- 청구 결과 수정은 service_role(AI Agent)만 가능

### 사기 탐지
- 모든 청구에 5가지 패턴 자동 검사 (ins-risk.js)
- 점수 0.7 이상: K-Police 자동 연동 + 처리 중단

---

*K-Insurance 상세 설계 v1.0*
*AI City Inc. / OpenHash Network*
*2026-06-04*
