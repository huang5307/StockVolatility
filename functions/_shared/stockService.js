/**
 * 股票数据获取与缓存服务 (适用于 Cloudflare Pages Functions)
 */

const SINA_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://finance.sina.com.cn/'
};

const TENCENT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://gu.qq.com/'
};

// 格式化股票代码前缀（A股）
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

// 判断是否为台湾股票或 ETF
export function isTaiwanStock(symbol) {
    const clean = symbol.trim();
    return /^\d{4}$/.test(clean) || /^00\d{2,4}[A-Z]?$/i.test(clean);
}

/**
 * 获取股票名称（带 KV 缓存）
 */
export async function getStockName(symbol, env) {
    const cacheKey = `name:${symbol.toLowerCase()}`;
    if (env?.STOCK_CACHE) {
        try {
            const cachedName = await env.STOCK_CACHE.get(cacheKey);
            if (cachedName) return cachedName;
        } catch (e) {
            console.warn('KV read error:', e);
        }
    }

    let name = symbol;
    if (isTaiwanStock(symbol)) {
        name = await fetchFinMindName(symbol);
    } else {
        // 先尝试新浪，失败降级到腾讯
        try {
            name = await fetchSinaName(symbol);
        } catch (sinaErr) {
            console.warn(`Sina name fetch failed for ${symbol}, trying Tencent:`, sinaErr.message);
            name = await fetchTencentName(symbol);
        }
    }

    if (env?.STOCK_CACHE && name && name !== symbol) {
        try {
            // 缓存 30 天
            await env.STOCK_CACHE.put(cacheKey, name, { expirationTtl: 30 * 86400 });
        } catch (e) {
            console.warn('KV write error:', e);
        }
    }

    return name;
}

/**
 * 获取 K 线数据（带 KV 缓存）
 */
export async function getKLine(symbol, env) {
    const cacheKey = `kline:${symbol.toLowerCase()}`;
    if (env?.STOCK_CACHE) {
        try {
            const cachedData = await env.STOCK_CACHE.get(cacheKey, 'json');
            if (cachedData && Array.isArray(cachedData) && cachedData.length > 0) {
                return cachedData;
            }
        } catch (e) {
            console.warn('KV read error for kline:', e);
        }
    }

    let klineData;
    if (isTaiwanStock(symbol)) {
        klineData = await fetchFinMindKLine(symbol);
    } else {
        klineData = await fetchSinaKLine(symbol);
    }

    if (env?.STOCK_CACHE && Array.isArray(klineData) && klineData.length > 0) {
        try {
            // 缓存 30 分钟 (1800 秒)
            await env.STOCK_CACHE.put(cacheKey, JSON.stringify(klineData), { expirationTtl: 1800 });
        } catch (e) {
            console.warn('KV write error for kline:', e);
        }
    }

    return klineData;
}

// --- 内部获取逻辑 ---

async function fetchFinMindName(symbol) {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&data_id=${symbol}`;
    const res = await fetch(url);
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

async function fetchFinMindKLine(symbol) {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=2020-01-01`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`FinMind API returned status ${res.status}`);
    const json = await res.json();
    if (json.data && json.data.length > 0) {
        return json.data.map(item => ({
            date: item.date,
            open: Number(item.open),
            high: Number(item.max),
            low: Number(item.min),
            close: Number(item.close),
            volume: Number(item.Trading_Volume)
        }));
    }
    throw new Error(`FinMind 没有返回 ${symbol} 的 K 线数据`);
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
