# SyncWatch 🎬
A real-time watch party extension for synchronized media playback.

## 🚀 Features
* **Real-time Sync**: Synchronized play/pause/seek using Socket.io.
* **Smart Ad-Detection**: Automatically pauses for the group if someone encounters an ad on YouTube/Hotstar.
* **Global Chat**: Integrated sidebar for group communication and system updates.
* **Host Control**: Toggle between "Everyone" and "Host Only" control modes.

## 🛠️ Tech Stack
* **Frontend**: JavaScript (Chrome Extension API V3), HTML, CSS
* **Backend**: Node.js, Express, Socket.io
* **Hosting**: Railway

## 📂 Structure
* `/sync-extension`: Contains the manifest and content scripts.
* `/server`: The signaling server logic and state management.
