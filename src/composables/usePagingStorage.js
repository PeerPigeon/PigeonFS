/**
 * usePagingStorage - Vue composable for distributed paging storage
 * Integrates PagingStorage with PeerPigeon for seamless distributed storage
 */

import { ref, reactive, computed, onMounted, onUnmounted, markRaw } from 'vue'
import { PagingStorage } from '../storage/PagingStorage.js'

export function usePagingStorage(options = {}) {
  // Reactive state
  const storage = ref(null)
  const isInitialized = ref(false)
  const isConnecting = ref(false)
  const error = ref(null)
  const stats = reactive({})
  const peers = reactive(new Map())
  
  // Configuration
  const config = {
    pageSize: options.pageSize || 4096,
    maxCachePages: options.maxCachePages || 100,
    maxMemoryPages: options.maxMemoryPages || 50,
    autoConnect: options.autoConnect !== false,
    statsUpdateInterval: options.statsUpdateInterval || 5000,
    ...options
  }
  
  // Computed properties
  const isReady = computed(() => isInitialized.value && !error.value)
  const peerCount = computed(() => peers.size)
  const totalPages = computed(() => stats.totalPages || 0)
  const totalKeys = computed(() => stats.totalKeys || 0)
  const memoryPressure = computed(() => stats.dht?.memoryPressure || 0)
  const isLoadBalanced = computed(() => stats.dht?.isLoadBalanced || false)
  
  // Initialize storage system
  const initialize = async (pigeonInstance) => {
    try {
      isConnecting.value = true
      error.value = null
      
      if (!pigeonInstance) {
        throw new Error('PeerPigeon instance is required')
      }
      
      console.log('Initializing PagingStorage with PeerPigeon...')
      
      // Create storage instance
      storage.value = markRaw(new PagingStorage({
        pigeon: pigeonInstance,
        peerId: pigeonInstance.peerId || `peer_${Date.now()}`,
        pageSize: config.pageSize,
        maxCachePages: config.maxCachePages,
        persistence: {
          maxMemoryPages: config.maxMemoryPages,
          persistenceKey: `pigeonfs_${pigeonInstance.peerId || 'default'}`
        }
      }))
      
      // Set up event handlers
      setupEventHandlers(pigeonInstance)
      
      isInitialized.value = true
      console.log('PagingStorage initialized successfully')
      
      // Start stats updates
      startStatsUpdates()
      
    } catch (err) {
      console.error('Failed to initialize PagingStorage:', err)
      error.value = err.message
    } finally {
      isConnecting.value = false
    }
  }
  
  // Set up event handlers for PeerPigeon
  const setupEventHandlers = (pigeonInstance) => {
    pigeonInstance.on('peer-connected', (peerId, peerInfo) => {
      console.log(`Peer connected to storage: ${peerId}`)
      peers.set(peerId, {
        id: peerId,
        connectedAt: Date.now(),
        ...peerInfo
      })
    })
    
    pigeonInstance.on('peer-disconnected', (peerId) => {
      console.log(`Peer disconnected from storage: ${peerId}`)
      peers.delete(peerId)
    })
    
    pigeonInstance.on('statusChanged', (data) => {
      if (data.type === 'connected') {
        console.log('PeerPigeon connected - storage ready for peer operations')
      }
    })
  }
  
  // Start periodic stats updates
  let statsInterval = null
  const startStatsUpdates = () => {
    if (statsInterval) clearInterval(statsInterval)
    
    statsInterval = setInterval(() => {
      if (storage.value && isReady.value) {
        updateStats()
      }
    }, config.statsUpdateInterval)
  }
  
  const updateStats = () => {
    try {
      const newStats = storage.value.getStats()
      Object.assign(stats, newStats)
    } catch (err) {
      console.error('Error updating stats:', err)
    }
  }
  
  // Storage operations with error handling
  const set = async (key, value) => {
    if (!isReady.value) {
      throw new Error('Storage not ready')
    }
    
    try {
      await storage.value.set(key, value)
      console.log(`Stored: ${key}`)
      return true
    } catch (err) {
      console.error(`Error storing ${key}:`, err)
      throw err
    }
  }
  
  const get = async (key) => {
    if (!isReady.value) {
      throw new Error('Storage not ready')
    }
    
    try {
      const value = await storage.value.get(key)
      if (value !== undefined) {
        console.log(`Retrieved: ${key}`)
      }
      return value
    } catch (err) {
      console.error(`Error retrieving ${key}:`, err)
      throw err
    }
  }
  
  const has = async (key) => {
    if (!isReady.value) {
      return false
    }
    
    try {
      return await storage.value.has(key)
    } catch (err) {
      console.error(`Error checking ${key}:`, err)
      return false
    }
  }
  
  const remove = async (key) => {
    if (!isReady.value) {
      throw new Error('Storage not ready')
    }
    
    try {
      const deleted = await storage.value.delete(key)
      if (deleted) {
        console.log(`Deleted: ${key}`)
      }
      return deleted
    } catch (err) {
      console.error(`Error deleting ${key}:`, err)
      throw err
    }
  }
  
  // Batch operations
  const setMany = async (entries) => {
    if (!isReady.value) {
      throw new Error('Storage not ready')
    }
    
    const results = []
    for (const [key, value] of entries) {
      try {
        await set(key, value)
        results.push({ key, success: true })
      } catch (err) {
        results.push({ key, success: false, error: err.message })
      }
    }
    return results
  }
  
  const getMany = async (keys) => {
    if (!isReady.value) {
      throw new Error('Storage not ready')
    }
    
    const results = new Map()
    for (const key of keys) {
      try {
        const value = await get(key)
        results.set(key, value)
      } catch (err) {
        console.error(`Error in batch get for ${key}:`, err)
        results.set(key, undefined)
      }
    }
    return results
  }
  
  // Advanced operations
  const listPages = () => {
    if (!isReady.value) return []
    return storage.value.listPages()
  }
  
  const getLoadBalanceInfo = () => {
    if (!isReady.value) return null
    return storage.value.dht.getLoadBalanceStats()
  }
  
  const getPeerDistribution = () => {
    if (!isReady.value) return null
    return storage.value.dht.getPeerDistribution()
  }
  
  const clearCache = async () => {
    if (!isReady.value) return
    await storage.value.persistence.clearCache()
  }
  
  const exportData = () => {
    if (!isReady.value) return null
    
    const pages = storage.value.listPages()
    const data = {}
    
    // Export all local data
    for (const page of pages) {
      const localPage = storage.value.pages.get(page.id)
      if (localPage) {
        for (const [key, value] of localPage.data) {
          data[key] = value
        }
      }
    }
    
    return {
      peerId: storage.value.peerId,
      exportedAt: new Date().toISOString(),
      totalKeys: Object.keys(data).length,
      data
    }
  }
  
  const importData = async (exportedData) => {
    if (!isReady.value) {
      throw new Error('Storage not ready')
    }
    
    const { data } = exportedData
    const results = []
    
    for (const [key, value] of Object.entries(data)) {
      try {
        await set(key, value)
        results.push({ key, imported: true })
      } catch (err) {
        results.push({ key, imported: false, error: err.message })
      }
    }
    
    return results
  }
  
  // Diagnostic and debugging
  const diagnose = () => {
    if (!isReady.value) return null
    
    return {
      storage: {
        isReady: isReady.value,
        peerId: storage.value.peerId,
        stats: stats,
        pages: listPages()
      },
      peers: Array.from(peers.entries()),
      dht: {
        hashRing: storage.value.dht.getHashRingInfo(),
        distribution: getPeerDistribution(),
        loadBalanced: isLoadBalanced.value
      },
      cache: stats.cache
    }
  }
  
  // Cleanup
  const shutdown = async () => {
    if (statsInterval) {
      clearInterval(statsInterval)
      statsInterval = null
    }
    
    if (storage.value) {
      await storage.value.shutdown()
      storage.value = null
    }
    
    isInitialized.value = false
    peers.clear()
    Object.keys(stats).forEach(key => delete stats[key])
    
    console.log('PagingStorage shutdown complete')
  }
  
  // Lifecycle hooks
  onMounted(() => {
    if (config.autoConnect && window.PeerPigeon) {
      console.log('Auto-connecting to PeerPigeon on mount...')
      // Note: In real usage, you'd get the pigeon instance from usePeerPigeon
    }
  })
  
  onUnmounted(async () => {
    await shutdown()
  })
  
  // Return the composable API
  return {
    // State
    storage: readonly(storage),
    isInitialized: readonly(isInitialized),
    isConnecting: readonly(isConnecting),
    isReady,
    error: readonly(error),
    stats: readonly(stats),
    peers: readonly(peers),
    
    // Computed
    peerCount,
    totalPages,
    totalKeys,
    memoryPressure,
    isLoadBalanced,
    
    // Core operations
    initialize,
    set,
    get,
    has,
    remove,
    
    // Batch operations
    setMany,
    getMany,
    
    // Advanced operations
    listPages,
    getLoadBalanceInfo,
    getPeerDistribution,
    clearCache,
    exportData,
    importData,
    
    // Diagnostics
    diagnose,
    updateStats,
    
    // Lifecycle
    shutdown
  }
}

// Helper function to create a readonly reactive reference
function readonly(ref) {
  return computed(() => ref.value)
}