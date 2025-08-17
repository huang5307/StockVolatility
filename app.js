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

    const stockCodeList = document.getElementById('stock-code-list');

    // --- Utility Functions ---
    const showStatus = (message, type = 'info') => {
        statusMessage.innerHTML = message;
        statusMessage.className = `alert alert-${type} mt-3`;
        statusMessage.style.display = 'block';
    };

    // --- Search History Functions ---
    const loadSearchHistory = () => {
        const history = JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY)) || [];
        stockCodeList.innerHTML = ''; // Clear existing items
        
        if (history.length === 0) {
            const li = document.createElement('li');
            li.innerHTML = `<span class="dropdown-item-text">无历史记录</span>`;
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
                // Optionally, trigger the query directly
                queryForm.dispatchEvent(new Event('submit', { cancelable: true }));
            });
            li.appendChild(a);
            stockCodeList.appendChild(li);
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
        const url = `/api/kline?symbol=${code}`;
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
        const startDate = startDateInput.value || '2000-01-01';
        const endDate = endDateInput.value || '9999-12-31';

        if (!stockCode) {
            showStatus('请输入一个股票或ETF代码', 'warning');
            [amplitudeChart, klineChart].forEach(c => c.hideLoading());
            return;
        }

        // Adjust start date to get historical data for calculations (e.g., MA240)
        let queryStartDate = new Date(startDate);
        queryStartDate.setDate(queryStartDate.getDate() - 365); // Go back ~1 year
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
            // Always try to fetch fresh data first
            showStatus(`正在从网络获取 ${stockCode} 的最新数据...`, 'info');
            const serverResponse = await fetchDataFromLocalServer(stockCode);
            await saveData(serverResponse.kline, stockCode, serverResponse.name);
            const stockName = serverResponse.name;
            
            if (stockName && stockName !== stockCode) {
                updateSearchHistory(stockCode, stockName);
            }

            // Now query the updated DB with the desired date range
            const allData = await queryDB(stockCode, queryStartDateString, endDate);

            if (allData.length === 0) {
                showStatus('在指定的时间范围内没有找到数据。', 'warning');
                [amplitudeChart, klineChart].forEach(c => c.clear());
            } else {
                showStatus(`成功加载 ${allData.length} 条数据进行图表渲染。`, 'success');
                renderCharts(allData, stockCode, stockName);
                document.getElementById('chart-tabs').style.display = 'flex';

                localStorage.setItem('lastStockCode', `${stockCode} - ${stockName}`);
                localStorage.setItem('lastStartDate', startDateInput.value);
            }

        } catch (fetchError) {
            // If fetching from server fails, try to use local data as a fallback
            try {
                const stockName = await getStockName(stockCode);
                const allData = await queryDB(stockCode, queryStartDateString, endDate);

                if (allData.length === 0) {
                    // If DB is also empty, show the original network error, which is more specific.
                    showStatus(`错误: ${fetchError.message}`, 'danger');
                    [amplitudeChart, klineChart].forEach(c => c.clear());
                } else {
                    // If we have cached data, show a warning about the network and render the old data.
                    showStatus(`无法从网络获取数据: ${fetchError.message}。正在显示本地缓存...`, 'warning');
                    renderCharts(allData, stockCode, stockName);
                    document.getElementById('chart-tabs').style.display = 'flex';
                    localStorage.setItem('lastStockCode', `${stockCode} - ${stockName}`);
                    localStorage.setItem('lastStartDate', startDateInput.value);
                }
            } catch (dbError) {
                showStatus(`网络和本地缓存查询均失败: ${dbError.message}`, 'danger');
            }
        } finally {
            [amplitudeChart, klineChart].forEach(c => c.hideLoading());
        }
    };

    const renderCharts = (rawData, stockCode, stockName) => {
        renderTrueRangeChart(rawData, stockCode, stockName);
        renderKlineChart(rawData, stockCode, stockName);
    };

    const renderTrueRangeChart = (rawData, stockCode, stockName) => {
        analysisTitleContainer.innerText = `${stockCode} - ${stockName} | 真实波幅与成交量分析`;
        analysisTitleContainer.style.display = 'block';

        const dates = rawData.map(item => item.date);
        const volumes = rawData.map((item, index) => [index, item.volume, item.open > item.close ? -1 : 1]);

        // 1. Calculate Daily True Range
        const dailyTR = rawData.map((item, i) => {
            if (i === 0) return '-'; // Not enough data for TR
            const high = item.high;
            const low = item.low;
            const prevClose = rawData[i - 1].close;
            const trueRange = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
            return (trueRange * 100).toFixed(2);
        });

        // 2. Calculate ATR (for display text only)
        const calculateATR = (data, period = 14) => {
            if (data.length < period) return new Array(data.length).fill('-');
            
            const trueRanges = [];
            for (let i = 0; i < data.length; i++) {
                const high = data[i].high;
                const low = data[i].low;
                if (i === 0) {
                    trueRanges.push(high - low);
                } else {
                    const prevClose = data[i - 1].close;
                    const trueRange = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
                    trueRanges.push(trueRange);
                }
            }

            const atrValues = [];
            let sum = 0;
            for (let i = 0; i < period; i++) {
                sum += trueRanges[i];
            }
            atrValues[period - 1] = sum / period;

            for (let i = period; i < trueRanges.length; i++) {
                atrValues[i] = (atrValues[i - 1] * (period - 1) + trueRanges[i]) / period;
            }

            const atrPercentage = atrValues.map((atr, index) => {
                if (index < period - 1) return '-';
                return (atr * 100).toFixed(2);
            });

            return atrPercentage;
        };
        const atrData = calculateATR(rawData);

        const calculateAndDisplayAverageTrueRanges = (startIdx, endIdx) => {
            if (rawData.length === 0) {
                averageAmplitudeContainer.style.display = 'none';
                return;
            }
            averageAmplitudeContainer.style.display = 'block';

            const visibleAtrData = atrData.slice(startIdx, endIdx + 1);

            let atrTotal = 0, atrCount = 0;
            visibleAtrData.forEach(atr => {
                if (atr !== '-') {
                    atrTotal += parseFloat(atr);
                    atrCount++;
                }
            });

            const avgAtr = atrCount ? `${(atrTotal / atrCount).toFixed(2)}%` : 'N/A';

            averageAmplitudeContainer.innerHTML = `
                <span class="me-4"><strong>可视区域平均真实波幅:</strong> ${avgAtr}</span>`;
        };

        const trColors = {
            '日真实波幅(%)': '#4a90e2'
        };

        const legendData = Object.keys(trColors).map(name => ({
            name: name,
            icon: 'rect',
            itemStyle: { color: trColors[name] }
        }));

        const option = {
            tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
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
                    axisLine: { show: false },
                    axisLabel: {
                        formatter: (value) => {
                            const dataZoom = amplitudeChart.getOption().dataZoom[0];
                            const startIndex = Math.floor(rawData.length * dataZoom.start / 100);
                            const endIndex = Math.ceil(rawData.length * dataZoom.end / 100) - 1;
                            
                            const visibleData = dailyTR.slice(startIndex, endIndex + 1).filter(v => v !== '-');
                            if (visibleData.length === 0) {
                                return `${value} %`;
                            }

                            const countAbove = visibleData.filter(v => parseFloat(v) > value).length;
                            const percentage = (countAbove / visibleData.length * 100).toFixed(2);
                            
                            return `${value} % (${percentage}%)`;
                        }
                    }
                },
                { scale: true, gridIndex: 1, splitNumber: 2, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } }
            ],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0, 1], start: 80, end: 100 },
                { show: true, xAxisIndex: [0, 1], type: 'slider', top: '85%', start: 80, end: 100 }
            ],
            series: [
                { name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: volumes, itemStyle: { color: (params) => (params.value[2] === 1 ? '#ef232a' : '#14b143') } },
                { name: '日真实波幅(%)', type: 'line', data: dailyTR, smooth: true, lineStyle: { width: 2, color: trColors['日真实波幅(%)'] }, yAxisIndex: 0 }
            ]
        };

        amplitudeChart.setOption(option, true);
        
        const updateReadouts = () => {
            const dataZoom = amplitudeChart.getOption().dataZoom[0];
            const startIndex = Math.floor(rawData.length * dataZoom.start / 100);
            const endIndex = Math.ceil(rawData.length * dataZoom.end / 100) - 1;
            calculateAndDisplayAverageTrueRanges(startIndex, endIndex);
            
            // Force y-axis label refresh
            amplitudeChart.setOption({
                yAxis: [
                    {
                        axisLabel: {
                            formatter: (value) => {
                                const dataZoom = amplitudeChart.getOption().dataZoom[0];
                                const startIndex = Math.floor(rawData.length * dataZoom.start / 100);
                                const endIndex = Math.ceil(rawData.length * dataZoom.end / 100) - 1;
                                
                                const visibleData = dailyTR.slice(startIndex, endIndex + 1).filter(v => v !== '-');
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

        amplitudeChart.off('datazoom');
        amplitudeChart.on('datazoom', updateReadouts);
        updateReadouts(); // Initial call
    };

    const renderKlineChart = (rawData, stockCode, stockName) => {
        klineTitleContainer.innerText = `${stockCode} - ${stockName} | K线图与成交量`;
        klineTitleContainer.style.display = 'block';

        const dates = rawData.map(item => item.date);
        const closeData = rawData.map(item => item.close);
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
                result.push(parseFloat((sum / dayCount).toFixed(4)));
            }
            return result;
        };

        const allMaDays = [5, 20, 60, 240];
        const closePriceColor = '#000000';
        const maColors = {
            5: '#E87A90',
            20: '#84D0B2',
            60: '#A7A2D7',
            240: '#F4B884'
        };
        const availableMaDays = allMaDays.filter(day => rawData.length >= day);
        
        const legendData = [
            { name: '收盘价', icon: 'rect', itemStyle: { color: closePriceColor } },
            ...availableMaDays.map(day => ({
                name: `MA${day}`,
                icon: 'rect',
                itemStyle: { color: maColors[day] }
            }))
        ];
        
        const maSeries = availableMaDays.map(day => ({
            name: `MA${day}`,
            type: 'line',
            data: calculateMA(day, rawData),
            smooth: true,
            symbol: 'none',
            lineStyle: { 
                opacity: 0.8,
                color: maColors[day]
            }
        }));

        // --- Updated Feature: Highest/Lowest Price Lines ---
        const getPeriodExtreme = (period, data) => {
            if (data.length < 1) return { high: 0, low: 0 };
            const startIndex = Math.max(0, data.length - period);
            const relevantData = data.slice(startIndex);
            let high = -Infinity;
            let low = Infinity;
            relevantData.forEach(item => {
                if (item.high > high) high = item.high;
                if (item.low < low) low = item.low;
            });
            return { high, low };
        };

        const markLineData = [];
        const extremes = {};

        if (rawData.length >= 20) {
            const ext20 = getPeriodExtreme(20, rawData);
            extremes[20] = { high: ext20.high, low: ext20.low };
        }
        if (rawData.length >= 60) {
            const ext60 = getPeriodExtreme(60, rawData);
            extremes[60] = { high: ext60.high, low: ext60.low };
        }

        const high20 = extremes[20] ? extremes[20].high : null;
        const low20 = extremes[20] ? extremes[20].low : null;
        const high60 = extremes[60] ? extremes[60].high : null;
        const low60 = extremes[60] ? extremes[60].low : null;

        if (high60 !== null && high60 === high20) {
            markLineData.push({ yAxis: high60, name: '60/20日最高', lineStyle: { color: maColors[60], type: 'dashed', width: 2 }, label: { formatter: '{b}: {c}' } });
        } else {
            if (high60 !== null) {
                markLineData.push({ yAxis: high60, name: '60日最高', lineStyle: { color: maColors[60], type: 'dashed', width: 2 }, label: { formatter: '{b}: {c}' } });
            }
            if (high20 !== null) {
                markLineData.push({ yAxis: high20, name: '20日最高', lineStyle: { color: maColors[20], type: 'dashed', width: 2 }, label: { formatter: '{b}: {c}' } });
            }
        }

        if (low60 !== null && low60 === low20) {
            markLineData.push({ yAxis: low60, name: '60/20日最低', lineStyle: { color: maColors[60], type: 'dashed', width: 2 }, label: { formatter: '{b}: {c}' } });
        } else {
            if (low60 !== null) {
                markLineData.push({ yAxis: low60, name: '60日最低', lineStyle: { color: maColors[60], type: 'dashed', width: 2 }, label: { formatter: '{b}: {c}' } });
            }
            if (low20 !== null) {
                markLineData.push({ yAxis: low20, name: '20日最低', lineStyle: { color: maColors[20], type: 'dashed', width: 2 }, label: { formatter: '{b}: {c}' } });
            }
        }
        // --- End of Updated Feature ---

        const option = {
            tooltip: {
                trigger: 'axis',
                axisPointer: { type: 'cross' },
                formatter: (params) => {
                    const dataIndex = params[0].dataIndex;
                    const currentData = rawData[dataIndex];
                    
                    let tooltipHtml = `${currentData.date}<br/>`;
                    tooltipHtml += `开盘: ${currentData.open}<br/>`;
                    tooltipHtml += `收盘: ${currentData.close}<br/>`;
                    tooltipHtml += `最高: ${currentData.high}<br/>`;
                    tooltipHtml += `最低: ${currentData.low}<br/>`;

                    params.forEach(param => {
                        if (param.seriesName !== '收盘价' && param.seriesName !== '成交量') {
                            const seriesName = param.seriesName;
                            const value = param.value;
                            const color = param.color;
                            if (value !== undefined && value !== null && value !== '-') {
                                tooltipHtml += `<span style="display:inline-block;margin-right:5px;border-radius:10px;width:10px;height:10px;background-color:${color};"></span>`;
                                tooltipHtml += `${seriesName}: ${value}<br/>`;
                            }
                        }
                    });
                    
                    return tooltipHtml;
                }
            },
            legend: { data: legendData, top: 0, inactiveColor: '#777' },
            grid: [
                { left: '10%', right: '15%', top: '10%', height: '50%' },
                { left: '10%', right: '15%', top: '65%', height: '15%' }
            ],
            xAxis: [
                { type: 'category', data: dates, scale: true, boundaryGap: false, axisLine: { onZero: false }, splitLine: { show: false }, min: 'dataMin', max: 'dataMax' },
                { type: 'category', gridIndex: 1, data: dates, scale: true, boundaryGap: false, axisLine: { onZero: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, min: 'dataMin', max: 'dataMax' }
            ],
            yAxis: [
                { 
                    scale: true, 
                    splitArea: { show: true },
                    max: value => {
                        const highestMark = Math.max(high20 || -Infinity, high60 || -Infinity);
                        if (highestMark === -Infinity) return value.max;
                        return Math.max(value.max, highestMark) * 1.01;
                    },
                    min: value => {
                        const lowestMark = Math.min(low20 || Infinity, low60 || Infinity);
                        if (lowestMark === Infinity) return value.min;
                        return Math.min(value.min, lowestMark) * 0.99;
                    }
                },
                { scale: true, gridIndex: 1, splitNumber: 2, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } }
            ],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0, 1], start: 80, end: 100 },
                { show: true, xAxisIndex: [0, 1], type: 'slider', top: '85%', start: 80, end: 100 }
            ],
            series: [
                { 
                    name: '收盘价', 
                    type: 'line', 
                    data: closeData, 
                    smooth: true, 
                    symbol: 'none', 
                    lineStyle: { 
                        width: 2,
                        color: closePriceColor
                    },
                    markLine: {
                        symbol: ['none', 'none'],
                        data: markLineData,
                        emphasis: {
                            lineStyle: {
                                width: 3
                            }
                        }
                    }
                },
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