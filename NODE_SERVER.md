# PigeonFS Node.js Server

Run a persistent PigeonFS node to host datasets and files to strengthen the network.

## Features

- 🌐 Long-running persistent peer on the network
- 📚 Auto-loads and serves Book.js datasets to peers
- � Hosts files for P2P transfer (videos, images, documents, etc.)
- �🔍 Responds to search queries from browser peers
- 💾 Loads datasets and files from local directories
- 📡 Announces availability every 5 minutes
- 📊 Periodic status logging

## Usage

### Quick Start

```bash
npm run server
```

### With Environment Variables

```bash
# Custom network namespace
NETWORK_NAME=my-network npm run server

# Custom data directory
DATA_DIR=/path/to/data npm run server

# Enable end-to-end encryption
ENABLE_CRYPTO=true npm run server

# Combine multiple options
NETWORK_NAME=secure-network ENABLE_CRYPTO=true npm run server
```

## Configuration

Environment variables:
- `NETWORK_NAME` - Network namespace (default: `pigeonfs`)
- `DATA_DIR` - Directory for datasets and files (default: `./data`)
- `ENABLE_CRYPTO` - Enable end-to-end encryption (default: `false`, set to `true` to enable)
- `HTTP_PORT` - HTTP upload server port (default: `3000`)

**Note:** For encryption to work, all peers in the network must have the same encryption setting.

## Dataset Management

### Auto-loaded Datasets

Place JSON files in `data/datasets/` directory:

```json
[
  { "key": "entry1", "value": "First entry text" },
  { "key": "entry2", "value": "Second entry text" }
]
```

The server will automatically:
1. Load all `.json` files from `data/datasets/`
2. Build Book.js indexes
3. Announce availability to the network
4. Serve search queries from browser peers

### Default Dataset

If no datasets are found, the server automatically downloads and loads the King James Bible (31,102 verses).

## File Hosting

### Method 1: Web Upload (Recommended)

The server runs an HTTP upload interface:

1. Start the server:
   ```bash
   npm run server
   ```

2. Open the upload page:
   ```
   http://localhost:3000
   ```

3. Upload files via:
   - **Drag & drop** files onto the upload area
   - **Click** to select files from your computer
   - Files are automatically added to the P2P network

4. View hosted files in the web interface

**Custom Port:**
```bash
HTTP_PORT=8080 npm run server
```

### Method 2: Manual File Placement

Place files directly in `data/files/` directory:

```bash
mkdir -p data/files
cp video.mp4 data/files/
cp document.pdf data/files/
cp image.jpg data/files/
```

The server will automatically:
1. Load all files from `data/files/`
2. Generate unique file IDs
3. Announce available files to the network
4. Serve file chunks to requesting peers

### File Indexing with Book.js

The browser UI automatically builds a **Book.js radix tree index** of all server filenames. This enables:

- 🔍 **Fast filename search** - Find files by partial name match
- ⚡ **Efficient lookup** - Radix tree structure for quick searches
- 📊 **Fuzzy matching** - Search works with incomplete filenames

**Example searches:**
- Search "video" → finds "my_video.mp4", "vacation_video.mov", etc.
- Search "2024" → finds all files with "2024" in the name
- Search ".pdf" → finds all PDF documents

The index is built client-side in the browser from the file list retrieved via the `/files` endpoint.

### Supported File Types

The server detects MIME types for:
- Videos: `.mp4`, `.webm`
- Audio: `.mp3`
- Images: `.jpg`, `.jpeg`, `.png`, `.gif`
- Documents: `.pdf`, `.txt`, `.json`
- Archives: `.zip`
- Any other file type (served as `application/octet-stream`)

### File Transfer Protocol

When a browser peer requests a file:
1. Peer sends `file-list-request` to discover available files
2. Server responds with list of files (name, size, type)
3. Peer requests file chunks via `file-chunk-request`
4. Server sends 64KB chunks with progress tracking
5. Peer assembles chunks into complete file

### HTTP API Endpoints

- `GET /` - Web upload interface
- `POST /upload` - Upload file (multipart/form-data or application/octet-stream)
- `GET /files` - List all hosted files (JSON)

**Example: Upload via curl**
```bash
curl -F "file=@video.mp4" http://localhost:3000/upload
```

## How It Works

1. **Connects** to PigeonHub bootstrap nodes
2. **Loads** datasets from data directory
3. **Announces** availability via gossip protocol
4. **Responds** to search requests from browser peers
5. **Broadcasts** results back to the network

Browser peers can search without loading datasets - queries route through Node.js servers!

## Example Output

```
🚀 Starting PigeonFS Node.js Server...
📁 Data directory: /path/to/data
🌐 Connecting to network: pigeonfs
🔗 Connecting to: wss://pigeonhub.fly.dev
✅ Connected with peer ID: abc123...
👥 Connected to 5 peers
📚 Loading datasets...
📂 Loading dataset: bible-kjv
✅ Loaded bible-kjv: 31102 items, 50000 index entries
📡 Announced availability to network
✅ PigeonFS Node is running!
Press Ctrl+C to stop

🔍 Search request: "faith" in bible-kjv from def456...
📤 Sent 10 results for "faith"
```

## Use Cases

- **Network Strengthening** - Provide reliable peers for browser clients
- **Dataset Hosting** - Host large datasets that browsers don't want to download
- **Search Serving** - Offload search computation from browsers
- **24/7 Availability** - Always-on peer for persistent network presence
- **Development** - Local node for testing without multiple browser tabs

## Production Deployment

### Using PM2

```bash
npm install -g pm2
pm2 start node-server.js --name pigeonfs-node
pm2 save
pm2 startup
```

### Using systemd

Create `/etc/systemd/system/pigeonfs.service`:

```ini
[Unit]
Description=PigeonFS Node.js Server
After=network.target

[Service]
Type=simple
User=pigeonfs
WorkingDirectory=/opt/pigeonfs
Environment=NODE_ENV=production
Environment=NETWORK_NAME=pigeonfs
ExecStart=/usr/bin/node node-server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable pigeonfs
sudo systemctl start pigeonfs
sudo systemctl status pigeonfs
```

## License

MIT
