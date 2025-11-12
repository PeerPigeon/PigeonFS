<template>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1><img src="./assets/pigeonlogo.jpg" alt="PigeonFS" style="height: 1.5em; vertical-align: middle; border-radius: 8px; margin-right: 8px;" /> <span style="color: black;">PigeonFS</span></h1>
      <p>Peer-to-peer file sharing powered by PeerPigeon</p>
    </div>

    <!-- Electron Server Control (only show in Electron) -->
    <div v-if="isElectron" class="card" style="margin-bottom: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">
      <h3 style="color: white;">🖥️ Local Server Control</h3>
      
      <div v-if="!electronServerRunning" style="margin-bottom: 12px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 600; color: white;">Network Name:</label>
            <input 
              v-model="electronServerConfig.networkName"
              type="text"
              placeholder="pigeonfs"
              style="width: 100%; padding: 8px; border-radius: 4px; border: none;"
            />
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; font-weight: 600; color: white;">HTTP Port:</label>
            <input 
              v-model.number="electronServerConfig.httpPort"
              type="number"
              placeholder="3000"
              style="width: 100%; padding: 8px; border-radius: 4px; border: none;"
            />
          </div>
        </div>
        
        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; cursor: pointer;">
          <input 
            type="checkbox" 
            v-model="electronServerConfig.enableCrypto"
            style="width: 18px; height: 18px;"
          />
          <span style="font-weight: 600;">🔒 Enable Encryption</span>
        </label>
        
        <button 
          @click="startElectronServer"
          class="send-button"
          style="width: 100%; background: white; color: #667eea; font-weight: 600;"
        >
          🚀 Start Local Server
        </button>
      </div>
      
      <div v-else>
        <div style="background: rgba(255,255,255,0.2); padding: 12px; border-radius: 8px; margin-bottom: 12px;">
          <div style="font-weight: 600; margin-bottom: 8px;">✅ Server Running</div>
          <div style="font-size: 0.9rem; opacity: 0.9;">
            Network: {{ electronServerConfig.networkName }}<br>
            Port: {{ electronServerConfig.httpPort }}<br>
            Encryption: {{ electronServerConfig.enableCrypto ? 'Enabled' : 'Disabled' }}
          </div>
        </div>
        
        <button 
          @click="stopElectronServer"
          class="send-button"
          style="width: 100%; background: #dc3545; color: white; font-weight: 600;"
        >
          ⏹️ Stop Server
        </button>
      </div>
      
      <!-- Server Logs -->
      <div v-if="electronServerLogs.length > 0" style="margin-top: 12px;">
        <details>
          <summary style="cursor: pointer; font-weight: 600; margin-bottom: 8px;">📋 Server Logs</summary>
          <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; max-height: 200px; overflow-y: auto; font-family: monospace; font-size: 0.75rem;">
            <div v-for="(log, i) in electronServerLogs" :key="i">{{ log }}</div>
          </div>
        </details>
      </div>
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
        :disabled="connectionStatus !== 'disconnected'"
      />
      
      <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; cursor: pointer;">
        <input 
          type="checkbox" 
          v-model="enableEncryption"
          :disabled="connectionStatus !== 'disconnected'"
        />
        <span style="font-weight: 600; color: #333;">🔒 Enable End-to-End Encryption</span>
      </label>
      <div v-if="enableEncryption" style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 8px 12px; margin-bottom: 12px; border-radius: 4px; font-size: 0.85rem;">
        <strong>⚠️ Encryption enabled:</strong> All messages and file transfers will be encrypted. Only peers with matching encryption settings can communicate.
      </div>
      
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

      <!-- Server File Management Section -->
      <div class="card" v-if="connectionStatus === 'connected'">
        <h2>🗄️ Server File Management</h2>
        <p style="margin-bottom: 16px; color: #666; font-size: 0.9rem;">
          Upload files to Node.js server and search indexed files
        </p>

        <!-- Server URL Configuration -->
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 4px; font-weight: 600;">Server URL:</label>
          <input 
            v-model="serverUrl" 
            type="text"
            placeholder="http://localhost:3000"
            style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"
          />
        </div>

        <!-- Upload Files -->
        <div style="border: 2px dashed #cbd5e1; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #f8fafc;">
          <h4 style="font-size: 0.9rem; margin-bottom: 8px; color: #475569;">📤 Upload Files to Server</h4>
          <input 
            type="file" 
            ref="fileUploadInput"
            multiple
            @change="handleServerFileUpload"
            style="margin-bottom: 8px; font-size: 0.85rem;"
          />
          <div v-if="uploadingToServer" style="color: #3b82f6; font-size: 0.85rem;">⏳ Uploading...</div>
          <div v-if="uploadError" style="color: #dc3545; font-size: 0.85rem; margin-top: 4px;">❌ {{ uploadError }}</div>
        </div>

        <!-- File Search -->
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 4px; font-weight: 600;">🔍 Search Server Files:</label>
          <div style="display: flex; gap: 8px;">
            <input 
              v-model="fileSearchQuery"
              type="text"
              placeholder="Search filenames..."
              @keyup.enter="searchServerFiles"
              style="flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px;"
            />
            <button 
              @click="searchServerFiles"
              class="send-button"
              style="width: auto; padding: 8px 16px;"
            >
              Search
            </button>
            <button 
              @click="loadServerFiles"
              class="send-button"
              style="width: auto; padding: 8px 16px; background: #6c757d;"
            >
              Refresh List
            </button>
          </div>
        </div>

        <!-- Search Results or File List -->
        <div v-if="fileSearchResults.length > 0" style="margin-bottom: 16px;">
          <h4 style="font-size: 0.9rem; margin-bottom: 8px;">Search Results ({{ fileSearchResults.length }}):</h4>
          <div style="max-height: 300px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 4px;">
            <div 
              v-for="result in fileSearchResults" 
              :key="result.id"
              style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;"
            >
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 0.9rem;">{{ result.name }}</div>
                <div style="font-size: 0.75rem; color: #666;">
                  {{ formatFileSize(result.size) }} • {{ result.type }}
                </div>
              </div>
              <button 
                @click="downloadServerFile(result)"
                class="send-button"
                style="width: auto; padding: 4px 12px; font-size: 0.85rem;"
              >
                ⬇️ Download
              </button>
            </div>
          </div>
        </div>

        <!-- Server Files List -->
        <div v-else-if="serverFiles.length > 0" style="margin-bottom: 16px;">
          <h4 style="font-size: 0.9rem; margin-bottom: 8px;">Server Files ({{ serverFiles.length }}):</h4>
          <div style="max-height: 300px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 4px;">
            <div 
              v-for="file in serverFiles" 
              :key="file.id"
              style="padding: 8px 12px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center;"
            >
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 0.9rem;">{{ file.name }}</div>
                <div style="font-size: 0.75rem; color: #666;">
                  {{ formatFileSize(file.size) }} • {{ file.type }}
                </div>
              </div>
              <button 
                @click="downloadServerFile(file)"
                class="send-button"
                style="width: auto; padding: 4px 12px; font-size: 0.85rem;"
              >
                ⬇️ Download
              </button>
            </div>
          </div>
        </div>

        <div v-else style="padding: 20px; text-align: center; color: #666; border: 1px solid #e5e7eb; border-radius: 4px;">
          No files on server. Upload some files or check server URL.
        </div>
      </div>

      <!-- Dataset Search Section -->
      <div class="card">
        <h2>📚 P2P Searchable Datasets</h2>
        <p style="margin-bottom: 16px; color: #666; font-size: 0.9rem;">
          Load and search datasets across connected peers using Book.js radix tree structure
        </p>

        <!-- Storage Configuration -->
        <div style="background: #f5f5f5; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 12px;">
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input 
                type="radio" 
                v-model="dataStorageMode" 
                value="memory"
                :disabled="Object.keys(datasets).some(id => datasets[id].loaded)"
              />
              <span>💾 Memory Only</span>
            </label>
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
              <input 
                type="radio" 
                v-model="dataStorageMode" 
                value="indexeddb"
                :disabled="Object.keys(datasets).some(id => datasets[id].loaded)"
              />
              <span>💿 IndexedDB (Persistent)</span>
            </label>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="font-size: 0.9rem; color: #666;">Storage Quota:</label>
            <input 
              type="number" 
              v-model.number="dataStorageQuota" 
              min="1" 
              max="500"
              :disabled="Object.keys(datasets).some(id => datasets[id].loaded)"
              style="width: 80px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px;"
            />
            <span style="font-size: 0.9rem; color: #666;">MB</span>
            <span v-if="dataStorageUsed > 0" style="margin-left: auto; font-size: 0.85rem; color: #666;">
              Used: {{ dataStorageUsed }}MB / {{ dataStorageQuota }}MB
            </span>
          </div>
          <div v-if="Object.keys(datasets).some(id => datasets[id].loaded)" style="margin-top: 8px; font-size: 0.85rem; color: #666;">
            ℹ️ Settings locked after loading. Reload page to change.
          </div>
        </div>

        <!-- Dataset Loading Options -->
        <div style="margin-bottom: 16px;">
          <h3 style="font-size: 1rem; margin-bottom: 12px; color: #333;">Load Dataset:</h3>
          
          <!-- Pre-configured Datasets -->
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px;">
            <div 
              v-for="config in AVAILABLE_DATASETS" 
              :key="config.id"
              style="border: 2px solid #e5e7eb; border-radius: 8px; padding: 12px; cursor: pointer; transition: all 0.2s;"
              :style="{ 
                borderColor: datasets[config.id]?.loaded ? '#10b981' : '#e5e7eb',
                background: datasets[config.id]?.loaded ? '#f0fdf4' : '#fff',
                opacity: datasets[config.id]?.loading ? 0.6 : 1
              }"
              @click="!datasets[config.id]?.loaded && !datasets[config.id]?.loading && loadDatasetById(config.id)"
            >
              <div style="font-size: 2rem; margin-bottom: 8px;">{{ config.icon }}</div>
              <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 4px;">{{ config.name }}</div>
              <div style="font-size: 0.75rem; color: #666;">
                <span v-if="datasets[config.id]?.loaded">✅ Loaded</span>
                <span v-else-if="datasets[config.id]?.loading">⏳ Loading...</span>
                <span v-else>Click to load</span>
              </div>
              <div v-if="datasets[config.id]?.loaded" style="font-size: 0.7rem; color: #10b981; margin-top: 4px;">
                {{ datasets[config.id].itemCount.toLocaleString() }} items
                <span v-if="datasets[config.id].loadedFromCache">💾</span>
              </div>
            </div>
          </div>

          <!-- Upload Custom JSON -->
          <div style="border: 2px dashed #cbd5e1; border-radius: 8px; padding: 16px; background: #f8fafc;">
            <h4 style="font-size: 0.9rem; margin-bottom: 8px; color: #475569;">📤 Upload Custom JSON Dataset</h4>
            <input 
              type="file" 
              ref="jsonFileInput"
              accept=".json"
              @change="handleJsonUpload"
              style="margin-bottom: 8px; font-size: 0.85rem;"
            />
            <div style="font-size: 0.75rem; color: #64748b; margin-bottom: 8px;">
              Expected format: Array of objects with <code>key</code> and <code>value</code> fields
            </div>
            <details style="font-size: 0.75rem; color: #64748b;">
              <summary style="cursor: pointer; margin-bottom: 4px;">Show example format</summary>
              <pre style="background: #fff; padding: 8px; border-radius: 4px; overflow-x: auto; margin-top: 4px;">{{ exampleJsonFormat }}</pre>
            </details>
          </div>
        </div>

        <!-- Bible Stats -->
        <!-- Dataset Stats -->
        <div v-if="datasetLoaded" style="background: #e7f3ff; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 4px;">
            <span>� <strong>{{ datasetItemCount.toLocaleString() }}</strong> items loaded</span>
            <span v-if="datasetLoadedFromCache" style="color: #10b981;">✨ From cache</span>
            <span v-else style="color: #f59e0b;">🌐 From network</span>
          </div>
        </div>

        <!-- Search Interface (always visible) -->
        <div>
          <div style="display: flex; gap: 8px; margin-bottom: 12px;">
            <input 
              ref="searchInput"
              v-model="searchQuery"
              type="text"
              class="target-peer-input"
              style="margin-bottom: 0;"
              placeholder="Search dataset... (e.g., 'love', 'faith', 'beginning')"
              @keyup.enter="performSearch"
              :disabled="searching"
            />
            <button 
              @click="performSearch"
              class="send-button"
              style="width: auto; padding: 8px 24px;"
              :disabled="!searchQuery || searching"
            >
              🔍 Search
            </button>
          </div>

          <!-- Search Stats -->
          <div v-if="!datasetLoaded && !searching && !searchQuery" style="background: #e3f2fd; border-radius: 8px; padding: 12px; margin-bottom: 12px; font-size: 0.9rem; color: #1976d2;">
            💡 <strong>Tip:</strong> You can search without loading the dataset locally - queries will be sent to connected peers who have it loaded!
          </div>

          <div v-if="searchResults.length > 0" style="background: #fff3cd; border-radius: 8px; padding: 12px; margin-bottom: 12px; font-size: 0.9rem;">
            <span v-if="searchTime !== null">
              Found <strong>{{ searchResults.length }}</strong> results in <strong>{{ searchTime }}ms</strong>
              <span v-if="searchPeerResults > 0"> (+ {{ searchPeerResults }} from peers)</span>
            </span>
            <span v-else>
              Found <strong>{{ searchResults.length }}</strong> results from peers
              <span v-if="networkLatency"> in <strong>{{ networkLatency }}ms</strong> network latency</span>
            </span>
          </div>

          <!-- Search Results -->
          <div v-if="searchResults.length > 0" style="max-height: 400px; overflow-y: auto;">
            <div 
              v-for="(result, idx) in searchResults.slice(0, 20)" 
              :key="idx"
              style="background: #f8f9fa; padding: 12px; margin-bottom: 8px; border-radius: 8px; border-left: 3px solid #667eea;"
            >
              <div style="font-weight: 600; color: #667eea; margin-bottom: 4px;">
                {{ result.key }}
              </div>
              <div style="color: #495057; line-height: 1.5;" v-html="highlightSearch(result.value)"></div>
              <div v-if="result.source" style="font-size: 0.8rem; color: #999; margin-top: 4px;">
                Source: {{ result.source }}
              </div>
            </div>
            <div v-if="searchResults.length > 20" style="text-align: center; padding: 12px; color: #666;">
              Showing 20 of {{ searchResults.length }} results
            </div>
          </div>

          <div v-else-if="searchQuery && !searching && !datasetLoaded" style="text-align: center; padding: 40px; color: #999;">
            <div>🔍 Waiting for results from connected peers...</div>
            <div style="font-size: 0.9rem; margin-top: 12px;">
              Make sure at least one peer has loaded the dataset
            </div>
          </div>

          <div v-else-if="searchQuery && !searching" style="text-align: center; padding: 40px; color: #999;">
            No results found for "{{ searchQuery }}"
          </div>
        </div>
      </div>

      <!-- P2P File Search Section -->
      <div class="card">
        <h2>📁 Search Network Files</h2>
        <p style="margin-bottom: 16px; color: #666; font-size: 0.9rem;">
          Search for files hosted on PigeonFS server nodes across the network
        </p>

        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
          <input
            v-model="p2pFileSearchQuery"
            @keyup.enter="searchNetworkFiles"
            type="text"
            placeholder="Search for files..."
            style="flex: 1;"
          />
          <button @click="searchNetworkFiles" :disabled="!p2pFileSearchQuery || !pigeon">
            🔍 Search Network
          </button>
        </div>

        <!-- Search Results -->
        <div v-if="p2pFileSearchResults.length > 0" style="margin-top: 16px;">
          <h4 style="font-size: 0.9rem; margin-bottom: 12px; color: #495057;">
            Found {{ p2pFileSearchResults.length }} files on {{ uniqueFilePeers }} peer(s)
          </h4>
          <div
            v-for="(file, idx) in p2pFileSearchResults.slice(0, 20)"
            :key="idx"
            style="background: #f8f9fa; padding: 12px; margin-bottom: 8px; border-radius: 8px; border-left: 3px solid #28a745;"
          >
            <div style="display: flex; justify-content: space-between; align-items: start;">
              <div style="flex: 1;">
                <div style="font-weight: 600; color: #28a745; margin-bottom: 4px;">
                  {{ file.name }}
                </div>
                <div style="font-size: 0.85rem; color: #666;">
                  {{ formatFileSize(file.size) }} • {{ file.type }}
                </div>
                <div style="font-size: 0.8rem; color: #999; margin-top: 4px;">
                  Peer: {{ file.peerId?.substring(0, 12) }}...
                </div>
                <div v-if="downloadingFiles[file.id]" style="margin-top: 8px;">
                  <div style="background: #e9ecef; border-radius: 4px; height: 20px; overflow: hidden;">
                    <div 
                      style="background: #28a745; height: 100%; transition: width 0.3s;"
                      :style="{ width: downloadingFiles[file.id].progress + '%' }"
                    ></div>
                  </div>
                  <div style="font-size: 0.75rem; color: #666; margin-top: 4px;">
                    {{ downloadingFiles[file.id].progress.toFixed(1) }}% - 
                    {{ formatFileSize(downloadingFiles[file.id].received) }} / {{ formatFileSize(file.size) }}
                  </div>
                </div>
              </div>
              <div style="display: flex; gap: 8px; align-items: start;">
                <div style="font-size: 0.8rem; color: #666; background: #e7f5e9; padding: 4px 8px; border-radius: 4px;">
                  Score: {{ Math.round((file.score || 0) * 100) }}%
                </div>
                <button 
                  @click="downloadP2PFile(file)" 
                  :disabled="downloadingFiles[file.id]"
                  style="padding: 6px 12px; font-size: 0.85rem;"
                >
                  {{ downloadingFiles[file.id] ? '⏳ Downloading...' : '⬇ Download' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="p2pFileSearchQuery && searchingNetworkFiles" style="text-align: center; padding: 40px; color: #999;">
          <div>🔍 Searching network for files...</div>
        </div>

        <div v-else-if="p2pFileSearchQuery && !searchingNetworkFiles" style="text-align: center; padding: 40px; color: #999;">
          No files found on the network for "{{ p2pFileSearchQuery }}"
        </div>
      </div>

      <!-- PagingStorage Section -->
      <div class="card" style="opacity: 0.6; border: 2px dashed #ffc107; background: linear-gradient(45deg, #fff9c4 25%, transparent 25%), linear-gradient(-45deg, #fff9c4 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #fff9c4 75%), linear-gradient(-45deg, transparent 75%, #fff9c4 75%); background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px;">
        <h2>🚧 💾 Distributed Storage - Under Construction 🚧</h2>
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 12px; margin-bottom: 16px;">
          <p style="margin: 0; color: #856404; font-weight: 600;">
            ⚠️ This feature is currently under development and may not work as expected.
          </p>
        </div>
        <p style="margin-bottom: 16px; color: #666; font-size: 0.9rem;">
          Store and sync data across connected peers (when implemented)
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
  testConnection,
  pigeon
} = usePeerPigeon()

// Generic data storage (IndexedDB)
import {
  saveDataset,
  loadDataset,
  saveDatasetIndex,
  loadDatasetIndex,
  saveCachedItem,
  loadCachedItems,
  getCacheStats,
  clearDataset
} from './composables/useDataStorage.js'

// Book.js is loaded via script tag and sets setTimeout.Book
// Use a getter function since Book.js loads after this module
const getBook = () => setTimeout.Book || window.Book

// PagingStorage setup
const storage = usePagingStorage({
  pageSize: 2048, // Smaller pages for demo
  statsUpdateInterval: 2000
})

const selectedFile = ref(null)
const targetPeerId = ref('')

// Electron integration
const isElectron = ref(typeof window !== 'undefined' && window.electronAPI !== undefined)
const electronServerRunning = ref(false)
const electronServerConfig = ref({
  networkName: 'pigeonfs',
  httpPort: 3000,
  enableCrypto: false,
  dataDir: ''
})
const electronServerLogs = ref([])

// Remember network namespace and encryption setting across sessions
const savedNamespace = localStorage.getItem('pigeonfs_network_namespace')
const networkNamespace = ref(savedNamespace || `pigeonfs-${Math.random().toString(36).substr(2, 6)}`)
const savedEncryption = localStorage.getItem('pigeonfs_enable_encryption')
const enableEncryption = ref(savedEncryption !== null ? savedEncryption === 'true' : true) // Default to true

// Save namespace and encryption when they change
watch(networkNamespace, (newValue) => {
  localStorage.setItem('pigeonfs_network_namespace', newValue)
})

watch(enableEncryption, (newValue) => {
  localStorage.setItem('pigeonfs_enable_encryption', newValue.toString())
})

const copied = ref(false)
const sendError = ref('')
const connectionError = ref('')
const fileInput = ref(null)
const peerIdInput = ref(null)
const searchInput = ref(null) // Ref for dataset search input

// Server file management state
const serverUrl = ref('http://localhost:3000')
const serverFiles = ref([])
const serverFileIndex = ref(null)
const serverFileBook = ref(null)
const fileSearchQuery = ref('')
const fileSearchResults = ref([])
const uploadingToServer = ref(false)
const uploadError = ref('')
const fileUploadInput = ref(null)

// P2P File Search state
const p2pFileSearchQuery = ref('')
const p2pFileSearchResults = ref([])
const searchingNetworkFiles = ref(false)
const downloadingFiles = ref({}) // { fileId: { progress, received, chunks } }

// Storage UI state
const storageKey = ref('')
const storageValue = ref('')
const storageResult = ref('')
const storageError = ref('')

// Dataset Configuration
const AVAILABLE_DATASETS = {
  'bible-kjv': {
    id: 'bible-kjv',
    name: 'King James Bible',
    icon: '📖',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/refs/heads/master/json/en_kjv.json',
    loader: (data) => {
      // Convert Bible JSON to Book.js format
      const entries = []
      data.forEach(book => {
        const bookName = book.name
        book.chapters.forEach((chapter, chapterIndex) => {
          chapter.forEach((verse, verseIndex) => {
            const key = `${bookName} ${chapterIndex + 1}:${verseIndex + 1}`
            // Store only key and value - Book.js only needs these two
            // Additional metadata (book, chapter, verse) can be parsed from key if needed
            entries.push({ key, value: verse })
          })
        })
      })
      return entries
    }
  }
  // Future datasets can be added here:
  // 'webster-dict': { name: 'Webster Dictionary', url: '...', loader: ... },
  // 'wikipedia': { name: 'Wikipedia Snapshot', url: '...', loader: ... }
}

// Generic dataset state (replaces Bible-specific state)
const datasets = ref({}) // { datasetId: { loaded, loading, book, index, itemCount, indexSize, loadedFromCache, ... } }
const dataStorageMode = ref('indexeddb') // 'memory' or 'indexeddb'
const dataStorageQuota = ref(500) // MB - increased default for large datasets like Bible
const dataStorageUsed = ref(0) // MB

// Search state (generic across all datasets)
const searchQuery = ref('')
const searchDataset = ref('bible-kjv') // Currently selected dataset for search
const searching = ref(false)
const searchResults = ref([])
const searchTime = ref(0)
const searchPeerResults = ref(0)
const networkLatency = ref(null)

// Computed properties for current dataset
const currentDataset = computed(() => datasets.value[searchDataset.value])
const datasetLoaded = computed(() => currentDataset.value?.loaded || false)
const datasetLoading = computed(() => currentDataset.value?.loading || false)
const datasetLoadedFromCache = computed(() => currentDataset.value?.loadedFromCache || false)
const datasetBook = computed(() => currentDataset.value?.book || null)
const datasetIndex = computed(() => currentDataset.value?.index || null)
const datasetItemCount = computed(() => currentDataset.value?.itemCount || 0)
const datasetIndexSize = computed(() => currentDataset.value?.indexSize || 0)
const datasetStorageUsed = computed(() => currentDataset.value?.storageUsed || 0)
const datasetCachedItemCount = computed(() => currentDataset.value?.cachedItemCount || 0)

// JSON upload state
const jsonFileInput = ref(null)
const exampleJsonFormat = `[
  { "key": "entry1", "value": "First entry text" },
  { "key": "entry2", "value": "Second entry text" },
  { "key": "entry3", "value": "Third entry text" }
]`

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
    await connect({ 
      networkName: networkNamespace.value,
      enableCrypto: enableEncryption.value 
    })
    
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

// Server file management functions
const loadServerFiles = async () => {
  try {
    uploadError.value = ''
    const response = await fetch(`${serverUrl.value}/files`)
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}: ${response.statusText}`)
    }
    
    const data = await response.json()
    
    // Handle both array response and {files: []} response
    serverFiles.value = Array.isArray(data) ? data : (data.files || [])
    
    console.log(`📁 Loaded ${serverFiles.value.length} files from server`)
    
    // Build Book.js index of filenames
    if (serverFiles.value.length > 0) {
      const Book = getBook()
      if (Book) {
        // Create a Book instance and add files to it
        serverFileBook.value = Book()
        
        serverFiles.value.forEach(file => {
          serverFileBook.value(file.name, JSON.stringify(file))
        })
        
        // Create searchable index
        serverFileIndex.value = Book.index(serverFileBook.value)
        console.log(`📚 Built Book.js index for ${serverFiles.value.length} server files`)
      }
    }
    
    fileSearchResults.value = []
  } catch (error) {
    console.error('Failed to load server files:', error)
    uploadError.value = `Failed to load files: ${error.message}`
    serverFiles.value = []
  }
}

const handleServerFileUpload = async (event) => {
  const files = event.target.files
  if (!files || files.length === 0) return
  
  uploadingToServer.value = true
  uploadError.value = ''
  
  try {
    for (const file of files) {
      console.log(`📤 Starting P2P upload: ${file.name} (${formatSize(file.size)})`)
      
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer()
      const buffer = new Uint8Array(arrayBuffer)
      
      // Split into chunks
      const chunkSize = 64 * 1024 // 64KB chunks
      const totalChunks = Math.ceil(buffer.length / chunkSize)
      const fileId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      console.log(`📦 Uploading ${totalChunks} chunks to server`)
      
      // Send chunks to server
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize
        const end = Math.min(start + chunkSize, buffer.length)
        const chunk = Array.from(buffer.slice(start, end))
        
        const message = {
          type: 'file-chunk-upload',
          fileId,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || 'application/octet-stream',
          chunkIndex: i,
          chunk,
          totalChunks,
          isLastChunk: i === totalChunks - 1
        }
        
        await pigeon.sendDirectMessage(serverPeerId.value, message)
        
        const progress = ((i + 1) / totalChunks * 100).toFixed(1)
        console.log(`📤 Sent chunk ${i + 1}/${totalChunks} (${progress}%)`)
      }
      
      console.log(`✅ Upload complete: ${file.name}`)
    }
    
    // Reload file list after upload
    await loadServerFiles()
    
    // Clear input
    if (fileUploadInput.value) {
      fileUploadInput.value.value = ''
    }
  } catch (error) {
    console.error('Upload error:', error)
    uploadError.value = error.message
  } finally {
    uploadingToServer.value = false
  }
}

const searchServerFiles = () => {
  if (!fileSearchQuery.value.trim()) {
    fileSearchResults.value = []
    return
  }
  
  if (!serverFileIndex.value || !serverFileBook.value) {
    uploadError.value = 'No file index available. Load server files first.'
    return
  }
  
  const Book = getBook()
  if (!Book) {
    uploadError.value = 'Book.js not loaded'
    return
  }
  
  try {
    const results = Book.searchIndex(serverFileIndex.value, fileSearchQuery.value)
    
    // Parse JSON values back to file objects
    fileSearchResults.value = results.map(r => {
      try {
        return JSON.parse(r.value)
      } catch (e) {
        return { id: r.key, name: r.key, size: 0, type: 'unknown' }
      }
    })
    
    console.log(`🔍 Found ${fileSearchResults.value.length} files matching "${fileSearchQuery.value}"`)
  } catch (error) {
    console.error('Search error:', error)
    uploadError.value = 'Search failed: ' + error.message
  }
}

// P2P Network File Search
const searchNetworkFiles = async () => {
  if (!pigeon.value || !p2pFileSearchQuery.value.trim()) {
    return
  }

  const requestId = `file-search-${Date.now()}`
  p2pFileSearchResults.value = []
  searchingNetworkFiles.value = true

  const query = p2pFileSearchQuery.value.toLowerCase()

  // First, check DHT for file metadata
  if (storage.isReady?.value) {
    console.log(`🔍 Querying DHT for files matching "${query}"...`)
    try {
      // Query DHT for file metadata
      const dhtKey = `file:${query}`
      const fileMetadata = await storage.get(dhtKey)
      
      if (fileMetadata) {
        try {
          const file = JSON.parse(fileMetadata)
          p2pFileSearchResults.value.push({
            ...file,
            score: 1.0
          })
          console.log(`📦 Found ${file.name} in DHT from peer ${file.peerId?.substring(0, 8)}`)
        } catch (e) {
          console.warn('Failed to parse DHT file metadata:', e)
        }
      }
    } catch (error) {
      console.warn('DHT query failed:', error.message)
    }
  }

  // Also check cached peer file lists for instant results
  if (window._peerFileCache) {
    console.log(`🔍 Searching ${window._peerFileCache.size} cached peer file lists...`)
    
    window._peerFileCache.forEach((peerData, peerId) => {
      const matchingFiles = peerData.files.filter(file => 
        file.name.toLowerCase().includes(query)
      )
      
      if (matchingFiles.length > 0) {
        const results = matchingFiles.map(file => ({
          ...file,
          peerId: peerId,
          score: file.score || 1.0 // Ensure score exists, default to 100%
        }))
        p2pFileSearchResults.value = [...p2pFileSearchResults.value, ...results]
        console.log(`📦 Found ${matchingFiles.length} cached files from ${peerId.substring(0, 8)}`)
      }
    })
    
    // Deduplicate immediately after cache check
    const deduped = new Map()
    p2pFileSearchResults.value.forEach(file => {
      const key = `${file.id}-${file.peerId}`
      const existing = deduped.get(key)
      if (!existing || (file.score || 0) > (existing.score || 0)) {
        deduped.set(key, file)
      }
    })
    p2pFileSearchResults.value = Array.from(deduped.values())
  }

  // Create search request for Book.js indexed search on peers
  const searchRequest = {
    type: 'file-search-request',
    query: p2pFileSearchQuery.value,
    requestId,
    timestamp: Date.now()
  }

  console.log(`🔍 Broadcasting file search: "${p2pFileSearchQuery.value}"`)
  
  // Broadcast the search request
  pigeon.value.gossipManager.broadcastMessage(JSON.stringify(searchRequest), 'chat')

  // Set timeout to stop searching after 5 seconds
  setTimeout(() => {
    searchingNetworkFiles.value = false
    
    if (p2pFileSearchResults.value.length === 0) {
      console.log('🔍 No files found on network')
    } else {
      console.log(`🔍 Search complete: ${p2pFileSearchResults.value.length} total results`)
    }
  }, 5000)
}

const uniqueFilePeers = computed(() => {
  const peers = new Set(p2pFileSearchResults.value.map(f => f.peerId))
  return peers.size
})

// P2P File Download via chunk requests
const downloadP2PFile = async (file) => {
  if (!pigeon.value || downloadingFiles.value[file.id]) {
    return
  }

  console.log(`📥 Starting P2P download for ${file.name} from peer ${file.peerId}`)
  
  // Initialize download state
  downloadingFiles.value[file.id] = {
    progress: 0,
    received: 0,
    chunks: [],
    totalChunks: Math.ceil(file.size / (64 * 1024)), // 64KB chunks
    peerId: file.peerId
  }

  const CHUNK_SIZE = 64 * 1024 // 64KB
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)
  
  // Request chunks one at a time (simple implementation)
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const chunkRequest = {
      type: 'file-chunk-request',
      fileId: file.id,
      chunkIndex,
      timestamp: Date.now()
    }

    console.log(`📥 Requesting chunk ${chunkIndex + 1}/${totalChunks}`)
    
    // Send chunk request directly to the peer
    try {
      await pigeon.value.sendDirectMessage(file.peerId, chunkRequest)
      
      // Wait for chunk response (with timeout)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Chunk timeout')), 30000) // 30 second timeout
        
        const handler = (data) => {
          // Check if this is the chunk we're waiting for
          const content = data.content
          if (data.from === file.peerId && content?.type === 'file-chunk' && 
              content?.fileId === file.id && content?.chunkIndex === chunkIndex) {
            clearTimeout(timeout)
            pigeon.value.off('messageReceived', handler)
            
            // Convert array back to Uint8Array
            const chunkData = new Uint8Array(content.chunk)
            downloadingFiles.value[file.id].chunks[chunkIndex] = chunkData
            downloadingFiles.value[file.id].received += chunkData.length
            downloadingFiles.value[file.id].progress = (downloadingFiles.value[file.id].received / file.size) * 100
            
            console.log(`📥 Received chunk ${chunkIndex + 1}/${totalChunks} (${chunkData.length} bytes)`)
            resolve()
          }
        }
        
        pigeon.value.on('messageReceived', handler)
      })
      
    } catch (error) {
      console.error(`Failed to download chunk ${chunkIndex}:`, error)
      delete downloadingFiles.value[file.id]
      uploadError.value = `Download failed at chunk ${chunkIndex + 1}/${totalChunks}: ${error.message}`
      return
    }
  }

  // All chunks received - reconstruct file
  console.log(`✅ Downloaded all ${totalChunks} chunks`)
  const fileBlob = new Blob(downloadingFiles.value[file.id].chunks, { type: file.type })
  
  // Trigger download
  const url = URL.createObjectURL(fileBlob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  
  delete downloadingFiles.value[file.id]
  console.log(`✅ Downloaded ${file.name} via P2P`)
}

const downloadServerFile = async (file) => {
  try {
    // For server files, we need to get the peer ID
    // Check if this is from a local Electron server by looking for node announcements
    let serverPeer = null
    
    // Check cached peer files for the server
    if (window._peerFileCache) {
      for (const [peerId, peerData] of window._peerFileCache.entries()) {
        const hasFile = peerData.files.some(f => f.id === file.id || f.name === file.name)
        if (hasFile) {
          serverPeer = peerId
          break
        }
      }
    }
    
    if (!serverPeer) {
      uploadError.value = 'Cannot download: Server peer not found. Make sure the Electron server is connected to the network.'
      return
    }
    
    // Use P2P chunk transfer with the found peer
    await downloadP2PFile({ ...file, peerId: serverPeer }, serverPeer)
  } catch (error) {
    console.error('Download error:', error)
    uploadError.value = 'Download failed: ' + error.message
  }
}

// Auto-load server files when connected
watch(connectionStatus, async (newStatus) => {
  if (newStatus === 'connected') {
    try {
      await loadServerFiles()
    } catch (error) {
      console.log('Server not available:', error.message)
    }
  }
})

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

// Electron server control functions
const startElectronServer = async () => {
  if (!window.electronAPI) return
  
  try {
    const result = await window.electronAPI.startServer(electronServerConfig.value)
    if (result.success) {
      electronServerRunning.value = true
      electronServerLogs.value.push(`✅ Server started on port ${result.port}`)
      
      // Update server URL in UI to match Electron server
      serverUrl.value = `http://localhost:${result.port}`
    } else {
      alert('Failed to start server: ' + result.error)
    }
  } catch (error) {
    alert('Error starting server: ' + error.message)
  }
}

const stopElectronServer = async () => {
  if (!window.electronAPI) return
  
  try {
    const result = await window.electronAPI.stopServer()
    if (result.success) {
      electronServerRunning.value = false
      electronServerLogs.value.push('⏹️ Server stopped')
    }
  } catch (error) {
    alert('Error stopping server: ' + error.message)
  }
}

// Setup Electron IPC listeners
if (isElectron.value && window.electronAPI) {
  window.electronAPI.onServerLog((message) => {
    electronServerLogs.value.push(message.trim())
    if (electronServerLogs.value.length > 50) {
      electronServerLogs.value.shift()
    }
  })
  
  window.electronAPI.onServerError((message) => {
    electronServerLogs.value.push('❌ ' + message.trim())
  })
  
  window.electronAPI.onServerStopped((code) => {
    electronServerRunning.value = false
    electronServerLogs.value.push(`⏹️ Server exited with code ${code}`)
  })
  
  // Check initial server status
  window.electronAPI.getServerStatus().then(status => {
    electronServerRunning.value = status.running
  })
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

// Generic Dataset Loading
const loadDatasetById = async (datasetId) => {
  const config = AVAILABLE_DATASETS[datasetId]
  if (!config) {
    throw new Error(`Dataset "${datasetId}" not found`)
  }
  
  // Initialize dataset state
  if (!datasets.value[datasetId]) {
    datasets.value[datasetId] = {
      loaded: false,
      loading: false,
      book: null,
      index: null,
      itemCount: 0,
      indexSize: 0,
      loadedFromCache: false
    }
  }
  
  try {
    datasets.value[datasetId].loading = true
    searchResults.value = []
    
    // Load Book.js from the global scope
    const Book = getBook()
    if (!Book) {
      throw new Error('Book.js not loaded. Make sure book.js is included in index.html')
    }
    
    let rawData
    const useIndexedDB = dataStorageMode.value === 'indexeddb'
    
    // Try loading from IndexedDB if enabled
    if (useIndexedDB) {
      const cachedData = await loadDataset(datasetId)
      const cachedIndex = await loadDatasetIndex(datasetId)
      
      console.log(`🔍 Loading ${datasetId}: cachedData=${cachedData?.length || 0} items, cachedIndex=${cachedIndex ? Object.keys(cachedIndex).length : 0} keys`)
      
      if (cachedData && cachedIndex && cachedData.length > 0) {
        console.log(`📦 Loading ${config.name} from IndexedDB cache...`)
        datasets.value[datasetId].loadedFromCache = true
        
        // Reconstruct Book.js from cached entries
        datasets.value[datasetId].book = new (getBook())()
        
        cachedData.forEach(entry => {
          datasets.value[datasetId].book.set(entry.key, entry.value)
        })
        
        datasets.value[datasetId].itemCount = cachedData.length
        datasets.value[datasetId].index = cachedIndex
        datasets.value[datasetId].indexSize = Object.keys(cachedIndex).length
        
        console.log(`📦 Loaded ${cachedData.length} items from IndexedDB cache`)
        
        // Calculate storage used
        const jsonSize = JSON.stringify(cachedData).length + JSON.stringify(cachedIndex).length
        dataStorageUsed.value = (parseFloat(dataStorageUsed.value) + jsonSize / (1024 * 1024)).toFixed(2)
        
        datasets.value[datasetId].loaded = true
        
        // Broadcast availability
        if (pigeon.value && pigeon.value.gossipManager) {
          const availMessage = {
            type: 'dataset-available',
            datasetId,
            datasetName: config.name,
            items: datasets.value[datasetId].itemCount,
            indexSize: datasets.value[datasetId].indexSize
          }
          await pigeon.value.gossipManager.broadcastMessage(JSON.stringify(availMessage), 'chat')
          console.log(`${config.icon} Broadcasted ${config.name} availability to network`)
        }
        
        datasets.value[datasetId].loading = false
        return
      }
    }
    
    // Fetch from network
    console.log(`🌐 Fetching ${config.name} from network...`)
    const response = await fetch(config.url)
    rawData = await response.json()
    
    // Convert using dataset-specific loader
    const entries = config.loader(rawData)
    
    datasets.value[datasetId].book = new (getBook())()
    
    entries.forEach(entry => {
      datasets.value[datasetId].book.set(entry.key, entry.value)
    })
    
    datasets.value[datasetId].itemCount = entries.length
    
    // Build index for fast searching
    datasets.value[datasetId].index = Book.index(datasets.value[datasetId].book)
    datasets.value[datasetId].indexSize = Object.keys(datasets.value[datasetId].index).length
    
    // Save to IndexedDB if enabled and within quota
    if (useIndexedDB) {
      // Ensure entries are plain objects without functions
      const plainEntries = entries.map(e => ({ key: e.key, value: e.value }))
      
      // Clean the index - ensure it's a plain object without functions
      const plainIndex = JSON.parse(JSON.stringify(datasets.value[datasetId].index))
      
      const jsonSize = JSON.stringify(plainEntries).length + JSON.stringify(plainIndex).length
      const sizeMB = jsonSize / (1024 * 1024)
      
      if (parseFloat(dataStorageUsed.value) + sizeMB <= dataStorageQuota.value) {
        console.log(`💾 Saving ${config.name} data to IndexedDB...`)
        await saveDataset(datasetId, plainEntries)
        await saveDatasetIndex(datasetId, plainIndex)
        dataStorageUsed.value = (parseFloat(dataStorageUsed.value) + sizeMB).toFixed(2)
        console.log(`💾 ${config.name} cached to IndexedDB (${sizeMB.toFixed(2)}MB)`)
      } else {
        console.warn(`⚠️ ${config.name} (${sizeMB.toFixed(2)}MB) exceeds remaining quota - not caching`)
      }
    }
    
    datasets.value[datasetId].loaded = true
    
    // Broadcast availability
    if (pigeon.value && pigeon.value.gossipManager) {
      const availMessage = {
        type: 'dataset-available',
        datasetId,
        datasetName: config.name,
        items: datasets.value[datasetId].itemCount,
        indexSize: datasets.value[datasetId].indexSize
      }
      await pigeon.value.gossipManager.broadcastMessage(JSON.stringify(availMessage), 'chat')
      console.log(`${config.icon} Broadcasted ${config.name} availability to network`)
    }
    
  } catch (error) {
    console.error(`Error loading ${config.name}:`, error)
    alert(`Failed to load ${config.name}: ${error.message}`)
  } finally {
    datasets.value[datasetId].loading = false
  }
}

// JSON Upload Handler
const handleJsonUpload = async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    
    // Validate format
    if (!Array.isArray(data)) {
      alert('Invalid format: JSON must be an array of objects')
      return
    }
    
    if (data.length === 0) {
      alert('Empty dataset')
      return
    }
    
    // Check if entries have key/value fields
    const hasValidFormat = data.every(item => 
      item && typeof item === 'object' && 'key' in item && 'value' in item
    )
    
    if (!hasValidFormat) {
      alert('Invalid format: Each object must have "key" and "value" fields\n\nExample:\n' + exampleJsonFormat)
      return
    }
    
    // Generate dataset ID from filename
    const datasetId = `custom-${file.name.replace(/\.json$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '-')}`
    const datasetName = file.name.replace(/\.json$/i, '')
    
    // Add to available datasets
    AVAILABLE_DATASETS[datasetId] = {
      id: datasetId,
      name: datasetName,
      icon: '📄',
      url: null, // Custom uploaded file
      loader: (rawData) => rawData // Already in correct format
    }
    
    // Initialize dataset state
    datasets.value[datasetId] = {
      loaded: false,
      loading: true,
      book: null,
      index: null,
      itemCount: 0,
      indexSize: 0,
      loadedFromCache: false
    }
    
    // Load Book.js
    const Book = getBook()
    if (!Book) {
      throw new Error('Book.js not loaded')
    }
    
    // Create Book.js instance and populate
    datasets.value[datasetId].book = new (getBook())()
    
    data.forEach(entry => {
      datasets.value[datasetId].book.set(entry.key, entry.value)
    })
    
    datasets.value[datasetId].itemCount = data.length
    
    // Build index
    datasets.value[datasetId].index = Book.index(datasets.value[datasetId].book)
    datasets.value[datasetId].indexSize = Object.keys(datasets.value[datasetId].index).length
    
    // Save to IndexedDB if enabled
    if (dataStorageMode.value === 'indexeddb') {
      const jsonSize = JSON.stringify(data).length + JSON.stringify(datasets.value[datasetId].index).length
      const sizeMB = jsonSize / (1024 * 1024)
      
      if (parseFloat(dataStorageUsed.value) + sizeMB <= dataStorageQuota.value) {
        await saveDataset(datasetId, data)
        await saveDatasetIndex(datasetId, datasets.value[datasetId].index)
        dataStorageUsed.value = (parseFloat(dataStorageUsed.value) + sizeMB).toFixed(2)
        console.log(`💾 Saved custom dataset "${datasetName}" to IndexedDB (${sizeMB.toFixed(2)}MB)`)
      } else {
        console.warn(`⚠️ Dataset exceeds quota - loaded in memory only`)
      }
    }
    
    datasets.value[datasetId].loaded = true
    datasets.value[datasetId].loading = false
    
    // Broadcast availability
    if (pigeon.value && pigeon.value.gossipManager) {
      const availMessage = {
        type: 'dataset-available',
        datasetId,
        datasetName,
        items: datasets.value[datasetId].itemCount,
        indexSize: datasets.value[datasetId].indexSize
      }
      await pigeon.value.gossipManager.broadcastMessage(JSON.stringify(availMessage), 'chat')
      console.log(`📄 Broadcasted custom dataset "${datasetName}" availability to network`)
    }
    
    alert(`✅ Successfully loaded "${datasetName}" with ${data.length.toLocaleString()} items!`)
    
    // Clear input
    if (jsonFileInput.value) {
      jsonFileInput.value.value = ''
    }
    
  } catch (error) {
    console.error('JSON upload error:', error)
    alert(`Failed to load JSON: ${error.message}`)
    
    // Clear input
    if (jsonFileInput.value) {
      jsonFileInput.value.value = ''
    }
  }
}

const performSearch = async () => {
  if (!searchQuery.value) return
  
  // Save the currently focused element
  const activeElement = document.activeElement
  const wasSearchInputFocused = activeElement === searchInput.value
  
  try {
    searching.value = true
    searchResults.value = []
    searchPeerResults.value = 0
    networkLatency.value = null
    
    const Book = getBook()
    const startTime = performance.now() // Track search time
    
    // Search locally if we have the dataset loaded
    if (datasetBook.value && datasetIndex.value) {
      // Try exact/prefix match first
      let results = Book.searchIndex(datasetIndex.value, searchQuery.value, { maxResults: 50 })
      
      // If no results and query looks like a partial word, try substring matching
      if (results.length === 0 && searchQuery.value.length >= 3) {
        const query = searchQuery.value.toLowerCase().trim()
        const matchingKeys = Object.keys(datasetIndex.value).filter(key => 
          key.includes(query) // Substring match: prefix, suffix, or anywhere in between
        )
        
        if (matchingKeys.length > 0) {
          console.log(`🔍 Found ${matchingKeys.length} substring matches for "${query}":`, matchingKeys.slice(0, 5))
          // Get results from all matching keys with scoring
          const seen = new Set()
          results = []
          for (const key of matchingKeys) {
            const items = datasetIndex.value[key] || []
            for (const item of items) {
              if (!seen.has(item.key) && results.length < 50) {
                seen.add(item.key)
                // Calculate relevance score based on match position and length
                const matchIndex = key.indexOf(query)
                const score = matchIndex === 0 ? 1.0 : // Prefix match (best)
                            matchIndex === key.length - query.length ? 0.8 : // Suffix match
                            0.6 // Middle match
                results.push({
                  ...item,
                  score: score,
                  matchedWord: key
                })
              }
            }
          }
          // Sort by score descending
          results.sort((a, b) => b.score - a.score)
        }
      }
      
      const elapsed = performance.now() - startTime
      // Always format as string to preserve decimal places
      searchTime.value = elapsed < 1 ? elapsed.toFixed(2) : Math.round(elapsed).toString()
      searchResults.value = results.map(r => ({ ...r, source: 'local' }))
      console.log(`🔍 Local search found ${results.length} results in ${searchTime.value}ms`)
    } else {
      console.log('🔍 No local dataset - querying peers only')
      searchTime.value = null
    }
    
      // Set network start time right before broadcasting
      window._datasetNetworkStart = performance.now()

    // Always query connected peers using gossip protocol (even if we don't have dataset loaded locally)
    if (pigeon.value && pigeon.value.gossipManager) {
      const searchMessage = {
        type: 'dataset-search-request',
        query: searchQuery.value,
        dataset: searchDataset.value,
        requestId: Date.now()
      }
      
      console.log('📡 Broadcasting dataset search request via gossip:', searchMessage)
      // Stringify the message for gossip protocol
      await pigeon.value.gossipManager.broadcastMessage(JSON.stringify(searchMessage), 'chat')
      console.log('📡 Search request broadcasted to network')
    } else {
      console.warn('⚠️ Cannot broadcast - gossip manager not ready')
    }
    
  } catch (error) {
    console.error('Search error:', error)
    alert('Search failed: ' + error.message)
  } finally {
    searching.value = false
    
    // Restore focus to search input if it was focused before
    if (wasSearchInputFocused && searchInput.value) {
      // Use nextTick to ensure DOM has updated
      setTimeout(() => {
        searchInput.value?.focus()
      }, 0)
    }
  }
}

// Calculate match score for sorting results
const calculateMatchScore = (result, query) => {
  // Use existing score if available (from Book.js or substring matching)
  if (result.score !== undefined) {
    return result.score * 100 // Boost existing scores
  }
  
  const key = result.key?.toLowerCase() || ''
  const value = result.value?.toLowerCase() || ''
  const queryLower = query.toLowerCase()
  
  let score = 0
  
  // Exact match in key (best)
  if (key === queryLower) {
    score = 1000
  }
  // Key starts with query (very good)
  else if (key.startsWith(queryLower)) {
    score = 500
  }
  // Key contains query as whole word
  else if (key.includes(` ${queryLower} `) || key.includes(` ${queryLower}`) || key.includes(`${queryLower} `)) {
    score = 300
  }
  // Key contains query anywhere
  else if (key.includes(queryLower)) {
    score = 200
  }
  
  // Boost if value contains the exact query
  if (value.includes(queryLower)) {
    score += 50
  }
  
  // Boost for multiple word matches in multi-word queries
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2)
  if (queryWords.length > 1) {
    const matchedWords = queryWords.filter(word => 
      value.includes(word) || key.includes(word)
    )
    score += matchedWords.length * 20
  }
  
  return score
}

const highlightSearch = (text) => {
  if (!searchQuery.value || !text) return text
  const regex = new RegExp(`(${escapeRegex(searchQuery.value)})`, 'gi')
  return text.replace(regex, '<span style="background: yellow; font-weight: 600; padding: 2px 4px; border-radius: 2px;">$1</span>')
}

const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Handle dataset search messages from peers
const setupDatasetMessageHandlers = () => {
  if (!pigeon.value) {
    console.warn('⚠️ Cannot setup dataset handlers - pigeon not initialized')
    return
  }
  
  console.log('� Setting up dataset search message handlers...')
  
  pigeon.value.on('messageReceived', async (messageData) => {
    console.log('📨 RAW MESSAGE RECEIVED:', messageData)
    
    const { from, content } = messageData
    
    // Parse JSON string content from gossip messages
    let parsedContent = content
    if (typeof content === 'string') {
      try {
        parsedContent = JSON.parse(content)
      } catch (e) {
        console.log('📨 Ignoring non-JSON string content')
        return
      }
    }
    
    if (!parsedContent || typeof parsedContent !== 'object') {
      console.log('📨 Ignoring non-object content:', typeof parsedContent)
      return
    }
    
    console.log('📨 Received message:', parsedContent.type, 'from', from?.substring(0, 8))
    
    // Get the dataset being searched
    const targetDatasetId = parsedContent.dataset || searchDataset.value
    const targetDataset = datasets.value[targetDatasetId]
    
    // Check if we can serve from full dataset or cached data
    const canServeSearch = (targetDataset?.book && targetDataset?.index) || window._datasetCache?.[targetDatasetId]
    
    if (parsedContent.type === 'dataset-search-request' && canServeSearch) {
      // Peer is requesting search results - serve from full dataset or cache
      const source = targetDataset?.book ? 'full dataset' : 'cache'
      console.log(`� Processing dataset search request from ${source}: "${parsedContent.query}"`)
      const Book = getBook()
      
      let results
      if (targetDataset?.book && targetDataset?.index) {
        // We have full dataset - use index search
        results = Book.searchIndex(targetDataset.index, parsedContent.query, { maxResults: 10 })
        
        // If no results and query looks like a partial word, try substring matching
        if (results.length === 0 && parsedContent.query.length >= 3) {
          const query = parsedContent.query.toLowerCase().trim()
          const matchingKeys = Object.keys(targetDataset.index).filter(key => 
            key.includes(query) // Substring match: prefix, suffix, or anywhere in between
          )
          
          if (matchingKeys.length > 0) {
            console.log(`🔍 Found ${matchingKeys.length} substring matches for "${query}"`)
            // Get results from all matching keys with scoring
            const seen = new Set()
            results = []
            for (const key of matchingKeys) {
              const items = targetDataset.index[key] || []
              for (const item of items) {
                if (!seen.has(item.key) && results.length < 10) {
                  seen.add(item.key)
                  // Calculate relevance score based on match position
                  const matchIndex = key.indexOf(query)
                  const score = matchIndex === 0 ? 1.0 : // Prefix match (best)
                              matchIndex === key.length - query.length ? 0.8 : // Suffix match
                              0.6 // Middle match
                  results.push({
                    ...item,
                    score: score,
                    matchedWord: key
                  })
                }
              }
            }
            // Sort by score descending
            results.sort((a, b) => b.score - a.score)
          }
        }
      } else if (window._datasetCache?.[targetDatasetId]) {
        // We only have cached items - search through the Book.js cache
        const Book = getBook()
        if (Book) {
          const cacheBook = window._datasetCache[targetDatasetId]
          const cacheIndex = Book.index(cacheBook)
          
          if (cacheIndex && Object.keys(cacheIndex).length > 0) {
            results = Book.searchIndex(cacheIndex, parsedContent.query, { maxResults: 10 })
            console.log(`📦 Searched cache (${Object.keys(cacheIndex).length} indexed words), found ${results.length} matching items`)
          } else {
            console.log(`📦 Cache index is empty`)
            results = []
          }
        } else {
          console.warn('Book.js not available for cache search')
          results = []
        }
      }
      
      if (results && results.length > 0) {
        // Broadcast response back via gossip so it reaches the requester and network
        const responseMessage = {
          type: 'dataset-search-response',
          requestId: parsedContent.requestId,
          dataset: targetDatasetId,
          results: results,
          query: parsedContent.query
        }
        
        // Stringify for gossip protocol
        pigeon.value.gossipManager.broadcastMessage(JSON.stringify(responseMessage), 'chat')
        console.log(`� Broadcasted ${results.length} search results to network`)
      }
      
    } else if (parsedContent.type === 'file-search-response') {
      // Received file search results from a server node
      console.log(`📁 Received ${parsedContent.results?.length || 0} file results from peer`)
      
      if (parsedContent.results && parsedContent.results.length > 0) {
        const peerResults = parsedContent.results.map(r => ({
          ...r,
          peerId: parsedContent.peerId || from,
          score: r.score !== undefined ? r.score : 1.0 // Ensure score exists, default to 100%
        }))
        p2pFileSearchResults.value = [...p2pFileSearchResults.value, ...peerResults]
        
        // Deduplicate immediately - keep the one with the best score for each file+peer combo
        const deduped = new Map()
        p2pFileSearchResults.value.forEach(file => {
          const key = `${file.id}-${file.peerId}`
          const existing = deduped.get(key)
          if (!existing || (file.score || 0) > (existing.score || 0)) {
            deduped.set(key, file)
          }
        })
        p2pFileSearchResults.value = Array.from(deduped.values())
        
        console.log(`📁 Total file results: ${p2pFileSearchResults.value.length} (deduplicated)`)
      }
      
    } else if (parsedContent.type === 'node-announcement') {
      // Server node announcing its available files
      console.log(`📡 Node announcement from ${from?.substring(0, 8)}: ${parsedContent.files?.length || 0} files`)
      
      if (parsedContent.files && parsedContent.files.length > 0) {
        // Store peer's file list for automatic discovery
        if (!window._peerFileCache) {
          window._peerFileCache = new Map()
        }
        
        // Add score to all files before caching
        const filesWithScores = parsedContent.files.map(file => ({
          ...file,
          score: file.score || 1.0, // Default to 100% for announced files
          peerId: from // Track which peer has this file
        }))
        
        window._peerFileCache.set(from, {
          peerId: from,
          files: filesWithScores,
          timestamp: parsedContent.timestamp || Date.now()
        })
        
        console.log(`📦 Cached ${filesWithScores.length} files from peer ${from?.substring(0, 8)}`)
        
        // Also store in DHT for distributed discovery
        if (storage.isReady?.value) {
          for (const file of filesWithScores) {
            try {
              const key = `file:${file.name.toLowerCase()}`
              // Store file metadata with peer info
              await storage.set(key, JSON.stringify({
                id: file.id,
                name: file.name,
                size: file.size,
                type: file.type,
                peerId: from,
                timestamp: Date.now()
              }))
              console.log(`📝 Stored ${file.name} metadata in DHT`)
            } catch (error) {
              console.warn(`Failed to store ${file.name} in DHT:`, error.message)
            }
          }
        }
      }
      
    } else if (parsedContent.type === 'dataset-search-response') {
      // Received search results from peer
      if (parsedContent.results && parsedContent.results.length > 0) {
        const peerResults = parsedContent.results.map(r => ({ ...r, source: 'peer' }))
        searchResults.value = [...searchResults.value, ...peerResults]
        searchPeerResults.value += parsedContent.results.length
        
        // Sort combined results by relevance to the search query
        const query = searchQuery.value?.toLowerCase().trim()
        if (query) {
          searchResults.value.sort((a, b) => {
            // Calculate match quality for each result
            const scoreA = calculateMatchScore(a, query)
            const scoreB = calculateMatchScore(b, query)
            return scoreB - scoreA // Descending order (best matches first)
          })
          console.log(`📊 Sorted ${searchResults.value.length} results by relevance`)
        }
        
        // Calculate network latency if this is the first response and we don't have local Bible
        if (window._datasetNetworkStart && networkLatency.value === null) {
          const latency = performance.now() - window._datasetNetworkStart
          networkLatency.value = latency < 1 ? latency.toFixed(2) : Math.round(latency).toString()
          delete window._datasetNetworkStart
        }
        
        // Cache received results to contribute to network robustness
        const datasetId = parsedContent.dataset || searchDataset.value
        if (!datasets.value[datasetId]?.book) {
          // Initialize Book.js cache for this dataset if not already done
          if (!window._datasetCache) window._datasetCache = {}
          if (!window._datasetCache[datasetId]) {
            const Book = getBook()
            window._datasetCache[datasetId] = new Book()
            console.log(`🗂️ Initialized cache for dataset: ${datasetId}`)
          }
          
          // Initialize dataset storage tracking if needed
          if (!datasets.value[datasetId]) {
            datasets.value[datasetId] = { cachedItemCount: 0, storageUsed: 0 }
          }
          
          // Add each item to the cache
          parsedContent.results.forEach(async (item) => {
            const key = item.key
            const value = item.value || item.text
            window._datasetCache[datasetId].set(key, value)
            
            // Persist to IndexedDB if enabled
            if (dataStorageMode.value === 'indexeddb') {
              try {
                const itemSize = JSON.stringify(item).length / (1024 * 1024)
                if (parseFloat(dataStorageUsed.value) + itemSize <= dataStorageQuota.value) {
                  await saveCachedItem(datasetId, item)
                  datasets.value[datasetId].cachedItemCount++
                  datasets.value[datasetId].storageUsed = (parseFloat(datasets.value[datasetId].storageUsed || 0) + itemSize).toFixed(2)
                  dataStorageUsed.value = (parseFloat(dataStorageUsed.value) + itemSize).toFixed(2)
                } else {
                  console.warn('⚠️ Storage quota exceeded - not caching item to IndexedDB')
                }
              } catch (err) {
                console.warn('Failed to save item to IndexedDB:', err)
              }
            } else {
              datasets.value[datasetId].cachedItemCount++
            }
          })
          
          const storageInfo = dataStorageMode.value === 'indexeddb' ? ' (saved to IndexedDB)' : ' (memory only)'
          console.log(`� Received and cached ${parsedContent.results.length} items from peer${storageInfo}`)
        }
      }
    } else if (parsedContent.type === 'dataset-search-request' && !datasets.value[parsedContent.dataset || searchDataset.value]?.book) {
      console.log('� Ignoring search request - dataset not loaded locally')
    }
  })
  
  console.log('✅ Dataset search handlers ready')
}

// Setup dataset handlers when connected
console.log('🔧 Setting up watch for connection status, current value:', connectionStatus.value)

watch(connectionStatus, (status) => {
  console.log('📡 Connection status changed to:', status)
  if (status === 'connected') {
    setupDatasetMessageHandlers()
  }
})

// Also setup handlers immediately if already connected
console.log('🔍 Checking if already connected:', connectionStatus.value)
if (connectionStatus.value === 'connected') {
  console.log('✅ Already connected, setting up handlers now')
  setupDatasetMessageHandlers()
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

// Watch search query for real-time search
let searchTimeout = null
watch(searchQuery, (newQuery) => {
  // Clear any pending search
  if (searchTimeout) {
    clearTimeout(searchTimeout)
  }
  
  // Only search if query is at least 3 characters
  if (!newQuery || newQuery.trim().length < 3) {
    searchResults.value = []
    return
  }
  
  // Debounce search by 300ms
  searchTimeout = setTimeout(() => {
    if (datasetBook.value || pigeon.value) {
      console.log(`🔍 Auto-searching for: "${newQuery}"`)
      performSearch()
    }
  }, 300)
}, { flush: 'post' }) // Run after DOM updates to avoid stealing focus

// Watch file search query for real-time network file search
let fileSearchTimeout = null
watch(p2pFileSearchQuery, (newQuery) => {
  // Clear any pending search
  if (fileSearchTimeout) {
    clearTimeout(fileSearchTimeout)
  }
  
  // Only search if query is at least 2 characters
  if (!newQuery || newQuery.trim().length < 2) {
    p2pFileSearchResults.value = []
    return
  }
  
  // Debounce search by 400ms (slightly longer for network search)
  fileSearchTimeout = setTimeout(() => {
    if (pigeon.value) {
      console.log(`📁 Auto-searching network files for: "${newQuery}"`)
      searchNetworkFiles()
    }
  }, 400)
}, { flush: 'post' }) // Run after DOM updates to avoid stealing focus

// No auto-connect - user must manually connect
onMounted(async () => {
  // App is ready, but not automatically connecting
  console.log('PigeonFS app loaded - ready to connect when user chooses')
  
  // Wait for Book.js to be available (it's loaded via script tag)
  let Book = window.Book || setTimeout.Book
  if (!Book) {
    console.log('Waiting for Book.js to load...')
    // Poll for Book.js with timeout
    for (let i = 0; i < 50; i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      if (window.Book || setTimeout.Book) {
        Book = window.Book || setTimeout.Book
        console.log('Book.js loaded successfully')
        break
      }
    }
    if (!Book) {
      console.error('Book.js failed to load after 5 seconds')
      return
    }
  }
  
  // Check for stored datasets in IndexedDB if enabled
  if (dataStorageMode.value === 'indexeddb') {
    try {
      
      // Check all configured datasets
      for (const [datasetId, config] of Object.entries(AVAILABLE_DATASETS)) {
        try {
          const cachedData = await loadDataset(datasetId)
          const cachedIndex = await loadDatasetIndex(datasetId)
          
          console.log(`🔍 Checking ${datasetId}: cachedData=${cachedData?.length || 0} items, cachedIndex=${cachedIndex ? Object.keys(cachedIndex).length : 0} keys`)
          
          if (cachedData && cachedIndex && cachedData.length > 0) {
            // Initialize dataset state - use the Book reference we got earlier
            datasets.value[datasetId] = {
              loaded: true,
              loading: false,
              book: new (getBook())(),
              index: cachedIndex,
              itemCount: cachedData.length,
              indexSize: Object.keys(cachedIndex).length,
              loadedFromCache: true
            }
            
            // Populate Book.js
            cachedData.forEach(entry => {
              datasets.value[datasetId].book.set(entry.key, entry.value)
            })
            
            // Calculate size
            const jsonSize = JSON.stringify(cachedData).length + JSON.stringify(cachedIndex).length
            const sizeMB = jsonSize / (1024 * 1024)
            dataStorageUsed.value = (parseFloat(dataStorageUsed.value) + sizeMB).toFixed(2)
            
            console.log(`📦 Auto-loaded ${config.name} from IndexedDB (${cachedData.length} items, ${sizeMB.toFixed(2)}MB)`)
          }
        } catch (err) {
          console.log(`No cached data for ${config.name}`)
        }
      }
      
      // Also load cached items (partial data from peer searches) for all datasets
      for (const datasetId of Object.keys(AVAILABLE_DATASETS)) {
        const cachedItems = await loadCachedItems(datasetId)
        if (cachedItems && cachedItems.length > 0) {
          if (!window._datasetCache) window._datasetCache = {}
          if (!window._datasetCache[datasetId]) {
            window._datasetCache[datasetId] = new (getBook())()
          }
          
          if (!datasets.value[datasetId]) {
            datasets.value[datasetId] = { cachedItemCount: 0, storageUsed: 0 }
          }
          
          let totalSize = 0
          cachedItems.forEach(item => {
            const key = item.key || `${item.book} ${item.chapter}:${item.verse}`
            const value = item.value || item.text
            window._datasetCache[datasetId].set(key, value)
            totalSize += JSON.stringify(item).length
          })
          
          datasets.value[datasetId].cachedItemCount = cachedItems.length
          const sizeMB = totalSize / (1024 * 1024)
          datasets.value[datasetId].storageUsed = sizeMB.toFixed(2)
          dataStorageUsed.value = (parseFloat(dataStorageUsed.value) + sizeMB).toFixed(2)
          console.log(`📦 Loaded ${cachedItems.length} cached items for ${datasetId} from IndexedDB (${sizeMB.toFixed(2)}MB)`)
        }
      }
      
    } catch (err) {
      console.warn('Failed to load cached data from IndexedDB:', err)
    }
  }
})

// Cleanup on unmount
onUnmounted(async () => {
  if (storage.isReady?.value) {
    await storage.shutdown()
  }
  disconnect()
})
</script>
