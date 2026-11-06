/**
 * PagingStorage System - Main Entry Point
 * A distributed paging storage system for PeerPigeon networks
 * 
 * This system provides:
 * - Distributed key-value storage with automatic page management
 * - Peer-to-peer synchronization and replication
 * - DHT-based consistent hashing for load balancing
 * - LRU caching with persistent storage
 * - Vue.js integration through composables
 * 
 * Based on the Book.js architecture with enhancements for P2P networks.
 */

// Core storage classes
export { PagingStorage } from './PagingStorage.js'
export { PeerSynchronization } from './PeerSynchronization.js'
export { StoragePersistence } from './StoragePersistence.js'
export { ChunkStorage } from './ChunkStorage.js'

// Vue composables
export { usePagingStorage } from './composables/usePagingStorage.js'

// Examples and demos
export * from './examples/PagingStorageExamples.js'

/**
 * Quick Start Guide:
 * 
 * 1. Basic Usage with Vue:
 * ```javascript
 * import { usePeerPigeon } from './composables/usePeerPigeon.js'
 * import { usePagingStorage } from './storage/index.js'
 * 
 * // In a Vue component setup function
 * const { pigeon, connect } = usePeerPigeon()
 * const storage = usePagingStorage()
 * 
 * await connect()
 * await storage.initialize(pigeon.value)
 * 
 * // Store and retrieve data
 * await storage.set('user:123', { name: 'Alice' })
 * const user = await storage.get('user:123')
 * ```
 * 
 * 2. Direct Usage (without Vue):
 * ```javascript
 * import { PagingStorage } from './storage/index.js'
 * 
 * // Assuming you have a PeerPigeon instance
 * const storage = new PagingStorage({
 *   pigeon: pigeonInstance,
 *   pageSize: 4096,
 *   maxCachePages: 100
 * })
 * 
 * await storage.set('key', 'value')
 * const value = await storage.get('key')
 * ```
 * 
 * 3. Configuration Options:
 * ```javascript
 * const storage = usePagingStorage({
 *   pageSize: 8192,          // Page size in bytes (default: 4096)
 *   maxCachePages: 200,      // Max pages in remote cache (default: 100)
 *   maxMemoryPages: 100,     // Max pages in memory (default: 50)
 *   autoConnect: true,       // Auto-connect on mount (default: true)
 *   statsUpdateInterval: 3000 // Stats update frequency (default: 5000)
 * })
 * ```
 */

// Utility functions for common operations
export const StorageUtils = {
  /**
   * Generate a unique key with namespace
   */
  generateKey(namespace, id) {
    return `${namespace}:${id}`
  },
  
  /**
   * Parse a namespaced key
   */
  parseKey(key) {
    const [namespace, ...idParts] = key.split(':')
    return { namespace, id: idParts.join(':') }
  },
  
  /**
   * Estimate storage size for a value
   */
  estimateSize(value) {
    if (typeof value === 'string') return value.length * 2
    if (typeof value === 'number') return 8
    if (typeof value === 'boolean') return 1
    if (value === null || value === undefined) return 0
    return JSON.stringify(value).length * 2
  },
  
  /**
   * Create a storage key from multiple parts
   */
  createKey(...parts) {
    return parts.join(':')
  },
  
  /**
   * Validate a storage key
   */
  isValidKey(key) {
    return typeof key === 'string' && key.length > 0 && key.length < 1000
  }
}

// Constants and configuration defaults
export const StorageConstants = {
  DEFAULT_PAGE_SIZE: 4096,
  DEFAULT_MAX_CACHE_PAGES: 100,
  DEFAULT_MAX_MEMORY_PAGES: 50,
  DEFAULT_REPLICATION_FACTOR: 3,
  DEFAULT_VIRTUAL_NODES: 100,
  DEFAULT_STATS_INTERVAL: 5000,
  DEFAULT_AUTO_SAVE_INTERVAL: 30000,
  
  MESSAGE_TYPES: {
    PAGE_REQUEST: 'page_request',
    PAGE_RESPONSE: 'page_response',
    PAGE_UPDATE: 'page_update',
    PAGE_DELETE: 'page_delete',
    PAGE_LIST: 'page_list',
    PEER_DISCOVERY: 'peer_discovery',
    SYNC_REQUEST: 'sync_request'
  }
}

/**
 * Factory function to create a configured PagingStorage instance
 */
export function createPagingStorage(options = {}) {
  const config = {
    pageSize: StorageConstants.DEFAULT_PAGE_SIZE,
    maxCachePages: StorageConstants.DEFAULT_MAX_CACHE_PAGES,
    ...options
  }
  
  return new PagingStorage(config)
}

/**
 * Factory function to create a Vue composable with preset configuration
 */
export function createStorageComposable(defaultConfig = {}) {
  return function(options = {}) {
    return usePagingStorage({ ...defaultConfig, ...options })
  }
}