/* ── K-Insurance 청구 모달 ── */

// 2026-07-18: PROXY 상수는 이 파일 안에서 자체적으로 선언한다(다른
// src/ins/*.js 파일의 전역 선언 순서에 기대지 않기 위함).
var CLAIM_PROXY_BASE = 'https://hondi-proxy.tensor-city.workers.dev';

function openClaimModal() {
  document.getElementById('claimOverlay').classList.add('open');
  document.getElementById('claimForm').style.display = '';
  document.getElementById('claimResult').classList.remove('visible');
  document.getElementById('claimFooter').style.display = '';
}

function closeClaimModal() {
  document.getElementById('claimOverlay').classList.remove('open');
}

document.getElementById('claimOverlay').addEventListener('click', function (e) {
  if (e.target === this) closeClaimModal();
});

// 2026-07-18 전면 재작성(1차) — 이전 버전은 백엔드 호출이 전혀 없이
// "AI 심사가 시작되었습니다, 0.3초 이내 처리됩니다", "Claude Opus +
// K-Law v15.1 심층 분석 시작, 최대 24시간" 같은 문구만 setTimeout으로
// 보여주는 UI 연출이었다 — 실제로는 청구가 어디에도 기록되지 않았고,
// 심사도 지급도 전혀 일어나지 않았다(이전 세션 K-Insurance 리포트
// 참고: js/ins-claim.js 등 실제 심사·사기탐지 로직은 전부 미배선
// 죽은 코드 상태).
//
// 2026-07-18 재작성(2차, HONDI_GAP_REMEDIATION_DIRECTIVE v1.0 §2.1) —
// 1차 재작성 때는 PDV 감사 기록만 남기고 실제 조회 가능한 청구
// 레코드가 없었다("담당자가 확인"할 곳 자체가 없었음). 이제
// worker.js에 신설된 POST /biz/ins-claim(PocketBase L1 ins_claims
// 컬렉션에 실제 저장, 상태값 접수/심사중/승인/거부/지급완료)을
// 호출한다. 자금이 걸린 요청은 아니지만 청구 내역 자체가 민감
// 정보이므로 gdc-deposit-close와 동일하게 지갑 서명 인증을 요구한다.
// 자동 심사·자동 지급은 여전히 이번 범위 밖이다(보험업법 인가 문제 —
// 지시서 §2.1 참고). PDV 기록도 감사 이중화 차원에서 그대로 유지한다.
async function submitClaim() {
  var type = document.getElementById('claimType').value;
  var amtRaw = document.getElementById('claimAmt').value;
  var note = (document.getElementById('claimDesc') || {}).value || '';
  if (!type) { alert('보험 종류를 선택해 주세요.'); return; }
  var amt = Number(amtRaw);
  if (!(amt > 0)) { alert('청구 금액을 입력해 주세요.'); return; }

  var wallet = window.gopangWallet;
  var user = window._insUser;
  if (!wallet || typeof wallet.signPayload !== 'function' || !wallet.guid) {
    alert('지갑이 초기화되지 않았습니다. 로그인 상태를 확인한 뒤 다시 시도해 주세요.');
    return;
  }

  var submitBtn = document.getElementById('claimSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;

  var claimId = null;
  var errorDetail = '';

  try {
    var ts = String(Date.now());
    var sigMsg = 'ins-claim:' + wallet.guid + ':' + wallet.publicKeyB64u + ':' + ts;
    var signature = await wallet.signPayload(sigMsg);

    var res = await fetch(CLAIM_PROXY_BASE + '/biz/ins-claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_guid: wallet.guid, insurance_type: type, amount: amt, note: note,
        pubkey: wallet.publicKeyB64u, signature: signature, ts: ts,
      }),
    });
    var data = await res.json().catch(function () { return {}; });
    if (res.ok && data.ok) {
      claimId = data.claim_id;
    } else {
      errorDetail = data.detail || data.error || ('HTTP ' + res.status);
    }
  } catch (e) {
    errorDetail = e.message;
  }

  // 감사 이중화 — PDV에도 남긴다(기존 1차 재작성분 유지, 실패해도 무방).
  if (claimId && user && user.ipv6) {
    try {
      var now = new Date().toISOString();
      await fetch(CLAIM_PROXY_BASE + '/pdv/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: {
          svc: 'kinsurance', type: 'transaction',
          who: { ipv6: user.ipv6, role: 'user', level: user.level || 'L0', recipients: ['gopang-pdv'] },
          when: { period_start: now, period_end: now },
          where: { svc_url: 'https://insurance.hondi.net/my_insurance.html' },
          what: { summary: 'K-Insurance 청구 접수: ' + type + ' ₮' + amt, claim_id: claimId },
          how:  { method: '사용자 직접 접수 (자동 심사 미구현)' },
          why:  { goal: '보험금 청구' },
        }}),
      });
    } catch (e) {
      console.warn('[K-Insurance] PDV 보조 기록 실패(청구 자체는 정상 접수됨):', e.message);
    }
  }

  document.getElementById('claimForm').style.display   = 'none';
  document.getElementById('claimFooter').style.display = 'none';

  var msgEl = document.getElementById('claimResultMsg');
  if (claimId) {
    msgEl.innerHTML =
      '청구가 접수·기록되었습니다.<br>접수번호: <strong>' + claimId + '</strong><br>' +
      '⚠️ 자동 심사·자동 지급 기능은 아직 구축되지 않았습니다. 담당자 검토 후 별도로 안내드립니다.';
  } else {
    msgEl.innerHTML =
      '청구 접수를 기록하지 못했습니다' + (errorDetail ? ' (' + errorDetail + ')' : '') + '.<br>' +
      '잠시 후 다시 시도하시거나, 로그인 상태를 확인해 주세요.';
  }

  document.getElementById('claimResult').classList.add('visible');
  if (submitBtn) submitBtn.disabled = false;
}
