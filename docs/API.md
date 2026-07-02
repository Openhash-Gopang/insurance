# K-Insurance API 명세 v1.0
## insurance.hondi.net REST API

Base URL: `https://insurance.hondi.net/api`  
인증: hondi.net SSO (subsystem-auth.js) — `user.ipv6` JWT

---

## 계약 API

### GET /api/policies
내 보험 계약 목록 조회

**Response**
```json
{
  "policies": [
    {
      "policy_no": "INS-20260604-1234",
      "product_name": "탑승 보험",
      "status": "active",
      "premium_gdc": 0.5,
      "coverage_gdc": 50000,
      "start_at": "2026-06-04T10:00:00Z"
    }
  ]
}
```

### POST /api/policies
신규 보험 가입

**Request**
```json
{
  "product_code": "HEALTH_ACTUAL",
  "options": {}
}
```

**Response**
```json
{
  "policy_no": "INS-20260604-1235",
  "premium_gdc": 3150,
  "coverage_gdc": 200000,
  "risk_grade": "A",
  "breakdown": {
    "기준 보험료": 3000,
    "리스크 등급 조정": 0.9,
    "나이 조정": 1.0,
    "사고 이력 조정": 1.0,
    "최종 보험료(월)": 3150
  }
}
```

### DELETE /api/policies/:policy_no
보험 해지

---

## 청구 API

### POST /api/claims
보험금 청구 접수

**Request**
```json
{
  "policy_no": "INS-20260604-1234",
  "claim_type": "ACCIDENT",
  "claim_amount": 50000,
  "incident_at": "2026-06-04T09:00:00Z",
  "evidence": {
    "pdv_record": { ... },
    "openhash_ref": "0x...",
    "agent_data": { "k119_dispatch_no": "FD-20260604-0001" }
  }
}
```

**Response**
```json
{
  "claim_no": "CLM-20260604-0001",
  "status": "received",
  "header": "[K-Insurance v1.0 | 사건번호: CLM-20260604-0001 | 처리단계: 1/6]",
  "estimated_time": "0.3초 (표준) 또는 24시간 (고액)"
}
```

### GET /api/claims
내 청구 이력 조회

### GET /api/claims/:claim_no
특정 청구 상태 조회

---

## 상품 API

### GET /api/products
전체 상품 카탈로그

### GET /api/products/:product_code
특정 상품 상세 + 예상 보험료

---

## 이벤트 트리거 API (Agent 전용)

### POST /api/events/trigger
타 Agent에서 자동 보험 트리거

**Request** (K-Traffic 탑승 이벤트 예시)
```json
{
  "agent": "K-Traffic",
  "event": "RIDE_START",
  "user": { "ipv6": "2601:...", "level": "L0" },
  "context": { "estimatedMinutes": 30 }
}
```

**Response**
```json
{
  "policy_no": "INS-20260604-1236",
  "premium_gdc": 0.5,
  "coverage_gdc": 50000,
  "message": "탑승 보험 자동 적용 완료"
}
```

---

*K-Insurance API v1.0 | AI City Inc.*
