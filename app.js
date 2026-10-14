document.addEventListener('DOMContentLoaded', () => {
    // --- 常量與全域變數 ---
    const DB_NAME = 'StockDataDB';
    const DB_VERSION = 5;
    const KLINE_STORE_NAME = 'kline_data';
    const NAME_STORE_NAME = 'stock_names';
    const SEARCH_HISTORY_KEY = 'stockSearchHistory';
    let db;

    // --- DOM 元素參照 ---
    const queryForm = document.getElementById('query-form');
    const stockCodeInput = document.getElementById('stock-code-input');
    const startDateInput = document.getElementById('start-date-input');
    const endDateInput = document.getElementById('end-date-input');
    const statusMessage = document.getElementById('status-message');

    // 預設日期設定
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    endDateInput.value = `${yyyy}-${mm}-${dd}`;

    const lastStockCode = localStorage.getItem('lastStockCode');
    const lastStartDate = localStorage.getItem('lastStartDate');
    if (lastStockCode) stockCodeInput.value = lastStockCode;
    if (lastStartDate) startDateInput.value = lastStartDate;

    // 圖表容器與實例
    const chartContainer = document.getElementById('chart-container');
    const klineChartContainer = document.getElementById('kline-chart-container');
    const weeklyChartContainer = document.getElementById('weekly-chart-container');
    const amplitudeChart = echarts.init(chartContainer);
    const klineChart = echarts.init(klineChartContainer);
    const weeklyAmplitudeChart = echarts.init(weeklyChartContainer);

    const analysisTitleContainer = document.getElementById('analysis-title-container');
    const averageAmplitudeContainer = document.getElementById('average-amplitude-container');
    const klineTitleContainer = document.getElementById('kline-title-container');
    const weeklyAnalysisTitleContainer = document.getElementById('weekly-analysis-title-container');
    const weeklyAverageAmplitudeContainer = document.getElementById('weekly-average-amplitude-container');


    const stockCodeList = document.getElementById('stock-code-list');

    // --- 蛛網量化回測與參數尋優 DOM 元素 ---
    const backtestForm = document.getElementById('backtest-form');
    const btGridPercent = document.getElementById('bt-grid-percent');
    const btOrderQuantity = document.getElementById('bt-order-quantity');
    const btInitialStock = document.getElementById('bt-initial-stock');
    const btMaxStock = document.getElementById('bt-max-stock');
    const btMinStock = document.getElementById('bt-min-stock');
    const btInitialCash = document.getElementById('bt-initial-cash');
    const btLowerPrice = document.getElementById('bt-lower-price');
    const btUpperPrice = document.getElementById('bt-upper-price');
    const btnRunBacktest = document.getElementById('btn-run-backtest');
    const btSpinner = document.getElementById('bt-spinner');

    const labelOrderQuantity = document.getElementById('label-order-quantity');
    const labelInitialStock = document.getElementById('label-initial-stock');
    const labelMaxStock = document.getElementById('label-max-stock');
    const labelMinStock = document.getElementById('label-min-stock');

    // 智能參數尋優元件
    const btnRunOptimize = document.getElementById('btn-run-optimize');
    const optSpinner = document.getElementById('opt-spinner');
    const optimizeRecCards = document.getElementById('optimize-recommendation-cards');
    const optimizeChartContainer = document.getElementById('optimize-chart-container');
    const optimizeTableContainer = document.getElementById('optimize-table-container');
    const optimizeTableBody = document.getElementById('optimize-table-body');
    const optimizeHintText = document.getElementById('optimize-hint-text');
    const optimizeChart = echarts.init(optimizeChartContainer);

    const recBestReturnTitle = document.getElementById('rec-best-return-title');
    const recBestReturnDesc = document.getElementById('rec-best-return-desc');
    const recBestBalancedTitle = document.getElementById('rec-best-balanced-title');
    const recBestBalancedDesc = document.getElementById('rec-best-balanced-desc');
    const recAtrTitle = document.getElementById('rec-atr-title');
    const recAtrDesc = document.getElementById('rec-atr-desc');
    const btnApplyBestReturn = document.getElementById('btn-apply-best-return');
    const btnApplyBestBalanced = document.getElementById('btn-apply-best-balanced');
    const btnApplyAtr = document.getElementById('btn-apply-atr');

    // 回測結果與圖表容器
    const backtestSummaryContainer = document.getElementById('backtest-summary-container');
    const backtestChartContainer = document.getElementById('backtest-chart-container');
    const tradesTableBody = document.getElementById('trades-table-body');
    const historyTableBody = document.getElementById('history-table-body');
    const tradesCountBadge = document.getElementById('trades-count-badge');
    const btnRefreshHistory = document.getElementById('btn-refresh-history');
    const backtestChart = echarts.init(backtestChartContainer);

    let currentLoadedStock = null;
    let latestOptimizationResult = null;

    // --- 工具函式 ---
    const showStatus = (message, type = 'info') => {
        statusMessage.innerHTML = message;
        statusMessage.className = `alert alert-${type} mt-3`;
        statusMessage.style.display = 'block';
    };

    const isTaiwanCode = (code) => {
        const clean = String(code || '').trim();
        return /^\d{4}$/.test(clean) || /^00\d{2,4}[A-Z]?$/i.test(clean);
    };

    // 更新介面上的張/手交易單位標籤
    const updateUnitLabels = (code) => {
        const unit = isTaiwanCode(code) ? '張' : '手';
        if (labelOrderQuantity) labelOrderQuantity.innerText = `每筆買賣 (${unit})`;
        if (labelInitialStock) labelInitialStock.innerText = `原始庫存 (${unit})`;
        if (labelMaxStock) labelMaxStock.innerText = `最大庫存上限 (${unit})`;
        if (labelMinStock) labelMinStock.innerText = `最小庫存底倉 (${unit})`;
    };

    // --- 歷史搜尋紀錄 ---
    const loadSearchHistory = () => {
        const history = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) || [];
        stockCodeList.innerHTML = '';
        
        if (history.length === 0) {
            const li = document.createElement('li');
            li.innerHTML = `<span class="dropdown-item-text text-muted">尚無歷史搜尋紀錄</span>`;
            stockCodeList.appendChild(li);
            return;
        }

        history.forEach(item => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.className = 'dropdown-item';
            a.href = '#';
            a.textContent = `${item.name} (${item.code})`;
            a.dataset.code = item.code;
            a.addEventListener('click', (e) => {
                e.preventDefault();
                stockCodeInput.value = a.dataset.code;
                queryForm.dispatchEvent(new Event('submit', { cancelable: true }));
            });
            li.appendChild(a);
            stockCodeList.appendChild(li);
        });
    };

    const updateSearchHistory = (code, name) => {
        let history = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) || [];
        history = history.filter(item => item.code !== code);
        history.unshift({ code, name });
        // Keep only the last 20 entries
        if (history.length > 20) {
            history = history.slice(0, 20);
        }

        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
        loadSearchHistory();
    };

    // --- IndexedDB 本地快取 ---
    const initDB = () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (event) => reject(`資料庫初始化失敗: ${event.target.error}`);
            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(KLINE_STORE_NAME)) {
                    db.createObjectStore(KLINE_STORE_NAME, { keyPath: ['stock_code', 'date'] });
                }
                if (!db.objectStoreNames.contains(NAME_STORE_NAME)) {
                    db.createObjectStore(NAME_STORE_NAME, { keyPath: 'stock_code' });
                }
            };
        });
    };

    const getStockName = async (stockCode) => {
        if (!db) return stockCode;
        const tx = db.transaction(NAME_STORE_NAME, 'readonly');
        const store = tx.objectStore(NAME_STORE_NAME);
        const request = store.get(stockCode);
        return new Promise((resolve) => {
            request.onsuccess = (event) => {
                resolve(event.target.result ? event.target.result.name : stockCode);
            };
            request.onerror = () => resolve(stockCode);
        });
    };

    // --- 核心網路載入邏輯 ---
    async function fetchDataFromLocalServer(code) {
        const url = `/api/kline?symbol=${code}`;
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `伺服器回應異常: ${response.status}` }));
            throw new Error(errorData.error || '伺服器返回錯誤');
        }
        return response.json();
    }

    const saveData = async (klineData, stockCode, stockName) => {
        if (!db) return;
        const klineTx = db.transaction(KLINE_STORE_NAME, 'readwrite');
        const klineStore = klineTx.objectStore(KLINE_STORE_NAME);
        klineData.forEach(item => klineStore.put({ stock_code: stockCode, ...item }));

        const nameTx = db.transaction(NAME_STORE_NAME, 'readwrite');
        nameTx.objectStore(NAME_STORE_NAME).put({ stock_code: stockCode, name: stockName });
        
        return Promise.all([klineTx.done, nameTx.done]);
    };

    const handleQuery = async (event) => {
        event.preventDefault();
        amplitudeChart.showLoading();
        klineChart.showLoading();
        weeklyAmplitudeChart.showLoading();
        [analysisTitleContainer, averageAmplitudeContainer, klineTitleContainer, weeklyAnalysisTitleContainer, weeklyAverageAmplitudeContainer].forEach(c => c.style.display = 'none');

        const stockCodeWithPossibleName = stockCodeInput.value.trim();
        const stockCode = stockCodeWithPossibleName.split(' ')[0];
        const startDate = startDateInput.value || '2000-01-01';
        const endDate = endDateInput.value || '9999-12-31';

        if (!stockCode) {
            showStatus('請輸入股票或 ETF 代號', 'warning');
            [amplitudeChart, klineChart].forEach(c => c.hideLoading());
            return;
        }

        updateUnitLabels(stockCode);

        let queryStartDate = new Date(startDate);
        queryStartDate.setDate(queryStartDate.getDate() - 365);
        const queryStartDateString = queryStartDate.toISOString().slice(0, 10);

        const queryDB = (code, start, end) => {
            return new Promise((resolve, reject) => {
                const range = IDBKeyRange.bound([code, start], [code, end]);
                const request = db.transaction(KLINE_STORE_NAME, 'readonly').objectStore(KLINE_STORE_NAME).getAll(range);
                request.onerror = (e) => reject(e.target.error);
                request.onsuccess = () => resolve(request.result.sort((a, b) => a.date.localeCompare(b.date)));
            });
        };

        try {
            showStatus(`正在從網路獲取 ${stockCode} 的最新行情數據...`, 'info');
            const serverResponse = await fetchDataFromLocalServer(stockCode);
            await saveData(serverResponse.kline, stockCode, serverResponse.name);
            const stockName = serverResponse.name;
            
            if (stockName && stockName !== stockCode) {
                updateSearchHistory(stockCode, stockName);
            }

            const allData = await queryDB(stockCode, queryStartDateString, endDate);

            if (allData.length === 0) {
                showStatus('在指定的時間區間內查無行情數據。', 'warning');
                [amplitudeChart, klineChart, weeklyAmplitudeChart].forEach(c => c.clear());
            } else {
                showStatus(`成功載入 ${stockCode} (${stockName}) 共 ${allData.length} 筆日K數據。`, 'success');
                
                // 先確保外層容器與 Tab 完全顯示，避免 ECharts 獲取到的容器寬度為 0
                const chartTabs = document.getElementById('chart-tabs');
                const chartTabContent = document.getElementById('chart-tab-content');
                chartTabs.style.display = 'flex';
                chartTabContent.style.display = 'block';

                const klineTabBtn = document.getElementById('kline-tab');
                if (klineTabBtn) {
                    bootstrap.Tab.getOrCreateInstance(klineTabBtn).show();
                }

                renderCharts(allData, stockCode, stockName);
                setupBacktestDefaults(allData, stockCode, stockName);

                // 延遲強制觸發一次精準 resize，保證圖表 100% 寬度自適應
                setTimeout(() => {
                    klineChart.resize();
                    amplitudeChart.resize();
                }, 80);

                localStorage.setItem('lastStockCode', `${stockCode} - ${stockName}`);
                localStorage.setItem('lastStartDate', startDateInput.value);

                // 自動觸發一次快速參數尋優，讓使用者一進來就看到最佳效益建議
                triggerAutoOptimization();
            }

        } catch (fetchError) {
            try {
                const stockName = await getStockName(stockCode);
                const allData = await queryDB(stockCode, queryStartDateString, endDate);

                if (allData.length === 0) {
                    showStatus(`錯誤: ${fetchError.message}`, 'danger');
                    [amplitudeChart, klineChart].forEach(c => c.clear());
                } else {
                    showStatus(`無法從網路連線: ${fetchError.message}。現正顯示本地快取數據...`, 'warning');
                    
                    const chartTabs = document.getElementById('chart-tabs');
                    const chartTabContent = document.getElementById('chart-tab-content');
                    chartTabs.style.display = 'flex';
                    chartTabContent.style.display = 'block';

                    const klineTabBtn = document.getElementById('kline-tab');
                    if (klineTabBtn) {
                        bootstrap.Tab.getOrCreateInstance(klineTabBtn).show();
                    }

                    renderCharts(allData, stockCode, stockName);
                    setupBacktestDefaults(allData, stockCode, stockName);

                    setTimeout(() => {
                        klineChart.resize();
                        amplitudeChart.resize();
                    }, 80);

                    localStorage.setItem('lastStockCode', `${stockCode} - ${stockName}`);
                    localStorage.setItem('lastStartDate', startDateInput.value);
                }
            } catch (dbError) {
                showStatus(`網路與本地快取載入均失敗: ${dbError.message}`, 'danger');
            }

        } finally {
            [amplitudeChart, klineChart, weeklyAmplitudeChart].forEach(c => c.hideLoading());
        }
    };

    // --- 圖表渲染 ---
    const renderCharts = (rawData, stockCode, stockName) => {
        renderTrueRangeChart(rawData, stockCode, stockName);
        renderWeeklyTrueRangeChart(rawData, stockCode, stockName);
        renderKlineChart(rawData, stockCode, stockName);
    };

    const renderTrueRangeChart = (rawData, stockCode, stockName) => {
        analysisTitleContainer.innerText = `${stockCode} - ${stockName} | 日真實波幅比率 (ATR Ratio) 與成交量分析`;
        analysisTitleContainer.style.display = 'block';

        const dates = rawData.map(item => item.date);
        const volumes = rawData.map((item, index) => [index, item.volume, item.open > item.close ? -1 : 1]);

        const trueRanges = rawData.map((item, i) => {
            if (i === 0) return '-';
            const high = item.high;
            const low = item.low;
            const prevClose = rawData[i - 1].close;
            return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        });

        const trueRangeRatios = rawData.map((item, i) => {
            if (i === 0 || item.close == 0) return '-';
            const tr = trueRanges[i];
            if (tr === '-') return '-';
            return ((tr / item.close) * 100).toFixed(2);
        });

        const calculateAndDisplayAverageTrueRanges = (startIdx, endIdx) => {
            if (rawData.length === 0 || endIdx < 0 || endIdx >= rawData.length) {
                averageAmplitudeContainer.style.display = 'none';
                return;
            }
            averageAmplitudeContainer.style.display = 'block';

            const visibleTrueRanges = trueRanges.slice(startIdx, endIdx + 1);
            let trTotal = 0, trCount = 0;
            visibleTrueRanges.forEach(tr => {
                if (tr !== '-') {
                    trTotal += tr;
                    trCount++;
                }
            });

            const avgTR_unrounded = trCount ? (trTotal / trCount) : 0;
            const avgTR_str = avgTR_unrounded.toFixed(3);
            const lastClosePrice = rawData[endIdx].close;
            const percentage = lastClosePrice ? ((parseFloat(avgTR_str) / lastClosePrice) * 100).toFixed(2) : 0;

            let percentageText = percentage > 0 ? ` (${percentage}%)` : '';
            averageAmplitudeContainer.innerHTML = `
                <span class="me-4"><strong>可視區間平均真實波幅:</strong> ${avgTR_str}${percentageText}</span>`;
        };

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                formatter: function (params) {
                    if (!params || params.length === 0) return '';
                    let tooltipHtml = `<strong>${params[0].name}</strong><br/>`;
                    params.forEach(param => {
                        if (param.seriesType === 'bar' && param.seriesName === '成交量') {
                            tooltipHtml += `${param.marker} ${param.seriesName}: <strong>${param.value[1].toLocaleString()}</strong><br/>`;
                        } else if (param.value !== undefined && param.value !== '-') {
                            tooltipHtml += `${param.marker} ${param.seriesName}: <strong>${param.value}%</strong><br/>`;
                        }
                    });
                    return tooltipHtml;
                }
            },
            legend: { data: ['真實波幅比率', '成交量'], top: 0 },
            grid: [
                { left: '10%', right: '8%', top: '10%', height: '55%' },
                { left: '10%', right: '8%', top: '70%', height: '15%' }
            ],
            xAxis: [
                { type: 'category', data: dates, boundaryGap: false, axisLine: { onZero: false }, splitLine: { show: false } },
                { type: 'category', gridIndex: 1, data: dates, boundaryGap: false, axisLine: { onZero: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false } }
            ],
            yAxis: [
                { type: 'value', scale: true, splitArea: { show: true }, axisLabel: { formatter: '{value}%' } },
                { scale: true, gridIndex: 1, splitNumber: 2, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } }
            ],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0, 1], start: 70, end: 100 },
                { show: true, xAxisIndex: [0, 1], type: 'slider', top: '88%', start: 70, end: 100 }
            ],
            series: [
                { name: '真實波幅比率', type: 'line', data: trueRangeRatios, smooth: true, lineStyle: { width: 2, color: '#0d6efd' } },
                { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes, itemStyle: { color: (params) => (params.value[2] === 1 ? '#ef232a' : '#14b143') } }
            ]
        };

        amplitudeChart.setOption(option, true);
        const dataLength = dates.length;
        calculateAndDisplayAverageTrueRanges(Math.floor(dataLength * 0.7), dataLength - 1);
        amplitudeChart.on('dataZoom', (event) => {
            const startIdx = event.batch ? Math.floor(dataLength * (event.batch[0].start / 100)) : Math.floor(dataLength * (event.start / 100));
            const endIdx = event.batch ? Math.ceil(dataLength * (event.batch[0].end / 100)) - 1 : Math.ceil(dataLength * (event.end / 100)) - 1;
            calculateAndDisplayAverageTrueRanges(startIdx, endIdx);
        });
    };

    const renderWeeklyTrueRangeChart = (rawData, stockCode, stockName) => {
        weeklyAnalysisTitleContainer.innerText = `${stockCode} - ${stockName} | 周真实波幅比率与成交量分析`;
        weeklyAnalysisTitleContainer.style.display = 'block';

        // Helper function to get the start of the week (Monday)
        function getWeekStartDate(date) {
            const d = new Date(date);
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
            d.setDate(diff);
            return new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }

        // 1. Aggregate daily data into weekly data
        const weeklyGroups = {};
        rawData.forEach(item => {
            const weekStartDate = getWeekStartDate(new Date(item.date));
            const weekKey = weekStartDate.toISOString().slice(0, 10);
            if (!weeklyGroups[weekKey]) {
                weeklyGroups[weekKey] = [];
            }
            weeklyGroups[weekKey].push(item);
        });

        const weeklyData = Object.keys(weeklyGroups).map(weekKey => {
            const weekData = weeklyGroups[weekKey];
            const lastDay = weekData[weekData.length - 1];
            return {
                date: lastDay.date, // Use last day of the week as the representative date
                open: weekData[0].open,
                high: Math.max(...weekData.map(d => d.high)),
                low: Math.min(...weekData.map(d => d.low)),
                close: lastDay.close,
                volume: weekData.reduce((sum, d) => sum + d.volume, 0)
            };
        });

        // Sort weekly data by date
        weeklyData.sort((a, b) => a.date.localeCompare(b.date));

        const dates = weeklyData.map(item => item.date);
        const volumes = weeklyData.map((item, index) => [index, item.volume, item.open > item.close ? -1 : 1]);

        // 2. Calculate Weekly True Range and True Range Ratio
        const trueRanges = weeklyData.map((item, i) => {
            if (i === 0) return '-';
            const high = item.high;
            const low = item.low;
            const prevClose = weeklyData[i - 1].close;
            return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        });

        const trueRangeRatios = weeklyData.map((item, i) => {
            if (i === 0 || item.close == 0) return '-';
            const tr = trueRanges[i];
            if (tr === '-') return '-';
            return ((tr / item.close) * 100).toFixed(2);
        });

        // 3. Calculate Average True Range for display text
        const calculateAndDisplayAverageTrueRanges = (startIdx, endIdx) => {
            if (weeklyData.length === 0 || endIdx < 0 || endIdx >= weeklyData.length) {
                weeklyAverageAmplitudeContainer.style.display = 'none';
                return;
            }
            weeklyAverageAmplitudeContainer.style.display = 'block';

            const visibleTrueRanges = trueRanges.slice(startIdx, endIdx + 1);

            let trTotal = 0, trCount = 0;
            visibleTrueRanges.forEach(tr => {
                if (tr !== '-') {
                    trTotal += tr;
                    trCount++;
                }
            });

            const avgTR_unrounded = trCount ? (trTotal / trCount) : 0;
            const avgTR_str = avgTR_unrounded.toFixed(3);

            const lastClosePrice = weeklyData[endIdx].close;
            const percentage = lastClosePrice ? ((parseFloat(avgTR_str) / lastClosePrice) * 100).toFixed(2) : 0;

            let percentageText = '';
            if (percentage > 0) {
                percentageText = ` (${percentage}%)`;
            }

            weeklyAverageAmplitudeContainer.innerHTML = `
                <span class="me-4"><strong>可视区域平均周真实波幅:</strong> ${avgTR_str}${percentageText}</span>`;
        };

        const trColors = {
            '周真实波幅比率(%)': '#ff7f50'
        };

        const legendData = Object.keys(trColors).map(name => ({
            name: name,
            icon: 'rect',
            itemStyle: { color: trColors[name] }
        }));

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                formatter: (params) => {
                    const dataIndex = params[0].dataIndex;
                    const date = dates[dataIndex];
                    const ratio = trueRangeRatios[dataIndex];
                    const closePrice = weeklyData[dataIndex].close;
                    const trueRange = trueRanges[dataIndex];

                    if (ratio === '-') {
                        return '';
                    }

                    let tooltipHtml = `${date}<br/>`;
                    tooltipHtml += `${params[0].marker} ${params[0].seriesName}: <strong>${ratio}%</strong><br/>`;
                    tooltipHtml += `周收盘价: ${closePrice}<br/>`;
                    tooltipHtml += `周真实波幅: ${trueRange.toFixed(3)}`;

                    return tooltipHtml;
                }
            },
            legend: { data: legendData, top: 0, inactiveColor: '#777' },
            grid: [
                { left: '10%', right: '15%', top: '10%', height: '50%' },
                { left: '10%', right: '15%', top: '65%', height: '15%' }
            ],
            xAxis: [
                { type: 'category', data: dates, scale: true, boundaryGap: false, axisLine: { show: false }, splitLine: { show: false }, min: 'dataMin', max: 'dataMax' },
                { type: 'category', gridIndex: 1, data: dates, scale: true, boundaryGap: false, axisLine: { onZero: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, min: 'dataMin', max: 'dataMax' }
            ],
            yAxis: [
                {
                    scale: true,
                    splitArea: { show: false },
                    axisLine: { show: false }
                },
                { scale: true, gridIndex: 1, splitNumber: 2, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } }
            ],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0, 1], start: 80, end: 100 },
                { show: true, xAxisIndex: [0, 1], type: 'slider', top: '85%', start: 80, end: 100 }
            ],
            series: [
                { name: '周成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes, itemStyle: { color: (params) => (params.value[2] === 1 ? '#ef232a' : '#14b143') } },
                { name: '周真实波幅比率(%)', type: 'line', data: trueRangeRatios, smooth: true, lineStyle: { width: 2, color: trColors['周真实波幅比率(%)'] }, yAxisIndex: 0 }
            ]
        };

        weeklyAmplitudeChart.setOption(option, true);
        
        const updateReadouts = () => {
            const dataZoom = weeklyAmplitudeChart.getOption().dataZoom[0];
            const startIndex = Math.floor(weeklyData.length * dataZoom.start / 100);
            const endIndex = Math.ceil(weeklyData.length * dataZoom.end / 100) - 1;
            calculateAndDisplayAverageTrueRanges(startIndex, endIndex);
            
            // Force y-axis label refresh
            weeklyAmplitudeChart.setOption({
                yAxis: [
                    {
                        axisLabel: {
                            formatter: (value) => {
                                const dataZoom = weeklyAmplitudeChart.getOption().dataZoom[0];
                                const startIndex = Math.floor(weeklyData.length * dataZoom.start / 100);
                                const endIndex = Math.ceil(weeklyData.length * dataZoom.end / 100) - 1;
                                
                                const visibleData = trueRangeRatios.slice(startIndex, endIndex + 1).filter(v => v !== '-');
                                if (visibleData.length === 0) {
                                    return `${value} %`;
                                }

                                const countAbove = visibleData.filter(v => parseFloat(v) > value).length;
                                const percentage = (countAbove / visibleData.length * 100).toFixed(2);
                                
                                return `${value} % (${percentage}%)`;
                            }
                        }
                    }
                ]
            });
        };

        weeklyAmplitudeChart.off('datazoom');
        weeklyAmplitudeChart.on('datazoom', updateReadouts);
        updateReadouts(); // Initial call
    };

    const renderKlineChart = (rawData, stockCode, stockName) => {
        klineTitleContainer.innerText = `${stockCode} - ${stockName} | K線走勢與均線`;
        klineTitleContainer.style.display = 'block';

        const dates = rawData.map(item => item.date);
        const closeData = rawData.map(item => item.close);
        const volumes = rawData.map((item, index) => [index, item.volume, item.open > item.close ? -1 : 1]);

        const calculateMA = (dayCount) => {
            const result = [];
            for (let i = 0, len = rawData.length; i < len; i++) {
                if (i < dayCount - 1) {
                    result.push('-');
                    continue;
                }
                let sum = 0;
                for (let j = 0; j < dayCount; j++) {
                    sum += rawData[i - j].close;
                }
                result.push(Number((sum / dayCount).toFixed(3)));
            }
            return result;
        };

        const ma20 = calculateMA(20);
        const ma60 = calculateMA(60);
        const ma240 = calculateMA(240);

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                formatter: function (params) {
                    if (!params || params.length === 0) return '';
                    let tooltipHtml = `<strong>${params[0].name}</strong><br/>`;
                    params.forEach(param => {
                        if (param.seriesType === 'line' && param.value !== undefined && param.value !== '-') {
                            tooltipHtml += `${param.marker} ${param.seriesName}: <strong>$${Number(param.value).toFixed(2)}</strong><br/>`;
                        } else if (param.seriesType === 'bar') {
                            tooltipHtml += `${param.marker} ${param.seriesName}: <strong>${param.value[1].toLocaleString()}</strong><br/>`;
                        }
                    });
                    return tooltipHtml;
                }
            },
            legend: { data: ['收盤價', 'MA20', 'MA60', 'MA240', '成交量'], top: 0 },
            grid: [
                { left: '10%', right: '8%', top: '10%', height: '55%' },
                { left: '10%', right: '8%', top: '70%', height: '15%' }
            ],
            xAxis: [
                { type: 'category', data: dates, boundaryGap: false },
                { type: 'category', gridIndex: 1, data: dates, boundaryGap: false, axisLabel: { show: false } }
            ],
            yAxis: [
                { type: 'value', scale: true, splitArea: { show: true } },
                { scale: true, gridIndex: 1, splitNumber: 2, axisLabel: { show: false }, splitLine: { show: false } }
            ],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0, 1], start: 70, end: 100 },
                { show: true, xAxisIndex: [0, 1], type: 'slider', top: '88%', start: 70, end: 100 }
            ],
            series: [
                { name: '收盤價', type: 'line', data: closeData, smooth: true, symbol: 'none', lineStyle: { width: 2, color: '#333' } },
                { name: 'MA20', type: 'line', data: ma20, smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: '#ff7300' } },
                { name: 'MA60', type: 'line', data: ma60, smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: '#387908' } },
                { name: 'MA240', type: 'line', data: ma240, smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: '#8884d8' } },
                { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes, itemStyle: { color: (params) => (params.value[2] === 1 ? '#ef232a' : '#14b143') } }
            ]
        };

        klineChart.setOption(option, true);
    };

    // --- 蛛網量化回測與參數尋優前端邏輯 ---

    const setupBacktestDefaults = (data, code, name) => {
        if (!data || data.length === 0) return;
        const prices = data.map(d => d.close);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const lastClose = data[data.length - 1].close;

        // 切換不同股票時，清空殘留的舊價格區間，避免舊標的價格範圍阻擋新標的交易
        if (!currentLoadedStock || currentLoadedStock.code !== code) {
            btLowerPrice.value = '';
            btUpperPrice.value = '';
        }

        currentLoadedStock = {
            code,
            name,
            kline: data,
            minPrice,
            maxPrice,
            lastClose,
            startDate: data[0].date,
            endDate: data[data.length - 1].date
        };

        btLowerPrice.placeholder = `最低: $${minPrice.toFixed(2)}`;
        btUpperPrice.placeholder = `最高: $${maxPrice.toFixed(2)}`;

        // 預設充足現金估算 (例如 10 張股票預備資金)
        const unitMultiplier = isTaiwanCode(code) ? 1000 : 100;
        const estimatedCash = Math.round(lastClose * unitMultiplier * 10 * 1.2);
        btInitialCash.placeholder = `預設建議: $${estimatedCash.toLocaleString()}`;

        updateUnitLabels(code);
    };

    // 智能參數尋優處理 (一目了然獲取最佳效益)
    const triggerAutoOptimization = async () => {
        const stockCodeWithPossibleName = stockCodeInput.value.trim();
        const stockCode = stockCodeWithPossibleName.split(' ')[0];
        if (!stockCode) return;

        btnRunOptimize.disabled = true;
        optSpinner.style.display = 'inline-block';
        optimizeHintText.innerText = `正在為 ${stockCode} 執行全區間間距尋優掃描（1% ~ 10%）...`;

        let lowerVal = btLowerPrice.value ? parseFloat(btLowerPrice.value) : '';
        let upperVal = btUpperPrice.value ? parseFloat(btUpperPrice.value) : '';
        if (currentLoadedStock) {
            if (upperVal && upperVal <= currentLoadedStock.minPrice) upperVal = '';
            if (lowerVal && lowerVal >= currentLoadedStock.maxPrice) lowerVal = '';
        }

        const params = {
            symbol: stockCode,
            stockName: (currentLoadedStock && currentLoadedStock.code === stockCode) ? currentLoadedStock.name : undefined,
            kline: (currentLoadedStock && currentLoadedStock.code === stockCode) ? currentLoadedStock.kline : undefined,
            startDate: startDateInput.value || '',
            endDate: endDateInput.value || '',
            orderQuantity: btOrderQuantity.value || 1,
            initialStock: btInitialStock.value || 0,
            maxStock: btMaxStock.value || '',
            minStock: btMinStock.value || 0,
            initialCash: btInitialCash.value || '',
            lowerPrice: lowerVal,
            upperPrice: upperVal
        };


        try {
            const res = await fetch('/api/backtest/optimize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '尋優計算失敗');

            latestOptimizationResult = data;
            renderOptimizationResults(data);
            optimizeHintText.style.display = 'none';
        } catch (err) {
            optimizeHintText.innerText = `尋優掃描未完成: ${err.message}`;
            optimizeHintText.className = 'text-center text-danger py-2';
        } finally {
            btnRunOptimize.disabled = false;
            optSpinner.style.display = 'none';
        }
    };

    // 渲染尋優推薦看板與長條圖
    const renderOptimizationResults = (data) => {
        optimizeRecCards.style.display = 'flex';
        optimizeChartContainer.style.display = 'block';
        optimizeTableContainer.style.display = 'block';

        const rec = data.recommendations;
        const unit = data.unitInfo?.unitName || (isTaiwanCode(data.symbol) ? '張' : '手');

        // 1. 最高套利純獲利配置
        const br = rec.bestReturn;
        recBestReturnTitle.innerText = `跳動間距 ${br.gridPercent}%`;
        const brProfit = Math.round(br.realizedProfit).toLocaleString();
        const brGridRet = (br.gridReturn * 100).toFixed(2);
        recBestReturnDesc.innerHTML = `波動套利純獲利: <strong class="text-success fs-6">+$${brProfit}</strong> (套利報酬 +${brGridRet}%)<br/>平倉套利: <strong>${br.closedTrades} 筆</strong> (勝率 ${(br.winRate * 100).toFixed(0)}%) | 最大佔用本金: $${Math.round(br.maxCapitalDeployed).toLocaleString()}`;

        // 2. 最穩健配置
        const bb = rec.bestBalanced;
        recBestBalancedTitle.innerText = `跳動間距 ${bb.gridPercent}%`;
        const bbProfit = Math.round(bb.realizedProfit).toLocaleString();
        const bbGridRet = (bb.gridReturn * 100).toFixed(2);
        recBestBalancedDesc.innerHTML = `波動套利純獲利: <strong class="text-info-emphasis">+$${bbProfit}</strong> (套利報酬 +${bbGridRet}%)<br/>最大回撤僅 <strong>${(bb.maxDrawdown * 100).toFixed(1)}%</strong> | 平倉 ${bb.closedTrades} 筆 (風報比最佳)`;

        // 3. ATR 建議
        const atrPct = rec.atrRecommendedPercent;
        recAtrTitle.innerText = `跳動間距 ${atrPct}%`;
        recAtrDesc.innerHTML = `歷史平均日波幅為 <strong>${data.avgDailyVolatilityPct}%</strong><br/>推薦間距能有效捕捉日常震盪套利`;

        // 綁定一鍵套用按鈕
        btnApplyBestReturn.onclick = () => applyGridPercentAndRun(br.gridPercent);
        btnApplyBestBalanced.onclick = () => applyGridPercentAndRun(bb.gridPercent);
        btnApplyAtr.onclick = () => applyGridPercentAndRun(atrPct);

        // 渲染參數效益柱狀對比圖
        renderOptimizationChart(data.ranking);

        // 渲染排行表格 (對應 8 欄表頭)
        optimizeTableBody.innerHTML = '';
        data.ranking.forEach(item => {
            const tr = document.createElement('tr');
            const profitStr = Math.round(item.realizedProfit).toLocaleString();
            const gridRetPct = (item.gridReturn * 100).toFixed(2);
            const isBest = item.gridPercent === br.gridPercent;
            tr.className = isBest ? 'table-success fw-bold' : '';

            tr.innerHTML = `
                <td>${item.gridPercent}% ${isBest ? '🏆' : ''}</td>
                <td class="text-profit fw-bold">+$${profitStr}</td>
                <td class="text-success fw-bold">+${gridRetPct}%</td>
                <td>${item.closedTrades} 筆</td>
                <td><span class="badge bg-success-subtle text-success">${(item.winRate * 100).toFixed(0)}%</span></td>
                <td>$${Math.round(item.maxCapitalDeployed).toLocaleString()}</td>
                <td>${item.finalStockUnits || 0} ${unit}</td>
                <td><button class="btn btn-sm ${isBest ? 'btn-success' : 'btn-outline-primary'} py-0 px-2 btn-apply-row" data-percent="${item.gridPercent}">套用</button></td>
            `;
            optimizeTableBody.appendChild(tr);
        });

        document.querySelectorAll('.btn-apply-row').forEach(btn => {
            btn.addEventListener('click', () => applyGridPercentAndRun(parseFloat(btn.dataset.percent)));
        });

        optimizeChart.resize();
    };

    // 套用特定間距並直接執行回測
    const applyGridPercentAndRun = (percent) => {
        btGridPercent.value = percent;
        showStatus(`已套用建議跳動間距 ${percent}%，正在執行精準回測...`, 'info');
        backtestForm.dispatchEvent(new Event('submit', { cancelable: true }));
        // 滾動至回測結果圖表
        backtestSummaryContainer.scrollIntoView({ behavior: 'smooth' });
    };

    // 繪製參數效益柱狀圖
    const renderOptimizationChart = (ranking) => {
        const sortedByPercent = [...ranking].sort((a, b) => a.gridPercent - b.gridPercent);
        const xPercents = sortedByPercent.map(r => `${r.gridPercent}%`);
        const profitData = sortedByPercent.map(r => Math.round(r.realizedProfit));
        const gridReturnData = sortedByPercent.map(r => Number((r.gridReturn * 100).toFixed(2)));

        const option = {
            title: {
                text: '各跳動間距 (%) 波動套利純獲利與套利報酬率對比圖 (尋找最高效益甜蜜點)',
                left: 'center',
                textStyle: { fontSize: 14, fontWeight: 500 }
            },
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    let html = `<strong>跳動間距: ${params[0].name}</strong><br/>`;
                    params.forEach(p => {
                        if (p.seriesName.includes('純獲利')) {
                            html += `${p.marker} ${p.seriesName}: <strong>+$${p.value.toLocaleString()}</strong><br/>`;
                        } else {
                            html += `${p.marker} ${p.seriesName}: <strong>+${p.value}%</strong><br/>`;
                        }
                    });
                    html += `<small class="text-primary">點擊柱狀圖可直接套用此間距回測</small>`;
                    return html;
                }
            },
            legend: { data: ['波動套利純獲利 ($)', '套利報酬率 (%)'], bottom: 0 },
            grid: { left: '8%', right: '8%', top: '18%', bottom: '18%' },
            xAxis: { type: 'category', data: xPercents, name: '網格間距' },
            yAxis: [
                { type: 'value', name: '純獲利 ($)', axisLabel: { formatter: function(v) { return `$${v.toLocaleString()}`; } } },
                { type: 'value', name: '報酬率 (%)', axisLabel: { formatter: '{value}%' }, splitLine: { show: false } }
            ],
            series: [
                {
                    name: '波動套利純獲利 ($)',
                    type: 'bar',
                    data: profitData,
                    itemStyle: {
                        color: '#198754'
                    }
                },
                {
                    name: '套利報酬率 (%)',
                    type: 'line',
                    yAxisIndex: 1,
                    data: gridReturnData,
                    lineStyle: { color: '#0d6efd', width: 3 },
                    itemStyle: { color: '#0d6efd' }
                }
            ]
        };

        optimizeChart.setOption(option, true);
        optimizeChart.off('click');
        optimizeChart.on('click', (params) => {
            if (params && params.name) {
                const pct = parseFloat(params.name);
                applyGridPercentAndRun(pct);
            }
        });
    };

    // 執行自訂條件單回測
    const handleBacktest = async (e) => {
        e.preventDefault();
        const stockCodeWithPossibleName = stockCodeInput.value.trim();
        const stockCode = stockCodeWithPossibleName.split(' ')[0];
        if (!stockCode) {
            showStatus('請先在上方輸入股票代號查詢行情。', 'warning');
            return;
        }

        btnRunBacktest.disabled = true;
        btSpinner.style.display = 'inline-block';
        backtestChart.showLoading();

        let lowerVal = btLowerPrice.value ? parseFloat(btLowerPrice.value) : '';
        let upperVal = btUpperPrice.value ? parseFloat(btUpperPrice.value) : '';
        if (currentLoadedStock) {
            if (upperVal && upperVal <= currentLoadedStock.minPrice) upperVal = '';
            if (lowerVal && lowerVal >= currentLoadedStock.maxPrice) lowerVal = '';
        }

        const params = {
            symbol: stockCode,
            stockName: (currentLoadedStock && currentLoadedStock.code === stockCode) ? currentLoadedStock.name : undefined,
            kline: (currentLoadedStock && currentLoadedStock.code === stockCode) ? currentLoadedStock.kline : undefined,
            startDate: startDateInput.value || '',
            endDate: endDateInput.value || '',
            gridPercent: btGridPercent.value,
            orderQuantity: btOrderQuantity.value || 1,
            initialStock: btInitialStock.value || 0,
            maxStock: btMaxStock.value || '',
            minStock: btMinStock.value || 0,
            initialCash: btInitialCash.value || '',
            lowerPrice: lowerVal,
            upperPrice: upperVal
        };


        try {
            const res = await fetch('/api/backtest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(params)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '回測失敗');

            renderBacktestResults(data);
            loadBacktestHistory();
            const profitStr = Math.round(data.summary.realizedProfit).toLocaleString();
            const gridRetPct = (data.summary.gridReturn * 100).toFixed(2);
            showStatus(`回測完成！${data.symbol} (${data.stockName}) 間距 ${data.initialParams.gridPercent}%，波動套利純獲利: +$${profitStr} (平倉套利 ${data.summary.closedTrades} 筆，勝率 ${(data.summary.winRate * 100).toFixed(0)}%)`, 'success');
        } catch (err) {
            showStatus(`回測執行發生異常: ${err.message}`, 'danger');
        } finally {
            btnRunBacktest.disabled = false;
            btSpinner.style.display = 'none';
            backtestChart.hideLoading();
        }
    };

    const renderBacktestResults = (data) => {
        backtestSummaryContainer.style.display = 'block';
        const sum = data.summary;
        const unit = data.unitInfo?.unitName || (isTaiwanCode(data.symbol) ? '張' : '手');

        // 1. 網格波動套利純獲利
        const profitEl = document.getElementById('res-grid-profit');
        if (profitEl) {
            profitEl.innerText = `+$${Math.round(sum.realizedProfit).toLocaleString()}`;
        }
        const gridRetEl = document.getElementById('res-grid-return');
        if (gridRetEl) {
            const grPct = (sum.gridReturn * 100).toFixed(2);
            const annGrPct = (sum.annualizedGridReturn * 100).toFixed(2);
            gridRetEl.innerHTML = `套利報酬: <strong class="text-success">+${grPct}%</strong> (年化 +${annGrPct}%)`;
        }

        // 2. 平倉套利筆數與勝率
        const tradesEl = document.getElementById('res-total-trades');
        if (tradesEl) {
            tradesEl.innerText = `${sum.closedTrades} 筆平倉 (總成交 ${sum.totalTrades} 筆)`;
        }
        const winEl = document.getElementById('res-win-rate');
        if (winEl) {
            winEl.innerText = `勝率: ${(sum.winRate * 100).toFixed(0)}% (低買高賣必賺)`;
        }

        // 3. 剩餘持倉與浮動盈虧
        const unrealEl = document.getElementById('res-unrealized-profit');
        if (unrealEl) {
            const unVal = Math.round(sum.unrealizedProfit);
            unrealEl.innerText = `${unVal >= 0 ? '+' : ''}$${unVal.toLocaleString()}`;
            unrealEl.className = `metric-value fs-5 ${unVal >= 0 ? 'text-profit' : 'text-loss'}`;
        }
        const finalStocksEl = document.getElementById('res-final-stocks');
        if (finalStocksEl) {
            finalStocksEl.innerText = `剩餘持股: ${sum.finalStockUnits || 0} ${unit}`;
        }

        // 4. 網格最大佔用本金
        const maxCapEl = document.getElementById('res-max-capital');
        if (maxCapEl) {
            maxCapEl.innerText = `$${Math.round(sum.maxCapitalDeployed).toLocaleString()}`;
        }

        // 5. 最大回撤
        const maxDdEl = document.getElementById('res-max-drawdown');
        if (maxDdEl) {
            maxDdEl.innerText = `${(sum.maxDrawdown * 100).toFixed(2)}%`;
        }

        // 6. 全組合期末總權益
        const eqCompareEl = document.getElementById('res-equity-compare');
        if (eqCompareEl) {
            eqCompareEl.innerText = `$${Math.round(sum.finalEquity).toLocaleString()}`;
        }
        const trEl = document.getElementById('res-total-return');
        if (trEl) {
            const trPct = (sum.totalReturn * 100).toFixed(2);
            trEl.innerHTML = `總資產變化: <strong class="${sum.totalReturn >= 0 ? 'text-profit' : 'text-loss'}">${trPct >= 0 ? '+' : ''}${trPct}%</strong>`;
        }

        renderBacktestChart(data.equityCurve, data.symbol, data.stockName, data.initialParams?.gridPercent);
        renderTradesTable(data.trades, unit);
    };

    const renderBacktestChart = (equityCurve, symbol, name, gridPercent) => {
        if (!equityCurve || equityCurve.length === 0) return;
        const dates = equityCurve.map(e => e.date);
        const strategyValues = equityCurve.map(e => e.equity);
        const benchmarkValues = equityCurve.map(e => e.benchmarkEquity);

        const option = {
            title: {
                text: `${symbol} ${name ? '- ' + name : ''} 蛛網策略資產淨值走勢 vs 標的買進持有基準 (間距 ${gridPercent || ''}%)`,
                left: 'center',
                textStyle: { fontSize: 15, fontWeight: 500 }
            },
            tooltip: {
                trigger: 'axis',
                formatter: function (params) {
                    if (!params || params.length === 0) return '';
                    const idx = params[0].dataIndex;
                    const item = equityCurve[idx];
                    let html = `<div style="font-weight:600;margin-bottom:4px;">${item.date}</div>`;
                    html += `<div>標的收盤價: <strong>$${item.close.toFixed(2)}</strong></div>`;
                    html += `<div style="color:#0d6efd;">蛛網策略總權益: <strong>$${item.equity.toLocaleString()}</strong></div>`;
                    html += `<div style="color:#6c757d;">買進持有基準權益: <strong>$${item.benchmarkEquity.toLocaleString()}</strong></div>`;
                    html += `<div style="font-size:0.85rem;color:#888;">持股: ${item.stockUnits || 0} 張/手 | 現金: $${Math.round(item.cash).toLocaleString()}</div>`;
                    return html;
                }
            },
            legend: {
                data: ['蛛網策略資產淨值', '標的買進持有基準'],
                bottom: 0
            },
            grid: { left: '6%', right: '4%', top: '15%', bottom: '15%' },
            xAxis: { type: 'category', data: dates, boundaryGap: false },
            yAxis: {
                type: 'value',
                scale: true,
                axisLabel: { formatter: function (v) { return `$${v.toLocaleString()}`; } }
            },
            dataZoom: [
                { type: 'inside', start: 0, end: 100 },
                { type: 'slider', bottom: '5%', start: 0, end: 100 }
            ],
            series: [
                {
                    name: '蛛網策略資產淨值',
                    type: 'line',
                    data: strategyValues,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 3, color: '#0d6efd' },
                    areaStyle: {
                        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                            { offset: 0, color: 'rgba(13,110,253,0.25)' },
                            { offset: 1, color: 'rgba(13,110,253,0.01)' }
                        ])
                    }
                },
                {
                    name: '標的買進持有基準',
                    type: 'line',
                    data: benchmarkValues,
                    smooth: true,
                    symbol: 'none',
                    lineStyle: { width: 2, color: '#adb5bd', type: 'dashed' }
                }
            ]
        };

        backtestChart.setOption(option, true);
    };

    const renderTradesTable = (trades, unit) => {
        tradesTableBody.innerHTML = '';
        if (!trades || trades.length === 0) {
            tradesTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">本次回測區間內未觸發任何買賣條件</td></tr>`;
            tradesCountBadge.innerText = '0 筆';
            return;
        }

        tradesCountBadge.innerText = `${trades.length} 筆`;
        trades.forEach(tr => {
            const isBuy = tr.type === 'buy';
            const trRow = document.createElement('tr');
            const pnlText = tr.pnl !== undefined
                ? `<span class="${tr.pnl >= 0 ? 'text-profit' : 'text-loss'} fw-bold">${tr.pnl >= 0 ? '+' : ''}$${tr.pnl.toLocaleString()}</span>`
                : '-';

            trRow.innerHTML = `
                <td><small>${tr.date}</small></td>
                <td><span class="badge ${isBuy ? 'bg-danger' : 'bg-success'}">${isBuy ? '買進' : '賣出'}</span></td>
                <td>$${tr.price.toFixed(2)}</td>
                <td>${tr.units} ${tr.unitName || unit}</td>
                <td>$${Math.round(tr.amount).toLocaleString()}</td>
                <td>${pnlText}</td>
                <td><small class="text-muted">${tr.note || '-'}</small></td>
            `;
            tradesTableBody.appendChild(trRow);
        });
    };

    const loadBacktestHistory = async () => {
        try {
            const res = await fetch('/api/backtest/history?limit=15');
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            historyTableBody.innerHTML = '';
            const records = data.records || [];
            if (records.length === 0) {
                historyTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">暫無歷史存檔（回測後自動寫入 D1 資料庫）</td></tr>`;
                return;
            }

            records.forEach(rec => {
                const trRow = document.createElement('tr');
                const retPct = (rec.total_return * 100).toFixed(1);
                const retClass = rec.total_return >= 0 ? 'text-profit' : 'text-loss';
                trRow.innerHTML = `
                    <td><strong>${rec.symbol}</strong><br><small class="text-muted">${rec.stock_name || ''}</small></td>
                    <td>
                        <small>間距 ${rec.grid_percent}%</small><br>
                        <span class="${retClass} fw-bold">${retPct >= 0 ? '+' : ''}${retPct}%</span>
                    </td>
                    <td><small>${(rec.max_drawdown * 100).toFixed(1)}%</small></td>
                    <td><button class="btn btn-sm btn-outline-primary btn-load-history" data-id="${rec.id}">載入</button></td>
                `;
                historyTableBody.appendChild(trRow);
            });

            document.querySelectorAll('.btn-load-history').forEach(btn => {
                btn.addEventListener('click', () => loadBacktestDetail(btn.dataset.id));
            });
        } catch (err) {
            console.warn('載入歷史失敗:', err);
            historyTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">歷史紀錄讀取異常: ${err.message}</td></tr>`;
        }
    };

    const loadBacktestDetail = async (id) => {
        try {
            showStatus(`正在載入歷史回測存檔 #${id}...`, 'info');
            const res = await fetch(`/api/backtest/history?id=${id}`);
            const rec = await res.json();
            if (!res.ok) throw new Error(rec.error);

            renderBacktestResults({
                symbol: rec.symbol,
                stockName: rec.stock_name,
                initialParams: {
                    gridPercent: rec.grid_percent,
                    orderQuantityUnits: rec.order_quantity,
                    initialStockUnits: rec.initial_stock,
                    maxStockUnits: rec.max_stock,
                    minStockUnits: rec.min_stock,
                    totalInitialEquity: rec.total_initial_equity || rec.initial_cash
                },
                summary: {
                    realizedProfit: rec.realized_profit !== undefined ? rec.realized_profit : Math.max(0, (rec.final_equity - (rec.total_initial_equity || rec.initial_cash || 0))),
                    gridReturn: rec.grid_return !== undefined ? rec.grid_return : (rec.total_return || 0),
                    annualizedGridReturn: rec.annualized_grid_return || rec.annualized_return || rec.total_return || 0,
                    maxCapitalDeployed: rec.max_capital_deployed || rec.total_initial_equity || rec.initial_cash || 100000,
                    unrealizedProfit: rec.unrealized_profit !== undefined ? rec.unrealized_profit : 0,
                    totalInitialEquity: rec.total_initial_equity || rec.initial_cash,
                    finalEquity: rec.final_equity,
                    finalStockUnits: rec.initial_stock || 0,
                    totalReturn: rec.total_return,
                    annualizedReturn: rec.annualized_return || rec.total_return,
                    maxDrawdown: rec.max_drawdown,
                    winRate: rec.win_rate !== undefined ? rec.win_rate : 1,
                    totalTrades: rec.total_trades,
                    closedTrades: rec.total_trades
                },
                trades: rec.trade_records || [],
                equityCurve: rec.equity_curve || []
            });

            const backtestTabBtn = document.getElementById('backtest-tab');
            if (backtestTabBtn) {
                const tab = new bootstrap.Tab(backtestTabBtn);
                tab.show();
            }

            showStatus(`已還原歷史回測紀錄: ${rec.symbol} (${rec.stock_name}) 間距 ${rec.grid_percent}%`, 'success');
        } catch (err) {
            showStatus(`還原歷史回測失敗: ${err.message}`, 'danger');
        }
    };

    // --- 事件監聽與系統初始化 ---
    echarts.connect([amplitudeChart, klineChart, weeklyAmplitudeChart]);

    window.addEventListener('resize', () => {
        amplitudeChart.resize();
        klineChart.resize();
        weeklyAmplitudeChart.resize();
        backtestChart.resize();
        optimizeChart.resize();
    });

    document.querySelectorAll('#chart-tabs .nav-link').forEach(tabEl => {
        tabEl.addEventListener('shown.bs.tab', (event) => {
            amplitudeChart.resize();
            klineChart.resize();
            weeklyAmplitudeChart.resize();
            backtestChart.resize();
            optimizeChart.resize();
            
            const activeTabId = event.target.id;
            analysisTitleContainer.style.display = activeTabId === 'analysis-tab' ? 'block' : 'none';
            averageAmplitudeContainer.style.display = activeTabId === 'analysis-tab' ? 'block' : 'none';
            klineTitleContainer.style.display = activeTabId === 'kline-tab' ? 'block' : 'none';
            weeklyAnalysisTitleContainer.style.display = activeTabId === 'weekly-analysis-tab' ? 'block' : 'none';
            weeklyAverageAmplitudeContainer.style.display = activeTabId === 'weekly-analysis-tab' ? 'block' : 'none';
        });
    });

    if (backtestForm) {
        backtestForm.addEventListener('submit', handleBacktest);
    }
    if (btnRunOptimize) {
        btnRunOptimize.addEventListener('click', triggerAutoOptimization);
    }
    if (btnRefreshHistory) {
        btnRefreshHistory.addEventListener('click', loadBacktestHistory);
    }

    initDB().then(() => {
        loadSearchHistory();
        loadBacktestHistory();
        queryForm.addEventListener('submit', handleQuery);
        showStatus("系統已就緒。請輸入股票代號（例如台股 2330、0050 或陸股 600519）查詢行情。", "success");
    }).catch(err => {
        showStatus(`初始化失敗: ${err}`, 'danger');
    });
});