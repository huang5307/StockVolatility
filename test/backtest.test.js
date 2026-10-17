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
    assert.ok(uncappedBuys > 1, '未設定庫存上限時，後續觸網買單應正常買進');

    console.log('✅ 所有繁體中文新版蛛網交易「疊層預算 + 20%波段防禦 + 標的自訂風控條件」單測全部通過！');
})().catch(err => {
    console.error('測試失敗:', err);
    process.exit(1);
});
