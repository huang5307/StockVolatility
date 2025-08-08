# Ubuntu 24 VPS Deployment Guide

This guide provides step-by-step instructions to deploy the Stock Volatility Viewer application on a server running Ubuntu 24.

## 1. Local Project Preparation (Prerequisites)

Before deploying, your project should be under version control with Git.

### 1.1. Create a `.gitignore` file

Create a file named `.gitignore` in the project root with the following content to prevent unnecessary files from being uploaded:

```
# Dependencies
/node_modules

# Misc
.DS_Store
desktop.ini
npm-debug.log*
yarn-debug.log*
yarn-error.log*
```

### 1.2. Publish to GitHub

1.  **Initialize Git**: If you haven't already, open a terminal in your project directory and run:
    ```bash
    git init
    git add .
    git commit -m "Initial commit"
    ```
2.  **Publish**: Create a new repository on GitHub and push your local code to it.
    ```bash
    git remote add origin <your-github-repo-url>
    git branch -M main
    git push -u origin main
    ```
    *Tip: Visual Studio Code provides a simple "Publish to GitHub" feature that automates this process.*

## 2. Server Setup & Configuration

Connect to your VPS via SSH and set up the necessary environment.

### 2.1. Connect and Update
```bash
# Connect to your server
ssh your_username@your_vps_ip

# Update system packages
sudo apt update && sudo apt upgrade -y
```

### 2.2. Install Git
```bash
sudo apt install git -y
```

### 2.3. Install Node.js and npm via nvm
Using nvm (Node Version Manager) is recommended as it avoids permission issues.

```bash
# Download and run the nvm installation script
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Source the shell configuration to enable nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Install the latest Long-Term Support (LTS) version of Node.js
nvm install --lts
```

## 3. Deploy the Code

Clone the repository onto your server and install dependencies.

```bash
# Create a directory for your app
mkdir ~/app && cd ~/app

# Clone your repository from GitHub
git clone <your-github-repo-url> .

# Install project dependencies
npm install
```

## 4. Run the Application with PM2

PM2 is a process manager that will keep your application running in the background and restart it automatically if it crashes.

```bash
# Install PM2 globally
npm install pm2 -g

# Start the server using PM2
pm2 start server.js --name "stock-app"

# Set PM2 to start automatically on system boot
pm2 startup

# Follow the on-screen instructions, which will ask you to run a command like:
# sudo env PATH=$PATH:/home/user/.nvm/versions/node/vXX.X.X/bin pm2 startup ...

# Save the current process list for reboot
pm2 save
```

## 5. Configure the Firewall

Allow external traffic to access your application's port.

```bash
# Allow SSH connections (crucial!)
sudo ufw allow ssh

# Allow traffic to your app's port (3000)
sudo ufw allow 3000/tcp

# Enable the firewall
sudo ufw enable
```

## 6. Access Your Application

You can now access your application in a web browser using your server's IP address:

**`http://your_vps_ip:3000/app.html`**
