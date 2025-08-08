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
    const sinaSymbol = getSinaSymbol(symbol);
    let url;
    // A-share stocks use one API
    if (/^[603]/.test(symbol)) { 
        url = `https://finance.sina.com.cn/realstock/newstock/klc_kl.php?symbol=${sinaSymbol}&type=day`;
    } else { // Funds/ETFs use another
        url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaSymbol}&scale=240&ma=no&datalen=1023`;
    }
    
    console.log(`Fetching K-line data from: ${url}`);
    const responseData = await fetchData(url, { headers: SINA_HEADERS });

    let klineData;
    if (typeof responseData === 'string' && responseData.includes('klc_kl')) {
        const match = responseData.match(/(\[.*?\])/);
        if (match && match[1]) {
            klineData = JSON.parse(match[1].replace(/\\/g, ''));
        }
    } else if (Array.isArray(responseData)) {
        klineData = responseData;
    }

    if (klineData) {
        return klineData.map(item => ({
            date: item.day || item.date,
            open: parseFloat(item.open),
            high: parseFloat(item.high),
            low: parseFloat(item.low),
            close: parseFloat(item.close),
            volume: parseInt(item.volume, 10)
        }));
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

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Ready to accept requests.');
});

app.get('/', (req, res) => {
    res.send('Stock data proxy server is running.');
});
