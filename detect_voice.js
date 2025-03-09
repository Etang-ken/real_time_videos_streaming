// const { VoiceActivityDetector } = require('vad');
// const ffmpeg = require('fluent-ffmpeg');
// const fs = require('fs');

// class VoiceDetector {
//     constructor() {
//         this.vad = new VoiceActivityDetector();
//         this.voiceDetected = false;
//     }

//     /**
//      * Check if an AAC audio file contains voice activity.
//      * @param {string} filePath - Path to the AAC audio file.
//      * @returns {Promise<boolean>} - True if voice is detected, false otherwise.
//      */
//     async detectVoice(filePath) {
//         return new Promise((resolve, reject) => {
//             if (!fs.existsSync(filePath)) {
//                 console.error('❌ File does not exist:', filePath);
//                 reject(new Error('File does not exist'));
//                 return;
//             }

//             console.log('🔍 Analyzing audio file:', filePath);

//             // Decode AAC to raw PCM using FFmpeg
//             const ffmpegCommand = ffmpeg(filePath)
//                 .audioChannels(1) // Convert to mono
//                 .audioFrequency(16000) // Set sample rate to 16kHz
//                 .format('s16le') // Output raw PCM data
//                 .on('error', (err) => {
//                     console.error('❌ FFmpeg error:', err.message);
//                     reject(err);
//                 })
//                 .on('end', () => {
//                     console.log('✅ Audio processing complete.');
//                     this.vad.end();
//                     resolve(this.voiceDetected);
//                 });

//             // Pipe PCM data to the VAD
//             const stream = ffmpegCommand.pipe();
//             this.vad.setAudioFormat(16000, 1); // Set sample rate and channels

//             stream.on('data', (chunk) => {
//                 this.vad.process(chunk);
//             });

//             // Handle VAD events
//             this.vad.on('voice-start', () => {
//                 console.log('🎤 Voice detected!');
//                 this.voiceDetected = true;
//             });

//             this.vad.on('voice-stop', () => {
//                 console.log('🔇 Voice stopped.');
//             });

//             this.vad.on('error', (err) => {
//                 console.error('❌ VAD error:', err.message);
//                 reject(err);
//             });
//         });
//     }
// }

// module.exports = VoiceDetector;