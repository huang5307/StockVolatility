import { getStockName, getKLine } from '../../_shared/stockService.js';
import { optimizeGrid, getMarketUnitInfo } from '../../_shared/backtestEngine.js';

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
        upperPrice,
        maxGridLayers = 8,
        stressDropPct = 20.0
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

        if (filteredKline.length < 5) {
            return Response.json({ error: '選定時間區間內的交易日過少（需至少5個交易日），無法進行參數尋優' }, { status: 400 });
        }

        const baseOpts = {
            symbol,
            gridPercent: gridPercent !== undefined && gridPercent !== '' ? parseFloat(gridPercent) : 3.0,
            orderQuantity: parseInt(orderQuantity, 10) || 1,
            initialStock: parseInt(initialStock, 10) || 0,
            maxStock: maxStock !== undefined && maxStock !== '' ? parseInt(maxStock, 10) : undefined,
            minStock: parseInt(minStock, 10) || 0,
            initialCash: initialCash !== undefined && initialCash !== '' ? parseFloat(initialCash) : undefined,
            lowerPrice: lowerPrice !== undefined && lowerPrice !== '' ? parseFloat(lowerPrice) : undefined,
            upperPrice: upperPrice !== undefined && upperPrice !== '' ? parseFloat(upperPrice) : undefined,
            maxGridLayers: parseInt(maxGridLayers, 10) || 8,
            stressDropPct: parseFloat(stressDropPct) || 20.0
        };

        const optimizationResult = optimizeGrid(filteredKline, baseOpts);
        const unitInfo = getMarketUnitInfo(symbol);

        return Response.json({
            symbol,
            stockName: name,
            unitInfo,
            startDate: filteredKline[0].date,
            endDate: filteredKline[filteredKline.length - 1].date,
            tradingDays: filteredKline.length,
            ...optimizationResult
        });
    } catch (error) {
        console.error('[API backtest/optimize] Error:', error);
        return Response.json({ error: error.message || '參數尋優執行失敗' }, { status: 500 });
    }
}
