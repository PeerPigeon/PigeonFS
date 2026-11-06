/**
 * ChunkStorage - Handles file chunking and distributed storage
 * Different strategies for browser peers vs node/app peers
 * 
 * Browser peers: Store only chunks based on peer ID and chunk ID proximity (DHT-based)
 * Node/App peers: Check available quota, use 10% for chunks and whole files if they fit
 * All: Index by filename hash for efficient lookup
 */

export class ChunkStorage {
  constructor(storage, options = {}) {
    this.storage = storage
    this.peerId = storage.peerId
    this.dht = storage.dht
    
    // Platform detection
    this.isBrowser = typeof window !== 'undefined' && typeof process === 'undefined'
    this.isNode = typeof process !== 'undefined' && process.versions && process.versions.node
    
    // Configuration
    this.chunkSize = options.chunkSize || 64 * 1024 // 64KB default
    this.maxChunkAge = options.maxChunkAge || 7 * 24 * 60 * 60 * 1000 // 7 days
    
    // Storage limits
    this.storageQuota = options.storageQuota || this.getDefaultQuota()
    this.chunkStoragePercent = 0.1 // Use 10% of available quota for chunks/files
    
    // Chunk organization
    this.chunks = new Map() // chunkId -> chunk data
    this.fileChunks = new Map() // fileHash -> Set of chunkIds
    this.chunkMetadata = new Map() // chunkId -> metadata
    this.wholeFiles = new Map() // fileHash -> file data
    this.filenameHashIndex = new Map() // filenameHash -> fileHash
    
    // Chunk responsibility (DHT-based)
    this.responsibleChunks = new Set() // Chunks we're responsible for
    
    // Statistics
    this.stats = {
      totalChunks: 0,
      totalFiles: 0,
      storageUsed: 0,
      lastCleanup: Date.now()
    }
    
    console.log(`ChunkStorage initialized: ${this.isBrowser ? 'Browser' : 'Node'} mode, quota: ${this.formatSize(this.storageQuota)}`)
  }
  
  // ===== QUOTA MANAGEMENT =====
  
  getDefaultQuota() {
    if (this.isBrowser) {
      // Browser: Check navigator.storage API
      return 50 * 1024 * 1024 // Default 50MB for browsers
    } else {
      // Node: Larger default quota
      return 10 * 1024 * 1024 * 1024 // 10GB for node
    }
  }
  
  async getAvailableQuota() {
    if (this.isBrowser && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate()
        return estimate.quota - estimate.usage
      } catch (error) {
        console.error('Failed to get storage estimate:', error)
      }
    }
    
    // Fallback: use configured quota minus current usage
    return this.storageQuota - this.stats.storageUsed
  }
  
  async getAvailableChunkStorage() {
    const available = await this.getAvailableQuota()
    return Math.floor(available * this.chunkStoragePercent)
  }
  
  // ===== FILENAME/HASH HELPERS =====
  normalizeFilename(filename) {
    return String(filename || '').toLowerCase().trim()
  }
  
  // Keep legacy helper (may still be used in logs), but prefer normalizeFilename for keys
  
  hashFilename(filename) {
    // Create a consistent hash for filename
    let hash = 0
    const normalized = this.normalizeFilename(filename)
    
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    
    return Math.abs(hash)
  }
  
  async generateFileHash(fileBytes) {
    // Content-addressed file hash (SHA-256 hex) for dedup/swarm across nodes
    const bytes = fileBytes instanceof Uint8Array ? fileBytes : new Uint8Array(fileBytes)
    // Prefer Web Crypto API when available
    if (globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.subtle.digest) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
    }
    // Node.js fallback
    if (this.isNode) {
      const { createHash } = await import('crypto')
      return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
    }
    // Fallback to DHT hash of stringified bytes (less ideal, but ensures determinism)
    return String(await this.dht.hash(Array.from(bytes).join(',')))
  }
  
  async generateChunkId(fileHash, chunkIndex) {
    // Deterministic chunk key so identical files co-seed across nodes
    return `${fileHash}:${chunkIndex}`
  }
  
  // ===== CHUNK RESPONSIBILITY (DHT-BASED) =====
  
  async shouldStoreChunk(chunkId) {
    if (!this.isBrowser) {
      // Node/app peers can store any chunks if they have space
      return true
    }
    
    // Browser peers: only store chunks they're responsible for based on DHT
    const responsiblePeers = await this.dht.findPeersForKey(chunkId, 3) // Top 3 closest peers
    return responsiblePeers.includes(this.peerId)
  }
  
  async getChunkProximity(chunkId) {
    // Calculate how close this chunk is to our peer ID
    const chunkHash = typeof chunkId === 'number' ? chunkId : await this.dht.hash(String(chunkId))
    const peerHash = await this.dht.hash(this.peerId)
    
    // XOR distance (lower is closer)
    return Math.abs(chunkHash - peerHash)
  }
  
  // ===== FILE CHUNKING =====
  
  async storeFile(filename, data, metadata = {}) {
    // Normalize and materialize data to bytes for hashing
    const buffer = await this.toBuffer(data)
    const fileSize = buffer.length
    const fileHash = await this.generateFileHash(buffer)
    const normalizedName = this.normalizeFilename(filename)
    
    // Index locally by normalized name
    this.filenameHashIndex.set(normalizedName, fileHash)
    
    const availableStorage = await this.getAvailableChunkStorage()
    
  if (this.isNode || !this.isBrowser) {
      // Node/App peers: Check if whole file fits in 10% quota
      if (fileSize <= availableStorage) {
        console.log(`💾 Storing whole file: ${filename} (${this.formatSize(fileSize)})`)
        const result = await this.storeWholeFile(fileHash, filename, buffer, metadata)
        // Update filename index in DHT (legacy) and as Book dataset
        const entry = { fileHash, size: fileSize, ts: Date.now(), filename }
        await this.upsertFilenameIndex(normalizedName, entry)
        await this.upsertBookFilenameDataset(filename, entry)
        return result
      }
    }
    
    // Store as chunks
    console.log(`🧩 Chunking file: ${filename} (${this.formatSize(fileSize)})`)
    const result = await this.storeAsChunks(fileHash, filename, buffer, metadata)
    // Update filename index in DHT (legacy) and as Book dataset
    const entry = { fileHash, size: fileSize, ts: Date.now(), filename }
    await this.upsertFilenameIndex(normalizedName, entry)
    await this.upsertBookFilenameDataset(filename, entry)
    return result
  }
  
  async storeWholeFile(fileHash, filename, data, metadata) {
    const fileSize = data.length || data.byteLength || data.size
    
    // Convert to buffer/array if needed
    let buffer
    if (data instanceof ArrayBuffer) {
      buffer = new Uint8Array(data)
    } else if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
      buffer = data
    } else {
      buffer = new Uint8Array(data)
    }
    
    this.wholeFiles.set(fileHash, {
      filename,
      data: buffer,
      size: fileSize,
      metadata,
      stored: Date.now(),
      accessed: Date.now(),
      type: 'whole'
    })
    
    this.stats.storageUsed += fileSize
    this.stats.totalFiles++
    
    // Also store/update metadata in DHT (merge providers)
    const key = `file:${fileHash}`
    let existingRaw = await this.storage.get(key)
    let existing = null
    try { existing = existingRaw ? JSON.parse(existingRaw) : null } catch {}
    const providers = new Set([...(existing?.providers || []), this.peerId])
    const metaOut = {
      fileHash,
      filename,
      size: fileSize,
      type: 'whole',
      chunkSize: this.chunkSize,
      totalChunks: 1,
      providers: Array.from(providers),
      timestamp: existing?.timestamp || Date.now()
    }
    await this.storage.set(key, JSON.stringify(metaOut))
    
    console.log(`✅ Stored whole file: ${filename} (${this.formatSize(fileSize)})`)
    
    return {
      fileHash,
      type: 'whole',
      size: fileSize,
      filename
    }
  }
  
  async storeAsChunks(fileHash, filename, data, metadata) {
    const fileSize = data.length || data.byteLength || data.size
    const totalChunks = Math.ceil(fileSize / this.chunkSize)
    
    // Convert to buffer/array if needed
    let buffer
    if (data instanceof ArrayBuffer) {
      buffer = new Uint8Array(data)
    } else if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
      buffer = data
    } else {
      buffer = new Uint8Array(data)
    }
    
    const chunkIds = []
    let storedChunks = 0
    
    for (let i = 0; i < totalChunks; i++) {
  const chunkId = await this.generateChunkId(fileHash, i)
      const start = i * this.chunkSize
      const end = Math.min(start + this.chunkSize, fileSize)
      const chunkData = buffer.slice(start, end)
      
      // Determine if we should store this chunk
  const shouldStore = await this.shouldStoreChunk(chunkId)
      
      if (shouldStore) {
  const proximity = await this.getChunkProximity(chunkId)
        
        this.chunks.set(chunkId, chunkData)
        this.chunkMetadata.set(chunkId, {
          fileHash,
          filename,
          chunkIndex: i,
          size: chunkData.length,
          stored: Date.now(),
          accessed: Date.now(),
          proximity
        })
        
        this.stats.storageUsed += chunkData.length
        storedChunks++
        this.responsibleChunks.add(chunkId)
      }
      
      chunkIds.push(chunkId)
    }
    
    // Track file chunks
    this.fileChunks.set(fileHash, new Set(chunkIds))
    this.stats.totalChunks += storedChunks
    
    // Store/update file metadata in DHT (merge providers)
    const key = `file:${fileHash}`
    let existingRaw = await this.storage.get(key)
    let existing = null
    try { existing = existingRaw ? JSON.parse(existingRaw) : null } catch {}
    const providers = new Set([...(existing?.providers || []), this.peerId])
    const metaOut = {
      fileHash,
      filename,
      size: fileSize,
      type: 'chunked',
      chunkSize: this.chunkSize,
      totalChunks,
      chunkIds,
      providers: Array.from(providers),
      timestamp: existing?.timestamp || Date.now()
    }
    await this.storage.set(key, JSON.stringify(metaOut))
    
    console.log(`✅ Stored ${storedChunks}/${totalChunks} chunks for ${filename}`)
    
    return {
      fileHash,
      type: 'chunked',
      totalChunks,
      storedChunks,
      chunkIds,
      filename
    }
  }
  
  // ===== CHUNK RETRIEVAL =====
  
  async getFile(filenameOrHash) {
    // Try as filename first
    let fileHash
    if (typeof filenameOrHash === 'string' && !filenameOrHash.includes(':')) {
      const normalized = this.normalizeFilename(filenameOrHash)
      fileHash = this.filenameHashIndex.get(normalized)
      if (!fileHash) {
        // Lookup in DHT filename index
        const fnameKey = `filename:${normalized}`
        const arrRaw = await this.storage.get(fnameKey)
        if (arrRaw) {
          try {
            const arr = JSON.parse(arrRaw)
            if (Array.isArray(arr) && arr.length > 0) {
              fileHash = arr[0].fileHash
            }
          } catch {}
        }
      }
    } else {
      fileHash = filenameOrHash
    }
    
    if (!fileHash) {
      // Try to find in DHT
      const dhtData = await this.storage.get(`file:${filenameOrHash}`)
      if (dhtData) {
        const metadata = JSON.parse(dhtData)
        fileHash = metadata.fileHash
      }
    }
    
    if (!fileHash) {
      console.log(`❌ File not found: ${filenameOrHash}`)
      return null
    }
    
    // Check if we have whole file
    if (this.wholeFiles.has(fileHash)) {
      const file = this.wholeFiles.get(fileHash)
      file.accessed = Date.now()
      return {
        data: file.data,
        metadata: file.metadata,
        type: 'whole'
      }
    }
    
    // Assemble from chunks
    return await this.assembleFromChunks(fileHash)
  }
  
  async getChunk(chunkId) {
    if (this.chunks.has(chunkId)) {
      const metadata = this.chunkMetadata.get(chunkId)
      if (metadata) {
        metadata.accessed = Date.now()
      }
      return this.chunks.get(chunkId)
    }
    
    // Try to fetch from responsible peer
  const responsiblePeers = await this.dht.findPeersForKey(chunkId, 3)
    for (const peerId of responsiblePeers) {
      if (peerId === this.peerId) continue
      
      try {
        const chunk = await this.storage.sync.requestChunkFromPeer(peerId, chunkId)
        if (chunk) {
          return chunk
        }
      } catch (error) {
        console.error(`Failed to get chunk from peer ${peerId}:`, error)
      }
    }
    
    return null
  }
  
  async assembleFromChunks(fileHash) {
    const chunkIds = this.fileChunks.get(fileHash)
    if (!chunkIds) {
      console.log(`❌ No chunks found for file: ${fileHash}`)
      return null
    }
    
    const chunks = []
    let totalSize = 0
    
    for (const chunkId of chunkIds) {
      const chunk = await this.getChunk(chunkId)
      if (!chunk) {
        console.log(`❌ Missing chunk: ${chunkId}`)
        return null
      }
      chunks.push(chunk)
      totalSize += chunk.length
    }
    
    // Concatenate chunks
    const assembled = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of chunks) {
      assembled.set(chunk, offset)
      offset += chunk.length
    }
    
    return {
      data: assembled,
      type: 'chunked',
      chunks: chunks.length
    }
  }
  
  // ===== CHUNK MANAGEMENT =====
  
  async storeChunk(chunkId, chunkData, metadata = {}) {
    if (!this.shouldStoreChunk(chunkId)) {
      console.log(`⏭️ Skipping chunk ${chunkId} - not responsible`)
      return false
    }
    
    const availableStorage = await this.getAvailableChunkStorage()
    const chunkSize = chunkData.length
    
    if (this.stats.storageUsed + chunkSize > availableStorage) {
      // Evict old chunks to make space
      await this.evictChunksForSpace(chunkSize)
    }
    
    this.chunks.set(chunkId, chunkData)
    this.chunkMetadata.set(chunkId, {
      ...metadata,
      size: chunkSize,
      stored: Date.now(),
      accessed: Date.now(),
      proximity: this.getChunkProximity(chunkId)
    })
    
    this.stats.storageUsed += chunkSize
    this.stats.totalChunks++
    this.responsibleChunks.add(chunkId)
    
    return true
  }
  
  async evictChunksForSpace(requiredSpace) {
    console.log(`🧹 Evicting chunks to free ${this.formatSize(requiredSpace)}`)
    
    // Get all chunks sorted by access time (LRU)
    const chunkList = Array.from(this.chunkMetadata.entries())
      .sort((a, b) => a[1].accessed - b[1].accessed)
    
    let freedSpace = 0
    for (const [chunkId, metadata] of chunkList) {
      if (freedSpace >= requiredSpace) break
      
      this.chunks.delete(chunkId)
      this.chunkMetadata.delete(chunkId)
      this.responsibleChunks.delete(chunkId)
      
      freedSpace += metadata.size
      this.stats.storageUsed -= metadata.size
      this.stats.totalChunks--
      
      console.log(`🗑️ Evicted chunk ${chunkId} (${this.formatSize(metadata.size)})`)
    }
    
    return freedSpace
  }
  
  async cleanupOldChunks() {
    console.log('🧹 Cleaning up old chunks...')
    
    const now = Date.now()
    const threshold = now - this.maxChunkAge
    let cleaned = 0
    
    for (const [chunkId, metadata] of this.chunkMetadata.entries()) {
      if (metadata.accessed < threshold) {
        const size = metadata.size
        this.chunks.delete(chunkId)
        this.chunkMetadata.delete(chunkId)
        this.responsibleChunks.delete(chunkId)
        this.stats.storageUsed -= size
        this.stats.totalChunks--
        cleaned++
      }
    }
    
    this.stats.lastCleanup = now
    console.log(`✅ Cleaned up ${cleaned} old chunks`)
    
    return cleaned
  }
  
  // ===== SEARCH AND INDEXING =====
  
  async findFileByFilename(filename) {
    try { console.log(`[SEARCH] file-index query: "${filename}"`) } catch {}
    const normalized = this.normalizeFilename(filename)
    const local = this.filenameHashIndex.get(normalized)
    if (local) {
      try { console.log(`[SEARCH] local index hit -> ${local}`) } catch {}
      return local
    }
    // Lookup in DHT mapping
    const fnameKey = `filename:${normalized}`
    const arrRaw = await this.storage.get(fnameKey)
    if (arrRaw) {
      try {
        const arr = JSON.parse(arrRaw)
        if (Array.isArray(arr) && arr.length > 0) return arr[0].fileHash
      } catch {}
    }
    // Fallback to Book dataset representation (search by full normalized name token)
    try {
      const dsKey = `dataset:file-index:${normalized}`
      const dsRaw = await this.storage.get(dsKey)
      if (dsRaw) {
        const list = JSON.parse(dsRaw)
        if (Array.isArray(list) && list.length > 0) {
          const found = list[0].fileHash || (list[0].value && JSON.parse(list[0].value).fileHash)
          try { console.log(`[SEARCH] dataset hit -> ${found}`) } catch {}
          return found
        }
      }
    } catch {}
    try { console.log('[SEARCH] no match') } catch {}
    return null
  }

  // Append-or-create filename index entry in DHT
  async upsertFilenameIndex(normalizedName, entry) {
    const key = `filename:${normalizedName}`
    try {
      const currentRaw = await this.storage.get(key)
      let list = []
      if (currentRaw) {
        try { list = JSON.parse(currentRaw) || [] } catch {}
      }
      if (!Array.isArray(list)) list = []
      const exists = list.some(it => it && it.fileHash === entry.fileHash)
      if (!exists) list.unshift(entry)
      await this.storage.set(key, JSON.stringify(list))
    } catch (e) {
      console.warn('Failed to upsert filename index:', e)
    }
  }

  // ----- Book dataset helpers for filename index -----
  tokenizeFilename(filename) {
    try {
      const name = String(filename || '')
      const nameWithoutExt = name.replace(/\.[^.]+$/, '')
      const ext = (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
      const spaced = nameWithoutExt
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .replace(/[._-]+/g, ' ')
        .toLowerCase()
        .trim()
      const words = spaced.split(/\s+/).filter(Boolean)
      const tokens = new Set()
      // individual words
      words.forEach(w => tokens.add(w))
      // substrings for longer words (enable partial search like KJV dataset logic)
      words.forEach(w => {
        if (w.length > 6) {
          for (let i = 0; i <= w.length - 3; i++) {
            for (let len = 3; len <= w.length - i; len++) {
              tokens.add(w.substring(i, i + len))
            }
          }
        }
      })
      // extension
      if (ext) tokens.add(ext)
      // full normalized name for exact match
      if (spaced) tokens.add(spaced)
      // also include the raw normalized filename used previously
      tokens.add(this.normalizeFilename(name))
      return Array.from(tokens)
    } catch {
      return [this.normalizeFilename(filename)]
    }
  }

  async addToDataset(datasetName, key, entry, dedupeField = 'fileHash') {
    const dsKey = `dataset:${datasetName}:${key}`
    try {
      const currentRaw = await this.storage.get(dsKey)
      let list = []
      if (currentRaw) {
        try { list = JSON.parse(currentRaw) || [] } catch {}
      }
      if (!Array.isArray(list)) list = []
      const exists = list.some(it => {
        try {
          if (it && typeof it === 'object') {
            if (it[dedupeField]) return it[dedupeField] === entry[dedupeField]
            if (it.value) {
              const v = JSON.parse(it.value)
              return v && v[dedupeField] === entry[dedupeField]
            }
          }
        } catch {}
        return false
      })
      if (!exists) list.unshift(entry)
      await this.storage.set(dsKey, JSON.stringify(list))
    } catch (e) {
      console.warn('Failed to add to dataset:', datasetName, key, e)
    }
  }

  async upsertBookFilenameDataset(filename, entry) {
    const tokens = this.tokenizeFilename(filename)
    await Promise.all(tokens.map(t => this.addToDataset('file-index', t, entry)))
  }

  // Coerce various data inputs into Uint8Array
  async toBuffer(data) {
    if (data instanceof Uint8Array) return data
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(data)) return new Uint8Array(data)
    if (data instanceof ArrayBuffer) return new Uint8Array(data)
    // Blob/File (browser)
    if (typeof Blob !== 'undefined' && data instanceof Blob && data.arrayBuffer) {
      const ab = await data.arrayBuffer()
      return new Uint8Array(ab)
    }
    // Try to read .buffer and .byteLength
    if (data && data.buffer && (data.byteLength !== undefined)) return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength)
    // Fallback: stringify
    const str = typeof data === 'string' ? data : JSON.stringify(data)
    const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null
    return enc ? enc.encode(str) : new Uint8Array(Array.from(str).map(c => c.charCodeAt(0)))
  }
  
  async listFiles() {
    const files = []
    
    // Add whole files
    for (const [fileHash, file] of this.wholeFiles.entries()) {
      files.push({
        fileHash,
        filename: file.filename,
        size: file.size,
        type: 'whole',
        stored: file.stored,
        accessed: file.accessed
      })
    }
    
    // Add chunked files
    for (const [fileHash, chunkIds] of this.fileChunks.entries()) {
      const firstChunkId = Array.from(chunkIds)[0]
      const metadata = this.chunkMetadata.get(firstChunkId)
      
      if (metadata) {
        files.push({
          fileHash,
          filename: metadata.filename,
          totalChunks: chunkIds.size,
          type: 'chunked',
          stored: metadata.stored,
          accessed: metadata.accessed
        })
      }
    }
    
    return files
  }
  
  // ===== STATISTICS =====
  
  getStats() {
    return {
      ...this.stats,
      mode: this.isBrowser ? 'browser' : 'node',
      quota: this.storageQuota,
      available: this.storageQuota - this.stats.storageUsed,
      usagePercent: (this.stats.storageUsed / this.storageQuota * 100).toFixed(2),
      responsibleChunks: this.responsibleChunks.size,
      wholeFiles: this.wholeFiles.size
    }
  }
  
  formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
  }
  
  // ===== LIFECYCLE =====
  
  async shutdown() {
    console.log('Shutting down ChunkStorage...')
    
    // Clear all data
    this.chunks.clear()
    this.chunkMetadata.clear()
    this.fileChunks.clear()
    this.wholeFiles.clear()
    this.filenameHashIndex.clear()
    this.responsibleChunks.clear()
    
    console.log('ChunkStorage shutdown complete')
  }
}
