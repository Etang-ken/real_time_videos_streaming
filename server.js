const fs = require('fs-extra')
const path = require('path')
const { processChunks } = require('./new_server')
const WebSocket = require('ws')
const express = require('express')
const rangeParser = require('range-parser')
require('dotenv').config()
const { spawn } = require('child_process')

const app = express()
const PORT = 3001
const streamURL = 'rtp://127.0.0.1:1234'
const OUTPUT_FOLDER = path.join(__dirname, 'chunks')
const OUTPUT_FOLDER_Fr = path.join(__dirname, 'chunks/french')
const CHUNK_DURATION = '10' // Seconds
const url = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17'

let ws
const reconnectInterval = 3000 // 3 seconds delay before reconnecting

function connectWebSocket() {
  ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  })

  ws.on('open', () => console.log('Connected to WebSocket'))
  ws.on('close', () => {
    console.log('WebSocket disconnected. Reconnecting...')
    setTimeout(connectWebSocket, 5000)
  })
  ws.on('error', (err) => console.error('WebSocket error:', err))
}

// Start the WebSocket connection
connectWebSocket()
// Ensure output folder exists
fs.ensureDirSync(OUTPUT_FOLDER)

let chunkIndex = 0
let chunksQueue = []
let isProcessing = false;

const processStream = async () => {
  const segmentFile = path.join(OUTPUT_FOLDER, 'chunk_%03d.mp4');

  const ffmpegProcess = spawn('ffmpeg', [
    '-i',
    streamURL,
    '-c',
    'copy',
    '-flags',
    '+global_header',
    '-f',
    'segment',
    '-segment_time',
    CHUNK_DURATION,
    '-segment_format_options',
    'movflags=+faststart',
    '-reset_timestamps',
    '1',
    segmentFile
  ])

  ffmpegProcess.stdout.on('data', (data) => {
    console.log(`FFmpeg Output: ${data}`)
  })

  ffmpegProcess.stderr.on('data', (data) => {
    console.error(`FFmpeg Error: ${data}`)
  })

  ffmpegProcess.on('close', (code) => {
    console.log(`FFmpeg process exited with code ${code}`)
  })

  ffmpegProcess.on('error', (err) => {
    console.error(`Failed to start FFmpeg process: ${err.message}`)
  })
}

const processQueue = async (ws, language) => {
  if (isProcessing || chunksQueue.length < 2) return;

  isProcessing = true;
  const chunk = chunksQueue.shift();
  await processChunks(ws, chunk, language, chunkIndex);
  isProcessing = false;
  chunkIndex++

  // Process the next chunk in the queue
  processQueue(ws, language);
};

// Add chunks to the queue and start processing
fs.watch(OUTPUT_FOLDER, { persistent: true }, (eventType, filename) => {
  if (eventType === 'rename' && filename.endsWith('.mp4')) {
    const chunkPath = path.join(OUTPUT_FOLDER, filename);
    console.log(`🆕 New chunk detected: ${chunkPath}`);
    chunksQueue.push(filename);
    processQueue(ws, 'french'); // Start processing if not already running
  }
});

processStream()

// Serve stored segments
app.use('/chunks/french', express.static(OUTPUT_FOLDER))

// Local URL to access stored segments
app.get('/video-seek', (req, res) => {
  fs.readdir(OUTPUT_FOLDER_Fr, (err, files) => {
    if (err) return res.status(500).send('Error reading directory')

    // Sort files numerically
    files.sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]))

    // Pick the last segment (latest)
    const latestSegment = path.join(OUTPUT_FOLDER_Fr, files[files.length - 1])

    // Get video file size for range support
    fs.stat(latestSegment, (err, stats) => {
      if (err) return res.status(500).send('Error reading file')

      let range = req.headers.range
      let fileSize = stats.size
      let start = 0
      let end = fileSize - 1

      if (range) {
        let parts = rangeParser(fileSize, range)
        if (parts.length > 0) {
          let chunk = parts[0]
          start = chunk.start
          end = chunk.end
        }
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': 'video/mp4'
      })

      fs.createReadStream(latestSegment, { start, end }).pipe(res)
    })
  })
})

// Web page to play the video stream
app.get('/', (req, res) => {
  res.send(`
      <h1>Live Video Stream</h1>
      <video id="videoPlayer" width="640" height="360" controls>
          <source src="/video-seek" type="video/mp4">
          Your browser does not support the video tag.
      </video>
      <br>
      <button onclick="backward()">⏪ Backward</button>
      <button onclick="forward()">⏩ Forward</button>

      <script>
          function backward() {
              let video = document.getElementById("videoPlayer");
              video.src = "/video-seek";
              video.currentTime = Math.max(0, video.currentTime - 20);
              video.play();
          }

          function forward() {
              let video = document.getElementById("videoPlayer");
              video.src = "/video-seek";
              video.currentTime = Math.min(video.duration, video.currentTime + 20);
              video.play();
          }
      </script>
  `)
})

app.listen(PORT, () =>
  console.log(`🚀 Server running at http://127.0.0.1:${PORT}`)
)
