/**
 * ins-core.js — K-Insurance 핵심 모듈 v1.0
 * 보험 계약 조회·생성·해지·변경
 * 도메인: insurance.hondi.net
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ──────────────────────────────────────────
// 사건번호 생성
// ──────────────────────────────────────────
export function generatePolicyNo() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `INS-${date}-${seq}`;
}

export function generateClaimNo() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `CLM-${date}-${seq}`;
}

export function generatePayoutNo() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 9000) + 1000);
  return `PAY-${date}-${seq}`;
}

// ──────────────────────────────────────────
// 내 보험 계약 조회
// ──────────────────────────────────────────
export async function getMyPolicies(userIpv6) {
  const { data, error } = await supabase
    .from('ins_policies')
    .select('*')
    .eq('user_ipv6', userIpv6)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

// ──────────────────────────────────────────
// 보험 계약 생성
// ──────────────────────────────────────────
export async function createPolicy({
  userIpv6,
  productCode,
  premiumGdc,
  coverageGdc,
  riskGrade,
  riskCoeff,
  triggerAgent = null,
  startAt = new Date().toISOString(),
  endAt = null,
  pdvRecord = null,
}) {
  const policyNo = generatePolicyNo();

  // 상품 정보 조회
  const { data: product } = await supabase
    .from('ins_products')
    .select('product_name, category')
    .eq('product_code', productCode)
    .single();

  if (!product) throw new Error('존재하지 않는 상품 코드입니다.');

  const { data, error } = await supabase
    .from('ins_policies')
    .insert({
      policy_no: policyNo,
      user_ipv6: userIpv6,
      product_code: productCode,
      product_name: product.product_name,
      category: product.category,
      status: 'active',
      start_at: startAt,
      end_at: endAt,
      premium_gdc: premiumGdc,
      coverage_gdc: coverageGdc,
      risk_grade: riskGrade,
      risk_coeff: riskCoeff,
      trigger_agent: triggerAgent,
      pdv_record: pdvRecord,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ──────────────────────────────────────────
// 보험 계약 해지
// ──────────────────────────────────────────
export async function cancelPolicy(policyNo, userIpv6) {
  const { data, error } = await supabase
    .from('ins_policies')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('policy_no', policyNo)
    .eq('user_ipv6', userIpv6)  // RLS 이중 보호
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ──────────────────────────────────────────
// 청구 접수
// ──────────────────────────────────────────
export async function submitClaim({
  policyNo,
  userIpv6,
  claimType,
  claimAmount,
  incidentAt,
  agentEvidence = null,
}) {
  const claimNo = generateClaimNo();

  const { data, error } = await supabase
    .from('ins_claims')
    .insert({
      claim_no: claimNo,
      policy_no: policyNo,
      user_ipv6: userIpv6,
      claim_type: claimType,
      claim_amount: claimAmount,
      status: 'received',
      incident_at: incidentAt,
      agent_evidence: agentEvidence,
    })
    .select()
    .single();

  if (error) throw error;
  return { claimNo, ...data };
}

// ──────────────────────────────────────────
// 내 청구 이력 조회
// ──────────────────────────────────────────
export async function getMyClaims(userIpv6) {
  const { data, error } = await supabase
    .from('ins_claims')
    .select('*')
    .eq('user_ipv6', userIpv6)
    .order('claimed_at', { ascending: false });

  if (error) throw error;
  return data;
}

// ──────────────────────────────────────────
// 보험금 지급 이력 조회
// ──────────────────────────────────────────
export async function getMyPayouts(userIpv6) {
  const { data, error } = await supabase
    .from('ins_payouts')
    .select('*, ins_claims(claim_type, claim_amount, incident_at)')
    .eq('user_ipv6', userIpv6)
    .order('paid_at', { ascending: false });

  if (error) throw error;
  return data;
}

// ──────────────────────────────────────────
// 상품 카탈로그 조회
// ──────────────────────────────────────────
export async function getProducts(category = null) {
  let query = supabase
    .from('ins_products')
    .select('*')
    .eq('is_active', true)
    .order('category', { ascending: true });

  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}
