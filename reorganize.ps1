# ================================================================
# K-Insurance 저장소 디렉토리 정리 스크립트
# 기준: GOPANG-WEBAPP-SPEC-v3.1 §2 파일 구조 규칙
#
# 실행 방법:
#   cd C:\Users\주피터\Downloads\insurance
#   .\reorganize.ps1
# ================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Get-Location

Write-Host ""
Write-Host "K-Insurance 디렉토리 정리" -ForegroundColor Cyan
Write-Host ("=" * 48) -ForegroundColor Cyan
Write-Host "작업 경로: $root"
Write-Host ""

# ── STEP 1. src\ins\ 폴더 생성 ──────────────────────────────
$srcIns = Join-Path $root "src\ins"
if (-not (Test-Path $srcIns)) {
    New-Item -ItemType Directory -Path $srcIns | Out-Null
    Write-Host "[생성] src\ins\" -ForegroundColor Green
} else {
    Write-Host "[확인] src\ins\ 이미 존재" -ForegroundColor DarkGray
}

# ── STEP 2. files\kinsurance-*.js → src\ins\ ────────────────
Write-Host ""
Write-Host "[ JS 모듈 이동: files\ → src\ins\ ]" -ForegroundColor White
$jsFiles = @(
    "kinsurance-gwp.js",
    "kinsurance-sidebar.js",
    "kinsurance-claim.js",
    "kinsurance-chat.js"
)
foreach ($f in $jsFiles) {
    $src  = Join-Path $root "files\$f"
    $dest = Join-Path $root "src\ins\$f"
    if (Test-Path $src) {
        Move-Item -Path $src -Destination $dest -Force
        Write-Host "  [이동] files\$f  →  src\ins\$f" -ForegroundColor Yellow
    } else {
        Write-Host "  [없음] files\$f — 건너뜀" -ForegroundColor DarkGray
    }
}

# ── STEP 3. files\kinsurance-style.css → 루트 ───────────────
Write-Host ""
Write-Host "[ CSS 이동: files\ → 루트 ]" -ForegroundColor White
$cssSrc  = Join-Path $root "files\kinsurance-style.css"
$cssDest = Join-Path $root "kinsurance-style.css"
if (Test-Path $cssSrc) {
    Move-Item -Path $cssSrc -Destination $cssDest -Force
    Write-Host "  [이동] files\kinsurance-style.css  →  kinsurance-style.css" -ForegroundColor Yellow
} else {
    Write-Host "  [없음] files\kinsurance-style.css — 건너뜀" -ForegroundColor DarkGray
}

# ── STEP 4. files\webapp.html → 루트 덮어쓰기 ───────────────
Write-Host ""
Write-Host "[ webapp.html 교체: files\ → 루트 덮어쓰기 ]" -ForegroundColor White
$htmlSrc  = Join-Path $root "files\webapp.html"
$htmlDest = Join-Path $root "webapp.html"
if (Test-Path $htmlSrc) {
    if (Test-Path $htmlDest) {
        $backup = Join-Path $root "webapp.html.bak"
        Copy-Item -Path $htmlDest -Destination $backup -Force
        Write-Host "  [백업] 기존 webapp.html  →  webapp.html.bak" -ForegroundColor DarkGray
    }
    Move-Item -Path $htmlSrc -Destination $htmlDest -Force
    Write-Host "  [덮어쓰기] files\webapp.html  →  webapp.html" -ForegroundColor Yellow
} else {
    Write-Host "  [없음] files\webapp.html — 건너뜀" -ForegroundColor DarkGray
}

# ── STEP 5. files\ 폴더 삭제 ────────────────────────────────
Write-Host ""
Write-Host "[ files\ 폴더 정리 ]" -ForegroundColor White
$filesDir  = Join-Path $root "files"
$remaining = @(Get-ChildItem -Path $filesDir -ErrorAction SilentlyContinue)
if ($remaining.Count -eq 0) {
    Remove-Item -Path $filesDir -Force
    Write-Host "  [삭제] files\ 폴더 제거" -ForegroundColor Red
} else {
    Write-Host "  [경고] files\ 에 잔여 파일 있어 폴더 유지:" -ForegroundColor Red
    $remaining | ForEach-Object { Write-Host "          $($_.Name)" -ForegroundColor Red }
}

# ── STEP 6. 결과 검증 ────────────────────────────────────────
Write-Host ""
Write-Host "[ 경로 검증: webapp.html → src\ins\ 참조 확인 ]" -ForegroundColor White
$webappContent = Get-Content (Join-Path $root "webapp.html") -Raw
$expectedPaths = @(
    "/kinsurance-style.css",
    "/src/ins/kinsurance-gwp.js",
    "/src/ins/kinsurance-sidebar.js",
    "/src/ins/kinsurance-claim.js",
    "/src/ins/kinsurance-chat.js"
)
foreach ($p in $expectedPaths) {
    if ($webappContent -match [regex]::Escape($p)) {
        Write-Host "  [OK] $p" -ForegroundColor Green
    } else {
        Write-Host "  [누락] $p" -ForegroundColor Red
    }
}

# ── STEP 7. 최종 구조 출력 ───────────────────────────────────
Write-Host ""
Write-Host ("=" * 48) -ForegroundColor Cyan
Write-Host "최종 디렉토리 구조" -ForegroundColor Cyan
Write-Host ("=" * 48) -ForegroundColor Cyan

$checkList = [ordered]@{
    "webapp.html"                       = "루트 진입점 (매뉴얼 준수 버전)"
    "webapp.html.bak"                   = "기존 파일 백업"
    "kinsurance-style.css"              = "K-Insurance 디자인 시스템"
    "desktop.html"                      = "서비스 소개 페이지"
    "index.html"                        = "랜딩 페이지"
    "src\ins\kinsurance-gwp.js"         = "GWP 파라미터 파싱 + SSO 콜백"
    "src\ins\kinsurance-sidebar.js"     = "사이드바 초기화"
    "src\ins\kinsurance-claim.js"       = "청구 모달 로직"
    "src\ins\kinsurance-chat.js"        = "AI 채팅 + SP 동적 로드"
    "js\ins-auto.js"                    = "기존 자동 보험 로직 (유지)"
    "js\ins-claim.js"                   = "기존 청구 처리 (유지)"
    "js\ins-core.js"                    = "기존 코어 (유지)"
    "js\ins-premium.js"                 = "기존 보험료 계산 (유지)"
    "js\ins-risk.js"                    = "기존 리스크 분석 (유지)"
    "js\report.js"                      = "기존 리포트 (유지)"
    "api\ins-proxy.js"                  = "API 프록시 (유지)"
    "prompts\SP-INS_agent_v2.0.txt"     = "최신 SP (동적 로드 대상)"
    "prompts\SP-INS_agent_v1.0.txt"     = "이전 SP (보관)"
    "prompts\SP-KINSURANCE-v1_0.txt"    = "SP 초안 (보관)"
}

foreach ($entry in $checkList.GetEnumerator()) {
    $fullPath = Join-Path $root $entry.Key
    $exists   = Test-Path $fullPath
    $icon     = if ($exists) { "[OK]" } else { "[--]" }
    $color    = if ($exists) { "White" } else { "DarkGray" }
    Write-Host ("  {0,-5} {1,-42} {2}" -f $icon, $entry.Key, $entry.Value) -ForegroundColor $color
}

Write-Host ""
Write-Host "완료." -ForegroundColor Green
Write-Host ""
