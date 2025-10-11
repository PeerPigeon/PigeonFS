<template>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1><img src="./assets/pigeonlogo.jpg" alt="PigeonFS" style="height: 1.5em; vertical-align: middle; border-radius: 8px; margin-right: 8px;" /> <span style="color: black;">PigeonFS</span></h1>
      <p>Peer-to-peer file sharing powered by PeerPigeon</p>
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
import { ref, onMounted, onUnmounted } from 'vue'
import { usePeerPigeon } from './composables/usePeerPigeon'

const {
  myPeerId,
  connectionStatus,
  receivedFiles,
  sendingProgress,
  isSending,
  connect,
  sendFile,
  downloadFile,
  disconnect
} = usePeerPigeon()

const selectedFile = ref(null)
const targetPeerId = ref('')
const copied = ref(false)
const sendError = ref('')
const connectionError = ref('')
const fileInput = ref(null)
const peerIdInput = ref(null)

const handleConnect = async () => {
  try {
    connectionError.value = ''
    await connect()
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

// Auto-connect on mount
onMounted(() => {
  handleConnect()
})

// Cleanup on unmount
onUnmounted(() => {
  disconnect()
})
</script>
