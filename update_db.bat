@echo off
rem ====================================================================
rem [신호시스템] 엑셀 제품DB 업데이트 및 로컬 웹 화면 갱신 스크립트
rem (회사 PC / 개인 노트북 자동 감지 및 가상환경 자동 복구 기능 내장)
rem ====================================================================

chcp 65001 > nul
title [SHINHO SYSTEM] Product DB Updater

cd /d "%~dp0"

echo ====================================================================
echo  [신호시스템] 엑셀 제품DB 파싱 및 로컬 웹 화면(web\index.html) 갱신
echo ====================================================================
echo.
echo [1/3] 파이썬 가상환경(.venv) 상태 점검 중...

rem 가상환경 파이썬 파일이 없으면 복구 단계로 이동
if not exist ".venv\Scripts\python.exe" goto RECOVER_VENV

rem 가상환경 파이썬이 정상 실행되는지 및 필수 라이브러리가 있는지 점검
".venv\Scripts\python.exe" -c "import sys, pandas, openpyxl; sys.exit(0)" >nul 2>&1
if errorlevel 1 goto RECOVER_VENV

echo  - 가상환경(.venv) 정상 작동 확인 완료!
goto RUN_SCRIPT

:RECOVER_VENV
echo.
echo --------------------------------------------------------------------
echo  [알림] 가상환경이 없거나 다른 PC 환경의 영향으로 손상되었습니다.
echo         현재 컴퓨터에 맞게 가상환경(.venv)을 자동 복구합니다...
echo --------------------------------------------------------------------
echo.

if exist ".venv" (
    echo  - 기존 손상된 .venv 폴더 정리 중...
    rmdir /s /q .venv >nul 2>&1
)

python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [오류] 시스템에 파이썬이 설치되어 있지 않거나 PATH에 없습니다.
    echo        파이썬을 설치하거나 환경변수를 확인해 주세요.
    echo.
    pause
    exit /b 1
)

echo  - 새로운 가상환경(.venv) 생성 중...
python -m venv .venv
if errorlevel 1 (
    echo [오류] 가상환경 생성 실패
    pause
    exit /b 1
)

echo  - 필수 라이브러리(pandas, openpyxl) 설치 중...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo [오류] 필수 라이브러리 설치 실패
    pause
    exit /b 1
)

echo.
echo  [복구 완료] 현재 PC에 맞는 가상환경 세팅이 완료되었습니다!
echo.

:RUN_SCRIPT
echo.
echo [2/3] 엑셀 원본(제품DB.xlsx) 파싱 및 웹 데이터 생성 중...
".venv\Scripts\python.exe" data_extractor.py
if errorlevel 1 (
    echo.
    echo [오류] 데이터 추출 중 오류가 발생했습니다.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] 로컬 웹 화면(web\index.html) 브라우저 열기...
start "" "web\index.html"

echo.
echo ====================================================================
echo  [빌드 완료] web\product_data.js 및 index.html 에 최신 데이터가 반영되었습니다!
echo.
echo  브라우저에서 변경된 가격과 검색 기능을 확인하신 후,
echo  원하실 때 깃허브(GitHub)로 직접 커밋 및 푸시하시면 됩니다.
echo ====================================================================
echo.
pause
