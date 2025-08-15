# Deploying on Ubuntu 22.04 LTS

This guide will walk you through deploying and running this project on an Ubuntu 22.04 LTS server.

## Prerequisites

- A server running Ubuntu 22.04 LTS.
- root or sudo privileges.
- Node.js is installed (v12.x or higher is recommended). You can check the version with the `node -v` command.

## Deployment Steps

Please execute the following commands step by step.

### 1. Clone the Project from GitHub

First, you need to download the project files from the GitHub repository to your server.

```sh
git clone https://github.com/huang5307/StockVolatility.git
```

### 2. Navigate to the Project Directory

After the download is complete, use the `cd` command to enter the project folder.

```sh
cd StockVolatility
```

### 3. Install Project Dependencies

The project depends on `express` and `axios`. You need to install them using npm.

```sh
npm install
```

### 4. Start the Backend Service

Once the dependencies are installed, you can start the Node.js backend service. To ensure the service continues to run after you close the terminal, we strongly recommend using `pm2`, a process manager that can act as a daemon and automatically restart your application on server reboots.

**a. Install pm2**
If `pm2` is not installed on your server, first install it globally with the following command:
```sh
npm install pm2 -g
```

**b. Start the Service with pm2**
Then, use `pm2` to start `server.js`:
```sh
pm2 start server.js --name StockVolatility
```
This command will start your service in the background and name it "StockVolatility". You can check the status of your services with `pm2 list`.

**c. Set up Startup on Reboot**
To have the service automatically start when the server reboots, execute the following command:
```sh
pm2 startup
```
It will generate a command (similar to `sudo env PATH=...`). You need to copy and execute that generated command to complete the startup setup.

### 5. Configure the Firewall

To allow external users to access your application, you need to ensure that your server's firewall (e.g., ufw) allows access to port 3000.

```sh
ufw allow 3000/tcp
```

### 6. Access Your Application

Deployment is complete! You can now access your application from any browser at:

`http://<Your_Server_Public_IP>:3000/app.html`

Please replace `<Your_Server_Public_IP>` with the actual public IP address of your server.

---

### Alternative (without using pm2)

If you prefer not to install `pm2`, you can use the `nohup` command to run the service in the background. However, this method is simpler and does not provide automatic restarts on server reboot.

```sh
nohup node server.js &
```