#!/usr/bin/env node
/**
 * PigeonFS Node.js Server
 * 
 * A persistent peer that hosts files and Book.js datasets on the mesh.
 * Acts as a long-running node to strengthen the network.
 */

import { PeerPigeonMesh } from 'peerpigeon'
import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import http from 'http'
import { WebSocket } from 'ws'

// Polyfill WebSocket for Node.js environment
if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = WebSocket
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load Book.js (UMD module that attaches to setTimeout.Book)
const bookCode = await fs.readFile(path.join(__dirname, 'book.js'), 'utf-8')
eval(bookCode)
const Book = setTimeout.Book

// Configuration
const CONFIG = {
  networkName: process.env.NETWORK_NAME || 'pigeonfs',
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  enableCrypto: process.env.ENABLE_CRYPTO !== 'false', // Default to true unless explicitly disabled
  httpPort: parseInt(process.env.HTTP_PORT || '3000'),
  storageQuota: parseInt(process.env.STORAGE_QUOTA || '10737418240'), // Default 10GB in bytes
  bootstrapNodes: [
    'wss://pigeonhub.fly.dev',
    'wss://pigeonhub-c.fly.dev'
  ],
  autoLoadDatasets: true,
  enableFileServing: true
}

class PigeonFSNode {
  constructor(config) {
    this.config = config
    this.storageUsed = 0 // Track current storage usage
    this.config = config
    this.pigeon = null
    this.datasets = new Map() // datasetId -> { book, index, data }
    this.files = new Map() // fileId -> buffer
    this.filesIndex = null // Book.js index for file search
    this.httpServer = null
  }

  async initialize() {
    console.log('🚀 Starting PigeonFS Node.js Server...')
    console.log(`📁 Data directory: ${this.config.dataDir}`)
    console.log(`🔒 Encryption: ${this.config.enableCrypto ? 'ENABLED' : 'DISABLED'}`)
    console.log(`🌐 HTTP upload server: http://localhost:${this.config.httpPort}`)
    
    // Ensure data directory exists
    await fs.mkdir(this.config.dataDir, { recursive: true })
    
    // Initialize PeerPigeon
    console.log(`🌐 Connecting to network: ${this.config.networkName}`)
    this.pigeon = new PeerPigeonMesh({
      networkName: this.config.networkName,
      enableWebDHT: false,
      enableCrypto: this.config.enableCrypto,
      enableDistributedStorage: false,
      maxPeers: 50,
      minPeers: 0,
      autoConnect: true,
      autoDiscovery: true,
      usePigeonNS: true,
      resolveMDNS: true
    })

    await this.pigeon.init()
    
    // Connect to bootstrap nodes (non-blocking)
    let connected = false
    for (const node of this.config.bootstrapNodes) {
      try {
        console.log(`🔗 Connecting to: ${node}`)
        await this.pigeon.connect(node)
        connected = true
        break // Successfully connected
      } catch (error) {
        console.warn(`⚠️  Failed to connect to ${node}:`, error.message)
      }
    }

    // Wait for connection with timeout
    if (connected) {
      await Promise.race([
        new Promise((resolve) => {
          const checkConnection = () => {
            if (this.pigeon.connectionManager?.peers?.size > 0) {
              resolve()
            } else {
              setTimeout(checkConnection, 500)
            }
          }
          checkConnection()
        }),
        new Promise((resolve) => setTimeout(resolve, 5000)) // 5 second timeout
      ])
    }

    if (this.pigeon.connectionManager?.peers?.size > 0) {
      console.log(`✅ Connected with peer ID: ${this.pigeon.peerId}`)
      console.log(`👥 Connected to ${this.pigeon.connectionManager.peers.size} peers`)
    } else {
      console.log(`⚠️  Starting in standalone mode (no peers connected)`)
      console.log(`   Peer ID: ${this.pigeon.peerId}`)
    }

    // Setup message handlers
    this.setupMessageHandlers()

    // Load datasets if enabled
    if (this.config.autoLoadDatasets) {
      await this.loadDatasets()
    }

    // Load hosted files
    if (this.config.enableFileServing) {
      await this.loadFiles()
      this.watchFilesDirectory()
    }

    // Start HTTP upload server
    await this.startHttpServer()

    // Announce availability
    this.announceAvailability()
    
    // Periodic status updates
    setInterval(() => this.logStatus(), 60000) // Every minute
  }

  setupMessageHandlers() {
    this.pigeon.on('messageReceived', async ({ from, content }) => {
      try {
        if (typeof content === 'string') {
          content = JSON.parse(content)
        }

        if (content.type === 'dataset-search-request') {
          await this.handleSearchRequest(content, from)
        } else if (content.type === 'file-search-request') {
          await this.handleFileSearchRequest(content, from)
        } else if (content.type === 'dataset-availability-request') {
          await this.handleAvailabilityRequest(from)
        } else if (content.type === 'file-list-request') {
          await this.handleFileListRequest(from)
        } else if (content.type === 'file-chunk-request') {
          await this.handleFileChunkRequest(from, content)
        } else if (content.type === 'file-chunk-upload') {
          await this.handleFileChunkUpload(from, content)
        } else if (content.type === 'file-start') {
          // Ignore incoming file transfers - we're a server
          console.log(`📥 Ignoring file transfer from ${from.substring(0, 8)}`)
        }
      } catch (error) {
        console.error('Error handling message:', error)
      }
    })
  }

  async handleSearchRequest(request, fromPeerId) {
    const { query, dataset, requestId } = request
    const datasetId = dataset || 'bible-kjv'
    
    const ds = this.datasets.get(datasetId)
    if (!ds) {
      console.log(`📖 Search request for ${datasetId} - not loaded`)
      return
    }

    console.log(`🔍 Search request: "${query}" in ${datasetId} from ${fromPeerId.substring(0, 8)}`)
    
    // Try exact/prefix match first
    let results = Book.searchIndex(ds.index, query, { maxResults: 50 })
    
    // If no results or few results and query looks like it might be a partial/multi-word search
    if (results.length < 5 && query.length >= 3) {
      const searchQuery = query.toLowerCase().trim()
      const matchingKeys = Object.keys(ds.index).filter(key => 
        key.includes(searchQuery) // Substring match
      )
      
      if (matchingKeys.length > 0) {
        console.log(`🔍 Found ${matchingKeys.length} substring matches, expanding search...`)
        // Get results from all matching keys with scoring
        const seen = new Set()
        const expandedResults = []
        for (const key of matchingKeys) {
          const items = ds.index[key] || []
          for (const item of items) {
            if (!seen.has(item.key) && expandedResults.length < 50) {
              seen.add(item.key)
              // Calculate relevance score
              const matchIndex = key.indexOf(searchQuery)
              const score = matchIndex === 0 ? 1.0 : 
                          matchIndex === key.length - searchQuery.length ? 0.8 : 
                          0.6
              expandedResults.push({
                ...item,
                score: score
              })
            }
          }
        }
        // Sort by score and take top results
        expandedResults.sort((a, b) => (b.score || 0) - (a.score || 0))
        results = expandedResults.slice(0, 20) // Return top 20
        console.log(`🔍 Expanded search found ${results.length} results`)
      }
    }
    
    if (results.length > 0) {
      const response = {
        type: 'dataset-search-response',
        requestId,
        dataset: datasetId,
        results,
        query
      }
      
      await this.pigeon.gossipManager.broadcastMessage(JSON.stringify(response), 'chat')
      console.log(`📤 Sent ${results.length} results for "${query}"`)
    }
  }

  async handleFileSearchRequest(request, fromPeerId) {
    const { query, requestId } = request
    
    if (!this.filesIndex || this.files.size === 0) {
      console.log(`🔍 File search request but no files hosted`)
      return
    }

    console.log(`🔍 File search request: "${query}" from ${fromPeerId.substring(0, 8)}`)
    console.log(`🔍 Index has ${Object.keys(this.filesIndex).length} words`)
    console.log(`🔍 Searching for: ${query.toLowerCase()}`)
    
    // Search the Book.js index
    const results = Book.searchIndex(this.filesIndex, query, { maxResults: 20 })
    
    console.log(`🔍 Found ${results.length} matching files for "${query}"`)
    console.log(`🔍 Results:`, results)
    
    if (results.length > 0) {
      const response = {
        type: 'file-search-response',
        requestId,
        results: results.map(r => {
          // Parse the JSON value back to file object
          try {
            const file = JSON.parse(r.value)
            return {
              id: file.id,
              name: file.name,
              size: file.size,
              type: file.type,
              score: r.score
            }
          } catch (e) {
            // Fallback if parsing fails
            return {
              id: r.key,
              name: r.key,
              size: 0,
              type: 'unknown',
              score: r.score
            }
          }
        }),
        query,
        peerId: this.pigeon.peerId
      }
      
      await this.pigeon.gossipManager.broadcastMessage(JSON.stringify(response), 'chat')
      console.log(`📤 Broadcasted ${results.length} file results for "${query}"`)
    } else {
      console.log(`🔍 No matching files found for "${query}"`)
    }
  }

  async handleAvailabilityRequest(fromPeerId) {
    const availability = {
      type: 'dataset-availability-response',
      datasets: Array.from(this.datasets.keys()).map(id => {
        const ds = this.datasets.get(id)
        return {
          id,
          itemCount: ds.data.length,
          indexSize: Object.keys(ds.index).length
        }
      }),
      files: Array.from(this.files.keys()).map(fileId => {
        const file = this.files.get(fileId)
        return {
          id: fileId,
          name: file.name,
          size: file.size,
          type: file.type
        }
      })
    }
    
    await this.pigeon.sendDirectMessage(fromPeerId, availability)
  }

  async handleFileListRequest(fromPeerId) {
    const fileList = {
      type: 'file-list-response',
      files: Array.from(this.files.keys()).map(fileId => {
        const file = this.files.get(fileId)
        return {
          id: fileId,
          name: file.name,
          size: file.size,
          type: file.type
        }
      })
    }
    
    await this.pigeon.sendDirectMessage(fromPeerId, fileList)
    console.log(`📤 Sent file list (${this.files.size} files) to ${fromPeerId.substring(0, 8)}`)
  }

  async handleFileChunkRequest(fromPeerId, content) {
    const { fileId, chunkIndex } = content
    const file = this.files.get(fileId)
    
    if (!file) {
      console.log(`❌ File not found: ${fileId}`)
      return
    }
    
    const chunkSize = 64 * 1024 // 64KB chunks
    const start = chunkIndex * chunkSize
    const end = Math.min(start + chunkSize, file.buffer.length)
    const chunk = file.buffer.slice(start, end)
    
    const response = {
      type: 'file-chunk',
      fileId,
      chunkIndex,
      chunk: Array.from(chunk),
      isLastChunk: end >= file.buffer.length
    }
    
    await this.pigeon.sendDirectMessage(fromPeerId, response)
    
    const progress = ((end / file.buffer.length) * 100).toFixed(1)
    console.log(`📤 Sent chunk ${chunkIndex} of ${file.name} to ${fromPeerId.substring(0, 8)} (${progress}%)`)
  }

  async handleFileChunkUpload(fromPeerId, content) {
    const { fileId, fileName, fileSize, fileType, chunkIndex, chunk, isLastChunk, totalChunks } = content
    
    // Initialize upload tracking if this is the first chunk
    if (!this.uploadingFiles) {
      this.uploadingFiles = new Map()
    }
    
    if (chunkIndex === 0) {
      console.log(`📥 Starting upload: ${fileName} (${this.formatSize(fileSize)}) from ${fromPeerId.substring(0, 8)}`)
      this.uploadingFiles.set(fileId, {
        fileName,
        fileSize,
        fileType,
        chunks: [],
        receivedChunks: 0,
        totalChunks
      })
    }
    
    const upload = this.uploadingFiles.get(fileId)
    if (!upload) {
      console.log(`❌ Upload not initialized for file: ${fileId}`)
      return
    }
    
    // Store chunk
    upload.chunks[chunkIndex] = Buffer.from(chunk)
    upload.receivedChunks++
    
    const progress = ((upload.receivedChunks / totalChunks) * 100).toFixed(1)
    console.log(`📥 Received chunk ${chunkIndex + 1}/${totalChunks} of ${fileName} (${progress}%)`)
    
    // If all chunks received, assemble the file
    if (isLastChunk || upload.receivedChunks === totalChunks) {
      const buffer = Buffer.concat(upload.chunks)
      const actualFileId = await this.addFile(fileName, buffer)
      
      console.log(`✅ Upload complete: ${fileName} (${this.formatSize(buffer.length)})`)
      
      // Send confirmation
      await this.pigeon.sendDirectMessage(fromPeerId, {
        type: 'upload-complete',
        fileId: actualFileId,
        fileName,
        success: true
      })
      
      // Clean up
      this.uploadingFiles.delete(fileId)
    }
  }

  async loadFiles() {
    console.log('📁 Loading hosted files...')
    
    const filesDir = path.join(this.config.dataDir, 'files')
    await fs.mkdir(filesDir, { recursive: true })
    
    this.storageUsed = 0 // Reset storage counter
    
    try {
      const files = await fs.readdir(filesDir)
      
      for (const filename of files) {
        const filePath = path.join(filesDir, filename)
        const stats = await fs.stat(filePath)
        
        if (stats.isFile()) {
          const buffer = await fs.readFile(filePath)
          const fileId = this.generateFileId(filename)
          
          this.files.set(fileId, {
            id: fileId,
            name: filename,
            size: stats.size,
            type: this.getMimeType(filename),
            buffer: buffer
          })
          
          this.storageUsed += stats.size
          
          console.log(`📄 Loaded file: ${filename} (${this.formatSize(stats.size)})`)
        }
      }
      
      if (this.files.size > 0) {
        const quotaGB = (this.config.storageQuota / (1024 * 1024 * 1024)).toFixed(2)
        const usedGB = (this.storageUsed / (1024 * 1024 * 1024)).toFixed(2)
        console.log(`✅ Loaded ${this.files.size} files (${usedGB}GB / ${quotaGB}GB quota)`)
        this.rebuildFilesIndex()
      }
    } catch (error) {
      console.error('Error loading files:', error)
    }
  }

  watchFilesDirectory() {
    const filesDir = path.join(this.config.dataDir, 'files')
    
    console.log('👁️  Watching files directory for changes...')
    
    // Use fs.watch to monitor the directory
    fsSync.watch(filesDir, async (eventType, filename) => {
      if (!filename) return
      
      console.log(`📂 File change detected: ${eventType} - ${filename}`)
      
      // Debounce: wait a bit before reloading
      if (this.reloadTimeout) {
        clearTimeout(this.reloadTimeout)
      }
      
      this.reloadTimeout = setTimeout(async () => {
        console.log('🔄 Reloading files...')
        this.files.clear()
        await this.loadFiles()
        this.announceAvailability()
      }, 500)
    })
  }

  rebuildFilesIndex() {
    // Create Book.js from file metadata
    const book = Book()
    
    // Add each file to the book using filename as key (for searching)
    Array.from(this.files.values()).forEach(file => {
      const fileMetadata = JSON.stringify({
        id: file.id,
        name: file.name,
        size: file.size,
        type: file.type
      })
      
      // Get the base filename without extension
      const nameWithoutExt = file.name.replace(/\.[^.]+$/, '')
      
      // Split camelCase/PascalCase and separators
      const searchableFilename = nameWithoutExt
        .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> camel Case
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2') // ABCDef -> ABC Def
        .replace(/[._-]/g, ' ') // Replace separators with spaces
        .toLowerCase()
      
      // Get file extension separately
      const ext = path.extname(file.name).toLowerCase().replace('.', '')
      
      // Split into individual words
      const words = searchableFilename.split(/\s+/).filter(w => w.length > 0)
      
      // Index each word individually for partial matching
      words.forEach(word => {
        book(word, fileMetadata)
      })
      
      // Also index the file extension
      if (ext) {
        book(ext, fileMetadata)
      }
      
      // Index the full searchable name for exact matches
      book(searchableFilename, fileMetadata)
      
      // For words without spaces (like "pigeonlogo"), also index all substrings >= 3 chars
      // This allows "pigeon" to find "pigeonlogo"
      words.forEach(word => {
        if (word.length > 6) { // Only for longer words to avoid too many matches
          for (let i = 0; i <= word.length - 3; i++) {
            for (let len = 3; len <= word.length - i; len++) {
              const substring = word.substring(i, i + len)
              book(substring, fileMetadata)
            }
          }
        }
      })
    })
    
    // Create searchable index
    this.filesIndex = Book.index(book)
    
    console.log(`🔍 Created searchable index for ${this.files.size} files`)
    console.log(`🔍 Sample index keys:`, Object.keys(this.filesIndex).slice(0, 30).join(', '))
  }

  generateFileId(filename) {
    return `${Date.now()}_${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`
  }

  getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase()
    const types = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mp3': 'audio/mpeg',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.json': 'application/json',
      '.zip': 'application/zip'
    }
    return types[ext] || 'application/octet-stream'
  }

  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }

  async startHttpServer() {
    const maxAttempts = 10
    let currentPort = this.config.httpPort || 3000
    let attempts = 0

    while (attempts < maxAttempts) {
      try {
        const actualPort = await this.tryStartServer(currentPort)
        this.config.httpPort = actualPort
        console.log(`🌐 HTTP server listening on http://localhost:${actualPort}`)
        console.log(`📤 Upload files at: http://localhost:${actualPort}`)
        return
      } catch (error) {
        if (error.code === 'EADDRINUSE') {
          attempts++
          console.log(`⚠️  Port ${currentPort} in use, trying ${currentPort + 1}...`)
          currentPort++
        } else {
          throw error
        }
      }
    }

    throw new Error(`Failed to find available port after ${maxAttempts} attempts`)
  }

  async tryStartServer(port) {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(async (req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

        if (req.method === 'OPTIONS') {
          res.writeHead(200)
          res.end()
          return
        }

        // List files endpoint (read-only)
        if (req.method === 'GET' && req.url === '/files') {
          const fileList = Array.from(this.files.values()).map(f => ({
            id: f.id,
            name: f.name,
            size: f.size,
            type: f.type
          }))
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(fileList))
          return
        }

        // Status/info page
        if (req.method === 'GET' && req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(this.getInfoPageHtml())
          return
        }

        res.writeHead(404)
        res.end('Not Found')
      })

      this.httpServer.listen(port, () => {
        const actualPort = this.httpServer.address().port
        resolve(actualPort)
      })

      this.httpServer.on('error', (error) => {
        if (this.httpServer) {
          this.httpServer.close()
        }
        reject(error)
      })
    })
  }

  async addFile(filename, buffer) {
    const fileId = this.generateFileId(filename)
    const filesDir = path.join(this.config.dataDir, 'files')
    const filePath = path.join(filesDir, filename)
    
    // Check storage quota
    if (this.storageUsed + buffer.length > this.config.storageQuota) {
      const quotaGB = (this.config.storageQuota / (1024 * 1024 * 1024)).toFixed(2)
      const usedGB = (this.storageUsed / (1024 * 1024 * 1024)).toFixed(2)
      const fileGB = (buffer.length / (1024 * 1024 * 1024)).toFixed(2)
      throw new Error(`Storage quota exceeded! Used: ${usedGB}GB / ${quotaGB}GB. File size: ${fileGB}GB`)
    }
    
    // Save to disk
    await fs.writeFile(filePath, buffer)
    
    // Add to in-memory map
    this.files.set(fileId, {
      id: fileId,
      name: filename,
      size: buffer.length,
      type: this.getMimeType(filename),
      buffer: buffer
    })
    
    this.storageUsed += buffer.length
    
    const usedGB = (this.storageUsed / (1024 * 1024 * 1024)).toFixed(2)
    const quotaGB = (this.config.storageQuota / (1024 * 1024 * 1024)).toFixed(2)
    console.log(`✅ Added file: ${filename} (${this.formatSize(buffer.length)}) - Storage: ${usedGB}GB / ${quotaGB}GB`)
    
    // Rebuild index and announce - reset backoff since we have new content
    this.rebuildFilesIndex()
    this.announceInterval = 5000 // Reset to 5 seconds for quick re-announcement
    this.announceAvailability()
    
    return fileId
  }

  getInfoPageHtml() {
    return `<!DOCTYPE html>
<html>
<head>
  <title>PigeonFS Node</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .info-box { border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0; background: #f9f9f9; }
    .status { color: #4CAF50; font-weight: bold; }
    .file-list { margin-top: 20px; }
    .file-item { padding: 10px; margin: 5px 0; background: #f5f5f5; border-radius: 4px; display: flex; justify-content: space-between; }
    code { background: #e8e8e8; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>🐦 PigeonFS Node</h1>
  
  <div class="info-box">
    <p class="status">✅ Node is running</p>
    <p><strong>Peer ID:</strong> <code>${this.pigeon?.peerId || 'Connecting...'}</code></p>
    <p><strong>Files Hosted:</strong> ${this.files.size}</p>
    <p><strong>Datasets:</strong> ${this.datasets.size}</p>
  </div>

  <div class="info-box">
    <h3>📡 P2P Network Operations</h3>
    <p>This node uses <strong>PeerPigeon</strong> for all file transfers:</p>
    <ul>
      <li><strong>Upload:</strong> Send file chunks via P2P direct messages</li>
      <li><strong>Download:</strong> Request and receive file chunks via P2P</li>
      <li><strong>Search:</strong> Discover files across the network using gossip protocol</li>
    </ul>
    <p>Use the <strong>Electron GUI</strong> or <strong>Browser Interface</strong> to manage files.</p>
  </div>
  
  <div class="file-list">
    <h3>Currently Hosted Files</h3>
    <div id="fileList">Loading...</div>
  </div>

  <script>
    async function loadFileList() {
      try {
        const response = await fetch('/files')
        const files = await response.json()
        
        const listHtml = files.map(f => 
          \`<div class="file-item">
            <span>\${f.name}</span>
            <span>\${formatSize(f.size)}</span>
          </div>\`
        ).join('')
        
        document.getElementById('fileList').innerHTML = listHtml || '<p>No files hosted yet</p>'
      } catch (error) {
        document.getElementById('fileList').innerHTML = '<p>Error loading files</p>'
      }
    }
    
    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
    }
    
    loadFileList()
    setInterval(loadFileList, 5000) // Refresh every 5 seconds
  </script>
</body>
</html>`
  }

  async loadDatasets() {
    console.log('📚 Loading datasets...')
    
    const datasetsDir = path.join(this.config.dataDir, 'datasets')
    await fs.mkdir(datasetsDir, { recursive: true })
    
    try {
      const files = await fs.readdir(datasetsDir)
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const datasetId = file.replace('.json', '')
          await this.loadDataset(datasetId, path.join(datasetsDir, file))
        }
      }
    } catch (error) {
      console.error('Error loading datasets:', error)
    }
    
    // Load default Bible dataset if no datasets loaded
    if (this.datasets.size === 0) {
      console.log('📖 No datasets found, loading default Bible dataset...')
      await this.loadBibleDataset()
    }
  }

  async loadDataset(datasetId, filePath) {
    try {
      console.log(`📂 Loading dataset: ${datasetId}`)
      
      const fileContent = await fs.readFile(filePath, 'utf8')
      const data = JSON.parse(fileContent)
      
      // Create Book.js instance (Book is a function, not a constructor)
      const book = Book()
      data.forEach(entry => {
        book.set(entry.key, entry.value)
      })
      
      // Build index
      const index = Book.index(book)
      
      this.datasets.set(datasetId, {
        book,
        index,
        data,
        itemCount: data.length,
        indexSize: Object.keys(index).length
      })
      
      console.log(`✅ Loaded ${datasetId}: ${data.length} items, ${Object.keys(index).length} index entries`)
    } catch (error) {
      console.error(`Failed to load dataset ${datasetId}:`, error)
    }
  }

  async loadBibleDataset() {
    try {
      const response = await fetch('https://raw.githubusercontent.com/thiagobodruk/bible/refs/heads/master/json/en_kjv.json')
      const bibleData = await response.json()
      
      // Convert to Book.js format
      const entries = []
      bibleData.forEach(book => {
        const bookName = book.name
        book.chapters.forEach((chapter, chapterIndex) => {
          chapter.forEach((verse, verseIndex) => {
            const key = `${bookName} ${chapterIndex + 1}:${verseIndex + 1}`
            entries.push({ key, value: verse })
          })
        })
      })
      
      // Save to disk
      const datasetsDir = path.join(this.config.dataDir, 'datasets')
      await fs.mkdir(datasetsDir, { recursive: true })
      await fs.writeFile(
        path.join(datasetsDir, 'bible-kjv.json'),
        JSON.stringify(entries, null, 2)
      )
      
      // Load into memory
      await this.loadDataset('bible-kjv', path.join(datasetsDir, 'bible-kjv.json'))
    } catch (error) {
      console.error('Failed to load Bible dataset:', error)
    }
  }

  announceAvailability() {
    const message = {
      type: 'node-announcement',
      nodeType: 'pigeonfs-server',
      datasets: Array.from(this.datasets.keys()),
      files: Array.from(this.files.keys()).map(fileId => {
        const file = this.files.get(fileId)
        return {
          id: fileId,
          name: file.name,
          size: file.size,
          type: file.type
        }
      }),
      timestamp: Date.now()
    }
    
    this.pigeon.gossipManager.broadcastMessage(JSON.stringify(message), 'chat')
    console.log(`📡 Announced availability to network (${this.datasets.size} datasets, ${this.files.size} files)`)
    
    // Exponential backoff: Start at 5s, double each time up to max 5 minutes
    if (!this.announceInterval) {
      this.announceInterval = 5000 // Start at 5 seconds
    }
    
    const nextInterval = Math.min(this.announceInterval * 2, 5 * 60 * 1000) // Cap at 5 minutes
    this.announceInterval = nextInterval
    
    console.log(`📡 Next announcement in ${Math.round(nextInterval / 1000)}s`)
    setTimeout(() => this.announceAvailability(), nextInterval)
  }

  logStatus() {
    console.log('\n📊 Status Update:')
    console.log(`   Peer ID: ${this.pigeon.peerId}`)
    console.log(`   Connected Peers: ${this.pigeon.connectionManager.peers.size}`)
    console.log(`   Loaded Datasets: ${this.datasets.size}`)
    this.datasets.forEach((ds, id) => {
      console.log(`     - ${id}: ${ds.itemCount} items`)
    })
    console.log(`   Hosted Files: ${this.files.size}`)
    console.log('')
  }

  async shutdown() {
    console.log('🛑 Shutting down PigeonFS Node...')
    if (this.pigeon) {
      await this.pigeon.disconnect()
    }
    process.exit(0)
  }
}

// Main execution
async function main() {
  const node = new PigeonFSNode(CONFIG)
  
  // Graceful shutdown
  process.on('SIGINT', () => node.shutdown())
  process.on('SIGTERM', () => node.shutdown())
  
  try {
    await node.initialize()
    console.log('✅ PigeonFS Node is running!')
    console.log('Press Ctrl+C to stop')
  } catch (error) {
    console.error('❌ Failed to start:', error)
    process.exit(1)
  }
}

main()
