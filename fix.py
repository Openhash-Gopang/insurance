#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix.py — insurance 저장소 전용.

갭: my_insurance.html이 로드하는 src/ins/kinsurance-chat.js의 sendChat()이
/deepseek 호출 시 service_id를 안 보낸다. webapp.html/desktop.html은 이미
2026-07-05에 service_id:'kinsurance'로 패치됐는데, my_insurance.html은
별도 구현이라 빠졌다(실사로 확인).

조치: src/ins/kinsurance-chat.js의 /deepseek 호출 body에
service_id: 'kinsurance' 한 줄 추가. worker.js의 callDeepSeek()가 이미 이
값을 보고 UNIVERSAL-INTEGRITY/UNIVERSAL-common을 강제 주입한다
(2026-07-05 신설, 별도 서버 변경 불필요).

실행 위치: insurance 저장소 루트에서 실행.
src/ins/kinsurance-chat.js가 그 자리에 있어야 한다.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TARGET = ROOT / "src" / "ins" / "kinsurance-chat.js"

OLD = """    var res = await fetch(PROXY_BASE + '/deepseek', {
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
    });"""

NEW = """    var res = await fetch(PROXY_BASE + '/deepseek', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:        'deepseek-v4-pro',
        service_id:   'kinsurance', // 2026-07-07: worker.js가 UNIVERSAL-INTEGRITY/UNIVERSAL-common 강제 주입
        system:       sp,
        messages:     chatHistory.slice(-12),
        max_tokens:   800,
        temperature:  0.6,
        _use_env_key: 'DEEPSEEK_API_KEY',
      }),
    });"""


def main():
    if not TARGET.exists():
        print(f"[FAIL] 대상 파일 없음: {TARGET}")
        sys.exit(1)

    text = TARGET.read_text(encoding="utf-8")

    if NEW in text:
        print("[FAIL] 이미 패치된 것으로 보임(중복 실행 의심) — 변경 없이 종료")
        sys.exit(1)

    if OLD not in text:
        print("[FAIL] 삽입 지점(anchor)을 찾지 못함 — 원본이 변경된 것으로 보임. "
              "수동 확인 필요.")
        sys.exit(1)

    if text.count(OLD) != 1:
        print(f"[FAIL] anchor가 {text.count(OLD)}번 발견됨(1번이어야 함) — 수동 확인 필요.")
        sys.exit(1)

    text = text.replace(OLD, NEW, 1)
    TARGET.write_text(text, encoding="utf-8")

    check = TARGET.read_text(encoding="utf-8")
    if "service_id:   'kinsurance'" not in check:
        print("[FAIL] 검증 실패 — 파일은 써졌으나 내용이 기대와 다름.")
        sys.exit(1)

    print("[OK] src/ins/kinsurance-chat.js — service_id: 'kinsurance' 추가 완료")
    print("[OK] 검증 통과")


if __name__ == "__main__":
    main()
