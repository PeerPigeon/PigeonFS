/**
 * PagingStorage Demo and Examples
 * Demonstrates how to use the distributed paging storage system with PeerPigeon
 */

import { usePeerPigeon } from '../composables/usePeerPigeon.js'
import { usePagingStorage } from '../composables/usePagingStorage.js'

// Example 1: Basic Storage Operations
export async function basicStorageExample() {
  console.log('=== Basic Storage Operations Example ===')
  
  // Initialize PeerPigeon
  const { pigeon, connect, connectionStatus } = usePeerPigeon()
  await connect()
  
  // Wait for connection
  while (connectionStatus.value !== 'connected') {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  // Initialize paging storage
  const storage = usePagingStorage()
  await storage.initialize(pigeon.value)
  
  try {
    // Store some data
    await storage.set('user:123', { name: 'Alice', age: 30, city: 'New York' })
    await storage.set('user:456', { name: 'Bob', age: 25, city: 'San Francisco' })
    await storage.set('config:theme', 'dark')
    await storage.set('config:language', 'en-US')
    
    console.log('Data stored successfully!')
    
    // Retrieve data
    const user123 = await storage.get('user:123')
    const theme = await storage.get('config:theme')
    
    console.log('Retrieved user:123:', user123)
    console.log('Retrieved theme:', theme)
    
    // Check if keys exist
    const hasUser = await storage.has('user:123')
    const hasNonExistent = await storage.has('user:999')
    
    console.log('user:123 exists:', hasUser)
    console.log('user:999 exists:', hasNonExistent)
    
    // Show storage stats
    console.log('Storage stats:', storage.stats)
    
  } catch (error) {
    console.error('Error in basic storage example:', error)
  } finally {
    await storage.shutdown()
  }
}

// Example 2: Batch Operations
export async function batchOperationsExample() {
  console.log('=== Batch Operations Example ===')
  
  const { pigeon, connect, connectionStatus } = usePeerPigeon()
  await connect()
  
  while (connectionStatus.value !== 'connected') {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  const storage = usePagingStorage()
  await storage.initialize(pigeon.value)
  
  try {
    // Batch set operations
    const entries = [
      ['product:001', { name: 'Laptop', price: 999, category: 'Electronics' }],
      ['product:002', { name: 'Mouse', price: 29, category: 'Electronics' }],
      ['product:003', { name: 'Keyboard', price: 79, category: 'Electronics' }],
      ['product:004', { name: 'Monitor', price: 299, category: 'Electronics' }],
      ['product:005', { name: 'Webcam', price: 89, category: 'Electronics' }]
    ]
    
    console.log('Setting multiple products...')
    const setResults = await storage.setMany(entries)
    console.log('Batch set results:', setResults)
    
    // Batch get operations
    const keys = ['product:001', 'product:003', 'product:005']
    console.log('Getting multiple products...')
    const getResults = await storage.getMany(keys)
    
    for (const [key, value] of getResults) {
      console.log(`${key}:`, value)
    }
    
    console.log(`Successfully stored ${entries.length} products`)
    console.log('Current storage stats:', storage.stats)
    
  } catch (error) {
    console.error('Error in batch operations example:', error)
  } finally {
    await storage.shutdown()
  }
}

// Example 3: Peer-to-Peer Synchronization
export async function peerSyncExample() {
  console.log('=== Peer-to-Peer Synchronization Example ===')
  
  // This would typically involve multiple browser instances
  // For demo purposes, we'll simulate peer behavior
  
  const peer1 = await createPeer('peer1')
  const peer2 = await createPeer('peer2')
  
  try {
    // Peer 1 stores some data
    await peer1.storage.set('shared:message', 'Hello from Peer 1!')
    await peer1.storage.set('shared:counter', 42)
    
    console.log('Peer 1 stored data')
    
    // Wait for synchronization
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Peer 2 tries to read the data
    const message = await peer2.storage.get('shared:message')
    const counter = await peer2.storage.get('shared:counter')
    
    console.log('Peer 2 retrieved message:', message)
    console.log('Peer 2 retrieved counter:', counter)
    
    // Peer 2 updates the data
    await peer2.storage.set('shared:counter', 43)
    await peer2.storage.set('shared:updated_by', 'peer2')
    
    console.log('Peer 2 updated data')
    
    // Wait for synchronization back to Peer 1
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Peer 1 sees the updates
    const updatedCounter = await peer1.storage.get('shared:counter')
    const updatedBy = await peer1.storage.get('shared:updated_by')
    
    console.log('Peer 1 sees updated counter:', updatedCounter)
    console.log('Peer 1 sees updated_by:', updatedBy)
    
    // Show peer statistics
    console.log('Peer 1 connected to', peer1.storage.peerCount.value, 'peers')
    console.log('Peer 2 connected to', peer2.storage.peerCount.value, 'peers')
    
  } catch (error) {
    console.error('Error in peer sync example:', error)
  } finally {
    await peer1.storage.shutdown()
    await peer2.storage.shutdown()
  }
}

// Example 4: Large Dataset and Page Management
export async function pageManagementExample() {
  console.log('=== Page Management Example ===')
  
  const { pigeon, connect, connectionStatus } = usePeerPigeon()
  await connect()
  
  while (connectionStatus.value !== 'connected') {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  const storage = usePagingStorage({
    pageSize: 1024, // Smaller pages for demo
    maxMemoryPages: 5 // Force page eviction
  })
  await storage.initialize(pigeon.value)
  
  try {
    console.log('Storing large dataset to trigger page splitting...')
    
    // Store enough data to trigger multiple page splits
    for (let i = 0; i < 100; i++) {
      const data = {
        id: i,
        name: `Item ${i}`,
        description: `This is a longer description for item ${i} `.repeat(5),
        timestamp: Date.now(),
        metadata: {
          category: `category_${i % 10}`,
          tags: [`tag${i}`, `tag${i + 1}`, `tag${i + 2}`],
          score: Math.random() * 100
        }
      }
      
      await storage.set(`item:${i.toString().padStart(3, '0')}`, data)
      
      if (i % 20 === 0) {
        console.log(`Stored ${i + 1} items`)
        console.log('Current pages:', storage.totalPages.value)
        console.log('Memory pressure:', storage.memoryPressure.value.toFixed(2))
      }
    }
    
    console.log('Dataset storage complete!')
    console.log('Final stats:', storage.stats)
    
    // List all pages
    const pages = storage.listPages()
    console.log('Page distribution:')
    for (const page of pages) {
      console.log(`Page ${page.id}: ${page.keyCount} keys, ${page.size} bytes`)
    }
    
    // Test random access
    console.log('Testing random access...')
    for (let i = 0; i < 10; i++) {
      const randomId = Math.floor(Math.random() * 100)
      const key = `item:${randomId.toString().padStart(3, '0')}`
      const item = await storage.get(key)
      if (item) {
        console.log(`Retrieved ${key}: ${item.name}`)
      }
    }
    
  } catch (error) {
    console.error('Error in page management example:', error)
  } finally {
    await storage.shutdown()
  }
}

// Example 5: Data Export/Import
export async function dataExportImportExample() {
  console.log('=== Data Export/Import Example ===')
  
  // Create source peer
  const sourcePeer = await createPeer('source')
  
  try {
    // Store sample data
    const sampleData = {
      'config:app_version': '1.2.3',
      'config:features': ['feature1', 'feature2', 'feature3'],
      'user:profile': { name: 'Demo User', preferences: { theme: 'dark' } },
      'analytics:visits': 1250,
      'analytics:last_visit': new Date().toISOString()
    }
    
    console.log('Storing sample data...')
    for (const [key, value] of Object.entries(sampleData)) {
      await sourcePeer.storage.set(key, value)
    }
    
    // Export data
    console.log('Exporting data...')
    const exportedData = sourcePeer.storage.exportData()
    console.log('Export summary:', {
      peerId: exportedData.peerId,
      exportedAt: exportedData.exportedAt,
      totalKeys: exportedData.totalKeys
    })
    
    // Create target peer
    const targetPeer = await createPeer('target')
    
    // Import data
    console.log('Importing data to new peer...')
    const importResults = await targetPeer.storage.importData(exportedData)
    
    const successful = importResults.filter(r => r.imported).length
    const failed = importResults.filter(r => !r.imported).length
    
    console.log(`Import complete: ${successful} successful, ${failed} failed`)
    
    // Verify import
    console.log('Verifying imported data...')
    for (const key of Object.keys(sampleData)) {
      const value = await targetPeer.storage.get(key)
      console.log(`${key}:`, value ? '✓' : '✗')
    }
    
    await targetPeer.storage.shutdown()
    
  } catch (error) {
    console.error('Error in export/import example:', error)
  } finally {
    await sourcePeer.storage.shutdown()
  }
}

// Example 6: Diagnostics and Monitoring
export async function diagnosticsExample() {
  console.log('=== Diagnostics and Monitoring Example ===')
  
  const { pigeon, connect, connectionStatus } = usePeerPigeon()
  await connect()
  
  while (connectionStatus.value !== 'connected') {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  const storage = usePagingStorage()
  await storage.initialize(pigeon.value)
  
  try {
    // Store some test data
    await storage.set('test:1', 'value1')
    await storage.set('test:2', 'value2')
    await storage.set('test:3', 'value3')
    
    // Get comprehensive diagnostics
    console.log('System Diagnostics:')
    const diagnostics = storage.diagnose()
    
    console.log('Storage Info:')
    console.log('- Ready:', diagnostics.storage.isReady)
    console.log('- Peer ID:', diagnostics.storage.peerId)
    console.log('- Total Pages:', diagnostics.storage.stats.totalPages)
    console.log('- Total Keys:', diagnostics.storage.stats.totalKeys)
    
    console.log('DHT Info:')
    console.log('- Load Balanced:', diagnostics.dht.loadBalanced)
    console.log('- Hash Ring Size:', diagnostics.dht.hashRing.length)
    
    console.log('Cache Info:')
    console.log('- Memory Pages:', diagnostics.cache.memoryPages)
    console.log('- Disk Pages:', diagnostics.cache.diskPages)
    console.log('- Dirty Pages:', diagnostics.cache.dirtyPages)
    console.log('- Memory Pressure:', storage.memoryPressure.value)
    
    console.log('Peer Info:')
    console.log('- Connected Peers:', diagnostics.peers.length)
    
    // Monitor stats changes
    console.log('Monitoring stats for 10 seconds...')
    const monitoringEnd = Date.now() + 10000
    
    while (Date.now() < monitoringEnd) {
      storage.updateStats()
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      console.log('Stats update:', {
        pages: storage.totalPages.value,
        keys: storage.totalKeys.value,
        peers: storage.peerCount.value,
        memPressure: storage.memoryPressure.value.toFixed(2)
      })
    }
    
  } catch (error) {
    console.error('Error in diagnostics example:', error)
  } finally {
    await storage.shutdown()
  }
}

// Helper function to create a peer with PeerPigeon and PagingStorage
async function createPeer(peerId) {
  const { pigeon, connect, connectionStatus } = usePeerPigeon()
  await connect()
  
  while (connectionStatus.value !== 'connected') {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  
  const storage = usePagingStorage()
  await storage.initialize(pigeon.value)
  
  return { pigeon, storage }
}

// Run all examples
export async function runAllExamples() {
  console.log('🚀 Starting PagingStorage Examples...')
  
  try {
    await basicStorageExample()
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    await batchOperationsExample()
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    await pageManagementExample()
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    await dataExportImportExample()
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    await diagnosticsExample()
    
    // Note: peerSyncExample requires multiple browser instances
    console.log('✅ All examples completed!')
    
  } catch (error) {
    console.error('❌ Error running examples:', error)
  }
}

// Example usage in a Vue component
export const ExampleComponent = {
  template: `
    <div class="paging-storage-demo">
      <h2>PagingStorage Demo</h2>
      
      <div class="status">
        <p>Status: {{ isReady ? 'Ready' : 'Not Ready' }}</p>
        <p>Peers: {{ peerCount }}</p>
        <p>Pages: {{ totalPages }}</p>
        <p>Keys: {{ totalKeys }}</p>
        <p>Memory Pressure: {{ (memoryPressure * 100).toFixed(1) }}%</p>
      </div>
      
      <div class="operations">
        <input v-model="testKey" placeholder="Key" />
        <input v-model="testValue" placeholder="Value" />
        <button @click="storeValue" :disabled="!isReady">Store</button>
        <button @click="getValue" :disabled="!isReady">Get</button>
        <button @click="deleteValue" :disabled="!isReady">Delete</button>
      </div>
      
      <div class="examples">
        <button @click="runBasicExample">Basic Example</button>
        <button @click="runBatchExample">Batch Example</button>
        <button @click="runPageExample">Page Example</button>
      </div>
      
      <pre>{{ JSON.stringify(diagnostics, null, 2) }}</pre>
    </div>
  `,
  
  setup() {
    const { pigeon, connect } = usePeerPigeon()
    const storage = usePagingStorage()
    
    const testKey = ref('')
    const testValue = ref('')
    const diagnostics = ref({})
    
    const initialize = async () => {
      await connect()
      await storage.initialize(pigeon.value)
      updateDiagnostics()
    }
    
    const updateDiagnostics = () => {
      if (storage.isReady.value) {
        diagnostics.value = storage.diagnose()
      }
    }
    
    const storeValue = async () => {
      if (testKey.value && testValue.value) {
        await storage.set(testKey.value, testValue.value)
        updateDiagnostics()
      }
    }
    
    const getValue = async () => {
      if (testKey.value) {
        const value = await storage.get(testKey.value)
        testValue.value = JSON.stringify(value)
        updateDiagnostics()
      }
    }
    
    const deleteValue = async () => {
      if (testKey.value) {
        await storage.remove(testKey.value)
        testValue.value = ''
        updateDiagnostics()
      }
    }
    
    onMounted(initialize)
    
    return {
      // Storage state
      isReady: storage.isReady,
      peerCount: storage.peerCount,
      totalPages: storage.totalPages,
      totalKeys: storage.totalKeys,
      memoryPressure: storage.memoryPressure,
      
      // Form data
      testKey,
      testValue,
      diagnostics,
      
      // Methods
      storeValue,
      getValue,
      deleteValue,
      runBasicExample: basicStorageExample,
      runBatchExample: batchOperationsExample,
      runPageExample: pageManagementExample
    }
  }
}