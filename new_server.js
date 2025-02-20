// const express = require('express')
const ffmpeg = require('fluent-ffmpeg')
// const cors = require('cors')
const fs = require('fs')
const path = require('path')

const { translateAudio } = require('./audio.js') // Import your translation logic

const outputFolder = path.join(__dirname, 'chunks') // Video chunks
const audioFolder = path.join(__dirname, 'audios') // Translated audio files
const MAX_RETRIES = 3;
const extractAudio = (inputVideo, outputAudio) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputVideo)) {
      console.error(`Error: Input file not found: ${inputVideo}`)
      return
    }
    ffmpeg(inputVideo)
      .output(outputAudio)
      .noVideo()
      .audioCodec('aac')
      .on('end', () => resolve(outputAudio))
      .on('error', (err) => reject(err))
      .run()
  })
}

// Merge translated audio back into the video

// Process each video chunk: extract, translate, and merge audio
const processChunks = async (ws, chunk, language, chunkIndex) => {
  if (chunk.startsWith('translated_')) {
    return; // Skip already translated chunks
  }

  const languageVideoFolder = path.join(outputFolder, language);
  if (!fs.existsSync(languageVideoFolder)) {
    fs.mkdirSync(languageVideoFolder, { recursive: true });
  }

  const videoInput = path.join(outputFolder, chunk);
  const videoChunkPath = path.join(languageVideoFolder, chunk);
  const audioPath = path.join(audioFolder, chunk.replace('.mp4', '.aac'));
  const translatedAudioPath = path.join(
    audioFolder,
    `translated_${chunk.replace('.mp4', '.aac')}`
  );
  const convertedChunk = `converted_audios/${chunk.replace('.mp4', '.wav')}`;
  const finalVideoPath = path.join(languageVideoFolder, `translated_${chunk}`);

  try {
    // Extract audio
    console.log('Extracting...');
    await extractAudio(videoInput, audioPath);

    // Translate audio
    console.log('Translating...');
    await translateAudio(
      ws,
      language,
      audioPath,
      translatedAudioPath,
      videoInput,
      finalVideoPath,
      convertedChunk,
      chunkIndex
    );

    console.log(`Translation complete for chunk: ${chunk}`);
  } catch (error) {
    console.error(`Error processing ${chunk}:`, error);
  }
};
// const processChunks = async (ws, chunk, language, chunkIndex) => {
 
//   console.log('Processing...')
//   if (chunk.startsWith('translated_')) {
//     // Skip already translated chunks
//     return
//   }

//   const languageVideoFolder = path.join(outputFolder, language)

//   // Ensure the folder exists (creates it if it doesn't)
//   if (!fs.existsSync(languageVideoFolder)) {
//     fs.mkdirSync(languageVideoFolder, { recursive: true })
//   }
//   const videoInput = path.join(outputFolder, chunk)
//   const videoChunkPath = path.join(languageVideoFolder, chunk)
//   const audioPath = path.join(audioFolder, chunk.replace('.mp4', '.aac'))
//   const translatedAudioPath = path.join(
//     audioFolder,
//     `translated_${chunk.replace('.mp4', '.aac')}`
//   )
//   const convertedChunk = `converted_audios/${chunk.replace('.mp4', '.wav')}`
//   const finalVideoPath = path.join(languageVideoFolder, `translated_${chunk}`)

//   try {
//     // Extract audio
//     console.log('Extracting...')
//     await extractAudio(videoInput, audioPath)
//     console.log('Translating...')
//     // Translate the extracted audio using your existing function
//     await translateAudio(
//       ws,
//       language,
//       audioPath,
//       translatedAudioPath,
//       videoInput,
//       finalVideoPath,
//       convertedChunk,
//       chunkIndex
//     )
//     await new Promise((resolve, reject) => {
//       const handleMessage = (message) => {
//         try {
//           const serverEvent = JSON.parse(message.toString())
//           if (serverEvent.type === 'response.done') {
//             ws.off('message', handleMessage)
//             resolve() // Resolve the promise with video URL
//           }
//         } catch (error) {
//           reject(error)
//         }
//       }

//       ws.on('message', handleMessage)

//       // Timeout in case WebSocket event never arrives
//       // setTimeout(() => {
//       //   ws.off('message', handleMessage)
//       //   reject(new Error('No translated video found after processing.'))
//       // }, 100000) // 10 seconds timeout
//     })

//     return
//     // set
//     // Merge translated audio with video
//   } catch (error) {
//     console.error(`Error processing ${chunk}:`, error)
//   }
// }

module.exports = { processChunks }

