const { execSync } = require('child_process')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const getMediaDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err)
      } else {
        resolve(metadata.format.duration)
      }
    })
  })
}

const mergeAudioWithVideo = async (
  videoChunk,
  translatedAudio,
  outputVideo
) => {
  try {
    const audioDuration = await getMediaDuration(translatedAudio)
    console.log(`🔍 Translated audio duration: ${audioDuration} seconds`)

    if (audioDuration < 5) {
      console.log(
        '⚠️ Translated audio is less than 5s. Storing original video instead.'
      )
      fs.copyFileSync(videoChunk, outputVideo)
      return outputVideo // Return original video
    }

    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoChunk)
        .input(translatedAudio)
        .output(outputVideo)
        .videoCodec('copy')
        .audioCodec('aac')
        .outputOptions(['-map 0:v:0', '-map 1:a:0', '-shortest'])
        .on('end', () => {
          console.log(`✅ Merged Video: ${outputVideo}`)
          resolve(outputVideo)
        })
        .on('error', (err) => {
          // console.error('❌ Merging Video Error:', err);
          // console.log('⚠️ Returning original video due to audio merge failure:', videoChunk);
          // fs.copyFileSync(videoChunk, outputVideo);
          // reject(err);

          console.error('❌Merged Video error: ', err)
          if (err.message.includes('ffmpeg exited with code 187')) {
            console.log(
              'Returning original video due to audio merge failure:',
              videoChunk
            )
            fs.copyFileSync(videoChunk, outputVideo)
          }

          reject(err) //
        })
        .run()
    })
  } catch (err) {
    console.error('❌ Error checking audio duration:', err)
    throw err
  }
}

// const mergeAudioWithVideo = (videoChunk, translatedAudio, outputVideo) => {
//   return new Promise((resolve, reject) => {
//     ffmpeg()
//       .input(videoChunk)
//       .input(translatedAudio)
//       .output(outputVideo)
//       .videoCodec('copy')
//       .audioCodec('aac')
//       .outputOptions(['-map 0:v:0', '-map 1:a:0', '-shortest'])
//       .on('end', () => {
//         console.log(`✅ Merged Video: ${outputVideo}`)
//         resolve(outputVideo)
//       })
//       .on('error', (err) => {
//         // console.error('❌ Merging Video Error:', err);
//         // console.log('⚠️ Returning original video due to audio merge failure:', videoChunk);
//         // fs.copyFileSync(videoChunk, outputVideo);
//         // reject(err);

//         console.error('❌Merged Video error: ', err)
//         if (err.message.includes('ffmpeg exited with code 187')) {
//           console.log(
//             'Returning original video due to audio merge failure:',
//             videoChunk
//           )
//           fs.copyFileSync(videoChunk, outputVideo)
//         }

//         reject(err) //
//       })
//       .run()
//   })
// }

const translateAudio = async (
  ws,
  language,
  audioFilePath,
  translatedAudioPath,
  videoChunkPath,
  finalVideoPath,
  tempWavPath,
  outputRawFile
) => {
  return new Promise((resolve, reject) => {
    try {
      execSync(
        `ffmpeg -i "${audioFilePath}" -ac 1 -ar 24000 -sample_fmt s16 "${tempWavPath}" -y`,
        { encoding: 'utf-8' }
      )
    } catch (error) {
      console.error('❌ FFmpeg Error:', error.message)
      return reject(error)
    }

    const base64Audio = fs.readFileSync(tempWavPath).toString('base64')
    ws.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_audio', audio: base64Audio }]
        }
      })
    )

    ws.send(
      JSON.stringify({
        type: 'response.create',
        response: {
          modalities: ['audio', 'text'],
          instructions: `Translate the spoken words in this audio to ${language}. If audio cannot be translated, add 'intranslatable audio' text at the end of the transcript response text.`
        }
      })
    )

    let receivedAudioChunks = []
    let isTranslationComplete = false
    let isIntranslatable = false

    const handleMessage = (message) => {
      const serverEvent = JSON.parse(message.toString())
      if (serverEvent.type === 'response.audio.delta' && serverEvent.delta)
        receivedAudioChunks.push(serverEvent.delta)
      if (serverEvent.type === 'response.audio_transcript.done') {
        if (
          serverEvent.transcript
            .toLowerCase()
            .includes('intranslatable audio') ||
          serverEvent.transcript.length < 30
        ) {
          isIntranslatable = true
          console.log('⚠️ Non-Translatable Audio...')
          return mergeAudioWithVideo(
            videoChunkPath,
            audioFilePath,
            finalVideoPath
          )
        }
      }
      if (serverEvent.type === 'response.output_item.done') {
        isTranslationComplete = true
        fs.writeFileSync(
          outputRawFile,
          Buffer.from(receivedAudioChunks.join(''), 'base64')
        )
        if (!isIntranslatable) {
          try {
            execSync(
              `ffmpeg -f s16le -ar 24000 -ac 1 -i "${outputRawFile}" -c:a aac -b:a 128k "${translatedAudioPath}" -y`
            )
            mergeAudioWithVideo(
              videoChunkPath,
              translatedAudioPath,
              finalVideoPath
            )
              .then(() => {
                if (fs.existsSync(outputRawFile)) fs.unlinkSync(outputRawFile)
                ws.off('message', handleMessage)
                resolve()
              })
              .catch((err) => {
                ws.off('message', handleMessage)
                reject(err)
              })
          } catch (ffmpegError) {
            ws.off('message', handleMessage)
            reject(ffmpegError)
          }
        }
      }
    }

    ws.on('message', handleMessage)
    const timeout = setTimeout(() => {
      if (!isTranslationComplete) {
        console.error('⏳ Translation timeout. Using original audio instead.')
        mergeAudioWithVideo(videoChunkPath, audioFilePath, finalVideoPath)
          .then(resolve)
          .catch(reject)
        ws.off('message', handleMessage)
      }
    }, 60000)

    resolve().finally(() => clearTimeout(timeout))
  })
}

module.exports = { translateAudio }

// const { execSync } = require('child_process')
// const ffmpeg = require('fluent-ffmpeg')
// const fs = require('fs')
// const path = require('path')

// const mergeAudioWithVideo = (videoChunk, translatedAudio, outputVideo) => {
//   return new Promise((resolve, reject) => {
//     ffmpeg()
//       .input(videoChunk)
//       .input(translatedAudio)
//       .output(outputVideo)
//       .videoCodec('copy')
//       .audioCodec('aac')
//       .outputOptions([
//         '-map 0:v:0',
//         '-map 1:a:0',
//         // '-shortest',
//         '-err_detect ignore_err'
//       ])
//       .on('end', () => {
//         console.log('Merged Video: ', outputVideo)
//         return resolve(outputVideo)
//       })
//       .on('error', (err) => {
//         console.error('Merged Video error: ', err)
//         if (err.message.includes('ffmpeg exited with code 187')) {
//           console.log(
//             'Returning original video due to audio merge failure:',
//             videoChunk
//           )
//           fs.copyFileSync(videoChunk, outputVideo)
//         }

//         reject(err) //
//       })
//       .run()
//   })
// }

// const translateAudio = async (
//   ws,
//   language,
//   audioFilePath,
//   translatedAudioPath,
//   videoChunkPath,
//   finalVideoPath,
//   tempWavPath,
//   outputRawFile
// ) => {
//   let isIntranslatable = false
//   return new Promise((resolve, reject) => {
//     const command = `ffmpeg -i "${audioFilePath}" -ac 1 -ar 24000 -sample_fmt s16 "${tempWavPath}" -y`

//     try {
//       execSync(command, { encoding: 'utf-8' })
//     } catch (error) {
//       console.error('FFmpeg Error:', error.message)
//       reject(error)
//       return
//     }

//     const audioBuffer = fs.readFileSync(tempWavPath)
//     const base64Audio = audioBuffer.toString('base64')

//     const event = {
//       type: 'conversation.item.create',
//       item: {
//         type: 'message',
//         role: 'user',
//         content: [
//           {
//             type: 'input_audio',
//             audio: base64Audio
//           }
//         ]
//       }
//     }

//     ws.send(JSON.stringify(event))

//     const event2 = {
//       type: 'response.create',
//       response: {
//         modalities: ['audio', 'text'],
//         instructions: `Translate the spoken words in this audio to ${language}. If audio cannot be translated add 'intranslatable audio' text at the end of the transcript response text.`
//       }
//     }

//     ws.send(JSON.stringify(event2))

//     let receivedAudioChunks = []
//     let isTranslationComplete = false

//     const handleMessage = (message) => {
//       const serverEvent = JSON.parse(message.toString())
//       // console.log('Response:', serverEvent)
//       if (serverEvent.type === 'response.audio.delta' && serverEvent.delta) {
//         receivedAudioChunks.push(serverEvent.delta)
//       }
//       if (serverEvent.type === 'response.done') {
//         // console.log('Done Response:', serverEvent)
//       }
//       if (serverEvent.type === 'response.audio_transcript.done') {
//         console.log('Transcript Message:', serverEvent)
//         if (
//           serverEvent.transcript
//             .toLowerCase()
//             .includes('intranslatable audio') ||
//           serverEvent.transcript.length < 30
//         ) {
//           isIntranslatable = true
//           console.log('🚀🚀🚀-Non-Translated audio...')
//           mergeAudioWithVideo(videoChunkPath, audioFilePath, finalVideoPath)
//         }
//       }
//       if (serverEvent.type === 'response.output_item.done') {
//         // console.log('Audio translation:', serverEvent)
//         // console.log('Translation complete. Writing file... ')
//         isTranslationComplete = true

//         const audioData = Buffer.from(receivedAudioChunks.join(''), 'base64')
//         fs.writeFileSync(outputRawFile, audioData)
//         if (!isIntranslatable) {
//           console.log('🚀🚀🚀🚀🚀🚀-Translated audio...')
//           try {
//             execSync(
//               `ffmpeg -f s16le -ar 24000 -ac 1 -i "${outputRawFile}" -c:a aac -b:a 128k "${translatedAudioPath}" -y`
//             )

//             mergeAudioWithVideo(
//               videoChunkPath,
//               translatedAudioPath,
//               finalVideoPath
//             )
//               .then(() => {
//                 if (fs.existsSync(outputRawFile)) {
//                   fs.unlinkSync(outputRawFile) // Delete the raw file
//                   console.log(`Deleted raw file: ${outputRawFile}`)
//                 }
//                 ws.off('message', handleMessage)
//                 resolve()
//               })
//               .catch((err) => {
//                 ws.off('message', handleMessage)
//                 reject(err)
//               })
//           } catch (ffmpegError) {
//             ws.off('message', handleMessage)
//             reject(ffmpegError)
//           }
//         }
//       }

//       if (
//         serverEvent.type === 'response.done' &&
//         serverEvent.response.status === 'incomplete'
//       ) {
//         if (
//           serverEvent.response.status_details.reason === 'max_output_tokens'
//         ) {
//           console.error(
//             'Max output tokens reached. Retrying with smaller audio chunk...'
//           )
//           ws.off('message', handleMessage)
//           reject(new Error('Max output tokens reached.'))
//         } else if (
//           serverEvent.response.status_details.reason === 'content_filter'
//         ) {
//           console.error('Content filter error...')
//         }
//       }

//       if (
//         serverEvent.type === 'error' &&
//         serverEvent.error.code === 'session_expired'
//       ) {
//         console.error('Session expired. Refreshing session...')
//         const refreshEvent = {
//           type: 'session.update',
//           session: {
//             instructions: 'Continue translation.'
//           }
//         }
//         ws.send(JSON.stringify(refreshEvent))
//         ws.off('message', handleMessage)
//         reject(new Error('Session expired.'))
//       }
//     }

//     ws.on('message', handleMessage)

//     const timeoutDuration = 60000 // 60 seconds timeout
//     const timeout = setTimeout(() => {
//       if (!isTranslationComplete) {
//         ws.off('message', handleMessage)
//         reject(new Error('Translation incomplete.'))
//       }
//     }, timeoutDuration)

//     const sessionRefreshInterval = 25 * 60 * 1000 // 25 minutes
//     const sessionRefresh = setInterval(() => {
//       const refreshEvent = {
//         type: 'session.update',
//         session: {
//           instructions: 'Continue translation.'
//         }
//       }
//       ws.send(JSON.stringify(refreshEvent))
//       console.log('Session refreshed.')
//     }, sessionRefreshInterval)

//     const cleanup = () => {
//       clearTimeout(timeout)
//       clearInterval(sessionRefresh)
//       ws.off('message', handleMessage)
//     }

//     resolve()
//       .then(cleanup)
//       .catch((err) => {
//         cleanup()
//         reject(err)
//       })
//   })
// }

// module.exports = { translateAudio }
