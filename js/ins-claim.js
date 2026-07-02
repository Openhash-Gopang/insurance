/**
 * ins-claim.js — K-Insurance 청구 처리 모듈 v1.0
 * 청구 접수·AI 심사·보험금 지급 자동화
 * 강제규칙 1~7 구현
 */

import { supabase } from './ins-core.js';
import { generateClaimNo, generatePayoutNo, submitClaim } from './ins-core.js';
import { detectFraud } from './ins-risk.js';

const AI_API_BASE = 'https://api.anthropic.com/v1/messages';
const HIGH_VALUE_THRESHOLD = 1_000_000; // ₮ 1,000,000 이상 고액 청구

// ──────────────────────────────────────────
// 메인 청구 처리 파이프라인
// STEP C-1 ~ C-7 구현
// ──────────────────────────────────────────
export async function processClaim({
  policyNo,
  userIpv6,
  claimType,
  claimAmount,
  incidentAt,
  evidence = {},  // { pdvRecord, openhashRef, agentData }
}) {
  console.log(`[ins-claim] 청구 접수 시작: ${policyNo}`);

  // ── STEP C-1: 청구 접수 + 사건번호 발급 (강제규칙 1) ──
  const claim = await submitClaim({
    policyNo,
    userIpv6,
    claimType,
    claimAmount,
    incidentAt,
    agentEvidence: evidence.agentData,
  });

  const header = `[K-Insurance v1.0 | 사건번호: ${claim.claim_no} | 처리단계: 1/6]`;
  console.log(header);

  try {
    // ── STEP C-2: 증거 패키지 확인 (강제규칙 2) ──
    const evidenceOk = await checkEvidencePackage(claim.claim_no, evidence);
    if (!evidenceOk.valid) {
      await updateClaimStatus(claim.claim_no, 'evidence_insufficient', {
        rejectReason: `증거 불충분: ${evidenceOk.missing.join(', ')}`,
      });
      return claimResult(claim.claim_no, 'rejected', 0, evidenceOk.missing.join(', '));
    }

    // ── STEP C-3: 사기 탐지 (강제규칙 3) ──
    await updateClaimStatus(claim.claim_no, 'fraud_check');
    const fraudResult = await detectFraud({ claim, evidence, userIpv6 });

    if (fraudResult.suspicious) {
      await updateClaimStatus(claim.claim_no, 'escalated', {
        fraudFlag: true,
        kpoliceRef: await notifyKPolice(claim, fraudResult),
      });
      // 사기 의심 사실은 사용자에게 직접 고지 않음 (시스템 프롬프트 금지사항)
      return claimResult(claim.claim_no, 'under_investigation', 0, '추가 확인 필요');
    }

    // ── STEP C-4: 보험금 심사 ──
    await updateClaimStatus(claim.claim_no, 'under_review');

    let approvedAmount;
    let aiModel;

    if (claimAmount > HIGH_VALUE_THRESHOLD) {
      // 고액 청구: Claude Opus 에스컬레이션 (강제규칙 5)
      console.log(`[ins-claim] [ESCALATION] 고액 청구 — Claude Opus 에스컬레이션`);
      const result = await reviewWithClaudeOpus({ claim, evidence, policyNo });
      approvedAmount = result.approvedAmount;
      aiModel = 'claude-opus';
    } else {
      // 표준 청구: DeepSeek V4 Pro 자동 심사
      const result = await reviewWithDeepSeek({ claim, evidence });
      approvedAmount = result.approvedAmount;
      aiModel = 'deepseek-v4-pro';
    }

    // ── STEP C-5: 배상책임 청구 시 K-Law 분석 (강제규칙 6) ──
    let klawAnalysis = null;
    if (claimType === 'LIABILITY' || claimType === 'ACCIDENT_FAULT') {
      klawAnalysis = await callKLaw({ claim, evidence });
      if (klawAnalysis) {
        // K-Law 과실 비율 반영
        approvedAmount = Math.floor(approvedAmount * (1 - klawAnalysis.faultRatio));
      }
    }

    // ── STEP C-6: 지급 결정 ──
    if (approvedAmount > 0) {
      // 승인
      await updateClaimStatus(claim.claim_no, 'approved', {
        approvedAmount,
        aiModel,
        klawAnalysis,
      });
      await payoutGdc(claim.claim_no, userIpv6, approvedAmount);
      await anchorClaimToOpenHash(claim.claim_no, 'approved');

      return claimResult(claim.claim_no, 'approved', approvedAmount);
    } else {
      // 거절 (강제규칙 7)
      const reason = '보장 범위 미해당 또는 면책 사유 적용';
      await updateClaimStatus(claim.claim_no, 'rejected', { rejectReason: reason });
      return claimResult(claim.claim_no, 'rejected', 0, reason);
    }

  } catch (err) {
    console.error(`[ins-claim] 처리 오류:`, err);
    await updateClaimStatus(claim.claim_no, 'error');
    throw err;
  }
}

// ──────────────────────────────────────────
// STEP C-2: 증거 패키지 확인 (강제규칙 2)
// ──────────────────────────────────────────
async function checkEvidencePackage(claimNo, evidence) {
  const missing = [];
  if (!evidence.pdvRecord)    missing.push('PDV 6하원칙 기록');
  if (!evidence.openhashRef)  missing.push('OpenHash 앵커 참조값');
  // agentData는 소액 자동 보험의 경우 선택
  return { valid: missing.length === 0, missing };
}

// ──────────────────────────────────────────
// 표준 청구 심사: DeepSeek V4 Pro
// ──────────────────────────────────────────
async function reviewWithDeepSeek({ claim, evidence }) {
  const prompt = `
K-Insurance 보험금 심사 요청

사건번호: ${claim.claim_no}
보험 계약: ${claim.policy_no}
청구 유형: ${claim.claim_type}
청구 금액: ₮${claim.claim_amount}
사고 시각: ${claim.incident_at}

증거:
- PDV 기록: ${JSON.stringify(evidence.pdvRecord || {})}
- 연동 Agent 데이터: ${JSON.stringify(evidence.agentData || {})}

보장 범위와 면책 사유를 검토하여 승인 금액(GDC)을 결정하라.
JSON만 반환: { "approvedAmount": 숫자, "reason": "사유" }
  `.trim();

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${window.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
    }),
  });

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '{"approvedAmount":0,"reason":"심사 실패"}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { approvedAmount: 0, reason: '심사 결과 파싱 오류' };
  }
}

// ──────────────────────────────────────────
// 고액 청구 심사: Claude Opus (강제규칙 5)
// ──────────────────────────────────────────
async function reviewWithClaudeOpus({ claim, evidence, policyNo }) {
  const res = await fetch(AI_API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-opus-4-20250514',
      max_tokens: 1000,
      system: `너는 K-Insurance 고액 청구 전문 심사역 AI다.
보험금 지급 여부와 금액을 결정한다.
증거 기반 판단 원칙(공리 B)을 엄수한다.
JSON만 반환: { "approvedAmount": 숫자, "reason": "사유", "confidence": 0~1 }`,
      messages: [{
        role: 'user',
        content: `
[ESCALATION — Claude Opus]
사건번호: ${claim.claim_no}
청구 금액: ₮${claim.claim_amount}
청구 유형: ${claim.claim_type}
사고 시각: ${claim.incident_at}
증거 패키지: ${JSON.stringify(evidence)}
계약번호: ${policyNo}
        `.trim()
      }],
    }),
  });

  const data = await res.json();
  const text = data.content?.[0]?.text || '{"approvedAmount":0,"reason":"심사 실패","confidence":0}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { approvedAmount: 0, reason: '심사 결과 파싱 오류', confidence: 0 };
  }
}

// ──────────────────────────────────────────
// K-Law v15.1 배상책임 분석 (강제규칙 6)
// ──────────────────────────────────────────
async function callKLaw({ claim, evidence }) {
  try {
    const res = await fetch('https://klaw.hondi.net/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseType: 'LIABILITY',
        insClaimNo: claim.claim_no,
        incidentAt: claim.incident_at,
        evidence,
      }),
    });
    return await res.json(); // { faultRatio: 0~1, analysis: '...' }
  } catch {
    console.warn('[ins-claim] K-Law 연동 실패. 배상 책임 분석 없이 진행.');
    return null;
  }
}

// ──────────────────────────────────────────
// 보험금 GDC 지급
// ──────────────────────────────────────────
async function payoutGdc(claimNo, userIpv6, amountGdc) {
  const payoutNo = generatePayoutNo();

  await supabase.from('ins_payouts').insert({
    payout_no: payoutNo,
    claim_no: claimNo,
    user_ipv6: userIpv6,
    amount_gdc: amountGdc,
  });

  // GDC Agent 연동 (입금)
  if (window.opener) {
    window.opener.postMessage({
      type: 'GDC_CREDIT',
      payload: {
        userIpv6,
        amount: amountGdc,
        memo: `K-Insurance 보험금 (${claimNo})`,
      }
    }, 'https://hondi.net');
  }

  console.log(`[ins-claim] 보험금 지급 완료: ₮${amountGdc} → ${userIpv6}`);
  return payoutNo;
}

// ──────────────────────────────────────────
// K-Police 연동 (사기 의심)
// ──────────────────────────────────────────
async function notifyKPolice(claim, fraudResult) {
  try {
    const res = await fetch('https://police.hondi.net/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'INSURANCE_FRAUD_SUSPECT',
        insClaimNo: claim.claim_no,
        userIpv6: claim.user_ipv6,
        fraudScore: fraudResult.score,
        patterns: fraudResult.patterns,
      }),
    });
    const { kpNo } = await res.json();
    return kpNo; // KP-YYYYMMDD-XXXX
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────
// OpenHash 앵커링
// ──────────────────────────────────────────
async function anchorClaimToOpenHash(claimNo, status) {
  try {
    await fetch('https://openhash.hondi.net/anchor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'INS_CLAIM', ref: claimNo, status, timestamp: new Date().toISOString() }),
    });
  } catch (err) {
    console.warn('[ins-claim] OpenHash 앵커링 실패:', err);
  }
}

// ──────────────────────────────────────────
// 청구 상태 업데이트
// ──────────────────────────────────────────
async function updateClaimStatus(claimNo, status, extra = {}) {
  await supabase
    .from('ins_claims')
    .update({ status, ...extra, updated_at: new Date().toISOString() })
    .eq('claim_no', claimNo);
}

// ──────────────────────────────────────────
// 결과 포맷
// ──────────────────────────────────────────
function claimResult(claimNo, status, approvedAmount, reason = null) {
  return { claimNo, status, approvedAmount, reason, tag: '[INS-CLAIM-COMPLETE]' };
}
