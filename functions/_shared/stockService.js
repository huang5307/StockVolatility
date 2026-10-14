/**
 * 股票數據獲取、持久化與增量同步服務 (適用於 Cloudflare Pages Functions)
 * 支援 Cloudflare D1 資料庫永久儲存歷史日K，避免重複請求外部 API 浪費額度
 */

const SINA_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://finance.sina.com.cn/'
};

const TENCENT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://gu.qq.com/'
};

// 格式化股票代碼前綴（A股）
export function getSinaSymbol(symbol) {
    const clean = symbol.trim().toLowerCase();
    if (clean.startsWith('sh') || clean.startsWith('sz') || clean.startsWith('bj')) {
        return clean;
    }
    if (/^[65]/.test(clean)) return `sh${clean}`; // 上海
    if (/^[013]/.test(clean)) return `sz${clean}`; // 深圳
    if (/^[48]/.test(clean)) return `bj${clean}`; // 北京
    return clean;
}

// 判斷是否為台灣股票或 ETF
export function isTaiwanStock(symbol) {
    const clean = symbol.trim();
    return /^\d{4}$/.test(clean) || /^00\d{2,4}[A-Z]?$/i.test(clean);
}

// 自動確保 D1 歷史行情資料表存在
let tablesInitialized = false;
export async function ensureTables(db) {
    if (tablesInitialized || !db) return;
    try {
        await db.exec(`
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
            CREATE TABLE IF NOT EXISTS stock_info (
                symbol TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);
        tablesInitialized = true;
    } catch (err) {
        console.warn('ensureTables warning:', err);
    }
}

// 將 K 線資料批次寫入 D1（分批 50 筆，符合 D1 批量建議）
async function batchInsertKLine(db, symbol, rows) {
    if (!db || !Array.isArray(rows) || rows.length === 0) return;
    try {
        const cleanSymbol = symbol.trim().toUpperCase();
        const stmts = rows.map(r => 
            db.prepare(`
                INSERT OR REPLACE INTO stock_daily_kline (symbol, date, open, high, low, close, volume) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).bind(cleanSymbol, r.date, Number(r.open), Number(r.high), Number(r.low), Number(r.close), Number(r.volume || 0))
        );

        for (let i = 0; i < stmts.length; i += 50) {
            await db.batch(stmts.slice(i, i + 50));
        }
    } catch (e) {
        console.warn(`batchInsertKLine failed for ${symbol}:`, e.message);
    }
}

// 計算隔日日期字串 (YYYY-MM-DD)
function getNextDay(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
}

// 判斷是否需要進行今日增量拉取（判斷開盤/收盤狀態）
function shouldCheckIncrementalUpdate(maxDate) {
    if (!maxDate) return true;
    const now = new Date();
    // 台北/北京時間 UTC+8
    const taipei = new Date(now.getTime() + (8 * 60 + now.getTimezoneOffset()) * 60000);
    const todayStr = taipei.toISOString().slice(0, 10);

    // 如果資料庫中最新日期已經等於或超過今天，完全不需要增量
    if (maxDate >= todayStr) return false;

    const dayOfWeek = taipei.getDay(); // 0 是週日，6 是週六
    const hour = taipei.getHours();
    const minute = taipei.getMinutes();
    const timeMinutes = hour * 60 + minute;

    // 計算相差天數
    const diffDays = Math.round((new Date(todayStr + 'T00:00:00Z') - new Date(maxDate + 'T00:00:00Z')) / 86400000);

    // 如果今天是週末，且最新日期是剛過去的週五，則無須請求
    if (dayOfWeek === 6 && diffDays <= 1) return false;
    if (dayOfWeek === 0 && diffDays <= 2) return false;

    // 平日交易時間：台股下午 13:30 收盤，約 13:50 後定案。
    // 如果今天尚未收盤：
    if (timeMinutes < 13 * 60 + 50) {
        if (dayOfWeek === 1 && diffDays <= 3) return false; // 週一盤中，最新日為上週五
        if (diffDays <= 1) return false; // 平日盤中，最新日為昨日
    }

    return true;
}

/**
 * 獲取股票名稱（帶 D1 持久儲存與 KV 快取）
 */
export async function getStockName(symbol, env) {
    const cleanSymbol = symbol.trim().toUpperCase();
    const cacheKey = `name:${cleanSymbol.toLowerCase()}`;

    // 1. 優先查 KV 快取
    if (env?.STOCK_CACHE) {
        try {
            const cachedName = await env.STOCK_CACHE.get(cacheKey);
            if (cachedName) return cachedName;
        } catch (e) {
            console.warn('KV read error:', e);
        }
    }

    // 2. 查 D1 資料庫
    if (env?.STOCK_DB) {
        try {
            await ensureTables(env.STOCK_DB);
            const row = await env.STOCK_DB.prepare('SELECT name FROM stock_info WHERE symbol = ?').bind(cleanSymbol).first();
            if (row && row.name && row.name !== cleanSymbol) {
                if (env?.STOCK_CACHE) {
                    await env.STOCK_CACHE.put(cacheKey, row.name, { expirationTtl: 30 * 86400 }).catch(() => {});
                }
                return row.name;
            }
        } catch (e) {
            console.warn('D1 stock_info read error:', e);
        }
    }

    // 3. 外部 API 獲取
    let name = cleanSymbol;
    if (isTaiwanStock(cleanSymbol)) {
        try {
            name = await fetchFinMindName(cleanSymbol, env);
        } catch (e) {
            console.warn(`FinMind name fetch failed for ${cleanSymbol}:`, e.message);
            name = cleanSymbol;
        }
    } else {
        try {
            name = await fetchSinaName(cleanSymbol);
        } catch (sinaErr) {
            console.warn(`Sina name fetch failed for ${cleanSymbol}, trying Tencent:`, sinaErr.message);
            name = await fetchTencentName(cleanSymbol);
        }
    }

    // 4. 回寫 D1 資料庫與 KV 快取
    if (name && name !== cleanSymbol) {
        if (env?.STOCK_DB) {
            try {
                await env.STOCK_DB.prepare('INSERT OR REPLACE INTO stock_info (symbol, name) VALUES (?, ?)').bind(cleanSymbol, name).run();
            } catch (e) {
                console.warn('D1 stock_info write error:', e);
            }
        }
        if (env?.STOCK_CACHE) {
            try {
                await env.STOCK_CACHE.put(cacheKey, name, { expirationTtl: 30 * 86400 });
            } catch (e) {
                console.warn('KV write error:', e);
            }
        }
    }

    return name;
}

/**
 * 獲取 K 線數據（整合 D1 永久儲存、資料庫優先架構、智能增量同步與 KV 高速快取）
 */
export async function getKLine(symbol, env, targetStartDate, targetEndDate) {
    const cleanSymbol = symbol.trim().toUpperCase();
    const cacheKey = `kline:${cleanSymbol.toLowerCase()}`;

    // 1. 優先查 KV 高速快取（無自訂日期範圍限制時）
    if (env?.STOCK_CACHE && !targetStartDate) {
        try {
            const cachedData = await env.STOCK_CACHE.get(cacheKey, 'json');
            if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
                return cachedData;
            }
        } catch (e) {
            console.warn('KV read error for kline:', e);
        }
    }

    // 2. 核心架構：優先檢查 Cloudflare D1 資料庫現有歷史存檔
    if (env?.STOCK_DB) {
        try {
            await ensureTables(env.STOCK_DB);

            const stats = await env.STOCK_DB.prepare(`
                SELECT COUNT(*) as count, MIN(date) as min_date, MAX(date) as max_date 
                FROM stock_daily_kline 
                WHERE symbol = ?
            `).bind(cleanSymbol).first();

            const count = stats?.count || 0;
            const minDate = stats?.min_date;
            const maxDate = stats?.max_date;

            if (count > 0 && maxDate) {
                // 資料庫已有歷史數據！判斷日期範圍是否都有
                const needIncremental = shouldCheckIncrementalUpdate(maxDate);
                const needEarlier = targetStartDate && minDate && (minDate > targetStartDate);

                // 若日期範圍都有（無需增量，且涵蓋請求的起始日期）：
                // 👉 直接從 D1 讀取回傳，耗時僅需 5~10 毫秒，外部 API 呼叫次數為 0！
                if (!needIncremental && !needEarlier) {
                    const rows = await env.STOCK_DB.prepare(`
                        SELECT date, open, high, low, close, volume 
                        FROM stock_daily_kline 
                        WHERE symbol = ? 
                        ORDER BY date ASC
                    `).bind(cleanSymbol).all();

                    const kline = rows?.results || [];
                    if (kline.length > 0) {
                        return kline;
                    }
                }

                // 若內容不全（有新交易日或缺少起始日期），自外部下載補充至 D1
                if (needIncremental && isTaiwanStock(cleanSymbol)) {
                    const nextStartDate = getNextDay(maxDate);
                    try {
                        const newRows = await fetchFinMindKLine(cleanSymbol, env, nextStartDate);
                        if (Array.isArray(newRows) && newRows.length > 0) {
                            await batchInsertKLine(env.STOCK_DB, cleanSymbol, newRows);
                        }
                    } catch (incErr) {
                        // 若遇到 FinMind 402 或限流，優雅降級！直接使用 D1 已有的全部歷史數據
                        console.warn(`[D1 Incremental] 增量請求失敗 (${incErr.message})，降級使用 D1 資料庫現有歷史存檔`);
                    }
                }

                if (needEarlier && isTaiwanStock(cleanSymbol)) {
                    try {
                        const earlyRows = await fetchFinMindKLine(cleanSymbol, env, targetStartDate);
                        if (Array.isArray(earlyRows) && earlyRows.length > 0) {
                            await batchInsertKLine(env.STOCK_DB, cleanSymbol, earlyRows);
                        }
                    } catch (earlyErr) {
                        console.warn(`[D1 Earlier] 早期歷史請求失敗 (${earlyErr.message})`);
                    }
                }

                // 自 D1 資料庫讀取確認完整後的歷史日K
                const rows = await env.STOCK_DB.prepare(`
                    SELECT date, open, high, low, close, volume 
                    FROM stock_daily_kline 
                    WHERE symbol = ? 
                    ORDER BY date ASC
                `).bind(cleanSymbol).all();

                const kline = rows?.results || [];
                if (kline.length > 0) {
                    if (env?.STOCK_CACHE) {
                        await env.STOCK_CACHE.put(cacheKey, JSON.stringify(kline), { expirationTtl: 14400 }).catch(() => {});
                    }
                    return kline;
                }
            }
        } catch (dbErr) {
            console.warn('[D1 KLine] 資料庫操作異常，降級至直接請求外部 API:', dbErr);
        }
    }

    // 3. 若 D1 中根本沒有該標的歷史存檔（系統第一次查詢該標的），才向外部 API 下載
    let klineData;
    const fetchStart = targetStartDate || '2020-01-01';
    if (isTaiwanStock(cleanSymbol)) {
        klineData = await fetchFinMindKLine(cleanSymbol, env, fetchStart);
    } else {
        klineData = await fetchSinaKLine(cleanSymbol);
    }

    // 4. 將下載的完整歷史日K存入 D1 資料庫，確認數據完整！此後該歷史區間再也不會重複請求！
    if (env?.STOCK_DB && Array.isArray(klineData) && klineData.length > 0) {
        try {
            await ensureTables(env.STOCK_DB);
            await batchInsertKLine(env.STOCK_DB, cleanSymbol, klineData);
        } catch (saveErr) {
            console.warn('[D1 Baseline] 首次寫入 D1 失敗:', saveErr);
        }
    }

    // 5. 寫入 KV 快取 4 小時
    if (env?.STOCK_CACHE && Array.isArray(klineData) && klineData.length > 0) {
        try {
            await env.STOCK_CACHE.put(cacheKey, JSON.stringify(klineData), { expirationTtl: 14400 });
        } catch (e) {
            console.warn('KV write error for kline:', e);
        }
    }

    return klineData;
}

// --- 內部獲取邏輯 ---

async function fetchFinMindName(symbol, env) {
    const rawToken = env?.FINMIND_TOKEN;
    const token = typeof rawToken === 'string' ? rawToken.replace(/^["']|["']$/g, '').trim() : '';
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&data_id=${symbol}${tokenParam}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`FinMind API returned status ${res.status}`);
    const data = await res.json();
    if (data.data && data.data.length > 0 && data.data[0].stock_name) {
        return data.data[0].stock_name;
    }
    return symbol;
}

async function fetchSinaName(symbol) {
    const sinaSymbol = getSinaSymbol(symbol);
    const url = `https://hq.sinajs.cn/list=${sinaSymbol}`;
    const res = await fetch(url, { headers: SINA_HEADERS });
    if (!res.ok) throw new Error(`Sina API returned status ${res.status}`);
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder('gb18030').decode(buffer);
    const match = text.match(/var hq_str_.*="(.*)";/);
    if (match && match[1] && match[1].length > 1) {
        const parts = match[1].split(',');
        return parts[0] || symbol;
    }
    return symbol;
}

async function fetchTencentName(symbol) {
    const sinaSymbol = getSinaSymbol(symbol);
    const url = `https://qt.gtimg.cn/q=${sinaSymbol}`;
    const res = await fetch(url, { headers: TENCENT_HEADERS });
    if (!res.ok) throw new Error(`Tencent API returned status ${res.status}`);
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder('gb18030').decode(buffer);
    const match = text.match(/v_.*="(.*)";/);
    if (match && match[1]) {
        const parts = match[1].split('~');
        if (parts.length > 1 && parts[1]) {
            return parts[1];
        }
    }
    return symbol;
}

async function fetchFinMindKLine(symbol, env, startDate = '2020-01-01') {
    const rawToken = env?.FINMIND_TOKEN;
    const token = typeof rawToken === 'string' ? rawToken.replace(/^["']|["']$/g, '').trim() : '';
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=${startDate}${tokenParam}`;
    let res = await fetch(url, { headers });
    // 若遇到 402 或 429 瞬時流控，延遲 800ms 重試一次，避開 Cloudflare 多請求併發瞬時限流
    if (res.status === 402 || res.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 800));
        res = await fetch(url, { headers });
    }
    if (!res.ok) {
        if (res.status === 402) {
            throw new Error(`FinMind API 回應 402（額度已達上限或 Token 尚未生效）。若剛在 Cloudflare 設定 FINMIND_TOKEN，需觸發新部署生效；亦可稍候每小時配額重置。`);
        }
        throw new Error(`FinMind API returned status ${res.status}`);
    }
    const json = await res.json();
    if (json.data && Array.isArray(json.data) && json.data.length > 0) {
        return json.data.map(item => ({
            date: item.date,
            open: Number(item.open),
            high: Number(item.max),
            low: Number(item.min),
            close: Number(item.close),
            volume: Number(item.Trading_Volume)
        }));
    }
    // 若為增量查詢但無新數據（例如休市、假日或盤中未定案），返回空陣列而非拋錯
    if (startDate > '2020-01-01') {
        return [];
    }
    throw new Error(`FinMind 沒有返回 ${symbol} 的 K 線數據`);
}

async function fetchSinaKLine(symbol) {
    const sinaSymbol = getSinaSymbol(symbol);
    const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=1023`;
    const res = await fetch(url, { headers: SINA_HEADERS });
    if (!res.ok) throw new Error(`Sina KLine API returned status ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data)) {
        return data.map(item => ({
            date: item.day || item.date,
            open: parseFloat(item.open),
            high: parseFloat(item.high),
            low: parseFloat(item.low),
            close: parseFloat(item.close),
            volume: parseInt(item.volume, 10)
        }));
    }
    throw new Error(`无法解析 ${symbol} 的 K 线数据`);
}
