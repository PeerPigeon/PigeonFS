/**
 * PeerSynchronization - Handles peer-to-peer synchronization for PagingStorage
 * Implements page discovery, transfer, and conflict resolution
 */

export class PeerSynchronization {
  constructor(storage) {
    this.storage = storage
    this.requestTimeout = 30000 // 30 second timeout
    this.syncInterval = 60000 // Sync every minute
    this.replicationFactor = 3 // Replicate each page to 3 peers
    
    // Message types
    this.MESSAGE_TYPES = {
      PAGE_REQUEST: 'page_request',
      PAGE_RESPONSE: 'page_response',
      PAGE_UPDATE: 'page_update',
      PAGE_DELETE: 'page_delete',
      PAGE_LIST: 'page_list',
      PEER_DISCOVERY: 'peer_discovery',
      SYNC_REQUEST: 'sync_request',
      CHUNK_REQUEST: 'chunk_request',
      CHUNK_RESPONSE: 'chunk_response'
    }
    
    this.startSyncProcess()
  }
  
  // ===== PEER DISCOVERY AND COMMUNICATION =====
  
  async getFromPeers(key) {
    const keyStr = String(key)
    
    // First, ask peers what pages they have for this key
    const peerResponses = await this.broadcastPageRequest(keyStr)
    
    for (const response of peerResponses) {
      if (response.found && response.value !== undefined) {
        // Cache the result
        this.cacheRemoteEntry(response.pageId, keyStr, response.value, response.peerId)
        return response.value
      }
    }
    
    return undefined
  }
  
  async broadcastPageRequest(key, timeout = this.requestTimeout) {
    if (!this.storage.pigeon || this.storage.peers.size === 0) {
      return []
    }
    
    const requestId = this.generateRequestId()
    const message = {
      type: this.MESSAGE_TYPES.PAGE_REQUEST,
      requestId,
      key,
      fromPeer: this.storage.peerId,
      timestamp: Date.now()
    }
    
    // Send to all connected peers
    const promises = []
    for (const peerId of this.storage.peers.keys()) {
      promises.push(this.sendMessageToPeer(peerId, message, timeout))
    }
    
    const responses = await Promise.allSettled(promises)
    return responses
      .filter(result => result.status === 'fulfilled' && result.value)
      .map(result => result.value)
  }
  
  async sendMessageToPeer(peerId, message, timeout = this.requestTimeout) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.storage.pendingRequests.delete(message.requestId)
        reject(new Error(`Request timeout to peer ${peerId}`))
      }, timeout)
      
      // Store the promise resolver
      this.storage.pendingRequests.set(message.requestId, { resolve, reject, timeoutId })
      
      try {
        this.storage.pigeon.sendTo(peerId, JSON.stringify(message))
      } catch (error) {
        clearTimeout(timeoutId)
        this.storage.pendingRequests.delete(message.requestId)
        reject(error)
      }
    })
  }
  
  handleMessage(message, fromPeerId) {
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : message
      
      switch (data.type) {
        case this.MESSAGE_TYPES.PAGE_REQUEST:
          this.handlePageRequest(data, fromPeerId)
          break
        case this.MESSAGE_TYPES.PAGE_RESPONSE:
          this.handlePageResponse(data, fromPeerId)
          break
        case this.MESSAGE_TYPES.PAGE_UPDATE:
          this.handlePageUpdate(data, fromPeerId)
          break
        case this.MESSAGE_TYPES.PAGE_DELETE:
          this.handlePageDelete(data, fromPeerId)
          break
        case this.MESSAGE_TYPES.PAGE_LIST:
          this.handlePageList(data, fromPeerId)
          break
        case this.MESSAGE_TYPES.PEER_DISCOVERY:
          this.handlePeerDiscovery(data, fromPeerId)
          break
        case this.MESSAGE_TYPES.SYNC_REQUEST:
          this.handleSyncRequest(data, fromPeerId)
          break
        case this.MESSAGE_TYPES.CHUNK_REQUEST:
          this.handleChunkRequest(data, fromPeerId)
          break
        case this.MESSAGE_TYPES.CHUNK_RESPONSE:
          this.handleChunkResponse(data, fromPeerId)
          break
      }
    } catch (error) {
      console.error('Error handling peer message:', error)
    }
  }
  
  // ===== MESSAGE HANDLERS =====
  
  async handlePageRequest(data, fromPeerId) {
    const { requestId, key } = data
    
    // Look for the key in local storage
    const pageId = this.storage.pageIndex.get(key)
    let found = false
    let value = undefined
    let pageInfo = null
    
    if (pageId && this.storage.pages.has(pageId)) {
      const page = this.storage.pages.get(pageId)
      value = page.data.get(key)
      found = value !== undefined
      
      if (found) {
        pageInfo = {
          id: page.id,
          lastModified: page.lastModified,
          size: page.size,
          keyCount: page.data.size
        }
      }
    }
    
    // Send response
    const response = {
      type: this.MESSAGE_TYPES.PAGE_RESPONSE,
      requestId,
      key,
      found,
      value,
      pageId,
      pageInfo,
      fromPeer: this.storage.peerId,
      timestamp: Date.now()
    }
    
    this.storage.pigeon.sendTo(fromPeerId, JSON.stringify(response))
  }
  
  handlePageResponse(data, fromPeerId) {
    const { requestId } = data
    const pendingRequest = this.storage.pendingRequests.get(requestId)
    
    if (pendingRequest) {
      clearTimeout(pendingRequest.timeoutId)
      this.storage.pendingRequests.delete(requestId)
      pendingRequest.resolve(data)
    }
  }
  
  async handlePageUpdate(data, fromPeerId) {
    const { pageId, key, value, timestamp } = data
    
    // Check if we should accept this update
    let page = this.storage.pages.get(pageId)
    
    if (!page) {
      // We don't have this page, decide if we want to replicate it
      if (this.shouldReplicatePage(pageId, fromPeerId)) {
        page = await this.requestFullPage(pageId, fromPeerId)
      } else {
        return // Ignore the update
      }
    }
    
    if (page) {
      // Apply the update if it's newer
      const currentValue = page.data.get(key)
      if (!currentValue || timestamp > page.lastModified) {
        const oldSize = this.storage.getEntrySize(currentValue)
        const newSize = this.storage.getEntrySize(value)
        
        page.data.set(key, value)
        page.size += newSize - oldSize
        page.lastModified = Math.max(page.lastModified, timestamp)
        
        this.storage.pageIndex.set(key, pageId)
        
        console.log(`Applied remote update: ${key} in page ${pageId} from peer ${fromPeerId}`)
      }
    }
  }
  
  async handlePageDelete(data, fromPeerId) {
    const { pageId, key, timestamp } = data
    
    const page = this.storage.pages.get(pageId)
    if (page && timestamp > page.lastModified) {
      if (key) {
        // Delete specific key
        const value = page.data.get(key)
        if (value !== undefined) {
          page.data.delete(key)
          page.size -= this.storage.getEntrySize(key) + this.storage.getEntrySize(value)
          this.storage.pageIndex.delete(key)
          page.lastModified = Math.max(page.lastModified, timestamp)
          
          console.log(`Applied remote deletion: ${key} from page ${pageId} by peer ${fromPeerId}`)
        }
      } else {
        // Delete entire page
        this.storage.deletePage(pageId)
        console.log(`Deleted page ${pageId} as requested by peer ${fromPeerId}`)
      }
    }
  }
  
  handlePageList(data, fromPeerId) {
    const { pages } = data
    
    // Update our knowledge of what pages this peer has
    this.storage.peers.set(fromPeerId, {
      lastSeen: Date.now(),
      pages: new Set(pages.map(p => p.id)),
      pageInfo: new Map(pages.map(p => [p.id, p]))
    })
    
    // Update page locations
    for (const pageInfo of pages) {
      if (!this.storage.pageLocations.has(pageInfo.id)) {
        this.storage.pageLocations.set(pageInfo.id, new Set())
      }
      this.storage.pageLocations.get(pageInfo.id).add(fromPeerId)
    }
  }
  
  handlePeerDiscovery(data, fromPeerId) {
    // Simple peer discovery response
    const response = {
      type: this.MESSAGE_TYPES.PEER_DISCOVERY,
      peerId: this.storage.peerId,
      pageCount: this.storage.pages.size,
      timestamp: Date.now()
    }
    
    this.storage.pigeon.sendTo(fromPeerId, JSON.stringify(response))
  }
  
  async handleSyncRequest(data, fromPeerId) {
    // Send our page list to the requesting peer
    const pageList = Array.from(this.storage.pages.values()).map(page => ({
      id: page.id,
      lastModified: page.lastModified,
      size: page.size,
      keyCount: page.data.size,
      firstKey: page.firstKey
    }))
    
    const response = {
      type: this.MESSAGE_TYPES.PAGE_LIST,
      pages: pageList,
      fromPeer: this.storage.peerId,
      timestamp: Date.now()
    }
    
    this.storage.pigeon.sendTo(fromPeerId, JSON.stringify(response))
  }
  
  // ===== BROADCAST METHODS =====
  
  broadcastPageUpdate(pageId, key, value) {
    if (!this.storage.pigeon || this.storage.peers.size === 0) return
    
    const message = {
      type: this.MESSAGE_TYPES.PAGE_UPDATE,
      pageId,
      key,
      value,
      timestamp: Date.now(),
      fromPeer: this.storage.peerId
    }
    
    // Broadcast to all peers
    this.broadcastMessage(message)
  }
  
  broadcastPageDeletion(pageId, key = null) {
    if (!this.storage.pigeon || this.storage.peers.size === 0) return
    
    const message = {
      type: this.MESSAGE_TYPES.PAGE_DELETE,
      pageId,
      key,
      timestamp: Date.now(),
      fromPeer: this.storage.peerId
    }
    
    this.broadcastMessage(message)
  }
  
  broadcastPageCreation(page) {
    if (!this.storage.pigeon || this.storage.peers.size === 0) return
    
    // For new pages, broadcast the entire page content to replicas
    const pageData = {
      id: page.id,
      data: Object.fromEntries(page.data),
      size: page.size,
      created: page.created,
      lastModified: page.lastModified,
      firstKey: page.firstKey,
      owner: page.owner
    }
    
    const message = {
      type: this.MESSAGE_TYPES.PAGE_UPDATE,
      pageData,
      isNewPage: true,
      timestamp: Date.now(),
      fromPeer: this.storage.peerId
    }
    
    this.broadcastMessage(message)
  }
  
  broadcastMessage(message) {
    const messageStr = JSON.stringify(message)
    
    for (const peerId of this.storage.peers.keys()) {
      try {
        this.storage.pigeon.sendTo(peerId, messageStr)
      } catch (error) {
        console.error(`Failed to send message to peer ${peerId}:`, error)
      }
    }
  }
  
  // ===== SYNCHRONIZATION PROCESS =====
  
  startSyncProcess() {
    // Periodic sync with peers
    setInterval(() => {
      this.performPeriodicSync()
    }, this.syncInterval)
  }
  
  async performPeriodicSync() {
    if (!this.storage.pigeon || this.storage.peers.size === 0) return
    
    try {
      // Request page lists from all peers
      const syncMessage = {
        type: this.MESSAGE_TYPES.SYNC_REQUEST,
        fromPeer: this.storage.peerId,
        timestamp: Date.now()
      }
      
      this.broadcastMessage(syncMessage)
      
      // Clean up old cache entries
      this.cleanupCache()
      
    } catch (error) {
      console.error('Error during periodic sync:', error)
    }
  }
  
  // ===== HELPER METHODS =====
  
  shouldReplicatePage(pageId, fromPeerId) {
    // Simple replication strategy: replicate if we have fewer than replicationFactor copies
    const locations = this.storage.pageLocations.get(pageId)
    const currentReplicas = locations ? locations.size : 0
    
    return currentReplicas < this.replicationFactor
  }
  
  async requestFullPage(pageId, fromPeerId) {
    // Request the full page content from a peer
    const message = {
      type: 'full_page_request',
      pageId,
      requestId: this.generateRequestId(),
      fromPeer: this.storage.peerId,
      timestamp: Date.now()
    }
    
    try {
      const response = await this.sendMessageToPeer(fromPeerId, message)
      if (response && response.pageData) {
        return this.createPageFromRemoteData(response.pageData)
      }
    } catch (error) {
      console.error(`Failed to request full page ${pageId} from ${fromPeerId}:`, error)
    }
    
    return null
  }
  
  createPageFromRemoteData(pageData) {
    const page = {
      id: pageData.id,
      data: new Map(Object.entries(pageData.data)),
      size: pageData.size,
      created: pageData.created,
      lastModified: pageData.lastModified,
      firstKey: pageData.firstKey,
      owner: pageData.owner,
      replicas: new Set([this.storage.peerId])
    }
    
    this.storage.pages.set(page.id, page)
    
    // Update page index
    for (const [key] of page.data) {
      this.storage.pageIndex.set(key, page.id)
    }
    
    return page
  }
  
  cacheRemoteEntry(pageId, key, value, fromPeerId) {
    // Simple LRU cache for remote entries
    if (this.storage.pageCache.size >= this.storage.maxCachePages) {
      // Remove oldest entry
      const oldestKey = this.storage.cacheOrder.shift()
      this.storage.pageCache.delete(oldestKey)
    }
    
    const cacheKey = `${pageId}:${key}`
    this.storage.pageCache.set(cacheKey, {
      value,
      timestamp: Date.now(),
      fromPeer: fromPeerId
    })
    
    this.storage.cacheOrder.push(cacheKey)
  }
  
  cleanupCache() {
    const now = Date.now()
    const maxAge = 5 * 60 * 1000 // 5 minutes
    
    for (const [cacheKey, entry] of this.storage.pageCache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.storage.pageCache.delete(cacheKey)
        const index = this.storage.cacheOrder.indexOf(cacheKey)
        if (index > -1) {
          this.storage.cacheOrder.splice(index, 1)
        }
      }
    }
  }
  
  generateRequestId() {
    return `req_${this.storage.peerId}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
  }
  
  // ===== CHUNK SYNCHRONIZATION =====
  
  async requestChunkFromPeer(peerId, chunkId, timeout = this.requestTimeout) {
    const requestId = this.generateRequestId()
    const message = {
      type: this.MESSAGE_TYPES.CHUNK_REQUEST,
      requestId,
      chunkId,
      fromPeer: this.storage.peerId,
      timestamp: Date.now()
    }
    
    try {
      const response = await this.sendMessageToPeer(peerId, message, timeout)
      return response.chunk
    } catch (error) {
      console.error(`Failed to get chunk ${chunkId} from peer ${peerId}:`, error)
      return null
    }
  }
  
  async handleChunkRequest(data, fromPeerId) {
    const { requestId, chunkId } = data
    
    // Look for the chunk in local storage
    const chunk = this.storage.chunks.chunks.get(chunkId)
    const metadata = this.storage.chunks.chunkMetadata.get(chunkId)
    
    const response = {
      type: this.MESSAGE_TYPES.CHUNK_RESPONSE,
      requestId,
      chunkId,
      found: !!chunk,
      chunk: chunk ? Array.from(chunk) : null,
      metadata: metadata || null,
      fromPeer: this.storage.peerId,
      timestamp: Date.now()
    }
    
    this.storage.pigeon.sendTo(fromPeerId, JSON.stringify(response))
  }
  
  handleChunkResponse(data, fromPeerId) {
    const { requestId, chunk } = data
    const pendingRequest = this.storage.pendingRequests.get(requestId)
    
    if (pendingRequest) {
      clearTimeout(pendingRequest.timeoutId)
      this.storage.pendingRequests.delete(requestId)
      
      // Convert array back to Uint8Array
      const chunkData = chunk ? new Uint8Array(chunk) : null
      pendingRequest.resolve({ ...data, chunk: chunkData })
    }
  }
  
  onPeerConnected(peerId) {
    console.log(`Peer connected: ${peerId}`)
    
    this.storage.peers.set(peerId, {
      lastSeen: Date.now(),
      pages: new Set(),
      pageInfo: new Map()
    })
    
    // Send discovery message
    setTimeout(() => {
      const message = {
        type: this.MESSAGE_TYPES.PEER_DISCOVERY,
        peerId: this.storage.peerId,
        pageCount: this.storage.pages.size,
        timestamp: Date.now()
      }
      
      try {
        this.storage.pigeon.sendTo(peerId, JSON.stringify(message))
      } catch (error) {
        console.error(`Failed to send discovery message to ${peerId}:`, error)
      }
    }, 1000) // Small delay to ensure connection is established
  }
}