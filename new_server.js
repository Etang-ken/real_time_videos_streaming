// const express = require('express')
const ffmpeg = require('fluent-ffmpeg')
// const cors = require('cors')
const fs = require('fs')
const path = require('path')

const { translateAudio } = require('./audio.js') // Import your translation logic
const { exec } = require('child_process')

const outputFolder = path.join(__dirname, 'chunks') // Video chunks
const audioFolder = path.join(__dirname, 'audios') // Translated audio files
const MAX_RETRIES = 3
const extractAudio = (inputVideo, outputAudio) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputVideo)) {
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

async function extractBackgroundMusic(inputFilePath, outputFilePath) {
  const cmd = `ffmpeg -i '${inputFilePath}' -af "afftdn=nf=-30" '${outputFilePath}'`

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`)
      return
    }
    console.log(`Background music extracted successfully!`)
  })
}

// Merge translated audio back into the video

// Process each video chunk: extract, translate, and merge audio
const processChunks = async (ws, chunk, language, chunkIndex) => {
  if (chunk.startsWith('translated_')) {
    return // Skip already translated chunks
  }

  const videoLanguageFolder = path.join(outputFolder, language)
  const audioLanguageFolder = path.join(audioFolder, 'translations', language)
  if (!fs.existsSync(videoLanguageFolder)) {
    fs.mkdirSync(videoLanguageFolder, { recursive: true })
  }
  if (!fs.existsSync(audioLanguageFolder)) {
    fs.mkdirSync(audioLanguageFolder, { recursive: true })
  }

  const videoInput = path.join(outputFolder, chunk)
  const audioPath = path.join(
    audioFolder,
    'original',
    chunk.replace('.mp4', '.aac')
  )
  const bgAudioPath = path.join(
    audioFolder,
    'bg_music',
    chunk.replace('.mp4', '.aac')
  )
  const translatedAudioPath = path.join(
    audioLanguageFolder,
    `translated_${chunk.replace('.mp4', '.aac')}`
  )
  const convertedChunk = `converted_audios/${chunk.replace('.mp4', '.wav')}`
  const finalVideoPath = path.join(videoLanguageFolder, `translated_${chunk}`)

  try {
    // Extract audio
    await extractAudio(videoInput, audioPath)
    await extractBackgroundMusic(audioPath, bgAudioPath)
    // Translate audio
    // await translateAudio(
    //   ws,
    //   language,
    //   audioPath,
    //   translatedAudioPath,
    //   videoInput,
    //   finalVideoPath,
    //   convertedChunk,
    //   chunkIndex
    // )

    console.log(`Translation complete for chunk: ${chunk}`)
  } catch (error) {
    console.error(`Error processing ${chunk}:`, error)
  }
}

module.exports = { processChunks }
