/**
 * ChunkStorage Examples
 * Demonstrates file chunking and distributed storage
 */

import { PagingStorage } from '../storage/PagingStorage.js'

/**
 * Example 1: Store a file with automatic chunking
 */
export async function basicFileStorageExample(pigeon) {
  console.log('=== Basic File Storage Example ===\n')
  
  const storage = new PagingStorage({
    pigeon,
    peerId: pigeon.peerId,
    chunks: {
      chunkSize: 64 * 1024, // 64KB chunks
      storageQuota: 100 * 1024 * 1024 // 100MB quota
    }
  })
  
  try {
    // Create sample file data
    const filename = 'test-video.mp4'
    const fileSize = 5 * 1024 * 1024 // 5MB
    const fileData = new Uint8Array(fileSize)
    
    // Fill with sample data
    for (let i = 0; i < fileSize; i++) {
      fileData[i] = i % 256
    }
    
    console.log(`📦 Storing file: ${filename} (${storage.chunks.formatSize(fileSize)})`)
    
    // Store the file
    const result = await storage.storeFile(filename, fileData, {
      mimeType: 'video/mp4',
      timestamp: Date.now()
    })
    
    console.log(`✅ File stored:`)
    console.log(`   Type: ${result.type}`)
    console.log(`   Hash: ${result.fileHash}`)
    if (result.type === 'chunked') {
      console.log(`   Total Chunks: ${result.totalChunks}`)
      console.log(`   Stored Chunks: ${result.storedChunks}`)
    }
    
    // Get storage stats
    const stats = storage.chunks.getStats()
    console.log(`\n📊 Storage Stats:`)
    console.log(`   Mode: ${stats.mode}`)
    console.log(`   Total Chunks: ${stats.totalChunks}`)
    console.log(`   Total Files: ${stats.totalFiles}`)
    console.log(`   Storage Used: ${storage.chunks.formatSize(stats.storageUsed)}`)
    console.log(`   Usage: ${stats.usagePercent}%`)
    
    // Retrieve the file
    console.log(`\n📥 Retrieving file...`)
    const retrieved = await storage.getFile(filename)
    
    if (retrieved) {
      console.log(`✅ File retrieved:`)
      console.log(`   Type: ${retrieved.type}`)
      console.log(`   Size: ${storage.chunks.formatSize(retrieved.data.length)}`)
      console.log(`   Data matches: ${compareArrays(fileData, retrieved.data)}`)
    }
    
  } catch (error) {
    console.error('Error in basic file storage example:', error)
  } finally {
    await storage.shutdown()
  }
}

/**
 * Example 2: Browser peer chunk storage (DHT-based)
 */
export async function browserPeerExample(pigeon) {
  console.log('\n=== Browser Peer Chunk Storage ===\n')
  
  const storage = new PagingStorage({
    pigeon,
    peerId: pigeon.peerId,
    chunks: {
      chunkSize: 64 * 1024,
      storageQuota: 50 * 1024 * 1024 // 50MB for browser
    }
  })
  
  try {
    // Simulate storing multiple files
    const files = [
      { name: 'doc1.pdf', size: 2 * 1024 * 1024 },
      { name: 'image1.jpg', size: 500 * 1024 },
      { name: 'video1.mp4', size: 10 * 1024 * 1024 }
    ]
    
    console.log(`🌐 Browser mode: Storing only responsible chunks`)
    console.log(`   Peer ID: ${pigeon.peerId}\n`)
    
    for (const file of files) {
      const data = new Uint8Array(file.size)
      const result = await storage.storeFile(file.name, data)
      
      console.log(`📦 ${file.name}:`)
      console.log(`   Total chunks: ${result.totalChunks || 1}`)
      console.log(`   Stored chunks: ${result.storedChunks || 1}`)
      console.log(`   Responsibility: ${((result.storedChunks || 1) / (result.totalChunks || 1) * 100).toFixed(1)}%`)
    }
    
    // List all stored chunks with proximity
    console.log(`\n📍 Chunk Proximity Analysis:`)
    for (const [chunkId, metadata] of storage.chunks.chunkMetadata.entries()) {
      console.log(`   Chunk ${chunkId}: proximity ${metadata.proximity}`)
    }
    
    const stats = storage.chunks.getStats()
    console.log(`\n📊 Browser Storage Stats:`)
    console.log(`   Responsible chunks: ${stats.responsibleChunks}`)
    console.log(`   Storage used: ${storage.chunks.formatSize(stats.storageUsed)}`)
    
  } catch (error) {
    console.error('Error in browser peer example:', error)
  } finally {
    await storage.shutdown()
  }
}

/**
 * Example 3: Node peer storage (10% quota for files/chunks)
 */
export async function nodePeerExample(pigeon) {
  console.log('\n=== Node Peer Storage (10% Quota) ===\n')
  
  const totalQuota = 10 * 1024 * 1024 * 1024 // 10GB
  const storage = new PagingStorage({
    pigeon,
    peerId: pigeon.peerId,
    chunks: {
      chunkSize: 64 * 1024,
      storageQuota: totalQuota
    }
  })
  
  try {
    const availableForChunks = await storage.chunks.getAvailableChunkStorage()
    console.log(`💾 Node mode with quota management`)
    console.log(`   Total quota: ${storage.chunks.formatSize(totalQuota)}`)
    console.log(`   Available for files/chunks (10%): ${storage.chunks.formatSize(availableForChunks)}`)
    
    // Store small files as whole
    console.log(`\n📄 Storing small files (whole):`)
    const smallFile = new Uint8Array(500 * 1024) // 500KB
    const result1 = await storage.storeFile('small-doc.pdf', smallFile)
    console.log(`   small-doc.pdf: ${result1.type} (${storage.chunks.formatSize(result1.size)})`)
    
    // Store large files as chunks
    console.log(`\n🧩 Storing large files (chunked):`)
    const largeFile = new Uint8Array(50 * 1024 * 1024) // 50MB
    const result2 = await storage.storeFile('large-video.mp4', largeFile)
    console.log(`   large-video.mp4: ${result2.type}`)
    console.log(`   Total chunks: ${result2.totalChunks}`)
    console.log(`   Stored chunks: ${result2.storedChunks}`)
    
    // List all files
    console.log(`\n📋 All stored files:`)
    const files = await storage.listFiles()
    for (const file of files) {
      console.log(`   ${file.filename}: ${file.type} (${file.size ? storage.chunks.formatSize(file.size) : file.totalChunks + ' chunks'})`)
    }
    
    const stats = storage.chunks.getStats()
    console.log(`\n📊 Storage Stats:`)
    console.log(`   Total files: ${stats.totalFiles}`)
    console.log(`   Total chunks: ${stats.totalChunks}`)
    console.log(`   Storage used: ${storage.chunks.formatSize(stats.storageUsed)} / ${storage.chunks.formatSize(availableForChunks)}`)
    console.log(`   Usage: ${stats.usagePercent}% of total quota`)
    console.log(`   Usage of 10% allocation: ${(stats.storageUsed / availableForChunks * 100).toFixed(2)}%`)
    
  } catch (error) {
    console.error('Error in node peer example:', error)
  } finally {
    await storage.shutdown()
  }
}

/**
 * Example 4: Filename hash indexing
 */
export async function filenameHashExample(pigeon) {
  console.log('\n=== Filename Hash Indexing ===\n')
  
  const storage = new PagingStorage({
    pigeon,
    peerId: pigeon.peerId
  })
  
  try {
    // Store files with different names
    const files = [
      'Document.pdf',
      'document.pdf',
      'DOCUMENT.PDF',
      'video.mp4',
      'Video.MP4'
    ]
    
    console.log(`🔑 Storing files and indexing by filename hash:`)
    for (const filename of files) {
      const data = new Uint8Array(1024)
      await storage.storeFile(filename, data)
      
      const hash = storage.chunks.hashFilename(filename)
      console.log(`   ${filename}: hash ${hash}`)
    }
    
    // Test case-insensitive lookup
    console.log(`\n🔍 Testing case-insensitive lookups:`)
    const lookups = ['document.pdf', 'DOCUMENT.PDF', 'Document.PDF']
    
    for (const lookup of lookups) {
      const fileHash = await storage.findFileByFilename(lookup)
      console.log(`   "${lookup}": ${fileHash ? 'found' : 'not found'}`)
    }
    
    // List all files
    console.log(`\n📋 All indexed files:`)
    const allFiles = await storage.listFiles()
    for (const file of allFiles) {
      console.log(`   ${file.filename} (hash: ${file.fileHash})`)
    }
    
  } catch (error) {
    console.error('Error in filename hash example:', error)
  } finally {
    await storage.shutdown()
  }
}

/**
 * Example 5: Chunk eviction and cleanup
 */
export async function chunkEvictionExample(pigeon) {
  console.log('\n=== Chunk Eviction and Cleanup ===\n')
  
  const storage = new PagingStorage({
    pigeon,
    peerId: pigeon.peerId,
    chunks: {
      chunkSize: 64 * 1024,
      storageQuota: 5 * 1024 * 1024, // Small 5MB quota to trigger eviction
      maxChunkAge: 5000 // 5 seconds for demo
    }
  })
  
  try {
    console.log(`💾 Storage quota: ${storage.chunks.formatSize(storage.chunks.storageQuota)}`)
    
    // Fill storage
    console.log(`\n📦 Filling storage...`)
    for (let i = 0; i < 10; i++) {
      const data = new Uint8Array(500 * 1024) // 500KB each
      await storage.storeFile(`file${i}.dat`, data)
      
      const stats = storage.chunks.getStats()
      console.log(`   File ${i}: ${stats.usagePercent}% used`)
      
      if (parseFloat(stats.usagePercent) > 90) {
        console.log(`   ⚠️ Quota nearly full, eviction will occur...`)
      }
    }
    
    console.log(`\n🧹 Testing cleanup of old chunks...`)
    
    // Wait for chunks to age
    await new Promise(resolve => setTimeout(resolve, 6000))
    
    const cleaned = await storage.chunks.cleanupOldChunks()
    console.log(`   Cleaned ${cleaned} old chunks`)
    
    const finalStats = storage.chunks.getStats()
    console.log(`\n📊 Final Stats:`)
    console.log(`   Storage used: ${storage.chunks.formatSize(finalStats.storageUsed)}`)
    console.log(`   Usage: ${finalStats.usagePercent}%`)
    
  } catch (error) {
    console.error('Error in chunk eviction example:', error)
  } finally {
    await storage.shutdown()
  }
}

// Utility function to compare arrays
function compareArrays(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// Run all examples
export async function runAllChunkExamples(pigeon) {
  console.log('🚀 Running ChunkStorage Examples\n')
  console.log('=' .repeat(60))
  
  try {
    await basicFileStorageExample(pigeon)
    await browserPeerExample(pigeon)
    await nodePeerExample(pigeon)
    await filenameHashExample(pigeon)
    await chunkEvictionExample(pigeon)
    
    console.log('\n' + '='.repeat(60))
    console.log('✅ All examples completed successfully!')
  } catch (error) {
    console.error('❌ Error running examples:', error)
  }
}
