const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow = null;
let pythonProcess = null;
const DEFAULT_PORT = 5002;

function checkServerReady(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/projects`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function resolveAppPy() {
  const candidates = [
    path.join(process.resourcesPath, 'app.py'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'app.py'),
    path.join(__dirname, '..', 'app.py'),
    path.join(app.getAppPath(), 'app.py')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return path.join(__dirname, '..', 'app.py');
}

async function startPythonBackend(port) {
  const isAlreadyRunning = await checkServerReady(port);
  if (isAlreadyRunning) {
    console.log(`[DocGraph] Python backend already active on port ${port}`);
    return;
  }

  const appPyPath = resolveAppPy();
  const workingDir = path.dirname(appPyPath);
  console.log(`[DocGraph] Launching Python backend: ${appPyPath} (cwd: ${workingDir})`);

  const pyCmd = process.platform === 'win32' ? 'python' : 'python3';

  try {
    pythonProcess = spawn(pyCmd, [appPyPath, '-p', port.toString(), '-H', '127.0.0.1'], {
      cwd: workingDir,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    });

    pythonProcess.on('error', (err) => {
      console.error('[DocGraph] Failed to spawn Python daemon:', err);
    });
  } catch (err) {
    console.error('[DocGraph] Spawn exception:', err);
  }

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (await checkServerReady(port)) {
      console.log('[DocGraph] Python backend ready!');
      return;
    }
  }
}

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    title: 'DocGraph - Markdown AST & Intelligence Suite',
    backgroundColor: '#090d13',
    darkTheme: true,
    show: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Manage Documentation Repositories...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.executeJavaScript('openPathModal()')
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit DocGraph' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Refresh View', accelerator: 'CmdOrCtrl+R' },
        { role: 'forceReload', label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R' },
        { type: 'separator' },
        {
          label: 'Toggle Section Slice Mode',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.executeJavaScript('toggleSliceMode()')
        },
        {
          label: 'Toggle Explorer Panel',
          accelerator: 'CmdOrCtrl+B',
          click: () => mainWindow.webContents.executeJavaScript('toggleTreePanel()')
        },
        {
          label: 'Toggle Intelligence Drawer',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow.webContents.executeJavaScript('toggleDrawer()')
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toggle Full Screen' },
        { role: 'toggleDevTools', label: 'Developer Tools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'GitHub Repository',
          click: () => shell.openExternal('https://github.com/dardeaw/docgraph')
        },
        {
          label: 'About DocGraph',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About DocGraph',
              message: 'DocGraph Intelligence Suite',
              detail: 'Surgical precision Markdown AST, TOC outline & section slicer for AI Agents & Developers.\nSave up to 97% tokens.'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Documentation Directory to Scan'
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

app.whenReady().then(async () => {
  const targetPort = process.env.PORT ? parseInt(process.env.PORT) : DEFAULT_PORT;
  await startPythonBackend(targetPort);
  createMainWindow(targetPort);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(targetPort);
    }
  });
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    try {
      pythonProcess.kill();
    } catch (e) {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
