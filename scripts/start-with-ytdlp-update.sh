#!/bin/bash

# Update yt-dlp to latest version on startup
echo "🔄 Updating yt-dlp to latest version..."
pip3 install --no-cache-dir --break-system-packages --upgrade yt-dlp

# Check yt-dlp version
echo "📦 yt-dlp version: $(yt-dlp --version)"

# Start the bot
echo "🚀 Starting Muse bot..."
exec node --enable-source-maps dist/scripts/migrate-and-start.js
