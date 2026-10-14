export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    if (!env?.STOCK_DB) {
        return Response.json({
            error: 'D1 資料庫未配置或未綁定 (STOCK_DB is not bound)',
            records: []
        }, { status: 200 });
    }

    try {
        if (id) {
            const query = `SELECT * FROM backtest_records WHERE id = ?`;
            const record = await env.STOCK_DB.prepare(query).bind(id).first();
            if (!record) {
                return Response.json({ error: '查無此回測紀錄 (Record not found)' }, { status: 404 });
            }
            if (record.trade_records && typeof record.trade_records === 'string') {
                record.trade_records = JSON.parse(record.trade_records);
            }
            if (record.equity_curve && typeof record.equity_curve === 'string') {
                record.equity_curve = JSON.parse(record.equity_curve);
            }
            return Response.json(record);
        } else {
            const query = `
                SELECT id, symbol, stock_name, start_date, end_date, grid_percent,
                       order_quantity, initial_stock, max_stock, initial_cash,
                       total_initial_equity, final_equity, total_return, annualized_return,
                       max_drawdown, win_rate, total_trades, created_at
                FROM backtest_records
                ORDER BY created_at DESC
                LIMIT ?
            `;
            const { results } = await env.STOCK_DB.prepare(query).bind(limit).all();
            return Response.json({ records: results || [] });
        }
    } catch (error) {
        console.error('[API backtest/history] Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
}
