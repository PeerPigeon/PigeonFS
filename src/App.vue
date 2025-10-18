<template>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1><img src="./assets/pigeonlogo.jpg" alt="PigeonFS" style="height: 1.5em; vertical-align: middle; border-radius: 8px; margin-right: 8px;" /> <span style="color: black;">PigeonFS</span></h1>
      <p>Peer-to-peer file sharing powered by PeerPigeon</p>
    </div>

    <!-- Network Configuration -->
    <div class="card" style="margin-bottom: 20px;">
      <h3>🌐 Network Settings</h3>
      <label style="display: block; margin-bottom: 8px; font-weight: 600; color: #333;">
        Network Namespace:
      </label>
      <input 
        v-model="networkNamespace"
        type="text"
        class="target-peer-input"
        style="margin-bottom: 12px;"
        placeholder="Enter network name (e.g., 'myproject', 'team1')"
      />
      <p style="margin: 0; font-size: 0.9rem; color: #666;">
        🔒 Only peers in the same network namespace can discover and connect to each other.
        <br>📝 Use a unique name to create a private network for your group.
        <br><strong>Status:</strong> {{ connectionStatus }}
      </p>
    </div>

    <!-- Connection Status -->
    <div :class="['connection-status', connectionStatus]">
      <div>
        <strong>Status:</strong>
        <span v-if="connectionStatus === 'connected'"> ✅ Connected to PigeonHub</span>
        <span v-else-if="connectionStatus === 'connecting'"> 🔄 Connecting...</span>
        <span v-else> ❌ Disconnected</span>
      </div>
      <button 
        v-if="connectionStatus === 'disconnected'" 
        @click="handleConnect"
        class="send-button"
        style="width: auto; padding: 8px 16px;"
      >
        Connect
      </button>
      <button 
        v-else-if="connectionStatus === 'connected'" 
        @click="disconnect"
        class="send-button"
        style="width: auto; padding: 8px 16px; background: #dc3545;"
      >
        Disconnect
      </button>
    </div>

    <!-- Connection Error -->
    <div v-if="connectionError" style="color: #dc3545; margin-top: 12px; padding: 16px; background: #f8d7da; border-radius: 8px; border: 1px solid #f5c6cb;">
      ❌ {{ connectionError }}
    </div>

    <!-- My Peer ID -->
    <div v-if="connectionStatus === 'connected'" class="peer-id">
      <div style="flex: 1;">
        <label style="display: block; margin-bottom: 4px; font-weight: 600; color: #333;">
          Your Peer ID:
        </label>
        <input 
          :value="myPeerId" 
          readonly 
          style="width: 100%;"
          ref="peerIdInput"
        />
      </div>
      <button @click="copyPeerId">
        {{ copied ? '✓ Copied!' : '📋 Copy' }}
      </button>
    </div>

    <!-- Main Content - Send and Receive -->
    <div v-if="connectionStatus === 'connected'" class="main-content">
      <!-- Send File Section -->
      <div class="card">
        <h2>📤 Send File</h2>
        
        <div class="file-input-wrapper">
          <input 
            type="file" 
            id="file-input" 
            @change="handleFileSelect"
            ref="fileInput"
          />
          <label 
            for="file-input" 
            :class="['file-input-label', { 'has-file': selectedFile }]"
          >
            <div v-if="!selectedFile">
              <div style="font-size: 3rem; margin-bottom: 12px;">📁</div>
              <div style="font-weight: 600; margin-bottom: 4px;">Click to select a file</div>
              <div style="font-size: 0.9rem; color: #666;">or drag and drop</div>
            </div>
            <div v-else>
              <div style="font-size: 3rem; margin-bottom: 12px;">📄</div>
              <div style="font-weight: 600; margin-bottom: 4px;">{{ selectedFile.name }}</div>
              <div style="font-size: 0.9rem; color: #666;">{{ formatFileSize(selectedFile.size) }}</div>
            </div>
          </label>
        </div>

        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
          <input 
            v-model="targetPeerId"
            type="text"
            class="target-peer-input"
            style="margin-bottom: 0;"
            placeholder="Enter recipient's Peer ID"
            :disabled="isSending"
            @paste.stop
          />
          <button 
            @click="pasteFromClipboard"
            class="send-button"
            style="width: auto; padding: 8px 16px;"
            :disabled="isSending"
          >
            📋 Paste
          </button>
        </div>

        <button 
          @click="handleSendFile"
          class="send-button"
          :disabled="!selectedFile || !targetPeerId || isSending"
        >
          {{ isSending ? 'Sending...' : '🚀 Send File' }}
        </button>

        <div v-if="isSending" class="progress-bar">
          <div 
            class="progress-bar-fill" 
            :style="{ width: sendingProgress + '%' }"
          ></div>
        </div>
        <div v-if="isSending" style="text-align: center; margin-top: 8px; color: #666;">
          {{ Math.round(sendingProgress) }}% complete
        </div>

        <div v-if="sendError" style="color: #dc3545; margin-top: 12px; padding: 12px; background: #f8d7da; border-radius: 8px;">
          ❌ {{ sendError }}
        </div>
      </div>

      <!-- Receive Files Section -->
      <div class="card">
        <h2>📥 Received Files</h2>
        
        <div v-if="receivedFiles.length === 0" class="empty-state">
          <div class="empty-state-icon">📭</div>
          <div>No files received yet</div>
          <div style="font-size: 0.9rem; margin-top: 8px;">
            Share your Peer ID to receive files
          </div>
        </div>

        <ul v-else class="file-list">
          <li 
            v-for="file in receivedFiles" 
            :key="file.id"
            class="file-item"
          >
            <div class="file-item-header">
              <div>
                <div class="file-name">{{ file.name }}</div>
                <div class="file-size">{{ formatFileSize(file.size) }}</div>
              </div>
            </div>

            <div v-if="file.status === 'receiving'" class="progress-bar">
              <div 
                class="progress-bar-fill" 
                :style="{ width: file.progress + '%' }"
              ></div>
            </div>

            <div class="file-status">
              <span v-if="file.status === 'receiving'">
                📡 Receiving... {{ Math.round(file.progress) }}%
              </span>
              <span v-else-if="file.status === 'complete'">
                ✅ Complete
              </span>
            </div>

            <button 
              v-if="file.status === 'complete'"
              @click="downloadFile(file.id)"
              class="download-button"
            >
              💾 Download
            </button>
          </li>
        </ul>
      </div>

      <!-- PagingStorage Section -->
      <div class="card">
        <h2>💾 Distributed Storage</h2>
        <p style="margin-bottom: 16px; color: #666; font-size: 0.9rem;">
          Store and sync data across connected peers
        </p>

        <!-- Storage Status -->
        <div class="storage-status" style="margin-bottom: 16px;">
          <div style="display: flex; gap: 16px; font-size: 0.9rem;">
            <span>Status: <strong :style="{ color: storageReady ? '#28a745' : '#dc3545' }">
              {{ storageReady ? '✅ Ready' : '❌ Not Ready' }}
            </strong></span>
            <span>Peers: <strong>{{ storagePeerCount }}</strong></span>
            <span>Keys: <strong>{{ storageTotalKeys }}</strong></span>
            <span>Pages: <strong>{{ storageTotalPages }}</strong></span>
          </div>
        </div>

        <!-- Storage Operations -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 600;">Key:</label>
            <input 
              v-model="storageKey" 
              placeholder="e.g., user:123" 
              style="width: 100%;"
              @keyup.enter="handleStorageGet"
            />
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 600;">Value:</label>
            <input 
              v-model="storageValue" 
              placeholder="Enter value or JSON" 
              style="width: 100%;"
              @keyup.enter="handleStorageSet"
            />
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
          <button 
            @click="handleStorageSet"
            class="send-button"
            style="flex: 1; padding: 8px;"
            :disabled="!storageReady || !storageKey || !storageValue"
          >
            💾 Store
          </button>
          <button 
            @click="handleStorageGet"
            class="send-button"
            style="flex: 1; padding: 8px; background: #17a2b8;"
            :disabled="!storageReady || !storageKey"
          >
            🔍 Get
          </button>
          <button 
            @click="handleStorageDelete"
            class="send-button"
            style="flex: 1; padding: 8px; background: #dc3545;"
            :disabled="!storageReady || !storageKey"
          >
            🗑️ Delete
          </button>
        </div>

        <!-- Quick Actions -->
        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
          <button 
            @click="runStorageDemo"
            class="send-button"
            style="flex: 1; padding: 6px; background: #6f42c1; font-size: 0.85rem;"
            :disabled="!storageReady"
          >
            🎯 Run Demo
          </button>
          <button 
            @click="clearStorage"
            class="send-button"
            style="flex: 1; padding: 6px; background: #fd7e14; font-size: 0.85rem;"
            :disabled="!storageReady"
          >
            🧹 Clear Cache
          </button>
          <button 
            @click="exportStorage"
            class="send-button"
            style="flex: 1; padding: 6px; background: #20c997; font-size: 0.85rem;"
            :disabled="!storageReady"
          >
            📤 Export
          </button>
        </div>

        <!-- Storage Results -->
        <div v-if="storageResult" class="storage-result" style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 4px; font-weight: 600;">Result:</label>
          <pre style="background: #f8f9fa; padding: 12px; border-radius: 4px; font-size: 0.8rem; max-height: 150px; overflow-y: auto;">{{ storageResult }}</pre>
        </div>

        <!-- Storage Error -->
        <div v-if="storageError" style="color: #dc3545; margin-bottom: 16px; padding: 12px; background: #f8d7da; border-radius: 8px; font-size: 0.9rem;">
          ❌ {{ storageError }}
        </div>

        <!-- Storage Stats -->
        <details style="margin-top: 16px;">
          <summary style="cursor: pointer; font-weight: 600; margin-bottom: 8px;">📊 Advanced Stats</summary>
          <div v-if="storageStats" style="font-size: 0.8rem; color: #666;">
            <div><strong>Memory Pressure:</strong> {{ (storageMemoryPressure * 100).toFixed(1) }}%</div>
            <div><strong>Load Balanced:</strong> {{ storageLoadBalanced ? 'Yes' : 'No' }}</div>
            <div><strong>Average Page Size:</strong> {{ storageStats.averagePageSize?.toFixed(0) || 0 }} bytes</div>
            <div v-if="storageStats.cache">
              <strong>Cache:</strong> 
              {{ storageStats.cache.memoryPages }}/{{ storageStats.cache.maxMemoryPages }} memory pages,
              {{ storageStats.cache.dirtyPages }} dirty
            </div>
          </div>
        </details>
      </div>
    </div>

    <!-- Welcome Screen (when not connected) -->
    <div v-else class="welcome-screen">
      <div class="empty-state-icon">
        <img src="./assets/pigeonlogo.jpg" alt="PigeonFS" style="width: 120px; height: 120px; border-radius: 16px;" />
      </div>
      <h2>Welcome to PigeonFS</h2>
      <p>Secure peer-to-peer file sharing using WebRTC</p>
      <button 
        @click="handleConnect"
        class="send-button"
        style="width: auto; margin-top: 24px; padding: 12px 32px;"
      >
        🚀 Get Started
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { usePeerPigeon } from './composables/usePeerPigeon'
import { usePagingStorage } from './composables/usePagingStorage'

const {
  myPeerId,
  connectionStatus,
  receivedFiles,
  sendingProgress,
  isSending,
  connect,
  sendFile,
  downloadFile,
  disconnect,
  pigeon
} = usePeerPigeon()

// PagingStorage setup
const storage = usePagingStorage({
  pageSize: 2048, // Smaller pages for demo
  statsUpdateInterval: 2000
})

const selectedFile = ref(null)
const targetPeerId = ref('')
const networkNamespace = ref(`pigeonfs-${Math.random().toString(36).substr(2, 6)}`)  // Default with random suffix
const copied = ref(false)
const sendError = ref('')
const connectionError = ref('')
const fileInput = ref(null)
const peerIdInput = ref(null)

// Storage UI state
const storageKey = ref('')
const storageValue = ref('')
const storageResult = ref('')
const storageError = ref('')

// Storage reactive properties
const storageReady = computed(() => storage.isReady?.value || false)
const storagePeerCount = computed(() => storage.peerCount?.value || 0)
const storageTotalKeys = computed(() => storage.totalKeys?.value || 0)
const storageTotalPages = computed(() => storage.totalPages?.value || 0)
const storageMemoryPressure = computed(() => storage.memoryPressure?.value || 0)
const storageLoadBalanced = computed(() => storage.isLoadBalanced?.value || false)
const storageStats = computed(() => storage.stats || {})

const handleConnect = async () => {
  try {
    connectionError.value = ''
    storageError.value = ''
    await connect({ networkName: networkNamespace.value })
    
    // Initialize storage when connected
    if (pigeon.value) {
      console.log('Initializing PagingStorage...')
      await storage.initialize(pigeon.value)
      console.log('PagingStorage ready!')
    }
  } catch (error) {
    console.error('Connection failed:', error)
    connectionError.value = error.message || 'Failed to connect to PigeonHub. Please try again.'
  }
}

const handleFileSelect = (event) => {
  const file = event.target.files[0]
  if (file) {
    selectedFile.value = file
    sendError.value = ''
  }
}

const handleSendFile = async () => {
  if (!selectedFile.value || !targetPeerId.value) return
  
  try {
    sendError.value = ''
    await sendFile(selectedFile.value, targetPeerId.value)
    
    // Reset form
    selectedFile.value = null
    if (fileInput.value) {
      fileInput.value.value = ''
    }
  } catch (error) {
    console.error('Send failed:', error)
    sendError.value = error.message || 'Failed to send file. Please check the Peer ID and try again.'
  }
}

const copyPeerId = async () => {
  try {
    await navigator.clipboard.writeText(myPeerId.value)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch (error) {
    // Fallback for browsers that don't support clipboard API
    if (peerIdInput.value) {
      peerIdInput.value.select()
      document.execCommand('copy')
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 2000)
    }
  }
}

const pasteFromClipboard = async () => {
  try {
    const text = await navigator.clipboard.readText()
    targetPeerId.value = text
  } catch (error) {
    console.error('Failed to paste:', error)
    alert('Failed to paste. Please use Cmd+V or type the peer ID.')
  }
}

const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

// Storage operation handlers
const handleStorageSet = async () => {
  try {
    storageError.value = ''
    storageResult.value = ''
    
    if (!storageKey.value || !storageValue.value) return
    
    // Try to parse as JSON, fallback to string
    let value = storageValue.value
    try {
      value = JSON.parse(storageValue.value)
    } catch {
      // Keep as string if not valid JSON
    }
    
    await storage.set(storageKey.value, value)
    storageResult.value = `✅ Stored: ${storageKey.value}`
    
    // Clear value after successful store
    storageValue.value = ''
    
  } catch (error) {
    console.error('Storage set error:', error)
    storageError.value = `Failed to store: ${error.message}`
  }
}

const handleStorageGet = async () => {
  try {
    storageError.value = ''
    storageResult.value = ''
    
    if (!storageKey.value) return
    
    const value = await storage.get(storageKey.value)
    
    if (value !== undefined) {
      storageResult.value = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      storageValue.value = storageResult.value
    } else {
      storageResult.value = '❌ Key not found'
    }
    
  } catch (error) {
    console.error('Storage get error:', error)
    storageError.value = `Failed to retrieve: ${error.message}`
  }
}

const handleStorageDelete = async () => {
  try {
    storageError.value = ''
    storageResult.value = ''
    
    if (!storageKey.value) return
    
    const deleted = await storage.remove(storageKey.value)
    
    if (deleted) {
      storageResult.value = `✅ Deleted: ${storageKey.value}`
      storageValue.value = ''
    } else {
      storageResult.value = '❌ Key not found or already deleted'
    }
    
  } catch (error) {
    console.error('Storage delete error:', error)
    storageError.value = `Failed to delete: ${error.message}`
  }
}

const runStorageDemo = async () => {
  try {
    storageError.value = ''
    storageResult.value = 'Running demo...'
    
    // Store some demo data
    const demoData = {
      'demo:user': { name: 'Alice', role: 'admin' },
      'demo:config': { theme: 'dark', lang: 'en' },
      'demo:counter': 42,
      'demo:message': 'Hello from PagingStorage!',
      'demo:timestamp': new Date().toISOString()
    }
    
    let stored = 0
    for (const [key, value] of Object.entries(demoData)) {
      await storage.set(key, value)
      stored++
    }
    
    // Retrieve and display one item
    const user = await storage.get('demo:user')
    
    storageResult.value = `✅ Demo complete!\nStored ${stored} items\nSample data: ${JSON.stringify(user, null, 2)}`
    
  } catch (error) {
    console.error('Demo error:', error)
    storageError.value = `Demo failed: ${error.message}`
  }
}

const clearStorage = async () => {
  try {
    storageError.value = ''
    await storage.clearCache()
    storageResult.value = '✅ Cache cleared'
  } catch (error) {
    console.error('Clear error:', error)
    storageError.value = `Failed to clear cache: ${error.message}`
  }
}

const exportStorage = async () => {
  try {
    storageError.value = ''
    const exported = storage.exportData()
    
    if (exported && exported.totalKeys > 0) {
      // Create downloadable file
      const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pigeonfs-storage-${exported.peerId}-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      
      storageResult.value = `✅ Exported ${exported.totalKeys} keys to file`
    } else {
      storageResult.value = '❌ No data to export'
    }
    
  } catch (error) {
    console.error('Export error:', error)
    storageError.value = `Failed to export: ${error.message}`
  }
}

// Watch for connection status changes
watch(connectionStatus, async (newStatus) => {
  if (newStatus === 'connected' && pigeon.value && !storage.isReady?.value) {
    try {
      console.log('Auto-initializing PagingStorage...')
      await storage.initialize(pigeon.value)
      console.log('PagingStorage auto-initialized!')
    } catch (error) {
      console.error('Failed to auto-initialize storage:', error)
      storageError.value = `Storage initialization failed: ${error.message}`
    }
  }
})

// No auto-connect - user must manually connect
onMounted(() => {
  // App is ready, but not automatically connecting
  console.log('PigeonFS app loaded - ready to connect when user chooses')
})

// Cleanup on unmount
onUnmounted(async () => {
  if (storage.isReady?.value) {
    await storage.shutdown()
  }
  disconnect()
})
</script>
