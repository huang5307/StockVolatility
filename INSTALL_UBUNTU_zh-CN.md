# Stock Volatility Viewer - Ubuntu 安装指南

本指南将引导您如何在 Ubuntu (或其它基于 Debian 的 Linux 发行版) 系统上成功安装并运行股票/ETF振幅查看器。

## 概览

本工具由两部分组成：
1.  **前端 (Frontend)**: 您在浏览器中看到的界面 (`app.html`)，使用 ECharts.js 库来渲染图表。
2.  **后端 (Backend)**: 一个基于 Node.js 的本地服务器 (`server.js`)，它负责从新浪财经等数据源获取数据，并将其安全地传送给前端，从而解决了浏览器的跨域资源共享 (CORS) 问题。

为了使用本工具，您需要同时运行前端和后端。

## 安装步骤

### 1. 安装 Node.js

后端服务器需要 Node.js 环境才能运行。在 Linux 系统上，推荐使用 `nvm` (Node Version Manager) 来安装 Node.js，这样可以避免权限问题，并且方便管理多个版本。

- **安装 nvm**: 打开终端 (Terminal)，运行以下命令来下载并安装 nvm：
  ```shell
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  ```
  安装完成后，您需要关闭并重新打开终端，或者运行 `source ~/.bashrc` (或 `~/.zshrc` 等，取决于您的 shell) 来使 `nvm` 命令生效。

- **使用 nvm 安装 Node.js**: 在终端中，运行以下命令来安装最新的 LTS (长期支持) 版本：
  ```shell
  nvm install --lts
  nvm use --lts
  ```

- **验证**: 安装完成后，输入以下命令并按回车：
  ```shell
  node -v
  npm -v
  ```
  如果屏幕上显示了相应的版本号 (例如 `v20.11.0`)，则表示安装成功。

### 2. 下载本项目文件

- **使用 Git**: 在您想存放项目的文件夹中打开终端，然后运行以下命令：
  ```shell
  git clone https://github.com/your-username/your-repo-name.git
  cd your-repo-name
  ```
  *(请将 `your-username/your-repo-name` 替换为实际的仓库地址)*

### 3. 安装项目依赖

项目依赖于一些第三方库来运行，您需要使用 `npm` 来安装它们。

- **运行安装命令**:
  在项目目录的终端中，输入以下命令并等待其完成。
  ```shell
  npm install
  ```
  完成后，您会看到一个 `node_modules` 文件夹被创建。

### 4. 运行后端服务器

- **启动服务器**: 在同一个终端中，运行以下命令来启动后端服务器：
  ```shell
  npm start
  ```
- **保持运行**: 您会看到类似 `Server is running on http://localhost:3000` 的消息。您可以将此终端窗口放在一旁，让它保持运行。

- **(可选) 在后台运行**: 如果您希望服务器在后台运行，不占用一个终端窗口，可以使用 `&`：
  ```shell
  npm start &
  ```
  这样服务器就会在后台运行。当您想关闭它时，可以使用 `fg` 命令将其调回前台，然后按 `Ctrl + C`，或者使用 `kill` 命令。

### 5. 打开前端页面

- **在浏览器中打开**: 在项目文件夹中，找到 `app.html` 文件。您可以在文件管理器中双击它，或者在终端中运行：
  ```shell
  # xdg-open 是一个通用的命令，可以在默认浏览器中打开文件
  xdg-open app.html
  ```
- **开始使用**: 页面加载后，您就可以输入股票或ETF代码，选择日期范围，然后点击“查询”来查看图表了。

---
现在，您可以开始使用了。祝您使用愉快！
