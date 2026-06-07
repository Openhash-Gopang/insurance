/* ── K-Insurance 청구 모달 ── */

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

function submitClaim() {
  var type = document.getElementById('claimType').value;
  var amt  = document.getElementById('claimAmt').value;
  if (!type) { alert('보험 종류를 선택해 주세요.'); return; }

  document.getElementById('claimForm').style.display   = 'none';
  document.getElementById('claimFooter').style.display = 'none';

  var msgEl   = document.getElementById('claimResultMsg');
  var isLarge = parseInt(amt) >= 1000000;

  if (isLarge) {
    msgEl.innerHTML = '고액 청구로 분류되었습니다.<br>Claude Opus + K-Law v15.1 심층 분석이 시작됩니다.<br>처리 시간: 최대 24시간';
  } else {
    msgEl.innerHTML = 'AI 심사가 시작되었습니다.<br>표준 청구는 <strong>0.3초</strong> 이내 처리됩니다.<br>PDV·K-Traffic·K-Health 증거가 자동 수집됩니다.';
  }

  document.getElementById('claimResult').classList.add('visible');
  setTimeout(closeClaimModal, 4000);
}
