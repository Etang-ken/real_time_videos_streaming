const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.static('public'));

app.get('/stream', (req, res) => {
    const videoDir = path.join(__dirname, '../french');
    const files = fs.readdirSync(videoDir).sort();

    // Filter out non-video files (e.g., .DS_Store)
    const videos = files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ext === '.mp4'; // Only include .mp4 files
    });

    if (videos.length === 0) {
        return res.status(404).send('No video files found in the directory.');
    }

    const command = ffmpeg();

    videos.forEach(video => {
        command.input(path.join(videoDir, video));
    });

    res.header('Content-Type', 'video/mp4');
    command
        .outputOptions('-c copy')
        .outputOptions('-movflags frag_keyframe+empty_moov')
        .format('mp4')
        .on('error', (err) => {
            console.error('Error occurred:', err);
            res.status(500).send('Error processing video stream.');
        })
        .pipe(res, { end: true });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});