/**
 * ins-auto.js — K-Insurance 자동 보험 트리거 엔진 v1.0
 * 이벤트 트리거 자동 보험 적용 (탑승·배달·응급·거래)
 * GWP 프로토콜 연동 (gopang.net ↔ Agent 통신)
 */

import { createPolicy, generatePolicyNo } from './ins-core.js';
import { calcAutoPremium } from './ins-premium.js';

// ──────────────────────────────────────────
// 트리거 테이블
// ──────────────────────────────────────────
const AUTO_TRIGGER_MAP = {
  'K-Traffic:RIDE_START':       { productCode: 'AUTO_RIDE',     basePremium: 0.5,  maxCoverage: 50000  },
  'K-Traffic:CARPOOL_START':    { productCode: 'AUTO_RIDE',     basePremium: 0.3,  maxCoverage: 50000  },
  'K-Market:DELIVERY_ORDER':    { productCode: 'AUTO_DELIVERY', basePremium: 0.3,  maxCoverage: 10000  },
  'K-119:EMERGENCY_DISPATCH':   { productCode: 'AUTO_EMERGENCY',basePremium: 1.0,  maxCoverage: 100000 },
  'GDC:HIGH_VALUE_TRANSFER':    { productCode: 'AUTO_TXGUARD',  basePremium: 0.1,  maxCoverage: 5000   },
};

// ──────────────────────────────────────────
// GWP 이벤트 수신 리스너
// gopang.net에서 postMessage로 이벤트 전달
// ──────────────────────────────────────────
window.addEventListener('message', async (e) => {
  if (e.origin !== 'https://gopang.net') return;
  const { type, payload } = e.data || {};
  if (type !== 'INS_AUTO_TRIGGER') return;
  await handleAutoTrigger(payload);
});

// ──────────────────────────────────────────
// 자동 보험 적용 핸들러
// ──────────────────────────────────────────
export async function handleAutoTrigger({ agent, event, user, context = {} }) {
  const triggerKey = `${agent}:${event}`;
  const trigger = AUTO_TRIGGER_MAP[triggerKey];

  if (!trigger) {
    console.warn(`[ins-auto] 미등록 트리거: ${triggerKey}`);
    return null;
  }

  try {
    // 1. 보험료 계산
    const { premium, riskGrade, riskCoeff } = await calcAutoPremium({
      userIpv6: user.ipv6,
      basePremium: trigger.basePremium,
      context,
    });

    // 2. 자동 보험 계약 생성 (ins-core.js)
    const policy = await createPolicy({
      userIpv6: user.ipv6,
      productCode: trigger.productCode,
      premiumGdc: premium,
      coverageGdc: trigger.maxCoverage,
      riskGrade,
      riskCoeff,
      triggerAgent: agent,
      endAt: calcAutoEndAt(agent, event, context),
      pdvRecord: buildPdvRecord({ agent, event, user, context }),
    });

    // 3. GDC 보험료 자동 차감 (GDC 연동)
    await deductPremiumGdc(user.ipv6, premium, policy.policy_no);

    // 4. 사용자 알림 (강제규칙 8)
    notifyUser(user.ipv6, policy);

    // 5. OpenHash 앵커링
    await anchorToOpenHash(policy);

    console.log(`[ins-auto] 자동 보험 적용 완료: ${policy.policy_no}`);
    return policy;

  } catch (err) {
    console.error(`[ins-auto] 자동 보험 적용 실패: ${triggerKey}`, err);
    return null;
  }
}

// ──────────────────────────────────────────
// 자동 보험 종료 시각 계산
// ──────────────────────────────────────────
function calcAutoEndAt(agent, event, context) {
  const now = new Date();
  if (agent === 'K-Traffic') {
    // 이동 예상 소요 시간 + 여유 30분
    const etaMs = (context.estimatedMinutes || 60) * 60 * 1000;
    return new Date(now.getTime() + etaMs + 30 * 60 * 1000).toISOString();
  }
  if (agent === 'K-Market') {
    // 배달 완료 예상 시간 + 여유 30분
    const etaMs = (context.deliveryMinutes || 60) * 60 * 1000;
    return new Date(now.getTime() + etaMs + 30 * 60 * 1000).toISOString();
  }
  if (agent === 'K-119') {
    // 응급 처치 완료까지 (기본 24시간)
    return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  }
  if (agent === 'GDC') {
    // 거래 확정 후 72시간
    return new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString();
  }
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString(); // 기본 1시간
}

// ──────────────────────────────────────────
// PDV 6하원칙 레코드 생성
// ──────────────────────────────────────────
function buildPdvRecord({ agent, event, user, context }) {
  return {
    svc:   'insurance',
    type:  'auto_policy',
    who:   { ipv6: user.ipv6, role: 'user', level: user.level || 'L0' },
    when:  { period_start: new Date().toISOString() },
    where: { svc_url: `https://insurance.gopang.net`, trigger: `${agent}:${event}` },
    what:  { summary: `자동 보험 적용 (${agent} ${event})` },
    how:   { method: 'ins-auto.js 이벤트 트리거' },
    why:   { goal: '이동·거래·응급 리스크 자동 보장' },
  };
}

// ──────────────────────────────────────────
// GDC 보험료 차감 (GDC Agent 연동)
// ──────────────────────────────────────────
async function deductPremiumGdc(userIpv6, premiumGdc, policyNo) {
  // GDC Agent postMessage 연동
  if (window.opener) {
    window.opener.postMessage({
      type: 'GDC_DEDUCT',
      payload: {
        userIpv6,
        amount: premiumGdc,
        memo: `K-Insurance 보험료 (${policyNo})`,
      }
    }, 'https://gopang.net');
  }
  // 실패해도 보험은 유효 (소액이므로 사후 정산 허용)
}

// ──────────────────────────────────────────
// 사용자 알림 (강제규칙 8)
// ──────────────────────────────────────────
function notifyUser(userIpv6, policy) {
  const msg = {
    type: 'INS_AUTO_APPLIED',
    payload: {
      policyNo: policy.policy_no,
      productName: policy.product_name,
      coverageGdc: policy.coverage_gdc,
      premiumGdc: policy.premium_gdc,
      message: `🛡️ ${policy.product_name} 자동 적용\n보험번호: ${policy.policy_no}\n보험료: ₮${policy.premium_gdc}`,
    }
  };
  // gopang 포털로 알림 전달
  if (window.opener) {
    window.opener.postMessage(msg, 'https://gopang.net');
  }
}

// ──────────────────────────────────────────
// OpenHash 앵커링
// ──────────────────────────────────────────
async function anchorToOpenHash(policy) {
  try {
    const res = await fetch('https://openhash.gopang.net/anchor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'INS_POLICY',
        ref: policy.policy_no,
        data: policy,
        timestamp: new Date().toISOString(),
      }),
    });
    const { ref } = await res.json();
    // openhash_ref 업데이트는 서버사이드에서 처리
    console.log(`[ins-auto] OpenHash 앵커 완료: ${ref}`);
  } catch (err) {
    console.warn('[ins-auto] OpenHash 앵커링 실패 (재시도 예약):', err);
  }
}
