/**
 * DistributedHashTable - DHT-like functionality for page location and routing
 * Implements consistent hashing for efficient peer-to-peer data distribution
 */

export class DistributedHashTable {
  constructor(storage) {
    this.storage = storage
    this.hashRing = new Map() // hash -> peerId
    this.peerHashes = new Map() // peerId -> Set of hashes
    this.virtualNodes = 100 // Number of virtual nodes per peer
    this.replicationFactor = 3
    
    // Add ourselves to the hash ring
    this.addPeer(this.storage.peerId)
  }
  
  // ===== HASH RING MANAGEMENT =====
  
  addPeer(peerId) {
    if (this.peerHashes.has(peerId)) {
      return // Peer already exists
    }
    
    const hashes = new Set()
    
    // Add virtual nodes for this peer
    for (let i = 0; i < this.virtualNodes; i++) {
      const hash = this.hash(`${peerId}:${i}`)
      this.hashRing.set(hash, peerId)
      hashes.add(hash)
    }
    
    this.peerHashes.set(peerId, hashes)
    console.log(`Added peer ${peerId} to DHT with ${this.virtualNodes} virtual nodes`)
    
    // Redistribute pages if needed
    this.redistributePages()
  }
  
  removePeer(peerId) {
    const hashes = this.peerHashes.get(peerId)
    if (!hashes) return
    
    // Remove all virtual nodes for this peer
    for (const hash of hashes) {
      this.hashRing.delete(hash)
    }
    
    this.peerHashes.delete(peerId)
    console.log(`Removed peer ${peerId} from DHT`)
    
    // Redistribute orphaned pages
    this.redistributePages()
  }
  
  // ===== KEY LOCATION AND ROUTING =====
  
  findPeersForKey(key, count = this.replicationFactor) {
    if (this.hashRing.size === 0) {
      return [this.storage.peerId]
    }
    
    const keyHash = this.hash(String(key))
    const peers = new Set()
    const sortedHashes = Array.from(this.hashRing.keys()).sort((a, b) => a - b)
    
    // Find the first hash >= keyHash
    let startIndex = this.binarySearchGE(sortedHashes, keyHash)
    
    // Collect unique peers starting from that position
    let index = startIndex
    while (peers.size < count && peers.size < this.peerHashes.size) {
      const hash = sortedHashes[index % sortedHashes.length]
      const peerId = this.hashRing.get(hash)
      peers.add(peerId)
      index++
    }
    
    return Array.from(peers)
  }
  
  findPeersForPage(pageId, count = this.replicationFactor) {
    return this.findPeersForKey(pageId, count)
  }
  
  shouldStorePage(pageId, peerId = this.storage.peerId) {
    const responsiblePeers = this.findPeersForPage(pageId)
    return responsiblePeers.includes(peerId)
  }
  
  getResponsiblePeer(key) {
    const peers = this.findPeersForKey(key, 1)
    return peers[0] || this.storage.peerId
  }
  
  // ===== PAGE ROUTING =====
  
  async routeGet(key) {
    const keyStr = String(key)
    
    // First check if we have it locally
    const localValue = await this.storage.getLocal(keyStr)
    if (localValue !== undefined) {
      return localValue
    }
    
    // Find responsible peers for this key
    const responsiblePeers = this.findPeersForKey(keyStr)
    
    // Try each responsible peer in order
    for (const peerId of responsiblePeers) {
      if (peerId === this.storage.peerId) continue // Skip ourselves
      
      try {
        const value = await this.storage.sync.requestKeyFromPeer(peerId, keyStr)
        if (value !== undefined) {
          // Cache the result locally if we're a replica peer
          if (this.shouldStorePage(keyStr)) {
            await this.storage.setLocal(keyStr, value)
          }
          return value
        }
      } catch (error) {
        console.warn(`Failed to get ${keyStr} from peer ${peerId}:`, error)
      }
    }
    
    return undefined
  }
  
  async routeSet(key, value) {
    const keyStr = String(key)
    const responsiblePeers = this.findPeersForKey(keyStr)
    
    // Always store locally if we're responsible
    if (responsiblePeers.includes(this.storage.peerId)) {
      await this.storage.setLocal(keyStr, value)
    }
    
    // Replicate to other responsible peers
    const replicationPromises = []
    for (const peerId of responsiblePeers) {
      if (peerId === this.storage.peerId) continue
      
      replicationPromises.push(
        this.storage.sync.replicateKeyToPeer(peerId, keyStr, value)
          .catch(error => {
            console.warn(`Failed to replicate ${keyStr} to peer ${peerId}:`, error)
          })
      )
    }
    
    // Wait for at least one successful replication (or all to complete)
    if (replicationPromises.length > 0) {
      try {
        await Promise.race([
          Promise.all(replicationPromises),
          new Promise(resolve => setTimeout(resolve, 5000)) // 5 second timeout
        ])
      } catch (error) {
        console.error('Replication failed:', error)
      }
    }
    
    return this.storage
  }
  
  async routeDelete(key) {
    const keyStr = String(key)
    const responsiblePeers = this.findPeersForKey(keyStr)
    
    // Delete locally if we're responsible
    let deleted = false
    if (responsiblePeers.includes(this.storage.peerId)) {
      deleted = await this.storage.deleteLocal(keyStr)
    }
    
    // Delete from other responsible peers
    const deletionPromises = []
    for (const peerId of responsiblePeers) {
      if (peerId === this.storage.peerId) continue
      
      deletionPromises.push(
        this.storage.sync.deleteKeyFromPeer(peerId, keyStr)
          .catch(error => {
            console.warn(`Failed to delete ${keyStr} from peer ${peerId}:`, error)
          })
      )
    }
    
    if (deletionPromises.length > 0) {
      await Promise.allSettled(deletionPromises)
    }
    
    return deleted
  }
  
  // ===== PAGE REDISTRIBUTION =====
  
  async redistributePages() {
    if (this.storage.pages.size === 0) return
    
    const pagesToMove = []
    
    // Check each page to see if we should still be storing it
    for (const [pageId, page] of this.storage.pages) {
      const responsiblePeers = this.findPeersForPage(pageId)
      
      if (!responsiblePeers.includes(this.storage.peerId)) {
        // We should no longer store this page
        pagesToMove.push({ pageId, page, newPeers: responsiblePeers })
      }
    }
    
    // Move pages to their new locations
    for (const { pageId, page, newPeers } of pagesToMove) {
      console.log(`Redistributing page ${pageId} to peers:`, newPeers)
      
      // Send page to new responsible peers
      for (const peerId of newPeers) {
        if (peerId === this.storage.peerId) continue
        
        try {
          await this.storage.sync.transferPageToPeer(peerId, page)
        } catch (error) {
          console.error(`Failed to transfer page ${pageId} to ${peerId}:`, error)
        }
      }
      
      // Remove the page locally after successful transfer
      this.storage.deletePage(pageId)
    }
  }
  
  // ===== LOAD BALANCING =====
  
  getLoadBalanceStats() {
    const stats = new Map()
    
    // Initialize stats for all peers
    for (const peerId of this.peerHashes.keys()) {
      stats.set(peerId, { pages: 0, totalSize: 0, keys: 0 })
    }
    
    // Count pages and sizes per peer based on DHT assignment
    for (const [pageId, page] of this.storage.pages) {
      const responsiblePeers = this.findPeersForPage(pageId)
      
      for (const peerId of responsiblePeers) {
        const peerStats = stats.get(peerId) || { pages: 0, totalSize: 0, keys: 0 }
        peerStats.pages++
        peerStats.totalSize += page.size
        peerStats.keys += page.data.size
        stats.set(peerId, peerStats)
      }
    }
    
    return stats
  }
  
  isLoadBalanced(threshold = 0.2) {
    const stats = this.getLoadBalanceStats()
    const sizes = Array.from(stats.values()).map(s => s.totalSize)
    
    if (sizes.length < 2) return true
    
    const avgSize = sizes.reduce((sum, size) => sum + size, 0) / sizes.length
    const maxDeviation = Math.max(...sizes.map(size => Math.abs(size - avgSize)))
    
    return maxDeviation / avgSize <= threshold
  }
  
  // ===== UTILITY METHODS =====
  
  hash(input) {
    // Simple hash function - in production, use a cryptographic hash
    let hash = 0
    const str = String(input)
    
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    
    return Math.abs(hash)
  }
  
  binarySearchGE(sortedArray, target) {
    let left = 0
    let right = sortedArray.length
    
    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      if (sortedArray[mid] < target) {
        left = mid + 1
      } else {
        right = mid
      }
    }
    
    return left % sortedArray.length
  }
  
  // ===== PEER EVENTS =====
  
  onPeerConnected(peerId) {
    this.addPeer(peerId)
  }
  
  onPeerDisconnected(peerId) {
    this.removePeer(peerId)
  }
  
  // ===== DEBUG AND MONITORING =====
  
  getHashRingInfo() {
    const ringInfo = []
    const sortedHashes = Array.from(this.hashRing.keys()).sort((a, b) => a - b)
    
    for (const hash of sortedHashes) {
      const peerId = this.hashRing.get(hash)
      ringInfo.push({ hash, peerId })
    }
    
    return ringInfo
  }
  
  getPeerDistribution() {
    const distribution = new Map()
    
    for (const [peerId, hashes] of this.peerHashes) {
      distribution.set(peerId, {
        virtualNodes: hashes.size,
        hashRange: this.calculateHashRange(hashes)
      })
    }
    
    return distribution
  }
  
  calculateHashRange(hashes) {
    const sortedHashes = Array.from(hashes).sort((a, b) => a - b)
    
    if (sortedHashes.length === 0) return 0
    if (sortedHashes.length === 1) return 1
    
    let totalRange = 0
    const maxHash = Math.pow(2, 32)
    
    for (let i = 0; i < sortedHashes.length; i++) {
      const current = sortedHashes[i]
      const next = sortedHashes[(i + 1) % sortedHashes.length]
      
      if (next > current) {
        totalRange += next - current
      } else {
        // Wrap around
        totalRange += (maxHash - current) + next
      }
    }
    
    return totalRange / maxHash
  }
}