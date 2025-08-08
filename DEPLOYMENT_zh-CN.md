# Ubuntu 24 VPS 部署指南

本指南提供在运行 Ubuntu 24 的服务器上部署“股票/ETF振幅查看器”应用的详细步骤。

## 1. 本地项目准备 (先决条件)

在部署之前，您的项目应使用 Git 进行版本控制。

### 1.1. 创建 `.gitignore` 文件

在项目根目录中创建一个名为 `.gitignore` 的文件，以防止不必要的文件（如 `node_modules`）被上传。文件内容如下：

```
# 依赖项
/node_modules

# 其他
.DS_Store
desktop.ini
npm-debug.log*
yarn-debug.log*
yarn-error.log*
```

### 1.2. 发布到 GitHub

1.  **初始化 Git**：如果您尚未初始化仓库，请在项目目录中打开终端并运行：
    ```bash
    git init
    git add .
    git commit -m "Initial commit"
    ```
2.  **发布代码**：在 GitHub 上创建一个新的仓库，并将您的本地代码推送到该仓库。
    ```bash
    git remote add origin <你的GitHub仓库URL>
    git branch -M main
    git push -u origin main
    ```
    *提示：Visual Studio Code 提供了“发布到 GitHub”的功能，可以自动完成此过程。*

## 2. 服务器设置与配置

通过 SSH 连接到您的 VPS，并设置所需的环境。

### 2.1. 连接与更新
```bash
# 连接到您的服务器
ssh your_username@your_vps_ip

# 更新系统软件包
sudo apt update && sudo apt upgrade -y
```

### 2.2. 安装 Git
```bash
sudo apt install git -y
```

### 2.3. 通过 nvm 安装 Node.js 和 npm
推荐使用 nvm (Node Version Manager)，它可以避免权限问题，并轻松管理 Node.js 版本。

```bash
# 下载并运行 nvm 安装脚本
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# 使 nvm 命令在当前 shell 中生效
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# 安装最新的长期支持 (LTS) 版本的 Node.js
nvm install --lts
```

## 3. 部署代码

将代码仓库克隆到您的服务器上，并安装依赖项。

```bash
# 为您的应用创建一个目录
mkdir ~/app && cd ~/app

# 从 GitHub 克隆您的仓库
git clone <你的GitHub仓库URL> .

# 安装项目依赖
npm install
```

## 4. 使用 PM2 运行应用

PM2 是一个进程管理器，可以使您的应用在后台持续运行，并在崩溃时自动重启。

```bash
# 全局安装 PM2
npm install pm2 -g

# 使用 PM2 启动服务器
pm2 start server.js --name "stock-app"

# 设置 PM2 开机自启
pm2 startup

# 根据屏幕提示操作，它会要求您运行一行类似下面的命令：
# sudo env PATH=$PATH:/home/user/.nvm/versions/node/vXX.X.X/bin pm2 startup ...

# 保存当前进程列表，以便重启后恢复
pm2 save
```

## 5. 配置防火墙

允许外部流量访问您的应用程序端口。

```bash
# 允许 SSH 连接 (非常重要！)
sudo ufw allow ssh

# 允许外部访问应用的端口 (3000)
sudo ufw allow 3000/tcp

# 启用防火墙
sudo ufw enable
```

## 6. 访问您的应用

现在，您可以在浏览器中通过服务器的 IP 地址访问您的应用了：

**`http://your_vps_ip:3000/app.html`**
