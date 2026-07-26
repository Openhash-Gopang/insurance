const {
  validateScopeToken, checkCodeHashMatch, checkCodeCertified,
  rateLimitFor, checkRateLimit, matchesOutputSchema, isKeyAllowed,
  buildSignaturePayload, runPreExecutionChecks,
} = require('../sandbox-execute-logic.js');

let failures = 0;
function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error(`FAIL: ${label}\n  actual:   ${a}\n  expected: ${e}`); failures++; }
  else console.log(`OK: ${label}`);
}
function assertTrue(cond, label) {
  if (!cond) { console.error(`FAIL: ${label}`); failures++; }
  else console.log(`OK: ${label}`);
}

const NOW = new Date('2026-07-26T00:00:00Z');

/* ── 1단계: validateScopeToken ── */
const validScope = {
  valid_signature: true, revoked: false,
  expires_at: '2026-08-01T00:00:00Z',
  pinned_code_hash: 'sha256:abc123', user_guid: 'u1', id: 'scope-1',
  last_allowed_run_before: '2026-07-01T00:00:00Z',
};
assertEq(validateScopeToken(validScope, NOW), { ok: true }, '유효한 스코프 토큰 → 통과');
assertEq(validateScopeToken(null, NOW).reason, 'missing_scope_token', '토큰 없음 → missing_scope_token');
assertEq(validateScopeToken({ ...validScope, valid_signature: false }, NOW).reason, 'invalid_signature', '서명 무효 → invalid_signature');
assertEq(validateScopeToken({ ...validScope, revoked: true }, NOW).reason, 'revoked', '철회됨 → revoked');
assertEq(validateScopeToken({ ...validScope, expires_at: '2026-07-01T00:00:00Z' }, NOW).reason, 'expired', '만료됨 → expired');

/* ── 2단계: checkCodeHashMatch ── */
assertEq(checkCodeHashMatch(validScope, 'sha256:abc123'), { ok: true }, '코드해시 일치 → 통과');
assertEq(checkCodeHashMatch(validScope, 'sha256:different').reason, 'rejected_code_mismatch', '코드해시 불일치 → rejected_code_mismatch');

/* ── 3단계: checkCodeCertified ── */
const certifiedAuto = { cert_level: 'auto', revoked: false };
const certifiedReviewed = { cert_level: 'reviewed', revoked: false };
assertEq(checkCodeCertified(certifiedAuto), { ok: true }, 'auto 인증 코드 → 통과');
assertEq(checkCodeCertified(null).reason, 'code_not_certified', '등록부에 없음 → code_not_certified');
assertEq(checkCodeCertified({ cert_level: 'auto', revoked: true }).reason, 'code_revoked', '폐기된 코드 → code_revoked');

/* ── 4단계: rateLimitFor / checkRateLimit — auto가 reviewed보다 보수적인지 확인 ── */
assertTrue(rateLimitFor('auto') < rateLimitFor('reviewed'), 'auto 레벨이 reviewed보다 낮은 재실행 한도를 가짐');
assertEq(checkRateLimit(0, 'auto'), { ok: true, limit: rateLimitFor('auto') }, 'auto: 0회 실행 후 → 통과');
assertEq(checkRateLimit(rateLimitFor('auto'), 'auto').reason, 'rejected_rate_limit', 'auto: 한도 도달 → rejected_rate_limit');
assertEq(checkRateLimit(2, 'reviewed'), { ok: true, limit: rateLimitFor('reviewed') }, 'reviewed: auto라면 막혔을 2회도 reviewed는 통과');

/* ── 7단계: matchesOutputSchema — 등급형/버킷형만 허용, 자유형식 거부 ── */
assertEq(matchesOutputSchema({ grade: 'B' }, { type: 'enum', values: ['A', 'B', 'C', 'D'] }), { ok: true }, '등급형 스키마 내 값 → 통과');
assertEq(matchesOutputSchema({ grade: 'X' }, { type: 'enum', values: ['A', 'B', 'C', 'D'] }).reason, 'output_not_in_enum', '등급형 스키마 밖 값 → output_not_in_enum');
assertEq(matchesOutputSchema({ value: 25 }, { type: 'bucket', width: 5, min: 0, max: 100 }), { ok: true }, '버킷형(5의 배수) → 통과');
assertEq(matchesOutputSchema({ value: 23 }, { type: 'bucket', width: 5, min: 0, max: 100 }).reason, 'output_not_bucket_aligned', '버킷 단위 안 맞음 → output_not_bucket_aligned');
assertEq(matchesOutputSchema(3.14159, { type: 'free_float' }).reason, 'unsupported_schema_type', '자유형식 실수 스키마 자체가 거부됨(§7.1 원칙)');
assertEq(matchesOutputSchema('아무 문자열', { type: 'free_string' }).reason, 'unsupported_schema_type', '자유형식 문자열 스키마도 거부됨');

/* ── isKeyAllowed — 화이트리스트 밖 키 차단 ── */
const declaredKeys = ['k-market.buyer.receipt_status_reported', 'k-market.seller.fulfillment_status_reported'];
assertTrue(isKeyAllowed('k-market.buyer.receipt_status_reported', declaredKeys), '화이트리스트 안 키 → 허용');
assertTrue(!isKeyAllowed('k-market.buyer.raw_gps_log', declaredKeys), '화이트리스트 밖 키(원시 데이터 시도) → 차단');

/* ── buildSignaturePayload — 입력 원문이 아니라 커밋먼트(해시)만 포함되는지 확인 ── */
const payload = buildSignaturePayload('sha256:codehash', 'sha256:inputcommitment', { grade: 'B' }, '2026-07-26T00:00:00Z');
assertEq(payload.input_commitment, 'sha256:inputcommitment', '서명 페이로드에 입력값 해시(커밋먼트)만 포함');
assertTrue(!('raw_input' in payload) && !('pdv_data' in payload), '서명 페이로드에 원본 PDV 데이터 필드 자체가 없음');

/* ── 통합: runPreExecutionChecks — 8단계 파이프라인 중 1~4단계를 순서대로 검증 ── */
const okCtx = { scope: validScope, requestedCodeHash: 'sha256:abc123', codeEntry: certifiedAuto, recentRunsCount: 0 };
assertEq(runPreExecutionChecks(okCtx, NOW), { ok: true }, '전 조건 충족 → 통과');

const badHashCtx = { ...okCtx, requestedCodeHash: 'sha256:wrong' };
const r1 = runPreExecutionChecks(badHashCtx, NOW);
assertEq(r1.step, 2, '코드해시 불일치는 2단계에서 걸러짐');

const revokedCtx = { ...okCtx, scope: { ...validScope, revoked: true } };
const r2 = runPreExecutionChecks(revokedCtx, NOW);
assertEq(r2.step, 1, '철회된 스코프는 1단계에서 걸러짐(2단계까지 가지 않음)');

const rateLimitCtx = { ...okCtx, recentRunsCount: rateLimitFor('auto') };
const r3 = runPreExecutionChecks(rateLimitCtx, NOW);
assertEq(r3.step, 4, '재실행 한도 초과는 4단계에서 걸러짐');

console.log(failures === 0 ? '\n✅ 전체 통과' : `\n❌ ${failures}건 실패`);
process.exit(failures === 0 ? 0 : 1);
