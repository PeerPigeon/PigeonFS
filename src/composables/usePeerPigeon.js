import { ref, reactive } from 'vue'

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
  const connect = async () => {
    try {
      connectionStatus.value = 'connecting'
      
      console.log('Initializing PeerPigeonMesh...')
      
      pigeon.value = new PeerPigeonMesh({
        enableWebDHT: false,
        enableCrypto: false,
        enableDistributedStorage: false,
        maxPeers: 10,
        minPeers: 1,
        autoConnect: true,
        autoDiscovery: true
      })

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
        console.log('📨 Message received:', messageData)
        handleIncomingData(messageData.content, messageData.from)
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
      
      // Check if this is metadata or chunk data
      if (data.type === 'file-metadata') {
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
          buffer.chunks[data.chunkIndex] = data.chunk
          buffer.receivedChunks++
          
          // Update progress
          const progress = (buffer.receivedChunks / buffer.totalChunks) * 100
          receivedFiles[fileIndex].progress = progress
          receivedFiles[fileIndex].receivedSize = buffer.receivedChunks * CHUNK_SIZE
          
          // Check if all chunks received
          if (buffer.receivedChunks === buffer.totalChunks) {
            // Combine all chunks into a blob
            const completeData = new Uint8Array(
              buffer.chunks.reduce((acc, chunk) => acc + chunk.length, 0)
            )
            let offset = 0
            for (const chunk of buffer.chunks) {
              completeData.set(chunk, offset)
              offset += chunk.length
            }
            
            const blob = new Blob([completeData])
            receivedFiles[fileIndex].blob = blob
            receivedFiles[fileIndex].status = 'complete'
            receivedFiles[fileIndex].progress = 100
            
            console.log(`File received: ${receivedFiles[fileIndex].name}`)
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

      const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

      console.log(`📋 File metadata: ID=${fileId}, totalChunks=${totalChunks}`)

      // Send file metadata first
      await pigeon.value.sendDirectMessage(targetPeerId, {
        type: 'file-metadata',
        fileId: fileId,
        name: file.name,
        size: file.size,
        totalChunks: totalChunks
      })

      console.log(`Sending file: ${file.name} (${file.size} bytes) in ${totalChunks} chunks`)

      // Read and send file in chunks
      let offset = 0
      let chunkIndex = 0

      while (offset < file.size) {
        const chunk = file.slice(offset, offset + CHUNK_SIZE)
        const arrayBuffer = await chunk.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)

        await pigeon.value.sendDirectMessage(targetPeerId, {
          type: 'file-chunk',
          fileId: fileId,
          chunkIndex: chunkIndex,
          chunk: uint8Array
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
    disconnect
  }
}
