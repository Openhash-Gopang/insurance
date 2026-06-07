/* ── K-Insurance AI 채팅 ──────────────────────────────────────────
 * 수정 이력
 *   v1.0  최초 작성 — SP 로컬 상대경로, 캐시 버스터 없음
 *   v1.1  [FIX-1] SP URL → GitHub raw URL 변경        (매뉴얼 §10)
 *         [FIX-2] ?t=Date.now() 캐시 버스터 추가       (매뉴얼 §10)
 *         [FIX-3] CFG 객체 세션 캐시 패턴 적용         (매뉴얼 §5·§10)
 * ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── */

/* [FIX-3] CFG 객체 — 매뉴얼 §10 표준 패턴 */
const CFG = {
  /* [FIX-1] GitHub raw URL로 변경 (매뉴얼 §10) */
  systemPromptURL: 'https://raw.githubusercontent.com/Openhash-Gopang/insurance/main/prompts/SP-INS_agent_v2.0.txt',
  systemPrompt: null,       /* 런타임에 loadSystemPrompt()가 채움 */
  systemPromptFallback: '당신은 K-Insurance AI 보험 상담사입니다. PDV·K-Traffic·K-Health 데이터를 기반으로 보험 가입·청구·보험금에 관해 간결하고 정확하게 답변하세요.',
};

const PROXY_BASE  = 'https://gopang-proxy.tensor-city.workers.dev';
const chatHistory = [];

/* [FIX-2] [FIX-3] 매뉴얼 §10 표준 loadSystemPrompt 패턴 */
async function loadSystemPrompt() {
  if (CFG.systemPrompt) return CFG.systemPrompt;   /* 세션 캐시 */
  try {
    /* [FIX-2] ?t=Date.now() 캐시 버스터 */
    const r = await fetch(CFG.systemPromptURL + '?t=' + Date.now());
    if (r.ok) {
      const raw = await r.text();
      /* '#' 주석 행 제거 */
      CFG.systemPrompt = raw.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n').trim();
      return CFG.systemPrompt;
    }
    throw new Error('HTTP ' + r.status);
  } catch (e) {
    console.warn('[SP] 로드 실패:', e.message);
    CFG.systemPrompt = CFG.systemPromptFallback;
    return CFG.systemPrompt;
  }
}

/* 채팅 모달 열기/닫기 */
function openChat() {
  document.getElementById('chatOverlay').classList.add('open');
  document.getElementById('chatInput').focus();
}

function closeChat() {
  document.getElementById('chatOverlay').classList.remove('open');
}

document.getElementById('chatOverlay').addEventListener('click', function (e) {
  if (e.target === this) closeChat();
});

/* 메시지 DOM 추가 */
function appendMsg(role, text) {
  var box = document.getElementById('chatMessages');
  var div = document.createElement('div');
  div.className = 'chat-msg ' + (role === 'user' ? 'user' : 'ai');
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

/* 메시지 전송 */
async function sendChat() {
  var input = document.getElementById('chatInput');
  var btn   = document.getElementById('chatSendBtn');
  var text  = input.value.trim();
  if (!text) return;

  input.value        = '';
  input.style.height = '';
  btn.disabled       = true;

  appendMsg('user', text);
  chatHistory.push({ role: 'user', content: text });

  var typingDiv = appendMsg('ai', '…');
  typingDiv.classList.add('typing');

  try {
    const sp  = await loadSystemPrompt();
    var res = await fetch(PROXY_BASE + '/deepseek', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:        'deepseek-v4-pro',
        system:       sp,
        messages:     chatHistory.slice(-12),
        max_tokens:   800,
        temperature:  0.6,
        _use_env_key: 'DEEPSEEK_API_KEY',
      }),
    });
    var data  = await res.json();
    var reply = data?.choices?.[0]?.message?.content
             || data?.content?.[0]?.text
             || '죄송합니다, 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.';

    typingDiv.classList.remove('typing');
    typingDiv.textContent = reply;
    chatHistory.push({ role: 'assistant', content: reply });
  } catch (err) {
    typingDiv.classList.remove('typing');
    typingDiv.textContent = '네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

/* 입력창 자동 높이 조정 */
document.getElementById('chatInput').addEventListener('input', function () {
  this.style.height = '';
  this.style.height = Math.min(this.scrollHeight, 100) + 'px';
});
