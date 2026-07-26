/**
 * sandbox-execute-logic.js — POST /sandbox/execute 핵심 검증 로직 v1.0
 * 설계 문서: docs/PDV_SANDBOX_EXECUTION_DESIGN_v1_0.md §3(인증레벨)·§4(격리실행)·
 *            §6(서명·앵커링)·§7(출력조악화) · docs/PDV_SANDBOX_SCHEMA_v1_0.md §3(의사코드)
 *
 * 이 파일은 순수 함수만 담는다 — 외부 인프라(KV/D1/PocketBase/Workers for
 * Platforms) 없이 로직만으로 테스트 가능하다. 실제 Cloudflare Worker 진입점은
 * sandbox-execute-worker.js에서 이 파일을 import해 사용한다(CommonJS `module.exports`와
 * Worker의 ESM `export default`를 한 파일에 섞으면 형식 충돌이 나므로 분리했다).
 */

/* ════════════════════════════════════════════════════════════
   §1~4 순서 대응 — 순수 검증 함수 (실제로 테스트됨)
   ════════════════════════════════════════════════════════════ */

/**
 * 1단계: 스코프 토큰 구조·만료·철회 여부 검증.
 * 서명 검증 자체(Ed25519 등)는 실제 배포 시 crypto 라이브러리로 대체해야 한다 —
 * 여기서는 검증에 필요한 "판단 로직"만 순수 함수로 분리했다.
 *
 * @param {object} scope — 이미 서명 검증·파싱된 스코프 토큰 페이로드
 *   { valid_signature: bool, expires_at: string(ISO), revoked: bool,
 *     pinned_code_hash: string, user_guid: string, id: string,
 *     last_allowed_run_before: string(ISO) }
 * @param {Date} now
 */
function validateScopeToken(scope, now = new Date()) {
  if (!scope) return { ok: false, reason: 'missing_scope_token' };
  if (!scope.valid_signature) return { ok: false, reason: 'invalid_signature' };
  if (scope.revoked) return { ok: false, reason: 'revoked' };
  if (new Date(scope.expires_at).getTime() <= now.getTime()) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/**
 * 2단계: 코드해시가 스코프 토큰에 고정된 값과 정확히 일치하는지 확인.
 * (PDV_SANDBOX_EXECUTION_DESIGN_v1_0.md §2 핵심 규칙 — 동의 시점의 코드와
 * 실행 시점의 코드가 반드시 같아야 한다)
 */
function checkCodeHashMatch(scope, requestedCodeHash) {
  if (!scope?.pinned_code_hash) return { ok: false, reason: 'no_pinned_hash' };
  return scope.pinned_code_hash === requestedCodeHash
    ? { ok: true }
    : { ok: false, reason: 'rejected_code_mismatch' };
}

/**
 * 3단계: 코드 등록부 조회 결과 검증 — 존재하는지, 폐기됐는지.
 * @param {object|null} codeEntry — sandbox_certified_code 조회 결과(이미 fetch된 것)
 */
function checkCodeCertified(codeEntry) {
  if (!codeEntry) return { ok: false, reason: 'code_not_certified' };
  if (codeEntry.revoked) return { ok: false, reason: 'code_revoked' };
  if (!['auto', 'reviewed'].includes(codeEntry.cert_level)) {
    return { ok: false, reason: 'unknown_cert_level' };
  }
  return { ok: true };
}

/**
 * 4단계: 인증 레벨별 재실행 빈도 상한.
 * §3 — auto는 reviewed보다 더 낮은 상한을 둔다(정적 심사만 통과했으므로 더 보수적으로).
 */
function rateLimitFor(certLevel) {
  const LIMITS = { auto: 1, reviewed: 4 }; // 재산정 주기 내 허용 실행 횟수(잠정치, 실측 후 조정)
  return LIMITS[certLevel] ?? 1; // 알 수 없는 레벨은 가장 보수적인 값
}

function checkRateLimit(recentRunsCount, certLevel) {
  const limit = rateLimitFor(certLevel);
  return recentRunsCount < limit
    ? { ok: true, limit }
    : { ok: false, reason: 'rejected_rate_limit', limit };
}

/**
 * 7단계: 출력이 선언된 스키마(등급형/버킷형만 허용)를 만족하는지 검증.
 * §7.1 — 자유형식 실수·정수·문자열은 애초에 declared_output_schema로 등록 불가하지만,
 * 실행 결과가 등록된 스키마와 실제로 일치하는지는 매 실행마다 재검증해야 한다
 * (코드가 스키마를 어기고 다른 값을 반환할 수 있으므로).
 *
 * @param {*} output — 샌드박스 실행 결과값
 * @param {{type:'enum', values:Array} | {type:'bucket', width:number, min:number, max:number}} schema
 */
function matchesOutputSchema(output, schema) {
  if (!schema) return { ok: false, reason: 'no_declared_schema' };

  if (schema.type === 'enum') {
    const val = typeof output === 'object' && output !== null && 'grade' in output ? output.grade : output;
    return Array.isArray(schema.values) && schema.values.includes(val)
      ? { ok: true }
      : { ok: false, reason: 'output_not_in_enum' };
  }

  if (schema.type === 'bucket') {
    const val = typeof output === 'object' && output !== null && 'value' in output ? output.value : output;
    if (typeof val !== 'number') return { ok: false, reason: 'output_not_numeric' };
    if (schema.min != null && val < schema.min) return { ok: false, reason: 'output_below_min' };
    if (schema.max != null && val > schema.max) return { ok: false, reason: 'output_above_max' };
    if (schema.width && val % schema.width !== 0) return { ok: false, reason: 'output_not_bucket_aligned' };
    return { ok: true };
  }

  return { ok: false, reason: 'unsupported_schema_type' }; // 자유형식 실수·문자열 스키마는 애초에 미지원(§7.1)
}

/**
 * 5단계 보조: declared_input_keys 화이트리스트로 캡슐 API가 응답할 수 있는
 * 키 집합을 제한한다. 실제 pdv.query() 구현체(Workers for Platforms 바인딩)는
 * 배포 환경에서 별도로 준비해야 하지만, "이 키가 허용되는가"라는 판단 로직은
 * 여기서 순수 함수로 분리해 테스트 가능하게 한다.
 */
function isKeyAllowed(key, declaredInputKeys) {
  return Array.isArray(declaredInputKeys) && declaredInputKeys.includes(key);
}

/**
 * §6 결과 서명 페이로드 조립. 실제 서명(Ed25519 등)은 배포 환경의 crypto로
 * 대체해야 하며, 여기서는 "무엇을 서명 대상에 포함하는가"라는 스펙만 고정한다.
 */
function buildSignaturePayload(codeHash, inputCommitment, output, executedAt) {
  return {
    code_hash: codeHash,
    input_commitment: inputCommitment, // 입력값 원문이 아니라 해시(§6)
    output,
    executed_at: executedAt,
  };
}

/* ════════════════════════════════════════════════════════════
   전체 검증 파이프라인 — 8단계 중 인프라 호출 없이 판단 가능한
   1·2·3·4·7단계를 순서대로 실행하는 조립 함수(순수 함수, 테스트 대상)
   ════════════════════════════════════════════════════════════ */

/**
 * @param {object} ctx
 *   - scope: 1단계 입력(validateScopeToken 형식)
 *   - requestedCodeHash: 2단계 입력
 *   - codeEntry: 3단계 입력
 *   - recentRunsCount: 4단계 입력
 *   - output, declaredOutputSchema: 7단계 입력(6단계 실행 이후에 검증되므로
 *     실무에서는 5·6단계 실행 뒤 이 값이 채워진다 — 이 함수는 편의상 한 번에
 *     받지만, handleSandboxExecute()에서는 실제로 순서대로 호출한다)
 * @param {Date} now
 */
function runPreExecutionChecks(ctx, now = new Date()) {
  const step1 = validateScopeToken(ctx.scope, now);
  if (!step1.ok) return { ok: false, step: 1, ...step1 };

  const step2 = checkCodeHashMatch(ctx.scope, ctx.requestedCodeHash);
  if (!step2.ok) return { ok: false, step: 2, ...step2 };

  const step3 = checkCodeCertified(ctx.codeEntry);
  if (!step3.ok) return { ok: false, step: 3, ...step3 };

  const step4 = checkRateLimit(ctx.recentRunsCount, ctx.codeEntry.cert_level);
  if (!step4.ok) return { ok: false, step: 4, ...step4 };

  return { ok: true };
}


/* ════════════════════════════════════════════════════════════
   내보내기
   ════════════════════════════════════════════════════════════ */
const SandboxExecuteLogic = {
  validateScopeToken, checkCodeHashMatch, checkCodeCertified,
  rateLimitFor, checkRateLimit, matchesOutputSchema, isKeyAllowed,
  buildSignaturePayload, runPreExecutionChecks,
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SandboxExecuteLogic;
}
if (typeof window !== 'undefined') {
  window.SandboxExecuteLogic = SandboxExecuteLogic;
}
