document.addEventListener('DOMContentLoaded', () => {
    // --- Constants and Global Variables ---
    const DB_NAME = 'StockDataDB';
    const DB_VERSION = 5;
    const KLINE_STORE_NAME = 'kline_data';
    const NAME_STORE_NAME = 'stock_names';
    const SEARCH_HISTORY_KEY = 'stockSearchHistory';
    let db;

    // --- DOM Elements ---
    const queryForm = document.getElementById('query-form');
    const stockCodeInput = document.getElementById('stock-code-input');
    const startDateInput = document.getElementById('start-date-input');
    const endDateInput = document.getElementById('end-date-input');
    const statusMessage = document.getElementById('status-message');

    // Set default values for inputs
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const dd = String(today.getDate()).padStart(2, '0');
    endDateInput.value = `${yyyy}-${mm}-${dd}`;

    const lastStockCode = localStorage.getItem('lastStockCode');
    const lastStartDate = localStorage.getItem('lastStartDate');

    if (lastStockCode) {
        stockCodeInput.value = lastStockCode;
    }
    if (lastStartDate) {
        startDateInput.value = lastStartDate;
    }
    
    const chartContainer = document.getElementById('chart-container');
    const klineChartContainer = document.getElementById('kline-chart-container');
    const amplitudeChart = echarts.init(chartContainer);
    const klineChart = echarts.init(klineChartContainer);

    const analysisTitleContainer = document.getElementById('analysis-title-container');
    const averageAmplitudeContainer = document.getElementById('average-amplitude-container');
    const klineTitleContainer = document.getElementById('kline-title-container');

    // --- Utility Functions ---
    const showStatus = (message, type = 'info') => {
        statusMessage.innerHTML = message;
        statusMessage.className = `alert alert-${type} mt-3`;
        statusMessage.style.display = 'block';
    };

    // --- Search History Functions ---
    const loadSearchHistory = () => {
        const history = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) || [];
        const dataList = document.getElementById('stock-code-list');
        dataList.innerHTML = ''; // Clear existing options
        history.forEach(item => {
            const option = document.createElement('option');
            option.value = `${item.code} - ${item.name}`;
            dataList.appendChild(option);
        });
    };

    const updateSearchHistory = (code, name) => {
        let history = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) || [];
        // Remove existing entry if it's there
        history = history.filter(item => item.code !== code);
        // Add new entry to the front
        history.unshift({ code, name });
        // Keep only the last 10 entries
        if (history.length > 10) {
            history = history.slice(0, 10);
        }
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
        // Reload the datalist to show the new history
        loadSearchHistory();
    };

    // --- Database Functions ---
    const initDB = () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (event) => reject(`数据库初始化失败: ${event.target.error}`);
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

    // --- Core Logic ---
    async function fetchDataFromLocalServer(code) {
        const url = `http://localhost:3000/api/kline?symbol=${code}`;
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `HTTP error! status: ${response.status}` }));
            throw new Error(errorData.error || 'Server returned an error');
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
        [analysisTitleContainer, averageAmplitudeContainer, klineTitleContainer].forEach(c => c.style.display = 'none');

        const stockCodeWithPossibleName = stockCodeInput.value.trim();
        const stockCode = stockCodeWithPossibleName.split(' ')[0];
        const startDate = startDateInput.value || '0000-01-01';
        const endDate = endDateInput.value || '9999-12-31';

        if (!stockCode) {
            showStatus('请输入一个股票或ETF代码', 'warning');
            [amplitudeChart, klineChart].forEach(c => c.hideLoading());
            return;
        }

        const queryDB = (code, start, end) => {
            return new Promise((resolve, reject) => {
                const range = IDBKeyRange.bound([code, start], [code, end]);
                const request = db.transaction(KLINE_STORE_NAME, 'readonly').objectStore(KLINE_STORE_NAME).getAll(range);
                request.onerror = (e) => reject(e.target.error);
                request.onsuccess = () => resolve(request.result.sort((a, b) => a.date.localeCompare(b.date)));
            });
        };

        try {
            let dataToRender = await queryDB(stockCode, startDate, endDate);
            let stockName = await getStockName(stockCode);

            if (dataToRender.length > 0 && stockName !== stockCode) {
                updateSearchHistory(stockCode, stockName);
            }

            if (dataToRender.length === 0) {
                showStatus(`本地无 ${stockCode} 数据，正在从网络获取...`, 'info');
                const serverResponse = await fetchDataFromLocalServer(stockCode);
                await saveData(serverResponse.kline, stockCode, serverResponse.name);
                stockName = serverResponse.name;
                dataToRender = await queryDB(stockCode, startDate, endDate);
                if (stockName && stockName !== stockCode) {
                    updateSearchHistory(stockCode, stockName);
                }
            }

            if (dataToRender.length === 0) {
                showStatus('在指定的时间范围内没有找到数据，或无法从网络获取。', 'warning');
                [amplitudeChart, klineChart].forEach(c => c.clear());
            } else {
                showStatus(`成功加载 ${dataToRender.length} 条数据进行图表渲染。`, 'success');
                renderCharts(dataToRender, stockCode, stockName);
                document.getElementById('chart-tabs').style.display = 'flex';

                // Save last successful query parameters
                localStorage.setItem('lastStockCode', `${stockCode} - ${stockName}`);
                localStorage.setItem('lastStartDate', startDateInput.value);
            }
        } catch (error) {
            showStatus(`查询或获取数据时发生错误: ${error.message}`, 'danger');
        } finally {
            [amplitudeChart, klineChart].forEach(c => c.hideLoading());
        }
    };

    const renderCharts = (rawData, stockCode, stockName) => {
        renderAmplitudeChart(rawData, stockCode, stockName);
        renderKlineChart(rawData, stockCode, stockName);
    };

    const renderAmplitudeChart = (rawData, stockCode, stockName) => {
        analysisTitleContainer.innerText = `${stockCode} - ${stockName} | 振幅与成交量分析`;
        analysisTitleContainer.style.display = 'block';

        const dates = rawData.map(item => item.date);
        const volumes = rawData.map((item, index) => [index, item.volume, item.open > item.close ? -1 : 1]);
        const amplitudes = rawData.map(item => ((item.high - item.low) / item.low * 100).toFixed(2));

        const getWeek = (date) => {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
            const week1 = new Date(d.getFullYear(), 0, 4);
            return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
        };

        const weeklyData = {};
        rawData.forEach(item => {
            const year = new Date(item.date).getFullYear();
            const week = getWeek(item.date);
            const weekKey = `${year}-W${week}`;
            if (!weeklyData[weekKey]) {
                weeklyData[weekKey] = { high: -Infinity, low: Infinity, endDate: '' };
            }
            weeklyData[weekKey].high = Math.max(weeklyData[weekKey].high, item.high);
            weeklyData[weekKey].low = Math.min(weeklyData[weekKey].low, item.low);
            weeklyData[weekKey].endDate = item.date;
        });

        const weeklyAmplitudes = rawData.map(item => {
            const year = new Date(item.date).getFullYear();
            const week = getWeek(item.date);
            const weekKey = `${year}-W${week}`;
            if (item.date === weeklyData[weekKey].endDate && weeklyData[weekKey].low > 0) {
                return ((weeklyData[weekKey].high - weeklyData[weekKey].low) / weeklyData[weekKey].low * 100).toFixed(2);
            }
            return '-';
        });

        const calculateAndDisplayAverageAmplitudes = (startIdx, endIdx) => {
            const visibleData = rawData.slice(startIdx, endIdx + 1);
            if (visibleData.length === 0) {
                averageAmplitudeContainer.innerHTML = '';
                averageAmplitudeContainer.style.display = 'none';
                return;
            }

            let dailyTotal = 0, dailyCount = 0;
            visibleData.forEach(item => {
                if (item.low > 0) {
                    dailyTotal += ((item.high - item.low) / item.low * 100);
                    dailyCount++;
                }
            });

            let weeklyTotal = 0, weeklyCount = 0;
            const visibleWeeklyKeys = new Set();
            for (let i = startIdx; i <= endIdx; i++) {
                const item = rawData[i];
                const year = new Date(item.date).getFullYear();
                const week = getWeek(item.date);
                const weekKey = `${year}-W${week}`;
                if (!visibleWeeklyKeys.has(weekKey) && weeklyAmplitudes[i] !== '-') {
                    const weekInfo = weeklyData[weekKey];
                    if (weekInfo.low > 0) {
                        weeklyTotal += ((weekInfo.high - weekInfo.low) / weekInfo.low * 100);
                        weeklyCount++;
                        visibleWeeklyKeys.add(weekKey);
                    }
                }
            }
            const avgDaily = dailyCount ? `${(dailyTotal / dailyCount).toFixed(2)}%` : 'N/A';
            const avgWeekly = weeklyCount ? `${(weeklyTotal / weeklyCount).toFixed(2)}%` : 'N/A';

            averageAmplitudeContainer.innerHTML = `
                <span class="me-4"><strong>可视区域平均日振幅:</strong> ${avgDaily}</span>
                <span><strong>可视区域平均周振幅:</strong> ${avgWeekly}</span>`;
            averageAmplitudeContainer.style.display = 'block';
        };

        const option = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
            legend: { data: ['日振幅(%)', '周振幅(%)'], top: 0, inactiveColor: '#777' },
            grid: [
                { left: '10%', right: '8%', top: '10%', height: '50%' },
                { left: '10%', right: '8%', top: '65%', height: '15%' }
            ],
            xAxis: [
                { type: 'category', data: dates, scale: true, boundaryGap: false, axisLine: { show: false }, splitLine: { show: false }, min: 'dataMin', max: 'dataMax' },
                { type: 'category', gridIndex: 1, data: dates, scale: true, boundaryGap: false, axisLine: { onZero: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, min: 'dataMin', max: 'dataMax' }
            ],
            yAxis: [
                { scale: true, splitArea: { show: false }, axisLine: { show: false }, axisLabel: { formatter: '{value} %' } },
                { scale: true, gridIndex: 1, splitNumber: 2, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } }
            ],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0, 1], start: 80, end: 100 },
                { show: true, xAxisIndex: [0, 1], type: 'slider', top: '85%', start: 80, end: 100 }
            ],
            series: [
                { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes, itemStyle: { color: (params) => (params.value[2] === 1 ? '#ef232a' : '#14b143') } },
                { name: '日振幅(%)', type: 'line', data: amplitudes, smooth: true, lineStyle: { width: 2, color: '#4a90e2' }, yAxisIndex: 0 },
                { name: '周振幅(%)', type: 'line', data: weeklyAmplitudes, smooth: true, lineStyle: { width: 2, color: '#FFD700' }, yAxisIndex: 0, connectNulls: true }
            ]
        };

        amplitudeChart.setOption(option, true);
        
        const updateAverageAmplitudes = () => {
            const dataZoom = amplitudeChart.getOption().dataZoom[0];
            const startIndex = Math.floor(rawData.length * dataZoom.start / 100);
            const endIndex = Math.ceil(rawData.length * dataZoom.end / 100) - 1;
            calculateAndDisplayAverageAmplitudes(startIndex, endIndex);
        };

        amplitudeChart.off('datazoom');
        amplitudeChart.on('datazoom', updateAverageAmplitudes);
        updateAverageAmplitudes(); // Initial call
    };

    const renderKlineChart = (rawData, stockCode, stockName) => {
        klineTitleContainer.innerText = `${stockCode} - ${stockName} | K线图与成交量`;
        klineTitleContainer.style.display = 'block';

        const dates = rawData.map(item => item.date);
        const klineData = rawData.map(item => [item.open, item.close, item.low, item.high]);
        const volumes = rawData.map((item, index) => [index, item.volume, item.open > item.close ? -1 : 1]);

        const calculateMA = (dayCount, data) => {
            let result = [];
            for (let i = 0, len = data.length; i < len; i++) {
                if (i < dayCount - 1) {
                    result.push('-');
                    continue;
                }
                let sum = 0;
                for (let j = 0; j < dayCount; j++) {
                    sum += parseFloat(data[i - j].close);
                }
                result.push((sum / dayCount).toFixed(2));
            }
            return result;
        };

                const allMaDays = [5, 20, 60, 240];
        const availableMaDays = allMaDays.filter(day => rawData.length >= day);
        
        const legendData = [...availableMaDays.map(day => `MA${day}`)];
        
        const maSeries = availableMaDays.map(day => ({
            name: `MA${day}`,
            type: 'line',
            data: calculateMA(day, rawData),
            smooth: true,
            lineStyle: { opacity: 0.5 }
        }));

        const option = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
            legend: { data: legendData, top: 0, inactiveColor: '#777' },
            grid: [
                { left: '10%', right: '8%', top: '10%', height: '50%' },
                { left: '10%', right: '8%', top: '65%', height: '15%' }
            ],
            xAxis: [
                { type: 'category', data: dates, scale: true, boundaryGap: false, axisLine: { onZero: false }, splitLine: { show: false }, min: 'dataMin', max: 'dataMax' },
                { type: 'category', gridIndex: 1, data: dates, scale: true, boundaryGap: false, axisLine: { onZero: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, min: 'dataMin', max: 'dataMax' }
            ],
            yAxis: [
                { scale: true, splitArea: { show: true } },
                { scale: true, gridIndex: 1, splitNumber: 2, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } }
            ],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0, 1], start: 80, end: 100 },
                { show: true, xAxisIndex: [0, 1], type: 'slider', top: '85%', start: 80, end: 100 }
            ],
            series: [
                { name: 'K线', type: 'candlestick', data: klineData, itemStyle: { color: '#ef232a', color0: '#14b143', borderColor: '#ef232a', borderColor0: '#14b143' } },
                { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes, itemStyle: { color: (params) => (params.value[2] === 1 ? '#ef232a' : '#14b143') } },
                ...maSeries
            ]
        };

        klineChart.setOption(option, true);
    };
    
    // --- Event Listeners and Initialization ---
    echarts.connect([amplitudeChart, klineChart]);

    window.addEventListener('resize', () => {
        amplitudeChart.resize();
        klineChart.resize();
    });

    document.querySelectorAll('#chart-tabs .nav-link').forEach(tabEl => {
        tabEl.addEventListener('shown.bs.tab', (event) => {
            amplitudeChart.resize();
            klineChart.resize();
            
            const isAnalysisTab = event.target.id === 'analysis-tab';
            analysisTitleContainer.style.display = isAnalysisTab ? 'block' : 'none';
            averageAmplitudeContainer.style.display = isAnalysisTab ? 'block' : 'none';
            klineTitleContainer.style.display = isAnalysisTab ? 'none' : 'block';
        });
    });

    initDB().then(() => {
        loadSearchHistory();
        queryForm.addEventListener('submit', handleQuery);
        showStatus("系统准备就绪。请输入股票代码查询。", "success");
    }).catch(err => {
        showStatus(`初始化失败: ${err}`, 'danger');
    });
});
