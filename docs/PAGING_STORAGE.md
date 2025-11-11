# PagingStorage System for PeerPigeon

A distributed paging storage system built for PeerPigeon networks, based on the Book.js architecture with peer-to-peer capabilities.

## Overview

The PagingStorage system provides a distributed key-value store that automatically manages data across pages, handles peer-to-peer synchronization, and includes sophisticated caching and persistence mechanisms.

### Key Features

- **Distributed Storage**: Automatic data distribution across peer networks
- **Page Management**: Intelligent page splitting and merging based on Book.js principles
- **DHT Routing**: Consistent hashing for efficient data location and load balancing
- **P2P Synchronization**: Real-time data replication across peers
- **LRU Caching**: Memory-efficient caching with automatic eviction
- **Persistent Storage**: Browser localStorage integration with automatic saving
- **Vue.js Integration**: Reactive composables for seamless frontend integration

## Architecture

```
┌─────────────────────┐
│   Vue Components    │
└─────────────────────┘
           │
┌─────────────────────┐
│  usePagingStorage   │  ← Vue Composable
│    (Reactive)       │
└─────────────────────┘
           │
┌─────────────────────┐
│   PagingStorage     │  ← Core Storage Engine
│   (Based on Book)   │
└─────────────────────┘
           │
┌─────┬─────────┬─────────┐
│ DHT │ P2P Sync│Persist. │  ← Support Modules
└─────┴─────────┴─────────┘
           │
┌─────────────────────┐
│    PeerPigeon       │  ← Network Layer
└─────────────────────┘
```

## Quick Start

### 1. Basic Usage with Vue

```vue
<template>
  <div>
    <h3>Storage Demo</h3>
    <p>Status: {{ isReady ? 'Ready' : 'Initializing...' }}</p>
    <p>Connected Peers: {{ peerCount }}</p>
    <p>Total Keys: {{ totalKeys }}</p>
    
    <input v-model="key" placeholder="Key" />
    <input v-model="value" placeholder="Value" />
    <button @click="store" :disabled="!isReady">Store</button>
    <button @click="retrieve" :disabled="!isReady">Get</button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { usePeerPigeon } from './composables/usePeerPigeon.js'
import { usePagingStorage } from './storage/index.js'

const { pigeon, connect } = usePeerPigeon()
const storage = usePagingStorage()

const key = ref('')
const value = ref('')

// Initialize
onMounted(async () => {
  await connect()
  await storage.initialize(pigeon.value)
})

// Store data
const store = async () => {
  if (key.value && value.value) {
    await storage.set(key.value, value.value)
    console.log('Stored:', key.value)
  }
}

// Retrieve data
const retrieve = async () => {
  if (key.value) {
    const result = await storage.get(key.value)
    value.value = JSON.stringify(result)
    console.log('Retrieved:', result)
  }
}

// Reactive properties
const { isReady, peerCount, totalKeys } = storage
</script>
```

### 2. Direct Usage (without Vue)

```javascript
import { PagingStorage } from './storage/index.js'

// Create storage instance
const storage = new PagingStorage({
  pigeon: yourPeerPigeonInstance,
  pageSize: 4096,
  maxCachePages: 100,
  persistence: {
    maxMemoryPages: 50,
    persistenceKey: 'my_app_storage'
  }
})

// Basic operations
await storage.set('user:123', { name: 'Alice', age: 30 })
const user = await storage.get('user:123')
const exists = await storage.has('user:123')
await storage.delete('user:123')

// Batch operations (through sync module)
const entries = [
  ['key1', 'value1'],
  ['key2', 'value2'],
  ['key3', 'value3']
]

// Storage stats
console.log(storage.getStats())
```

## Configuration Options

### PagingStorage Options

```javascript
const storage = new PagingStorage({
  // Core settings
  peerId: 'custom_peer_id',      // Auto-generated if not provided
  pigeon: pigeonInstance,        // PeerPigeon instance (required)
  
  // Page management
  pageSize: 4096,                // Page size in bytes
  maxCachePages: 100,            // Max remote pages to cache
  
  // Thresholds
  splitThreshold: 3276,          // Split pages at 80% capacity
  mergeThreshold: 819,           // Merge pages below 20% capacity
  
  // Persistence options
  persistence: {
    maxMemoryPages: 50,          // Max pages kept in memory
    maxDiskPages: 500,           // Max pages stored on disk
    persistenceKey: 'app_storage', // localStorage key prefix
    autoSaveInterval: 30000      // Auto-save frequency (ms)
  }
})
```

### Vue Composable Options

```javascript
const storage = usePagingStorage({
  // All PagingStorage options, plus:
  autoConnect: true,             // Auto-connect on mount
  statsUpdateInterval: 5000      // Stats update frequency (ms)
})
```

## API Reference

### Core Operations

#### `storage.set(key, value)`
Stores a key-value pair, with DHT-aware routing to appropriate peers.

```javascript
await storage.set('user:123', { name: 'Alice', email: 'alice@example.com' })
```

#### `storage.get(key)`
Retrieves a value by key, checking local storage first, then remote peers.

```javascript
const user = await storage.get('user:123')
// Returns: { name: 'Alice', email: 'alice@example.com' } or undefined
```

#### `storage.has(key)`
Checks if a key exists anywhere in the network.

```javascript
const exists = await storage.has('user:123') // Returns: boolean
```

#### `storage.delete(key)`
Removes a key-value pair from the storage network.

```javascript
const deleted = await storage.delete('user:123') // Returns: boolean
```

### Local Operations (bypass DHT)

#### `storage.setLocal(key, value)`
Stores data only on the local peer.

#### `storage.getLocal(key)`
Retrieves data only from local storage.

#### `storage.deleteLocal(key)`
Deletes data only from local storage.

### Batch Operations (via composable)

#### `storage.setMany(entries)`
Stores multiple key-value pairs.

```javascript
const results = await storage.setMany([
  ['key1', 'value1'],
  ['key2', 'value2']
])
```

#### `storage.getMany(keys)`
Retrieves multiple values by keys.

```javascript
const results = await storage.getMany(['key1', 'key2'])
// Returns: Map with results
```

### Monitoring and Diagnostics

#### `storage.getStats()`
Returns comprehensive storage statistics.

```javascript
const stats = storage.getStats()
console.log({
  totalPages: stats.totalPages,
  totalKeys: stats.totalKeys,
  connectedPeers: stats.connectedPeers,
  cache: stats.cache,
  dht: stats.dht
})
```

#### `storage.listPages()`
Returns information about all local pages.

#### `storage.diagnose()`
Returns detailed diagnostic information (composable only).

### Data Management

#### `storage.exportData()`
Exports all local data as JSON.

```javascript
const backup = storage.exportData()
console.log(`Exported ${backup.totalKeys} keys from ${backup.peerId}`)
```

#### `storage.importData(exportedData)`
Imports data from an export.

```javascript
const results = await storage.importData(backup)
console.log(`Imported ${results.filter(r => r.imported).length} keys`)
```

#### `storage.clearCache()`
Clears the local memory cache.

### Lifecycle

#### `storage.shutdown()`
Cleanly shuts down the storage system.

```javascript
await storage.shutdown()
```

## Examples

### Example 1: User Profile Storage

```javascript
// Store user profile
await storage.set('profile:user123', {
  name: 'John Doe',
  email: 'john@example.com',
  preferences: {
    theme: 'dark',
    notifications: true
  },
  lastLogin: new Date().toISOString()
})

// Retrieve and update
const profile = await storage.get('profile:user123')
profile.lastLogin = new Date().toISOString()
await storage.set('profile:user123', profile)
```

### Example 2: Distributed Configuration

```javascript
// Store application configuration
const config = {
  'app:version': '1.2.3',
  'app:features': ['chat', 'video', 'files'],
  'app:limits': { maxFileSize: 100 * 1024 * 1024 },
  'ui:theme': 'light',
  'ui:language': 'en-US'
}

// Store all config values
for (const [key, value] of Object.entries(config)) {
  await storage.set(key, value)
}

// Retrieve specific config
const theme = await storage.get('ui:theme')
const features = await storage.get('app:features')
```

### Example 3: Real-time Collaboration

```javascript
// Multiple peers can store and sync data
await storage.set('doc:123:title', 'Shared Document')
await storage.set('doc:123:content', 'Document content here...')
await storage.set('doc:123:lastEditor', 'user456')
await storage.set('doc:123:modified', Date.now())

// Other peers will automatically receive updates
// and can read the latest state
const title = await storage.get('doc:123:title')
const content = await storage.get('doc:123:content')
```

## Performance Considerations

### Page Sizing
- **Small pages (1-2KB)**: More network requests, better granularity
- **Large pages (8-16KB)**: Fewer requests, more memory usage
- **Default (4KB)**: Good balance for most applications

### Memory Management
- The system automatically manages memory with LRU eviction
- Adjust `maxMemoryPages` based on available memory
- Monitor `memoryPressure` to detect memory constraints

### Network Efficiency
- Data is automatically replicated to 3 peers by default
- DHT ensures even load distribution
- Local caching reduces network requests

### Storage Persistence
- Data is automatically saved to localStorage
- Dirty pages are saved every 30 seconds by default
- Critical pages are prioritized for memory retention

## Troubleshooting

### Common Issues

#### "Storage not ready" errors
- Ensure PeerPigeon is connected before initializing storage
- Check that `storage.isReady` is true before operations

#### High memory usage
- Reduce `maxMemoryPages` setting
- Check for memory leaks in application code
- Monitor page sizes and split threshold

#### Slow peer synchronization
- Check network connectivity between peers
- Verify PeerPigeon configuration
- Monitor peer connection status

#### Data loss on page reload
- Ensure persistence is enabled
- Check localStorage quota and availability
- Verify auto-save is working (`stats.cache.lastSave`)

### Debugging

Enable debug logging:
```javascript
// In browser console
localStorage.setItem('debug', 'paging-storage:*')
```

Monitor storage statistics:
```javascript
// Check stats regularly
setInterval(() => {
  console.log('Storage Stats:', storage.getStats())
}, 5000)
```

## Browser Compatibility

- **Chrome/Edge**: Full support
- **Firefox**: Full support
- **Safari**: Full support (localStorage only)
- **Mobile browsers**: Limited by storage quotas

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all examples work
5. Submit a pull request

For questions or support, please open an issue in the repository.