const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');

const VIDEO_DIR = path.join(__dirname, 'chunks');
const STREAM_DIR = path.join(__dirname, 'stream');
const INPUT_LIST_BASE = path.join(__dirname, 'file_lists/input_list');

// Ensure the stream output directory exists
if (!fs.existsSync(STREAM_DIR)) {
  fs.mkdirSync(STREAM_DIR, { recursive: true });
}

let ffmpegProcess = null;
let inputListCounter = 0;
let lastProcessedFile = ''; // Track the last processed file

// Function to get sorted list of .mp4 files
function getSortedFiles() {
  return fs.readdirSync(VIDEO_DIR)
    .filter(file => file.startsWith('chunk_') && file.endsWith('.mp4'))
    .sort();
}

// Function to create a new input list with only new files
function createNewInputList() {
  const sortedFiles = getSortedFiles();
  const newFiles = sortedFiles.slice(sortedFiles.indexOf(lastProcessedFile) + 1); // Get files after the last processed one

  if (newFiles.length > 0) {
    const newInputListFile = `${INPUT_LIST_BASE}_${inputListCounter}.txt`;
    const fileEntries = newFiles.map(file => `file '${path.join(VIDEO_DIR, file)}'`);
    fs.writeFileSync(newInputListFile, fileEntries.join('\n') + '\n');
    console.log(`✅ Created new input list: ${newInputListFile}`);
    lastProcessedFile = newFiles[newFiles.length - 1]; // Update the last processed file
    inputListCounter++;
    return newInputListFile;
  }
  return null;
}

// Function to start FFmpeg streaming with a specific input list
function startFFmpeg(inputListFile) {
  if (ffmpegProcess) {
    console.log('🔄 Restarting FFmpeg...');
    ffmpegProcess.kill('SIGTERM'); // Stop the existing FFmpeg process
  }

  console.log(`🚀 Starting FFmpeg stream with ${inputListFile}...`);

  ffmpegProcess = spawn('ffmpeg', [
    '-re',
    '-err_detect', 'ignore_err',
    '-f', 'concat',
    '-safe', '0',
    '-i', inputListFile,
    '-c:v', 'copy',
    '-c:a', 'copy',
    '-f', 'hls',
    '-hls_time', '5',
    '-hls_list_size', '20',
    '-hls_flags', 'append_list',
    path.join(STREAM_DIR, 'stream.m3u8')
  ]);

  ffmpegProcess.stdout.on('data', (data) => console.log(`FFmpeg: ${data}`));
  ffmpegProcess.stderr.on('data', (data) => console.error(`FFmpeg Error: ${data}`));
  ffmpegProcess.on('close', (code) => {
    console.log(`FFmpeg exited with code ${code}`);
    if (code === 0) {
      console.log('FFmpeg finished streaming all files. Waiting for new files...');
    }
  });
}

// Express server to serve HLS stream
const app = express();
app.use(express.static(STREAM_DIR));

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
          var hls = new Hls();
          hls.loadSource('/stream.m3u8'); // Load the stream
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, function() {
            video.play();
          });
          hls.on(Hls.Events.ERROR, function(event, data) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
              console.error('Segment not available yet, retrying...');
              setTimeout(() => hls.loadSource('/stream.m3u8'), 1000); // Retry loading the playlist
            }
          });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = '/stream.m3u8';
          video.addEventListener('loadedmetadata', function() {
            video.play();
          });
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(8080, () => console.log('🎥 Server running at http://localhost:8080'));

// Start FFmpeg initially
const initialInputList = createNewInputList();
if (initialInputList) {
  startFFmpeg(initialInputList);
}

// Check for new files every 5 seconds and update the input list
setInterval(() => {
  const newInputList = createNewInputList();
  if (newInputList) {
    startFFmpeg(newInputList); // Restart FFmpeg with the new input list
  }
}, 5000);