import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

// Console filter: allow ONLY dataset file search and file download logs
(() => {
	const original = {
		log: console.log,
		info: console.info,
		debug: console.debug,
		warn: console.warn,
	}
	const allow = (...args) => {
		try {
			// Consider only string arguments for pattern checks to avoid heavy serialization
			const texts = args.filter(a => typeof a === 'string')
			if (texts.length === 0) return false
			const s = texts.join(' ')
			// Allow whitelisted tags and phrases related to file dataset search and file transfers
					return (
				s.includes('[SEARCH]') ||
				s.includes('[DOWNLOAD]') ||
				s.includes('File search') ||
				s.includes('file-search') ||
				s.includes('file results') ||
				s.includes('file list') ||
				s.includes('Sent chunk') ||
				s.includes('Starting file receive') ||
				s.includes('File received') ||
				s.includes('Sending:') ||
				s.includes('Sending ') ||
						s.includes('File sent') ||
						s.includes('Progress:') ||
						s.includes('📥') ||
						s.includes('📤') ||
						// Startup and peer connection logs
						s.includes('Starting PigeonFS') ||
						s.includes('Connecting to network') ||
						s.includes('Connecting to PigeonHub server') ||
						s.includes('Connected to PigeonHub') ||
						s.includes('Connected with peer ID') ||
						s.includes('Peer connected') ||
						s.includes('Peer disconnected') ||
						s.includes('Status changed:') ||
						s.includes('Requesting peer list') ||
								s.includes('Peer discovered:') ||
								s.includes('Initializing PeerPigeonMesh') ||
								s.includes('PeerPigeonMesh')
			)
		} catch {
			return false
		}
	}
	const filtered = (method) => (...args) => {
		if (allow(...args)) original[method](...args)
	}
	console.log = filtered('log')
	console.info = filtered('info')
	console.debug = filtered('debug')
	console.warn = filtered('warn')
	// NOTE: console.error is left unmodified so errors are still visible
})()

createApp(App).mount('#app')
