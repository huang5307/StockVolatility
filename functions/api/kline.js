import { getStockName, getKLine } from '../_shared/stockService.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol');

    if (!symbol) {
        return Response.json({ error: 'Stock symbol is required' }, { status: 400 });
    }

    try {
        const [name, kline] = await Promise.all([
            getStockName(symbol, env),
            getKLine(symbol, env)
        ]);

        return Response.json({ symbol, name, kline });
    } catch (error) {
        console.error(`[API kline] Error fetching K-line for ${symbol}:`, error);
        return Response.json({ error: error.message || 'Failed to fetch K-line data' }, { status: 500 });
    }
}
