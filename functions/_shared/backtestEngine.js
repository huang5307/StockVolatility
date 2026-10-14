/**
 * 網格交易（蛛網交易）量化回測與參數尋優引擎
 * 券商實盤正統等比網格線 (Geometric Grid Lines) 撮合系統：
 * - 依跳動間距 (%) 在價格區間內鋪設標準蛛網
 * - 支援盤中 High / Low 真實穿網撮合，精準捕捉震盪套利
 * - 首日自動建立起始底倉（避免單邊上漲時空倉無法參與）
 * - 嚴格遵守原始庫存、最大庫存上限、最小底倉保留風控
 */

export function isTaiwanStock(symbol) {
    const clean = String(symbol || '').trim();
    return /^\d{4}$/.test(clean) || /^00\d{2,4}[A-Z]?$/i.test(clean);
}

export function getMarketUnitInfo(symbol) {
    if (isTaiwanStock(symbol)) {
        return { unitName: '張', multiplier: 1000, market: 'TW' };
    }
    return { unitName: '手', multiplier: 100, market: 'CN' };
}

/**
 * 執行單次蛛網量化回測
 */
export function runBacktest(kline, opts = {}) {
    if (!kline || kline.length < 2) {
        throw new Error('K線數據不足，無法執行回測');
    }

    const symbol = opts.symbol || '';
    const unitInfo = getMarketUnitInfo(symbol);
    const multiplier = unitInfo.multiplier; // 台股1000股, 陸股100股

    const allPrices = kline.map(p => Number(p.close));
    const allLows = kline.map(p => Number(p.low || p.close));
    const allHighs = kline.map(p => Number(p.high || p.close));

    const minHistoryPrice = Math.min(...allLows);
    const maxHistoryPrice = Math.max(...allHighs);

    const gridPercent = Number(opts.gridPercent || 3.0);
    const orderQuantityUnits = Math.max(1, parseInt(opts.orderQuantity || 1, 10));
    const sharesPerTrade = orderQuantityUnits * multiplier;

    // 價格區間設定與防呆校驗
    let lowerPrice = opts.lowerPrice !== undefined && opts.lowerPrice !== '' && !isNaN(opts.lowerPrice)
        ? Math.max(0.01, Number(opts.lowerPrice))
        : Number((minHistoryPrice * 0.92).toFixed(2));

    let upperPrice = opts.upperPrice !== undefined && opts.upperPrice !== '' && !isNaN(opts.upperPrice)
        ? Math.max(lowerPrice * 1.05, Number(opts.upperPrice))
        : Number((maxHistoryPrice * 1.08).toFixed(2));

    // 若設定的價格區間完全脫離標的歷史真實波動範圍（例如殘留了上一檔低價股的上下限），自動校正為合規區間
    if (upperPrice <= minHistoryPrice || lowerPrice >= maxHistoryPrice) {
        lowerPrice = Number((minHistoryPrice * 0.92).toFixed(2));
        upperPrice = Number((maxHistoryPrice * 1.08).toFixed(2));
    }


    // 生成等比蛛網網格線 (Geometric Grid Lines)
    const ratio = gridPercent / 100;
    const gridLines = [];
    let curLinePrice = lowerPrice;
    while (curLinePrice <= upperPrice * 1.02) {
        gridLines.push(Number(curLinePrice.toFixed(4)));
        curLinePrice = curLinePrice * (1 + ratio);
    }
    if (gridLines.length < 2) {
        gridLines.push(Number((lowerPrice * (1 + ratio)).toFixed(4)));
    }

    // 庫存風控設定
    const minStockUnits = Math.max(0, parseInt(opts.minStock || 0, 10));
    const maxStockUnits = opts.maxStock !== undefined && opts.maxStock !== '' && !isNaN(opts.maxStock)
        ? Math.max(minStockUnits + orderQuantityUnits, parseInt(opts.maxStock, 10))
        : Math.max(gridLines.length * orderQuantityUnits, 20);

    const initialStockUnitsInput = opts.initialStock !== undefined && opts.initialStock !== '' && !isNaN(opts.initialStock)
        ? Math.max(0, parseInt(opts.initialStock, 10))
        : 0;

    // 若原始庫存為0，實盤策略首日自動建倉1筆底倉，避免單邊上漲時空倉無法獲利
    const autoBase = initialStockUnitsInput === 0;
    const initialStockUnits = autoBase ? orderQuantityUnits : initialStockUnitsInput;

    const initialPrice = Number(kline[0].close);
    const defaultEstimatedCash = (maxStockUnits - initialStockUnits + 5) * sharesPerTrade * initialPrice * 1.2;
    const initialCash = opts.initialCash !== undefined && opts.initialCash !== '' && !isNaN(opts.initialCash)
        ? Number(opts.initialCash)
        : Math.max(100000, Number(defaultEstimatedCash.toFixed(0)));

    let cash = initialCash;
    let currentStockUnits = initialStockUnits;
    let currentShares = currentStockUnits * multiplier;

    // 初始總權益 = 初始現金 + 初始持股市值
    const initialStockValue = currentShares * initialPrice;
    const totalInitialEquity = cash + initialStockValue;

    // 未平倉買單池 (FIFO)
    const buyQueue = [];
    if (currentStockUnits > 0) {
        buyQueue.push({
            id: 0,
            date: kline[0].date,
            price: initialPrice,
            shares: currentShares,
            units: currentStockUnits,
            note: autoBase ? '首日建立底倉' : '原始庫存底倉'
        });
    }

    const tradeRecords = [];
    const equityCurve = [];
    let peakEquity = totalInitialEquity;
    let maxDrawdown = 0;
    let winTrades = 0;
    let closedTrades = 0;
    let tradeId = 1;

    // 記錄第 0 天權益
    equityCurve.push({
        date: kline[0].date,
        equity: Number(totalInitialEquity.toFixed(2)),
        benchmarkEquity: Number(totalInitialEquity.toFixed(2)),
        cash: Number(cash.toFixed(2)),
        stockUnits: currentStockUnits,
        stockValue: Number(initialStockValue.toFixed(2)),
        close: initialPrice
    });

    let prevClose = initialPrice;

    for (let i = 1; i < kline.length; i++) {
        const item = kline[i];
        const dayOpen = Number(item.open || item.close);
        const dayHigh = Number(item.high || item.close);
        const dayLow = Number(item.low || item.close);
        const dayClose = Number(item.close);
        const curDate = item.date;

        // --- 1. 逢跌觸網買入判斷 (Low 跌破某一網格線) ---
        for (let g = gridLines.length - 1; g >= 0; g--) {
            const line = gridLines[g];
            // 當日跌破該網格線，且前一日收盤高於該網格線
            if (dayLow <= line && prevClose > line) {
                if (currentStockUnits + orderQuantityUnits <= maxStockUnits && line >= lowerPrice) {
                    const buyCost = sharesPerTrade * line;
                    if (cash >= buyCost) {
                        cash -= buyCost;
                        currentStockUnits += orderQuantityUnits;
                        currentShares += sharesPerTrade;

                        buyQueue.push({
                            id: tradeId++,
                            date: curDate,
                            price: line,
                            shares: sharesPerTrade,
                            units: orderQuantityUnits,
                            gridLine: line
                        });

                        tradeRecords.push({
                            type: 'buy',
                            price: line,
                            units: orderQuantityUnits,
                            unitName: unitInfo.unitName,
                            shares: sharesPerTrade,
                            date: curDate,
                            amount: Number(buyCost.toFixed(2)),
                            currentStockUnits,
                            note: `跌破蛛網線 $${line.toFixed(2)} 買進 ${orderQuantityUnits} ${unitInfo.unitName}`
                        });
                        break; // 當天只觸發一次買進
                    }
                }
            }
        }

        // --- 2. 逢漲觸網賣出判斷 (High 漲破某一網格線) ---
        for (let g = 0; g < gridLines.length; g++) {
            const line = gridLines[g];
            // 當日向上穿過該網格線，且前一日收盤低於該網格線
            if (dayHigh >= line && prevClose < line) {
                if (currentStockUnits - orderQuantityUnits >= minStockUnits && buyQueue.length > 0 && line <= upperPrice) {
                    // FIFO 匹配買單獲利平倉
                    const matchedBuy = buyQueue.shift();
                    const sellShares = Math.min(currentShares, sharesPerTrade);
                    const revenue = sellShares * line;

                    cash += revenue;
                    currentStockUnits -= orderQuantityUnits;
                    currentShares -= sellShares;
                    closedTrades++;

                    const pnl = (line - matchedBuy.price) * sellShares;
                    if (pnl > 0) winTrades++;

                    tradeRecords.push({
                        type: 'sell',
                        price: line,
                        units: orderQuantityUnits,
                        unitName: unitInfo.unitName,
                        shares: sellShares,
                        date: curDate,
                        amount: Number(revenue.toFixed(2)),
                        pnl: Number(pnl.toFixed(2)),
                        buyPrice: matchedBuy.price,
                        buyDate: matchedBuy.date,
                        currentStockUnits,
                        note: `突破蛛網線 $${line.toFixed(2)} 賣出 ${orderQuantityUnits} ${unitInfo.unitName} (配對買入: $${matchedBuy.price.toFixed(2)})`
                    });
                    break; // 當天只觸發一次賣出
                }
            }
        }

        prevClose = dayClose;

        // 計算當日總權益
        const currentStockValue = currentShares * dayClose;
        const currentEquity = cash + currentStockValue;
        const benchmarkEquity = totalInitialEquity * (dayClose / initialPrice);

        if (currentEquity > peakEquity) {
            peakEquity = currentEquity;
        }
        const currentDD = peakEquity > 0 ? (peakEquity - currentEquity) / peakEquity : 0;
        if (currentDD > maxDrawdown) {
            maxDrawdown = currentDD;
        }

        equityCurve.push({
            date: curDate,
            equity: Number(currentEquity.toFixed(2)),
            benchmarkEquity: Number(benchmarkEquity.toFixed(2)),
            cash: Number(cash.toFixed(2)),
            stockUnits: currentStockUnits,
            stockValue: Number(currentStockValue.toFixed(2)),
            close: dayClose
        });
    }

    // 期末最終權益結算
    const finalClosePrice = Number(kline[kline.length - 1].close);
    const finalStockValue = currentShares * finalClosePrice;
    const finalEquity = cash + finalStockValue;
    const totalReturn = (finalEquity - totalInitialEquity) / totalInitialEquity;

    const days = Math.max(1, (new Date(kline[kline.length - 1].date) - new Date(kline[0].date)) / (1000 * 86400));
    const annualizedReturn = days > 30 ? Math.pow(1 + totalReturn, 365 / days) - 1 : totalReturn;
    const winRate = closedTrades > 0 ? winTrades / closedTrades : 0;

    return {
        unitInfo,
        initialParams: {
            gridPercent,
            orderQuantityUnits,
            initialStockUnits,
            minStockUnits,
            maxStockUnits,
            lowerPrice,
            upperPrice,
            initialCash,
            totalInitialEquity: Number(totalInitialEquity.toFixed(2)),
            gridLinesCount: gridLines.length
        },
        finalEquity: Number(finalEquity.toFixed(2)),
        finalStockUnits: currentStockUnits,
        finalCash: Number(cash.toFixed(2)),
        totalReturn: Number(totalReturn.toFixed(4)),
        annualizedReturn: Number(annualizedReturn.toFixed(4)),
        maxDrawdown: Number(maxDrawdown.toFixed(4)),
        winRate: Number(winRate.toFixed(4)),
        totalTrades: tradeRecords.length,
        closedTrades,
        winTrades,
        tradeRecords,
        equityCurve
    };
}

/**
 * 網格參數智能尋優函數 (Grid Parameter Optimizer)
 */
export function optimizeGrid(kline, baseOpts = {}) {
    if (!kline || kline.length < 2) {
        throw new Error('K線數據不足，無法進行參數尋優');
    }

    // 常用間距掃描梯度
    const candidatePercents = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0];
    
    // 計算歷史真實波幅 (ATR % 均值)
    let trSum = 0;
    for (let i = 1; i < kline.length; i++) {
        const high = Number(kline[i].high || kline[i].close);
        const low = Number(kline[i].low || kline[i].close);
        const prevClose = Number(kline[i - 1].close);
        const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
        trSum += (tr / prevClose);
    }
    const avgDailyVolatilityPct = Number(((trSum / (kline.length - 1)) * 100).toFixed(2));

    const scanResults = [];

    for (const pct of candidatePercents) {
        try {
            const res = runBacktest(kline, { ...baseOpts, gridPercent: pct });
            scanResults.push({
                gridPercent: pct,
                totalReturn: res.totalReturn,
                annualizedReturn: res.annualizedReturn,
                maxDrawdown: res.maxDrawdown,
                winRate: res.winRate,
                totalTrades: res.totalTrades,
                closedTrades: res.closedTrades,
                finalEquity: res.finalEquity
            });
        } catch (err) {
            console.warn(`尋優間距 ${pct}% 失敗:`, err.message);
        }
    }

    if (scanResults.length === 0) {
        throw new Error('參數尋優未能產生有效結果');
    }

    // 1. 最高報酬率配置
    const bestReturnConfig = [...scanResults].sort((a, b) => b.totalReturn - a.totalReturn)[0];

    // 2. 最穩健配置 (風報比)
    const bestBalancedConfig = [...scanResults].sort((a, b) => {
        const scoreA = a.totalReturn / Math.max(0.01, a.maxDrawdown);
        const scoreB = b.totalReturn / Math.max(0.01, b.maxDrawdown);
        return scoreB - scoreA;
    })[0];

    // 3. ATR 建議
    let recommendedAtrPct = candidatePercents.reduce((prev, curr) => 
        Math.abs(curr - avgDailyVolatilityPct) < Math.abs(prev - avgDailyVolatilityPct) ? curr : prev
    );

    return {
        avgDailyVolatilityPct,
        recommendations: {
            bestReturn: bestReturnConfig,
            bestBalanced: bestBalancedConfig,
            atrRecommendedPercent: recommendedAtrPct
        },
        ranking: scanResults.sort((a, b) => b.totalReturn - a.totalReturn)
    };
}
