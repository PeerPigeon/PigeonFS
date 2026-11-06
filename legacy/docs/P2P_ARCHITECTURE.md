# PigeonFS P2P Architecture

## Overview
PigeonFS now uses **100% P2P communication** for all file transfers, both with the local server and across the network.

## Architecture Changes

### Previous Architecture (Hybrid)
- **Local Server Management**: HTTP upload/download (localhost:3000)
- **Network File Discovery**: P2P gossip + chunk transfer

### Current Architecture (Pure P2P)
- **Local Server Management**: P2P chunk upload/download via direct messages
- **Network File Discovery**: P2P gossip + chunk transfer
- **HTTP Server**: Read-only (file list endpoint + info page only)

## Implementation Details

### Upload Process
1. Browser UI reads file as ArrayBuffer
2. File is split into 64KB chunks
3. Each chunk is sent via `pigeon.sendDirectMessage(serverPeerId, message)`
4. Message type: `file-chunk-upload`
5. Server receives chunks, assembles file, saves to disk
6. Server rebuilds Book.js index and announces availability
7. Server sends `upload-complete` confirmation

### Download Process
1. User clicks download button
2. Browser calls `downloadP2PFile(file, serverPeerId)`
3. Requests chunks sequentially via `file-chunk-request` messages
4. Server sends chunks via `file-chunk` responses
5. Browser assembles chunks and triggers download
6. Progress bar shows real-time progress

### File Search
1. Browser broadcasts `file-search-request` via gossip
2. All nodes search their Book.js index
3. Matching nodes broadcast `file-search-response` with results
4. Browser aggregates results from multiple peers
5. User can download from any peer that has the file

## Code Structure

### node-server.js
- `handleFileChunkUpload(fromPeerId, content)` - Receives upload chunks
- `handleFileChunkRequest(fromPeerId, content)` - Sends download chunks
- `handleFileSearchRequest(request, fromPeerId)` - Searches Book.js index
- `addFile(filename, buffer)` - Adds file, rebuilds index, announces
- HTTP endpoints: `/files` (list), `/` (info page only)

### src/App.vue
- `handleServerFileUpload(event)` - Chunks and uploads via P2P
- `downloadServerFile(file)` - Downloads via P2P
- `downloadP2PFile(file, peerId)` - Generic P2P download function
- `searchNetworkFiles()` - Gossip-based file search

## Benefits of Pure P2P

1. **Consistency**: Same protocol for local and remote transfers
2. **Scalability**: No HTTP bottleneck for large files
3. **Network-wide**: Any node can share with any other node
4. **Distributed**: No single point of failure
5. **Progressive**: Chunk-based transfers with progress tracking

## Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `file-chunk-upload` | Browser → Server | Upload file chunks |
| `upload-complete` | Server → Browser | Confirm upload success |
| `file-chunk-request` | Browser → Peer | Request file chunk |
| `file-chunk` | Peer → Browser | Send file chunk |
| `file-search-request` | Browser → Network | Search for files |
| `file-search-response` | Peer → Browser | Return search results |
| `file-list-request` | Browser → Peer | Request file list |
| `file-list-response` | Peer → Browser | Send file list |

## Testing

### Upload Test
1. Open Electron GUI
2. Click "Browse" under "Upload Files to Server"
3. Select a file
4. Watch console: Should show "📤 Sent chunk X/Y"
5. Server logs: Should show "📥 Received chunk X/Y"
6. Verify file appears in file list

### Download Test
1. Ensure server has at least one file
2. Click download button
3. Watch progress bar fill up
4. Verify file downloads to browser

### Network Search Test
1. Have multiple nodes running
2. Use browser UI to search for a filename
3. Should return results from all peers
4. Click download to get file via P2P chunks
