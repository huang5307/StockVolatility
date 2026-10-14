import { getStockName } from '../_shared/stockService.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const symbol = url.searchParams.get('symbol');

    if (!symbol) {
        return Response.json({ error: 'Stock symbol is required' }, { status: 400 });
    }

    try {
        const name = await getStockName(symbol, env);
        return Response.json({ symbol, name });
    } catch (error) {
        console.error(`[API stock-info] Error fetching name for ${symbol}:`, error);
        return Response.json({ error: error.message || 'Failed to fetch stock info' }, { status: 500 });
    }
}
