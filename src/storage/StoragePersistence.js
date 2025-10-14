/**
 * StoragePersistence - Handles local storage persistence and caching
 * Provides LRU caching, disk persistence, and efficient page management
 */

export class StoragePersistence {
  constructor(storage, options = {}) {
    this.storage = storage
    this.maxMemoryPages = options.maxMemoryPages || 50
    this.maxDiskPages = options.maxDiskPages || 500
    this.persistenceKey = options.persistenceKey || 'pigeonfs_storage'
    this.autoSaveInterval = options.autoSaveInterval || 30000 // 30 seconds
    
    // LRU cache for pages in memory
    this.memoryCache = new Map()
    this.accessOrder = []
    
    // Persistence tracking
    this.dirtyPages = new Set() // Pages that need to be saved
    this.diskIndex = new Map() // pageId -> disk metadata
    this.lastSave = Date.now()
    
    // Initialize persistence
    this.initializePersistence()
    this.startAutoSave()
  }
  
  // ===== INITIALIZATION =====
  
  async initializePersistence() {
    try {
      await this.loadFromDisk()
      console.log('Storage persistence initialized successfully')
    } catch (error) {
      console.error('Failed to initialize persistence:', error)
    }
  }
  
  startAutoSave() {
    setInterval(() => {
      this.saveDirtyPages()
    }, this.autoSaveInterval)
    
    // Save on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.saveDirtyPages()
      })
    }
  }
  
  // ===== MEMORY CACHE MANAGEMENT =====
  
  getFromMemory(pageId) {
    const page = this.memoryCache.get(pageId)
    if (page) {
      // Update access order (move to end)
      this.updateAccessOrder(pageId)
      return page
    }
    return null
  }
  
  putInMemory(page) {
    const pageId = page.id
    
    // Check if we need to evict pages
    if (this.memoryCache.size >= this.maxMemoryPages && !this.memoryCache.has(pageId)) {
      this.evictLeastRecentlyUsed()
    }
    
    this.memoryCache.set(pageId, page)
    this.updateAccessOrder(pageId)
    this.markDirty(pageId)
    
    return page
  }
  
  updateAccessOrder(pageId) {
    // Remove from current position
    const index = this.accessOrder.indexOf(pageId)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
    
    // Add to end (most recently used)
    this.accessOrder.push(pageId)
  }
  
  evictLeastRecentlyUsed() {
    if (this.accessOrder.length === 0) return
    
    const lruPageId = this.accessOrder.shift()
    const lruPage = this.memoryCache.get(lruPageId)
    
    if (lruPage) {
      console.log(`Evicting LRU page: ${lruPageId}`)
      
      // Save to disk if dirty
      if (this.dirtyPages.has(lruPageId)) {
        this.savePageToDisk(lruPage)
      }
      
      this.memoryCache.delete(lruPageId)
    }
  }
  
  // ===== DISK PERSISTENCE =====
  
  async loadFromDisk() {
    if (typeof localStorage === 'undefined') return
    
    try {
      // Load index
      const indexData = localStorage.getItem(`${this.persistenceKey}_index`)
      if (indexData) {
        const index = JSON.parse(indexData)
        this.diskIndex = new Map(Object.entries(index))
      }
      
      // Load pages that should be in memory
      const criticalPages = Array.from(this.diskIndex.entries())
        .filter(([_, metadata]) => metadata.critical)
        .slice(0, Math.floor(this.maxMemoryPages / 2)) // Reserve half memory for critical pages
      
      for (const [pageId, metadata] of criticalPages) {
        const page = await this.loadPageFromDisk(pageId)
        if (page) {
          this.storage.pages.set(pageId, page)
          this.memoryCache.set(pageId, page)
          this.updateAccessOrder(pageId)
          
          // Rebuild page index
          for (const [key] of page.data) {
            this.storage.pageIndex.set(key, pageId)
          }
        }
      }
      
      console.log(`Loaded ${criticalPages.length} critical pages from disk`)
      
    } catch (error) {
      console.error('Error loading from disk:', error)
    }
  }
  
  async loadPageFromDisk(pageId) {
    if (typeof localStorage === 'undefined') return null
    
    try {
      const pageData = localStorage.getItem(`${this.persistenceKey}_page_${pageId}`)
      if (!pageData) return null
      
      const serialized = JSON.parse(pageData)
      return this.deserializePage(serialized)
    } catch (error) {
      console.error(`Error loading page ${pageId} from disk:`, error)
      return null
    }
  }
  
  async savePageToDisk(page) {
    if (typeof localStorage === 'undefined') return
    
    try {
      const serialized = this.serializePage(page)
      const pageData = JSON.stringify(serialized)
      
      localStorage.setItem(`${this.persistenceKey}_page_${page.id}`, pageData)
      
      // Update disk index
      this.diskIndex.set(page.id, {
        size: page.size,
        keyCount: page.data.size,
        lastModified: page.lastModified,
        critical: this.isPageCritical(page),
        diskSize: pageData.length
      })
      
      this.dirtyPages.delete(page.id)
      
    } catch (error) {
      console.error(`Error saving page ${page.id} to disk:`, error)
    }
  }
  
  async saveDirtyPages() {
    if (this.dirtyPages.size === 0) return
    
    console.log(`Saving ${this.dirtyPages.size} dirty pages to disk`)
    
    const savePromises = []
    for (const pageId of this.dirtyPages) {
      const page = this.memoryCache.get(pageId) || this.storage.pages.get(pageId)
      if (page) {
        savePromises.push(this.savePageToDisk(page))
      }
    }
    
    await Promise.allSettled(savePromises)
    
    // Save index
    await this.saveIndex()
    
    this.lastSave = Date.now()
  }
  
  async saveIndex() {
    if (typeof localStorage === 'undefined') return
    
    try {
      const indexObj = Object.fromEntries(this.diskIndex)
      localStorage.setItem(`${this.persistenceKey}_index`, JSON.stringify(indexObj))
    } catch (error) {
      console.error('Error saving index to disk:', error)
    }
  }
  
  // ===== PAGE MANAGEMENT =====
  
  async loadPage(pageId) {
    // Try memory cache first
    let page = this.getFromMemory(pageId)
    if (page) return page
    
    // Try main storage
    page = this.storage.pages.get(pageId)
    if (page) {
      this.putInMemory(page)
      return page
    }
    
    // Try disk
    page = await this.loadPageFromDisk(pageId)
    if (page) {
      this.storage.pages.set(pageId, page)
      this.putInMemory(page)
      
      // Rebuild indexes
      for (const [key] of page.data) {
        this.storage.pageIndex.set(key, pageId)
      }
      
      return page
    }
    
    return null
  }
  
  storePage(page) {
    // Store in main storage
    this.storage.pages.set(page.id, page)
    
    // Store in memory cache
    this.putInMemory(page)
    
    // Update indexes
    for (const [key] of page.data) {
      this.storage.pageIndex.set(key, page.id)
    }
    
    return page
  }
  
  deletePage(pageId) {
    // Remove from memory
    this.memoryCache.delete(pageId)
    
    // Remove from access order
    const index = this.accessOrder.indexOf(pageId)
    if (index > -1) {
      this.accessOrder.splice(index, 1)
    }
    
    // Remove from disk
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(`${this.persistenceKey}_page_${pageId}`)
    }
    
    // Remove from indexes
    this.diskIndex.delete(pageId)
    this.dirtyPages.delete(pageId)
    
    // Remove from main storage
    this.storage.pages.delete(pageId)
  }
  
  markDirty(pageId) {
    this.dirtyPages.add(pageId)
  }
  
  isPageCritical(page) {
    // Pages are critical if they're frequently accessed or recently created
    const recentThreshold = Date.now() - (24 * 60 * 60 * 1000) // 24 hours
    const isRecent = page.created > recentThreshold || page.lastModified > recentThreshold
    
    // Also consider pages with many keys as critical
    const hasMany = page.data.size > 10
    
    return isRecent || hasMany
  }
  
  // ===== SERIALIZATION =====
  
  serializePage(page) {
    return {
      id: page.id,
      data: Object.fromEntries(page.data),
      size: page.size,
      created: page.created,
      lastModified: page.lastModified,
      firstKey: page.firstKey,
      owner: page.owner,
      replicas: Array.from(page.replicas || [])
    }
  }
  
  deserializePage(serialized) {
    return {
      id: serialized.id,
      data: new Map(Object.entries(serialized.data)),
      size: serialized.size,
      created: serialized.created,
      lastModified: serialized.lastModified,
      firstKey: serialized.firstKey,
      owner: serialized.owner,
      replicas: new Set(serialized.replicas || [])
    }
  }
  
  // ===== CACHE MANAGEMENT =====
  
  async preloadPages(pageIds) {
    const loadPromises = pageIds.map(pageId => this.loadPage(pageId))
    const pages = await Promise.allSettled(loadPromises)
    
    return pages
      .filter(result => result.status === 'fulfilled' && result.value)
      .map(result => result.value)
  }
  
  evictPagesForSpace(requiredSpace) {
    let freedSpace = 0
    
    while (freedSpace < requiredSpace && this.accessOrder.length > 0) {
      const pageId = this.accessOrder.shift()
      const page = this.memoryCache.get(pageId)
      
      if (page) {
        freedSpace += page.size
        
        // Save to disk if dirty
        if (this.dirtyPages.has(pageId)) {
          this.savePageToDisk(page)
        }
        
        this.memoryCache.delete(pageId)
        console.log(`Evicted page ${pageId} for space (freed ${page.size} bytes)`)
      }
    }
    
    return freedSpace
  }
  
  // ===== STATISTICS AND MONITORING =====
  
  getCacheStats() {
    return {
      memoryPages: this.memoryCache.size,
      maxMemoryPages: this.maxMemoryPages,
      diskPages: this.diskIndex.size,
      maxDiskPages: this.maxDiskPages,
      dirtyPages: this.dirtyPages.size,
      lastSave: new Date(this.lastSave).toISOString(),
      totalMemorySize: Array.from(this.memoryCache.values()).reduce((sum, page) => sum + page.size, 0),
      accessOrderLength: this.accessOrder.length
    }
  }
  
  getMemoryPressure() {
    return this.memoryCache.size / this.maxMemoryPages
  }
  
  getDiskPressure() {
    return this.diskIndex.size / this.maxDiskPages
  }
  
  // ===== CLEANUP =====
  
  async clearCache() {
    // Save all dirty pages first
    await this.saveDirtyPages()
    
    // Clear memory cache
    this.memoryCache.clear()
    this.accessOrder.length = 0
    this.dirtyPages.clear()
    
    console.log('Cache cleared')
  }
  
  async clearDisk() {
    if (typeof localStorage === 'undefined') return
    
    // Remove all stored pages
    for (const pageId of this.diskIndex.keys()) {
      localStorage.removeItem(`${this.persistenceKey}_page_${pageId}`)
    }
    
    // Remove index
    localStorage.removeItem(`${this.persistenceKey}_index`)
    
    this.diskIndex.clear()
    console.log('Disk storage cleared')
  }
  
  async shutdown() {
    console.log('Shutting down storage persistence...')
    
    // Save all dirty pages
    await this.saveDirtyPages()
    
    // Clear memory to free resources
    this.memoryCache.clear()
    this.accessOrder.length = 0
    this.dirtyPages.clear()
    
    console.log('Storage persistence shutdown complete')
  }
}