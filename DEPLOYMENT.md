# Deployment and Architecture Explanation

This document explains the design philosophy, architecture of the "Stock/ETF Volatility Viewer," and why it requires a local server to run.

## The Core Problem: Browser's Same-Origin Policy

Modern web browsers enforce a critical security mechanism known as the **Same-Origin Policy**. This policy dictates that a script from one origin (e.g., our application's `app.js`) can only request resources from the same "origin" (defined by the combination of protocol, domain, and port).

Our frontend page, `app.html`, is loaded from your local filesystem via the `file:///` protocol. However, the data it needs to fetch, such as stock data from Sina Finance, resides at a web address like `https://finance.sina.com.cn`.

To a browser, `file:///` and `https://finance.sina.com.cn` are two completely different origins. Therefore, for security reasons, the browser blocks scripts in `app.html` from directly making network requests to Sina Finance's servers. This restriction is known as a **Cross-Origin Resource Sharing (CORS)** issue.

## The Solution: A Local Server as a Proxy

To solve the CORS problem, we use a classic solution: **introducing a local backend server to act as an intermediary proxy**.

### Architecture Diagram

```
+-----------------+      /       +------------------------+
|   Your Browser  |     /         |   Remote API Server    |
|  (running app.html) |    /          | (e.g., Sina Finance)   |
+-----------------+   /            +------------------------+
        |            /|\                      |
        |             | (Blocked by CORS)      |
        |            \|/                      |
        |                                     |
        | 1. Request to Local Server          | 2. Server forwards request
        +------------------------------------>+
                                              |
+-----------------+      3. API returns data to server    +------------------------+
| Local Node.js Server |<------------------------------------+ (No CORS for servers)      |
| (localhost:3000)  |                                     |
+-----------------+      4. Server returns data to browser  |
        ^                                     |
        |                                     |
        +-------------------------------------+
```

### Workflow

1.  **Frontend Request**: When you click "Query" in the browser, the frontend JavaScript (`app.js`) no longer requests data directly from Sina Finance. Instead, it sends a request to our own local server at `http://localhost:3000/api/kline`.
2.  **Backend Forwarding**: The local server (`server.js`) receives this request. Since server-side programs (like Node.js) are not bound by the browser's Same-Origin Policy, they can freely make network requests to any external API (like Sina Finance).
3.  **Data Fetching**: The local server successfully fetches the stock data from Sina Finance.
4.  **Data Return**: The local server then sends the retrieved data back to the frontend page. Because the frontend and the local server are both on `localhost` (which can be considered the same origin), the browser permits this data exchange.

In this way, the local server acts as a bridge, elegantly bypassing the browser's CORS restrictions and allowing the frontend to successfully fetch and display external data.

## Component Roles

-   **`app.html`, `app.js`, `style.css` (Frontend)**
    -   **Role**: User Interface (UI)
    -   **Responsibilities**: Provide the interactive interface, receive user input (stock codes, dates), render Candlestick and Amplitude charts using ECharts, and send all data requests to the local backend.

-   **`server.js` (Backend)**
    -   **Role**: Data Proxy
    -   **Responsibilities**: Listen for API requests from the frontend, use libraries like `axios` or `node-fetch` to make HTTP requests to the actual external data source (Sina Finance), process the response (including handling character encoding issues, e.g., converting `gbk` to `utf-8`), and finally, return clean JSON data to the frontend.

-   **`package.json`**
    -   **Role**: Project Manifest
    -   **Responsibilities**: Defines project information, lists dependencies (like `express`, `axios`), and configures shortcut commands (like `npm start`).

We hope this document helps you better understand how this tool works.