import { getStockName, getKLine } from '../_shared/stockService.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    if (!symbol) {
        return Response.json({ error: '請提供股票代號 (Stock symbol is required)' }, { status: 400 });
    }

    try {
        const [name, kline] = await Promise.all([
            getStockName(symbol, env),
            getKLine(symbol, env, startDate, endDate)
        ]);

        return Response.json({ symbol, name, kline });
    } catch (error) {
        console.error(`[API kline] Error fetching K-line for ${symbol}:`, error);
        return Response.json({ error: error.message || '獲取K線數據失敗' }, { status: 500 });
    }
}
