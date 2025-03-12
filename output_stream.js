const fs = require('fs');
const path = require('path');
const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const chokidar = require('chokidar');

const router = express.Router();
const VIDEO_FOLDERS = path.join(__dirname, 'chunks'); // Translated video folders

const ensureDirExists = (dirPath) => {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
};

// Function to list all available languages dynamically
const getAvailableLanguages = () => {
    return fs.readdirSync(VIDEO_FOLDERS)
        .filter(folder => fs.statSync(path.join(VIDEO_FOLDERS, folder)).isDirectory());
};

// Function to convert videos to HLS for a given language
const convertToHLS = async (language) => {
    const folderPath = path.join(VIDEO_FOLDERS, language);
    const hlsFolderPath = path.join(folderPath, 'hls');

    ensureDirExists(hlsFolderPath);
    console.log(`✅ Created HLS folder for ${language}`);

    const videos = fs.readdirSync(folderPath)
        .filter(file => file.endsWith('.mp4'))
        .sort((a, b) => fs.statSync(path.join(folderPath, a)).mtimeMs - fs.statSync(path.join(folderPath, b)).mtimeMs);

    if (videos.length === 0) {
        console.log(`❌ No videos found for ${language}`);
        return null;
    }

    const hlsPlaylistPath = path.join(hlsFolderPath, 'stream.m3u8');

    return new Promise((resolve, reject) => {
        const ffmpegCommand = ffmpeg();

        // Add all video files to FFmpeg input
        videos.forEach(video => {
            ffmpegCommand.input(path.join(folderPath, video));
        });

        ffmpegCommand
            .outputOptions([
                '-preset ultrafast',
                '-g 48',
                '-sc_threshold 0',
                '-hls_time 5',  // Each segment = 5 sec
                '-hls_list_size 0', // Keep all segments
                '-hls_flags delete_segments', // Remove old segments
            ])
            .output(hlsPlaylistPath)
            .on('end', () => {
                console.log(`✅ HLS stream updated for ${language}`);
                resolve(hlsPlaylistPath);
            })
            .on('error', (err) => {
                console.error(`❌ Error generating HLS for ${language}:`, err);
                reject(err);
            })
            .run();
    });
};

// Watch for new videos and convert them to HLS
const watchForNewVideos = (language) => {
    const folderPath = path.join(VIDEO_FOLDERS, language);

    // Convert existing videos to HLS on startup
    convertToHLS(language).catch(err => console.error(err));

    // Watch for new videos
    chokidar.watch(folderPath).on('add', async (filename) => {
        if (filename.endsWith('.mp4')) {
            console.log(`🆕 New video detected for ${language}: ${filename}`);
            setTimeout(async () => {
                await convertToHLS(language);
            }, 3000);
        }
    });
};

// Serve list of available languages dynamically
router.get('/languages', (req, res) => {
    const languages = getAvailableLanguages();
    res.json({ languages });
});

// Serve HLS playlist
router.get('/hls/:language/stream.m3u8', async (req, res) => {
    const { language } = req.params;
    const hlsFolderPath = path.join(VIDEO_FOLDERS, language, 'hls');
    const hlsPlaylistPath = path.join(hlsFolderPath, 'stream.m3u8');

    if (!fs.existsSync(hlsPlaylistPath)) {
        console.error(`❌ HLS playlist not found for ${language}`);
        return res.status(404).send('HLS stream not found');
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.sendFile(hlsPlaylistPath);
});

// Serve HLS segments
router.get('/hls/:language/:segment', async (req, res) => {
    const { language, segment } = req.params;
    const segmentPath = path.join(VIDEO_FOLDERS, language, 'hls', segment);

    if (!fs.existsSync(segmentPath)) {
        console.error(`❌ Segment not found: ${segment}`);
        return res.status(404).send('Segment not found');
    }

    res.setHeader('Content-Type', 'video/MP2T');
    res.sendFile(segmentPath);
});

// Start watching for new videos dynamically
getAvailableLanguages().forEach(watchForNewVideos);

module.exports = router;