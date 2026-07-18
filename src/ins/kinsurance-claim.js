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

// 2026-07-18 전면 재작성 — 이전 버전은 백엔드 호출이 전혀 없이
// "AI 심사가 시작되었습니다, 0.3초 이내 처리됩니다", "Claude Opus +
// K-Law v15.1 심층 분석 시작, 최대 24시간" 같은 문구만 setTimeout으로
// 보여주는 UI 연출이었다 — 실제로는 청구가 어디에도 기록되지 않았고,
// 심사도 지급도 전혀 일어나지 않았다(이전 세션 K-Insurance 리포트
// 참고: js/ins-claim.js 등 실제 심사·사기탐지 로직은 전부 미배선
// 죽은 코드 상태).
//
// 자동 심사·자동 지급 기능은 아직 없다는 걸 사용자에게 정확히 알리고,
// 최소한 "청구가 실제로 접수·기록됐다"는 것만큼은 사실이 되도록
// PDV(고팡 표준 감사 기록 경로)에 실제로 남긴다. 백엔드 심사 파이프라인
// 자체를 새로 만드는 건 이번 수정 범위 밖이다(별도 설계 필요).
async function submitClaim() {
  var type = document.getElementById('claimType').value;
  var amt  = document.getElementById('claimAmt').value;
  if (!type) { alert('보험 종류를 선택해 주세요.'); return; }

  var submitBtn = document.getElementById('claimSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;

  var user = window._insUser;
  var claimId = 'claim_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  var recorded = false;

  if (user && user.ipv6) {
    try {
      var now = new Date().toISOString();
      var res = await fetch(CLAIM_PROXY_BASE + '/pdv/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: {
          svc: 'kinsurance', type: 'transaction',
          who: { ipv6: user.ipv6, role: 'user', level: user.level || 'L0', recipients: ['gopang-pdv'] },
          when: { period_start: now, period_end: now },
          where: { svc_url: 'https://insurance.hondi.net/my_insurance.html' },
          what: { summary: 'K-Insurance 청구 접수: ' + type + ' ₮' + (amt || '0'), claim_id: claimId },
          how:  { method: '사용자 직접 접수 (자동 심사 미구현)' },
          why:  { goal: '보험금 청구' },
        }}),
      });
      recorded = res.ok;
    } catch (e) {
      console.warn('[K-Insurance] 청구 기록 실패:', e.message);
    }
  }

  document.getElementById('claimForm').style.display   = 'none';
  document.getElementById('claimFooter').style.display = 'none';

  var msgEl = document.getElementById('claimResultMsg');
  if (recorded) {
    msgEl.innerHTML =
      '청구가 접수·기록되었습니다.<br>접수번호: <strong>' + claimId + '</strong><br>' +
      '⚠️ 자동 심사·자동 지급 기능은 아직 구축되지 않았습니다. 담당자 검토 후 별도로 안내드립니다.';
  } else {
    msgEl.innerHTML =
      '청구 접수를 기록하지 못했습니다(네트워크 오류 또는 로그인 필요).<br>' +
      '잠시 후 다시 시도하시거나, 로그인 상태를 확인해 주세요.';
  }

  document.getElementById('claimResult').classList.add('visible');
  if (submitBtn) submitBtn.disabled = false;
}
