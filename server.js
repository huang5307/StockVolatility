const db = require('./db');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const iconv = require('iconv-lite');

const app = express();
const port = 3000;

app.use(express.static(path.join(__dirname)));
app.use(cors());

// --- Utility Functions ---

const SINA_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
    'Referer': 'https://finance.sina.com.cn/'
};

const fetchData = async (url, options = {}) => {
    try {
        const response = await axios.get(url, options);
        return response.data;
    } catch (error) {
        console.error(`Error fetching data from ${url}:`, error.message);
        if (error.response) {
            console.error(`Error Response Status: ${error.response.status}`);
            console.error('Error Response Data:', error.response.data);
            throw new Error(`API request to ${url} failed with status ${error.response.status}`);
        }
        throw new Error('Network error or API is unreachable.');
    }
};

const getSinaSymbol = (symbol) => {
    if (/^[65]/.test(symbol)) return `sh${symbol}`; // Shanghai stocks & funds
    if (/^[013]/.test(symbol)) return `sz${symbol}`; // Shenzhen stocks & funds
    return symbol; // Fallback for other cases (e.g., non-A-share)
};

// --- Data Fetching and Parsing ---

async function getSinaName(symbol) {
    const sinaSymbol = getSinaSymbol(symbol);
    const url = `http://hq.sinajs.cn/list=${sinaSymbol}`;
    console.log(`Fetching name from: ${url}`);
    const responseText = await fetchData(url, {
        headers: SINA_HEADERS,
        responseType: 'arraybuffer',
        transformResponse: [data => iconv.decode(data, 'gb2312')]
    });
    const match = responseText.match(/var hq_str_.*="(.*)";/);
    if (match && match[1] && match[1].length > 1) {
        const parts = match[1].split(',');
        console.log(`Found name for ${symbol}: ${parts[0]}`);
        return parts[0];
    }
    console.warn(`Could not parse name for ${symbol}. Returning code as name.`);
    return symbol; // Fallback
}

async function getFinMindName(symbol) {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo&data_id=${symbol}`;
    console.log(`Fetching Taiwan stock name from: ${url}`);
    const result = await fetchData(url);
    if (result.data && result.data.length > 0 && result.data[0].stock_name) {
        return result.data[0].stock_name;
    }
    console.warn(`Could not parse name for Taiwan stock ${symbol}. Returning code as name.`);
    return symbol; // Fallback
}

async function getKLineData(symbol) {
    const sinaSymbol = getSinaSymbol(symbol);   // 已经带上 sh/ sz 前缀
    // 统一使用 sina 的 json_v2 接口（适用于沪深 A‑股）
    const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=1023`;

    console.log(`Fetching K-line data from: ${url}`);
    const responseData = await fetchData(url, { headers: SINA_HEADERS });

    // sina 返回的是一个数组，每项包含 day, open, high, low, close, volume 等字段
    if (Array.isArray(responseData)) {
        return responseData.map(item => ({
            date: item.day || item.date,
            open: parseFloat(item.open),
            high: parseFloat(item.high),
            low: parseFloat(item.low),
            close: parseFloat(item.close),
            volume: parseInt(item.volume, 10)
        }));
    }
    // 兜底：如果意外返回了字符串（极少见），尝试提取 JSON 数组
    if (typeof responseData === 'string' && responseData.includes('[')) {
        const match = responseData.match(/(\[.*?\])/);
        if (match) {
            try {
                const arr = JSON.parse(match[1].replace(/\\/g, ''));
                return arr.map(item => ({
                    date: item.day || item.date,
                    open: parseFloat(item.open),
                    high: parseFloat(item.high),
                    low: parseFloat(item.low),
                    close: parseFloat(item.close),
                    volume: parseInt(item.volume, 10)
                }));
            } catch (_) {
                // 继续抛出错误
            }
        }
    }
    throw new Error(`Could not parse K-line data for ${symbol}. Response was not in expected format.`);
}

async function getFinMindData(symbol) {
    const url = `https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=${symbol}&start_date=2020-01-01`;
    console.log(`Fetching Taiwan stock data from: ${url}`);
    const result = await fetchData(url);
    if (result.data && result.data.length > 0) {
        return result.data.map(item => ({
            date: item.date,
            open: item.open,
            high: item.max,
            low: item.min,
            close: item.close,
            volume: item.Trading_Volume
        }));
    }
    throw new Error(`No data returned from FinMind API for ${symbol}.`);
}

// --- API Endpoints ---

app.get('/api/stock-info', async (req, res) => {
    console.log(`[${new Date().toISOString()}] Received request for /api/stock-info with query:`, req.query);
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Stock symbol is required' });

    try {
        let namePromise;
        if (/^\d{4}$/.test(symbol) || /^00\d{2,4}[A-Z]?$/.test(symbol)) { // Taiwan
            namePromise = getFinMindName(symbol);
        } else { // A-share & others
            namePromise = getSinaName(symbol);
        }
        const name = await namePromise;
        res.json({ name });
    } catch (error) {
        console.error(`[ERROR] While fetching info for symbol ${symbol}:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/kline', async (req, res) => {
    console.log(`[${new Date().toISOString()}] Received request for /api/kline with query:`, req.query);
    const { symbol } = req.query;
    if (!symbol) return res.status(400).json({ error: 'Stock symbol is required' });

    try {
        let klinePromise, namePromise;
        if (/^\d{4}$/.test(symbol) || /^00\d{2,4}[A-Z]?$/.test(symbol)) { // Taiwan Stocks and ETFs
            klinePromise = getFinMindData(symbol);
            namePromise = getFinMindName(symbol);
        } else { // A-share Stocks and Funds
            klinePromise = getKLineData(symbol);
            namePromise = getSinaName(symbol);
        }
        const [kline, name] = await Promise.all([klinePromise, namePromise]);
        res.json({ name, kline });
    } catch (error) {
        console.error(`[ERROR] While processing symbol ${symbol}:`, error.message);
        res.status(500).json({ error: error.message });
    }
});

// --- Server Initialization ---


let runBacktest;
async function getRunBacktest() {
    if (!runBacktest) {
        const mod = await import('./functions/_shared/backtestEngine.js');
        runBacktest = mod.runBacktest;
    }
    return runBacktest;
}


app.get('/api/backtest', async (req, res) => {
    const { symbol, startDate, endDate, gridSize, initialCapital, lowerPrice, upperPrice } = req.query;

    // 参数校验（最小校验，细节可自行扩展）
    if (!symbol || !startDate || !endDate || !gridSize || !initialCapital) {
        return res.status(400).json({ error: 'Missing required query parameters' });
    }

    const opts = {
        gridSize: parseInt(gridSize, 10),
        lowerPrice: lowerPrice !== undefined ? parseFloat(lowerPrice) : undefined,
        upperPrice: upperPrice !== undefined ? parseFloat(upperPrice) : undefined,
        initialCapital: parseFloat(initialCapital)
    };

    try {
        // 根据 symbol 判断是 A‑股还是台湾股
        let kline;
        if (/^\\d{4}$/.test(symbol) || /^00\\d{2,4}[A-Z]?$/.test(symbol)) {
            // 台湾股票或 ETF
            kline = await getFinMindData(symbol);
        } else {
            // A‑股
            kline = await getKLineData(symbol);
        }

        // 过滤出用户请求的时间范围
        const filtered = kline.filter(p => p.date >= startDate && p.date <= endDate);
        if (filtered.length === 0) {
            return res.status(404).json({ error: 'No K‑line data in the given date range' });
        }

        const runBt = await getRunBacktest();
        const result = runBt(filtered, opts);

        // 保存到 SQLite
        const dbRecord = {
            symbol,
            startDate,
            endDate,
            gridSize: opts.gridSize,
            lowerPrice: opts.lowerPrice ?? null,
            upperPrice: opts.upperPrice ?? null,
            initialCapital: opts.initialCapital,
            finalEquity: result.finalEquity,
            totalTrades: result.totalTrades,
            winRate: result.winRate,
            maxDrawdown: result.maxDrawdown
        };
        db.saveBacktest(dbRecord, (err, id) => {
            if (err) {
                console.error('Failed to save backtest record:', err);
            }
        });

        res.json({ summary: dbRecord, trades: result.tradeRecords });
    } catch (e) {
        console.error('Backtest error:', e);
        res.status(500).json({ error: e.message });
    }
});
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Ready to accept requests.');
});

app.get('/', (req, res) => {
    res.send('Stock data proxy server is running.');
});


module.exports = { getRunBacktest, app };

