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

    // 若設定的價格區間完全脫離標的歷史真實波動範圍，自動校正為合規區間
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

    const initialPrice = Number(kline[0].close);
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
    const openPositions = [];
    if (currentStockUnits > 0) {
        openPositions.push({
            id: 0,
            date: kline[0].date,
            buyPrice: initialPrice,
            shares: currentShares,
            units: currentStockUnits,
            note: '原始庫存底倉'
        });
    }

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
    let currentCapitalDeployed = currentStockUnits * sharesPerTrade > 0 ? currentShares * initialPrice : 0;
    let maxCapitalDeployed = currentCapitalDeployed > 0 ? currentCapitalDeployed : sharesPerTrade * initialPrice;

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
                        executedBuys++;

                        openPositions.push({
                            id: tradeId++,
                            date: curDate,
                            buyPrice: line,
                            shares: sharesPerTrade,
                            units: orderQuantityUnits,
                            gridLine: line
                        });

                        currentCapitalDeployed += buyCost;
                        if (currentCapitalDeployed > maxCapitalDeployed) {
                            maxCapitalDeployed = currentCapitalDeployed;
                        }

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
                            currentStockUnits,
                            note: `⚠️ 跌破蛛網線 $${line.toFixed(2)} 觸發買點，但可用現金僅 $${Math.round(cash).toLocaleString()} 不足支付 $${Math.round(buyCost).toLocaleString()}，資金斷糧暫停承接`
                        });
                        break;
                    }
                }
            }
        }

        // --- 2. 逢漲觸網賣出判斷 (High 漲破某一網格線 - 專屬配對撮合) ---
        for (let g = 0; g < gridLines.length; g++) {
            const line = gridLines[g];
            // 當日向上穿過該網格線，且前一日收盤低於該網格線
            if (dayHigh >= line && prevClose < line) {
                if (currentStockUnits - orderQuantityUnits >= minStockUnits && openPositions.length > 0 && line <= upperPrice) {
                    // 正統網格配對：尋找買入價低於當前賣出價 (buyPrice < line) 的持倉單，優先配對買入價最接近且低於本檔的持倉（低買高賣獲利平倉）
                    let bestIdx = -1;
                    let maxBuyBelow = -1;
                    for (let p = 0; p < openPositions.length; p++) {
                        if (openPositions[p].buyPrice < line) {
                            if (openPositions[p].buyPrice > maxBuyBelow) {
                                maxBuyBelow = openPositions[p].buyPrice;
                                bestIdx = p;
                            }
                        }
                    }

                    if (bestIdx !== -1) {
                        const matchedBuy = openPositions.splice(bestIdx, 1)[0];
                        const sellShares = Math.min(currentShares, sharesPerTrade);
                        const revenue = sellShares * line;

                        cash += revenue;
                        currentStockUnits -= orderQuantityUnits;
                        currentShares -= sellShares;
                        currentCapitalDeployed = Math.max(0, currentCapitalDeployed - sellShares * matchedBuy.buyPrice);
                        closedTrades++;

                        const pnl = (line - matchedBuy.buyPrice) * sellShares;
                        realizedProfit += pnl;
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
                            buyPrice: matchedBuy.buyPrice,
                            buyDate: matchedBuy.date,
                            currentStockUnits,
                            note: `突破蛛網線 $${line.toFixed(2)} 賣出 ${orderQuantityUnits} ${unitInfo.unitName} (低吸高拋配對: $${matchedBuy.buyPrice.toFixed(2)}, 套利 +$${Math.round(pnl).toLocaleString()})`
                        });
                        break; // 當天只觸發一次賣出
                    }
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
            close: dayClose,
            realizedProfit: Number(realizedProfit.toFixed(2))
        });
    }

    // 期末持倉浮動損益結算
    const finalClosePrice = Number(kline[kline.length - 1].close);
    const finalStockValue = currentShares * finalClosePrice;
    const finalEquity = cash + finalStockValue;
    
    // 剩餘持倉浮動盈虧 = 剩餘持股市值 - 剩餘持股買入成本
    const remainingCost = openPositions.reduce((sum, pos) => sum + pos.shares * pos.buyPrice, 0);
    const unrealizedProfit = finalStockValue - remainingCost;

    // 網格波動套利純報酬率 = 累計純套利利潤 / 網格最大動用資金
    const safeMaxCapital = Math.max(1000, maxCapitalDeployed);
    const gridReturn = realizedProfit / safeMaxCapital;

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
        maxCapitalDeployed: Number(safeMaxCapital.toFixed(2)),
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
        : Math.max(150000, Math.round(sharesPerTrade * initialPrice * (maxGridLayers + 2) * 1.1));

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
        recommendations: {
            bestReturn: bestReturnConfig,
            bestBalanced: bestBalancedConfig,
            atrRecommendedPercent: recommendedAtrPct
        },
        ranking: scanResults.sort((a, b) => b.realizedProfit - a.realizedProfit)
    };
}
