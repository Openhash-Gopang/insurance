-- ============================================================
-- K-Insurance RLS 정책 v1.0
-- Row Level Security — 사용자는 자신의 데이터만 접근
-- ============================================================

-- RLS 활성화
ALTER TABLE ins_policies  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ins_claims    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ins_payouts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ins_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ins_products  ENABLE ROW LEVEL SECURITY;

-- ──────────────────────────────────────────────────────────
-- ins_policies: 사용자는 자신의 계약만 조회·수정
-- ──────────────────────────────────────────────────────────
CREATE POLICY ins_policies_select ON ins_policies
  FOR SELECT USING (user_ipv6 = current_setting('request.jwt.claims', TRUE)::jsonb->>'ipv6');

CREATE POLICY ins_policies_insert ON ins_policies
  FOR INSERT WITH CHECK (user_ipv6 = current_setting('request.jwt.claims', TRUE)::jsonb->>'ipv6');

-- 해지·변경은 본인만 가능 (status 변경에 한함)
CREATE POLICY ins_policies_update ON ins_policies
  FOR UPDATE USING (user_ipv6 = current_setting('request.jwt.claims', TRUE)::jsonb->>'ipv6');

-- ──────────────────────────────────────────────────────────
-- ins_claims: 사용자는 자신의 청구만 조회·생성
-- ──────────────────────────────────────────────────────────
CREATE POLICY ins_claims_select ON ins_claims
  FOR SELECT USING (user_ipv6 = current_setting('request.jwt.claims', TRUE)::jsonb->>'ipv6');

CREATE POLICY ins_claims_insert ON ins_claims
  FOR INSERT WITH CHECK (user_ipv6 = current_setting('request.jwt.claims', TRUE)::jsonb->>'ipv6');

-- 청구 내용은 사용자가 직접 수정 불가 (AI 처리만)
-- UPDATE 정책 없음 — service_role만 가능

-- ──────────────────────────────────────────────────────────
-- ins_payouts: 사용자는 자신의 지급 내역만 조회
-- ──────────────────────────────────────────────────────────
CREATE POLICY ins_payouts_select ON ins_payouts
  FOR SELECT USING (user_ipv6 = current_setting('request.jwt.claims', TRUE)::jsonb->>'ipv6');

-- 지급은 service_role만 생성 가능 (사용자 직접 생성 불가)

-- ──────────────────────────────────────────────────────────
-- ins_events: 사용자는 자신의 이벤트만 조회
-- ──────────────────────────────────────────────────────────
CREATE POLICY ins_events_select ON ins_events
  FOR SELECT USING (user_ipv6 = current_setting('request.jwt.claims', TRUE)::jsonb->>'ipv6');

-- ──────────────────────────────────────────────────────────
-- ins_products: 전체 공개 (상품 카탈로그는 누구나 조회)
-- ──────────────────────────────────────────────────────────
CREATE POLICY ins_products_select ON ins_products
  FOR SELECT USING (is_active = TRUE);

-- ──────────────────────────────────────────────────────────
-- service_role 전체 권한 (AI Agent 처리용)
-- ──────────────────────────────────────────────────────────
CREATE POLICY ins_policies_service  ON ins_policies  FOR ALL USING (current_role = 'service_role');
CREATE POLICY ins_claims_service    ON ins_claims    FOR ALL USING (current_role = 'service_role');
CREATE POLICY ins_payouts_service   ON ins_payouts   FOR ALL USING (current_role = 'service_role');
CREATE POLICY ins_events_service    ON ins_events    FOR ALL USING (current_role = 'service_role');
CREATE POLICY ins_products_service  ON ins_products  FOR ALL USING (current_role = 'service_role');
