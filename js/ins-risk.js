/**
 * ins-risk.js — K-Insurance 리스크 평가·사기 탐지 모듈 v1.0
 * 강제규칙 3 구현: 사기 탐지 실행 의무
 */

import { supabase } from './ins-core.js';

// 사기 탐지 임계값
const FRAUD_THRESHOLD = 0.7;  // 0~1, 이상이면 사기 의심

// ──────────────────────────────────────────
// 사기 탐지 메인 함수 (강제규칙 3)
// ──────────────────────────────────────────
export async function detectFraud({ claim, evidence, userIpv6 }) {
  const patterns = [];
  let score = 0;

  // ① 동일 사용자 반복 청구 패턴
  const repeatScore = await checkRepeatClaims(userIpv6, claim.claim_type);
  if (repeatScore > 0) {
    patterns.push({ type: 'REPEAT_CLAIMS', score: repeatScore });
    score += repeatScore;
  }

  // ② 사고 시각과 PDV 기록 불일치
  const timingScore = checkTimingConsistency(claim, evidence.pdvRecord);
  if (timingScore > 0) {
    patterns.push({ type: 'TIMING_MISMATCH', score: timingScore });
    score += timingScore;
  }

  // ③ K-Police 사건번호 미발급 고액 청구
  const nokpoliceScore = checkNoKPolice(claim, evidence);
  if (nokpoliceScore > 0) {
    patterns.push({ type: 'NO_KPOLICE_HIGH_VALUE', score: nokpoliceScore });
    score += nokpoliceScore;
  }

  // ④ 가입 직후 청구 (90일 이내 특정 담보)
  const earlyClaimScore = await checkEarlyClaim(claim);
  if (earlyClaimScore > 0) {
    patterns.push({ type: 'EARLY_CLAIM', score: earlyClaimScore });
    score += earlyClaimScore;
  }

  // ⑤ OpenHash 앵커 유효성 (위변조 감지)
  const tamperScore = await checkOpenHashAnchor(evidence.openhashRef, evidence.pdvRecord);
  if (tamperScore > 0) {
    patterns.push({ type: 'OPENHASH_TAMPER', score: tamperScore });
    score += tamperScore;
  }

  const normalizedScore = Math.min(1, score);
  const suspicious = normalizedScore >= FRAUD_THRESHOLD;

  console.log(`[ins-risk] 사기 탐지 결과: score=${normalizedScore.toFixed(2)}, suspicious=${suspicious}`);

  return { suspicious, score: normalizedScore, patterns };
}

// ──────────────────────────────────────────
// ① 반복 청구 패턴 확인
// ──────────────────────────────────────────
async function checkRepeatClaims(userIpv6, claimType) {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const { count } = await supabase
    .from('ins_claims')
    .select('id', { count: 'exact', head: true })
    .eq('user_ipv6', userIpv6)
    .eq('claim_type', claimType)
    .gte('claimed_at', oneYearAgo.toISOString());

  if (!count) return 0;
  if (count >= 5) return 0.5;   // 1년 내 5건 이상: 매우 높음
  if (count >= 3) return 0.3;   // 3건 이상: 높음
  if (count >= 2) return 0.1;   // 2건: 주의
  return 0;
}

// ──────────────────────────────────────────
// ② 사고 시각 - PDV 기록 불일치
// ──────────────────────────────────────────
function checkTimingConsistency(claim, pdvRecord) {
  if (!pdvRecord?.when?.period_start) return 0;

  const incidentTime = new Date(claim.incident_at).getTime();
  const pdvTime      = new Date(pdvRecord.when.period_start).getTime();
  const diffHours    = Math.abs(incidentTime - pdvTime) / (1000 * 60 * 60);

  if (diffHours > 24) return 0.4;  // 24시간 이상 차이
  if (diffHours > 6)  return 0.2;  // 6시간 이상 차이
  return 0;
}

// ──────────────────────────────────────────
// ③ K-Police 사건번호 없이 고액 청구
// ──────────────────────────────────────────
function checkNoKPolice(claim, evidence) {
  const isHighValue = claim.claim_amount > 500_000;  // ₮500,000 이상
  const hasKPolice  = evidence?.agentData?.kpoliceRef;

  if (isHighValue && !hasKPolice) return 0.3;
  return 0;
}

// ──────────────────────────────────────────
// ④ 가입 직후 청구 (90일 이내)
// ──────────────────────────────────────────
async function checkEarlyClaim(claim) {
  // 해당 담보 계약의 가입일 조회
  const { data: policy } = await supabase
    .from('ins_policies')
    .select('start_at, waiting_days')
    .eq('policy_no', claim.policy_no)
    .single();

  if (!policy) return 0;

  const startAt     = new Date(policy.start_at);
  const incidentAt  = new Date(claim.incident_at);
  const daysDiff    = (incidentAt - startAt) / (1000 * 60 * 60 * 24);
  const waitingDays = policy.waiting_days || 0;

  if (daysDiff < waitingDays) return 0.8;  // 면책 기간 내 청구: 매우 높음
  if (daysDiff < 30)          return 0.3;  // 30일 이내: 주의
  return 0;
}

// ──────────────────────────────────────────
// ⑤ OpenHash 앵커 위변조 감지
// ──────────────────────────────────────────
async function checkOpenHashAnchor(openhashRef, pdvRecord) {
  if (!openhashRef) return 0;

  try {
    const res = await fetch(`https://openhash.hondi.net/verify/${openhashRef}`);
    const { valid, mismatch } = await res.json();
    if (!valid || mismatch) return 0.9;  // 위변조 감지: 매우 높음
    return 0;
  } catch {
    return 0;  // 네트워크 오류는 탐지 실패로 처리 (이익 의심 아님)
  }
}
