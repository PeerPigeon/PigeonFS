// IndexedDB storage for searchable datasets (Bible, dictionaries, encyclopedias, etc.)

const DB_NAME = 'PigeonFS_Data'
const DB_VERSION = 1
const STORE_DATASETS = 'datasets'
const STORE_INDEXES = 'indexes'
const STORE_CACHE = 'cache'

// Open or create the IndexedDB database
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result
      
      // Create object stores if they don't exist
      if (!db.objectStoreNames.contains(STORE_DATASETS)) {
        db.createObjectStore(STORE_DATASETS) // key: datasetId
      }
      if (!db.objectStoreNames.contains(STORE_INDEXES)) {
        db.createObjectStore(STORE_INDEXES) // key: datasetId
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        // Cache store with compound keys: datasetId + itemKey
        db.createObjectStore(STORE_CACHE, { keyPath: 'id', autoIncrement: true })
      }
    }
  })
}

// Save full dataset data
export const saveDataset = async (datasetId, data) => {
  console.log(`🔍 saveDataset called: datasetId="${datasetId}", data.length=${data?.length}`)
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DATASETS, 'readwrite')
    const store = tx.objectStore(STORE_DATASETS)
    const request = store.put(data, datasetId)
    
    request.onsuccess = () => {
      console.log(`💾 ✅ Saved dataset "${datasetId}" to IndexedDB:`, data.length || Object.keys(data).length, 'items')
      resolve()
    }
    request.onerror = () => {
      console.error(`💾 ❌ Failed to save dataset "${datasetId}":`, request.error)
      reject(request.error)
    }
  })
}

// Load full dataset data
export const loadDataset = async (datasetId) => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_DATASETS, 'readonly')
    const store = tx.objectStore(STORE_DATASETS)
    const request = store.get(datasetId)
    
    request.onsuccess = () => {
      if (request.result) {
        console.log(`💾 Loaded dataset "${datasetId}" from IndexedDB:`, request.result.length || Object.keys(request.result).length, 'items')
      }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })
}

// Save dataset index
export const saveDatasetIndex = async (datasetId, index) => {
  console.log(`🔍 saveDatasetIndex called: datasetId="${datasetId}", index keys=${Object.keys(index).length}`)
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_INDEXES, 'readwrite')
    const store = tx.objectStore(STORE_INDEXES)
    const request = store.put(index, datasetId)
    
    request.onsuccess = () => {
      console.log(`💾 ✅ Saved index for "${datasetId}" to IndexedDB:`, Object.keys(index).length, 'keys')
      resolve()
    }
    request.onerror = () => {
      console.error(`💾 ❌ Failed to save index for "${datasetId}":`, request.error)
      reject(request.error)
    }
  })
}

// Load dataset index
export const loadDatasetIndex = async (datasetId) => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_INDEXES, 'readonly')
    const store = tx.objectStore(STORE_INDEXES)
    const request = store.get(datasetId)
    
    request.onsuccess = () => {
      if (request.result) {
        console.log(`💾 Loaded index for "${datasetId}" from IndexedDB:`, Object.keys(request.result).length, 'keys')
      }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error)
  })
}

// Save cached item (from peer)
export const saveCachedItem = async (datasetId, item) => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CACHE, 'readwrite')
    const store = tx.objectStore(STORE_CACHE)
    const request = store.add({
      datasetId,
      ...item,
      cachedAt: Date.now()
    })
    
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

// Load all cached items for a dataset
export const loadCachedItems = async (datasetId) => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CACHE, 'readonly')
    const store = tx.objectStore(STORE_CACHE)
    const request = store.getAll()
    
    request.onsuccess = () => {
      const items = request.result.filter(item => item.datasetId === datasetId)
      console.log(`💾 Loaded ${items.length} cached items for "${datasetId}" from IndexedDB`)
      resolve(items)
    }
    request.onerror = () => reject(request.error)
  })
}

// Get cache statistics for a dataset
export const getCacheStats = async (datasetId) => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CACHE, 'readonly')
    const store = tx.objectStore(STORE_CACHE)
    const request = store.getAll()
    
    request.onsuccess = () => {
      const items = request.result.filter(item => item.datasetId === datasetId)
      resolve({ cachedItems: items.length })
    }
    request.onerror = () => reject(request.error)
  })
}

// Clear all data for a specific dataset
export const clearDataset = async (datasetId) => {
  const db = await openDB()
  return new Promise(async (resolve, reject) => {
    try {
      const tx = db.transaction([STORE_DATASETS, STORE_INDEXES, STORE_CACHE], 'readwrite')
      
      tx.objectStore(STORE_DATASETS).delete(datasetId)
      tx.objectStore(STORE_INDEXES).delete(datasetId)
      
      // Clear cache items for this dataset
      const cacheStore = tx.objectStore(STORE_CACHE)
      const allItems = await new Promise((res, rej) => {
        const req = cacheStore.getAll()
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      })
      
      allItems.forEach(item => {
        if (item.datasetId === datasetId) {
          cacheStore.delete(item.id)
        }
      })
      
      tx.oncomplete = () => {
        console.log(`💾 Cleared dataset "${datasetId}" from storage`)
        resolve()
      }
      tx.onerror = () => reject(tx.error)
    } catch (err) {
      reject(err)
    }
  })
}

// Clear ALL data storage
export const clearAllStorage = async () => {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE_DATASETS, STORE_INDEXES, STORE_CACHE], 'readwrite')
    
    tx.objectStore(STORE_DATASETS).clear()
    tx.objectStore(STORE_INDEXES).clear()
    tx.objectStore(STORE_CACHE).clear()
    
    tx.oncomplete = () => {
      console.log('💾 Cleared all data storage')
      resolve()
    }
    tx.onerror = () => reject(tx.error)
  })
}
