87/**
 * PagingStorage - A distributed paging storage system for PeerPigeon networks
 * Based on the Book.js architecture with peer-to-peer capabilities
 */

import { PeerSynchronization } from './PeerSynchronization.js'
import { WebDHTAdapter } from './WebDHTAdapter.js'
import { StoragePersistence } from './StoragePersistence.js'
import { ChunkStorage } from './ChunkStorage.js'

export class PagingStorage {
  constructor(options = {}) {
    this.pigeon = options.pigeon // PeerPigeon instance
    this.peerId = options.peerId || (this.pigeon ? this.pigeon.peerId : null)
    if (!this.peerId) {
      throw new Error('PeerPigeon instance with peerId is required')
    }
    this.pageSize = options.pageSize || 4096 // 4KB default page size
    this.maxCachePages = options.maxCachePages || 100
    
    // Core storage structures
    this.pages = new Map() // pageId -> page
    this.pageIndex = new Map() // key -> pageId
    this.pageCache = new Map() // LRU cache for remote pages
    this.cacheOrder = [] // For LRU management
    
    // Peer management
    this.peers = new Map() // peerId -> peer info
    this.pageLocations = new Map() // pageId -> Set of peerIds
    this.pendingRequests = new Map() // requestId -> Promise
    
    // Page splitting and management
    this.splitThreshold = this.pageSize * 0.8 // Split at 80% capacity
    this.mergeThreshold = this.pageSize * 0.2 // Merge below 20% capacity
    
    this.setupEventHandlers()
    
    // Initialize peer synchronization, DHT, and persistence
    this.sync = new PeerSynchronization(this)
    // Require PeerPigeon's WebDHT (no internal fallback)
    if (!this.pigeon || !this.pigeon.webDHT) {
      throw new Error('WebDHT is required but not available on the PeerPigeon mesh')
    }
    this.dht = new WebDHTAdapter(this)
  // console.log('Using WebDHT for distributed storage')
    this.persistence = new StoragePersistence(this, options.persistence)
    this.chunks = new ChunkStorage(this, options.chunks)
  }
  
  setupEventHandlers() {
    if (this.pigeon) {
      this.pigeon.on('peer-connected', (peerId) => {
        this.sync.onPeerConnected(peerId)
        this.dht.onPeerConnected(peerId)
      })
      
      this.pigeon.on('peer-disconnected', (peerId) => {
        this.onPeerDisconnected(peerId)
        this.dht.onPeerDisconnected(peerId)
      })
      
      this.pigeon.on('message', (message, fromPeerId) => {
        this.sync.handleMessage(message, fromPeerId)
      })
    }
  }
  
  // ===== CORE STORAGE OPERATIONS =====
  
  /**
   * Store a key-value pair (DHT-aware)
   */
  async set(key, value) {
    return await this.dht.routeSet(key, value)
  }
  
  /**
   * Retrieve a value by key (DHT-aware)
   */
  async get(key) {
    return await this.dht.routeGet(key)
  }
  
  /**
   * Delete a key-value pair (DHT-aware)
   */
  async delete(key) {
    return await this.dht.routeDelete(key)
  }
  
  /**
   * Check if a key exists
   */
  async has(key) {
    const value = await this.get(key)
    return value !== undefined
  }
  
  // ===== LOCAL STORAGE OPERATIONS =====
  
  /**
   * Store a key-value pair locally (bypasses DHT routing)
   */
  async setLocal(key, value) {
    const keyStr = String(key)
    let pageId = this.pageIndex.get(keyStr)
    let page
    
    if (pageId && this.pages.has(pageId)) {
      // Update existing entry
      page = this.pages.get(pageId)
      const oldSize = this.getEntrySize(page.data.get(keyStr))
      page.data.set(keyStr, value)
      page.size += this.getEntrySize(value) - oldSize
      page.lastModified = Date.now()
    } else {
      // Find or create appropriate page
      page = await this.findOrCreatePageForKey(keyStr)
      page.data.set(keyStr, value)
      page.size += this.getEntrySize(value) + this.getEntrySize(keyStr)
      page.lastModified = Date.now()
      this.pageIndex.set(keyStr, page.id)
    }
    
    // Check if page needs splitting
    if (page.size > this.splitThreshold) {
      await this.splitPage(page)
    }
    
    // Mark page as dirty for persistence
    this.persistence.markDirty(page.id)
    
    // Broadcast update to peers
    this.sync.broadcastPageUpdate(page.id, keyStr, value)
    
    return this
  }
  
  /**
   * Retrieve a value by key locally (bypasses DHT routing)
   */
  async getLocal(key) {
    const keyStr = String(key)
    const pageId = this.pageIndex.get(keyStr)
    
    if (pageId && this.pages.has(pageId)) {
      const page = this.pages.get(pageId)
      return page.data.get(keyStr)
    }
    
    return undefined
  }
  
  /**
   * Delete a key-value pair locally (bypasses DHT routing)
   */
  async deleteLocal(key) {
    const keyStr = String(key)
    const pageId = this.pageIndex.get(keyStr)
    
    if (pageId && this.pages.has(pageId)) {
      const page = this.pages.get(pageId)
      const value = page.data.get(keyStr)
      
      if (value !== undefined) {
        page.data.delete(keyStr)
        page.size -= this.getEntrySize(value) + this.getEntrySize(keyStr)
        page.lastModified = Date.now()
        this.pageIndex.delete(keyStr)
        
        // Check if page needs merging
        if (page.size < this.mergeThreshold && page.data.size > 0) {
          await this.attemptPageMerge(page)
        }
        
        // Mark page as dirty and broadcast deletion to peers
        this.persistence.markDirty(page.id)
        this.sync.broadcastPageDeletion(page.id, keyStr)
        
        return true
      }
    }
    
    return false
  }
  
  // ===== PAGE MANAGEMENT =====
  
  createPage(firstKey = null) {
    const pageId = this.generatePageId()
    const page = {
      id: pageId,
      data: new Map(),
      size: 0,
      created: Date.now(),
      lastModified: Date.now(),
      firstKey: firstKey,
      owner: this.peerId,
      replicas: new Set([this.peerId])
    }
    
    // Store through persistence layer
    this.persistence.storePage(page)
    this.pageLocations.set(pageId, new Set([this.peerId]))
    
    return page
  }
  
  generatePageId() {
    return 'page_' + this.peerId + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
  }
  
  async findOrCreatePageForKey(key) {
    // Find the best existing page for this key
    const sortedKeys = Array.from(this.pageIndex.keys()).sort()
    const insertIndex = this.binarySearch(sortedKeys, key)
    
    // Try to find a nearby page that has space
    for (let i = Math.max(0, insertIndex - 2); i <= Math.min(sortedKeys.length - 1, insertIndex + 2); i++) {
      const nearbyKey = sortedKeys[i]
      const pageId = this.pageIndex.get(nearbyKey)
      const page = this.pages.get(pageId)
      
      if (page && page.size < this.splitThreshold) {
        return page
      }
    }
    
    // Create new page
    return this.createPage(key)
  }
  
  async splitPage(page) {
    if (page.data.size <= 1) return // Can't split a page with 1 or fewer entries
    
    const entries = Array.from(page.data.entries()).sort()
    const midPoint = Math.floor(entries.length / 2)
    
    // Create new page for the second half
    const newPage = this.createPage(entries[midPoint][0])
    
    // Move second half of entries to new page
    for (let i = midPoint; i < entries.length; i++) {
      const [key, value] = entries[i]
      newPage.data.set(key, value)
      newPage.size += this.getEntrySize(key) + this.getEntrySize(value)
      this.pageIndex.set(key, newPage.id)
      
      // Remove from original page
      page.data.delete(key)
      page.size -= this.getEntrySize(key) + this.getEntrySize(value)
    }
    
    page.lastModified = Date.now()
    newPage.lastModified = Date.now()
    
  // console.log(`Split page ${page.id} -> created ${newPage.id}`)
    
    // Notify peers about the new page
    this.sync.broadcastPageCreation(newPage)
  }
  
  async attemptPageMerge(page) {
    // Find a nearby page to merge with
    const pageEntries = Array.from(page.data.entries())
    if (pageEntries.length === 0) {
      // Empty page, just delete it
      this.deletePage(page.id)
      return
    }
    
    const firstKey = pageEntries.sort()[0][0]
    const sortedKeys = Array.from(this.pageIndex.keys()).sort()
    const keyIndex = sortedKeys.indexOf(firstKey)
    
    // Try to merge with adjacent pages
    const candidates = []
    if (keyIndex > 0) candidates.push(sortedKeys[keyIndex - 1])
    if (keyIndex < sortedKeys.length - 1) candidates.push(sortedKeys[keyIndex + 1])
    
    for (const candidateKey of candidates) {
      const candidatePageId = this.pageIndex.get(candidateKey)
      const candidatePage = this.pages.get(candidatePageId)
      
      if (candidatePage && candidatePage.id !== page.id && 
          candidatePage.size + page.size < this.pageSize) {
        // Merge pages
        await this.mergePages(page, candidatePage)
        return
      }
    }
  }
  
  async mergePages(sourcePage, targetPage) {
    // Move all entries from source to target
    for (const [key, value] of sourcePage.data.entries()) {
      targetPage.data.set(key, value)
      targetPage.size += this.getEntrySize(key) + this.getEntrySize(value)
      this.pageIndex.set(key, targetPage.id)
    }
    
    targetPage.lastModified = Date.now()
    
    // Delete source page
    this.deletePage(sourcePage.id)
    
  // console.log(`Merged page ${sourcePage.id} into ${targetPage.id}`)
    this.sync.broadcastPageDeletion(sourcePage.id)
  }
  
  deletePage(pageId) {
    const page = this.pages.get(pageId)
    if (page) {
      // Remove all key indexes pointing to this page
      for (const key of page.data.keys()) {
        this.pageIndex.delete(key)
      }
    }
    
    // Delete through persistence layer
    this.persistence.deletePage(pageId)
    this.pageLocations.delete(pageId)
  }
  
  // ===== UTILITY METHODS =====
  
  getEntrySize(value) {
    if (typeof value === 'string') return value.length * 2 // UTF-16
    if (typeof value === 'number') return 8
    if (typeof value === 'boolean') return 1
    if (value === null || value === undefined) return 0
    return JSON.stringify(value).length * 2
  }
  
  binarySearch(sortedArray, target) {
    let left = 0
    let right = sortedArray.length
    
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (sortedArray[mid] < target) {
        left = mid + 1
      } else {
        right = mid
      }
    }
    
    return left
  }
  
  // ===== PEER MANAGEMENT =====
  
  onPeerDisconnected(peerId) {
  // console.log(`Peer disconnected: ${peerId}`)
    this.peers.delete(peerId)
    
    // Remove peer from page locations
    for (const [pageId, peerSet] of this.pageLocations.entries()) {
      peerSet.delete(peerId)
    }
  }
  
  // ===== DEBUG AND INSPECTION =====
  
  getStats() {
    const cacheStats = this.persistence.getCacheStats()
    const dhtStats = this.dht.getLoadBalanceStats()
    const chunkStats = this.chunks.getStats()
    // Enhanced WebDHT stats when available
    let webDHT = this.pigeon?.webDHT
    let webDHTStats = null
    try {
      webDHTStats = webDHT && typeof webDHT.getStats === 'function' ? webDHT.getStats() : null
    } catch {
      webDHTStats = null
    }
    const derivedDht = {
      peers: dhtStats.size,
      isLoadBalanced: this.dht.isLoadBalanced(),
      memoryPressure: this.persistence.getMemoryPressure(),
      diskPressure: this.persistence.getDiskPressure()
    }
    // Map some common fields if present
    if (webDHTStats && typeof webDHTStats === 'object') {
      derivedDht.peerCount = webDHTStats.peerCount ?? webDHTStats.peers ?? undefined
      derivedDht.localKeys = webDHTStats.localKeys ?? undefined
      derivedDht.totalKeys = webDHTStats.totalKeys ?? undefined
      derivedDht.closestPeers = webDHTStats.closestPeers ?? undefined
      derivedDht.routingTableSize = webDHTStats.routingTableSize ?? webDHTStats.buckets?.length ?? undefined
      derivedDht.bucketCounts = webDHTStats.buckets?.map?.(b => b.size ?? b.count).filter(v => v != null) ?? undefined
      derivedDht.storageUsed = webDHTStats.storageUsed ?? undefined
      derivedDht.storageQuota = webDHTStats.storageQuota ?? undefined
      derivedDht.latencyMs = webDHTStats.avgLatencyMs ?? webDHTStats.latencyMs ?? undefined
    }
    
    return {
      peerId: this.peerId,
      totalPages: this.pages.size,
      totalKeys: this.pageIndex.size,
      cacheSize: this.pageCache.size,
      connectedPeers: this.peers.size,
      averagePageSize: Array.from(this.pages.values()).reduce((sum, page) => sum + page.size, 0) / this.pages.size || 0,
      cache: cacheStats,
      chunks: chunkStats,
      dht: derivedDht
    }
  }
  
  listPages() {
    return Array.from(this.pages.values()).map(page => ({
      id: page.id,
      size: page.size,
      keyCount: page.data.size,
      firstKey: page.firstKey,
      lastModified: new Date(page.lastModified).toISOString()
    }))
  }
  
  // ===== FILE AND CHUNK OPERATIONS =====
  
  /**
   * Store a file with automatic chunking based on peer type
   */
  async storeFile(filename, data, metadata = {}) {
    return await this.chunks.storeFile(filename, data, metadata)
  }
  
  /**
   * Retrieve a file by filename or hash
   */
  async getFile(filenameOrHash) {
    return await this.chunks.getFile(filenameOrHash)
  }
  
  /**
   * Store a single chunk
   */
  async storeChunk(chunkId, chunkData, metadata = {}) {
    return await this.chunks.storeChunk(chunkId, chunkData, metadata)
  }
  
  /**
   * Get a single chunk
   */
  async getChunk(chunkId) {
    return await this.chunks.getChunk(chunkId)
  }
  
  /**
   * List all stored files
   */
  async listFiles() {
    return await this.chunks.listFiles()
  }
  
  /**
   * Find file by filename
   */
  async findFileByFilename(filename) {
    return await this.chunks.findFileByFilename(filename)
  }
  
  // ===== LIFECYCLE MANAGEMENT =====
  
  async shutdown() {
  // console.log('Shutting down PagingStorage...')
    
    // Shutdown chunk storage
    await this.chunks.shutdown()
    
    // Shutdown persistence layer
    await this.persistence.shutdown()
    
    // Disconnect from peers
    if (this.pigeon) {
      // Note: We don't disconnect the pigeon instance as it may be used elsewhere
  // console.log('PeerPigeon connection maintained')
    }
    
  // console.log('PagingStorage shutdown complete')
  }
}