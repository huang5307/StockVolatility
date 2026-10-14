-- Cloudflare D1 日K線歷史行情表 (歷史數據永久保存與增量同步)
CREATE TABLE IF NOT EXISTS stock_daily_kline (
    symbol TEXT NOT NULL,
    date TEXT NOT NULL,
    open REAL NOT NULL,
    high REAL NOT NULL,
    low REAL NOT NULL,
    close REAL NOT NULL,
    volume REAL DEFAULT 0,
    PRIMARY KEY (symbol, date)
);

CREATE INDEX IF NOT EXISTS idx_kline_sym_date ON stock_daily_kline(symbol, date ASC);

-- 標的中文名稱持久化表
CREATE TABLE IF NOT EXISTS stock_info (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
