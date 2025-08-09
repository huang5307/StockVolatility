# Stock Volatility Viewer / 股票振幅查看器

## 简介

本项目是一个股票/ETF振幅查看器。其主要目的是为了帮助使用者在进行股票网格交易时，通过观察历史振幅数据，来寻找和设定一个合适的网格交易间距，目前支持A股与台股。

## Introduction

This project is a stock/ETF volatility viewer. Its main purpose is to help users find and set suitable grid trading intervals by observing historical volatility data for stock grid trading strategies.

## 功能
*   输入股票或ETF代码，查询其近期振幅。
*   可视化数据，方便判断交易间距。

## Features
*   Enter a stock or ETF code to query its recent volatility.
*   Visualize data to help determine trading intervals.

## 安装与运行

1.  **安装依赖**
    ```bash
    npm install
    ```

2.  **启动后端服务器**
    ```bash
    npm start
    ```
    此命令会启动一个本地服务器来解决API跨域请求问题。

3.  **打开应用**
    在浏览器中直接打开 `app.html` 文件即可使用。

## Installation and Usage

1.  **Install dependencies**
    ```bash
    npm install
    ```

2.  **Start the backend server**
    ```bash
    npm start
    ```
    This command starts a local server to handle API CORS issues.

3.  **Open the application**
    Open the `app.html` file directly in your browser to use the application.
