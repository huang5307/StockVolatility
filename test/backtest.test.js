const assert = require('assert');

(async () => {
    const { runBacktest, optimizeGrid } = await import('../functions/_shared/backtestEngine.js');

    console.log('--- 測試 1: 台股單位 (張) 與跳動間距 (%) 震盪回測 ---');
    const sampleKLine = [
        { date: '2024-01-01', high: 105, low: 98, close: 100 },
        { date: '2024-01-02', high: 101, low: 94, close: 95 },  // 跌 5% (買進)
        { date: '2024-01-03', high: 106, low: 96, close: 102 }, // 漲超 5% (賣出獲利)
        { date: '2024-01-04', high: 103, low: 94, close: 95 },  // 再跌 (買進)
        { date: '2024-01-05', high: 108, low: 98, close: 103 }  // 再漲 (賣出獲利)
    ];

    const opts = {
        symbol: '2330', // 台股，單位為「張」(1000股)
        gridPercent: 4.0, // 4% 間距
        orderQuantity: 1, // 每次 1 張
        initialStock: 2, // 原始庫存 2 張
        minStock: 1, // 底倉保留 1 張
        maxStock: 5,
        initialCash: 500000
    };

    const result = runBacktest(sampleKLine, opts);
    console.log('台股回測摘要:', {
        單位: result.unitInfo.unitName,
        初始總權益: result.initialParams.totalInitialEquity,
        期末總權益: result.finalEquity,
        總報酬率: `${(result.totalReturn * 100).toFixed(2)}%`,
        成交筆數: result.totalTrades,
        勝率: `${(result.winRate * 100).toFixed(1)}%`
    });

    assert.strictEqual(result.unitInfo.unitName, '張', '台股交易單位應為「張」');
    assert.ok(result.totalReturn > 0, '震盪套利應產生正報酬');
    assert.ok(result.finalStockUnits >= opts.minStock, '期末庫存不可低於最小底倉');

    console.log('--- 測試 2: 智能參數尋優 (Grid Parameter Optimizer) ---');
    const optResult = optimizeGrid(sampleKLine, { symbol: '2330', initialStock: 0, maxGridLayers: 8, stressDropPct: 20 });
    console.log('最佳報酬配置:', optResult.recommendations.bestReturn);
    console.log('最穩健配置 (甜蜜點):', optResult.recommendations.bestBalanced);
    console.log('ATR 平均日波幅 %:', optResult.avgDailyVolatilityPct);

    assert.ok(optResult.ranking.length > 0, '尋優應產生各間距效益排行榜');
    assert.ok(optResult.recommendations.bestReturn.gridPercent > 0, '應找出最佳收益間距');
    assert.strictEqual(optResult.maxGridLayers, 8, '應記錄最大承接層數 (8層)');
    assert.strictEqual(optResult.stressDropPct, 20, '應記錄預防極限跌幅 (20%)');
    assert.strictEqual(typeof optResult.recommendations.bestBalanced.actualAbsorbedDropPct, 'number', '甜蜜點配置應提供實際抗跌深度');
    assert.strictEqual(typeof optResult.recommendations.bestBalanced.layersNeededForStress, 'number', '甜蜜點配置應提供抗跌所需層數');

    console.log('--- 測試 3: 實盤風控評估 - 疊層預算與 20% 波段跌幅壓力測試 ---');
    // 1% 間距：在 8 層內僅能抗跌 7.7% < 20%，需 23 層才能抗 20%，判定為危險/易擊穿
    const res1Pct = runBacktest(sampleKLine, {
        symbol: '2330',
        gridPercent: 1.0,
        maxGridLayers: 8,
        stressDropPct: 20
    });
    console.log('1% 間距風控評估:', {
        抗跌深度: `${res1Pct.actualAbsorbedDropPct}%`,
        所需層數: res1Pct.layersNeededForStress,
        是否易擊穿: res1Pct.isDangerous,
        評級: res1Pct.riskRating
    });
    assert.strictEqual(res1Pct.isDangerous, true, '1% 間距在 8 層內無法防禦 20% 跌幅，應判定為危險/易擊穿');
    assert.strictEqual(res1Pct.riskRating, 'danger', '風險評級應為 danger');
    assert.ok(res1Pct.layersNeededForStress > 8, '所需層數應超過 8 層預算');

    // 3% 間距：在 8 層內抗跌 21.6% >= 20%，需 8 層即可抗 20%，判定為安全合格
    const res3Pct = runBacktest(sampleKLine, {
        symbol: '2330',
        gridPercent: 3.0,
        maxGridLayers: 8,
        stressDropPct: 20
    });
    console.log('3% 間距風控評估:', {
        抗跌深度: `${res3Pct.actualAbsorbedDropPct}%`,
        所需層數: res3Pct.layersNeededForStress,
        是否易擊穿: res3Pct.isDangerous,
        評級: res3Pct.riskRating
    });
    assert.strictEqual(res3Pct.isDangerous, false, '3% 間距在 8 層內可完整防禦 20% 跌幅，應判定為安全合格');
    assert.strictEqual(res3Pct.riskRating, 'safe', '風險評級應為 safe');
    assert.ok(res3Pct.layersNeededForStress <= 8, '所需層數應在 8 層預算內');

    // 自訂風控測試：用戶改為 6 層預算，抗 20% 跌幅
    // 3% 間距需 8 層 > 6 層 -> 判定為危險
    // 4% 間距需 6 層 <= 6 層 -> 判定為安全
    const res3Pct_6Layers = runBacktest(sampleKLine, {
        symbol: '2330',
        gridPercent: 3.0,
        maxGridLayers: 6,
        stressDropPct: 20
    });
    assert.strictEqual(res3Pct_6Layers.isDangerous, true, '預算縮小至 6 層時，3% 間距應判定為危險');

    const res4Pct_6Layers = runBacktest(sampleKLine, {
        symbol: '2330',
        gridPercent: 4.0,
        maxGridLayers: 6,
        stressDropPct: 20
    });
    assert.strictEqual(res4Pct_6Layers.isDangerous, false, '預算 6 層時，4% 間距可扛住 20% 跌幅，應判定為安全合格');

    console.log('--- 測試 4: 實盤資金不足斷糧停擺 (Missed Buys) ---');
    const lowCashOpts = {
        symbol: '2330',
        gridPercent: 3.0,
        orderQuantity: 1,
        initialStock: 0,
        initialCash: 120000 // 僅夠首筆買進 ~97,000，第二次買進將資金不足
    };
    const lowCashKLine = [
        { date: '2024-01-01', high: 100, low: 100, close: 100 },
        { date: '2024-01-02', high: 99, low: 95, close: 96 }, // 觸發第1買 (買進成功，剩餘現金約 23,000)
        { date: '2024-01-03', high: 95, low: 90, close: 91 }  // 觸發第2買 (現金不足，斷糧停擺)
    ];
    const lowCashRes = runBacktest(lowCashKLine, lowCashOpts);
    console.log('低資金斷糧測試結果:', {
        斷糧筆數: lowCashRes.missedBuys,
        抗跌深度: `${lowCashRes.actualAbsorbedDropPct}%`,
        資金枯竭率: `${lowCashRes.capitalExhaustionRate}%`,
        斷糧臨界價: lowCashRes.starvationPrice
    });

    assert.ok(lowCashRes.missedBuys >= 1, '現金不足時應正確記錄斷糧停擺筆數');
    assert.ok(lowCashRes.capitalExhaustionRate > 0, '應計算出資金枯竭率');
    assert.ok(lowCashRes.tradeRecords.some(r => r.type === 'missed_buy'), '成交流水應包含資金斷糧警告紀錄');
    assert.strictEqual(typeof lowCashRes.starvationPrice, 'number', '應提供臨界斷糧價格');

    console.log('--- 測試 5: 庫存上限 (超過之後就不買；0或未設定為不考慮) ---');
    const continuousDropKLine = [
        { date: '2024-01-01', high: 100, low: 100, close: 100 },
        { date: '2024-01-02', high: 97, low: 94, close: 95 }, // 第1買
        { date: '2024-01-03', high: 93, low: 89, close: 90 }, // 第2買
        { date: '2024-01-04', high: 88, low: 84, close: 85 }  // 第3買
    ];

    // 設定庫存上限為 1 張 (超過就不買)
    const cappedRes = runBacktest(continuousDropKLine, {
        symbol: '2330',
        gridPercent: 3.0,
        orderQuantity: 1,
        initialStock: 0,
        maxStock: 1,
        initialCash: 1000000
    });
    const cappedBuys = cappedRes.tradeRecords.filter(t => t.type === 'buy').length;
    console.log('受庫存上限限制的買進次數 (上限1張):', cappedBuys);
    assert.strictEqual(cappedBuys, 1, '庫存上限為 1 張時，達到上限後續下跌不應再買進');

    // 未設定庫存上限 (0 或空)，應不考慮上限限制
    const uncappedRes = runBacktest(continuousDropKLine, {
        symbol: '2330',
        gridPercent: 3.0,
        orderQuantity: 1,
        initialStock: 0,
        maxStock: 0,
        initialCash: 1000000
    });
    const uncappedBuys = uncappedRes.tradeRecords.filter(t => t.type === 'buy').length;
    console.log('未設定庫存上限時的買進次數 (0代表無限制):', uncappedBuys);
    // --- 測試 6: 智能尋優 (optimizeGrid) 與實盤交易條件完全對齊 ---
    console.log('--- 測試 6: 智能尋優 (optimizeGrid) 與實盤交易條件完全對齊 ---');
    const customOpts = {
        symbol: '2330',
        gridPercent: 2.8, // 自訂不在預設列表中的間距
        orderQuantity: 15,
        initialStock: 10,
        maxStock: 50,
        minStock: 5,
        maxGridLayers: 8,
        stressDropPct: 20
    };
    const optCustomRes = optimizeGrid(sampleKLine, customOpts);
    assert.ok(optCustomRes.conditions, '尋優結果應包含 conditions 元數據');
    assert.strictEqual(optCustomRes.conditions.orderQuantity, 15, '尋優 conditions 中的 orderQuantity 應為 15');
    assert.strictEqual(optCustomRes.conditions.initialStock, 10, '尋優 conditions 中的 initialStock 應為 10');
    assert.strictEqual(optCustomRes.conditions.maxStock, 50, '尋優 conditions 中的 maxStock 應為 50');
    assert.strictEqual(optCustomRes.conditions.minStock, 5, '尋優 conditions 中的 minStock 應為 5');
    // 確認 2.8% 自訂間距被自動納入掃描候選
    const has28Pct = optCustomRes.ranking.some(r => Math.abs(r.gridPercent - 2.8) < 0.01);
    assert.strictEqual(has28Pct, true, '自訂跳動間距 2.8% 應自動納入尋優掃描結果中');
    console.log('自訂交易條件尋優測試通過，2.8% 自訂間距已成功納入掃描排行！');

    console.log('--- 測試 7: 最大佔用本金與套利報酬率分母公式驗證 (排除原始庫存底倉，區分台股與陸股單位乘數) ---');
    // 台股案例 (如 00685L): 15張/筆，8層，起始價 11.96，原始持股 177張
    const twKLine = [
        { date: '2024-01-01', high: 12.0, low: 11.9, close: 11.96 },
        { date: '2024-01-02', high: 11.9, low: 11.5, close: 11.55 },
        { date: '2024-01-03', high: 12.1, low: 11.6, close: 12.00 }
    ];
    const twRes = runBacktest(twKLine, {
        symbol: '00685L',
        gridPercent: 3.0,
        orderQuantity: 15, // 15 張
        initialStock: 177, // 原始底倉 177 張 (價值約 2,116,920，絕不可計入網格佔用本金！)
        minStock: 177,
        maxGridLayers: 8
    });

    const expectedTwBudget = 8 * 15 * 1000 * 11.96; // 1,435,200
    console.log('台股網格最大佔用本金計算驗證:', {
        實際佔用本金: twRes.maxCapitalDeployed,
        動用峰值: twRes.peakGridCashDeployed,
        理論預算: twRes.gridBudgetCapital,
        套利純利潤: twRes.realizedProfit,
        套利報酬率: `${(twRes.gridReturn * 100).toFixed(2)}%`
    });
    assert.strictEqual(twRes.gridBudgetCapital, expectedTwBudget, '台股網格理論預備預算應為 8 * 15 * 1000 * 11.96 = 1,435,200');
    assert.strictEqual(twRes.maxCapitalDeployed, twRes.peakGridCashDeployed, '台股最大佔用本金應為真實回測動用資金峰值 (peakGridCashDeployed)，絕非固定理論乘數');
    assert.ok(twRes.maxCapitalDeployed > 0 && twRes.maxCapitalDeployed <= expectedTwBudget, '實際佔用本金應在合理區間內');
    assert.strictEqual(twRes.gridReturn, Number((twRes.realizedProfit / twRes.maxCapitalDeployed).toFixed(4)), '套利報酬率分母必須為實際佔用本金峰值');

    // 陸股案例 (如 600519): 2手/筆，8層，起始價 100，原始持股 10手 (1手 = 100股)
    const cnKLine = [
        { date: '2024-01-01', high: 101.0, low: 99.0, close: 100.0 },
        { date: '2024-01-02', high: 99.0, low: 96.0, close: 96.5 },
        { date: '2024-01-03', high: 102.0, low: 97.0, close: 101.0 }
    ];
    const cnRes = runBacktest(cnKLine, {
        symbol: '600519',
        gridPercent: 3.0,
        orderQuantity: 2, // 2 手
        initialStock: 10, // 原始持股 10 手 (一手100股)
        minStock: 10,
        maxGridLayers: 8
    });
    const expectedCnBudget = 8 * 2 * 100 * 100.0; // 160,000
    console.log('陸股網格最大佔用本金計算驗證:', {
        單位: cnRes.unitInfo.unitName,
        乘數: cnRes.unitInfo.multiplier,
        實際佔用本金: cnRes.maxCapitalDeployed,
        理論預算: cnRes.gridBudgetCapital,
        套利純利潤: cnRes.realizedProfit,
        套利報酬率: `${(cnRes.gridReturn * 100).toFixed(2)}%`
    });
    assert.strictEqual(cnRes.unitInfo.unitName, '手', '陸股單位應為「手」');
    assert.strictEqual(cnRes.unitInfo.multiplier, 100, '陸股每手乘數應為 100 股');
    assert.strictEqual(cnRes.gridBudgetCapital, expectedCnBudget, '陸股網格理論預算應為 8 * 2 * 100 * 100 = 160,000');
    assert.strictEqual(cnRes.maxCapitalDeployed, cnRes.peakGridCashDeployed, '陸股最大佔用本金應為真實回測動用資金峰值 (peakGridCashDeployed)');
    assert.strictEqual(cnRes.gridReturn, Number((cnRes.realizedProfit / cnRes.maxCapitalDeployed).toFixed(4)), '陸股套利報酬率分母必須為實際佔用本金');

    console.log('--- 測試 8: 預設值驗證 (未傳入時預設 7 層、20% 預防波段跌幅) ---');
    const defaultBt = runBacktest(sampleKLine, { symbol: '2330', gridPercent: 3.0 });
    assert.strictEqual(defaultBt.maxGridLayers, 7, '回測未指定層數時應預設為 7 層');
    assert.strictEqual(defaultBt.stressDropPct, 20, '回測未指定預防跌幅時應預設為 20%');

    const defaultOpt = optimizeGrid(sampleKLine, { symbol: '2330' });
    assert.strictEqual(defaultOpt.maxGridLayers, 7, '尋優未指定層數時應預設為 7 層');
    assert.strictEqual(defaultOpt.stressDropPct, 20, '尋優未指定預防跌幅時應預設為 20%');

    console.log('✅ 所有繁體中文新版蛛網交易「疊層預算 + 20%波段防禦 + 標的自訂風控條件 (預設7層/20%) + 排除原始庫存本金公式」單測全部通過！');
})().catch(err => {
    console.error('測試失敗:', err);
    process.exit(1);
});
