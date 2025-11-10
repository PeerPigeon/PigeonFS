import { ref, reactive, markRaw } from 'vue'

// PeerPigeon is loaded globally from the browser bundle
const { PeerPigeonMesh } = window.PeerPigeon

const CHUNK_SIZE = 64 * 1024 // 64KB chunks - larger for better throughput

export function usePeerPigeon() {
  const pigeon = ref(null)
  const myPeerId = ref('')
  const connectionStatus = ref('disconnected') // disconnected, connecting, connected
  const receivedFiles = reactive([])
  const sendingProgress = ref(0)
  const isSending = ref(false)
  const fileTransfers = new Map() // Track active transfers

  // Initialize PeerPigeon connection
  const connect = async (options = {}) => {
    try {
      connectionStatus.value = 'connecting'
      
      console.log('Initializing PeerPigeonMesh...')
      
      pigeon.value = markRaw(new PeerPigeonMesh({
        networkName: options.networkName || 'pigeonfs',  // Use provided networkName or default
        enableWebDHT: false,
        enableCrypto: false,
        enableDistributedStorage: false,
        maxPeers: 10,
        minPeers: 0,  // Don't require any minimum peers
        autoConnect: true,   // Enable auto-connect to discovered peers
        autoDiscovery: true,  // Enable auto-discovery within the network namespace
        usePigeonNS: true,  // Enable pigeonns resolver for mDNS ICE candidates
        resolveMDNS: true  // Resolve .local addresses using pigeonns
      }))

      console.log('PeerPigeonMesh instance created, calling init()...')
      await pigeon.value.init()
      
      console.log('PeerPigeonMesh initialized, setting up events...')

      // Wait for connection to be established
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.error('Connection timeout after 15 seconds')
          reject(new Error('Connection timeout - could not connect to PigeonHub server'))
        }, 15000)
        
        pigeon.value.on('statusChanged', (data) => {
          console.log('📡 Status changed:', data)
          if (data.type === 'connected' || data.status === 'connected') {
            clearTimeout(timeout)
            myPeerId.value = pigeon.value.peerId
            connectionStatus.value = 'connected'
            console.log('✅ Connected with peer ID:', pigeon.value.peerId)
            resolve()
          }
        })

        pigeon.value.on('error', (error) => {
          console.error('❌ Error event:', error)
          clearTimeout(timeout)
          connectionStatus.value = 'disconnected'
          reject(error)
        })

        // Now connect to the signaling server
        console.log('Connecting to PigeonHub server: wss://pigeonhub.fly.dev')
        pigeon.value.connect('wss://pigeonhub.fly.dev').catch(reject)
      })

      // Set up message listener for file transfers
      pigeon.value.on('messageReceived', (messageData) => {
        const { from, content } = messageData
        
        if (!content || typeof content !== 'object') return
        
        try {
          handleIncomingMessage(content, from)
        } catch (error) {
          console.error('Error handling message:', error)
        }
      })

      // Listen for peer connections
      pigeon.value.on('peerConnected', (data) => {
        console.log('🤝 Peer connected:', data.peerId)
      })

      pigeon.value.on('peerDisconnected', (data) => {
        console.log('👋 Peer disconnected:', data.peerId)
      })

      // Handle peer disconnections
      pigeon.value.on('close', () => {
        connectionStatus.value = 'disconnected'
        console.log('Connection closed')
      })

    } catch (error) {
      console.error('Failed to connect:', error)
      connectionStatus.value = 'disconnected'
      throw error
    }
  }

  // Handle incoming messages
  const handleIncomingMessage = (data, peerId) => {
    const { type } = data
    
    switch (type) {
      case 'ping':
        console.log('🏓 Ping from', peerId?.substring(0, 8), ':', data.message)
        break
        
      case 'file-start':
        handleFileStart(data, peerId)
        break
        
      case 'file-chunk':
        handleFileChunk(data, peerId)
        break
        
      case 'file-end':
        handleFileEnd(data, peerId)
        break
    }
  }

  // Handle file transfer start
  const handleFileStart = (data, peerId) => {
    const { transferId, filename, filesize, totalChunks, mimeType } = data
    
    console.log(`📥 Starting file receive: ${filename} (${filesize} bytes, ${totalChunks} chunks)`)
    
    // Create file entry
    const fileEntry = {
      id: transferId,
      name: filename,
      size: filesize,
      receivedSize: 0,
      progress: 0,
      status: 'receiving',
      peerId: peerId,
      blob: null
    }
    receivedFiles.push(fileEntry)
    
    // Track transfer
    fileTransfers.set(transferId, {
      chunks: new Array(totalChunks),
      totalChunks,
      receivedChunks: 0,
      mimeType
    })
  }

  // Handle file chunk
  const handleFileChunk = (data, peerId) => {
    const { transferId, chunkIndex, chunk } = data
    
    const transfer = fileTransfers.get(transferId)
    const fileIndex = receivedFiles.findIndex(f => f.id === transferId)
    
    if (!transfer || fileIndex === -1) return
    
    // Store chunk as Uint8Array
    transfer.chunks[chunkIndex] = new Uint8Array(chunk)
    transfer.receivedChunks++
    
    // Update progress
    const progress = (transfer.receivedChunks / transfer.totalChunks) * 100
    receivedFiles[fileIndex].progress = progress
    receivedFiles[fileIndex].receivedSize = transfer.chunks
      .filter(c => c)
      .reduce((sum, c) => sum + c.length, 0)
    
    // Log every 10%
    if (Math.floor(progress) % 10 === 0 && Math.floor(progress) > Math.floor((progress - 10))) {
      console.log(`� Progress: ${Math.round(progress)}%`)
    }
  }

  // Handle file transfer end
  const handleFileEnd = (data, peerId) => {
    const { transferId } = data
    
    const transfer = fileTransfers.get(transferId)
    const fileIndex = receivedFiles.findIndex(f => f.id === transferId)
    
    if (!transfer || fileIndex === -1) return
    
    console.log(`📦 Assembling file from ${transfer.totalChunks} chunks...`)
    
    // Check for missing chunks
    const missingChunks = []
    for (let i = 0; i < transfer.totalChunks; i++) {
      if (!transfer.chunks[i]) {
        missingChunks.push(i)
      }
    }
    
    if (missingChunks.length > 0) {
      console.error(`❌ Missing ${missingChunks.length} chunks:`, missingChunks.slice(0, 10))
      receivedFiles[fileIndex].status = 'error'
      return
    }
    
    // Assemble file
    const totalSize = transfer.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const fileData = new Uint8Array(totalSize)
    let offset = 0
    
    for (const chunk of transfer.chunks) {
      fileData.set(chunk, offset)
      offset += chunk.length
    }
    
    const blob = new Blob([fileData], { type: transfer.mimeType || 'application/octet-stream' })
    
    receivedFiles[fileIndex].blob = blob
    receivedFiles[fileIndex].status = 'complete'
    receivedFiles[fileIndex].progress = 100
    receivedFiles[fileIndex].receivedSize = blob.size
    
    console.log(`✅ File received: ${receivedFiles[fileIndex].name} (${blob.size} bytes)`)
    
    fileTransfers.delete(transferId)
  }

  // Send file using data channel with binary chunks
  const sendFile = async (file, targetPeerId) => {
    if (!pigeon.value || connectionStatus.value !== 'connected') {
      throw new Error('Not connected')
    }

    console.log(`📤 Sending: ${file.name} (${file.size} bytes) to ${targetPeerId.substring(0, 8)}`)

    try {
      isSending.value = true
      sendingProgress.value = 0

      // Ensure peer connection
      const isConnected = pigeon.value.connectionManager.peers.has(targetPeerId)
      
      if (!isConnected) {
        console.log(`🔗 Connecting to peer...`)
        
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup()
            reject(new Error('Connection timeout'))
          }, 20000)
          
          const onPeerConnected = (data) => {
            if (data.peerId === targetPeerId) {
              cleanup()
              resolve()
            }
          }
          
          const cleanup = () => {
            clearTimeout(timeout)
            pigeon.value.off('peerConnected', onPeerConnected)
          }
          
          pigeon.value.on('peerConnected', onPeerConnected)
        })
        
        pigeon.value.connectionManager.connectToPeer(targetPeerId).catch(console.error)
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      // Generate transfer ID
      const transferId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

      // Send file start message
      await pigeon.value.sendDirectMessage(targetPeerId, {
        type: 'file-start',
        transferId,
        filename: file.name,
        filesize: file.size,
        totalChunks,
        mimeType: file.type || 'application/octet-stream'
      })

      console.log(`📤 Sending ${totalChunks} chunks...`)

      // Get peer connection for direct data channel access
      const peerConnection = pigeon.value.connectionManager.peers.get(targetPeerId)
      
      if (!peerConnection || !peerConnection.dataChannel) {
        throw new Error('No data channel available')
      }

      const dataChannel = peerConnection.dataChannel

      // Send chunks using data channel's bufferedAmount for backpressure
      let offset = 0
      let chunkIndex = 0

      while (offset < file.size) {
        // Wait if buffer is getting full (backpressure handling)
        while (dataChannel.bufferedAmount > 16 * 1024 * 1024) { // 16MB buffer limit
          await new Promise(resolve => setTimeout(resolve, 10))
        }

        const chunkEnd = Math.min(offset + CHUNK_SIZE, file.size)
        const chunkBlob = file.slice(offset, chunkEnd)
        const arrayBuffer = await chunkBlob.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)

        // Send chunk via direct message (will use data channel)
        await pigeon.value.sendDirectMessage(targetPeerId, {
          type: 'file-chunk',
          transferId,
          chunkIndex,
          chunk: Array.from(uint8Array) // Convert for JSON serialization
        })

        offset = chunkEnd
        chunkIndex++
        sendingProgress.value = (chunkIndex / totalChunks) * 100

        // Log every 10%
        if (chunkIndex % Math.ceil(totalChunks / 10) === 0) {
          console.log(`📤 Progress: ${Math.round(sendingProgress.value)}%`)
        }

        // Small delay to prevent overwhelming
        if (chunkIndex % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 1))
        }
      }

      // Send file end message
      await pigeon.value.sendDirectMessage(targetPeerId, {
        type: 'file-end',
        transferId
      })

      console.log(`✅ File sent: ${file.name}`)
      sendingProgress.value = 100
      
      setTimeout(() => {
        isSending.value = false
        sendingProgress.value = 0
      }, 1000)

    } catch (error) {
      console.error('❌ Error sending file:', error)
      isSending.value = false
      sendingProgress.value = 0
      throw error
    }
  }

  // Download a received file
  const downloadFile = (fileId) => {
    const file = receivedFiles.find(f => f.id === fileId)
    if (!file || !file.blob) return

    const url = URL.createObjectURL(file.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Test connectivity - send a simple ping message
  const testConnection = async (targetPeerId) => {
    try {
      console.log(`🏓 Testing connection to ${targetPeerId.substring(0, 8)}...`)
      await pigeon.value.sendDirectMessage(targetPeerId, {
        type: 'ping',
        message: 'Hello from sender!',
        timestamp: Date.now()
      })
      console.log(`✅ Ping sent to ${targetPeerId.substring(0, 8)}`)
    } catch (error) {
      console.error(`❌ Failed to send ping:`, error)
    }
  }

  // Disconnect from PigeonHub
  const disconnect = () => {
    if (pigeon.value) {
      pigeon.value.destroy()
      pigeon.value = null
      connectionStatus.value = 'disconnected'
      myPeerId.value = ''
      fileTransfers.clear()
    }
  }

  return {
    pigeon,
    myPeerId,
    connectionStatus,
    receivedFiles,
    sendingProgress,
    isSending,
    connect,
    sendFile,
    downloadFile,
    disconnect,
    testConnection
  }
}