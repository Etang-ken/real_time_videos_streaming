// issue , plays and stop unexpectedly then replays only after  refresh, unclick of play button doesn't do any thing
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const express = require('express');

const VIDEO_DIR = path.join(__dirname, 'chunks');
const STREAM_DIR = path.join(__dirname, 'stream');
const FIFO_PATH = '/tmp/video_fifo'; // Named pipe for dynamic input

// Ensure the stream output directory exists
if (!fs.existsSync(STREAM_DIR)) {
  fs.mkdirSync(STREAM_DIR, { recursive: true });
}

// Create the named pipe if it doesn't exist
if (!fs.existsSync(FIFO_PATH)) {
  try {
    execSync(`mkfifo ${FIFO_PATH}`); // Create the named pipe
    console.log(`✅ Created named pipe at ${FIFO_PATH}`);
  } catch (err) {
    console.error(`❌ Failed to create named pipe: ${err.message}`);
    process.exit(1); // Exit if the named pipe cannot be created
  }
}

let ffmpegProcess = null;
let lastProcessedFile = ''; // Track the last processed file

// Function to get sorted list of .mp4 files
function getSortedFiles() {
  return fs
    .readdirSync(VIDEO_DIR)
    .filter((file) => file.startsWith('chunk_') && file.endsWith('.mp4'))
    .sort();
}

// Function to write new files to the named pipe (excluding the last file)
function updateFifo() {
  const sortedFiles = getSortedFiles();
  const newFiles = sortedFiles.slice(sortedFiles.indexOf(lastProcessedFile) + 1); // Get files after the last processed one

  if (newFiles.length > 0) {
    // Exclude the last file (it might still be written)
    const filesToAdd = newFiles.slice(0, -1);

    if (filesToAdd.length > 0) {
      const writeStream = fs.createWriteStream(FIFO_PATH);
      filesToAdd.forEach((file) => {
        writeStream.write(`file '${path.join(VIDEO_DIR, file)}'\n`);
      });
      writeStream.end();
      console.log(`✅ Added ${filesToAdd.length} new files to the FIFO`);
      lastProcessedFile = filesToAdd[filesToAdd.length - 1]; // Update the last processed file
    }
  }
}

// Function to start FFmpeg streaming
function startFFmpeg() {
  if (ffmpegProcess) {
    console.log('🔄 Restarting FFmpeg...');
    ffmpegProcess.kill('SIGTERM'); // Stop the existing FFmpeg process
  }

  console.log('🚀 Starting FFmpeg stream...');

  ffmpegProcess = spawn('ffmpeg', [
    '-f', 'concat',
    '-safe', '0',
    '-i', FIFO_PATH, // Read from the named pipe
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'hls',
    '-hls_time', '5', // Segment duration in seconds
    '-hls_list_size', '20', // Number of segments to keep in the playlist
    '-hls_flags', 'append_list+omit_endlist', // Append new segments and avoid ending the playlist
    path.join(STREAM_DIR, 'stream.m3u8'),
  ]);

  ffmpegProcess.stdout.on('data', (data) => console.log(`FFmpeg: ${data}`));
  ffmpegProcess.stderr.on('data', (data) => console.error(`FFmpeg Error: ${data}`));
  ffmpegProcess.on('close', (code) => {
    console.log(`FFmpeg exited with code ${code}`);
    if (code === 0) {
      console.log('FFmpeg finished streaming all files. Waiting for new files...');
      startFFmpeg(); // Restart FFmpeg to continue streaming
    }
  });
}

// Express server to serve HLS stream
const app = express();
app.use(express.static(STREAM_DIR));

// Serve a blank favicon to avoid 404 errors
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Live Stream</title>
        <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
      </head>
      <body>
        <div style='display: flex; justify-content: space-between; flex-wrap: wrap; gap: 30px; width: 100%;'>
          <div>
            <h1>Original Stream</h1>
            <video src="rtp://127.0.0.1:1234" controls muted autoplay style="max-width: 800px;"></video>
          </div>
          <div>
            <h1>Translated Stream</h1>
            <video id="video" controls muted autoplay style="max-width: 800px;"></video>
          </div>
        </div>
        <script>
          var video = document.getElementById('video');
          if (Hls.isSupported()) {
            var hls = new Hls({
              enableWorker: true,
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
              liveSyncDuration: 10,
              liveMaxLatencyDuration: 20,
            });
            hls.loadSource('/stream.m3u8'); // Load the stream
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, function() {
              console.log('Manifest parsed, starting playback');
              video.play();
            });

            hls.on(Hls.Events.ERROR, function(event, data) {
              console.error('Error:', data);
              if (data.type === Hls.ErrorTypes.MEDIA_ERROR && data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
                console.error('Buffer stalled, attempting to recover...');
                hls.startLoad(); // Restart loading the stream
              }
            });

            video.addEventListener('ended', function() {
              console.log('Stream ended, reloading...');
              hls.loadSource('/stream.m3u8'); // Reload the stream
              hls.attachMedia(video);
              hls.on(Hls.Events.MANIFEST_PARSED, function() {
                video.play();
              });
            });

          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = '/stream.m3u8';
            video.addEventListener('loadedmetadata', function() {
              console.log('Loaded metadata, starting playback');
              video.play();
            });

            video.addEventListener('ended', function() {
              console.log('Stream ended, reloading...');
              video.src = '/stream.m3u8';
              video.play();
            });
          }
        </script>
      </body>
    </html>
  `);
});

app.listen(8080, () => console.log('🎥 Server running at http://localhost:8080'));

// Initialize the input list and start FFmpeg
const sortedFiles = getSortedFiles();
if (sortedFiles.length > 0) {
  const writeStream = fs.createWriteStream(FIFO_PATH);
  sortedFiles.slice(0, -1).forEach((file) => { // Exclude the last file
    writeStream.write(`file '${path.join(VIDEO_DIR, file)}'\n`);
  });
  writeStream.end();
  lastProcessedFile = sortedFiles[sortedFiles.length - 2]; // Set the last processed file (excluding the last one)
  startFFmpeg(); // Start FFmpeg
}

// Check for new files every 5 seconds and update the FIFO
setInterval(() => {
  updateFifo();
}, 5000);