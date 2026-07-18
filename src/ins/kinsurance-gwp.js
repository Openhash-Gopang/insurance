/* ── K-Insurance GWP 파라미터 파싱 + SSO 콜백 ────────────────────
 * 수정 이력
 *   v1.0  최초 작성 — ctx_enc=b64 분기 없음
 *   v1.1  [FIX-4] ctx_enc=b64 시 atob() 디코딩 분기 추가 (매뉴얼 §6-4)
 * ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */

/* [FIX-4] 매뉴얼 §6-4 표준 ctx 파싱 패턴 */
var _params     = new URLSearchParams(location.search);
var _isGwp      = _params.get('gwp') === '1';
var _gwpOrigin  = _params.get('origin') || 'https://hondi.net';
var _gwpContext = null;

try {
  var _ctxRaw = _params.get('ctx') || '';
  var _ctxEnc = _params.get('ctx_enc');
  if (_ctxRaw) {
    /* [FIX-4] b64 인코딩 분기 — 매뉴얼 §6-4 */
    _gwpContext = (_ctxEnc === 'b64')
      ? decodeURIComponent(escape(atob(_ctxRaw)))
      : decodeURIComponent(_ctxRaw);
  }
} catch (e) {
  console.warn('[GWP] ctx 파싱 실패:', e.message);
}

/* SSO 인증 완료 콜백 — subsystem-auth.js가 호출 */
window._onGopangAuth = function (user) {
  if (!user) return;

  // 2026-07-18: submitClaim()이 실제 청구 기록을 남기려면 인증된 사용자
  // 정보가 필요한데, 이전엔 여기서 DOM 렌더링에만 쓰고 버려졌다 —
  // 전역에 보존한다.
  window._insUser = user;

  /* 앱 표시 + 스피너 제거 */
  document.getElementById('auth-loading').style.display = 'none';
  document.getElementById('app').style.display          = 'block';

  /* 사용자 정보 렌더링 (ipv6 기반) */
  var nameEl = document.getElementById('userName');
  var guidEl = document.getElementById('userGuid');
  var initEl = document.getElementById('userInitial');
  var badge  = document.getElementById('auth-badge');

  var displayName = user.name || ('사용자 ' + (user.ipv6 || '').slice(0, 8));
  if (nameEl) nameEl.textContent = displayName;
  if (guidEl) guidEl.textContent = 'IPv6: ' + (user.ipv6 || '').slice(0, 20) + '…';
  if (initEl) initEl.textContent = (user.name || 'K')[0].toUpperCase();

  /* 인증 레벨 배지 */
  if (badge) {
    var lvlColor = { L0: 'var(--t3)', L1: '#00bcd4', L2: 'var(--brand)', L3: '#ff9800' };
    badge.style.color = lvlColor[user.level] || lvlColor.L0;
    badge.textContent = user.level || 'L0';
    badge.title       = user.ipv6  || '';
  }

  /* 상단바 서브타이틀 업데이트 */
  var subEl = document.getElementById('navSub');
  if (subEl && user.level && user.level !== 'L0') {
    subEl.textContent = 'K-Insurance · ' + user.level + ' 인증 완료';
  }

  /* GWP: ctx가 있으면 자동으로 청구 모달 열기 */
  if (_gwpContext) {
    setTimeout(function () { openClaimModal(); }, 400);
  }

  /* URL 정리 */
  var clean = new URL(location.href);
  ['gwp', 'gwp_token', 'ctx', 'ctx_enc', 'origin'].forEach(function (k) {
    clean.searchParams.delete(k);
  });
  history.replaceState({}, '', clean.toString());
};
