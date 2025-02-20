const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');

const app = express();
const PORT = 3000;

// Serve static files (HLS segments and playlists)
app.use(express.static('public'));

// Directory to store HLS files
const hlsOutputDir = path.join(__dirname, 'public', 'hls');
if (!fs.existsSync(hlsOutputDir)) {
    fs.mkdirSync(hlsOutputDir, { recursive: true });
}

// FFmpeg process
let ffmpegProcess = null;

// Function to start FFmpeg HLS streaming
function startHLSStream() {
    const chunksDir = path.join(__dirname, 'chunks', 'french');
    const chunkFiles = fs.readdirSync(chunksDir)
        .filter(file => file.startsWith('translated_chunk_') && file.endsWith('.mp4'))
        .sort()
        .map(file => path.join(chunksDir, file));

    if (chunkFiles.length === 0) {
        console.log('No chunks found. Waiting for new chunks...');
        return;
    }

    // Stop any existing FFmpeg process
    if (ffmpegProcess) {
        ffmpegProcess.kill('SIGTERM');
    }

    // FFmpeg command to generate HLS stream
    ffmpegProcess = ffmpeg();

    chunkFiles.forEach(file => {
        ffmpegProcess.input(file);
    });

    ffmpegProcess
        .outputOptions([
            '-c:v libx264', // Video codec
            '-c:a aac',     // Audio codec
            '-f hls',       // Output format (HLS)
            '-hls_time 2',  // Segment duration (2 seconds)
            '-hls_list_size 0', // Keep all segments in the playlist
            '-hls_flags append_list+delete_segments', // Append new segments and delete old ones
            '-hls_segment_type mpegts',  // Segment file type
            '-hls_base_url /hls/'         // Base URL for segments
        ])
        .output(path.join(hlsOutputDir, 'stream.m3u8')) // Output playlist file
        .on('start', () => {
            console.log('HLS streaming started');
        })
        .on('error', (err) => {
            console.error('Error occurred:', err);
        })
        .on('end', () => {
            console.log('HLS streaming finished');
        })
        .run();
}

// Watch for new chunks
const chunksDir = path.join(__dirname, 'chunks', 'french');
const watcher = chokidar.watch(chunksDir, {
    persistent: true,
    ignoreInitial: false,
});

watcher.on('add', (filePath) => {
    console.log(`New chunk added: ${filePath}`);
    startHLSStream(); // Restart HLS streaming with the new chunk
});

// Serve the HLS playlist
app.get('/stream', (req, res) => {
    res.sendFile(path.join(hlsOutputDir, 'stream.m3u8'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});