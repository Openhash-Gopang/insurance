/**
 * ins-proxy.js — K-Insurance Cloudflare Worker v1.0
 * 외부 데이터 프록시 + CORS 처리
 * 배포: Cloudflare Workers (insurance.gopang.net/api/*)
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://insurance.gopang.net',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ── 라우팅 ──
    try {
      if (url.pathname === '/api/risk-data') {
        return await getRiskData(request, env, corsHeaders);
      }
      if (url.pathname === '/api/openhash-anchor') {
        return await anchorToOpenHash(request, env, corsHeaders);
      }
      if (url.pathname === '/api/ai-review') {
        return await callAiReview(request, env, corsHeaders);
      }
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};

// ──────────────────────────────────────────
// 외부 리스크 데이터 프록시
// (날씨·교통량·지역 사고 통계 등)
// ──────────────────────────────────────────
async function getRiskData(request, env, corsHeaders) {
  const { region } = await request.json();

  // 지역 사고 통계 (외부 공공 API)
  const statsRes = await fetch(
    `https://data.go.kr/api/accident-stats?region=${encodeURIComponent(region)}&key=${env.PUBLIC_DATA_KEY}`
  );
  const stats = await statsRes.json();

  return new Response(JSON.stringify(stats), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ──────────────────────────────────────────
// OpenHash 앵커링 프록시
// ──────────────────────────────────────────
async function anchorToOpenHash(request, env, corsHeaders) {
  const body = await request.json();

  const res = await fetch('https://openhash.gopang.net/anchor', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gopang-Node': env.OPENHASH_NODE_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ──────────────────────────────────────────
// AI 심사 API 프록시 (API Key 보안)
// ──────────────────────────────────────────
async function callAiReview(request, env, corsHeaders) {
  const { model, prompt, claimNo } = await request.json();

  let result;

  if (model === 'deepseek') {
    // DeepSeek V4 Pro (표준 청구)
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
      }),
    });
    const data = await res.json();
    result = data.choices?.[0]?.message?.content;

  } else if (model === 'claude-opus') {
    // Claude Opus (고액·분쟁 청구, 강제규칙 5)
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await res.json();
    result = data.content?.[0]?.text;
  }

  // 감사 로그
  console.log(`[ins-proxy] AI 심사: model=${model}, claimNo=${claimNo}`);

  return new Response(JSON.stringify({ result }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
