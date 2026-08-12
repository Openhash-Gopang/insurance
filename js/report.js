// ═══════════════════════════════════════════════════════════
// K-Insurance report.js  v1.0
// PDV 조회 → DeepSeek V4 Pro 보험료 산출 → PDV 기록 파이프라인
//
// 배포 위치: insurance.hondi.net/js/report.js
// 의존성:
//   - gopang-proxy (hondi-proxy.tensor-city.workers.dev)
//   - subsystem-auth.js (user.ipv6, user.level, user.exp)
//   - Supabase (ebbecjfrwaswbdybbgiu.supabase.co)
//
// 참조 문서:
//   - PDV_QUERY_PROTOCOL_v1_0.md  : /pdv/query 프로토콜
//   - gopang_pdv_rules.md         : /pdv/report 프로토콜
//   - SP-KINSURANCE-v1_0.txt      : 보험료 산출 시스템 프롬프트
// ═══════════════════════════════════════════════════════════

const PROXY    = 'https://hondi-proxy.tensor-city.workers.dev';
const SVC_ID   = 'kinsurance';
const SVC_URL  = 'https://insurance.hondi.net';
const SUPA_URL = '' /* -2026-08-12 secret removed, see README_SECRETS_INCIDENT.md */;
const SUPA_KEY = '' /* -2026-08-12 secret removed, rotate + migrate to PocketBase, see README_SECRETS_INCIDENT.md */;
const HDR      = { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY,
                   'Content-Type': 'application/json' };

// 기본 조회 scope (보험료 산출에 필요한 최소 집합)
const DEFAULT_SCOPE = ['ktraffic', 'khealth', 'pdv_general'];

// ── 시스템 프롬프트 캐시 ────────────────────────────────────
let _cachedSystemPrompt = null;

async function loadSystemPrompt() {
  if (_cachedSystemPrompt) return _cachedSystemPrompt;
  try {
    const res = await fetch('/prompts/SP-KINSURANCE-v1_0.txt');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    // # 주석 제거
    _cachedSystemPrompt = raw
      .split('\n')
      .filter(line => !line.trimStart().startsWith('#'))
      .join('\n')
      .trim();
  } catch (e) {
    console.warn('[INS] 시스템 프롬프트 로드 실패, 인라인 폴백 사용:', e.message);
    _cachedSystemPrompt = _inlineSystemPrompt();
  }
  return _cachedSystemPrompt;
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════

/**
 * calcMonthlyPremium(user)
 * 이번 달 보험료를 산출하는 메인 파이프라인.
 *
 * 단계A(동의 요청) → 사용자 동의 대기 → 단계B(PDV 조회)
 * → DeepSeek 보험료 산출 → PDV 기록 → Supabase 저장
 *
 * @param {object} user   subsystem-auth.js의 _onGopangAuth user 객체
 * @param {object} [opts] { scope, onConsentRequired, onProgress }
 * @returns {Promise<object>} 보험료 산출 결과 JSON
 */
async function calcMonthlyPremium(user, opts = {}) {
  if (!user?.ipv6) throw new Error('인증된 사용자 정보가 없습니다');

  const period = _currentMonthPeriod();
  const scope  = opts.scope || DEFAULT_SCOPE;

  // ── 단계A: 동의 요청 ────────────────────────────────────
  opts.onProgress?.('PDV 조회 동의 요청 중…');
  const consentInfo = await requestPdvConsent(user, period, scope);

  // 동의 대기: 콜백으로 UI에 팝업 표시 위임
  opts.onProgress?.('고팡 앱에서 동의를 확인해 주세요…');
  const { consentToken, requestId } = await waitForConsent(consentInfo, opts.onConsentRequired);

  // ── 단계B: PDV 조회 ──────────────────────────────────────
  opts.onProgress?.('PDV 데이터 분석 중…');
  const pdvResult = await fetchPdvSummary(user, period, scope, consentToken, requestId);

  // ── DeepSeek V4 Pro 보험료 산출 ──────────────────────────
  opts.onProgress?.('AI 보험료 산출 중…');
  const calcResult = await calcPremiumWithAI(user, pdvResult);

  // ── PDV에 산출 결과 기록 ──────────────────────────────────
  opts.onProgress?.('PDV에 산출 결과 기록 중…');
  const pdvAck = await sendPdvReport(user, period, calcResult);

  // ── Supabase에 원본 저장 ──────────────────────────────────
  if (pdvAck?.pdv_entry) {
    await saveCalcResult(user, period, calcResult, pdvAck.pdv_entry);
  }

  return { ...calcResult, pdv_entry: pdvAck?.pdv_entry };
}

/**
 * getLatestPremium(user)
 * Supabase에 저장된 가장 최근 산출 결과를 반환.
 */
async function getLatestPremium(user) {
  if (!user?.ipv6) return null;
  try {
    const res = await fetch(
      SUPA_URL + `/rest/v1/insurance_calc_results`
      + `?user_guid=eq.${encodeURIComponent(user.ipv6)}`
      + `&order=calc_at.desc&limit=1&select=*`,
      { headers: HDR }
    );
    const rows = await res.json().catch(() => []);
    return rows?.[0] || null;
  } catch (e) {
    console.warn('[INS] 최근 산출 결과 조회 실패:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// STEP 1 — 동의 요청
// ═══════════════════════════════════════════════════════════

async function requestPdvConsent(user, period, scope) {
  const res = await fetch(`${PROXY}/pdv/query`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        svc:        SVC_ID,
        ipv6:       user.ipv6,
        purpose:    '월별 보험료 자동 산출을 위한 위험도 분석',
        scope,
        period,
        auth_token: { level: user.level, exp: user.exp },
      },
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 202 && data.status === 'CONSENT_REQUIRED') {
    return data.consent;  // { request_id, expires_at, consent_url }
  }

  // 이미 유효한 세션 토큰이 있어 202 없이 바로 200이 반환된 경우 (미래 대비)
  if (res.ok && data.ok) {
    return { _immediate: true, data };
  }

  throw new Error(`동의 요청 실패 (${res.status}): ${data.detail || data.error || '알 수 없는 오류'}`);
}

// ═══════════════════════════════════════════════════════════
// STEP 2 — 동의 대기 (postMessage 수신)
// ═══════════════════════════════════════════════════════════

/**
 * 고팡 앱 팝업에서 동의 완료 후 postMessage로 consent_token을 수신한다.
 * 타임아웃: 동의 요청 TTL(300초) 기준
 */
async function waitForConsent(consentInfo, onConsentRequired) {
  // _immediate: 동의 없이 즉시 데이터가 반환된 경우 (캐시된 동의)
  if (consentInfo?._immediate) {
    return { consentToken: '__immediate__', requestId: '__immediate__',
             _immediateData: consentInfo.data };
  }

  return new Promise((resolve, reject) => {
    const expiresAt = consentInfo.expires_at * 1000;
    const timeLeft  = expiresAt - Date.now();
    if (timeLeft <= 0) return reject(new Error('동의 요청이 만료되었습니다'));

    // 팝업 열기 (기본 동작) 또는 콜백으로 UI 위임
    let popup = null;
    if (typeof onConsentRequired === 'function') {
      onConsentRequired(consentInfo.consent_url, consentInfo.request_id);
    } else {
      popup = window.open(
        consentInfo.consent_url,
        'gopang_consent',
        'width=480,height=600,menubar=no,toolbar=no,scrollbars=yes'
      );
    }

    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMsg);
      if (popup && !popup.closed) popup.close();
      reject(new Error('동의 시간이 초과되었습니다 (300초)'));
    }, Math.min(timeLeft, 300_000));

    function onMsg(e) {
      if (e.origin !== 'https://hondi.net') return;
      if (e.data?.type !== 'GOPANG_CONSENT_RESULT') return;
      clearTimeout(timeout);
      window.removeEventListener('message', onMsg);
      if (popup && !popup.closed) popup.close();

      if (e.data.ok && e.data.consent_token) {
        resolve({
          consentToken: e.data.consent_token,
          requestId:    e.data.request_id || consentInfo.request_id,
        });
      } else {
        reject(new Error('사용자가 PDV 조회를 거부했습니다'));
      }
    }

    window.addEventListener('message', onMsg);
  });
}

// ═══════════════════════════════════════════════════════════
// STEP 3 — PDV 조회 (단계B)
// ═══════════════════════════════════════════════════════════

async function fetchPdvSummary(user, period, scope, consentToken, requestId) {
  // _immediate: 이미 데이터가 있는 경우
  if (consentToken === '__immediate__') {
    return { period, pdv_summary: {} };
  }

  const res = await fetch(`${PROXY}/pdv/query`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        svc:           SVC_ID,
        ipv6:          user.ipv6,
        purpose:       '월별 보험료 자동 산출을 위한 위험도 분석',
        scope,
        period,
        auth_token:    { level: user.level, exp: user.exp },
        consent_token: consentToken,
        request_id:    requestId,
      },
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    throw new Error(`PDV 조회 실패 (${res.status}): ${data.detail || data.error || '알 수 없는 오류'}`);
  }

  return data;  // { ok, query_id, ipv6, period, pdv_summary, consent }
}

// ═══════════════════════════════════════════════════════════
// STEP 4 — DeepSeek V4 Pro 보험료 산출
// ═══════════════════════════════════════════════════════════

async function calcPremiumWithAI(user, pdvResult) {
  const systemPrompt = await loadSystemPrompt();

  const userMessage = JSON.stringify({
    ipv6:   user.ipv6,
    period: pdvResult.period,
    pdv:    pdvResult.pdv_summary || {},
  });

  const res = await fetch(`${PROXY}/deepseek`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       'deepseek-v4-pro',
      max_tokens:  1500,
      temperature: 0.2,   // 보험료 산출은 재현성 중시
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
    }),
  });

  if (!res.ok) throw new Error(`AI 호출 실패: HTTP ${res.status}`);

  const aiData = await res.json().catch(() => ({}));
  const rawText = aiData.choices?.[0]?.message?.content || aiData.content?.[0]?.text || '';

  // JSON 파싱 (마크다운 코드블록 방어)
  let calcResult;
  try {
    const clean = rawText.replace(/```json|```/g, '').trim();
    calcResult  = JSON.parse(clean);
  } catch (e) {
    console.error('[INS] AI 응답 파싱 실패:', rawText);
    throw new Error('보험료 산출 결과를 파싱할 수 없습니다: ' + e.message);
  }

  // calc_id가 없으면 생성
  if (!calcResult.calc_id) {
    calcResult.calc_id = `INS-${user.ipv6.replace(/:/g,'').slice(0,8)}-${Date.now()}`;
  }
  calcResult.calc_at = calcResult.calc_at || new Date().toISOString();

  return calcResult;
}

// ═══════════════════════════════════════════════════════════
// STEP 5 — PDV에 산출 결과 기록 (/pdv/report)
// ═══════════════════════════════════════════════════════════

async function sendPdvReport(user, period, calcResult) {
  const monthly = calcResult.monthly_total ?? 0;
  const risk    = calcResult.summary?.risk_profile ?? 'unknown';

  try {
    const res = await fetch(`${PROXY}/pdv/report`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report: {
          svc:          SVC_ID,
          type:         'insurance_premium_calc',
          id:           calcResult.calc_id,
          content_hash: await _sha256(JSON.stringify(calcResult)),
          who: {
            ipv6:       user.ipv6,
            role:       'user',
            recipients: ['gopang-pdv'],
          },
          when: {
            period_start: period.start,
            period_end:   period.end,
          },
          where: { svc_url: SVC_URL },
          what: {
            summary: `보험료 산출 완료: 월 ₮${monthly.toLocaleString()} · 위험등급 ${risk}`,
            monthly_total: monthly,
            risk_profile:  risk,
            policy_count:  calcResult.policies?.length ?? 0,
          },
          how:  { method: 'AI 자동 산출 (DeepSeek V4 Pro)', model: 'deepseek-v4-pro' },
          why:  { goal: '월별 맞춤 보험료 산출', triggered: 'monthly_calc' },
          analysis: { risk_level: _riskToLevel(risk) },
        },
      }),
    });

    const ack = await res.json().catch(() => ({}));
    if (!res.ok) console.warn('[INS] PDV 기록 실패:', ack.error);
    return ack;  // { ok, pdv_entry, report_id, recorded_at }
  } catch (e) {
    console.warn('[INS] PDV 기록 예외:', e.message);
    return null;  // PDV 실패해도 산출 결과는 반환
  }
}

// ═══════════════════════════════════════════════════════════
// STEP 6 — Supabase에 원본 저장 (insurance_calc_results)
// ═══════════════════════════════════════════════════════════

async function saveCalcResult(user, period, calcResult, pdvEntryId) {
  try {
    const res = await fetch(SUPA_URL + '/rest/v1/insurance_calc_results', {
      method:  'POST',
      headers: { ...HDR, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        calc_id:       calcResult.calc_id,
        user_guid:     user.ipv6,
        period_start:  period.start,
        period_end:    period.end,
        monthly_total: calcResult.monthly_total,
        risk_profile:  calcResult.summary?.risk_profile,
        calc_data:     calcResult,         // 원본 전체 (jsonb)
        pdv_entry_id:  pdvEntryId,
        model:         calcResult.model || 'deepseek-v4-pro',
        calc_at:       calcResult.calc_at || new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[INS] Supabase 저장 실패:', res.status, errText);
    }
  } catch (e) {
    console.warn('[INS] Supabase 저장 예외:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// 스케줄러 — 매월 1일 자동 산출
// ═══════════════════════════════════════════════════════════

/**
 * initPremiumScheduler(user, opts)
 * 페이지 로드 시 호출. 이번 달 산출 결과가 없으면 자동 실행.
 */
async function initPremiumScheduler(user, opts = {}) {
  if (!user?.ipv6) return;

  try {
    // 이번 달 기존 결과 확인
    const period = _currentMonthPeriod();
    const res = await fetch(
      SUPA_URL + `/rest/v1/insurance_calc_results`
      + `?user_guid=eq.${encodeURIComponent(user.ipv6)}`
      + `&period_start=eq.${period.start}`
      + `&select=calc_id,monthly_total,risk_profile`,
      { headers: HDR }
    );
    const rows = await res.json().catch(() => []);

    if (rows?.length > 0) {
      // 이미 이번 달 결과 있음
      console.info('[INS] 이번 달 보험료 기산출:', rows[0].monthly_total);
      opts.onAlreadyCalced?.(rows[0]);
      return rows[0];
    }

    // 없으면 산출 실행
    console.info('[INS] 이번 달 보험료 미산출 — 자동 시작');
    return await calcMonthlyPremium(user, opts);

  } catch (e) {
    console.warn('[INS] 스케줄러 초기화 실패:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 내부 유틸
// ═══════════════════════════════════════════════════════════

function _currentMonthPeriod() {
  const now   = new Date();
  const y     = now.getFullYear();
  const m     = String(now.getMonth() + 1).padStart(2, '0');
  const last  = new Date(y, now.getMonth() + 1, 0).getDate();
  return {
    start: `${y}-${m}-01`,
    end:   `${y}-${m}-${String(last).padStart(2, '0')}`,
  };
}

function _riskToLevel(riskProfile) {
  const map = { low: 'low', medium: 'medium', high: 'high' };
  return map[riskProfile] || 'low';
}

async function _sha256(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  } catch { return null; }
}

// ── 시스템 프롬프트 로드 실패 시 최소 인라인 폴백 ───────────
function _inlineSystemPrompt() {
  return `너는 K-Insurance AI 보험료 산출 에이전트다.
사용자의 PDV 요약 데이터를 분석하여 위험 종류별 보험료를 산출하고 JSON으로만 출력한다.
JSON 외 어떠한 텍스트도 출력하지 않는다.
출력 형식: { calc_id, ipv6, period, calc_at, model, monthly_total,
             auto_total_per_event, policies: [...], summary: {...}, escalation: {...} }
각 policy: { code, name, base_premium, risk_coefficient, final_premium,
             billing, risk_level, factors, note, data_source }
모든 보험료 단위는 GDC(₮). final_premium = base_premium × risk_coefficient.`;
}

// ═══════════════════════════════════════════════════════════
// Supabase 스키마 참고 (실제 생성은 Supabase 대시보드에서)
// ═══════════════════════════════════════════════════════════
/*
CREATE TABLE public.insurance_calc_results (
  id            bigserial PRIMARY KEY,
  calc_id       text NOT NULL UNIQUE,            -- INS-{guid8}-{timestamp}
  user_guid     text NOT NULL REFERENCES public.users(guid),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  monthly_total numeric(10,2) NOT NULL DEFAULT 0,
  risk_profile  text,                            -- low / medium / high
  calc_data     jsonb NOT NULL DEFAULT '{}',     -- 원본 AI 산출 결과 전체
  pdv_entry_id  text,                            -- pdv_log.id 참조
  model         text DEFAULT 'deepseek-v4-pro',
  calc_at       timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.insurance_calc_results (user_guid, calc_at DESC);
CREATE INDEX ON public.insurance_calc_results (user_guid, period_start);
*/
