/**
 * ==========================================================================
 * 신호시스템 제품사양검색 (홈페이지 및 GitHub Pages 공개용) - app.js
 * 
 * 주요 기능:
 * 1. window.__PRODUCT_HP_DATA__ 정적 데이터 기반 무서버(Serverless) 100% 자립 구동
 * 2. 다각도 유연한 정규화 검색: 하이픈(-), 공백, 특수문자 무시 (shnisobbbw, isobbb, shn-iso 등 모두 매칭)
 * 3. 4,700여 개 세부 품목코드(SHN-ISO-BBB-W 등) 연동 검색 및 실시간 자동완성 추천 드롭다운
 * 4. 드롭다운 선택 시 해당 모델 자동 열림 + 세부 사양(B, B, B, W) 및 가격(185,000원) 자동 선택
 * 5. 중분류(카테고리) 및 소분류 필터링, 실시간 키워드 검색
 * 6. 기본 소비자가격 + 옵션 선택에 따른 실시간 소비자가격 계산기
 * 7. 제품 설명서(PDF) 링크 및 사양/견적 텍스트 클립보드 원클릭 복사
 * ==========================================================================
 */

(function () {
    'use strict';

    // ==========================================================================
    // 1. 전역 상태 변수
    // ==========================================================================
    let productData = null;
    let selectedMajor = 'ALL';
    let selectedSub = 'ALL';
    let searchQuery = '';
    let currentModelKey = null;

    // 현재 선택된 모델의 사양 선택 상태: { "INPUT": { code, desc }, "OUT1": ... }
    let currentSelectedOptions = {};

    // 검색 최적화를 위한 인덱스 데이터
    let modelItemCodesMap = {}; // { modelKey: [ { itemCode, price, normCode }, ... ] }
    let allSearchableItems = []; // [ { modelKey, itemCode, price, normCode, modelName, desc, mid, sub }, ... ]
    let activeDropdownIndex = -1; // 키보드 방향키 이동을 위한 드롭다운 활성 인덱스

    // ==========================================================================
    // 2. DOM 요소 캐시
    // ==========================================================================
    const majorTabsEl = document.getElementById('majorTabs');
    const subTagsEl = document.getElementById('subTags');
    const searchInputEl = document.getElementById('searchInput');
    const searchClearBtnEl = document.getElementById('searchClearBtn');
    const searchDropdownEl = document.getElementById('searchDropdown');
    const resultCountEl = document.getElementById('resultCount');
    const modelListEl = document.getElementById('modelList');

    const emptyStateEl = document.getElementById('emptyState');
    const configuratorEl = document.getElementById('configurator');

    const heroMajorEl = document.getElementById('heroMajor');
    const heroSubEl = document.getElementById('heroSub');
    const heroModelNameEl = document.getElementById('heroModelName');
    const heroDescEl = document.getElementById('heroDesc');
    const heroIntroBoxEl = document.getElementById('heroIntroBox');
    const heroSpecStatusEl = document.getElementById('heroSpecStatus');
    const heroOrderCodeEl = document.getElementById('heroOrderCode');
    const heroPriceEl = document.getElementById('heroPrice');
    const priceBreakdownEl = document.getElementById('priceBreakdown');
    const priceSpecNoticeEl = document.getElementById('priceSpecNotice');
    const btnManualEl = document.getElementById('btnManual');
    const btnCatalogEl = document.getElementById('btnCatalog');
    const btnCopyCodeEl = document.getElementById('btnCopyCode');
    const btnResetOptionsEl = document.getElementById('btnResetOptions');

    // 맞춤 사양(Other) 입력 및 유효성 검증 상태 관리 객체
    let customSpecsData = {};

    const codeSelectGroupsEl = document.getElementById('codeSelectGroups');
    const techSpecCardEl = document.getElementById('techSpecCard');
    const techSpecGridEl = document.getElementById('techSpecGrid');
    const toastEl = document.getElementById('toast');

    // ==========================================================================
    // 3. 유틸리티 함수
    // ==========================================================================

    /**
     * 숫자 콤마 포맷팅 헬퍼 (예: 185000 -> 185,000)
     */
    function formatNumber(num) {
        if (!num || isNaN(num)) return '0';
        return Number(num).toLocaleString('ko-KR');
    }

    /**
     * HTML 특수문자 이스케이프 (XSS 방지)
     */
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * 검색어 정규화 함수:
     * 영문 소문자 변환 후 공백, 하이픈(-), 밑줄(_), 슬래시(/) 등 특수기호를 모두 제거하여
     * 사용자가 'shn-iso-bbb-w', 'shnisobbbw', 'isobbb' 등 어떤 형태로 쳐도 비교할 수 있게 만듭니다.
     */
    function normalizeKeyword(str) {
        if (!str) return '';
        return String(str).toLowerCase().replace(/[\s\-_/\\,()[\]]/g, '');
    }

    /**
     * 일치하는 텍스트 하이라이팅 헬퍼 (검색어와 겹치는 부분을 강조 태그로 감쌈)
     */
    function highlightMatch(text, query) {
        if (!query || !text) return escapeHtml(text);
        const normQuery = normalizeKeyword(query);
        if (!normQuery) return escapeHtml(text);

        // 단순 포함 검사
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase().trim();
        const idx = lowerText.indexOf(lowerQuery);

        if (idx >= 0) {
            const before = escapeHtml(text.substring(0, idx));
            const match = escapeHtml(text.substring(idx, idx + lowerQuery.length));
            const after = escapeHtml(text.substring(idx + lowerQuery.length));
            return `${before}<span class="search-item-match">${match}</span>${after}`;
        }

        // 특수문자 제거 후 부분 일치인 경우
        return escapeHtml(text);
    }

    /**
     * 토스트 알림 표시
     */
    function showToast(msg) {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        setTimeout(() => {
            toastEl.classList.remove('show');
        }, 2200);
    }

    /**
     * 검색창 및 검색어 상태 초기화 헬퍼 함수:
     * 대분류/소분류 카테고리 버튼을 클릭했을 때 기존 검색어를 깨끗이 지우고
     * 해당 카테고리 제품들만 시원하게 표시될 수 있도록 초기화합니다.
     * (어느 함수에서나 호출할 수 있도록 공용 유틸리티 위치에 선언)
     */
    function clearSearchInput() {
        if (searchInputEl) {
            searchInputEl.value = '';
        }
        searchQuery = '';
        if (searchClearBtnEl) {
            searchClearBtnEl.style.display = 'none';
        }
        if (searchDropdownEl) {
            searchDropdownEl.style.display = 'none';
            searchDropdownEl.innerHTML = '';
        }
        activeDropdownIndex = -1;
    }

    // ==========================================================================
    // 4. 데이터 초기화 및 고속 검색 인덱싱
    // ==========================================================================

    /**
     * 데이터 로드 (window.__PRODUCT_HP_DATA__ 우선 참조 후 JSON fetch 폴백)
     */
    async function initData() {
        if (window.__PRODUCT_HP_DATA__) {
            productData = window.__PRODUCT_HP_DATA__;
            buildSearchIndex();
            initUI();
            return;
        }

        try {
            const resp = await fetch('product_data.json');
            if (!resp.ok) throw new Error('데이터 파일을 불러올 수 없습니다.');
            productData = await resp.json();
            buildSearchIndex();
            initUI();
        } catch (err) {
            console.error('데이터 로드 실패:', err);
            modelListEl.innerHTML = `
                <div style="padding: 20px; color: #e53e3e; text-align: center;">
                    데이터를 불러오지 못했습니다.<br>
                    product_data.js 또는 product_data.json 파일이 존재하는지 확인해 주세요.
                </div>
            `;
        }
    }

    /**
     * T_품목등록 시트 필터(품목구분: 제품/상품, 품목그룹1: OE/8/9 제외) 기준 품목 및 모델 검색 인덱스 사전 구축:
     * - 검색 시 매번 전체를 파싱하지 않고 O(1) 수준으로 빠르게 추천을 띄우기 위해 인덱스를 만듭니다.
     */
    function buildSearchIndex() {
        modelItemCodesMap = {};
        allSearchableItems = [];

        const models = productData.models || {};
        const modelKeys = Object.keys(models);
        const registeredItems = productData.registered_items || [];

        modelKeys.forEach((mKey) => {
            modelItemCodesMap[mKey] = [];
        });

        // T_품목등록 시트에서 필터링된 품목 목록 인덱싱
        registeredItems.forEach((it) => {
            const code = it.code || '';
            const name = it.name || '';
            const spec = it.spec || '';
            const gubun = it.gubun || '제품';
            const price = it.price || 0;

            const normCode = normalizeKeyword(code);
            const normName = normalizeKeyword(name);
            const normSpec = normalizeKeyword(spec);

            // 해당 품목코드가 속하는 부모 모델 찾기
            let matchedModelKey = null;
            for (const mKey of modelKeys) {
                if (code.startsWith(mKey + '-') || code === mKey || name === mKey) {
                    matchedModelKey = mKey;
                    break;
                }
            }

            if (matchedModelKey) {
                modelItemCodesMap[matchedModelKey].push({
                    itemCode: code,
                    price: price,
                    normCode: normCode
                });
            }

            const mInfo = matchedModelKey ? models[matchedModelKey] : null;

            allSearchableItems.push({
                modelKey: matchedModelKey,
                itemCode: code,
                price: price,
                normCode: normCode,
                normName: normName,
                normSpec: normSpec,
                name: name,
                spec: spec,
                gubun: gubun,
                modelName: mInfo ? mInfo.name : name,
                desc: mInfo ? (mInfo.desc || mInfo.spec || spec) : spec,
                mid: mInfo ? mInfo.mid_name : '',
                sub: mInfo ? mInfo.sub_name : ''
            });
        });
    }

    // ==========================================================================
    // 5. UI 초기화 및 이벤트 리스너 바인딩
    // ==========================================================================

    function initUI() {
        renderMajorTabs();
        renderSubTags();
        renderModelList();

        // 첫 번째 모델 기본 자동 선택
        const firstModelKey = Object.keys(productData.models || {})[0];
        if (firstModelKey) {
            selectModel(firstModelKey);
        }

        // 검색창 입력 이벤트
        searchInputEl.addEventListener('input', (e) => {
            const val = e.target.value;
            searchQuery = val.trim();
            searchClearBtnEl.style.display = searchQuery ? 'block' : 'none';

            // 좌측 모델 목록 실시간 필터링
            renderModelList();

            // 상단 실시간 자동완성 추천 드롭다운 갱신
            updateSearchDropdown(searchQuery);
        });

        // 검색창 포커스 시 입력값이 있으면 드롭다운 다시 노출
        searchInputEl.addEventListener('focus', () => {
            if (searchInputEl.value.trim()) {
                updateSearchDropdown(searchInputEl.value.trim());
            }
        });

        // 검색어 지우기 버튼
        searchClearBtnEl.addEventListener('click', () => {
            clearSearchInput();
            searchInputEl.focus();
            renderModelList();
        });

        // 키보드 방향키 및 Enter, ESC 키 네비게이션 지원
        searchInputEl.addEventListener('keydown', (e) => {
            if (!searchDropdownEl || searchDropdownEl.style.display === 'none') return;
            const items = searchDropdownEl.querySelectorAll('.search-dropdown-item');
            if (items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeDropdownIndex = (activeDropdownIndex + 1) % items.length;
                updateDropdownActive(items);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeDropdownIndex = (activeDropdownIndex - 1 + items.length) % items.length;
                updateDropdownActive(items);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (activeDropdownIndex >= 0 && activeDropdownIndex < items.length) {
                    items[activeDropdownIndex].click();
                } else if (items.length > 0) {
                    items[0].click();
                }
            } else if (e.key === 'Escape') {
                searchDropdownEl.style.display = 'none';
            }
        });

        // 검색창 외부 클릭/터치 시 드롭다운 즉시 닫기
        document.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.search-box')) {
                if (searchDropdownEl) searchDropdownEl.style.display = 'none';
            }
        });
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-box')) {
                if (searchDropdownEl) searchDropdownEl.style.display = 'none';
            }
        });

        // 사양 초기화 버튼
        btnResetOptionsEl.addEventListener('click', () => {
            if (currentModelKey) {
                resetDefaultOptions(currentModelKey);
                renderCodeSelectOptions(currentModelKey);
                updatePriceAndOrderCode();
                showToast('사양 선택을 초기화했습니다.');
            }
        });

        // 주문 코드 및 견적 복사 버튼
        btnCopyCodeEl.addEventListener('click', () => {
            copySpecificationToClipboard();
        });
    }

    /**
     * 키보드로 선택된 드롭다운 항목 활성화 스타일 표시 및 스크롤 자동 이동
     */
    function updateDropdownActive(items) {
        items.forEach((it, idx) => {
            if (idx === activeDropdownIndex) {
                it.classList.add('active');
                it.scrollIntoView({ block: 'nearest' });
            } else {
                it.classList.remove('active');
            }
        });
    }

    // ==========================================================================
    // 6. 실시간 자동완성 추천 드롭다운 엔진
    // ==========================================================================

    /**
     * [요구사항 1 & 2 반영] 실시간 자동완성 추천 드롭다운 엔진:
     * - [요구사항 2] 검색어가 최소 2자 미만인 경우 드롭다운을 띄우지 않습니다.
     * - [요구사항 1] T_품목등록 시트(품목구분: 제품/상품, 품목그룹1코드: OE/8/9 제외) 기준 데이터 조회.
     */
    function updateSearchDropdown(query) {
        if (!searchDropdownEl) return;
        const normQuery = normalizeKeyword(query);

        // [요구사항 2] 검색어가 비어 있거나 2자 미만인 경우 드롭다운 숨김
        if (!normQuery || normQuery.length < 2) {
            searchDropdownEl.style.display = 'none';
            searchDropdownEl.innerHTML = '';
            activeDropdownIndex = -1;
            return;
        }

        const models = productData.models || {};
        const suggestions = [];
        const addedSet = new Set();

        // 1. 모델명 정규화 매칭 (예: shn-iso, iso 등)
        Object.entries(models).forEach(([mKey, mInfo]) => {
            const normName = normalizeKeyword(mInfo.name);
            const normRep = normalizeKeyword(mInfo.rep_code);
            if (normName.includes(normQuery) || normRep.includes(normQuery)) {
                suggestions.push({
                    type: 'model',
                    modelKey: mKey,
                    title: mInfo.name,
                    subTitle: `${mInfo.mid_name} > ${mInfo.sub_name} | ${mInfo.desc || mInfo.spec}`,
                    price: mInfo.price_consumer,
                    badge: '대표모델',
                    itemCode: mInfo.rep_code || mInfo.name
                });
                addedSet.add(mKey);
            }
        });

        // 2. [요구사항 1] T_품목등록 시트 정제 품목 정규화 매칭 (품목코드, 품목명, 규격)
        for (let i = 0; i < allSearchableItems.length; i++) {
            const item = allSearchableItems[i];
            if (item.normCode.includes(normQuery) || item.normName.includes(normQuery) || item.normSpec.includes(normQuery)) {
                if (!addedSet.has(item.itemCode)) {
                    const descText = [item.name, item.spec].filter(Boolean).join(' | ');
                    suggestions.push({
                        type: 'item',
                        modelKey: item.modelKey,
                        title: item.itemCode,
                        subTitle: descText || (item.modelName ? `${item.modelName} 주문품목` : ''),
                        price: item.price,
                        badge: item.gubun || '제품',
                        itemCode: item.itemCode
                    });
                    addedSet.add(item.itemCode);
                }
            }
            if (suggestions.length >= 40) break; // 드롭다운에 최대 40개 항목 표시
        }

        if (suggestions.length === 0) {
            searchDropdownEl.innerHTML = `
                <div class="search-dropdown-empty">
                    '<strong>${escapeHtml(query)}</strong>' 에 일치하는 품목등록 데이터가 없습니다.
                </div>
            `;
            searchDropdownEl.style.display = 'block';
            return;
        }

        // 드롭다운 HTML 생성
        let html = `
            <div class="search-dropdown-header">
                <span>T_품목등록 조회 결과 (${suggestions.length}건)</span>
                <span>선택 시 사양 및 가격 자동 적용</span>
            </div>
        `;

        suggestions.forEach((sug, idx) => {
            const priceStr = sug.price > 0 ? `${formatNumber(sug.price)}원` : '가격 문의';
            const modelAttr = sug.modelKey ? `data-model="${escapeHtml(sug.modelKey)}"` : '';
            html += `
                <div class="search-dropdown-item" data-index="${idx}" ${modelAttr} data-code="${escapeHtml(sug.itemCode)}">
                    <div class="search-dropdown-item-left">
                        <div class="search-item-code">
                            <span>${highlightMatch(sug.title, query)}</span>
                            <span class="search-item-badge">${escapeHtml(sug.badge)}</span>
                        </div>
                        <div class="search-item-desc">${escapeHtml(sug.subTitle)}</div>
                    </div>
                    <div class="search-dropdown-item-right">
                        <span class="search-item-price">${priceStr}</span>
                    </div>
                </div>
            `;
        });

        searchDropdownEl.innerHTML = html;
        searchDropdownEl.style.display = 'block';
        activeDropdownIndex = -1;

        // 각 드롭다운 아이템 클릭 시 원스톱 이동 및 사양 자동 선택
        searchDropdownEl.querySelectorAll('.search-dropdown-item').forEach((itemEl) => {
            itemEl.addEventListener('click', () => {
                const mKey = itemEl.dataset.model || null;
                const code = itemEl.dataset.code;
                selectModelAndApplyCode(mKey, code);
            });
        });
    }

    /**
     * 드롭다운 항목 선택 시:
     * 1) 드롭다운을 닫고
     * 2) 해당 모델로 전환 및 세부 품목코드 사양 자동 선택
     */
    function selectModelAndApplyCode(modelKey, itemCode) {
        if (searchDropdownEl) searchDropdownEl.style.display = 'none';

        if (searchInputEl) {
            searchInputEl.value = itemCode;
            searchQuery = itemCode;
            searchClearBtnEl.style.display = 'block';
        }

        // 선택한 모델이 현재 카테고리 필터에 가려지지 않도록 카테고리 '전체'로 맞춤
        selectedMajor = 'ALL';
        selectedSub = 'ALL';
        updateMajorActive();
        renderSubTags();
        renderModelList();

        if (modelKey) {
            // 1. 모델 선택
            selectModel(modelKey);

            // 2. 세부 품목코드 사양 매핑 적용
            if (itemCode && itemCode !== modelKey) {
                applyItemCodeOptions(modelKey, itemCode);
            }
        } else {
            showToast(`선택 품목: ${itemCode}`);
        }
    }

    /**
     * 품목코드(예: SHN-ISO-BBB-W)를 분석하여 해당 모델의 사양(INPUT, OUT1, OUT2, POWER)을 자동 선택
     */
    function applyItemCodeOptions(modelKey, itemCode) {
        const item = (productData.models || {})[modelKey];
        if (!item || !item.code_steps || item.code_steps.length === 0) return;

        // 모델 접두어 제거 (예: 'SHN-ISO-BBB-W' -> 'BBB-W' 또는 'BBB-W')
        let specPart = itemCode;
        if (specPart.startsWith(modelKey)) {
            specPart = specPart.substring(modelKey.length);
        }
        if (specPart.startsWith('-')) {
            specPart = specPart.substring(1);
        }

        // 구분자 '-' 기준으로 나뉘거나 연속된 글자일 수 있으므로 코드 스텝과 매칭
        // 각 step에 대해 매칭 시도
        const steps = item.code_steps;
        let charIndex = 0;

        steps.forEach((step) => {
            if (step.type === 'delimiter') {
                if (charIndex < specPart.length && specPart[charIndex] === (step.char || '-')) {
                    charIndex++;
                }
                return;
            }

            if (step.type === 'spec') {
                const catName = step.name;
                const options = step.options || [];

                // 남은 문자열의 현재 위치에서 매칭되는 옵션 코드 찾기
                let matched = null;

                // 1) 긴 코드부터 우선 매칭 (예: 2자리 코드 등)
                const sortedOpts = [...options].sort((a, b) => b.code.length - a.code.length);
                for (const opt of sortedOpts) {
                    if (specPart.startsWith(opt.code, charIndex)) {
                        matched = opt;
                        charIndex += opt.code.length;
                        break;
                    }
                }

                // 2) 매칭되지 않았는데 하이픈을 건너뛰어야 하는 경우
                if (!matched && charIndex < specPart.length && specPart[charIndex] === '-') {
                    charIndex++;
                    for (const opt of sortedOpts) {
                        if (specPart.startsWith(opt.code, charIndex)) {
                            matched = opt;
                            charIndex += opt.code.length;
                            break;
                        }
                    }
                }

                if (matched) {
                    currentSelectedOptions[catName] = {
                        code: matched.code,
                        desc: matched.desc
                    };
                }
            }
        });

        // 옵션 선택 UI 라디오 버튼 및 카드 상태 동기화
        renderCodeSelectOptions(modelKey);
        updatePriceAndOrderCode();
    }

    // ==========================================================================
    // 7. 카테고리 네비게이션 (중분류 & 소분류)
    // ==========================================================================

    function renderMajorTabs() {
        const majors = productData.major_categories || [];
        majorTabsEl.innerHTML = '';

        // 전체 보기 탭
        const allBtn = document.createElement('button');
        allBtn.className = `major-tab ${selectedMajor === 'ALL' ? 'active' : ''}`;
        allBtn.textContent = '전체 보기';
        allBtn.addEventListener('click', () => {
            clearSearchInput(); // 카테고리 클릭 시 기존 검색어 자동 초기화
            selectedMajor = 'ALL';
            selectedSub = 'ALL';
            updateMajorActive();
            renderSubTags();
            renderModelList();
        });
        majorTabsEl.appendChild(allBtn);

        majors.forEach((m) => {
            const btn = document.createElement('button');
            btn.className = `major-tab ${selectedMajor === m ? 'active' : ''}`;
            btn.textContent = m;
            btn.addEventListener('click', () => {
                clearSearchInput(); // 카테고리 클릭 시 기존 검색어 자동 초기화
                selectedMajor = m;
                selectedSub = 'ALL';
                updateMajorActive();
                renderSubTags();
                renderModelList();
            });
            majorTabsEl.appendChild(btn);
        });
    }

    function updateMajorActive() {
        const btns = majorTabsEl.querySelectorAll('.major-tab');
        btns.forEach((b) => {
            if ((selectedMajor === 'ALL' && b.textContent === '전체 보기') || b.textContent === selectedMajor) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });
    }

    function renderSubTags() {
        subTagsEl.innerHTML = '';

        let subList = [];
        if (selectedMajor === 'ALL') {
            const set = new Set();
            Object.values(productData.sub_categories || {}).forEach((arr) => {
                arr.forEach((s) => set.add(s));
            });
            subList = Array.from(set);
        } else {
            subList = (productData.sub_categories || {})[selectedMajor] || [];
        }

        // '전체' 태그
        const allTag = document.createElement('button');
        allTag.className = `sub-tag ${selectedSub === 'ALL' ? 'active' : ''}`;
        allTag.textContent = '전체';
        allTag.addEventListener('click', () => {
            clearSearchInput(); // 소분류 클릭 시 기존 검색어 자동 초기화
            selectedSub = 'ALL';
            updateSubActive();
            renderModelList();
        });
        subTagsEl.appendChild(allTag);

        subList.forEach((subName) => {
            const tag = document.createElement('button');
            tag.className = `sub-tag ${selectedSub === subName ? 'active' : ''}`;
            tag.textContent = subName;
            tag.addEventListener('click', () => {
                clearSearchInput(); // 소분류 클릭 시 기존 검색어 자동 초기화
                selectedSub = subName;
                updateSubActive();
                renderModelList();
            });
            subTagsEl.appendChild(tag);
        });
    }

    function updateSubActive() {
        const tags = subTagsEl.querySelectorAll('.sub-tag');
        tags.forEach((t) => {
            if ((selectedSub === 'ALL' && t.textContent === '전체') || t.textContent === selectedSub) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });
    }

    // ==========================================================================
    // 8. 좌측 모델 리스트 렌더링 및 유연한 검색 필터링
    // ==========================================================================

    /**
     * 다각도 유연한 정규화 검색 매칭 로직:
     * - 모델명, 설명, 규격, 카테고리는 물론 해당 모델의 모든 파생 품목코드(item_prices)까지 검색 대상에 포함합니다.
     */
    function matchesSearch(item, modelKey, query) {
        if (!query) return true;
        const normQuery = normalizeKeyword(query);
        // 2자 미만 검색어인 경우 필터링하지 않고 전체 유지
        if (!normQuery || normQuery.length < 2) return true;

        // 1) 모델 기본 정보 정규화 매칭
        if (normalizeKeyword(item.name).includes(normQuery)) return true;
        if (normalizeKeyword(item.desc).includes(normQuery)) return true;
        if (normalizeKeyword(item.spec).includes(normQuery)) return true;
        if (normalizeKeyword(item.mid_name).includes(normQuery)) return true;
        if (normalizeKeyword(item.sub_name).includes(normQuery)) return true;
        if (normalizeKeyword(item.rep_code).includes(normQuery)) return true;

        // 2) 모델의 파생 품목코드(예: SHN-ISO-BBB-W) 중 하나라도 일치하면 검색 결과에 포함!
        //    (예: 사용자가 'bbb', 'isobbb', 'shnisobbbw' 등을 검색했을 때 SHN-ISO 모델이 나타남)
        const codes = modelItemCodesMap[modelKey] || [];
        for (let i = 0; i < codes.length; i++) {
            if (codes[i].normCode.includes(normQuery)) {
                return true;
            }
        }

        // 3) 사양 옵션 코드 및 설명 매칭
        const steps = item.code_steps || [];
        for (const step of steps) {
            if (step.type === 'spec') {
                for (const opt of (step.options || [])) {
                    if (normalizeKeyword(opt.code).includes(normQuery) || normalizeKeyword(opt.desc).includes(normQuery)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    function renderModelList() {
        const models = productData.models || {};
        const modelKeys = Object.keys(models);

        const filtered = modelKeys.filter((key) => {
            const item = models[key];

            // 1) 중분류 필터
            if (selectedMajor !== 'ALL' && item.mid_name !== selectedMajor) {
                return false;
            }

            // 2) 소분류 필터
            if (selectedSub !== 'ALL' && item.sub_name !== selectedSub) {
                return false;
            }

            // 3) 다각도 유연한 검색어 매칭
            if (!matchesSearch(item, key, searchQuery)) {
                return false;
            }

            return true;
        });

        resultCountEl.textContent = filtered.length;
        modelListEl.innerHTML = '';

        if (filtered.length === 0) {
            modelListEl.innerHTML = `
                <div style="padding: 40px 10px; text-align: center; color: #94a3b8; font-size: 0.88rem;">
                    검색 조건에 맞는 제품이 없습니다.
                </div>
            `;
            emptyStateEl.style.display = 'block';
            configuratorEl.style.display = 'none';
            currentModelKey = null;
            return;
        }

        filtered.forEach((key) => {
            const item = models[key];
            const card = document.createElement('div');
            card.className = `model-card ${currentModelKey === key ? 'active' : ''}`;
            card.dataset.modelKey = key;

            const basePrice = item.price_consumer > 0 ? `${formatNumber(item.price_consumer)}원` : '가격 문의';

            card.innerHTML = `
                <div class="model-card-header">
                    <span class="model-card-name">${item.name}</span>
                    <span class="model-card-sub">${item.sub_name || item.mid_name}</span>
                </div>
                <div class="model-card-desc">${item.desc || item.spec || '신호시스템 표준 사양 변환기'}</div>
                <div class="model-card-footer">
                    <span class="model-card-price-label">소비자가격(기본)</span>
                    <span class="model-card-price">${basePrice}</span>
                </div>
            `;

            card.addEventListener('click', () => {
                selectModel(key);
            });

            modelListEl.appendChild(card);
        });

        // 현재 선택된 모델이 필터 결과에 없으면 첫 번째 모델 자동 활성화
        if (!currentModelKey || !filtered.includes(currentModelKey)) {
            selectModel(filtered[0]);
        }
    }

    // ==========================================================================
    // 9. 제품 선택 및 인터랙티브 사양 계산기
    // ==========================================================================

    function selectModel(modelKey) {
        currentModelKey = modelKey;
        const item = (productData.models || {})[modelKey];
        if (!item) return;

        // 좌측 카드 활성화 스타일 동기화
        document.querySelectorAll('.model-card').forEach((c) => {
            if (c.dataset.modelKey === modelKey) {
                c.classList.add('active');
            } else {
                c.classList.remove('active');
            }
        });

        // 뷰 전환: 안내문 숨기고 계산기 표시
        emptyStateEl.style.display = 'none';
        configuratorEl.style.display = 'block';

        // 1) 헤더 정보 바인딩
        heroMajorEl.textContent = item.mid_name || '제품';
        heroSubEl.textContent = item.sub_name || '일반';
        heroModelNameEl.textContent = item.name;
        heroDescEl.textContent = item.desc || item.spec || '신호시스템 정밀 계측 및 신호 변환기';

        // 제품소개 (Catalog 시트 제품소개 1~5줄 번호 문장) 전용 블록 렌더링
        if (heroIntroBoxEl) {
            if (item.intro && item.intro.trim()) {
                const rawLines = item.intro.trim().split('\n');
                let introHtml = '';
                rawLines.forEach((line) => {
                    const trimmed = line.trim();
                    if (!trimmed) return;
                    
                    // '1. 문장' 등 번호로 시작하는 패턴 감지
                    const numMatch = trimmed.match(/^(\d+)[\.\)]\s*(.*)$/);
                    if (numMatch) {
                        introHtml += `
                            <div class="intro-line-item">
                                <span class="intro-line-num">${numMatch[1]}</span>
                                <span class="intro-line-text">${escapeHtml(numMatch[2])}</span>
                            </div>
                        `;
                    } else {
                        introHtml += `
                            <div class="intro-line-item">
                                <span class="intro-line-num">•</span>
                                <span class="intro-line-text">${escapeHtml(trimmed)}</span>
                            </div>
                        `;
                    }
                });
                heroIntroBoxEl.innerHTML = introHtml;
                heroIntroBoxEl.style.display = 'flex';
            } else {
                heroIntroBoxEl.innerHTML = '';
                heroIntroBoxEl.style.display = 'none';
            }
        }

        // 2) 카탈로그(PDF) 및 설명서(PDF) 링크 바인딩 (동일한 형태 및 상하 배치)
        const catalogSpan = btnCatalogEl.querySelector('span');
        if (item.catalog_url && item.catalog_url.trim()) {
            btnCatalogEl.href = item.catalog_url.trim();
            btnCatalogEl.target = '_blank';
            btnCatalogEl.classList.remove('disabled');
            btnCatalogEl.title = '카탈로그 PDF 열기 (새 창)';
            if (catalogSpan) catalogSpan.textContent = '카탈로그 (PDF)';
            btnCatalogEl.onclick = null;
        } else {
            btnCatalogEl.href = 'javascript:void(0);';
            btnCatalogEl.removeAttribute('target');
            btnCatalogEl.classList.add('disabled');
            btnCatalogEl.title = '해당 모델은 카탈로그 준비 중입니다.';
            if (catalogSpan) catalogSpan.textContent = '카탈로그 (준비중)';
            btnCatalogEl.onclick = (e) => {
                e.preventDefault();
                showToast(`[${item.name}] 카탈로그 링크가 준비 중입니다.`);
            };
        }
        btnCatalogEl.style.display = 'inline-flex';

        const manualSpan = btnManualEl.querySelector('span');
        if (item.manual_url && item.manual_url.trim()) {
            btnManualEl.href = item.manual_url.trim();
            btnManualEl.target = '_blank';
            btnManualEl.classList.remove('disabled');
            btnManualEl.title = '제품 설명서 PDF 열기 (새 창)';
            if (manualSpan) manualSpan.textContent = '제품 설명서 (PDF)';
            btnManualEl.onclick = null;
        } else {
            btnManualEl.href = 'javascript:void(0);';
            btnManualEl.removeAttribute('target');
            btnManualEl.classList.add('disabled');
            btnManualEl.title = '해당 모델은 설명서 준비 중입니다.';
            if (manualSpan) manualSpan.textContent = '제품 설명서 (준비중)';
            btnManualEl.onclick = (e) => {
                e.preventDefault();
                showToast(`[${item.name}] 설명서 링크가 준비 중입니다.`);
            };
        }
        btnManualEl.style.display = 'inline-flex';

        // 3) 사양 옵션 초기화 및 렌더링
        resetDefaultOptions(modelKey);
        renderCodeSelectOptions(modelKey);

        // 3) 기술 사양 테이블 바인딩
        renderTechSpecs(item.specs);

        // 4) 최종 주문 코드 및 가격 갱신
        updatePriceAndOrderCode();
    }

    /**
     * 옵션이 Other(기타 맞춤 사양)인지 판별하는 함수
     */
    function isOtherOption(opt) {
        if (!opt || !opt.desc) return false;
        const d = opt.desc.trim().toUpperCase();
        return d === 'OTHER' || d.includes('OTHER') || d === '기타';
    }

    /**
     * 사양 그룹명(예: INPUT, OUT1, OUT2)에 해당하는 제작 가능 범위(Available_Specs) 목록 조회
     */
    function getAvailableSpecsForCategory(modelKey, catName) {
        const model = (productData.models || {})[modelKey];
        if (!model || !model.available_specs || model.available_specs.length === 0) return [];

        const normCat = (catName || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

        // 1순위: 정확 매칭
        let matched = model.available_specs.filter((s) => {
            const normType = (s.type || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
            return normType === normCat;
        });

        // 2순위: OUT1/OUTPUT1/OUTPUT 유사 매칭
        if (matched.length === 0) {
            if (normCat.includes('OUT1') || normCat === 'OUTPUT1') {
                matched = model.available_specs.filter((s) => {
                    const t = (s.type || '').toUpperCase();
                    return t === 'OUTPUT1' || t === 'OUT1' || t === 'OUTPUT';
                });
            } else if (normCat.includes('OUT2') || normCat === 'OUTPUT2') {
                matched = model.available_specs.filter((s) => {
                    const t = (s.type || '').toUpperCase();
                    return t === 'OUTPUT2' || t === 'OUT2' || t === 'OUTPUT';
                });
            } else if (normCat.includes('INPUT')) {
                matched = model.available_specs.filter((s) => (s.type || '').toUpperCase().includes('INPUT'));
            }
        }

        // 3순위: 전체 출력 공통 fallback
        if (matched.length === 0 && (normCat.includes('OUT') || normCat.includes('OUTPUT'))) {
            matched = model.available_specs.filter((s) => (s.type || '').toUpperCase().includes('OUT'));
        }

        return matched;
    }

    /**
     * 상단 헤더 영역(모델명, 제품설명, 소비자가격)에 맞춤 사양 제작 가능 여부 실시간 피드백
     */
    function updateHeroSpecStatus() {
        if (!heroSpecStatusEl) return;

        const otherKeys = Object.keys(customSpecsData).filter((k) => customSpecsData[k] && customSpecsData[k].isOther);
        if (otherKeys.length === 0) {
            heroSpecStatusEl.innerHTML = '';
            heroSpecStatusEl.style.display = 'none';
            if (priceSpecNoticeEl) {
                priceSpecNoticeEl.innerHTML = '';
                priceSpecNoticeEl.style.display = 'none';
            }
            return;
        }

        let allValid = true;
        let anyInvalid = false;
        let anyWaiting = false;
        let statusPillsHtml = '';

        otherKeys.forEach((catName) => {
            const data = customSpecsData[catName];
            if (data.status === 'valid') {
                statusPillsHtml += `
                    <div class="spec-status-pill status-valid" title="제작 가능 사양입니다">
                        <span>✅</span>
                        <span>[${escapeHtml(catName)}] 제작 가능: ${data.zero} ~ ${data.span} ${escapeHtml(data.unit)}</span>
                    </div>
                `;
            } else if (data.status === 'invalid') {
                allValid = false;
                anyInvalid = true;
                statusPillsHtml += `
                    <div class="spec-status-pill status-invalid" title="${escapeHtml(data.message)}">
                        <span>❌</span>
                        <span>[${escapeHtml(catName)}] 제작 불가: ${escapeHtml(data.message)}</span>
                    </div>
                `;
            } else {
                allValid = false;
                anyWaiting = true;
                statusPillsHtml += `
                    <div class="spec-status-pill status-waiting" title="Zero와 Span 수치를 입력해 주세요">
                        <span>⏳</span>
                        <span>[${escapeHtml(catName)}] 맞춤 수치를 입력해 주세요 (${escapeHtml(data.unit)})</span>
                    </div>
                `;
            }
        });

        heroSpecStatusEl.innerHTML = statusPillsHtml;
        heroSpecStatusEl.style.display = 'flex';

        // 우측 소비자가격 박스 하단 안내
        if (priceSpecNoticeEl) {
            if (anyInvalid) {
                priceSpecNoticeEl.className = 'price-spec-notice notice-invalid';
                priceSpecNoticeEl.innerHTML = '⚠️ 제작 불가 사양 (수치 재확인 필요)';
                priceSpecNoticeEl.style.display = 'block';
            } else if (allValid) {
                priceSpecNoticeEl.className = 'price-spec-notice notice-valid';
                priceSpecNoticeEl.innerHTML = '✨ 맞춤 사양 제작 가능 (주문 제작)';
                priceSpecNoticeEl.style.display = 'block';
            } else if (anyWaiting) {
                priceSpecNoticeEl.className = 'price-spec-notice notice-waiting';
                priceSpecNoticeEl.innerHTML = '※ 맞춤 사양 수치 입력 대기 중';
                priceSpecNoticeEl.style.display = 'block';
            }
        }
    }

    /**
     * 모델의 기본 사양 옵션 설정 (대표품목코드 또는 각 단계의 첫 번째 옵션 기본 선택)
     */
    function resetDefaultOptions(modelKey) {
        const item = (productData.models || {})[modelKey];
        currentSelectedOptions = {};
        customSpecsData = {}; // 맞춤 사양 데이터 초기화

        if (!item || !item.code_steps || item.code_steps.length === 0) return;

        const repCode = item.rep_code || '';

        item.code_steps.forEach((step) => {
            if (step.type !== 'spec') return;
            const catName = step.name;
            const options = step.options || [];
            if (options.length === 0) return;

            // 대표품목코드(rep_code)에 일치하는 옵션이 있으면 우선 선택
            let matchedOpt = null;
            if (repCode) {
                matchedOpt = options.find((o) => {
                    if (o.code === 'O' && repCode.includes('O-')) return true;
                    if (o.code === 'W' && repCode.endsWith('-W')) return true;
                    return repCode.includes(o.code);
                });
            }

            const chosen = matchedOpt || options[0];
            currentSelectedOptions[catName] = {
                code: chosen.code,
                desc: chosen.desc
            };
        });
    }

    /**
     * 주문 사양 코드 선택기 렌더링 (CodeSelect 순서 100% 보존 및 Other 인라인 입력 패널 지원)
     */
    function renderCodeSelectOptions(modelKey) {
        const item = (productData.models || {})[modelKey];
        codeSelectGroupsEl.innerHTML = '';

        if (!item || !item.code_steps || item.code_steps.length === 0) {
            codeSelectGroupsEl.innerHTML = `
                <div style="padding: 24px; text-align: center; color: #94a3b8; font-size: 0.9rem;">
                    해당 모델은 단일 고정 사양 제품입니다. (추가 선택 옵션 없음)
                </div>
            `;
            updateHeroSpecStatus();
            return;
        }

        item.code_steps.forEach((step) => {
            // 구분 기호 '-' 처리 (텍스트 없이 깔끔한 실선 구분선만 표시)
            if (step.type === 'delimiter') {
                const sepEl = document.createElement('div');
                sepEl.className = 'spec-delimiter-row';
                sepEl.innerHTML = `
                    <div style="margin: 14px 0; height: 1px; background: #e2e8f0;"></div>
                `;
                codeSelectGroupsEl.appendChild(sepEl);
                return;
            }

            const catName = step.name;
            const options = step.options || [];
            const groupEl = document.createElement('div');
            groupEl.className = 'spec-category-group';
            groupEl.dataset.catName = catName;

            const selectedForCat = currentSelectedOptions[catName] || {};

            groupEl.innerHTML = `
                <div class="spec-category-title">
                    <span>${escapeHtml(catName)}</span>
                    <span class="spec-category-badge">${options.length}개 선택지</span>
                </div>
            `;

            const gridEl = document.createElement('div');
            gridEl.className = 'spec-options-grid';

            // Available_Specs 항목 확인
            const availSpecsList = getAvailableSpecsForCategory(modelKey, catName);

            // Other 선택 시 펼쳐질 인라인 패널 생성
            const panelEl = document.createElement('div');
            panelEl.className = 'custom-spec-panel';
            panelEl.id = `customPanel_${catName.replace(/[^a-zA-Z0-9]/g, '_')}`;
            panelEl.style.display = 'none';

            // 단위 옵션 HTML 생성
            let unitOptionsHtml = '';
            availSpecsList.forEach((sp, uIdx) => {
                unitOptionsHtml += `<option value="${escapeHtml(sp.unit)}" data-index="${uIdx}">${escapeHtml(sp.unit)}</option>`;
            });

            if (availSpecsList.length > 0) {
                panelEl.innerHTML = `
                    <div class="custom-spec-header">
                        <span>📐 [${escapeHtml(catName)}] 맞춤 제작 사양 입력 (Available Specs 기준)</span>
                        <span style="font-size: 0.76rem; font-weight: 500; color: #0284c7;">실시간 제작가능 여부 검증</span>
                    </div>
                    <div class="custom-spec-fields">
                        <div class="custom-field-group">
                            <label class="custom-field-label">단위(Unit) 선택</label>
                            <select class="custom-select custom-unit-select">
                                ${unitOptionsHtml}
                            </select>
                        </div>
                        <div class="custom-field-group">
                            <label class="custom-field-label">Zero (영점 수치)</label>
                            <input type="number" step="any" class="custom-input custom-zero-input" placeholder="예: 0">
                        </div>
                        <div class="custom-field-group">
                            <label class="custom-field-label">Span (스팬 수치)</label>
                            <input type="number" step="any" class="custom-input custom-span-input" placeholder="예: 50">
                        </div>
                    </div>
                    <div class="custom-range-guide">
                        <span>💡 제작 가능 범위 안내:</span>
                        <span class="custom-range-text">-</span>
                    </div>
                    <div class="custom-inline-status waiting">
                        수치를 입력하시면 제작 가능 여부를 실시간으로 판정합니다.
                    </div>
                `;
            } else {
                panelEl.innerHTML = `
                    <div class="custom-spec-header">
                        <span>📐 [${escapeHtml(catName)}] 기타 맞춤 사양</span>
                    </div>
                    <div style="font-size: 0.82rem; color: #64748b;">
                        해당 항목은 별도의 표준 수치 제한 없이 제작 주문 상담이 가능합니다.
                    </div>
                `;
            }

            // 인라인 패널 이벤트 리스너 함수
            function setupPanelEvents() {
                if (availSpecsList.length === 0) return;

                const unitSelect = panelEl.querySelector('.custom-unit-select');
                const zeroInput = panelEl.querySelector('.custom-zero-input');
                const spanInput = panelEl.querySelector('.custom-span-input');
                const rangeText = panelEl.querySelector('.custom-range-text');
                const inlineStatus = panelEl.querySelector('.custom-inline-status');

                function updateGuide() {
                    const selUnit = unitSelect.value;
                    const spec = availSpecsList.find(s => s.unit === selUnit) || availSpecsList[0];
                    if (spec) {
                        rangeText.textContent = `Zero: ${spec.zero_low} ~ ${spec.zero_high} ${spec.unit}  |  Span: ${spec.span_low} ~ ${spec.span_high} ${spec.unit}`;
                    }
                }

                function validateInputs() {
                    const selUnit = unitSelect.value;
                    const spec = availSpecsList.find(s => s.unit === selUnit) || availSpecsList[0];
                    const zVal = zeroInput.value.trim();
                    const sVal = spanInput.value.trim();

                    if (!customSpecsData[catName]) {
                        customSpecsData[catName] = { isOther: true };
                    }
                    customSpecsData[catName].unit = selUnit;

                    if (zVal === '' || sVal === '') {
                        customSpecsData[catName].status = 'waiting';
                        customSpecsData[catName].zero = null;
                        customSpecsData[catName].span = null;
                        customSpecsData[catName].message = '수치를 입력해 주세요.';

                        inlineStatus.className = 'custom-inline-status waiting';
                        inlineStatus.innerHTML = `<span>⏳</span> Zero와 Span 수치를 모두 입력해 주세요.`;
                        updateHeroSpecStatus();
                        return;
                    }

                    const zNum = parseFloat(zVal);
                    const sNum = parseFloat(sVal);

                    if (isNaN(zNum) || isNaN(sNum)) {
                        customSpecsData[catName].status = 'invalid';
                        customSpecsData[catName].message = '올바른 숫자를 입력해 주세요.';
                        inlineStatus.className = 'custom-inline-status invalid';
                        inlineStatus.innerHTML = `<span>❌</span> 올바른 숫자를 입력해 주세요.`;
                        updateHeroSpecStatus();
                        return;
                    }

                    customSpecsData[catName].zero = zNum;
                    customSpecsData[catName].span = sNum;

                    // 범위 검사
                    let isValid = true;
                    let errorMsgs = [];

                    if (spec) {
                        if (zNum < spec.zero_low || zNum > spec.zero_high) {
                            isValid = false;
                            errorMsgs.push(`Zero 허용치(${spec.zero_low}~${spec.zero_high}${spec.unit}) 벗어남`);
                        }
                        if (sNum < spec.span_low || sNum > spec.span_high) {
                            isValid = false;
                            errorMsgs.push(`Span 허용치(${spec.span_low}~${spec.span_high}${spec.unit}) 벗어남`);
                        }
                        if (zNum >= sNum) {
                            isValid = false;
                            errorMsgs.push(`Zero(${zNum})는 Span(${sNum})보다 작아야 합니다`);
                        }
                    }

                    if (isValid) {
                        customSpecsData[catName].status = 'valid';
                        customSpecsData[catName].message = `제작 가능 (${zNum} ~ ${sNum} ${selUnit})`;
                        inlineStatus.className = 'custom-inline-status valid';
                        inlineStatus.innerHTML = `<span>✅</span> <strong>제작 가능 사양입니다!</strong> (${zNum} ~ ${sNum} ${escapeHtml(selUnit)})`;
                    } else {
                        customSpecsData[catName].status = 'invalid';
                        customSpecsData[catName].message = errorMsgs.join(', ');
                        inlineStatus.className = 'custom-inline-status invalid';
                        inlineStatus.innerHTML = `<span>❌</span> <strong>제작 불가:</strong> ${escapeHtml(errorMsgs.join(', '))}`;
                    }

                    updateHeroSpecStatus();
                }

                unitSelect.addEventListener('change', () => {
                    updateGuide();
                    validateInputs();
                });

                zeroInput.addEventListener('input', validateInputs);
                spanInput.addEventListener('input', validateInputs);

                // 초기 가이드 텍스트 설정
                updateGuide();
            }

            setupPanelEvents();

            options.forEach((opt) => {
                const isSelected = selectedForCat.code === opt.code;
                const isOther = isOtherOption(opt);
                const optCard = document.createElement('div');
                optCard.className = `spec-option-card ${isSelected ? 'selected' : ''}`;

                optCard.innerHTML = `
                    <div class="option-left">
                        <input type="radio" name="spec_${catName}" class="option-radio" ${isSelected ? 'checked' : ''}>
                        <span class="option-code">${escapeHtml(opt.code)}</span>
                        <span class="option-desc">${escapeHtml(opt.desc)}</span>
                    </div>
                `;

                // 초기 선택이 Other인 경우 패널 열기
                if (isSelected && isOther) {
                    panelEl.style.display = 'flex';
                    if (!customSpecsData[catName]) {
                        customSpecsData[catName] = { isOther: true, status: 'waiting', unit: availSpecsList[0] ? availSpecsList[0].unit : '' };
                    }
                }

                optCard.addEventListener('click', () => {
                    currentSelectedOptions[catName] = {
                        code: opt.code,
                        desc: opt.desc
                    };

                    gridEl.querySelectorAll('.spec-option-card').forEach((c) => {
                        c.classList.remove('selected');
                        const radio = c.querySelector('input[type="radio"]');
                        if (radio) radio.checked = false;
                    });

                    optCard.classList.add('selected');
                    const myRadio = optCard.querySelector('input[type="radio"]');
                    if (myRadio) myRadio.checked = true;

                    // Other 선택 여부에 따라 인라인 패널 토글
                    if (isOther) {
                        panelEl.style.display = 'flex';
                        if (!customSpecsData[catName]) {
                            const firstUnit = availSpecsList[0] ? availSpecsList[0].unit : '';
                            customSpecsData[catName] = { isOther: true, status: 'waiting', unit: firstUnit };
                        } else {
                            customSpecsData[catName].isOther = true;
                        }
                    } else {
                        panelEl.style.display = 'none';
                        if (customSpecsData[catName]) {
                            customSpecsData[catName].isOther = false;
                        }
                    }

                    updateHeroSpecStatus();
                    updatePriceAndOrderCode();
                });

                gridEl.appendChild(optCard);
            });

            groupEl.appendChild(gridEl);
            groupEl.appendChild(panelEl);
            codeSelectGroupsEl.appendChild(groupEl);
        });

        // 렌더링 완료 후 상단 상태 업데이트
        updateHeroSpecStatus();
    }

    /**
     * 최종 주문 사양 코드 조합 및 [품목등록] 시트 품목코드 매칭 실시간 소비자가격 조회
     */
    function updatePriceAndOrderCode() {
        const item = (productData.models || {})[currentModelKey];
        if (!item) return;

        // 1) CodeSelect 사양열 순서대로 주문 코드 조합 (구분 기호 '-' 반영)
        let finalOrderCode = item.name;
        if (!finalOrderCode.endsWith('-')) {
            finalOrderCode += '-';
        }

        const steps = item.code_steps || [];
        steps.forEach((step) => {
            if (step.type === 'delimiter') {
                if (!finalOrderCode.endsWith('-')) {
                    finalOrderCode += (step.char || '-');
                }
            } else if (step.type === 'spec') {
                const sel = currentSelectedOptions[step.name];
                if (sel && sel.code && sel.code !== '-') {
                    finalOrderCode += sel.code;
                }
            }
        });

        // 끝에 남은 하이픈 제거
        if (finalOrderCode.endsWith('-')) {
            finalOrderCode = finalOrderCode.slice(0, -1);
        }

        heroOrderCodeEl.textContent = finalOrderCode;

        // 2) 품목등록 시트의 품목코드와 일치하는 소비자가격 가져오기!
        const itemPrices = productData.item_prices || {};
        let matchedPrice = itemPrices[finalOrderCode];

        if (!matchedPrice) {
            matchedPrice = itemPrices[finalOrderCode.toUpperCase().trim()];
        }

        if (matchedPrice !== undefined && matchedPrice > 0) {
            heroPriceEl.textContent = formatNumber(matchedPrice);
            priceBreakdownEl.style.display = 'block';
            priceBreakdownEl.innerHTML = `품목등록 등록 코드: <strong>${finalOrderCode}</strong>`;
        } else {
            // 품목등록에 일치하는 조합 코드가 아직 없는 경우 기본 가격 표시
            if (item.price_consumer > 0) {
                heroPriceEl.textContent = formatNumber(item.price_consumer);
                priceBreakdownEl.style.display = 'block';
                priceBreakdownEl.innerHTML = `기본 기준가 (주문 사양 맞춤 제작 가능)`;
            } else {
                heroPriceEl.textContent = '가격 문의';
                priceBreakdownEl.style.display = 'none';
            }
        }

        // 상단 헤더 맞춤 사양 제작가능 여부 실시간 갱신
        updateHeroSpecStatus();
    }

    // ==========================================================================
    // 10. 기술 사양 (Specifications) 및 제작 가능 범위 렌더링
    // ==========================================================================

    function renderTechSpecs(specs) {
        techSpecGridEl.innerHTML = '';
        if (!specs || Object.keys(specs).length === 0) {
            techSpecCardEl.style.display = 'none';
            return;
        }

        techSpecCardEl.style.display = 'block';
        Object.entries(specs).forEach(([k, v]) => {
            const item = document.createElement('div');
            item.className = 'tech-spec-item';
            item.innerHTML = `
                <span class="tech-spec-key">${k}</span>
                <span class="tech-spec-val">${v}</span>
            `;
            techSpecGridEl.appendChild(item);
        });
    }

    // ==========================================================================
    // 11. 사양 및 견적 텍스트 클립보드 복사
    // ==========================================================================

    function copySpecificationToClipboard() {
        const item = (productData.models || {})[currentModelKey];
        if (!item) return;

        const orderCode = heroOrderCodeEl.textContent;
        const price = heroPriceEl.textContent;

        let optDetails = [];
        Object.entries(currentSelectedOptions).forEach(([cat, sel]) => {
            optDetails.push(`  • ${cat}: [${sel.code}] ${sel.desc}`);
        });

        const copyText = [
            `[신호시스템 제품 사양 견적]`,
            `■ 모델명: ${item.name}`,
            `■ 선택 주문 코드: ${orderCode}`,
            `■ 소비자가격: ${price}원 (VAT 별도)`,
            `■ 선택 사양 상세:`,
            optDetails.join('\n'),
            `■ 제품 매뉴얼: ${item.manual_url || 'https://www.shinhosystem.com'}`,
            `----------------------------------------`,
            `신호시스템 (SHINHO SYSTEM Co., Ltd.)`
        ].join('\n');

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(copyText)
                .then(() => showToast('주문 코드 및 사양이 클립보드에 복사되었습니다!'))
                .catch(() => fallbackCopy(copyText));
        } else {
            fallbackCopy(copyText);
        }
    }

    function fallbackCopy(text) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showToast('주문 코드 및 사양이 클립보드에 복사되었습니다!');
        } catch (e) {
            alert('복사하지 못했습니다. 수동으로 복사해 주세요.');
        }
        document.body.removeChild(ta);
    }

    // DOM 로드 완료 시 초기화 실행
    document.addEventListener('DOMContentLoaded', initData);

})();

