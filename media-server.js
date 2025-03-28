// ffmpeg -re -i /Volumes/"Macintosh HD"/AVNGroup/yuri/realtime-translation/be/my_stream/youtube_streams/stream.mp4 -c copy -f rtp_mpegts rtp://127.0.0.1:1234
const fs = require('fs-extra')
const path = require('path')
const cors = require('cors')
const { processChunks } = require('./new_server')
const WebSocket = require('ws')
const express = require('express')
require('dotenv').config()
const { spawn, exec } = require('child_process')
const util = require('util')
const execPromise = util.promisify(exec)
const axios = require('axios')
// const { setupLanguageStream } = require('./watch_translation')

const app = express()
const PORT = 3001
app.use(cors())
app.use(express.json())

// const streamURL = 'rtp://127.0.0.1:1234'
const OUTPUT_FOLDER = path.join(__dirname, 'chunks')
const CHUNK_DURATION = '10' // Seconds
const OPENAI_API_URL = process.env.OPENAI_REALTIME_API_URL
const OPENAI_API_KEY = process.env.OPENAI_API_KEY

let wsConnections = {} // Store WebSocket instances per language
let activeLanguages = new Set() // Use Set to avoid duplicates
let chunkIndex = 0
let chunksQueue = []
let isProcessing = false

fs.ensureDirSync(OUTPUT_FOLDER)

// Function to connect WebSocket for a language
function connectWebSocket(language) {
  if (wsConnections[language]) return // Prevent duplicate connections

  const ws = new WebSocket(OPENAI_API_URL, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'OpenAI-Beta': 'realtime=v1'
    }
  })

  ws.on('open', () => console.log(`✅ Connected WebSocket for ${language}`))
  // ws.on('message', (message) => {
  //   console.log(
  //     `✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅✅ WebSocket message ${message}`
  //   )
  // })
  ws.on('close', () => {
    console.log(`⚠️ WebSocket for ${language} disconnected. Reconnecting...`)
    setTimeout(() => connectWebSocket(language), 3000)
  })
  ws.on('error', (err) =>
    console.error(`❌ WebSocket error (${language}):`, err)
  )

  wsConnections[language] = ws
}

function refreshWebSocketAPIConnection(lang) {
  const sessionRefreshInterval = 25 * 60 * 1000 // 25 minutes
  setInterval(() => {
    const refreshEvent = {
      type: 'session.update',
      session: { instructions: 'Continue translation.' }
    }
    wsConnections[lang].send(JSON.stringify(refreshEvent))
    console.log('🔄🔄🔄🔄🔄🔄🔄🔄 Session refreshed.')
  }, sessionRefreshInterval)
}

// Function to start streaming and segmenting chunks
const startProcessingStream = async (streamURL) => {
  // const streamURL = url
  console.log('🎬 Starting stream processing...')

  const segmentFile = path.join(OUTPUT_FOLDER, 'chunk_%03d.mp4')

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
  ffmpegProcess.stdout.on('data', (data) =>
    console.log(`FFmpeg Output: ${data}`)
  )
  ffmpegProcess.stderr.on('data', (data) =>
    console.error(`FFmpeg Error: ${data}`)
  )
  ffmpegProcess.on('close', (code) =>
    console.log(`FFmpeg exited with code ${code}`)
  )
  ffmpegProcess.on('error', (err) =>
    console.error(`Failed to start FFmpeg: ${err.message}`)
  )
}

// Add this at the top with other requires
const NodeMediaServer = require('node-media-server')

// Configure Node Media Server
const nmsConfig = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    allow_origin: '*'
  }
}

const nms = new NodeMediaServer(nmsConfig)
nms.run()



// **Route: Start Processing (Initial Language Setup)**
app.post('/start-processing', (req, res) => {
  const { url, languages } = req.body
  if (!url || !Array.isArray(languages) || languages.length === 0) {
    return res
      .status(400)
      .json({ error: 'Stream URL and languages are required' })
  }
  console.log('Process: ', url, languages)
  languages.forEach((lang) => {
    if (!activeLanguages.has(lang)) {
      activeLanguages.add(lang)
      connectWebSocket(lang)
      refreshWebSocketAPIConnection(lang)
    }
  })

  startProcessingStream(url)
  // setTimeout(() => {
  //   axios.post('http://localhost:3002/start-streaming', {
  //     languages: languages
  //   })
  // }, 60000)
  return res.json({ message: 'Processing started...' })
})
// app.post('/start-processing', (req, res) => {
//   const { languages } = req.body

//   if (!Array.isArray(languages) || languages.length === 0) {
//     return res.status(400).json({ error: 'Languages array is required' })
//   }

//   activeLanguages = [...new Set(languages)] // Remove duplicates
//   activeLanguages.forEach(connectWebSocket) // Establish WebSocket connections

//   startProcessingStream()

//   res.json({ message: 'Processing stream started' })
// })

// **Route: Process New Languages Mid-Stream**
app.post('/process-new-languages', (req, res) => {
  const { languages } = req.body
  if (!Array.isArray(languages) || languages.length === 0) {
    return res.status(400).json({ error: 'Languages array is required' })
  }

  const newLanguages = languages.filter((lang) => !activeLanguages.has(lang))
  if (newLanguages.length === 0) {
    return res.json({ message: 'No new languages to process' })
  }

  newLanguages.forEach((lang) => {
    activeLanguages.add(lang)
    connectWebSocket(lang)
    refreshWebSocketAPIConnection(lang)
  })

  // setTimeout(() => {
  //   axios.post('http://localhost:3002/start-streaming', {
  //     languages: newLanguages
  //   })
  // }, 120000)

  console.log(`🔄 Processing new languages from chunk ${chunkIndex - 1}`)
  // res.json({ message: `Processing new languages: ${newLanguages.join(', ')}` })

  // // Start processing from the previous chunk (if available)
  // if (chunkIndex > 0 && chunksQueue.length > 2) {
  //   newLanguages.forEach((language) =>
  //     processChunks(
  //       wsConnections,
  //       chunksQueue[chunksQueue.length - 1],
  //       language
  //     )
  //   )
  // }

  res.json({ message: `Processing new languages: ${newLanguages.join(', ')}` })
})

// **Route: Stop Processing for Specific Languages**
app.post('/stop-processing', (req, res) => {
  const { languages } = req.body

  if (!Array.isArray(languages) || languages.length === 0) {
    return res.status(400).json({ error: 'Languages array is required' })
  }

  const stoppedLanguages = []

  languages.forEach((language) => {
    if (activeLanguages.includes(language)) {
      if (wsConnections[language]) {
        wsConnections[language].close()
        delete wsConnections[language]
      }

      activeLanguages = activeLanguages.filter((lang) => lang !== language)
      stoppedLanguages.push(language)
    }
  })

  if (stoppedLanguages.length === 0) {
    return res.json({ message: 'No matching active languages found to stop' })
  }

  res.json({
    message: `Stopped processing for languages: ${stoppedLanguages.join(', ')}`
  })
})

// app.use(express.static(STREAM_BASE_DIR))

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
)