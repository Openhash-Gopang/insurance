-- ============================================================
-- K-Insurance Supabase 스키마 v1.0
-- 저장소: Openhash-Gopang/insurance
-- 도메인: insurance.hondi.net
-- ============================================================

-- ──────────────────────────────────────────────────────────
-- 1. 보험 계약 원장 (ins_policies)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ins_policies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_no     TEXT NOT NULL UNIQUE,  -- INS-YYYYMMDD-XXXX
  user_ipv6     TEXT NOT NULL,         -- 사용자 GUID (gopang L0 기기 식별)
  product_code  TEXT NOT NULL,         -- 상품 코드 (AUTO_RIDE, LIFE_TERM, HEALTH_ACTUAL 등)
  product_name  TEXT NOT NULL,
  category      TEXT NOT NULL,         -- AUTO | LIFE | HEALTH | PROPERTY | LIABILITY
  status        TEXT NOT NULL DEFAULT 'active', -- active | suspended | expired | cancelled
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ,           -- NULL = 종신
  premium_gdc   NUMERIC(18,4) NOT NULL, -- 월 보험료 (GDC)
  coverage_gdc  NUMERIC(18,4) NOT NULL, -- 최대 보장금액 (GDC)
  risk_grade    TEXT NOT NULL,          -- AAA | AA | A | BBB | BB | C
  risk_coeff    NUMERIC(6,4) NOT NULL DEFAULT 1.0, -- 리스크 조정계수
  trigger_agent TEXT,                  -- 자동 적용 트리거 Agent (K-Traffic 등)
  openhash_ref  TEXT,                  -- OpenHash 앵커 참조값
  pdv_record    JSONB,                 -- PDV 6하원칙 스냅샷
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ins_policies_user    ON ins_policies(user_ipv6);
CREATE INDEX idx_ins_policies_status  ON ins_policies(status);
CREATE INDEX idx_ins_policies_product ON ins_policies(product_code);

-- ──────────────────────────────────────────────────────────
-- 2. 보험 청구 원장 (ins_claims)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ins_claims (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_no      TEXT NOT NULL UNIQUE,  -- INS-YYYYMMDD-XXXX (청구 사건번호)
  policy_no     TEXT NOT NULL REFERENCES ins_policies(policy_no),
  user_ipv6     TEXT NOT NULL,
  claim_type    TEXT NOT NULL,         -- 사고 유형 (ACCIDENT | ILLNESS | THEFT | FIRE 등)
  claim_amount  NUMERIC(18,4) NOT NULL, -- 청구 금액 (GDC)
  approved_amount NUMERIC(18,4),       -- 승인 금액 (GDC)
  status        TEXT NOT NULL DEFAULT 'received',
                                       -- received → evidence_check → fraud_check
                                       -- → under_review → approved | rejected | escalated
  incident_at   TIMESTAMPTZ NOT NULL,  -- 사고 발생 시각
  claimed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  -- 증거 패키지 (강제규칙 2)
  pdv_record    JSONB,                 -- PDV 6하원칙 기록
  openhash_ref  TEXT,                  -- OpenHash 앵커 참조값
  agent_evidence JSONB,               -- 연동 Agent 데이터 (K-119/K-Traffic/K-Security)
  -- 심사 결과
  ai_model      TEXT,                  -- 처리 모델 (deepseek-v4 | claude-opus)
  risk_score    NUMERIC(5,4),          -- 사기 리스크 점수 (0~1)
  fraud_flag    BOOLEAN DEFAULT FALSE, -- 사기 의심 플래그
  kpolice_ref   TEXT,                  -- K-Police 사건번호 (KP-)
  klaw_analysis JSONB,                 -- K-Law v15.1 배상책임 분석 결과
  reject_reason TEXT,                  -- 거절 사유 (강제규칙 7)
  memo          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ins_claims_policy   ON ins_claims(policy_no);
CREATE INDEX idx_ins_claims_user     ON ins_claims(user_ipv6);
CREATE INDEX idx_ins_claims_status   ON ins_claims(status);
CREATE INDEX idx_ins_claims_fraud    ON ins_claims(fraud_flag);

-- ──────────────────────────────────────────────────────────
-- 3. 보험금 지급 원장 (ins_payouts)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ins_payouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_no     TEXT NOT NULL UNIQUE,  -- PAY-YYYYMMDD-XXXX
  claim_no      TEXT NOT NULL REFERENCES ins_claims(claim_no),
  user_ipv6     TEXT NOT NULL,
  amount_gdc    NUMERIC(18,4) NOT NULL,
  gdc_tx_ref    TEXT,                  -- GDC 이체 트랜잭션 참조
  openhash_ref  TEXT,                  -- OpenHash 앵커
  paid_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ins_payouts_claim ON ins_payouts(claim_no);
CREATE INDEX idx_ins_payouts_user  ON ins_payouts(user_ipv6);

-- ──────────────────────────────────────────────────────────
-- 4. 자동 보험 이벤트 로그 (ins_events)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ins_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_no      TEXT NOT NULL UNIQUE,
  user_ipv6     TEXT NOT NULL,
  trigger_agent TEXT NOT NULL,         -- K-Traffic | K-Market | K-119 | GDC
  event_type    TEXT NOT NULL,         -- RIDE_START | DELIVERY | EMERGENCY | TRANSACTION
  policy_no     TEXT REFERENCES ins_policies(policy_no),
  premium_gdc   NUMERIC(18,4),
  event_at      TIMESTAMPTZ NOT NULL,
  event_data    JSONB,                 -- 이벤트 원본 데이터
  pdv_record    JSONB,
  openhash_ref  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ins_events_user    ON ins_events(user_ipv6);
CREATE INDEX idx_ins_events_agent   ON ins_events(trigger_agent);
CREATE INDEX idx_ins_events_type    ON ins_events(event_type);

-- ──────────────────────────────────────────────────────────
-- 5. 보험 상품 카탈로그 (ins_products)
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ins_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code    TEXT NOT NULL UNIQUE,
  product_name    TEXT NOT NULL,
  category        TEXT NOT NULL,      -- AUTO | LIFE | HEALTH | PROPERTY | LIABILITY
  is_auto         BOOLEAN DEFAULT FALSE,  -- 이벤트 트리거 자동 적용 여부
  trigger_agent   TEXT,               -- 자동 적용 트리거 Agent
  base_premium    NUMERIC(18,4) NOT NULL, -- 기준 보험료 (GDC)
  max_coverage    NUMERIC(18,4) NOT NULL, -- 최대 보장금액 (GDC)
  min_period_days INTEGER,            -- 최소 가입 기간 (일)
  waiting_days    INTEGER DEFAULT 0,  -- 면책 기간 (일)
  description     TEXT,
  coverage_detail JSONB,              -- 보장 상세
  exclusions      JSONB,              -- 면책 사유
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 기본 상품 데이터
INSERT INTO ins_products (product_code, product_name, category, is_auto, trigger_agent,
                          base_premium, max_coverage, min_period_days, waiting_days, description)
VALUES
  ('AUTO_RIDE',     '탑승 보험',        'AUTO',      TRUE,  'K-Traffic', 0.5,    50000,  NULL, 0,  '카풀·택시 탑승 시 자동 적용'),
  ('AUTO_DELIVERY', '배달 보험',        'AUTO',      TRUE,  'K-Market',  0.3,    10000,  NULL, 0,  '음식 배달 주문 시 자동 적용'),
  ('AUTO_EMERGENCY','응급 의료 보험',   'AUTO',      TRUE,  'K-119',     1.0,    100000, NULL, 0,  'K-119 출동 시 자동 적용'),
  ('AUTO_TXGUARD',  '거래 사기 보험',   'AUTO',      TRUE,  'GDC',       0.1,    5000,   NULL, 0,  '고액 GDC 이체 시 자동 적용'),
  ('LIFE_TERM',     '정기 생명보험',    'LIFE',      FALSE, NULL,        5000,   1000000, 365, 0,  '사망·고도 장해 보장'),
  ('LIFE_WHOLE',    '종신 보험',        'LIFE',      FALSE, NULL,        15000,  2000000, 365, 0,  'OpenHash 신탁 연동 종신 보장'),
  ('HEALTH_ACTUAL', '실손 의료보험',    'HEALTH',    FALSE, NULL,        3000,   200000,  365, 30, 'K-Health 자동 청구 연동'),
  ('HEALTH_CANCER', '암 보험',          'HEALTH',    FALSE, NULL,        8000,   500000,  365, 90, 'AI 정밀 심사'),
  ('PROP_FIRE',     '화재 보험',        'PROPERTY',  FALSE, NULL,        2000,   300000,  365, 0,  'K-119 연동 자동 청구'),
  ('PROP_THEFT',    '도난 보험',        'PROPERTY',  FALSE, NULL,        1500,   100000,  365, 0,  'K-Security CCTV 연동'),
  ('PROP_TRAVEL',   '여행자 보험',      'PROPERTY',  FALSE, NULL,        1000,   150000,  1,   0,  'K-Traffic 해외 이동 감지'),
  ('LIA_PERSONAL',  '개인 배상책임',    'LIABILITY', FALSE, NULL,        500,    50000,   365, 0,  'K-Law 자동 분석 연동'),
  ('LIA_CYBER',     '사이버 보험',      'LIABILITY', FALSE, NULL,        2000,   200000,  365, 0,  'K-Security 해킹·랜섬웨어 연동')
ON CONFLICT (product_code) DO NOTHING;

-- ──────────────────────────────────────────────────────────
-- 6. 업데이트 타임스탬프 트리거
-- ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ins_policies_updated
  BEFORE UPDATE ON ins_policies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_ins_claims_updated
  BEFORE UPDATE ON ins_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
