# PigeonFS

**Peer-to-peer file sharing and distributed storage using PeerPigeon**

PigeonFS enables direct file transfer between browsers with no central server. Send any file type (videos, images, documents, etc.) directly to peers, plus distributed key-value storage and searchable datasets.

## Features

### Direct P2P File Transfer
- 📁 **Any File Type** - Send videos (MP4), images, PDFs, documents, archives - anything!
- 🚀 **Direct Transfer** - Files sent peer-to-peer via WebRTC data channels (no server middleman)
- ⚡ **Chunked Streaming** - 64KB chunks with progress tracking for large files
- 🔄 **Automatic Reconnect** - Handles connection drops and peer discovery
- 💾 **Browser Download** - Received files can be saved directly to disk
- 📊 **Transfer Stats** - Real-time progress, speed, and file info
- 🔒 **Optional Encryption** - End-to-end encryption with AES-GCM (toggle in UI)

### Distributed Storage (PagingStorage)

### Chunk Storage System (NEW!)
- 🧩 **Intelligent Chunking** - Automatic file splitting into 64KB chunks
- 🌐 **Platform-Aware** - Different strategies for browser vs node peers
  - **Browser**: Store only chunks based on DHT proximity (saves space)
  - **Node/App**: Use 10% of quota for chunks + whole files if they fit
- � **Filename Hash Index** - Fast O(1) lookups with case-insensitive search
- 📊 **Quota Management** - Automatic LRU eviction and cleanup
- 🔄 **DHT Distribution** - Chunks distributed via consistent hashing
- 💾 **Hybrid Storage** - Small files stored whole, large files chunked

### Dataset Search
- 📁 **JSON Dataset Upload** - Upload structured datasets to make searchable locally
- 🔍 **P2P Search** - Search datasets without loading them - queries route through peers
- 📚 **Multiple Datasets** - Generic system supports any dataset (Bible, dictionaries, wikis, etc.)
- ⚡ **Book.js Integration** - Fast radix tree indexing for efficient full-text search
- 💾 **Smart Caching** - Auto-caches search results to IndexedDB to contribute to network robustness
- 🌐 **Gossip Protocol** - Search requests broadcast to all connected peers
- 📊 **Real-time Stats** - Track local/peer results, network latency, and storage usage

## Architecture

- **PeerPigeon** - P2P networking, gossip protocol, peer discovery, WebRTC data channels
- **WebRTC Data Channels** - Direct browser-to-browser file streaming
- **PagingStorage** - Distributed hash table for key-value storage and sync
- **Book.js** - Radix tree structure for fast prefix/substring search on datasets
- **Vue 3** - Reactive UI with real-time updates
- **IndexedDB** - Persistent storage for DHT data, datasets, and cached results
- **Vite** - Fast dev server and build system

## Installation

### From NPM
```bash
npm install pigeonfs
```

### From Source
```bash
git clone https://github.com/PeerPigeon/PigeonFS.git
cd PigeonFS
npm install
```

## Usage

### Desktop App (Recommended)

Download and run the desktop application with integrated server management:

```bash
# Run in Electron (development)
npm run electron

# Build desktop app for distribution
npm run electron:build
```

Features:
- 🖥️ Native desktop app for Windows, macOS, and Linux
- 🎛️ Built-in server control panel with GUI
- 📋 Live server logs and status monitoring
- ⚙️ Easy configuration without terminal commands

See [ELECTRON.md](ELECTRON.md) for building and distribution.

### Browser (Development)
```bash
npm run dev
```

### Production Build
```bash
npm run build
npm run preview
```

### Documentation

- Chunk Storage: see `docs/CHUNK_STORAGE.md` and `docs/CHUNK_STORAGE_QUICK_REF.md`

### CLI Server

Run a persistent Node.js peer to host files and datasets. Includes web upload interface at `http://localhost:3000`.

```bash
# Run with Node.js
npm run server

# Or build standalone executable (no Node.js required)
npm run package
./dist/pigeonfs-server-macos
```

**Upload files via:**
- **Browser UI** - Built-in upload interface in the "Server File Management" section
- **Web interface** - Drag & drop at `http://localhost:3000`
- **HTTP API** - `curl -F "file=@video.mp4" http://localhost:3000/upload`
- **Manual placement** - Copy to `data/files/` directory

**Browser features:**
- 📤 Upload files directly to server from browser
- 🔍 Search server files using Book.js index
- ⬇️ Download files from server
- 📋 View complete file list

See [NODE_SERVER.md](NODE_SERVER.md) for full details.

Open in multiple browser windows/tabs to test P2P file transfer and storage across peers.

### File Transfer Example

1. **Connect to network** - Enter a network namespace and click Connect
2. **Select a file** - Choose ANY file (video, image, PDF, etc.) from your computer
3. **Get peer ID** - Copy your peer ID and share with recipient
4. **Send file** - Paste recipient's peer ID and click "Send File"
5. **Receive file** - File appears in recipient's "Received Files" section
6. **Download** - Click download button to save file to disk

Works with:
- 🎥 Videos (MP4, WebM, AVI, etc.)
- 🖼️ Images (JPG, PNG, GIF, etc.)
- 📄 Documents (PDF, DOCX, TXT, etc.)
- 📦 Archives (ZIP, RAR, TAR, etc.)
- �� Audio (MP3, WAV, OGG, etc.)
- Any other file type!

### Distributed Storage Example

1. **Connect to network** - Enter a network namespace and click Connect
2. **Store key-value data** - Use the PagingStorage section:
```javascript
// Automatically routes to responsible peers via DHT
await storage.set('user:123', { name: 'Alice', age: 30 })
await storage.set('file:readme', 'Hello World!')
```
3. **Retrieve from any peer** - Data automatically fetched from DHT:
```javascript
const user = await storage.get('user:123') // Routes to correct peer
```
4. **View stats** - See pages, keys, replication status across network
5. **Export/Import** - Download or restore full storage state

### Dataset Search Example

1. **Load a dataset** - Click "Load King James Bible" (or add your own dataset)
2. **Search locally** - Type query like "faith" and press Enter
3. **Search via peers** - Open another tab/window, DON'T load the dataset, just search
4. **See peer results** - First tab serves results to second tab via P2P network

### Optional Encryption

Enable end-to-end encryption for all P2P communications:

**Browser:**
1. Check the **"🔒 Enable End-to-End Encryption"** checkbox before connecting
2. All messages, file transfers, and storage will be encrypted

**Node.js Server:**
```bash
ENABLE_CRYPTO=true npm run server
```

**How it works:**
- Uses UnSEA crypto library (AES-GCM + ECDH key exchange)
- Each peer generates ECDSA key pair on initialization
- Messages encrypted with recipient's public key
- ~10-20% performance overhead
- ⚠️ **All peers must use the same encryption setting** (all on or all off)

**When to use encryption:**
- Sensitive file transfers (medical records, legal documents, etc.)
- Private conversations or data
- Untrusted networks
- Compliance requirements (HIPAA, GDPR, etc.)
5. **Auto-caching** - Second tab caches received results to help other peers

## How It Works

### Direct File Transfer Flow (WebRTC Data Channels)
```
Sender                    PeerPigeon Network           Receiver
  |                              |                         |
  |--select file---------------->|                         |
  |--get peer ID---------------->|                         |
  |                              |<--share peer ID---------|
  |                              |                         |
  |--establish WebRTC----------->|<--establish WebRTC------|
  |                              |                         |
  |==file chunks (64KB)=========>|==file chunks==========>|
  |                              |                         |--save to disk
```

### Distributed Storage Flow (DHT-based)
```
Client                  DHT Hash Ring              Replica Peers (3x)
  |                          |                           |
  |--set('key', value)------>|                           |
  |                          |--hash(key)--------------->|
  |                          |--route to peers---------->|
  |                          |                           |--store locally
  |                          |<--acknowledge-------------|
  |<--success----------------|                           |
```

### Search Flow (Gossip-based)
```
Searcher                    Network                     Data Holder
    |                          |                              |
    |---(search query)-------->|                              |
    |                          |---(gossip broadcast)-------->|
    |                          |                              |---(index search)
    |                          |                              |
    |                          |<---(results)-----------------|
    |<---(results + cache)-----|                              |
```

## Dataset Support

Currently includes:
- **King James Bible** - 31,102 verses, full-text searchable

Easily add more datasets by adding to `availableDatasets` object with:
- `name` - Display name
- `icon` - Emoji icon
- `url` - Dataset JSON URL
- `loader` - Transform function to convert to Book.js format

## Inspiration & Attribution

PigeonFS uses **Book.js** for its searchable dataset feature, which was inspired by **Gun DB** and **Mark Nadal's** vision for decentralized data structures. The Book.js radix tree implementation enables fast full-text search across distributed datasets.

Special thanks to:
- **Mark Nadal** - For pioneering P2P database concepts and Gun DB, which inspired the Book.js search architecture
- **Gun DB community** - For inspiration on distributed data structures
- **Book.js** - Fast radix tree implementation for full-text search
- **PeerPigeon** - WebRTC mesh networking and gossip protocol

## License

MIT
