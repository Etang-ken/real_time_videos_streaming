const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3002;

app.use(cors());
app.use(express.json());

// Global flag and queue to process streams sequentially
let isStreaming = false;
const streamQueue = [];

// Modified streamVideo function returns a promise that resolves when the FFmpeg process ends.
const streamVideo = (language, finalVideoPath) => {
  return new Promise((resolve, reject) => {
    const OUTPUT_DIR = path.join(__dirname, 'stream/hls', language);
    const PLAYLIST_NAME = 'index.m3u8';
    fs.ensureDirSync(OUTPUT_DIR);

    // Create unique segment names using timestamp.
    const segmentName = `segment_${Date.now()}_%03d.ts`;

    // FFmpeg command to generate HLS segments and playlist.
    // Using 'append_list+omit_endlist+delete_segments' keeps the playlist open for new segments.
    const ffmpegArgs = [
      '-re',
      '-i', finalVideoPath,
      '-c', 'copy',
      '-hls_time', '3',
      '-hls_list_size', '6',
      '-hls_flags', 'append_list+omit_endlist+delete_segments',
      '-hls_segment_filename', path.join(OUTPUT_DIR, segmentName),
      '-f', 'hls',
      path.join(OUTPUT_DIR, PLAYLIST_NAME)
    ];

    console.log(`Starting HLS streaming for ${language}`);
    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs);

    ffmpegProcess.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });
    ffmpegProcess.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`);
    });
    ffmpegProcess.on('close', (code) => {
      console.log(`FFmpeg HLS process for ${language} exited with code ${code}`);
      resolve(); // Mark this stream as complete
    });
    ffmpegProcess.on('error', (err) => {
      console.error(`FFmpeg HLS process error for ${language}: ${err}`);
      resolve(null);
    });
  });
};

// Process the queue: If not already streaming, dequeue and start the next stream.
const processQueue = async () => {
  if (!isStreaming && streamQueue.length > 0) {
    isStreaming = true;
    const { language, videoPath } = streamQueue.shift();
    try {
      await streamVideo(language, videoPath);
    } catch (err) {
      console.error(err);
    } finally {
      isStreaming = false;
      processQueue(); // Check the queue for the next stream
    }
  }
};

// Endpoint to add a new stream to the queue.
app.post('/stream-vid', (req, res) => {
  const { videoPath, language } = req.body;
  if (!videoPath || !language) {
    return res.status(400).json({ error: 'videoPath and language are required' });
  }
  // Add the new stream to the queue.
  streamQueue.push({ language, videoPath });
  processQueue(); // Attempt to process the queue.
  res.json({ message: `Added ${language} video to queue` });
});

// Watch endpoint (with refresh button) to monitor the stream.
app.get('/watch/:language', (req, res) => {
  const language = req.params.language;
  res.send(`
        <html>
        <head>
          <title>${language} Stream</title>
          <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        </head>
        <body>
            <h1>Streaming in ${language}</h1>
            <button id="refreshBtn">Refresh Stream</button>
            <br/><br/>
            <video id="video" controls muted autoplay style="max-width: 800px;"></video>
            <script>
                function loadStream() {
                  var video = document.getElementById('video');
                  if (Hls.isSupported()) {
                      var hls = new Hls();
                      hls.loadSource('/stream/hls/${language}/index.m3u8');
                      hls.attachMedia(video);
                      hls.on(Hls.Events.MANIFEST_PARSED, function() { 
                        video.play(); 
                      });
                  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                      video.src = '/stream/hls/${language}/index.m3u8';
                      video.addEventListener('loadedmetadata', function() { 
                        video.play(); 
                      });
                  }
                }
                
                loadStream();

                // Refresh button reloads the page.
                document.getElementById('refreshBtn').addEventListener('click', function() {
                  location.reload();
                });
            </script>
        </body>
        </html>
    `);
});

const STREAM_DIR = path.join(__dirname, 'stream');
app.use('/stream', express.static(STREAM_DIR));

app.listen(PORT, () => {
  console.log(`📡 Server running at http://localhost:${PORT}`);
});
