import { ref, reactive, markRaw } from 'vue'

// PeerPigeon is loaded globally from the browser bundle
const { PeerPigeonMesh } = window.PeerPigeon

const CHUNK_SIZE = 16384 // 16KB chunks for streaming

export function usePeerPigeon() {
  const pigeon = ref(null)
  const myPeerId = ref('')
  const connectionStatus = ref('disconnected') // disconnected, connecting, connected
  const receivedFiles = reactive([])
  const sendingProgress = ref(0)
  const isSending = ref(false)

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

      // Set up message listener for incoming files
      pigeon.value.on('messageReceived', (messageData) => {
        console.log('📨 Message received event fired!', {
          from: messageData.from?.substring(0, 8),
          contentType: typeof messageData.content,
          hasType: messageData.content?.type,
          direct: messageData.direct
        })
        
        // Handle the message content
        try {
          handleIncomingData(messageData.content, messageData.from)
        } catch (error) {
          console.error('Error handling incoming data:', error)
        }
      })

      // ALSO listen on the raw event emitter to debug
      if (pigeon.value.connectionManager) {
        console.log('Setting up direct message listener on connectionManager...')
        pigeon.value.connectionManager.on('messageReceived', (data) => {
          console.log('📨 Direct message from connectionManager:', data)
        })
      }
      
      // Listen for all gossip messages to debug
      if (pigeon.value.gossipManager) {
        console.log('Setting up gossip manager listener...')
        pigeon.value.gossipManager.on('messageReceived', (data) => {
          console.log('📨 Gossip message received:', {
            from: data.from?.substring(0, 8),
            contentType: typeof data.content,
            hasType: data.content?.type
          })
        })
      }

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

  // Handle incoming data from peers
  const fileBuffers = new Map() // Store incomplete file transfers

  const handleIncomingData = (data, peerId) => {
    try {
      console.log('📦 Handling incoming data:', { type: data?.type, from: peerId })
      
      // Check message type
      if (data.type === 'ping') {
        console.log('🏓 Received ping from', peerId?.substring(0, 8), ':', data.message)
        return
      } else if (data.type === 'file-metadata') {
        console.log('📋 Received file metadata:', data.name, data.size, 'bytes,', data.totalChunks, 'chunks')
        // Initialize a new file transfer
        const fileId = data.fileId
        receivedFiles.push({
          id: fileId,
          name: data.name,
          size: data.size,
          receivedSize: 0,
          progress: 0,
          status: 'receiving',
          chunks: [],
          peerId: peerId,
          blob: null
        })
        
        fileBuffers.set(fileId, {
          chunks: [],
          totalChunks: data.totalChunks,
          receivedChunks: 0
        })
        
        console.log(`Receiving file: ${data.name} (${data.size} bytes)`)
      } else if (data.type === 'file-chunk') {
        // Receive a file chunk
        const fileId = data.fileId
        const buffer = fileBuffers.get(fileId)
        const fileIndex = receivedFiles.findIndex(f => f.id === fileId)
        
        if (buffer && fileIndex !== -1) {
          // Convert received Array back to Uint8Array
          const chunkData = data.chunk ? new Uint8Array(data.chunk) : null
          
          // Debug: Check if chunk has data
          console.log(`📦 Chunk ${data.chunkIndex}: ${chunkData ? chunkData.length : 0} bytes`)
          
          buffer.chunks[data.chunkIndex] = chunkData
          buffer.receivedChunks++
          
          // Update progress - calculate actual received size
          let actualReceivedSize = 0
          for (let i = 0; i < buffer.totalChunks; i++) {
            if (buffer.chunks[i]) {
              actualReceivedSize += buffer.chunks[i].length
            }
          }
          
          const progress = (buffer.receivedChunks / buffer.totalChunks) * 100
          receivedFiles[fileIndex].progress = progress
          receivedFiles[fileIndex].receivedSize = actualReceivedSize
          
          // Log progress every 100 chunks
          if (buffer.receivedChunks % 100 === 0) {
            console.log(`📥 Receiving progress: ${buffer.receivedChunks}/${buffer.totalChunks} chunks (${Math.round(progress)}%)`)
          }
          
          // Check if all chunks received - verify every chunk is present
          if (buffer.receivedChunks >= buffer.totalChunks) {
            console.log(`📊 Received ${buffer.receivedChunks}/${buffer.totalChunks} chunks, verifying completeness...`)
            
            // Check for missing chunks
            const missingChunks = []
            for (let i = 0; i < buffer.totalChunks; i++) {
              if (!buffer.chunks[i]) {
                missingChunks.push(i)
              }
            }
            
            if (missingChunks.length > 0) {
              console.error(`❌ Missing ${missingChunks.length} chunks:`, missingChunks.slice(0, 10))
              // Don't complete - wait for missing chunks
              return
            }
            
            console.log(`✅ All chunks verified! Assembling file...`)
            
            // Combine all chunks into a blob
            let totalSize = 0
            for (let i = 0; i < buffer.totalChunks; i++) {
              totalSize += buffer.chunks[i].length
            }
            
            console.log(`🔧 Assembling ${buffer.totalChunks} chunks, total size: ${totalSize} bytes`)
            
            const completeData = new Uint8Array(totalSize)
            let offset = 0
            for (let i = 0; i < buffer.totalChunks; i++) {
              const chunk = buffer.chunks[i]
              completeData.set(chunk, offset)
              offset += chunk.length
            }
            
            const blob = new Blob([completeData])
            console.log(`🎯 Created blob: ${blob.size} bytes (type: ${blob.type})`)
            
            receivedFiles[fileIndex].blob = blob
            receivedFiles[fileIndex].status = 'complete'
            receivedFiles[fileIndex].progress = 100
            receivedFiles[fileIndex].receivedSize = totalSize
            
            console.log(`✅ File complete: ${receivedFiles[fileIndex].name} (${totalSize} bytes)`)
            fileBuffers.delete(fileId)
          }
        }
      }
    } catch (error) {
      console.error('Error handling incoming data:', error)
    }
  }

  // Send a file to a peer
  const sendFile = async (file, targetPeerId) => {
    if (!pigeon.value || connectionStatus.value !== 'connected') {
      throw new Error('Not connected to PigeonHub')
    }

    console.log(`📤 Starting to send file: ${file.name} (${file.size} bytes) to ${targetPeerId}`)

    try {
      isSending.value = true
      sendingProgress.value = 0

      // First, establish a peer-to-peer connection if not already connected
      console.log(`🔗 Checking connection to peer ${targetPeerId.substring(0, 8)}...`)
      const isConnected = pigeon.value.connectionManager.peers.has(targetPeerId)
      console.log(`🔗 Already connected: ${isConnected}`)
      
      if (!isConnected) {
        console.log(`🔗 Establishing peer connection to ${targetPeerId.substring(0, 8)}...`)
        
        // Create a promise that resolves when the peer connects
        const connectionPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup()
            console.error(`❌ Connection timeout after 20 seconds for peer ${targetPeerId.substring(0, 8)}`)
            console.log(`🔍 Final connection check - peers map has:`, Array.from(pigeon.value.connectionManager.peers.keys()).map(id => id.substring(0, 8)))
            reject(new Error('Connection timeout after 20 seconds'))
          }, 20000)
          
          // Periodically check connection status as a fallback
          const statusCheckInterval = setInterval(() => {
            const connected = pigeon.value.connectionManager.peers.has(targetPeerId)
            console.log(`🔄 Periodic connection check for ${targetPeerId.substring(0, 8)}: ${connected}`)
            if (connected) {
              console.log(`✅ Connection detected via periodic check`)
              cleanup()
              resolve()
            }
          }, 2000)
          
          const onPeerConnected = (data) => {
            console.log(`🔍 peerConnected event fired for: ${data.peerId?.substring(0, 8)}`)
            if (data.peerId === targetPeerId) {
              console.log(`✅ Target peer connected via event`)
              cleanup()
              resolve()
            }
          }
          
          const onStatusChanged = (data) => {
            console.log(`📡 Status change during connection:`, data)
            // Also listen for status changes that might indicate connection
            if (data.message && data.message.includes('Answer processed')) {
              const peerId = data.message.match(/[a-f0-9]{8}\.\.\./)?.[0]?.replace('...', '')
              if (peerId && targetPeerId.startsWith(peerId)) {
                console.log(`🔍 Answer processed for target peer, checking connection...`)
                // Give WebRTC a moment to establish the connection
                setTimeout(() => {
                  if (pigeon.value.connectionManager.peers.has(targetPeerId)) {
                    console.log(`✅ Connection confirmed after answer processing`)
                    cleanup()
                    resolve()
                  }
                }, 1000)
              }
            }
          }
          
          const cleanup = () => {
            clearTimeout(timeout)
            clearInterval(statusCheckInterval)
            pigeon.value.off('peerConnected', onPeerConnected)
            pigeon.value.off('statusChanged', onStatusChanged)
          }
          
          pigeon.value.on('peerConnected', onPeerConnected)
          pigeon.value.on('statusChanged', onStatusChanged)
        })
        
        // Start the connection attempt (non-blocking)
        console.log(`🚀 Initiating connectToPeer for ${targetPeerId.substring(0, 8)}...`)
        pigeon.value.connectionManager.connectToPeer(targetPeerId).catch(err => {
          console.error('❌ connectToPeer error:', err)
        })
        
        // Wait for connection or timeout
        console.log(`⏳ Waiting for connection to establish...`)
        await connectionPromise
        
        // Verify connection was established
        const nowConnected = pigeon.value.connectionManager.peers.has(targetPeerId)
        console.log(`✅ Connection established: ${nowConnected}`)
        
        if (!nowConnected) {
          throw new Error(`Failed to establish connection to peer ${targetPeerId.substring(0, 8)}`)
        }
        
        // Give the connection a moment to stabilize
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

      console.log(`📋 File metadata: ID=${fileId}, totalChunks=${totalChunks}`)

      // Send file metadata first
      console.log(`📤 Sending metadata to ${targetPeerId.substring(0, 8)}...`)
      const metadata = {
        type: 'file-metadata',
        fileId: fileId,
        name: file.name,
        size: file.size,
        totalChunks: totalChunks
      }
      console.log('📤 Metadata object:', metadata)
      const metadataResult = await pigeon.value.sendDirectMessage(targetPeerId, metadata)
      console.log(`📤 Metadata send result:`, metadataResult)
      
      // Wait a moment for metadata to be received
      await new Promise(resolve => setTimeout(resolve, 500))

      console.log(`Sending file: ${file.name} (${file.size} bytes) in ${totalChunks} chunks`)

      // Read and send file in chunks
      let offset = 0
      let chunkIndex = 0

      while (offset < file.size) {
        const chunk = file.slice(offset, offset + CHUNK_SIZE)
        const arrayBuffer = await chunk.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)
        
        // Convert Uint8Array to Array for safe serialization
        const chunkArray = Array.from(uint8Array)
        
        // Debug: Verify chunk has data
        console.log(`📤 Sending chunk ${chunkIndex}: ${chunkArray.length} bytes`)

        await pigeon.value.sendDirectMessage(targetPeerId, {
          type: 'file-chunk',
          fileId: fileId,
          chunkIndex: chunkIndex,
          chunk: chunkArray  // Send as regular Array instead of Uint8Array
        })

        offset += CHUNK_SIZE
        chunkIndex++
        sendingProgress.value = (chunkIndex / totalChunks) * 100

        // Log progress every 100 chunks
        if (chunkIndex % 100 === 0 || chunkIndex === totalChunks) {
          console.log(`📤 Sending progress: ${chunkIndex}/${totalChunks} chunks (${Math.round(sendingProgress.value)}%)`)
        }

        // Small delay to prevent overwhelming the connection
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      console.log(`File sent successfully: ${file.name}`)
      sendingProgress.value = 100
      
      // Wait a bit to ensure all messages are delivered before closing
      console.log('⏳ Waiting for messages to be delivered...')
      await new Promise(resolve => setTimeout(resolve, 3000))
      console.log('✅ File transfer complete')
      
      // Reset after a moment
      setTimeout(() => {
        isSending.value = false
        sendingProgress.value = 0
      }, 1000)

    } catch (error) {
      console.error('Error sending file:', error)
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
