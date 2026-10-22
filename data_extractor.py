# -*- coding: utf-8 -*-
"""
[홈페이지 공개용 제품사양 데이터 정제 및 추출 파이프라인 - data_extractor.py]

사용자 요구사항 반영:
1. 제품목록의 기본소비자가격은 오직 [품목등록] 시트에서만 가져옵니다. (Catalog의 소비자가 열 무시)
2. CodeSelect 사양열의 순서 그대로 선택할 수 있도록 code_steps 리스트를 구성합니다.
   (예: SHN-ISO의 경우 INPUT -> OUT1 -> OUT2 -> '-' -> POWER 순서 보존)
3. 사양/코드/내용이 '-'인 행은 구분 기호(delimiter)로서 주문 코드에 삽입되도록 처리합니다.
4. 최종 소비자가격은 조합된 주문 코드와 [품목등록] 시트의 품목코드를 일치시켜 정확한 소비자가격을 실시간 조회합니다.
5. [보안] 주대리점가, 최소판매가 및 OEM/ODM 품목 데이터는 원천 배제합니다.
"""

import os
import re
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Dict, List, Any, Optional

import sys

# Windows 콘솔(CMD/PowerShell) 한글 cp949 환경에서 특수문자/이모지 인코딩 에러 방지
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

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

from config import (
    PRODUCT_DB_FILE,
    WEB_DIR,
    OUTPUT_JS_FILE,
    OUTPUT_JSON_FILE
)


def safe_number(val: Any, default: float = 0.0) -> float:
    """문자열 숫자를 안전하게 float으로 변환하는 함수"""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip()
    if not s or s == "-" or s.lower() in ["nan", "none"]:
        return default
    clean = re.sub(r"[^\d\.\-\+eE]", "", s)
    try:
        return float(clean)
    except Exception:
        return default


def parse_xlsx_all_sheets(xlsx_path: Path) -> Dict[str, List[List[str]]]:
    """순수 Python 표준 라이브러리로 xlsx 모든 시트를 고속 파싱"""
    if not xlsx_path.exists():
        raise FileNotFoundError(f"파일을 찾을 수 없습니다: {xlsx_path}")

    ns = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    sheets_data: Dict[str, List[List[str]]] = {}

    with zipfile.ZipFile(xlsx_path, 'r') as z:
        # 1. sharedStrings 읽기
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            ss_root = ET.fromstring(z.read('xl/sharedStrings.xml'))
            for si in ss_root.findall('main:si', ns):
                t_elem = si.find('main:t', ns)
                if t_elem is not None and t_elem.text:
                    shared_strings.append(t_elem.text)
                else:
                    r_texts = [
                        r.find('main:t', ns).text
                        for r in si.findall('main:r', ns)
                        if r.find('main:t', ns) is not None and r.find('main:t', ns).text
                    ]
                    shared_strings.append("".join(r_texts))

        # 2. workbook.xml 에서 시트 목록 및 관계 id 확인
        wb_root = ET.fromstring(z.read('xl/workbook.xml'))
        rel_root = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
        rel_map = {}
        for r in rel_root.findall('{http://schemas.openxmlformats.org/package/2006/relationships}Relationship'):
            rel_map[r.attrib['Id']] = r.attrib['Target']

        def col_to_idx(col_str: str) -> int:
            idx = 0
            for char in col_str:
                idx = idx * 26 + (ord(char) - ord('A') + 1)
            return idx - 1

        for s_elem in wb_root.findall('.//main:sheet', ns):
            s_name = s_elem.get('name')
            r_id = s_elem.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            if not r_id or r_id not in rel_map:
                continue

            raw_rel = rel_map[r_id].strip().replace('\\', '/')
            clean_rel = raw_rel.lstrip('/')
            target_file = clean_rel if clean_rel.startswith('xl/') else f'xl/{clean_rel}'
            if target_file not in z.namelist():
                continue

            sheet_root = ET.fromstring(z.read(target_file))
            sheet_data = sheet_root.find('main:sheetData', ns)
            if sheet_data is None:
                sheets_data[s_name] = []
                continue

            sheet_rows = []
            for row_elem in sheet_data.findall('main:row', ns):
                cells = {}
                for c in row_elem.findall('main:c', ns):
                    r_ref = c.get('r', '')
                    col_letters = "".join(filter(str.isalpha, r_ref))
                    if not col_letters:
                        continue
                    c_idx = col_to_idx(col_letters)
                    c_type = c.get('t')
                    v_elem = c.find('main:v', ns)
                    val = ""
                    if c_type == 's' and v_elem is not None and v_elem.text:
                        s_idx = int(v_elem.text)
                        val = shared_strings[s_idx] if s_idx < len(shared_strings) else ""
                    elif c_type == 'inlineStr':
                        is_elem = c.find('main:is', ns)
                        if is_elem is not None:
                            t = is_elem.find('main:t', ns)
                            val = t.text if t is not None and t.text else ""
                    elif v_elem is not None and v_elem.text:
                        val = v_elem.text
                    cells[c_idx] = val

                if cells:
                    max_c = max(cells.keys())
                    row_list = [cells.get(i, "").strip() for i in range(max_c + 1)]
                    sheet_rows.append(row_list)

            sheets_data[s_name] = sheet_rows

    return sheets_data


def extract_homepage_product_data() -> Dict[str, Any]:
    """
    통합 제품DB.xlsx에서 제품사양 데이터 추출:
    1. Catalog: 모델 마스터, 기술스펙, 매뉴얼 링크
    2. CodeSelect: 순서 보존 및 '-' 구분기호 완벽 지원
    3. 품목등록: 기본 소비자가격 및 품목코드별 실시간 소비자가격 매핑
    4. Available_Specs: 입출력 제작 가능 범위
    """
    print(f"[파싱] [1/1] 제품DB.xlsx 전체 시트 파싱 중... ({PRODUCT_DB_FILE})")
    prod_sheets = parse_xlsx_all_sheets(PRODUCT_DB_FILE)

    # 1. Catalog 시트 파싱 (제품 마스터)
    catalog_rows = prod_sheets.get("Catalog", [])
    major_categories: List[str] = []
    sub_categories: Dict[str, List[str]] = {}
    model_categories: Dict[str, List[str]] = {}
    models_dict: Dict[str, Any] = {}

    if catalog_rows:
        cat_header = catalog_rows[0]
        h_idx = {name: i for i, name in enumerate(cat_header)}
        power_voltage_idx = h_idx.get("전원전압", -1)

        for r in catalog_rows[1:]:
            if not r or len(r) <= h_idx.get("제품명", 0):
                continue
            model_name = r[h_idx["제품명"]].strip()
            if not model_name:
                continue

            mid_name = r[h_idx["중분류"]].strip() if h_idx.get("중분류", -1) < len(r) and h_idx.get("중분류", -1) >= 0 else ""
            sub_name = r[h_idx["소분류"]].strip() if h_idx.get("소분류", -1) < len(r) and h_idx.get("소분류", -1) >= 0 else ""

            # [보안 1: OEM/ODM 원천 배제]
            check_text = f"{mid_name} {sub_name}".upper()
            if "OEM" in check_text or "ODM" in check_text:
                continue

            is_active_raw = r[h_idx["사용여부"]].strip().upper() if h_idx.get("사용여부", -1) < len(r) and h_idx.get("사용여부", -1) >= 0 else "Y"
            is_active = (is_active_raw == "Y")
            if not is_active:
                continue

            desc = r[h_idx["설명"]].strip() if h_idx.get("설명", -1) < len(r) and h_idx.get("설명", -1) >= 0 else ""
            intro = r[h_idx["제품소개"]].strip() if h_idx.get("제품소개", -1) < len(r) and h_idx.get("제품소개", -1) >= 0 else ""
            spec = r[h_idx["규격"]].strip() if h_idx.get("규격", -1) < len(r) and h_idx.get("규격", -1) >= 0 else ""
            power = r[h_idx["전원"]].strip() if h_idx.get("전원", -1) < len(r) and h_idx.get("전원", -1) >= 0 else ""
            option_str = r[h_idx["옵션"]].strip() if h_idx.get("옵션", -1) < len(r) and h_idx.get("옵션", -1) >= 0 else ""
            rep_code = r[h_idx["대표품목코드"]].strip() if h_idx.get("대표품목코드", -1) < len(r) and h_idx.get("대표품목코드", -1) >= 0 else ""
            manual_url = r[h_idx["설명서"]].strip() if h_idx.get("설명서", -1) < len(r) and h_idx.get("설명서", -1) >= 0 else ""
            catalog_url = r[h_idx["카탈로그"]].strip() if h_idx.get("카탈로그", -1) < len(r) and h_idx.get("카탈로그", -1) >= 0 else ""

            # 엑셀에 'None', '-' 등으로 기재된 무효 링크 안전 정제
            if catalog_url.lower() in ("none", "-", "nan", "null"):
                catalog_url = ""
            if manual_url.lower() in ("none", "-", "nan", "null"):
                manual_url = ""

            # 1) 중분류 등록
            if mid_name and mid_name not in major_categories:
                major_categories.append(mid_name)

            # 2) 중분류 -> 소분류
            if mid_name not in sub_categories:
                sub_categories[mid_name] = []
            if sub_name and sub_name not in sub_categories[mid_name]:
                sub_categories[mid_name].append(sub_name)

            # 3) '중분류|소분류' 복합키 -> 모델 목록
            mid_sub_key = f"{mid_name}|{sub_name}"
            if mid_sub_key not in model_categories:
                model_categories[mid_sub_key] = []
            if model_name not in model_categories[mid_sub_key]:
                model_categories[mid_sub_key].append(model_name)

            if sub_name not in model_categories:
                model_categories[sub_name] = []
            if model_name not in model_categories[sub_name]:
                model_categories[sub_name].append(model_name)

            # 4) 기술 사양 (전원전압 열부터 끝까지)
            tech_specs: Dict[str, str] = {}
            if power_voltage_idx != -1 and power_voltage_idx < len(cat_header):
                for c_i in range(power_voltage_idx, len(cat_header)):
                    col_name = cat_header[c_i].strip()
                    val = r[c_i].strip() if c_i < len(r) else ""
                    if val and val not in ("-", "—", "--", "N/A", "None", "none"):
                        tech_specs[col_name] = val

            models_dict[model_name] = {
                "name": model_name,
                "mid_name": mid_name,
                "sub_name": sub_name,
                "desc": desc,
                "intro": intro,
                "spec": spec,
                "power": power,
                "option": option_str,
                "rep_code": rep_code,
                "manual_url": manual_url,
                "catalog_url": catalog_url,
                "price_consumer": 0, # 품목등록 시트에서만 최종 결정
                "code_steps": [],     # CodeSelect 사양 순서 보존 리스트
                "specs": tech_specs
            }

    # 2. Available_Specs 시트 파싱 (제작 가능 사양 범위)
    avail_rows = prod_sheets.get("Available_Specs", [])
    if avail_rows:
        a_header = avail_rows[0]
        ah_idx = {name: i for i, name in enumerate(a_header)}
        for r in avail_rows[1:]:
            if not r or len(r) < 3:
                continue
            m_name = r[ah_idx.get("제품명", 0)].strip()
            item_type = r[ah_idx.get("항목", 1)].strip()
            unit = r[ah_idx.get("단위", 2)].strip()
            z_low = safe_number(r[ah_idx.get("zero-L", 3)] if len(r) > 3 else 0)
            z_high = safe_number(r[ah_idx.get("zero-H", 4)] if len(r) > 4 else 0)
            s_low = safe_number(r[ah_idx.get("span-L", 5)] if len(r) > 5 else 0)
            s_high = safe_number(r[ah_idx.get("span-H", 6)] if len(r) > 6 else 0)

            if m_name in models_dict:
                if "available_specs" not in models_dict[m_name]:
                    models_dict[m_name]["available_specs"] = []
                models_dict[m_name]["available_specs"].append({
                    "type": item_type,
                    "unit": unit,
                    "zero_low": z_low,
                    "zero_high": z_high,
                    "span_low": s_low,
                    "span_high": s_high
                })

    # 3. CodeSelect 시트 파싱 (★ 사양 순서 100% 보존 및 '-' 구분기호 완벽 지원)
    # 헤더: ['모델명', '사양', '코드', '내용']
    code_rows = prod_sheets.get("CodeSelect", [])
    if code_rows:
        for r in code_rows[1:]:
            if len(r) < 4:
                continue
            m_name = r[0].strip()
            spec_category = r[1].strip()  # 예: INPUT, OUT1, OUT2, '-', POWER
            code = r[2].strip()          # 예: A, B, '-', V
            desc = r[3].strip()          # 예: 1~5V, 4~20mA, '-', AC110V

            if m_name in models_dict:
                steps = models_dict[m_name]["code_steps"]

                # [요구사항 2] 사양, 코드, 내용이 '-'인 행은 구분 기호(delimiter)로서 처리!
                if spec_category == '-' or code == '-' or desc == '-':
                    # 직전 단계가 이미 구분자가 아닐 때만 구분자 단계 추가
                    if not steps or steps[-1].get("type") != "delimiter":
                        steps.append({
                            "type": "delimiter",
                            "char": "-"
                        })
                    continue

                # 일반 사양 단계인 경우: 마지막 단계가 동일한 사양 그룹인지 확인
                if steps and steps[-1].get("type") == "spec" and steps[-1].get("name") == spec_category:
                    # 기존 그룹에 옵션 추가
                    steps[-1]["options"].append({
                        "code": code,
                        "desc": desc
                    })
                else:
                    # 새로운 사양 그룹 단계 추가 (시트에 나타난 순서 그대로!)
                    steps.append({
                        "type": "spec",
                        "name": spec_category,
                        "options": [{
                            "code": code,
                            "desc": desc
                        }]
                    })

    # 4. [품목등록] 시트 파싱 (★ 품목구분: 제품/상품, 품목그룹1코드: OE/8/9 제외 필터링)
    # 헤더: ['품목구분', '품목코드', '품목명', '규격', '품목그룹1코드', ..., '소비자가']
    item_prices_map: Dict[str, int] = {}
    model_consumer_prices: Dict[str, List[int]] = {}
    registered_items: List[Dict[str, Any]] = []  # 상단 검색창 드롭다운 조회용 정제 품목 목록

    reg_rows = prod_sheets.get("품목등록", [])
    if reg_rows:
        r_head = reg_rows[0]
        rh_idx = {name: i for i, name in enumerate(r_head)}

        gubun_col = rh_idx.get("품목구분", -1)
        code_col = rh_idx.get("품목코드", -1)
        name_col = rh_idx.get("품목명", -1)
        spec_col = rh_idx.get("규격", -1)
        grp1_col = rh_idx.get("품목그룹1코드", -1)
        price_col = rh_idx.get("소비자가", -1)

        if code_col != -1:
            for r in reg_rows[1:]:
                if not r or len(r) <= code_col:
                    continue
                item_code = r[code_col].strip()
                if not item_code:
                    continue

                # [필터 조건 1] 품목구분 열이 '제품', '상품' 인 것
                gubun_val = r[gubun_col].strip() if gubun_col != -1 and gubun_col < len(r) else ""
                if gubun_val not in ["제품", "상품"]:
                    continue

                # [필터 조건 2] 품목그룹1코드 열이 'OE', '8', '9' 가 아닌 것
                grp1_val = r[grp1_col].strip().upper() if grp1_col != -1 and grp1_col < len(r) else ""
                if grp1_val in ["OE", "8", "9"]:
                    continue

                # [보안 필터: OEM/ODM 품목 제외]
                item_name = r[name_col].strip() if name_col != -1 and name_col < len(r) else ""
                check_item = f"{item_code} {item_name}".upper()
                if "OEM" in check_item or "ODM" in check_item:
                    continue

                item_spec = r[spec_col].strip() if spec_col != -1 and spec_col < len(r) else ""
                p_consumer = int(safe_number(r[price_col] if price_col != -1 and price_col < len(r) else 0))

                # 상단 검색창 드롭다운용 품목 객체 등록
                registered_items.append({
                    "code": item_code,
                    "name": item_name,
                    "spec": item_spec,
                    "gubun": gubun_val,
                    "price": p_consumer
                })

                if p_consumer > 0:
                    # 1) 정확한 품목코드 -> 소비자가격 맵핑
                    item_prices_map[item_code] = p_consumer

                    # 2) 부모 모델 매핑하여 가격 리스트 수집
                    for m_key in models_dict.keys():
                        if item_code.startswith(m_key + "-") or item_code == m_key:
                            if m_key not in model_consumer_prices:
                                model_consumer_prices[m_key] = []
                            model_consumer_prices[m_key].append(p_consumer)
                            break

        # [요구사항 1] 제품목록의 기본 소비자가격은 품목등록에서만 가져옵니다!
        for m_name, m_info in models_dict.items():
            rep = m_info["rep_code"]
            # 1순위: 품목등록 시트에 등록된 대표품목코드(rep_code)의 소비자가격
            if rep and rep in item_prices_map and item_prices_map[rep] > 0:
                m_info["price_consumer"] = item_prices_map[rep]
            # 2순위: 품목등록 시트의 해당 모델 파생 품목들의 최솟값 (가장 기본 사양 가격)
            elif m_name in model_consumer_prices and model_consumer_prices[m_name]:
                m_info["price_consumer"] = min(model_consumer_prices[m_name])
            else:
                m_info["price_consumer"] = 0

    # 5. 정제된 안전 데이터셋 생성
    clean_data = {
        "build_date": "2026-10-21",
        "title": "신호시스템 제품사양검색 (공개용)",
        "source": "신호시스템 공식 제품DB.xlsx",
        "major_categories": major_categories,
        "sub_categories": sub_categories,
        "model_categories": model_categories,
        "models": models_dict,
        "item_prices": item_prices_map,          # 품목코드 -> 소비자가 실시간 조회 맵
        "registered_items": registered_items     # T_품목등록 필터링된 상단 검색 대상 품목 리스트
    }

    # 6. 파일 출력
    WEB_DIR.mkdir(parents=True, exist_ok=True)

    with open(OUTPUT_JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(clean_data, f, ensure_ascii=False, indent=2)
    print(f"[성공] [홈페이지용] JSON 데이터 저장: {OUTPUT_JSON_FILE} ({OUTPUT_JSON_FILE.stat().st_size:,} bytes)")

    js_content = f"window.__PRODUCT_HP_DATA__ = {json.dumps(clean_data, ensure_ascii=False)};\n"
    with open(OUTPUT_JS_FILE, "w", encoding="utf-8") as f:
        f.write(js_content)
    print(f"[성공] [홈페이지용] 웹 데이터 JS 저장: {OUTPUT_JS_FILE} ({OUTPUT_JS_FILE.stat().st_size:,} bytes)")

    # 7. 브라우저 캐시 방지(Cache-Busting): web/index.html의 script 버전을 현재 시각으로 자동 갱신
    index_html_file = WEB_DIR / "index.html"
    if index_html_file.exists():
        try:
            from datetime import datetime
            cache_ver = datetime.now().strftime("%Y%m%d%H%M%S")
            with open(index_html_file, "r", encoding="utf-8") as f:
                html_text = f.read()
            html_text = re.sub(r'product_data\.js(\?v=[^"]*)?', f'product_data.js?v={cache_ver}', html_text)
            html_text = re.sub(r'app\.js(\?v=[^"]*)?', f'app.js?v={cache_ver}', html_text)
            with open(index_html_file, "w", encoding="utf-8") as f:
                f.write(html_text)
            print(f"[성공] [캐시방지] index.html 스크립트 버전 갱신 완료 (?v={cache_ver})")
        except Exception as e:
            print(f"[경고] index.html 캐시 버전 갱신 실패: {e}")

    return clean_data


if __name__ == "__main__":
    print("=" * 65)
    print("[시작] [홈페이지 공개용] 제품사양 데이터 정제 및 빌드 시작")
    print("=" * 65)
    data = extract_homepage_product_data()

    print("\n[통계] 데이터 정제 완료 통계:")
    print(f"  - 중분류(대카테고리) 수: {len(data['major_categories'])} 개")
    print(f"  - 공개 모델 수: {len(data['models'])} 개")
    print(f"  - 품목코드 소비자가격 매핑 수: {len(data['item_prices'])} 개")
    print("[보안] [보안 검증] 주대리점가 / 최소판매가 / OEM·ODM 모델 원천 배제 완료!")
    print("=" * 65)
