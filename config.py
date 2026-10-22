# -*- coding: utf-8 -*-
r"""
[홈페이지 공개용 제품사양검색 설정 모듈 - config.py]
역할:
1. 현재 폴더(product_spec_hp)에 제품DB.xlsx가 있으면 최우선 참조, 없으면 D:\erp_database\00_기본 원본 엑셀 참조
2. 품목등록 시트가 제품DB.xlsx 내부로 통합되었으므로 제품DB.xlsx 하나만 참조합니다.
3. 홈페이지용(product_spec_hp/web) 전용 빌드 경로를 관리합니다.
"""

import sys
from pathlib import Path

# Windows 콘솔(CMD/PowerShell) 한글 cp949 환경에서 이모지/특수문자 인코딩 에러 방지
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# 현재 파일이 위치한 디렉토리 (프로젝트 루트 디렉토리)
APP_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = APP_DIR.parent.parent

# 1. 엑셀 파일 우선순위 탐색
# 1순위: 현재 폴더(product_spec_hp)에 직접 넣어둔 제품DB.xlsx
CURRENT_PROD_DB = APP_DIR / "제품DB.xlsx"

# 2순위: D:\erp_database\00_기본\제품DB.xlsx
NAS_BASIC_DIR = Path(r"D:\erp_database\00_기본")
# 3순위: 프로젝트 내 로컬 백업 폴더
LOCAL_BASIC_DIR = PROJECT_ROOT / "02_Ecount_Backup" / "00_기본"

if CURRENT_PROD_DB.exists():
    PRODUCT_DB_FILE = CURRENT_PROD_DB
    print(f"[폴더] [홈페이지 빌더] 현재 작업 폴더({APP_DIR}) 내 제품DB.xlsx 참조")
elif (NAS_BASIC_DIR / "제품DB.xlsx").exists():
    PRODUCT_DB_FILE = NAS_BASIC_DIR / "제품DB.xlsx"
    print(f"[NAS] [홈페이지 빌더] 시놀로지 NAS({NAS_BASIC_DIR}) 원본 제품DB.xlsx 참조")
else:
    PRODUCT_DB_FILE = LOCAL_BASIC_DIR / "제품DB.xlsx"
    print(f"[백업] [홈페이지 빌더] 로컬 백업({LOCAL_BASIC_DIR}) 제품DB.xlsx 참조")

# 하위 호환성을 위한 참조 (품목등록 시트도 제품DB.xlsx 안에 포함됨)
ITEM_REG_FILE = PRODUCT_DB_FILE

# 2. 홈페이지 배포용 웹 디렉토리 설정
WEB_DIR = APP_DIR / "web"
OUTPUT_JS_FILE = WEB_DIR / "product_data.js"
OUTPUT_JSON_FILE = WEB_DIR / "product_data.json"
