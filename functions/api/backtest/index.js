import { getStockName, getKLine } from '../../_shared/stockService.js';
import { runBacktest, getMarketUnitInfo } from '../../_shared/backtestEngine.js';

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    let params = {};
    if (request.method === 'POST') {
        try {
            params = await request.json();
        } catch (_) {
            params = {};
        }
    } else {
        params = Object.fromEntries(url.searchParams.entries());
    }

    const {
        symbol,
        startDate,
        endDate,
        gridPercent = 3.0,
        orderQuantity = 1,
        initialStock = 0,
        maxStock,
        minStock = 0,
        initialCash,
        lowerPrice,
        upperPrice
    } = params;

    if (!symbol) {
        return Response.json({ error: '請提供股票代號 (Stock symbol is required)' }, { status: 400 });
    }

    try {
        let allKline = Array.isArray(params.kline) && params.kline.length > 0 ? params.kline : null;
        let name = params.stockName || null;

        if (!allKline || !name) {
            const [fetchedName, fetchedKline] = await Promise.all([
                name ? Promise.resolve(name) : getStockName(symbol, env),
                allKline ? Promise.resolve(allKline) : getKLine(symbol, env)
            ]);
            name = fetchedName;
            allKline = fetchedKline;
        }

        if (!Array.isArray(allKline) || allKline.length === 0) {
            return Response.json({ error: '查無歷史K線數據' }, { status: 404 });
        }

        // 過濾日期區間
        let filteredKline = allKline;
        if (startDate || endDate) {
            filteredKline = allKline.filter(p => {
                if (startDate && p.date < startDate) return false;
                if (endDate && p.date > endDate) return false;
                return true;
            });
        }

        if (filteredKline.length < 2) {
            return Response.json({ error: '選定時間區間內的K線數據過少（少於2個交易日），無法執行回測' }, { status: 400 });
        }

        const opts = {
            symbol,
            gridPercent: parseFloat(gridPercent) || 3.0,
            orderQuantity: parseInt(orderQuantity, 10) || 1,
            initialStock: parseInt(initialStock, 10) || 0,
            maxStock: maxStock !== undefined && maxStock !== '' ? parseInt(maxStock, 10) : undefined,
            minStock: parseInt(minStock, 10) || 0,
            initialCash: initialCash !== undefined && initialCash !== '' ? parseFloat(initialCash) : undefined,
            lowerPrice: lowerPrice !== undefined && lowerPrice !== '' ? parseFloat(lowerPrice) : undefined,
            upperPrice: upperPrice !== undefined && upperPrice !== '' ? parseFloat(upperPrice) : undefined
        };

        const result = runBacktest(filteredKline, opts);
        const unitInfo = getMarketUnitInfo(symbol);

        // 持久化儲存至 Cloudflare D1
        let savedId = null;
        if (env?.STOCK_DB) {
            try {
                const insertSql = `
                    INSERT INTO backtest_records (
                        symbol, stock_name, start_date, end_date,
                        grid_percent, order_quantity, initial_stock, max_stock, min_stock,
                        lower_price, upper_price, initial_cash, total_initial_equity,
                        final_equity, total_return, annualized_return, max_drawdown,
                        win_rate, total_trades, trade_records, equity_curve
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;
                const stmt = env.STOCK_DB.prepare(insertSql).bind(
                    symbol,
                    name,
                    filteredKline[0].date,
                    filteredKline[filteredKline.length - 1].date,
                    result.initialParams.gridPercent,
                    result.initialParams.orderQuantityUnits,
                    result.initialParams.initialStockUnits,
                    result.initialParams.maxStockUnits,
                    result.initialParams.minStockUnits,
                    result.initialParams.lowerPrice,
                    result.initialParams.upperPrice,
                    result.initialParams.initialCash,
                    result.initialParams.totalInitialEquity,
                    result.finalEquity,
                    result.totalReturn,
                    result.annualizedReturn,
                    result.maxDrawdown,
                    result.winRate,
                    result.totalTrades,
                    JSON.stringify(result.tradeRecords),
                    JSON.stringify(result.equityCurve)
                );
                const dbRes = await stmt.run();
                savedId = dbRes?.meta?.last_row_id || null;
            } catch (dbErr) {
                console.warn('寫入 D1 資料庫失敗:', dbErr);
            }
        }

        return Response.json({
            id: savedId,
            symbol,
            stockName: name,
            unitInfo,
            startDate: filteredKline[0].date,
            endDate: filteredKline[filteredKline.length - 1].date,
            tradingDays: filteredKline.length,
            initialParams: result.initialParams,
            summary: {
                realizedProfit: result.realizedProfit,
                gridReturn: result.gridReturn,
                annualizedGridReturn: result.annualizedGridReturn,
                maxCapitalDeployed: result.maxCapitalDeployed,
                unrealizedProfit: result.unrealizedProfit,
                totalInitialEquity: result.initialParams.totalInitialEquity,
                initialCash: result.initialParams.initialCash,
                finalEquity: result.finalEquity,
                finalCash: result.finalCash,
                finalStockUnits: result.finalStockUnits,
                finalStockValue: result.finalStockValue,
                totalReturn: result.totalReturn,
                annualizedReturn: result.annualizedReturn,
                maxDrawdown: result.maxDrawdown,
                winRate: result.winRate,
                totalTrades: result.totalTrades,
                closedTrades: result.closedTrades,
                winTrades: result.winTrades
            },
            trades: result.tradeRecords,
            equityCurve: result.equityCurve
        });
    } catch (error) {
        console.error('[API backtest] Error:', error);
        return Response.json({ error: error.message || '回測執行失敗' }, { status: 500 });
    }
}
