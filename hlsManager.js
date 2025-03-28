const fs = require('fs');
const path = require('path');

const updatePlaylist = (language) => {
    const hlsDir = path.join(__dirname, 'stream/hls', language)
    const segments = fs.readdirSync(hlsDir)
      .filter(f => f.endsWith('.ts'))
      .sort((a, b) => a.localeCompare(b)) // Proper numeric sort
  
    const playlistContent = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-TARGETDURATION:10',
      ...segments.map(f => `#EXTINF:10.0,\n${f}`)
      // Omit #EXT-X-ENDLIST for live streams
    ].join('\n')
  
    fs.writeFileSync(
      path.join(hlsDir, `stream_${language}.m3u8`),
      playlistContent
    )
  }

module.exports = { updatePlaylist };