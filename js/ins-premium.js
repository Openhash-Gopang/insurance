/**
 * ins-premium.js — K-Insurance 보험료 산출 모듈 v1.0
 * 재무제표·나이·이력·리스크 등급 기반 보험료 계산
 */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 리스크 등급별 조정계수
const RISK_COEFF_TABLE = {
  'AAA': 0.7,
  'AA':  0.8,
  'A':   0.9,
  'BBB': 1.0,
  'BB':  1.2,
  'C':   1.5,
};

// ──────────────────────────────────────────
// 일반 보험 보험료 산출
// ──────────────────────────────────────────
export async function calcPremium({ userIpv6, productCode, options = {} }) {
  // 1. 상품 기준 보험료 조회
  const { data: product } = await supabase
    .from('ins_products')
    .select('base_premium, max_coverage')
    .eq('product_code', productCode)
    .single();

  if (!product) throw new Error('상품을 찾을 수 없습니다.');

  // 2. 사용자 프로파일 + 재무제표 조회
  const { riskGrade, riskCoeff, ageCoeff } = await getUserRiskProfile(userIpv6);

  // 3. 사고 이력 조회
  const historyCoeff = await getClaimHistoryCoeff(userIpv6);

  // 4. 최종 보험료 계산
  const premium = Math.ceil(product.base_premium * riskCoeff * ageCoeff * historyCoeff);

  return {
    basePremium:  product.base_premium,
    riskGrade,
    riskCoeff,
    ageCoeff,
    historyCoeff,
    finalPremium: premium,
    maxCoverage:  product.max_coverage,
    breakdown: {
      '기준 보험료': product.base_premium,
      '리스크 등급 조정': riskCoeff,
      '나이 조정': ageCoeff,
      '사고 이력 조정': historyCoeff,
      '최종 보험료(월)': premium,
    },
  };
}

// ──────────────────────────────────────────
// 자동 보험 보험료 산출 (이벤트 트리거)
// ──────────────────────────────────────────
export async function calcAutoPremium({ userIpv6, basePremium, context = {} }) {
  const { riskGrade, riskCoeff } = await getUserRiskProfile(userIpv6);

  // 자동 보험은 리스크 조정만 적용 (단순화)
  const premium = Math.ceil(basePremium * riskCoeff * 100) / 100; // GDC 소수점 2자리

  return { premium, riskGrade, riskCoeff };
}

// ──────────────────────────────────────────
// 사용자 리스크 프로파일 조회
// ──────────────────────────────────────────
async function getUserRiskProfile(userIpv6) {
  // user_profiles에서 재무제표 조회
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('extra')
    .eq('ipv6', userIpv6)
    .single();

  const fs = profile?.extra?.fs || {};
  const bs = fs.bs || {};

  // 재무제표 기반 안정성 점수 (0~100)
  const netAsset    = (bs['bs-cash'] || 0) + (bs['bs-invest'] || 0) - (bs['bs-debt'] || 0);
  const fsScore     = Math.min(100, Math.max(0, netAsset / 1000));  // ₮1,000 당 1점

  // 나이 조정 (선택 정보)
  const birthYear   = profile?.extra?.birthYear;
  const age         = birthYear ? new Date().getFullYear() - birthYear : null;
  const ageCoeff    = age ? calcAgeCoeff(age) : 1.0;

  // 리스크 등급 결정
  const riskGrade   = fsScoreToGrade(fsScore);
  const riskCoeff   = RISK_COEFF_TABLE[riskGrade] || 1.0;

  return { riskGrade, riskCoeff, ageCoeff, fsScore };
}

// ──────────────────────────────────────────
// 나이 조정계수
// ──────────────────────────────────────────
function calcAgeCoeff(age) {
  if (age < 25)  return 1.3;   // 청년 운전자 등 고위험
  if (age < 40)  return 1.0;   // 기준
  if (age < 55)  return 0.9;   // 성숙
  if (age < 65)  return 1.1;   // 초기 고령
  return 1.4;                   // 고령
}

// ──────────────────────────────────────────
// 재무제표 점수 → 리스크 등급
// ──────────────────────────────────────────
function fsScoreToGrade(score) {
  if (score >= 80) return 'AAA';
  if (score >= 65) return 'AA';
  if (score >= 50) return 'A';
  if (score >= 35) return 'BBB';
  if (score >= 20) return 'BB';
  return 'C';
}

// ──────────────────────────────────────────
// 사고 이력 조정계수
// ──────────────────────────────────────────
async function getClaimHistoryCoeff(userIpv6) {
  // 최근 3년 승인된 청구 건수 조회
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

  const { count } = await supabase
    .from('ins_claims')
    .select('id', { count: 'exact', head: true })
    .eq('user_ipv6', userIpv6)
    .eq('status', 'approved')
    .gte('claimed_at', threeYearsAgo.toISOString());

  // 청구 건수별 조정계수
  if (!count || count === 0) return 0.95;  // 무사고 할인
  if (count === 1)           return 1.0;
  if (count === 2)           return 1.15;
  if (count === 3)           return 1.30;
  return 1.50;                              // 4건 이상 고위험
}
