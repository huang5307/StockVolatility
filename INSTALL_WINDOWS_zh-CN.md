# Windows 安装指南

本指南说明如何在本地 Windows 计算机上设置并运行“股票/ETF振幅查看器”。

## 1. 先决条件

您需要安装以下软件。如果已经安装，可以跳过此部分。

### 1.1. 安装 Node.js 和 npm

Node.js 是服务器的运行环境，npm 是其包管理器。

1.  **下载**：从官方网站下载安装程序：[https://nodejs.org/](https://nodejs.org/)
2.  选择 **LTS (长期支持)** 版本，这是大多数用户的推荐选项。
3.  运行下载的安装程序，并按照屏幕上的说明进行操作。使用默认设置即可。
4.  要验证安装是否成功，请打开一个新的命令提示符 (Command Prompt) 或 PowerShell 窗口，并运行：
    ```bash
    node -v
    npm -v
    ```
    您应该能看到对应的版本号输出。

### 1.2. 安装 Git (可选，但推荐)

Git 用于版本控制，是从 GitHub 获取项目文件的最简单方法。

1.  **下载**：从官方网站下载安装程序：[https://git-scm.com/downloads](https://git-scm.com/downloads)
2.  运行安装程序，并按照屏幕上的说明进行操作。同样，使用默认设置即可。

## 2. 设置步骤

### 2.1. 获取项目代码

打开一个终端 (命令提示符、PowerShell 或 Git Bash)，运行以下命令从 GitHub 克隆仓库：

```bash
# 将 <你的GitHub仓库URL> 替换为实际的仓库地址
git clone <你的GitHub仓库URL>

# 进入新创建的项目目录
cd "Stock Volatility"
```

*替代方法：如果您不使用 Git，也可以从 GitHub 下载项目的 ZIP 压缩包，然后解压到本地文件夹。*

### 2.2. 安装依赖项

进入项目目录后，安装 `package.json` 中列出的所有必需库：

```bash
npm install
```
此命令会创建一个 `node_modules` 文件夹，其中包含所有必需的代码。

## 3. 运行应用

### 3.1. 启动后端服务器

服务器负责获取股票数据并提供应用文件。

在项目根目录的终端中运行以下命令来启动它：

```bash
npm start
```

或者，您也可以运行：

```bash
node server.js
```

您应该会看到确认服务器正在运行的消息，例如 `Server running at http://localhost:3000`。

**请保持此终端窗口打开**，服务器需要持续运行才能使应用正常工作。

### 3.2. 打开应用

服务器运行后，打开您的网络浏览器（如 Chrome、Firefox 或 Edge），并访问以下地址：

**`http://localhost:3000/app.html`**

应用界面现在应该可见并可以使用了。

## 4. 停止应用

要停止服务器，请返回其正在运行的终端窗口，然后按 **`Ctrl + C`**。如果出现提示，按 `Y` 确认即可。
