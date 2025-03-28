const express = require('express')
// const streamRoutes = require('./output_stream')
const { setupLanguageStream } = require('./watch_translation')
const cors = require('cors')
const path = require('path')

const app = express()
const PORT = 3002
app.use(cors())
app.use(express.json())

const STREAM_BASE_DIR = path.join(__dirname, 'stream')
const OUTPUT_FOLDER = path.join(__dirname, 'chunks')
// const languages = ['french'] // Add more as needed
// const languages = ['french', 'spanish', 'chinese'] // Add more as needed



app.use(express.static(STREAM_BASE_DIR))
app.use(express.static(OUTPUT_FOLDER))

app.post('/start-streaming', (req, res) => {
  const { languages } = req.body
  languages.forEach((language) => {
    setupLanguageStream(language)
  })
  res.json({ message: `Streaming languages: ${languages.join(', ')}` })
})


app.get('/watch/:language', (req, res) => {
  const language = req.params.language
  res.send(`
        <html>
        <head><title>${language} Stream</title>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        </head>
        <body>
            <h1>Streaming in ${language}</h1>
            <video id="video" controls muted autoplay style="max-width: 800px;"></video>
            <script>
                var video = document.getElementById('video');
                if (Hls.isSupported()) {
                    var hls = new Hls();
                    hls.loadSource('/${language}/stream.m3u8');
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, function() { video.play(); });
                } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                    video.src = '/${language}/stream.m3u8';
                    video.addEventListener('loadedmetadata', function() { video.play(); });
                }
            </script>
        </body>
        </html>
    `)
})

// app.listen(8080, () =>
//   console.log('🎥 Server running at http://localhost:8080')
// )

// app.use('/api', streamRoutes)

app.listen(PORT, () =>
  console.log(`🚀 Server running at http://127.0.0.1:${PORT}`)
)
