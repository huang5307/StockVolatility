# Windows Installation Guide

This guide explains how to set up and run the Stock Volatility Viewer on a local Windows machine.

## 1. Prerequisites

You need to install the following software. If you already have them, you can skip this section.

### 1.1. Install Node.js and npm

Node.js is the runtime environment for the server, and npm is its package manager.

1.  **Download** the installer from the official website: [https://nodejs.org/](https://nodejs.org/)
2.  Select the **LTS (Long-Term Support)** version, which is recommended for most users.
3.  Run the downloaded installer and follow the on-screen instructions. Default settings are fine.
4.  To verify the installation, open a new Command Prompt or PowerShell window and run:
    ```bash
    node -v
    npm -v
    ```
    You should see the version numbers printed.

### 1.2. Install Git (Optional but Recommended)

Git is used for version control. It's the easiest way to get the project files from GitHub.

1.  **Download** the installer from the official website: [https://git-scm.com/downloads](https://git-scm.com/downloads)
2.  Run the installer and follow the on-screen instructions. Default settings are generally fine.

## 2. Setup Instructions

### 2.1. Get the Project Code

Open a terminal (Command Prompt, PowerShell, or Git Bash) and run the following command to clone the repository from GitHub:

```bash
# Replace <your-github-repo-url> with the actual URL of your repository
git clone <your-github-repo-url>

# Navigate into the newly created project directory
cd "Stock Volatility"
```

*Alternative: If you don't use Git, you can download the project as a ZIP file from GitHub and extract it to a folder on your computer.*

### 2.2. Install Dependencies

Once you are inside the project directory, install the necessary libraries listed in `package.json`:

```bash
npm install
```
This command will create a `node_modules` folder containing all the required code.

## 3. Running the Application

### 3.1. Start the Backend Server

The server is responsible for fetching stock data and serving the application files.

To start it, run the following command in your terminal from the project root directory:

```bash
npm start
```

Alternatively, you can run:

```bash
node server.js
```

You should see a message confirming that the server is running, like `Server running at http://localhost:3000`.

**Keep this terminal window open.** The server needs to be running for the application to work.

### 3.2. Open the Application

Now that the server is running, open your web browser (like Chrome, Firefox, or Edge) and navigate to the following address:

**`http://localhost:3000/app.html`**

The application interface should now be visible and ready to use.

## 4. Stopping the Application

To stop the server, go back to the terminal window where it is running and press **`Ctrl + C`**. Confirm by pressing `Y` if prompted.
