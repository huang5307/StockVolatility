# Stock Volatility Viewer - Windows Installation Guide

This guide will walk you through setting up and running the Stock/ETF Volatility Viewer on a Windows system.

## Overview

This tool consists of two main parts:
1.  **Frontend**: The interface you see in your browser (`app.html`), which uses the ECharts.js library to render charts.
2.  **Backend**: A local Node.js server (`server.js`) responsible for fetching data from sources like Sina Finance. It securely delivers this data to the frontend, bypassing browser Cross-Origin Resource Sharing (CORS) issues.

To use this tool, you need to run both the frontend and backend simultaneously.

## Installation Steps

### 1. Install Node.js

The backend server requires the Node.js environment to run.

- **Download**: Visit the [official Node.js website](https://nodejs.org/). We recommend downloading the **LTS (Long-Term Support)** version for its stability.
- **Install**: Once downloaded, run the installer and follow the default setup instructions. The installer will automatically add `node` and `npm` (Node.js Package Manager) to your system's PATH.
- **Verify**: After installation, open a new Command Prompt (CMD) or PowerShell window and enter the following commands:
  ```shell
  node -v
  npm -v
  ```
  If you see version numbers (e.g., `v20.11.0`), the installation was successful.

### 2. Download the Project Files

- **Method 1 (Recommended): Using Git**
  If you have [Git](https://git-scm.com/downloads) installed, open a command line in your desired project folder and run:
  ```shell
  git clone https://github.com/your-username/your-repo-name.git
  cd your-repo-name
  ```
  *(Please replace `your-username/your-repo-name` with the actual repository URL)*

- **Method 2: Download ZIP File**
  On the project's main page, click the "Code" button and select "Download ZIP". After downloading, extract the ZIP file to a location of your choice (e.g., `D:\Projects\StockVolatility`).

### 3. Install Project Dependencies

The project relies on third-party libraries, which you need to install using `npm`.

- **Open Command Line**:
  - If you used Git, you should already be in the project directory.
  - If you downloaded a ZIP file, open the folder, type `cmd` in the address bar, and press Enter. This will open a command prompt in the current directory.
- **Run Installation Command**:
  In the command prompt window, type the following command and wait for it to complete. It will automatically download and install all dependencies listed in the `package.json` file.
  ```shell
  npm install
  ```
  Once finished, you will see a `node_modules` folder, which contains all the necessary libraries.

### 4. Run the Backend Server

- **Start the Server**: In the same command prompt window, run the following command to start the backend server:
  ```shell
  npm start
  ```
- **Keep it Running**: You will see a message like `Server is running on http://localhost:3000`. **Do not close this command window.** Closing it will stop the backend service, and the frontend will be unable to fetch data.

### 5. Open the Frontend Page

- **Open in Browser**: In the project folder, find the `app.html` file and double-click it, or right-click and choose to open it with your preferred browser (e.g., Chrome, Edge, Firefox).
- **Start Using**: Once the page loads, you can enter a stock or ETF code, select a date range, and click "Query" to view the charts.

## (Optional) Create Desktop Shortcuts

For easier daily use, you can create shortcuts for the `app.html` frontend and the backend server.

1.  **Frontend Shortcut**:
    - Right-click on the `app.html` file and select "Send to" -> "Desktop (create shortcut)".
    - You can now open the application directly from your desktop.

2.  **Backend Server Shortcut**:
    - Right-click on an empty area of your desktop and select "New" -> "Shortcut".
    - In the "Type the location of the item" field, enter the following (modify the path to match your project's location):
      ```
      cmd /k "cd /d C:\path\to\your\project && npm start"
      ```
      For example: `cmd /k "cd /d D:\Projects\StockVolatility && npm start"`
    - Click "Next", give the shortcut a name (e.g., "Start Stock Server"), and click "Finish".
    - Now, you can just double-click this shortcut to start the backend server without manually opening a command prompt each time.

---
The application is now ready to use. Enjoy!