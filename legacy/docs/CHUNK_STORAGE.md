# Chunk Storage System

## Overview

The ChunkStorage system provides intelligent file chunking and distributed storage for PigeonFS. It implements different storage strategies based on peer type (browser vs node/app) and organizes chunks by chunk IDs for efficient DHT-based distribution.

## Key Features

### 🌐 Platform-Aware Storage
- **Browser Peers**: Store only chunks they're responsible for based on DHT proximity
- **Node/App Peers**: Use 10% of available quota for files and chunks
- **Automatic Detection**: Platform detection happens automatically

### 🧩 Intelligent Chunking
- **Chunk Size**: Configurable (default 64KB)
- **Whole File Storage**: Small files stored as complete files (node peers only)
- **Chunked Storage**: Large files automatically split into chunks
- **DHT-Based Distribution**: Chunks distributed based on consistent hashing

### 🔍 Filename Hash Indexing
- **Case-Insensitive**: Normalized filename hashing
- **Fast Lookups**: O(1) lookup by filename
- **Collision Resistant**: Includes size and timestamp in file hash

### 💾 Quota Management
- **Browser Default**: 50MB quota
- **Node Default**: 10GB quota
- **10% Rule**: Node peers use only 10% of quota for chunks/files
- **Automatic Eviction**: LRU-based chunk eviction when quota reached

## Architecture

```
┌─────────────────────────────────────────────┐
│           PagingStorage                      │
│  ┌────────────────────────────────────┐     │
│  │       ChunkStorage                  │     │
│  │  ┌──────────────┐  ┌─────────────┐ │     │
│  │  │   Chunks     │  │ Whole Files │ │     │
│  │  │  (Map)       │  │   (Map)     │ │     │
│  │  └──────────────┘  └─────────────┘ │     │
│  │  ┌──────────────────────────────┐  │     │
│  │  │   Filename Hash Index        │  │     │
│  │  └──────────────────────────────┘  │     │
│  └────────────────────────────────────┘     │
│           ↓                ↓                 │
│    ┌──────────┐     ┌────────────┐          │
│    │   DHT    │     │ PeerSync   │          │
│    └──────────┘     └────────────┘          │
└─────────────────────────────────────────────┘
```

## Usage

### Basic File Storage

```javascript
import { PagingStorage } from './storage/PagingStorage.js'

const storage = new PagingStorage({
  pigeon: pigeonInstance,
  peerId: pigeonInstance.peerId,
  chunks: {
    chunkSize: 64 * 1024,        // 64KB chunks
    storageQuota: 100 * 1024 * 1024  // 100MB quota
  }
})

// Store a file
const fileData = new Uint8Array(5 * 1024 * 1024) // 5MB file
const result = await storage.storeFile('video.mp4', fileData, {
  mimeType: 'video/mp4',
  timestamp: Date.now()
})

console.log(result)
// {
//   fileHash: 1234567890,
//   type: 'chunked',
//   totalChunks: 80,
//   storedChunks: 27,  // Browser peer only stores responsible chunks
//   filename: 'video.mp4'
// }

// Retrieve the file
const file = await storage.getFile('video.mp4')
console.log(file.data.length) // 5 * 1024 * 1024
```

### Browser Peer Storage

Browser peers automatically store only chunks they're responsible for:

```javascript
const storage = new PagingStorage({ 
  pigeon, 
  peerId: pigeon.peerId 
})

// Store file - only responsible chunks are stored
const result = await storage.storeFile('large-file.dat', data)

console.log(`Stored ${result.storedChunks}/${result.totalChunks} chunks`)
// Example: "Stored 15/100 chunks"

// Retrieve file - fetches missing chunks from peers
const file = await storage.getFile('large-file.dat')
// Automatically requests missing chunks from responsible peers
```

### Node Peer Storage (10% Quota)

Node peers use 10% of available quota and can store whole files:

```javascript
const storage = new PagingStorage({
  pigeon,
  peerId: pigeon.peerId,
  chunks: {
    storageQuota: 10 * 1024 * 1024 * 1024  // 10GB total
  }
})

const available = await storage.chunks.getAvailableChunkStorage()
console.log(available) // 1GB (10% of 10GB)

// Small files stored whole
const smallFile = new Uint8Array(500 * 1024) // 500KB
const result1 = await storage.storeFile('doc.pdf', smallFile)
console.log(result1.type) // 'whole'

// Large files chunked
const largeFile = new Uint8Array(50 * 1024 * 1024) // 50MB
const result2 = await storage.storeFile('video.mp4', largeFile)
console.log(result2.type) // 'chunked'
```

### Filename Hash Indexing

Files are indexed by filename hash for fast lookups:

```javascript
// Store file
await storage.storeFile('Document.pdf', data)

// Case-insensitive lookup
const hash1 = await storage.findFileByFilename('document.pdf')
const hash2 = await storage.findFileByFilename('DOCUMENT.PDF')
console.log(hash1 === hash2) // true

// Retrieve by any case variation
const file = await storage.getFile('DOCUMENT.pdf')
```

### Chunk Management

Direct chunk operations:

```javascript
// Store a specific chunk
const chunkId = storage.chunks.generateChunkId(fileHash, 0)
const chunkData = new Uint8Array(64 * 1024)
await storage.storeChunk(chunkId, chunkData, {
  fileHash: fileHash,
  filename: 'example.dat',
  chunkIndex: 0
})

// Get a specific chunk
const chunk = await storage.getChunk(chunkId)

// Check if peer should store chunk (browser peers)
const shouldStore = storage.chunks.shouldStoreChunk(chunkId)
console.log(shouldStore) // true/false based on DHT proximity
```

### Storage Statistics

```javascript
const stats = storage.chunks.getStats()
console.log(stats)
// {
//   mode: 'browser',          // or 'node'
//   totalChunks: 150,
//   totalFiles: 5,
//   storageUsed: 9830400,     // bytes
//   quota: 52428800,          // 50MB
//   available: 42598400,
//   usagePercent: '18.75',
//   responsibleChunks: 45,    // browser peers only
//   wholeFiles: 2             // node peers only
// }
```

### List Files

```javascript
const files = await storage.listFiles()
console.log(files)
// [
//   {
//     fileHash: 1234567890,
//     filename: 'video.mp4',
//     size: 5242880,
//     type: 'whole',
//     stored: 1699999999999,
//     accessed: 1700000000000
//   },
//   {
//     fileHash: 9876543210,
//     filename: 'large-file.dat',
//     totalChunks: 100,
//     type: 'chunked',
//     stored: 1699999999999,
//     accessed: 1700000000000
//   }
// ]
```

## Chunk Distribution Strategy

### Browser Peers

Browser peers use DHT-based chunk responsibility:

1. **Calculate Proximity**: XOR distance between chunk ID and peer ID
2. **Top 3 Responsible**: Each chunk stored by 3 closest peers
3. **Selective Storage**: Only store chunks peer is responsible for
4. **Distributed Load**: Automatic load balancing across peers

```javascript
// Chunk responsibility is automatic
const chunkId = storage.chunks.generateChunkId(fileHash, 5)
const shouldStore = storage.chunks.shouldStoreChunk(chunkId)

if (shouldStore) {
  // This peer is in the top 3 closest peers for this chunk
  const proximity = storage.chunks.getChunkProximity(chunkId)
  console.log(`Proximity score: ${proximity}`)
}
```

### Node/App Peers

Node peers have more flexible storage:

1. **10% Quota**: Use only 10% of available quota
2. **Whole File Preference**: Store small files completely
3. **Chunk Large Files**: Split large files into chunks
4. **Store All Chunks**: Can store any chunks (not just responsible)

## Configuration Options

```javascript
const storage = new PagingStorage({
  pigeon: pigeonInstance,
  peerId: pigeonInstance.peerId,
  chunks: {
    // Chunk size in bytes (default: 64KB)
    chunkSize: 64 * 1024,
    
    // Total storage quota (default: 50MB browser, 10GB node)
    storageQuota: 100 * 1024 * 1024,
    
    // Max age for chunks before cleanup (default: 7 days)
    maxChunkAge: 7 * 24 * 60 * 60 * 1000
  }
})
```

## Cleanup and Eviction

### LRU Eviction

When storage quota is reached, chunks are evicted using LRU (Least Recently Used):

```javascript
// Automatic eviction happens when storing new chunks
await storage.storeChunk(chunkId, largeChunkData)
// Oldest chunks automatically evicted to make space
```

### Manual Cleanup

Remove old chunks based on age:

```javascript
// Clean up chunks older than maxChunkAge
const cleaned = await storage.chunks.cleanupOldChunks()
console.log(`Cleaned ${cleaned} old chunks`)
```

## Performance Considerations

### Browser Peers
- **Memory Efficient**: Only store ~33% of chunks (1 of 3 responsible peers)
- **Network Requests**: May need to fetch missing chunks from peers
- **Limited Quota**: Typically 50-100MB storage

### Node Peers
- **More Storage**: Can use 10% of large quota (e.g., 1GB of 10GB)
- **Whole Files**: Faster access for small files
- **Hub Capability**: Can serve chunks to browser peers

## Integration with DHT

The chunk storage system is tightly integrated with the DHT:

1. **Chunk IDs**: Generated using DHT hash function
2. **Responsibility**: Determined by DHT ring position
3. **Peer Discovery**: Find responsible peers via DHT
4. **Replication**: Automatic 3x replication via DHT

## Error Handling

```javascript
try {
  const result = await storage.storeFile('large.dat', data)
  console.log(`Stored: ${result.fileHash}`)
} catch (error) {
  if (error.message.includes('quota')) {
    console.log('Storage quota exceeded')
    // Clean up old chunks
    await storage.chunks.cleanupOldChunks()
  }
}
```

## Best Practices

1. **Choose Appropriate Chunk Size**
   - 64KB: Good balance for most files
   - 128KB: Better for very large files
   - 32KB: Better for many small files

2. **Monitor Storage Usage**
   ```javascript
   setInterval(() => {
     const stats = storage.chunks.getStats()
     if (parseFloat(stats.usagePercent) > 80) {
       console.warn('Storage 80% full')
       storage.chunks.cleanupOldChunks()
     }
   }, 60000)
   ```

3. **Handle Missing Chunks**
   ```javascript
   const file = await storage.getFile('important.dat')
   if (!file) {
     console.log('File not available - missing chunks')
     // Request from other peers or handle gracefully
   }
   ```

4. **Use Metadata**
   ```javascript
   await storage.storeFile('video.mp4', data, {
     mimeType: 'video/mp4',
     duration: 120,
     quality: '1080p',
     uploadedBy: peerId,
     timestamp: Date.now()
   })
   ```

## See Also

- [PAGING_STORAGE.md](./PAGING_STORAGE.md) - Core storage system
- [P2P_ARCHITECTURE.md](./P2P_ARCHITECTURE.md) - P2P architecture
- [ChunkStorageExamples.js](../src/examples/ChunkStorageExamples.js) - Example code
