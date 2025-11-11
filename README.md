# PigeonFS

**Peer-to-peer searchable datasets using PeerPigeon and Book.js**

PigeonFS enables distributed search across any dataset in a P2P network. Load datasets locally or search through connected peers who have the data. Results are cached automatically to strengthen the network.

## Features

- 🔍 **P2P Search** - Search datasets without loading them locally - queries route through the peer network
- 📚 **Multiple Datasets** - Generic system supports any dataset (Bible, dictionaries, wikis, etc.)
- ⚡ **Book.js Integration** - Fast radix tree indexing for efficient full-text search
- 💾 **Smart Caching** - Auto-caches search results to IndexedDB to contribute to network robustness
- 🌐 **Network-First** - Search requests broadcast via gossip protocol to all connected peers
- 📊 **Real-time Stats** - Track local/peer results, network latency, and storage usage

## How It Works

1. **Load or Search** - Either load a full dataset locally or just start searching
2. **Query Network** - All searches broadcast to connected peers via gossip protocol
3. **Aggregate Results** - Receive results from both local index (if loaded) and network peers
4. **Auto-Cache** - Received results are cached locally (in-memory or IndexedDB)
5. **Strengthen Network** - Your cache helps answer future peer queries

## Dataset Support

Currently includes:
- **King James Bible** - 31,102 verses, full-text searchable

Easily add more datasets by adding to `availableDatasets` object with:
- `name` - Display name
- `icon` - Emoji icon
- `url` - Dataset JSON URL
- `loader` - Transform function to convert to Book.js format

## Architecture

- **PeerPigeon** - Handles P2P networking, gossip protocol, peer discovery
- **Book.js** - Radix tree structure for fast prefix/substring search
- **Vue 3** - Reactive UI with real-time search results
- **IndexedDB** - Optional persistent storage for datasets and cached results
- **Vite** - Fast dev server and build system

## Usage

```bash
npm install
npm run dev
```

Then open in multiple browser windows/tabs to test P2P search across peers.

## Search Flow

```
Searcher                    Network                     Data Holder
    |                          |                              |
    |---(search query)-------->|                              |
    |                          |---(gossip broadcast)-------->|
    |                          |                              |---(index search)
    |                          |                              |
    |                          |<---(results)-----------------|
    |<---(results + cache)-----|                              |
    |                          |                              |
```

## License

MIT
