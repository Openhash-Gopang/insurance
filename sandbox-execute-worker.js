/**
 * sandbox-execute-worker.js — POST /sandbox/execute Cloudflare Worker 진입점 v1.0
 * 설계 문서: docs/PDV_SANDBOX_EXECUTION_DESIGN_v1_0.md · docs/PDV_SANDBOX_SCHEMA_v1_0.md §3
 *
 * 검증 로직(1·2·3·4·7단계)은 sandbox-execute-logic.js의 순수 함수를 그대로
 * 가져와 쓴다(중복 구현하지 않는다 — health/school/market 저장소에서 이미 쓴
 * "재사용 원칙"을 여기서도 지킨다). 이 파일은 그 로직을 실제 Cloudflare
 * 바인딩(KV/D1/PocketBase/Workers for Platforms)과 연결하는 조립부다.
 *
 * ⚠️ 배포 전 필수: 아래 _todo* 함수들은 전부 미구현 상태로 두면 즉시 에러를
 * 던지도록 만들어뒀다 — 실수로 스텁 상태 그대로 배포되는 것을 막기 위해서다.
 * 실제 배포 시 각 함수를 실제 인프라 호출로 교체해야 한다.
 */
import {
  runPreExecutionChecks,
  matchesOutputSchema,
  buildSignaturePayload,
  isKeyAllowed,
} from './sandbox-execute-logic.js';

/* ════════════════════════════════════════════════════════════
   실제 Cloudflare Worker 핸들러 — 라이브 바인딩 필요(TODO 표시)
   ════════════════════════════════════════════════════════════ */

/**
 * @param {Request} request
 * @param {object} env — Cloudflare 바인딩
 *   - env.SCOPE_KV: 스코프 토큰 조회/서명 검증용 KV 또는 D1
 *   - env.SANDBOX_DB: sandbox_certified_code · sandbox_execution_log (PocketBase 또는 D1)
 *   - env.SANDBOX_DISPATCHER: Workers for Platforms 디스패치 네임스페이스 바인딩
 *   - env.SIGNING_KEY: 결과 서명용 Ed25519 개인키
 */
export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400 });
    }

    const { scope_token, code_hash } = body;
    if (!scope_token || !code_hash) {
      return new Response(JSON.stringify({ error: 'missing_required_fields' }), { status: 400 });
    }

    // TODO(배포 시 구현): scope_token 서명 검증 + 파싱.
    // 예: const scope = await verifyAndParseScopeToken(scope_token, env.SCOPE_KV);
    const scope = await _todoVerifyScopeToken(scope_token, env);

    // TODO(배포 시 구현): sandbox_certified_code 조회.
    // 예: const codeEntry = await env.SANDBOX_DB.findCertifiedCode(code_hash);
    const codeEntry = await _todoFindCertifiedCode(code_hash, env);

    // TODO(배포 시 구현): sandbox_execution_log에서 최근 실행 횟수 카운트.
    const recentRunsCount = await _todoCountRecentRuns(scope, code_hash, env);

    // 1~4단계 — 순수 함수로 판단(인프라 호출 결과만 주입)
    const preCheck = runPreExecutionChecks({ scope, requestedCodeHash: code_hash, codeEntry, recentRunsCount });
    if (!preCheck.ok) {
      return new Response(JSON.stringify({ error: preCheck.reason, step: preCheck.step }), { status: 403 });
    }

    // 5단계 — 캡슐 API 준비. declared_input_keys 화이트리스트로 pdv.query()
    // 바인딩을 만든다. isKeyAllowed()가 그 필터링 판단을 맡는다.
    // TODO(배포 시 구현): 실제 PDV 조회는 별도 내부 서비스를 통해서만 이루어져야
    // 하며, 이 Worker가 PDV 원장에 직접 접근하면 안 된다(신뢰 경계 원칙).
    const capsule = await _todoBuildCapsule(scope.user_guid, codeEntry.declared_input_keys, env, isKeyAllowed);

    // 6단계 — Workers for Platforms 디스패치
    // TODO(배포 시 구현): env.SANDBOX_DISPATCHER.get(code_hash).fetch(...)
    const dispatchResult = await _todoDispatchSandbox(code_hash, capsule, env);

    // 7단계 — 출력 스키마 검증(순수 함수)
    const schemaCheck = matchesOutputSchema(dispatchResult.output, codeEntry.declared_output_schema);
    if (!schemaCheck.ok) {
      return new Response(JSON.stringify({ error: schemaCheck.reason, step: 7 }), { status: 502 });
    }

    // 8단계 — 서명 + OpenHash 앵커링 + 로그 기록
    const executedAt = new Date().toISOString();
    const payload = buildSignaturePayload(code_hash, capsule.inputCommitment, dispatchResult.output, executedAt);
    // TODO(배포 시 구현): 실제 서명 및 OpenHash 앵커링
    const signed = await _todoSignAndAnchor(payload, env);
    await _todoLogExecution({ ...signed, status: 'success' }, env);

    return new Response(JSON.stringify(signed), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
};

/* ════════════════════════════════════════════════════════════
   TODO 스텁 — 실제 배포 시 반드시 교체해야 하는 인프라 호출부.
   지금은 명시적으로 미구현 에러를 던져서, 실수로 스텁 상태 그대로
   배포되는 것을 방지한다.
   ════════════════════════════════════════════════════════════ */
async function _todoVerifyScopeToken() { throw new Error('NOT_IMPLEMENTED: scope_token 서명 검증 로직을 연결하세요'); }
async function _todoFindCertifiedCode() { throw new Error('NOT_IMPLEMENTED: sandbox_certified_code 조회를 연결하세요'); }
async function _todoCountRecentRuns() { throw new Error('NOT_IMPLEMENTED: sandbox_execution_log 조회를 연결하세요'); }
async function _todoBuildCapsule() { throw new Error('NOT_IMPLEMENTED: PDV 캡슐 API 바인딩을 연결하세요'); }
async function _todoDispatchSandbox() { throw new Error('NOT_IMPLEMENTED: Workers for Platforms 디스패치를 연결하세요'); }
async function _todoSignAndAnchor() { throw new Error('NOT_IMPLEMENTED: 서명·OpenHash 앵커링을 연결하세요'); }
async function _todoLogExecution() { throw new Error('NOT_IMPLEMENTED: 실행 로그 기록을 연결하세요'); }
