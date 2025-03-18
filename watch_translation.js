const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const express = require('express')

// const activeStreams = new Map()

function setupLanguageStream(language) {
  const STREAM_BASE_DIR = path.join(__dirname, 'stream')
  const CHUNKS_BASE_DIR = path.join(__dirname, 'chunks')
  const INPUT_LIST_BASE_DIR = path.join(__dirname, 'file_lists')
  const app = express()

  if (!fs.existsSync(STREAM_BASE_DIR)) {
    fs.mkdirSync(STREAM_BASE_DIR, { recursive: true })
  }
  if (!fs.existsSync(INPUT_LIST_BASE_DIR)) {
    fs.mkdirSync(INPUT_LIST_BASE_DIR, { recursive: true })
  }
  const videoDir = path.join(CHUNKS_BASE_DIR, language)
  const streamDir = path.join(STREAM_BASE_DIR, language)
  const inputListFile = path.join(
    INPUT_LIST_BASE_DIR,
    `${language}_input_list.txt`
  )

  if (!fs.existsSync(videoDir)) {
    console.log(`❌ Language directory '${videoDir}' does not exist.`)
    return { success: false, message: 'Language directory missing' }
  }
  if (!fs.existsSync(streamDir)) {
    fs.mkdirSync(streamDir, { recursive: true })
  }

  let filesAdded = false

  function appendNewFilesToInputList() {
    let existingFiles = new Set()
    let chunkFiles = []

    if (fs.existsSync(inputListFile)) {
      existingFiles = new Set(
        fs.readFileSync(inputListFile, 'utf8').split('\n').filter(Boolean)
      )
    }
    if (!filesAdded) {
      for (let i = 0; i <= 4000; i++) {
        const chunkName = `translated_chunk_${String(i).padStart(3, '0')}.mp4`
        const chunkPath = path.join(videoDir, chunkName)
        chunkFiles.push(`file '${chunkPath}'`)
      }
      filesAdded = true
    }
    fs.writeFileSync(inputListFile, chunkFiles.join('\n') + '\n')
  }

  function startFFmpeg() {
    // if (activeStreams.has(language)) {
    //   console.log(`🔄 Restarting FFmpeg for ${language}...`)
    //   activeStreams.get(language).kill('SIGTERM')
    // }

    console.log(`🚀 Starting FFmpeg stream for ${language}...`)
    const ffmpegProcess = spawn('ffmpeg', [
      '-re',
      '-err_detect',
      'ignore_err',
      '-fflags',
      'discardcorrupt+genpts',
      '-vsync',
      '0',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      inputListFile,
      '-c:v',
      'copy',
      '-c:a',
      'copy',
      '-f',
      'hls',
      '-hls_time',
      '3',
      '-hls_list_size',
      '10',
      '-hls_flags',
      'append_list',
      path.join(streamDir, 'stream.m3u8')
    ])

    ffmpegProcess.stderr.on('data', (data) => {
      console.error(`FFmpeg Error (${language}): ${data}`)
    })
    ffmpegProcess.stderr.on('data', (data) => {
      console.error(`FFmpeg Error: ${data}`)
      const errorMessage = data.toString()

      const match = errorMessage.match(
        /Impossible to open '(.+?translated_chunk_(\d+)\.mp4)'/
      )

      if (match) {
        const missingFile = `translated_chunk_${match[2]}.mp4`
        console.log(`⚠️ Missing file detected: ${missingFile}`)
        removePreviousFiles(missingFile)
      }
    })
    ffmpegProcess.on('close', (code) => {
      console.log(`FFmpeg for ${language} exited with code ${code}`)
    })

    // activeStreams.set(language, ffmpegProcess)
  }

  function removePreviousFiles(missingFile) {
    let inputFiles = fs
      .readFileSync(inputListFile, 'utf8')
      .split('\n')
      .filter(Boolean)
  
    const missingFilePath = `file '${path.join(videoDir, missingFile)}'`
    const index = inputFiles.indexOf(missingFilePath)
  
    if (index === -1) {
      console.log(`❌ Missing file ${missingFile} not found in the list.`)
      return
    }
  
    // Get all files before the missing one
    // const filesToDelete = inputFiles.slice(0, index)
  
    // filesToDelete.forEach((fileEntry) => {
    //   const filePath = fileEntry.replace(/^file '|'$/g, '') // Remove "file ''" wrapper
    //   if (fs.existsSync(filePath)) {
    //     fs.unlinkSync(filePath)
    //     console.log(`🗑 Deleted: ${filePath}`)
    //   }
    // })
  
    // Update the file list, keeping only the remaining files
    const remainingFiles = inputFiles.slice(index + 1)
    fs.writeFileSync(inputListFile, remainingFiles.join('\n') + '\n')
  
    console.log('✅ Updated input_list.txt')
  
    startFFmpeg() // Restart FFmpeg with updated files
  }

  appendNewFilesToInputList()
  startFFmpeg()
  // return { success: true, process: ffmpegProcess }
  // setInterval(appendNewFilesToInputList, 5000)
}

module.exports = { setupLanguageStream }

// const fs = require('fs')
// const path = require('path')
// const { spawn } = require('child_process')
// const express = require('express')

// const VIDEO_DIR = path.join(__dirname, 'chunks/french')
// const STREAM_DIR = path.join(__dirname, 'stream')
// const INPUT_LIST_FILE = path.join(__dirname, 'file_lists/input_list.txt')
// let filesAdded = false

// // Ensure the stream output directory exists
// if (!fs.existsSync(STREAM_DIR)) {
//   fs.mkdirSync(STREAM_DIR, { recursive: true })
// }
// let ffmpegProcess = null

// // Function to update the input list dynamically without restarting FFmpeg
// function appendNewFilesToInputList() {
//   let existingFiles = new Set()
//   let chunkFiles = []

//   // Read existing input_list.txt if it exists
//   if (fs.existsSync(INPUT_LIST_FILE)) {
//     existingFiles = new Set(
//       fs.readFileSync(INPUT_LIST_FILE, 'utf8').split('\n').filter(Boolean)
//     )
//   }
//   if (!filesAdded) {
//     for (let i = 0; i <= 2000; i++) {
//       const chunkName = `translated_chunk_${String(i).padStart(3, '0')}.mp4`
//       const chunkPath = path.join(VIDEO_DIR, chunkName)
//       chunkFiles.push(`file '${chunkPath}'`)
//     }
//     filesAdded = true
//   }
//   console.log('Files added successfully')
//   // Write the list to input_list.txt
//   fs.writeFileSync(INPUT_LIST_FILE, chunkFiles.join('\n') + '\n')
//   const newFiles = fs
//     .readdirSync(VIDEO_DIR)
//     .filter(
//       (file) => file.startsWith('translated_chunk_') && file.endsWith('.mp4')
//     )
//     .sort()
//     .map((file) => `file '${path.join(VIDEO_DIR, file)}'`)

//   const newEntries = newFiles.filter((file) => !existingFiles.has(file))

//   if (newEntries.length > 0) {
//     // fs.appendFileSync(INPUT_LIST_FILE, newEntries.join('\n') + '\n')
//     console.log('✅ Added new files to input_list.txt')
//     // start
//   }
// }

// // Function to start FFmpeg streaming without restarting on new files
// function startFFmpeg() {
//   if (ffmpegProcess) {
//     console.log('🔄 Restarting FFmpeg...')
//     ffmpegProcess.kill('SIGTERM')
//   }

//   console.log('🚀 Starting FFmpeg stream...')

//   ffmpegProcess = spawn('ffmpeg', [
//     '-re',
//     '-err_detect',
//     'ignore_err',
//     '-fflags',
//     'discardcorrupt',
//     '-vsync',
//     '0',
//     '-f',
//     'concat',
//     '-safe',
//     '0',
//     '-i',
//     INPUT_LIST_FILE,
//     '-c:v',
//     'copy',
//     '-c:a',
//     'copy',
//     '-f',
//     'hls',
//     '-hls_time',
//     '3',
//     '-hls_list_size',
//     '10',
//     '-hls_flags',
//     'append_list',
//     path.join(STREAM_DIR, 'stream.m3u8')
//   ])

//   ffmpegProcess.stdout.on('data', (data) => {
//     console.log(`FFmpeg: ${data}`)
//     const errorMessage = data.toString()
//   })
//   ffmpegProcess.stderr.on('data', (data) => {
//     console.error(`FFmpeg Error: ${data}`)
//     const errorMessage = data.toString()

//     const match = errorMessage.match(
//       /Impossible to open '(.+?translated_chunk_(\d+)\.mp4)'/
//     )

//     if (match) {
//       const missingFile = `translated_chunk_${match[2]}.mp4`
//       console.log(`⚠️ Missing file detected: ${missingFile}`)
//       removePreviousFiles(missingFile)
//     }
//   })
//   ffmpegProcess.on('close', (code) => {
//     console.log(`FFmpeg exited with code ${code}`)
//     if (code !== 0) {
//       // removeCorruptedFileAndRestart();
//     }
//   })

//   return ffmpegProcess
// }

