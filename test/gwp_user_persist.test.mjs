import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

describe('kinsurance-gwp.js — 인증된 사용자 정보 보존 확인', () => {
  let dom;

  before(() => {
    dom = new JSDOM(`<!doctype html><body>
      <div id="auth-loading" style="display:block"></div>
      <div id="app" style="display:none"></div>
      <span id="userName"></span><span id="userGuid"></span>
      <span id="userInitial"></span><span id="auth-badge"></span>
      <span id="navSub"></span>
    </body>`, { runScripts: 'outside-only', url: 'https://insurance.hondi.net/my_insurance.html' });
    const code = fs.readFileSync(new URL('../src/ins/kinsurance-gwp.js', import.meta.url), 'utf-8');
    dom.window.eval(code);
  });

  after(() => { dom.window.close(); });

  test('취약점 수정 확인: _onGopangAuth 이후 window._insUser에 실제 사용자 정보가 남는다(이전엔 DOM 렌더링 후 버려졌음)', () => {
    assert.equal(dom.window._insUser, undefined);
    dom.window._onGopangAuth({ ipv6: 'test-guid-abc', level: 'L1', name: '테스트' });
    assert.ok(dom.window._insUser);
    assert.equal(dom.window._insUser.ipv6, 'test-guid-abc');
    assert.equal(dom.window._insUser.level, 'L1');
  });
});
