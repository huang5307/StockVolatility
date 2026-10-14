-- Cloudflare D1 初始資料表遷移文件 (蛛網量化回測記錄)
CREATE TABLE IF NOT EXISTS backtest_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    stock_name TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    grid_percent REAL NOT NULL,          -- 跳動間距 (%)
    order_quantity INTEGER NOT NULL,     -- 每筆交易單位 (張/手)
    initial_stock INTEGER DEFAULT 0,     -- 原始庫存
    max_stock INTEGER,                   -- 最大庫存限制
    min_stock INTEGER DEFAULT 0,         -- 最小庫存底倉
    lower_price REAL,                    -- 價格下限
    upper_price REAL,                    -- 價格上限
    initial_cash REAL NOT NULL,          -- 初始現金
    total_initial_equity REAL NOT NULL,  -- 初始總資產 (現金 + 股票市值)
    final_equity REAL NOT NULL,          -- 期末總權益
    total_return REAL NOT NULL,          -- 總報酬率 (例如 0.156 代表 15.6%)
    annualized_return REAL,              -- 年化報酬率
    max_drawdown REAL NOT NULL,          -- 最大回撤 / 最大回檔比率
    win_rate REAL NOT NULL,              -- 勝率 (0.0 ~ 1.0)
    total_trades INTEGER NOT NULL,       -- 總成交次數
    trade_records TEXT,                  -- 成交流水明細 (JSON 字串)
    equity_curve TEXT,                   -- 每日資產走勢淨值曲線 (JSON 字串)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bt_symbol ON backtest_records(symbol);
CREATE INDEX IF NOT EXISTS idx_bt_created ON backtest_records(created_at DESC);
