# Chunk Storage Quick Reference

## Overview

The ChunkStorage system organizes files and chunks by chunk IDs with platform-specific strategies:

- **Browser peers**: Store only chunks based on peer ID and chunk ID closeness (DHT proximity)
- **Node/App peers**: Check available quota space, use 10% for chunks and whole files if they fit
- **All peers**: Index by filename hash for efficient lookups

## Key Concepts

### Chunk Organization
```javascript
// Chunks organized by chunk ID
chunkId = hash(fileHash + ":" + chunkIndex)

// Browser peers: Store only if responsible (DHT-based)
shouldStore = isPeerInTop3Closest(chunkId, peerId)

// Node peers: Store if space available in 10% quota
shouldStore = (storageUsed + chunkSize) <= (totalQuota * 0.1)
```

### Filename Hash Indexing
```javascript
// Case-insensitive hash
filenameHash = hash(filename.toLowerCase())

// File hash includes size and timestamp
fileHash = hash(filename + ":" + size + ":" + timestamp)

// Quick lookup
filenameHashIndex: Map<filenameHash, fileHash>
```

## Quick Start

```javascript
import { PagingStorage } from './storage/PagingStorage.js'

// Initialize with pigeon instance
const storage = new PagingStorage({
  pigeon: pigeonInstance,
  peerId: pigeonInstance.peerId,
  chunks: {
    chunkSize: 64 * 1024,           // 64KB chunks
    storageQuota: 100 * 1024 * 1024  // 100MB quota
  }
})

// Store file
const result = await storage.storeFile('video.mp4', fileData, {
  mimeType: 'video/mp4',
  timestamp: Date.now()
})

// Get file
const file = await storage.getFile('video.mp4')

// Get stats
const stats = storage.chunks.getStats()
```

## Storage Strategies

### Browser Peer (DHT-Based)
```javascript
// Automatic detection
mode: 'browser'

// Only store responsible chunks
for (chunk in fileChunks) {
  if (isPeerResponsible(chunkId)) {
    storeChunk(chunk)
  }
}

// Result: Stores ~33% of chunks (1 of 3 replicas)
```

### Node/App Peer (10% Quota)
```javascript
// Automatic detection
mode: 'node'

// Calculate available space
availableForChunks = totalQuota * 0.1

// Store whole files if they fit
if (fileSize <= availableSpace) {
  storeWholeFile(file)
} else {
  storeAsChunks(file)
}
```

## API Reference

### Store File
```javascript
await storage.storeFile(filename, data, metadata)
// Returns: { fileHash, type, size, totalChunks, storedChunks }
```

### Get File
```javascript
await storage.getFile(filenameOrHash)
// Returns: { data, metadata, type }
```

### Store Chunk
```javascript
await storage.storeChunk(chunkId, chunkData, metadata)
// Returns: true if stored, false if not responsible
```

### Get Chunk
```javascript
await storage.getChunk(chunkId)
// Returns: Uint8Array or null
```

### Find by Filename
```javascript
await storage.findFileByFilename(filename)
// Returns: fileHash or null
```

### List Files
```javascript
await storage.listFiles()
// Returns: [{ fileHash, filename, size, type, ... }]
```

### Get Stats
```javascript
storage.chunks.getStats()
// Returns: { mode, totalChunks, totalFiles, storageUsed, quota, ... }
```

## Data Structures

### Chunks Map
```javascript
chunks: Map<chunkId, Uint8Array>
// chunkId -> chunk data
```

### Chunk Metadata
```javascript
chunkMetadata: Map<chunkId, {
  fileHash: number,
  filename: string,
  chunkIndex: number,
  size: number,
  stored: timestamp,
  accessed: timestamp,
  proximity: number  // For browser peers
}>
```

### File Chunks Map
```javascript
fileChunks: Map<fileHash, Set<chunkId>>
// fileHash -> Set of chunk IDs
```

### Whole Files Map
```javascript
wholeFiles: Map<fileHash, {
  filename: string,
  data: Uint8Array,
  size: number,
  metadata: object,
  stored: timestamp,
  accessed: timestamp,
  type: 'whole'
}>
```

### Filename Hash Index
```javascript
filenameHashIndex: Map<filenameHash, fileHash>
// Quick lookup by filename
```

## Platform Detection

```javascript
// Browser detection
isBrowser = typeof window !== 'undefined' && typeof process === 'undefined'

// Node detection
isNode = typeof process !== 'undefined' && process.versions && process.versions.node
```

## Default Quotas

```javascript
// Browser
defaultQuota = 50 * 1024 * 1024  // 50MB

// Node
defaultQuota = 10 * 1024 * 1024 * 1024  // 10GB

// Available for chunks (node)
availableForChunks = defaultQuota * 0.1  // 10%
```

## DHT Integration

### Chunk Responsibility
```javascript
// Find responsible peers for chunk
responsiblePeers = dht.findPeersForKey(chunkId, 3)

// Check if current peer should store
shouldStore = responsiblePeers.includes(peerId)
```

### Chunk Proximity
```javascript
// Calculate XOR distance
chunkHash = dht.hash(chunkId)
peerHash = dht.hash(peerId)
proximity = Math.abs(chunkHash - peerHash)

// Lower proximity = closer = more responsible
```

## Eviction Strategy

### LRU Eviction
```javascript
// Sort by access time
chunks.sort((a, b) => a.accessed - b.accessed)

// Evict oldest until enough space
while (freedSpace < requiredSpace) {
  evictOldestChunk()
}
```

### Age-Based Cleanup
```javascript
// Remove chunks older than maxChunkAge (default 7 days)
for (chunk in chunks) {
  if (now - chunk.accessed > maxChunkAge) {
    deleteChunk(chunk)
  }
}
```

## Performance Tips

1. **Chunk Size**: 64KB is optimal for most use cases
2. **Monitor Usage**: Check stats regularly, clean up at 80%
3. **Preload**: Use whole file storage for frequently accessed files
4. **Metadata**: Keep metadata small to reduce overhead

## Error Handling

```javascript
try {
  await storage.storeFile(filename, data)
} catch (error) {
  if (error.message.includes('quota')) {
    // Clean up old chunks
    await storage.chunks.cleanupOldChunks()
  }
}
```

## Integration Points

### PagingStorage
```javascript
storage.chunks.storeFile(...)
storage.chunks.getFile(...)
storage.chunks.getStats()
```

### PeerSynchronization
```javascript
sync.requestChunkFromPeer(peerId, chunkId)
sync.handleChunkRequest(data, fromPeerId)
sync.handleChunkResponse(data, fromPeerId)
```

### DistributedHashTable
```javascript
dht.hash(input)
dht.findPeersForKey(key, count)
```

## Testing

```javascript
// Run examples
import { runAllChunkExamples } from './examples/ChunkStorageExamples.js'
await runAllChunkExamples(pigeonInstance)

// Individual tests
import { 
  basicFileStorageExample,
  browserPeerExample,
  nodePeerExample,
  filenameHashExample,
  chunkEvictionExample
} from './examples/ChunkStorageExamples.js'
```

## See Also

- [CHUNK_STORAGE.md](./CHUNK_STORAGE.md) - Full documentation
- [PAGING_STORAGE.md](./PAGING_STORAGE.md) - Core storage
- [P2P_ARCHITECTURE.md](./P2P_ARCHITECTURE.md) - Architecture
