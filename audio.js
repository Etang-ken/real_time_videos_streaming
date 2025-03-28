const { execSync, exec } = require('child_process')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const path = require('path')
const { default: axios } = require('axios')
const getMediaDuration = (filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        return
      } else {
        resolve(metadata.format.duration)
      }
    })
  })
}

const mergeAudioWithVideo = async (
  originalAudio,
  videoChunk,
  translatedAudio,
  outputVideo,
  subtitlePath,
  extraParams
) => {
  console.log('⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️ extra params: ', extraParams)
  try {
    const audioDuration = await getMediaDuration(translatedAudio)
    console.log(`🔍 Translated audio duration: ${audioDuration} seconds`)

    if (audioDuration < 4) {
      console.log('⚠️ Translated audio is too short. Using original video.')
      return mergeAudioWithVideo(
        originalAudio,
        videoChunk,
        originalAudio,
        outputVideo,
        subtitlePath,
        extraParams
      )
    }

    return new Promise((resolve, reject) => {
      const originalAudioVolume = extraParams.addOriginalVoice
        ? parseInt(extraParams.addOriginalVoice) / 10
        : 0
      ffmpeg()
        .input(videoChunk)
        .input(translatedAudio)
        .input(originalAudio)
        .output(outputVideo)
        .videoCodec('copy') // Keep the original video codec
        .audioCodec('aac')
        .complexFilter([
          `[2:a]volume=${originalAudioVolume}[original_audio]`,
          '[1:a][original_audio]amix=inputs=2:duration=longest[mixed_audio]'
        ])
        .outputOptions([
          '-map 0:v:0', // Keep original video stream
          '-map [mixed_audio]', // Use mixed audio stream
          '-shortest'
        ])
        .on('end', async () => {
          console.log(`✅ Merged Video: ${outputVideo}`)

          // Step 2: Add Subtitles as an Overlay Efficiently

          // streamVideo('french', outputVideo)
          const finalVideo = outputVideo.replace('.mp4', '_subtitled.mp4')
          if (extraParams.addSubtitles) {
            await addSubtitlesOverlay(outputVideo, subtitlePath, finalVideo)
          } else {
            fs.copyFileSync(outputVideo, finalVideo)
          }

          resolve(finalVideo)
        })
        .on('error', async (err) => {
          console.error('❌ Merging Video Error:', err)
          if (err.message.includes('ffmpeg exited with code 187')) {
            console.log(
              'Returning original video due to audio merge failure:',

              videoChunk
            )

            // fs.copyFileSync(videoChunk, outputVideo);

            await mergeAudioWithVideo(
              originalAudio,
              videoChunk,
              originalAudio,
              outputVideo,
              subtitlePath,
              extraParams
            )
          }
          resolve(err)
        })
        .run()
    })
  } catch (err) {
    console.error('❌ Error processing video:', err)
    throw err
  }
}

// Function to overlay subtitles without re-encoding the video
const addSubtitlesOverlay = (inputVideo, subtitleFile, outputVideo) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputVideo)
      .input(subtitleFile)
      .outputOptions([
        '-c:v libx264', // Ensure compatibility
        '-preset ultrafast', // Speed up processing
        '-vf',
        `subtitles=${subtitleFile}:force_style='FontName=Arial,FontSize=14,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=20'`,
        '-c:a copy' // Copy audio to save processing time
      ])
      .output(outputVideo)
      .on('end', () => {
        console.log(`✅ Subtitled Video: ${outputVideo}`)
        // streamVideo('french', outputVideo)
        // setTimeout(async () => {
        //   await axios.post('http://localhost:3002/stream-vid', {
        //     videoPath: outputVideo,
        //     language: 'french'
        //   })
        // }, 3000)
        resolve(outputVideo)
      })
      .on('error', (err) => {
        try {
          fs.copyFileSync(inputVideo, outputVideo)

          console.log(
            `✅ Copied original video to ${outputVideo} due to subtitle error`
          )
          resolve(outputVideo)
        } catch (copyErr) {
          console.error('❌ Error copying original video:', copyErr)
          resolve(null)
        }
      })
      .run()
  })
}

// const mergeAudioWithVideo = async (
//   originalAudio,
//   videoChunk,
//   translatedAudio,
//   outputVideo,
//   subtitlePath
// ) => {
//   try {
//     const audioDuration = await getMediaDuration(translatedAudio)
//     console.log(`🔍 Translated audio duration: ${audioDuration} seconds`)

//     if (audioDuration < 4) {
//       console.log(
//         '⚠️ Translated audio is less than 5s. Storing original video instead.'
//       )
//       mergeAudioWithVideo(
//         originalAudio,
//         videoChunk,
//         originalAudio,
//         outputVideo,
//         subtitlePath
//       )
//       // await transcodeVideo(outputVideo, outputVideo);
//       return // Return original video
//     }

//     return new Promise((resolve, reject) => {
//      const command = ffmpeg()
//         .input(videoChunk)
//         .input(translatedAudio)
//         .output(outputVideo)
//         .videoCodec('libx264')
//         .audioCodec('aac')
//         .outputOptions([
//           // '-map 0:v:0',
//           // '-map 1:a:0',
//           // '-map 2',
//           // '-c:s mov_text',
//           // '-disposition:s:0 default',
//           // '-shortest'
//           '-map 1:a:0', // Audio stream from the second input
//           '-shortest'
//         ])
//         command.complexFilter([
//           {
//             filter: 'subtitles',
//             options: subtitlePath.replace(/\\/g, '/'), // Burn subtitles into the video
//             inputs: '0:v:0', // Apply to the first video stream
//             outputs: 'subtitled_video' // Output of the filter
//           }
//         ]);

//         // Map the output of the filter to the final video stream
//         command.outputOptions(['-map [subtitled_video]']);
//         command.on('end', () => {
//           console.log(`✅ Merged Video: ${outputVideo}`)
//           resolve(outputVideo)
//         })
//         .on('error', async (err) => {
//           // console.error('❌ Merging Video Error:', err);
//           // console.log('⚠️ Returning original video due to audio merge failure:', videoChunk);
//           // fs.copyFileSync(videoChunk, outputVideo);
//           // reject(err);

//           console.error('❌Merged Video error: ', err)
//           if (err.message.includes('ffmpeg exited with code 187')) {
//             console.log(
//               'Returning original video due to audio merge failure:',
//               videoChunk
//             )
//             // fs.copyFileSync(videoChunk, outputVideo);
//             try {
//               const fallbackVideo = await mergeAudioWithVideo(
//                 originalAudio,
//                 videoChunk,
//                 originalAudio,
//                 outputVideo,
//                 subtitlePath
//               )
//               resolve(fallbackVideo)
//             } catch (fallbackErr) {
//               resolve(null)
//             }
//             // Transcode the copied video to the desired properties
//             // transcodeVideo(outputVideo, outputVideo)
//             //   .then(() => resolve(outputVideo))
//             //   .catch((err) => reject(err))
//           }

//           return
//         })
//         .run()
//     })
//   } catch (err) {
//     console.error('❌ Error checking audio duration:', err)
//     throw err
//   }
// }

// Function to transcode video to desired properties
const transcodeVideo = (inputVideo, outputVideo) => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputVideo)
      .output(outputVideo)
      .videoCodec('libx264') // Use a specific video codec
      .audioCodec('aac')
      .outputOptions([
        '-vf scale=1280:720', // Set resolution to 1280x720
        '-r 30', // Set frame rate to 30 fps
        '-b:v 1500k', // Set video bitrate to 1500 kbps
        '-b:a 128k', // Set audio bitrate to 128 kbps
        '-pix_fmt yuv420p' // Set pixel format
      ])
      .on('end', () => {
        console.log(`✅ Transcoded Video: ${outputVideo}`)
        resolve(outputVideo)
      })
      .on('error', (err) => {
        console.error('❌ Transcoding Video error: ', err)
        reject(err)
      })
      .run()
  })
}

const translateAudio = async (
  ws,
  language,
  audioFilePath,
  translatedAudioPath,
  videoChunkPath,
  finalVideoPath,
  tempWavPath,
  outputRawFile,
  subtitlePath,
  extraParams
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
    const processedOriginalAudio = `${audioFilePath.replace(
      '.aac',
      '_processed.aac'
    )}`
    execSync(
      `ffmpeg -i "${audioFilePath}" -c:a aac -b:a 128k -ar 24000 -ac 1 "${processedOriginalAudio}" -y`
    )
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
      // console.log('✅ Server Event: ', serverEvent)

      if (serverEvent.type === 'response.audio.delta' && serverEvent.delta)
        receivedAudioChunks.push(serverEvent.delta)
      if (serverEvent.type === 'response.audio_transcript.done') {
        console.log('✅✅✅ Transcript Audio: ', serverEvent)
        if (
          serverEvent.transcript
            .toLowerCase()
            .includes('intranslatable audio') ||
          serverEvent.transcript.length < 15
        ) {
          isIntranslatable = true
          console.log('⚠️ Non-Translatable Audio...')
          // return mergeAudioWithVideo(originalAudio,
          //   videoChunkPath,
          //   audioFilePath,
          //   finalVideoPath
          // )

          return mergeAudioWithVideo(
            processedOriginalAudio,
            videoChunkPath,
            processedOriginalAudio,
            finalVideoPath,
            subtitlePath,
            extraParams
          )
        }
        // Write transcript to SRT file
        const srtContent = `1\n00:00:00,000 --> 00:00:10,000\n${serverEvent.transcript}`
        fs.writeFileSync(subtitlePath, srtContent)
        // return fs.copyFileSync(videoChunkPath, finalVideoPath)
      }
      if (serverEvent.type === 'response.done') {
        console.log('✅✅✅✅✅ Done Response: ', serverEvent)
      }
      if (serverEvent.type === 'response.output_item.done') {
        console.log('✅✅✅✅✅✅✅ Audio Output: ', serverEvent)
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
              processedOriginalAudio,
              videoChunkPath,
              translatedAudioPath,
              finalVideoPath,
              subtitlePath,
              extraParams
            )
              .then(() => {
                // execSync(`ffmpeg -i ${finalVideoPath} -i ${subtitlePath} -c:v copy -c:a copy -c:s mov_text ${finalVideoPath}`)
                execSync(
                  `ffmpeg -i ${finalVideoPath} -vf "subtitles=${subtitlePath}" -c:v libx264 -c:a aac -shortest ${finalVideoPath}`
                )
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

      if (
        serverEvent.type === 'error' &&
        serverEvent.error.code === 'session_expired'
      ) {
        console.error('Session expired. Refreshing session...')
        const refreshEvent = {
          type: 'session.update',
          session: {
            instructions: 'Continue translation.'
          }
        }
        ws.send(JSON.stringify(refreshEvent))
        ws.off('message', handleMessage)
        return
      }
    }

    ws.on('message', handleMessage)
    const timeout = setTimeout(() => {
      if (!isTranslationComplete) {
        console.error('⏳ Translation timeout. Using original audio instead.')
        mergeAudioWithVideo(
          processedOriginalAudio,
          videoChunkPath,
          processedOriginalAudio,
          finalVideoPath,
          subtitlePath,
          extraParams
        )
          .then(resolve)
          .catch(reject)
        ws.off('message', handleMessage)
      }
    }, 60000)

    // const sessionRefreshInterval = 3 * 60 * 1000 // 25 minutes
    // const sessionRefresh = setInterval(() => {
    //   const refreshEvent = {
    //     type: 'session.update',
    //     session: {
    //       instructions: 'Continue translation.'
    //     }
    //   }
    //   ws.send(JSON.stringify(refreshEvent))
    //   console.log('🔄 Session refreshed.')
    // }, sessionRefreshInterval)

    const cleanup = () => {
      clearTimeout(timeout)
      // clearInterval(sessionRefresh)
      ws.off('message', handleMessage)
    }

    resolve()
      .then(cleanup)
      .catch((err) => {
        cleanup()
        reject(err)
      })

    // resolve().finally(() => clearTimeout(timeout))
  })
}

module.exports = { translateAudio }

// const { execSync } = require('child_process')
// const ffmpeg = require('fluent-ffmpeg')
// const fs = require('fs')
// const path = require('path')

// const mergeAudioWithVideo originalAudio,= (videoChunk, translatedAudio, outputVideo) => {
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
//           mergeAudioWithVideo(originalAudio,videoChunkPath, audioFilePath, finalVideoPath)
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

//             mergeAudioWithVideo(originalAudio,
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
