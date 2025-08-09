# Stock Volatility Viewer - Ubuntu Installation Guide

This guide will walk you through setting up and running the Stock/ETF Volatility Viewer on Ubuntu (or other Debian-based Linux distributions).

## Overview

This tool consists of two main parts:
1.  **Frontend**: The interface you see in your browser (`app.html`), which uses the ECharts.js library to render charts.
2.  **Backend**: A local Node.js server (`server.js`) responsible for fetching data from sources like Sina Finance. It securely delivers this data to the frontend, bypassing browser Cross-Origin Resource Sharing (CORS) issues.

To use this tool, you need to run both the frontend and backend simultaneously.

## Installation Steps

### 1. Install Node.js

The backend server requires the Node.js environment to run. On Linux, we recommend using `nvm` (Node Version Manager) to install Node.js, as it avoids permission issues and makes it easy to manage multiple versions.

- **Install nvm**: Open a terminal and run the following command to download and install nvm:
  ```shell
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  ```
  After the installation, you'll need to close and reopen your terminal or run `source ~/.bashrc` (or `~/.zshrc`, depending on your shell) for the `nvm` command to become available.

- **Install Node.js with nvm**: In the terminal, run the following command to install the latest LTS (Long-Term Support) version:
  ```shell
  nvm install --lts
  nvm use --lts
  ```

- **Verify**: After installation, enter the following commands to verify:
  ```shell
  node -v
  npm -v
  ```
  If you see version numbers (e.g., `v20.11.0`), the installation was successful.

### 2. Download the Project Files

- **Using Git**: Open a terminal in your desired project folder and run:
  ```shell
  git clone https://github.com/your-username/your-repo-name.git
  cd your-repo-name
  ```
  *(Please replace `your-username/your-repo-name` with the actual repository URL)*

### 3. Install Project Dependencies

The project relies on third-party libraries, which you need to install using `npm`.

- **Run Installation Command**:
  In the terminal, from the project directory, run the following command and wait for it to complete.
  ```shell
  npm install
  ```
  A `node_modules` folder will be created.

### 4. Run the Backend Server

- **Start the Server**: In the same terminal, run the following command to start the backend server:
  ```shell
  npm start
  ```
- **Keep it Running**: You will see a message like `Server is running on http://localhost:3000`. You can leave this terminal window open to keep the server running.

- **(Optional) Run in Background**: If you want the server to run in the background without tying up a terminal, you can use `&`:
  ```shell
  npm start &
  ```
  The server will now run in the background. To stop it, you can bring it to the foreground with the `fg` command and press `Ctrl + C`, or use the `kill` command.

### 5. Open the Frontend Page

- **Open in Browser**: In the project folder, find the `app.html` file. You can double-click it in your file manager or run the following in the terminal:
  ```shell
  # xdg-open is a generic command to open files with the default application
  xdg-open app.html
  ```
- **Start Using**: Once the page loads, you can enter a stock or ETF code, select a date range, and click "Query" to view the charts.

---
The application is now ready to use. Enjoy!
