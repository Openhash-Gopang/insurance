# PDV 캡슐 API 키 스키마 & PocketBase 컬렉션 구조 v1.0
## `PDV_SANDBOX_EXECUTION_DESIGN_v1_0.md` §5·§2 구체화

---

## 1. `pdv.query()` 캡슐 API — 키 화이트리스트

원칙: **각 키는 원본 이벤트가 아니라 이미 집계된 값 하나만 반환**한다(v2.0 §2.2 "집계 우선"). 새 키를 추가하려면 이 표에 먼저 등록해야 하고, 등록되지 않은 키는 캡슐 API가 물리적으로 거부한다(§5 코드 참조).

### 1.1 자동차 보험(K-Traffic) 트랙

| 키 | 반환 타입 | 집계 방식 | 원천 서비스 | 민감도 |
|---|---|---|---|---|
| `k-traffic.night_ratio_monthly` | `float [0,1]`, 소수점 2자리 반올림 | 최근 30일 운행시간 중 23~05시 비율 | K-Traffic | 낮음 |
| `k-traffic.accident_free_months` | `int`, 상한 36 캡 | 최근 사고 이벤트 이후 경과 월수 | K-Traffic | 낮음 |
| `k-traffic.monthly_distance_km` | `int`, 100km 단위 버킷 | 최근 30일 주행거리 | K-Traffic | 낮음 |
| `k-traffic.hard_event_freq_monthly` | `enum {low, mid, high}` | 급가속·급제동 이벤트 빈도 3분위 등급화 | K-Traffic | 중간 — **미수집, 개발 필요(v2.0 §3.1 명시)** |
| `k-traffic.vehicle_usage_type` | `enum {personal, business}` | 사용자 자기신고(등록 시 1회) | K-Traffic 등록정보 | 낮음 |

### 1.2 이벤트형 건강·응급 보험 트랙 (K-Health / K-119)

| 키 | 반환 타입 | 집계 방식 | 원천 서비스 | 민감도 |
|---|---|---|---|---|
| `k-health.event_attested` | `bool` | "지정된 유형의 이벤트가 보장 기간 내 발생했는가"만 확인 — 진단명·처치내역 미포함 | K-Health | 중간(불리언 어테스테이션이라 정보량은 낮음) |
| `k-health.checkup_completed_annual` | `bool` | 연 1회 정기검진 완료 여부만 확인 | K-Health | 낮음 |
| `k-119.dispatch_attested` | `bool` | 지정 기간 내 K-119 출동 이력 존재 여부 | K-119 | 중간 |

### 1.3 명시적으로 존재하지 않는 키 (참고용 — 실수로라도 등록 금지)

아래는 v2.0 §4.3 가족력 게이트에 따라 **캡슐 API 자체에 영구적으로 등록하지 않는** 키다. 목록에 없으면 요청 자체가 불가능하다는 원칙을 재확인하는 차원에서 명시한다.

- `k-health.diagnosis_detail` (구체적 진단명)
- `k-health.family_history.*` (가족 병력 전반)
- `k-health.genetic_marker.*` (유전 마커)

### 1.4 스키마 등록 절차

새 키 추가는 `pdv_capsule_key_registry` PocketBase 컬렉션에 아래 필드로 등록하고, §3(코드 인증)과 별개로 **키 자체도 심사를 거친다** — 아무리 코드가 안전해도 키가 원본에 가까운 정보를 반환하면 소용없기 때문이다.

```
pdv_capsule_key_registry
├─ key_name         (string, unique, "k-traffic.night_ratio_monthly" 형식)
├─ return_type       (enum: float | int | bool | enum)
├─ value_constraint   (json — 예: {"min":0,"max":1,"round":2} 또는 {"bucket_width":100})
├─ source_service    (enum: k-traffic | k-health | k-119 | k-market)
├─ aggregation_desc  (text — 사람이 읽는 집계 방식 설명)
├─ sensitivity        (enum: low | mid | high)
├─ approved_by        (relation → reviewers)
├─ approved_at
└─ deprecated         (bool)
```

---

## 2. PocketBase 컬렉션 구조

### 2.1 `sandbox_certified_code` — 코드 등록부 (§2, §3)

```
sandbox_certified_code
├─ id                    (PocketBase 기본 15자 ID)
├─ code_hash              (string, unique, indexed — SHA-256, "sha256:..." 형식)
├─ repo_url               (url)
├─ commit_sha             (string)
├─ entry_point            (string — 예: "score.js:score")
├─ product_line           (enum: auto | health_event | emergency | ...)
├─ declared_input_keys    (json array — pdv_capsule_key_registry.key_name 참조 목록)
├─ declared_output_schema (json — 예: {"type":"enum","values":["A","B","C","D"]})
├─ cert_level             (enum: auto | reviewed)
├─ static_analysis_report (json — 금지 API 탐지 결과, 통과/실패 사유)
├─ reviewers              (relation, multi → users, cert_level=reviewed일 때만 필수 ≥2)
├─ registered_by          (relation → insurer_org)
├─ registered_at          (datetime)
├─ revoked                (bool, default false)
├─ revoked_reason         (text, nullable)
└─ rate_limit_override    (json, nullable — §7.2 기본값과 다르게 적용할 경우만)

인덱스: code_hash(unique), (product_line, cert_level, revoked)
접근 규칙: 공개 읽기 허용(오픈소스 투명성 원칙) / 쓰기는 심사 파이프라인 서비스 계정만
```

### 2.2 `sandbox_execution_log` — 실행 감사 로그 (§4.2, §6, §7.2, §8)

```
sandbox_execution_log
├─ id
├─ code_hash            (relation → sandbox_certified_code)
├─ user_guid            (string, indexed — PDV 소유자)
├─ scope_token_id        (string — PDV_INSURANCE_SYSTEM_DESIGN_v2_0.md §2.2의 scope_id + 기간)
├─ input_commitment      (string — 실행에 쓰인 pdv.query() 응답 전체의 해시. 원문 아님)
├─ output                (json — declared_output_schema를 만족해야 저장 가능, DB 레벨 검증)
├─ status                (enum: success | rejected_code_mismatch | rejected_scope_violation |
│                          rejected_rate_limit | error)
├─ executed_at           (datetime)
├─ signature             (string — 혼디 서버 Ed25519 서명, §6 4-필드 묶음에 대한 서명)
├─ openhash_anchor_id     (string, nullable — 앵커링 완료 후 채움)
└─ requested_by           (relation → insurer_org)

인덱스: (user_guid, code_hash, scope_token_id, executed_at) — §7.2 재실행 빈도 검사에 사용
접근 규칙: 본인(user_guid 일치) 전체 열람 가능(§8 "내 실행 이력 조회") /
           보험사는 자신이 요청한 건 중 output만 열람, input_commitment는 열람 가능하나 역산 불가(해시라서)
```

### 2.3 `pdv_capsule_key_registry` — 키 화이트리스트 (§1.4)

위 §1.4 구조 그대로. **공개 읽기 허용** — "어떤 키가 존재하고 어떤 값 범위로 제한돼 있는지" 자체가 사용자·감사자에게 투명하게 보여야 하는 정보다.

---

## 3. 실행 시점 검증 순서 (의사코드)

```js
async function handleSandboxExecute(req) {
  const { scope_token, code_hash } = req;

  // 1. 스코프 토큰 검증 (서명, 만료, 철회 여부) — v2.0 §2.2
  const scope = await verifyScopeToken(scope_token);
  if (!scope.valid) return reject('invalid_scope_token');

  // 2. 코드해시 고정 여부 확인 — 이 문서 §2 핵심 규칙
  if (scope.pinned_code_hash !== code_hash) return reject('rejected_code_mismatch');

  // 3. 코드 등록부 조회 및 폐기 여부 확인
  const codeEntry = await db.sandbox_certified_code.findOne({ code_hash });
  if (!codeEntry || codeEntry.revoked) return reject('code_not_certified');

  // 4. 재실행 빈도 확인 — §7.2
  const recentRuns = await db.sandbox_execution_log.count({
    user_guid: scope.user_guid, code_hash, scope_token_id: scope.id,
    executed_at: { $gte: scope.last_allowed_run_before },
  });
  if (recentRuns >= rateLimitFor(codeEntry.cert_level)) return reject('rejected_rate_limit');

  // 5. 캡슐 API 준비 — declared_input_keys 화이트리스트로 pdv.query() 바인딩 생성
  const capsule = buildCapsule(scope.user_guid, codeEntry.declared_input_keys);

  // 6. Workers for Platforms 디스패치 — 바인딩은 capsule 하나뿐
  const result = await dispatchSandbox(code_hash, capsule, { timeoutMs: 200, memMB: 32 });

  // 7. 출력 스키마 검증 — §7.1
  if (!matchesSchema(result.output, codeEntry.declared_output_schema))
    return reject('output_schema_violation');

  // 8. 서명 + OpenHash 앵커링 + 로그 기록 — §6
  const signed = signResult(code_hash, capsule.inputCommitment, result.output);
  const anchor = await anchorToOpenHash(signed);
  await db.sandbox_execution_log.create({ ...signed, openhash_anchor_id: anchor.id, status: 'success' });

  return signed;
}
```

---

## 4. 다음 단계

- [ ] `k-traffic.hard_event_freq_monthly`의 실제 원천 데이터(급가속·급제동 이벤트) 수집이 K-Traffic 쪽에 아직 없음 — 별도 개발 필요(v2.0 §8에서 이미 지적된 항목과 동일)
- [ ] `verifyScopeToken`, `buildCapsule`, `dispatchSandbox`의 실제 Cloudflare Workers 구현체는 별도 코드 작업으로 분리
- [ ] `pdv_capsule_key_registry`·`sandbox_certified_code`는 공개 읽기이므로, PocketBase Rules(RLS 유사 정책) 설정 시 쓰기 권한이 실수로 열리지 않았는지 별도 보안 리뷰 필요
