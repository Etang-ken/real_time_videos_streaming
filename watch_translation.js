const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const express = require("express");

const VIDEO_DIR = path.join("/Volumes", "Macintosh HD", "AVNGroup", "yuri", "realtime-translation", "be", "chunks");
// const VIDEO_DIR = path.join("/Volumes", "Macintosh HD", "AVNGroup", "yuri", "realtime-translation", "be", "chunks", "french");
const STREAM_DIR = path.join(__dirname, "stream");
const INPUT_LIST_FILE = path.join(__dirname, "input_list.txt");

// Ensure the stream output directory exists
if (!fs.existsSync(STREAM_DIR)) {
    fs.mkdirSync(STREAM_DIR, { recursive: true });
}
let ffmpegProcess = null;
// Function to update the input list dynamically without restarting FFmpeg
function appendNewFilesToInputList() {
    let existingFiles = new Set();

    // Read existing input_list.txt if it exists
    if (fs.existsSync(INPUT_LIST_FILE)) {
        existingFiles = new Set(fs.readFileSync(INPUT_LIST_FILE, "utf8").split("\n").filter(Boolean));
    }
console.log('existing: ', existingFiles)
    const newFiles = fs.readdirSync(VIDEO_DIR)
        .filter(file => file.startsWith("chunk_") && file.endsWith(".mp4"))
        .sort()
        .map(file => `file '${path.join(VIDEO_DIR, file)}'`);
    // const newFiles = fs.readdirSync(VIDEO_DIR)
    //     .filter(file => file.startsWith("translated_chunk_") && file.endsWith(".mp4"))
    //     .sort()
    //     .map(file => `file '${path.join(VIDEO_DIR, file)}'`);

    const newEntries = newFiles.filter(file => !existingFiles.has(file));

    if (newEntries.length > 0) {
        fs.appendFileSync(INPUT_LIST_FILE, newEntries.join("\n") + "\n");
        console.log("✅ Added new files to input_list.txt");
        // startFFmpeg()
    }
}

// Function to start FFmpeg streaming without restarting on new files
function startFFmpeg() {
    if (ffmpegProcess) {
        console.log("🔄 Restarting FFmpeg...");
        ffmpegProcess.kill("SIGTERM");
    }

    console.log("🚀 Starting FFmpeg stream...");

     ffmpegProcess = spawn("ffmpeg", [
        "-re",
        "-f", "concat",
        "-safe", "0",
        "-i", INPUT_LIST_FILE,
        "-c:v", "copy",
        "-c:a", "copy",
        "-f", "hls",
        "-hls_time", "5",
        "-hls_list_size", "20",
        "-hls_flags", "append_list",
        path.join(STREAM_DIR, "stream.m3u8"),
    ]);

    ffmpegProcess.stdout.on("data", (data) => console.log(`FFmpeg: ${data}`));
    ffmpegProcess.stderr.on("data", (data) => console.error(`FFmpeg Error: ${data}`));
    ffmpegProcess.on("close", (code) => {console.log(`FFmpeg exited with code ${code}`)

});

    return ffmpegProcess;
}

// Express server to serve HLS stream
const app = express();
app.use(express.static(STREAM_DIR));

app.get("/", (req, res) => {
    res.send(`
        <html>
        <head>
            <title>Live Stream</title>
            <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
        </head>
        <body>
            <h1>Live Stream</h1>
            <video id="video" controls autoplay style="width: 80%; max-width: 800px;"></video>
            <script>
                var video = document.getElementById('video');
                if (Hls.isSupported()) {
                    var hls = new Hls();
                    hls.loadSource('/stream.m3u8'); // Load the stream
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MANIFEST_PARSED, function() {
                        video.play();
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

app.listen(8080, () => console.log("🎥 Server running at http://localhost:8080"));

// Start FFmpeg initially
appendNewFilesToInputList();
startFFmpeg();

// Check for new files every 5 seconds and append them to the list
setInterval(appendNewFilesToInputList, 5000);
