const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const path = require('path')
const { translateAudio } = require('./audio.js')

const OUTPUT_FOLDER = path.join(__dirname, 'chunks') // Video chunks folder
const AUDIO_FOLDER = path.join(__dirname, 'audios') // Translated audio folder
const SUBTITLE_FOLDER = path.join(AUDIO_FOLDER, 'subtitles') // Translated audio folder

const ensureDirExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

const extractAudio = (inputVideo, outputAudio) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputVideo)) {
      return reject(new Error(`Input video file does not exist: ${inputVideo}`))
    }
    ffmpeg(inputVideo)
      .output(outputAudio)
      .noVideo()
      .audioCodec('aac')
      .on('end', () => resolve(outputAudio))
      .on('error', reject)
      .run()
  })
}

const processChunks = async (ws, chunk, language, extraParams) => {
  if (chunk.startsWith('translated_')) return // Skip already translated chunks

  const videoLanguageFolder = path.join(OUTPUT_FOLDER, language)
  const audioLanguageFolder = path.join(AUDIO_FOLDER, 'translations', language)
  const rawLanguageFolder = path.join(AUDIO_FOLDER, 'raw', language)
  // const subtitleLanguageFolder = path.join(SUBTITLE_FOLDER, language)
  const subtitleLanguageFolder = `audios/subtitles/${language}`

  ensureDirExists(videoLanguageFolder)
  ensureDirExists(audioLanguageFolder)
  ensureDirExists(rawLanguageFolder)
  ensureDirExists(subtitleLanguageFolder)

  const videoInput = path.join(OUTPUT_FOLDER, chunk)
  const audioPath = path.join(
    AUDIO_FOLDER,
    'original',
    chunk.replace('.mp4', '.aac')
  )
  const outputRawFile = path.join(
    rawLanguageFolder,
    `translated_${chunk.replace('.mp4', '.raw')}`
  )
  const translatedAudioPath = path.join(
    audioLanguageFolder,
    `translated_${chunk.replace('.mp4', '.aac')}`
  )
  const subtitlePath = `${subtitleLanguageFolder}/sub_${chunk.replace(
    '.mp4',
    '.srt'
  )}`
  const convertedChunk = `converted_audios/${chunk.replace('.mp4', '.wav')}`
  const finalVideoPath = path.join(videoLanguageFolder, `translated_${chunk}`)

  try {
    await extractAudio(videoInput, audioPath)
    await translateAudio(
      ws,
      language,
      audioPath,
      translatedAudioPath,
      videoInput,
      finalVideoPath,
      convertedChunk,
      outputRawFile,
      subtitlePath,
      extraParams
    )
    console.log(`✅ Translation complete for chunk: ${chunk}`)
  } catch (error) {
    console.error(`❌ Error processing ${chunk}:`, error)
  }
}

module.exports = { processChunks }

// // const express = require('express')
// const ffmpeg = require('fluent-ffmpeg')
// // const cors = require('cors')
// const fs = require('fs')
// const path = require('path')

// const { translateAudio } = require('./audio.js') // Import your translation logic
// const { exec } = require('child_process')
// // const { detectVoice } = require('./detect_voice.js')

// const outputFolder = path.join(__dirname, 'chunks') // Video chunks
// const audioFolder = path.join(__dirname, 'audios') // Translated audio files
// const MAX_RETRIES = 3
// const extractAudio = (inputVideo, outputAudio) => {
//   return new Promise((resolve, reject) => {
//     if (!fs.existsSync(inputVideo)) {
//       return reject(new Error(`Input video file does not exist: ${inputVideo}`))
//     }
//     ffmpeg(inputVideo)
//       .output(outputAudio)
//       .noVideo()
//       .audioCodec('aac')
//       .on('end', () => resolve(outputAudio))
//       .on('error', (err) => reject(err))
//       .run()
//   })
// }

// function convertToPCM(inputFile, outputFile) {
//   return new Promise((resolve, reject) => {
//     const command = `ffmpeg -y -i "${inputFile}" -ac 1 -ar 16000 -sample_fmt s16 -acodec pcm_s16le "${outputFile}"`
//     exec(command, (error, stdout, stderr) => {
//       if (error) {
//         reject(new Error(`Error converting audio: ${stderr}`))
//       } else {
//         resolve(outputFile)
//       }
//     })
//   })
// }

// // Process each video chunk: extract, translate, and merge audio
// const processChunks = async (ws, chunk, language, chunkIndex) => {
//   if (chunk.startsWith('translated_')) {
//     return // Skip already translated chunks
//   }

//   const videoLanguageFolder = path.join(outputFolder, language)
//   const audioLanguageFolder = path.join(audioFolder, 'translations', language)
//   const rawLanguageFolder = path.join(audioFolder, 'raw', language)
//   if (!fs.existsSync(videoLanguageFolder)) {
//     fs.mkdirSync(videoLanguageFolder, { recursive: true })
//   }
//   if (!fs.existsSync(audioLanguageFolder)) {
//     fs.mkdirSync(audioLanguageFolder, { recursive: true })
//   }
//   if (!fs.existsSync(rawLanguageFolder)) {
//     fs.mkdirSync(rawLanguageFolder, { recursive: true })
//   }

//   const videoInput = path.join(outputFolder, chunk)
//   const audioPath = path.join(
//     audioFolder,
//     'original',
//     chunk.replace('.mp4', '.aac')
//   )
//   const outputRawFile = path.join(
//    rawLanguageFolder,
//     `translated_${chunk.replace('.mp4', '.raw')}`
//   )
//   const translatedAudioPath = path.join(
//     audioLanguageFolder,
//     `translated_${chunk.replace('.mp4', '.aac')}`
//   )
//   const convertedChunk = `converted_audios/${chunk.replace('.mp4', '.wav')}`
//   const finalVideoPath = path.join(videoLanguageFolder, `translated_${chunk}`)

//   try {
//     // Extract audio
//     await extractAudio(videoInput, audioPath)
//     // await convertToPCM(audioPath, pcmPath)
//     // await detectVoice(audioPath)
//     // Translate audio
//     await translateAudio(
//       ws,
//       language,
//       audioPath,
//       translatedAudioPath,
//       videoInput,
//       finalVideoPath,
//       convertedChunk,
//       outputRawFile,
//       chunkIndex
//     )

//     console.log(`Translation complete for chunk: ${chunk}`)
//   } catch (error) {
//     console.error(`Error processing ${chunk}:`, error)
//   }
// }

// module.exports = { processChunks }
