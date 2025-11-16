/**
 * WebDHTAdapter - Bridges PagingStorage to PeerPigeon's WebDHT
 * Provides the same surface as DistributedHashTable where practical
 */

export class WebDHTAdapter {
  constructor(storage) {
    this.storage = storage
    this.mesh = storage.pigeon
    this.webDHT = this.mesh?.webDHT || null
    if (!this.webDHT) {
      throw new Error('WebDHT is not enabled on the PeerPigeon mesh')
    }
  }

  // ===== ROUTING =====
  async routeGet(key) {
    const value = await this.webDHT.get(String(key))
    if (value && value.__deleted) return undefined
    return value
  }

  async routeSet(key, value) {
    // Soft-delete convention if value is undefined/null
    const payload = value === undefined ? { __deleted: true, ts: Date.now() } : value
    await this.webDHT.put(String(key), payload)
    return this.storage
  }

  async routeDelete(key) {
    await this.webDHT.put(String(key), { __deleted: true, ts: Date.now() })
    return true
  }

  // ===== KEY LOCATION =====
  async findPeersForKey(key, count = 3) {
    const keyHash = await this.webDHT.hash(String(key))
    return this.webDHT.findClosestPeers(keyHash, count)
  }

  async shouldStorePage(pageId, peerId = this.storage.peerId) {
    const peers = await this.findPeersForKey(pageId, 3)
    return peers.includes(peerId)
  }

  async getResponsiblePeer(key) {
    const peers = await this.findPeersForKey(key, 1)
    return peers[0] || this.storage.peerId
  }

  // ===== STATS =====
  getLoadBalanceStats() {
    // Map WebDHT stats into a simple object shape used by UI
    const stats = this.webDHT.getStats()
    return new Map(
      [[this.storage.peerId, {
        totalSize: stats.localKeys || 0,
        closestPeers: stats.closestPeers || 0
      }]]
    )
  }

  isLoadBalanced() {
    // WebDHT handles balancing implicitly; return true as a default
    return true
  }

  // ===== UTILS =====
  async hash(input) {
    return await this.webDHT.hash(input)
  }

  onPeerConnected(peerId) {
    // No-op: WebDHT listens to mesh peers internally
  }

  onPeerDisconnected(peerId) {
    // No-op
  }
}
