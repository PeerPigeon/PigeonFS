const { contextBridge, ipcRenderer } = require('electron')

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Server controls
  startServer: (config) => ipcRenderer.invoke('start-server', config),
  stopServer: () => ipcRenderer.invoke('stop-server'),
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  
  // File operations
  uploadFile: (fileData) => ipcRenderer.invoke('upload-file', fileData),
  
  // File system
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  
  // Server logs
  onServerLog: (callback) => {
    ipcRenderer.on('server-log', (event, message) => callback(message))
  },
  onServerError: (callback) => {
    ipcRenderer.on('server-error', (event, message) => callback(message))
  },
  onServerStopped: (callback) => {
    ipcRenderer.on('server-stopped', (event, code) => callback(code))
  },
  onServerStarted: (callback) => {
    ipcRenderer.on('server-started', (event, config) => callback(config))
  }
})
