/**
 * 網格交易（蛛網交易）量化回測與參數尋優引擎
 * 券商實盤正統等比網格線 (Geometric Grid Lines) 撮合系統：
 * - 依跳動間距 (%) 在價格區間內鋪設標準蛛網
 * - 一買配一賣專屬配對撮合（Paired Grid Arbitrage）：低買高賣，徹底根除低檔割肉
 * - 支援盤中 High / Low 真實穿網撮合，精準捕捉震盪套利
 * - 嚴格區分「網格波動套利純利潤」與「未平倉市值浮動盈虧」
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

    const initialPrice = Number(kline[0].close);
    const allPrices = kline.map(p => Number(p.close));
    const allLows = kline.map(p => Number(p.low || p.close)).filter(x => x > 0);
    const allHighs = kline.map(p => Number(p.high || p.close)).filter(x => x > 0);

    const minHistoryPrice = allLows.length > 0 ? Math.min(...allLows) : initialPrice;
    const maxHistoryPrice = allHighs.length > 0 ? Math.max(...allHighs) : initialPrice;

    const gridPercent = Number(opts.gridPercent || 3.0);
    const orderQuantityUnits = Math.max(1, parseInt(opts.orderQuantity || 1, 10));
    const sharesPerTrade = orderQuantityUnits * multiplier;

    // 價格區間設定與防呆校驗
    let lowerPrice = opts.lowerPrice !== undefined && opts.lowerPrice !== '' && !isNaN(opts.lowerPrice)
        ? Math.max(0.01, Number(opts.lowerPrice))
        : Math.max(0.01, Number((minHistoryPrice * 0.92).toFixed(2)));

    let upperPrice = opts.upperPrice !== undefined && opts.upperPrice !== '' && !isNaN(opts.upperPrice)
        ? Math.max(lowerPrice * 1.05, Number(opts.upperPrice))
        : Number((maxHistoryPrice * 1.08).toFixed(2));

    // 若設定的價格區間完全脫離標的歷史真實波動範圍，自動校正為合規區間
    if (upperPrice <= minHistoryPrice || lowerPrice >= maxHistoryPrice) {
        lowerPrice = Math.max(0.01, Number((minHistoryPrice * 0.92).toFixed(2)));
        upperPrice = Number((maxHistoryPrice * 1.08).toFixed(2));
    }

    // 生成蛛網網格線：向下 * (1 - ratio)，向上 * (1 + ratio)
    const ratio = gridPercent / 100;
    let basePrice = initialPrice;
    if (opts.basePrice !== undefined && opts.basePrice !== '' && !isNaN(opts.basePrice) && Number(opts.basePrice) > 0) {
        basePrice = Number(opts.basePrice);
    } else if (lowerPrice > 0 && lowerPrice < initialPrice) {
        // 若設定了區間下限 lowerPrice 且低於 initialPrice，則以 lowerPrice 為基底對齊至最接近且不超過 initialPrice 之網格檔位
        // 例如 lowerPrice = 8.8, initialPrice = 12.08, ratio = 0.04 -> k = floor(ln(12.08 / 8.8) / ln(1.04)) = 8 -> 8.8 * 1.04^8 = 12.0434
        const k = Math.floor(Math.log(initialPrice / lowerPrice) / Math.log(1 + ratio));
        if (k >= 0) {
            basePrice = Number((lowerPrice * Math.pow(1 + ratio, k)).toFixed(4));
        }
    }

    const downLines = [];
    let curDown = basePrice;
    while (curDown * (1 - ratio) >= lowerPrice * 0.98) {
        curDown = Number((curDown * (1 - ratio)).toFixed(4));
        downLines.push(curDown);
    }

    const upLines = [];
    let curUp = basePrice;
    while (curUp * (1 + ratio) <= upperPrice * 1.02) {
        curUp = Number((curUp * (1 + ratio)).toFixed(4));
        upLines.push(curUp);
    }
    upLines.reverse(); // 由高至低排列

    const gridLines = [...upLines, Number(basePrice.toFixed(4)), ...downLines];
    gridLines.sort((a, b) => b - a); // 降序排列 (高至低)
    if (gridLines.length < 2) {
        gridLines.push(Number((basePrice * (1 - ratio)).toFixed(4)));
    }

    const maxGridLayers = Math.max(1, parseInt(opts.maxGridLayers || opts.maxLayers || 8, 10));
    const stressDropPct = Math.max(1, parseFloat(opts.stressDropPct || 20.0));

    // 庫存風控設定
    // 最小庫存底倉：如果沒有設定或是 0，代表不考慮底倉限制（自然底倉為 0）
    const minStockUnits = (opts.minStock !== undefined && opts.minStock !== '' && !isNaN(opts.minStock) && Number(opts.minStock) > 0)
        ? parseInt(opts.minStock, 10)
        : 0;

    // 庫存上限：超過之後就不買；如果沒有設定或是 0，代表不考慮此條件（無上限限制）
    const maxStockUnits = (opts.maxStock !== undefined && opts.maxStock !== '' && !isNaN(opts.maxStock) && Number(opts.maxStock) > 0)
        ? Math.max(minStockUnits + orderQuantityUnits, parseInt(opts.maxStock, 10))
        : Infinity;

    // 原始庫存：如果沒有設定或是 0，代表不考慮原始持股（從 0 開始）
    const initialStockUnits = (opts.initialStock !== undefined && opts.initialStock !== '' && !isNaN(opts.initialStock) && Number(opts.initialStock) > 0)
        ? parseInt(opts.initialStock, 10)
        : 0;

    const defaultEstimatedCash = (maxGridLayers + 2) * sharesPerTrade * initialPrice * 1.1;
    const initialCash = opts.initialCash !== undefined && opts.initialCash !== '' && !isNaN(opts.initialCash)
        ? Number(opts.initialCash)
        : Math.max(100000, Number(defaultEstimatedCash.toFixed(0)));

    let cash = initialCash;
    let currentStockUnits = initialStockUnits;
    let currentShares = currentStockUnits * multiplier;

    // 初始總權益 = 初始現金 + 初始持股市值
    const initialStockValue = currentShares * initialPrice;
    const totalInitialEquity = cash + initialStockValue;

    // 未平倉網格持倉單池 (專屬配對撮合)
    // 注意：原始庫存底倉 (initialStock) 屬於被動持股底倉，絕不可混入網格低吸單池中被一次性全部平倉賣出
    const openPositions = [];

    const tradeRecords = [];
    const equityCurve = [];
    let peakEquity = totalInitialEquity;
    let maxDrawdown = 0;
    let winTrades = 0;
    let closedTrades = 0;
    let tradeId = 1;

    // === 實盤風控評估：基於「最大疊層數」與「常規極限跌幅考驗 (預設20%)」===
    // 1. 在用戶預算 maxGridLayers 層內，實際能承受的最大連續跌幅 (%)
    const actualAbsorbedDropPct = Number(((1 - Math.pow(1 - ratio, maxGridLayers)) * 100).toFixed(1));
    // 2. 若要完整防禦 stressDropPct (如 20%) 的常態回檔，所需的買進層數
    const layersNeededForStress = Math.max(1, Math.ceil(Math.log(1 - stressDropPct / 100) / Math.log(1 - ratio)));
    // 3. 判定是否危險：所需層數 > 預算層數，或抗跌深度 < 考驗跌幅
    const isDangerous = layersNeededForStress > maxGridLayers || actualAbsorbedDropPct < stressDropPct;
    const riskRating = isDangerous ? 'danger' : 'safe';
    // 4. 預算層數全滿時的極限斷糧價格（跌破此價位手頭現金即用盡，停止承接）
    const starvationPrice = Number((initialPrice * Math.pow(1 - ratio, maxGridLayers)).toFixed(2));
    const downsideBufferPct = actualAbsorbedDropPct;

    let missedBuys = 0;
    const missedBuyRecords = [];
    let executedBuys = 0;

    let realizedProfit = 0; // 累計網格波動套利純利潤 ($)
    // 網格最大預備本金 (Grid Budget Capital): 嚴格由「最大承接層數 * 每次買賣數量 * 單位乘數 * 起始每股股價」決定，絕不包含原始持股底倉
    // 台股：1張 = 1,000股；陸股：1手 = 100股
    const gridBudgetCapital = maxGridLayers * sharesPerTrade * initialPrice;
    let currentGridCashDeployed = 0; // 回測中網格實際佔用資金動態追蹤 (僅追蹤網格買進部位，不含原始底倉)
    let peakGridCashDeployed = 0;    // 回測期間網格實際動用資金峰值

    // 記錄第 0 天權益
    equityCurve.push({
        date: kline[0].date,
        equity: Number(totalInitialEquity.toFixed(2)),
        benchmarkEquity: Number(totalInitialEquity.toFixed(2)),
        cash: Number(cash.toFixed(2)),
        stockUnits: currentStockUnits,
        stockValue: Number(initialStockValue.toFixed(2)),
        close: initialPrice,
        realizedProfit: 0
    });

    let prevClose = initialPrice;

    for (let i = 1; i < kline.length; i++) {
        const item = kline[i];
        const dayHigh = Number(item.high || item.close);
        const dayLow = Number(item.low || item.close);
        const dayClose = Number(item.close);
        const curDate = item.date;

        // --- 1. 逢跌觸網買入判斷 (Low 跌破某一網格線) ---
        for (let g = 0; g < gridLines.length; g++) {
            const line = gridLines[g];
            // 當日跌破該網格線，且前一日收盤高於該網格線
            if (dayLow <= line && prevClose > line) {
                if (currentStockUnits + orderQuantityUnits <= maxStockUnits && line >= lowerPrice) {
                    // 正統蛛網交易排他性：同一檔位未平倉前，不可重複買進
                    const alreadyOccupied = openPositions.some(p => Math.abs(p.gridLine - line) < 0.0001);
                    if (alreadyOccupied) {
                        continue;
                    }

                    const buyCost = sharesPerTrade * line;
                    const targetSellPrice = Number((line * (1 + ratio)).toFixed(4));
                    if (cash >= buyCost) {
                        cash -= buyCost;
                        currentStockUnits += orderQuantityUnits;
                        currentShares += sharesPerTrade;
                        executedBuys++;

                        openPositions.push({
                            id: tradeId++,
                            date: curDate,
                            buyPrice: line,
                            shares: sharesPerTrade,
                            units: orderQuantityUnits,
                            gridLine: line,
                            targetSellPrice: targetSellPrice
                        });

                        currentGridCashDeployed += buyCost;
                        if (currentGridCashDeployed > peakGridCashDeployed) {
                            peakGridCashDeployed = currentGridCashDeployed;
                        }

                        tradeRecords.push({
                            type: 'buy',
                            price: line,
                            units: orderQuantityUnits,
                            unitName: unitInfo.unitName,
                            shares: sharesPerTrade,
                            date: curDate,
                            amount: Number(buyCost.toFixed(2)),
                            cumulativeCost: Number(currentGridCashDeployed.toFixed(2)),
                            currentStockUnits,
                            targetSellPrice,
                            note: `跌破蛛網線 $${line.toFixed(2)} 買進 ${orderQuantityUnits} ${unitInfo.unitName} (目標止盈價 $${targetSellPrice.toFixed(2)})`
                        });
                    } else {
                        // 資金不足，發生資金枯竭受阻 (Missed Buy)
                        missedBuys++;
                        missedBuyRecords.push({
                            date: curDate,
                            price: line,
                            requiredCost: Number(buyCost.toFixed(2)),
                            cashAvailable: Number(cash.toFixed(2))
                        });
                        tradeRecords.push({
                            type: 'missed_buy',
                            price: line,
                            units: orderQuantityUnits,
                            unitName: unitInfo.unitName,
                            shares: sharesPerTrade,
                            date: curDate,
                            amount: Number(buyCost.toFixed(2)),
                            cumulativeCost: Number(currentGridCashDeployed.toFixed(2)),
                            currentStockUnits,
                            note: `⚠️ 跌破蛛網線 $${line.toFixed(2)} 觸發買點，但可用現金僅 $${Math.round(cash).toLocaleString()} 不足支付 $${Math.round(buyCost).toLocaleString()}，資金斷糧暫停承接`
                        });
                        break;
                    }
                }
            }
        }

        // --- 2. 逢漲觸網賣出判斷 (High 達標目標止盈價 targetSellPrice: buyPrice * (1 + ratio)) ---
        for (let p = openPositions.length - 1; p >= 0; p--) {
            const pos = openPositions[p];
            if (pos.date === curDate) continue; // 當日買進部位不可同日平倉（遵循 T+1 及避免日內最高最低點假撮合）
            if (currentStockUnits - orderQuantityUnits < minStockUnits) continue;

            const targetSell = pos.targetSellPrice || Number((pos.buyPrice * (1 + ratio)).toFixed(4));
            if (targetSell > upperPrice) continue;

            if (dayHigh >= targetSell) {
                const sellPrice = targetSell;
                const sellShares = Math.min(currentShares, pos.shares);
                const revenue = sellShares * sellPrice;
                const costReleased = sellShares * pos.buyPrice;
                const pnl = (sellPrice - pos.buyPrice) * sellShares;

                cash += revenue;
                currentStockUnits -= orderQuantityUnits;
                currentShares -= sellShares;
                currentGridCashDeployed = Math.max(0, currentGridCashDeployed - costReleased);
                closedTrades++;
                realizedProfit += pnl;
                if (pnl > 0) winTrades++;

                openPositions.splice(p, 1);

                tradeRecords.push({
                    type: 'sell',
                    price: sellPrice,
                    units: orderQuantityUnits,
                    unitName: unitInfo.unitName,
                    shares: sellShares,
                    date: curDate,
                    amount: Number(revenue.toFixed(2)),
                    costReleased: Number(costReleased.toFixed(2)),
                    cumulativeCost: Number(currentGridCashDeployed.toFixed(2)),
                    pnl: Number(pnl.toFixed(2)),
                    buyPrice: pos.buyPrice,
                    buyDate: pos.date,
                    currentStockUnits,
                    note: `漲超目標價 $${sellPrice.toFixed(2)} (+${(ratio * 100).toFixed(0)}%) 賣出 ${orderQuantityUnits} ${unitInfo.unitName} (低吸高拋平倉配對: $${pos.buyPrice.toFixed(2)}, 套利 +$${Math.round(pnl).toLocaleString()})`
                });
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
            close: dayClose,
            realizedProfit: Number(realizedProfit.toFixed(2))
        });
    }

    // 期末持倉浮動損益結算
    const finalClosePrice = Number(kline[kline.length - 1].close);
    const finalStockValue = currentShares * finalClosePrice;
    const finalEquity = cash + finalStockValue;
    
    // 剩餘持倉浮動盈虧 = 剩餘持股市值 - 剩餘持股買入成本
    // 原始庫存底倉成本以 initialPrice 計算，網格加倉部位以實際買入成本計算
    const gridRemainingCost = openPositions.reduce((sum, pos) => sum + pos.shares * pos.buyPrice, 0);
    const initialRemainingUnits = Math.min(initialStockUnits, currentStockUnits);
    const initialRemainingCost = initialRemainingUnits * multiplier * initialPrice;
    const remainingCost = initialRemainingCost + gridRemainingCost;
    const unrealizedProfit = finalStockValue - remainingCost;

    // 網格最大預備本金 (Grid Budget Capital): 嚴格由「最大承接層數 * 每次買賣數量 * 單位乘數 * 起始每股股價」決定，絕不包含原始持股底倉
    const safeBudgetCapital = Math.max(1000, gridBudgetCapital);
    // 實盤回測實際動用資金峰值 (Peak Capital Deployed): 回測中真實累計買入支出扣除平倉釋出後的最大資金佔用額
    const actualMaxCapital = peakGridCashDeployed > 0 ? peakGridCashDeployed : safeBudgetCapital;
    const gridReturn = actualMaxCapital > 0 ? (realizedProfit / actualMaxCapital) : 0;

    // 總資產淨值報酬率 = (期末總資產 - 期初總資產) / 期初總資產
    const totalReturn = (finalEquity - totalInitialEquity) / totalInitialEquity;

    const days = Math.max(1, (new Date(kline[kline.length - 1].date) - new Date(kline[0].date)) / (1000 * 86400));
    const annualizedGridReturn = days > 30 ? Math.pow(1 + Math.max(-0.99, gridReturn), 365 / days) - 1 : gridReturn;
    const annualizedReturn = days > 30 ? Math.pow(1 + Math.max(-0.99, totalReturn), 365 / days) - 1 : totalReturn;
    const winRate = closedTrades > 0 ? winTrades / closedTrades : 0;
    const avgProfitPerTrade = closedTrades > 0 ? Number((realizedProfit / closedTrades).toFixed(2)) : 0;

    const totalBuySignals = executedBuys + missedBuys;
    const capitalExhaustionRate = totalBuySignals > 0 ? Number(((missedBuys / totalBuySignals) * 100).toFixed(1)) : 0;
    // 網格風報比 (Grid Health Ratio): 套利純收益率 * 抗跌承接深度 / (1 + 斷糧受阻筆數 * 2)
    const gridHealthRatio = Number((
        (gridReturn * 100) * (downsideBufferPct / 100) / (1 + missedBuys * 2)
    ).toFixed(2));

    return {
        unitInfo,
        initialParams: {
            gridPercent,
            orderQuantityUnits,
            initialStockUnits,
            minStockUnits,
            maxStockUnits: isFinite(maxStockUnits) ? maxStockUnits : 0,
            lowerPrice,
            upperPrice,
            initialCash,
            totalInitialEquity: Number(totalInitialEquity.toFixed(2)),
            gridLinesCount: gridLines.length
        },
        // 核心網格套利純收益指標（專注波動盈利）
        realizedProfit: Number(realizedProfit.toFixed(2)),
        maxCapitalDeployed: Number(actualMaxCapital.toFixed(2)),
        gridBudgetCapital: Number(safeBudgetCapital.toFixed(2)),
        peakGridCashDeployed: Number(peakGridCashDeployed.toFixed(2)),
        gridReturn: Number(gridReturn.toFixed(4)),
        annualizedGridReturn: Number(annualizedGridReturn.toFixed(4)),
        avgProfitPerTrade,

        // 實盤風控評估：基於「最大疊層數」與「常態極限跌幅考驗 (預設20%)」
        maxGridLayers,
        stressDropPct,
        actualAbsorbedDropPct,
        layersNeededForStress,
        isDangerous,
        riskRating,
        starvationPrice,
        downsideBufferPct: actualAbsorbedDropPct,
        missedBuys,
        capitalExhaustionRate,
        gridHealthRatio,
        missedBuyRecords,

        // 期末持倉與浮動市值指標（未平倉持股）
        unrealizedProfit: Number(unrealizedProfit.toFixed(2)),
        finalStockUnits: currentStockUnits,
        finalStockValue: Number(finalStockValue.toFixed(2)),
        finalCash: Number(cash.toFixed(2)),

        // 總資產權益指標
        finalEquity: Number(finalEquity.toFixed(2)),
        totalReturn: Number(totalReturn.toFixed(4)),
        annualizedReturn: Number(annualizedReturn.toFixed(4)),
        maxDrawdown: Number(maxDrawdown.toFixed(4)),

        // 成交統計
        winRate: Number(winRate.toFixed(4)),
        totalTrades: executedBuys + closedTrades,
        closedTrades,
        winTrades,
        tradeRecords,
        equityCurve
    };
}

/**
 * 網格參數智能尋優函數 (Grid Parameter Optimizer)
 * 依據「最大疊層數」與「預防極限跌幅 (預設20%)」篩選安全合格間距，並鎖定最佳效益甜蜜點
 */
export function optimizeGrid(kline, baseOpts = {}) {
    if (!kline || kline.length < 2) {
        throw new Error('K線數據不足，無法進行參數尋優');
    }

    const maxGridLayers = Math.max(1, parseInt(baseOpts.maxGridLayers || baseOpts.maxLayers || 8, 10));
    const stressDropPct = Math.max(1, parseFloat(baseOpts.stressDropPct || 20.0));

    const initialPrice = Number(kline[0].close);
    const unitInfo = getMarketUnitInfo(baseOpts.symbol);
    const orderQuantityUnits = Math.max(1, parseInt(baseOpts.orderQuantity || 1, 10));
    const sharesPerTrade = orderQuantityUnits * unitInfo.multiplier;
    const uniformInitialCash = baseOpts.initialCash !== undefined && baseOpts.initialCash !== '' && !isNaN(baseOpts.initialCash)
        ? Number(baseOpts.initialCash)
        : Math.max(100000, Math.round(sharesPerTrade * initialPrice * (maxGridLayers + 2) * 1.1));

    // 常用間距掃描梯度，並自動納入當前表單設定的跳動間距（若有）
    const candidatePercents = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0];
    if (baseOpts.gridPercent !== undefined && baseOpts.gridPercent !== '' && !isNaN(baseOpts.gridPercent)) {
        const userPct = Number(parseFloat(baseOpts.gridPercent).toFixed(1));
        if (!candidatePercents.includes(userPct)) {
            candidatePercents.push(userPct);
            candidatePercents.sort((a, b) => a - b);
        }
    }
    
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
            const res = runBacktest(kline, {
                ...baseOpts,
                maxGridLayers,
                stressDropPct,
                initialCash: uniformInitialCash,
                gridPercent: pct
            });
            scanResults.push({
                gridPercent: pct,
                realizedProfit: res.realizedProfit,
                gridReturn: res.gridReturn,
                annualizedGridReturn: res.annualizedGridReturn,
                avgProfitPerTrade: res.avgProfitPerTrade,
                maxCapitalDeployed: res.maxCapitalDeployed,
                gridBudgetCapital: res.gridBudgetCapital,
                peakGridCashDeployed: res.peakGridCashDeployed,
                unrealizedProfit: res.unrealizedProfit,
                finalStockUnits: res.finalStockUnits,
                totalReturn: res.totalReturn,
                annualizedReturn: res.annualizedReturn,
                maxDrawdown: res.maxDrawdown,
                winRate: res.winRate,
                totalTrades: res.totalTrades,
                closedTrades: res.closedTrades,
                finalEquity: res.finalEquity,
                maxGridLayers: res.maxGridLayers,
                stressDropPct: res.stressDropPct,
                actualAbsorbedDropPct: res.actualAbsorbedDropPct,
                layersNeededForStress: res.layersNeededForStress,
                isDangerous: res.isDangerous,
                riskRating: res.riskRating,
                starvationPrice: res.starvationPrice,
                downsideBufferPct: res.actualAbsorbedDropPct,
                missedBuys: res.missedBuys,
                capitalExhaustionRate: res.capitalExhaustionRate,
                gridHealthRatio: res.gridHealthRatio
            });
        } catch (err) {
            console.warn(`尋優間距 ${pct}% 失敗:`, err.message);
        }
    }

    if (scanResults.length === 0) {
        throw new Error('參數尋優未能產生有效結果');
    }

    // 1. 最高波動套利收益配置 (無風控過濾，純看賺取最多波動純利潤)
    const bestReturnConfig = [...scanResults].sort((a, b) => b.realizedProfit - a.realizedProfit)[0];

    // 2. 最穩健配置 / 效益甜蜜點 (通過常態跌幅考驗、零擊穿、且套利獲利最優)
    const safeCandidates = scanResults.filter(r => !r.isDangerous && r.missedBuys === 0);
    let bestBalancedConfig;
    if (safeCandidates.length > 0) {
        // 在所有安全合格的間距中，挑選套利純利潤最高的配置
        bestBalancedConfig = [...safeCandidates].sort((a, b) => b.realizedProfit - a.realizedProfit)[0];
    } else {
        // 若用戶設定的層數過低（如僅2~3層）導致所有間距都無法扛住預防跌幅，挑選抗跌深度最深、最不易擊穿的
        bestBalancedConfig = [...scanResults].sort((a, b) => {
            if (b.actualAbsorbedDropPct !== a.actualAbsorbedDropPct) {
                return b.actualAbsorbedDropPct - a.actualAbsorbedDropPct;
            }
            return b.realizedProfit - a.realizedProfit;
        })[0];
    }

    // 3. ATR 建議
    let recommendedAtrPct = candidatePercents.reduce((prev, curr) => 
        Math.abs(curr - avgDailyVolatilityPct) < Math.abs(prev - avgDailyVolatilityPct) ? curr : prev
    );

    return {
        avgDailyVolatilityPct,
        maxGridLayers,
        stressDropPct,
        currentGridPercent: (baseOpts.gridPercent !== undefined && baseOpts.gridPercent !== '' && !isNaN(baseOpts.gridPercent)) ? Number(parseFloat(baseOpts.gridPercent).toFixed(1)) : undefined,
        conditions: {
            orderQuantity: orderQuantityUnits,
            initialStock: baseOpts.initialStock !== undefined && baseOpts.initialStock !== '' ? parseInt(baseOpts.initialStock, 10) : 0,
            maxStock: baseOpts.maxStock !== undefined && baseOpts.maxStock !== '' ? parseInt(baseOpts.maxStock, 10) : undefined,
            minStock: baseOpts.minStock !== undefined && baseOpts.minStock !== '' ? parseInt(baseOpts.minStock, 10) : 0,
            lowerPrice: baseOpts.lowerPrice !== undefined && baseOpts.lowerPrice !== '' ? parseFloat(baseOpts.lowerPrice) : undefined,
            upperPrice: baseOpts.upperPrice !== undefined && baseOpts.upperPrice !== '' ? parseFloat(baseOpts.upperPrice) : undefined,
            maxGridLayers,
            stressDropPct
        },
        recommendations: {
            bestReturn: bestReturnConfig,
            bestBalanced: bestBalancedConfig,
            atrRecommendedPercent: recommendedAtrPct
        },
        ranking: scanResults.sort((a, b) => b.realizedProfit - a.realizedProfit)
    };
}
