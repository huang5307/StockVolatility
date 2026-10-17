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
    const optResult = optimizeGrid(sampleKLine, { symbol: '2330', initialStock: 0 });
    console.log('最佳報酬配置:', optResult.recommendations.bestReturn);
    console.log('最穩健配置:', optResult.recommendations.bestBalanced);
    console.log('ATR 平均日波幅 %:', optResult.avgDailyVolatilityPct);

    assert.ok(optResult.ranking.length > 0, '尋優應產生各間距效益排行榜');
    assert.ok(optResult.recommendations.bestReturn.gridPercent > 0, '應找出最佳收益間距');
    assert.strictEqual(typeof optResult.recommendations.bestBalanced.gridHealthRatio, 'number', '最穩健配置應提供網格風報比');
    assert.strictEqual(typeof optResult.recommendations.bestBalanced.downsideBufferPct, 'number', '最穩健配置應提供抗跌承接深度');

    console.log('--- 測試 3: 資金承接風險與斷糧停擺 (Capital Exhaustion Risk & Missed Buys) ---');
    // 現金僅足夠買進 1 次，後續下跌觸發時應記錄斷糧受阻
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
        抗跌深度: `${lowCashRes.downsideBufferPct}%`,
        資金枯竭率: `${lowCashRes.capitalExhaustionRate}%`
    });

    assert.ok(lowCashRes.missedBuys >= 1, '現金不足時應正確記錄斷糧停擺筆數');
    assert.ok(lowCashRes.capitalExhaustionRate > 0, '應計算出資金枯竭率');
    assert.ok(lowCashRes.tradeRecords.some(r => r.type === 'missed_buy'), '成交流水應包含資金斷糧警告紀錄');
    assert.strictEqual(typeof lowCashRes.starvationPrice, 'number', '應提供臨界斷糧價格');
    assert.strictEqual(typeof lowCashRes.maxAffordableTrades, 'number', '應提供最大可承接筆數');
    assert.strictEqual(typeof lowCashRes.requiredSafeCash30, 'number', '應提供抗跌30%所需安全現金');

    console.log('✅ 所有繁體中文新版蛛網交易回測與尋優單測全部通過！');
})().catch(err => {
    console.error('測試失敗:', err);
    process.exit(1);
});
