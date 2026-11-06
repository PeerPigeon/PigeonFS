# PigeonFS Desktop App

Run PigeonFS as a standalone desktop application with integrated server management.

## Features

- 🖥️ **Native Desktop App** - Runs on Windows, macOS, and Linux
- 🎛️ **Built-in Server Control** - Start/stop the Node.js server from the UI
- 📋 **Live Server Logs** - View server output in real-time
- ⚙️ **Easy Configuration** - Configure network settings via GUI
- 📦 **Standalone Package** - No need to install Node.js separately

## Development

### Quick Start

```bash
# Install dependencies
npm install

# Build and run (easiest method)
npm run electron

# Or use the convenience script
./start-electron.sh
```

### Run in Electron (Production Mode)

```bash
# Build the web app and run in Electron
npm run electron
```

This will:
1. Build the Vue app with Vite
2. Launch Electron with the built app

**Important:** If you see a white screen:
1. Make sure the build completed successfully
2. Check the terminal for error messages
3. Try running `npm run build` first, then `electron .`

### Development with Hot Reload

```bash
# Terminal 1: Run Vite dev server
npm run dev

# Terminal 2: Run Electron in dev mode (connects to Vite server)
npm run electron:dev
```

This allows hot-reloading during development. The Electron window will load from `http://localhost:8765`.

**Troubleshooting white screen:**
- Ensure Vite dev server is running first (`npm run dev`)
- Wait for "Local: http://localhost:8765/" message
- Then run `npm run electron:dev` in another terminal

## Building Executables

### Desktop App (Electron)

Build platform-specific desktop applications:

```bash
# Build for all platforms
npm run electron:build

# Build for specific platform
npm run electron:build -- --mac
npm run electron:build -- --win
npm run electron:build -- --linux
```

Output will be in `dist/` directory:
- **macOS**: `PigeonFS-1.0.7.dmg`
- **Windows**: `PigeonFS Setup 1.0.7.exe`
- **Linux**: `PigeonFS-1.0.7.AppImage`

### CLI Server (pkg)

Build standalone server executables without Electron:

```bash
npm run package
```

This creates standalone binaries in `dist/`:
- `pigeonfs-server-macos` - macOS executable
- `pigeonfs-server-linux` - Linux executable
- `pigeonfs-server-win.exe` - Windows executable

These can run without Node.js installed:
```bash
./dist/pigeonfs-server-macos
# or
./dist/pigeonfs-server-win.exe
```

## Usage

### Desktop App

1. **Launch the app**
2. **Start Local Server** (optional)
   - Configure network name and port
   - Enable encryption if desired
   - Click "Start Local Server"
3. **Connect to Network**
   - Enter network namespace
   - Click "Connect"
4. **Upload/Share Files**
   - Use the built-in upload interface
   - Send files to peers
   - Search and download from server

### Standalone Server

Run the packaged server:

```bash
# macOS/Linux
./pigeonfs-server-macos

# Windows
pigeonfs-server-win.exe
```

Environment variables still work:
```bash
NETWORK_NAME=mynetwork HTTP_PORT=3001 ./pigeonfs-server-macos
```

## Distribution

### Desktop App
- Distribute the `.dmg` (macOS), `.exe` (Windows), or `.AppImage` (Linux)
- Users can install and run without any dependencies
- Includes full GUI and server functionality

### CLI Server
- Distribute the standalone executable
- No installation required
- Perfect for servers and headless systems
- Much smaller file size than Electron app

## Technical Details

- **Electron**: v28.0.0
- **electron-builder**: Creates installers and packages
- **pkg**: Creates standalone Node.js executables
- **IPC Security**: Uses contextBridge for secure renderer ↔ main communication
- **Process Management**: Forks Node.js server as child process

## Architecture

```
┌─────────────────────────────────────┐
│         Electron Main Process       │
│   (electron-main.js)                │
│   - Window management               │
│   - Server process control          │
│   - IPC handlers                    │
└───────────┬─────────────────────────┘
            │
            ├──> Node.js Server (fork)
            │    - PeerPigeon mesh
            │    - HTTP file server
            │    - Dataset hosting
            │
            └──> Renderer Process
                 - Vue.js UI
                 - Server control panel
                 - File transfer UI
```

## Security

- **Context Isolation**: Enabled for security
- **Node Integration**: Disabled in renderer
- **Preload Script**: Exposes only necessary APIs
- **IPC**: All communication through secure channels
