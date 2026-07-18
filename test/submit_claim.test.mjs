import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

// submitClaim()이 이전엔 어떤 백엔드 호출도 없이 "AI 심사 시작, 0.3초 내
// 처리" 같은 문구만 setTimeout으로 보여주는 UI 연출이었다. 이번 수정으로
// (1) 실제 PDV 기록 시도를 하는지 (2) 더 이상 존재하지 않는 자동심사
// 기능을 있는 것처럼 광고하지 않는지 검증한다.

function buildDom() {
  return new JSDOM(`<!doctype html><body>
    <div id="claimOverlay"><div></div></div>
    <div id="claimForm" style="display:block"></div>
    <div id="claimFooter" style="display:block"></div>
    <div id="claimResult"><div id="claimResultMsg"></div></div>
    <select id="claimType"><option value="health" selected>health</option></select>
    <input id="claimAmt" value="50000">
    <button id="claimSubmitBtn"></button>
  </body>`, { runScripts: 'outside-only', url: 'https://insurance.hondi.net/my_insurance.html' });
}

describe('kinsurance-claim.js submitClaim() — 정직한 청구 접수로 수정 확인', () => {
  let dom, requests;

  function setup(user, fetchOk = true) {
    requests = [];
    dom = buildDom();
    dom.window._insUser = user;
    dom.window.fetch = async (url, opts) => {
      requests.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
      return { ok: fetchOk };
    };
    const code = fs.readFileSync(new URL('../src/ins/kinsurance-claim.js', import.meta.url), 'utf-8');
    dom.window.eval(code);
  }

  after(() => { dom?.window.close(); });

  test('취약점 수정 확인: 존재하지 않는 자동심사(0.3초/24시간/Claude Opus)를 더 이상 광고하지 않는다', () => {
    const code = fs.readFileSync(new URL('../src/ins/kinsurance-claim.js', import.meta.url), 'utf-8');
    // 실제 msgEl.innerHTML에 대입되는 코드만 검사한다 — 위쪽 설명 주석에는
    // 옛 문구가 (무엇을 고쳤는지 설명하려고) 그대로 남아있을 수 있음.
    const liveCode = code.split(/^async function submitClaim/m)[1] || '';
    assert.equal(/0\.3초/.test(liveCode), false);
    assert.equal(/Claude Opus/.test(liveCode), false);
    assert.equal(/최대 24시간/.test(liveCode), false);
  });

  test('로그인 상태면 실제로 PDV에 청구 기록을 남긴다(이전엔 백엔드 호출 자체가 없었음)', async () => {
    setup({ ipv6: 'test-guid', level: 'L1' });
    await dom.window.submitClaim();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://hondi-proxy.tensor-city.workers.dev/pdv/report');
    assert.equal(requests[0].body.report.who.ipv6, 'test-guid');
    assert.match(requests[0].body.report.what.summary, /health/);
  });

  test('기록 성공 시 접수번호를 포함한 정직한 메시지를 보여준다(자동심사 완료 문구 아님)', async () => {
    setup({ ipv6: 'test-guid', level: 'L1' });
    await dom.window.submitClaim();
    const msg = dom.window.document.getElementById('claimResultMsg').innerHTML;
    assert.match(msg, /접수·기록되었습니다/);
    assert.match(msg, /claim_/);
    assert.match(msg, /자동 심사·자동 지급 기능은 아직 구축되지 않았습니다/);
  });

  test('비로그인 상태면 PDV 호출을 시도하지 않고, 실패했다고 정직하게 알린다', async () => {
    setup(null);
    await dom.window.submitClaim();
    assert.equal(requests.length, 0);
    const msg = dom.window.document.getElementById('claimResultMsg').innerHTML;
    assert.match(msg, /기록하지 못했습니다/);
  });

  test('기록 fetch 자체가 실패(네트워크 오류)해도 정직하게 실패를 알린다(성공한 것처럼 꾸미지 않음)', async () => {
    setup({ ipv6: 'test-guid', level: 'L1' }, false);
    await dom.window.submitClaim();
    const msg = dom.window.document.getElementById('claimResultMsg').innerHTML;
    assert.match(msg, /기록하지 못했습니다/);
  });

  test('보험 종류 미선택이면 백엔드 호출 없이 즉시 alert만 뜬다', async () => {
    setup({ ipv6: 'test-guid', level: 'L1' });
    dom.window.document.getElementById('claimType').value = '';
    let alerted = false;
    dom.window.alert = () => { alerted = true; };
    await dom.window.submitClaim();
    assert.equal(alerted, true);
    assert.equal(requests.length, 0);
  });
});
