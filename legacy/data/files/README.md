# Hosted Files Directory

Place any files here that you want to host on the PigeonFS network.

## Usage

1. Copy files to this directory:
   ```bash
   cp /path/to/video.mp4 data/files/
   cp /path/to/document.pdf data/files/
   ```

2. Start the server:
   ```bash
   npm run server
   ```

3. Files will be automatically:
   - Loaded into memory
   - Assigned unique IDs
   - Announced to the network
   - Served to requesting peers

## Supported File Types

- **Videos**: MP4, WebM
- **Audio**: MP3
- **Images**: JPG, PNG, GIF
- **Documents**: PDF, TXT, JSON
- **Archives**: ZIP
- Any other file type

## File Transfer

Files are transferred in 64KB chunks over WebRTC data channels for efficient peer-to-peer delivery.

Browser peers can discover and download files by:
1. Receiving node announcements with file lists
2. Requesting specific files by ID
3. Receiving chunks and assembling the complete file
