import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { fork } from 'child_process'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import os from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

let mainWindow
let serverProcess

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js')
    },
    icon: join(rootDir, 'src/assets/pigeonlogo.jpg')
  })

  // Load the app
  const serverUIPath = join(__dirname, 'server-ui.html')
  console.log('Loading server management UI from:', serverUIPath)
  mainWindow.loadFile(serverUIPath).catch(err => {
    console.error('Failed to load server UI:', err)
  })
  // Log when page finishes loading
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('✅ Page loaded successfully')
  })

  // Log loading errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('❌ Failed to load:', errorCode, errorDescription)
  })

  // Open DevTools in development or if loading fails
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function startServer(config = {}) {
  return new Promise((resolve, reject) => {
    const serverPath = join(rootDir, 'node-server.js')
    
    const env = {
      ...process.env,
      NETWORK_NAME: config.networkName || 'pigeonfs',
      HTTP_PORT: config.httpPort || '0',
      ENABLE_CRYPTO: config.enableCrypto ? 'true' : 'false',
      DATA_DIR: config.dataDir || join(app.getPath('userData'), 'data')
    }

    serverProcess = fork(serverPath, [], {
      env,
      stdio: 'pipe'
    })

    let actualPort = null

    serverProcess.stdout.on('data', (data) => {
      const message = data.toString()
      console.log('[Server]', message)
      if (mainWindow) {
        mainWindow.webContents.send('server-log', message)
      }
      
      // Extract actual port from log message
      const portMatch = message.match(/HTTP server listening on http:\/\/localhost:(\d+)/)
      if (portMatch) {
        actualPort = portMatch[1]
        if (mainWindow) {
          mainWindow.webContents.send('server-started', {
            httpPort: actualPort,
            signalingUrl: config.signalingUrl
          })
        }
        resolve({ port: actualPort })
      }
    })

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString())
      if (mainWindow) {
        mainWindow.webContents.send('server-error', data.toString())
      }
    })

    serverProcess.on('error', (error) => {
      console.error('Failed to start server:', error)
      reject(error)
    })

    serverProcess.on('exit', (code) => {
      console.log(`Server exited with code ${code}`)
      if (mainWindow) {
        mainWindow.webContents.send('server-stopped', code)
      }
    })

    // Timeout if server doesn't start
    setTimeout(() => {
      resolve({ port: env.HTTP_PORT })
    }, 5000)
  })
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
}

// IPC Handlers
ipcMain.handle('start-server', async (event, config) => {
  try {
    const result = await startServer(config)
    return { success: true, ...result }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('stop-server', () => {
  stopServer()
  return { success: true }
})

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  })
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('upload-file', async (event, { fileName, fileBuffer }) => {
  try {
    // Get the data directory (same as server uses)
    const dataDir = join(os.homedir(), 'Library', 'Application Support', 'pigeonfs', 'data')
    const filesDir = join(dataDir, 'files')
    
    // Ensure directory exists
    await fsPromises.mkdir(filesDir, { recursive: true })
    
    // Write the file
    const filePath = join(filesDir, fileName)
    await fsPromises.writeFile(filePath, Buffer.from(fileBuffer))
    
    console.log(`✅ File written to: ${filePath}`)
    return { success: true, filePath }
  } catch (error) {
    console.error('Upload error:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-server-status', () => {
  return {
    running: serverProcess !== null,
    pid: serverProcess?.pid
  }
})

// App lifecycle
app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  stopServer()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopServer()
})
