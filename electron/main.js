const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;
let serverProcess;

// Get the correct data directory based on environment
function getDataDirectory() {
  // In production, use app's userData directory
  // In development, use a local data directory
  if (process.env.NODE_ENV === 'development') {
    return path.join(__dirname, '..', 'data');
  }
  return path.join(app.getPath('userData'), 'data');
}

// Ensure data directory exists
function ensureDataDirectory() {
  const dataDir = getDataDirectory();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

// Start the Express server
function startServer() {
  const dataDir = ensureDataDirectory();
  const serverPath = path.join(__dirname, '..', 'server', 'index.js');

  // Set environment variables for the server
  const env = {
    ...process.env,
    PORT: '3001',
    DATA_DIR: dataDir,
    NODE_ENV: process.env.NODE_ENV || 'production'
  };

  // In production, we need to set Playwright's browser path
  if (process.env.NODE_ENV !== 'development') {
    const browserPath = path.join(process.resourcesPath, 'playwright-browsers');
    env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  }

  console.log('Starting server with data directory:', dataDir);

  serverProcess = spawn('node', [serverPath], { env });

  serverProcess.stdout.on('data', (data) => {
    console.log(`Server: ${data.toString().trim()}`);
  });

  serverProcess.stderr.on('data', (data) => {
    console.error(`Server Error: ${data.toString().trim()}`);
  });

  serverProcess.on('error', (error) => {
    console.error('Failed to start server:', error);
  });

  serverProcess.on('exit', (code, signal) => {
    console.log(`Server process exited with code ${code} and signal ${signal}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: 'STR Pricing Updater',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false
    },
    show: false // Don't show until ready
  });

  // Show window when ready to avoid flickering
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // In development, load from Vite dev server
  // In production, load from built files
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html');
    console.log('Loading index.html from:', indexPath);
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Wait for server to be ready before creating window
function waitForServer(callback, retries = 30) {
  const http = require('http');

  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/health',
    method: 'GET',
    timeout: 1000
  };

  const req = http.request(options, (res) => {
    if (res.statusCode === 200) {
      console.log('Server is ready');
      callback();
    } else if (retries > 0) {
      setTimeout(() => waitForServer(callback, retries - 1), 1000);
    } else {
      console.error('Server failed to start after 30 seconds');
      callback(); // Create window anyway
    }
  });

  req.on('error', () => {
    if (retries > 0) {
      setTimeout(() => waitForServer(callback, retries - 1), 1000);
    } else {
      console.error('Server failed to start after 30 seconds');
      callback(); // Create window anyway
    }
  });

  req.on('timeout', () => {
    req.destroy();
    if (retries > 0) {
      setTimeout(() => waitForServer(callback, retries - 1), 1000);
    } else {
      console.error('Server failed to start after 30 seconds');
      callback(); // Create window anyway
    }
  });

  req.end();
}

app.whenReady().then(() => {
  console.log('Electron app ready');
  console.log('App path:', app.getAppPath());
  console.log('User data:', app.getPath('userData'));

  startServer();

  // Wait for server to be ready before creating window
  waitForServer(createWindow);
});

app.on('window-all-closed', () => {
  // Kill server process
  if (serverProcess) {
    console.log('Killing server process');
    serverProcess.kill();
  }

  // On macOS, keep app active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Cleanup on quit
app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

// Handle crashes gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});
