const { execSync } = require('child_process')
const Ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const path = require('path')

const MAX_RETRIES = 3
let retryCount = 0
const INPUT_LIST_FILE = path.join(__dirname, 'file_lists/input_list.txt')

const mergeAudioWithVideo = (videoChunk, translatedAudio, outputVideo) => {
  return new Promise((resolve, reject) => {
    Ffmpeg()
      .input(videoChunk)
      .input(translatedAudio)
      .output(outputVideo)
      .videoCodec('copy')
      .audioCodec('aac')
      .outputOptions(['-map 0:v:0', '-map 1:a:0', '-shortest', '-err_detect ignore_err'])
      .on('end', () => {
        console.log('Merged Video: ', outputVideo)
        return resolve(outputVideo)
      })
      .on('error', (err) => {
        console.error('Merged Video error: ', err)
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
}

const translateAudio = async (
  ws,
  language,
  audioFilePath,
  translatedAudioPath,
  videoChunkPath,
  finalVideoPath,
  tempWavPath,
  chunkIndex
) => {
  return new Promise((resolve, reject) => {
    // Use a unique outputRawFile for each translation request
    const outputRawFile = `./audios/raw/translated_audio_${chunkIndex}.raw`
    const entry = `file '${finalVideoPath}'\n`

    // Convert the audio to WAV format
    const command = `ffmpeg -i "${audioFilePath}" -ac 1 -ar 24000 -sample_fmt s16 "${tempWavPath}" -y`

    try {
      execSync(command, { encoding: 'utf-8' })
    } catch (error) {
      console.error('FFmpeg Error:', error.message)
      reject(error)
      return
    }

    // Read the converted file as base64
    const audioBuffer = fs.readFileSync(tempWavPath)
    const base64Audio = audioBuffer.toString('base64')

    // Send the audio to the WebSocket for translation
    const event = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_audio',
            audio: base64Audio
          }
        ]
      }
    }

    ws.send(JSON.stringify(event))

    // Send the translation request
    const event2 = {
      type: 'response.create',
      response: {
        modalities: ['audio', 'text'],
        instructions: `Translate the spoken words in this audio to ${language}.`
        // instructions: `Transcribe and translate the spoken words in this audio stream to ${language} while maintaining the speaker’s gender and approximate age in the translated voice. Ignore background speech and other non-verbal sounds from translation, but preserve all background sounds, music, and ambient noise in the final output..`
        // voice: 'alloy',
      }
    }

    ws.send(JSON.stringify(event2))

    // Array to store received audio chunks
    let receivedAudioChunks = []
    let isTranslationComplete = false

    // Unique event handler for this translation request
    const handleMessage = (message) => {
      const serverEvent = JSON.parse(message.toString())
      console.log('Websocket Message:', serverEvent)

      if (serverEvent.type === 'response.audio.delta' && serverEvent.delta) {
        receivedAudioChunks.push(serverEvent.delta)
      }
      if (serverEvent.type === 'response.done') {
        // Append the file path to input.txt
        // fs.appendFileSync(INPUT_LIST_FILE, entry, 'utf8')
        // fs.appendFileSync(`\nOutput Done: ${serverEvent} \n \n`,entry, 'utf8')
        console.log('Path to file:', finalVideoPath)
        console.log('Done Response:', serverEvent)
      }

      if (serverEvent.type === 'response.output_item.done') {
        console.log('Translation complete. Writing file... ')
        // fs.appendFileSync(INPUT_LIST_FILE, entry, 'utf8')
        // fs.appendFileSync(`\nDone: ${serverEvent}\n \n` ,entry, 'utf8')
        isTranslationComplete = true

        // Combine all audio chunks and write to file
        const audioData = Buffer.from(receivedAudioChunks.join(''), 'base64')
        fs.writeFileSync(outputRawFile, audioData)

        try {
          // Convert the raw audio to AAC format
          execSync(
            `ffmpeg -f s16le -ar 24000 -ac 1 -i "${outputRawFile}" -c:a aac -b:a 128k "${translatedAudioPath}" -y`
          )

          // Merge the translated audio with the video
          mergeAudioWithVideo(
            videoChunkPath,
            translatedAudioPath,
            finalVideoPath
          )
            .then(() => {
              // Remove the event listener for this translation request
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

      // Handle max_output_tokens error
      if (
        serverEvent.type === 'response.done' &&
        serverEvent.response.status === 'incomplete'
      ) {
        if (
          serverEvent.response.status_details.reason === 'max_output_tokens'
        ) {
          console.error(
            'Max output tokens reached. Retrying with smaller audio chunk...'
          )
          ws.off('message', handleMessage)
          // if (retryCount < MAX_RETRIES) {
          //   retryCount++
          //   ws.on('message', handleMessage)
          // } else {
          reject(new Error('Max output tokens reached.'))
          // }
        } else if (
          serverEvent.response.status_details.reason === 'content_filter'
        ) {
          console.error('Content filter error...')
        }
      }

      // Handle session expired error
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
        // if (retryCount < MAX_RETRIES) {
        //   retryCount++
        //   ws.on('message', handleMessage)
        // } else {
        reject(new Error('Max output tokens reached.'))
        // }
        reject(new Error('Session expired.'))
      }
    }

    // Attach the event listener for this translation request
    ws.on('message', handleMessage)

    // Add a timeout to handle cases where the translation is incomplete
    const timeoutDuration = 60000 // 60 seconds timeout
    const timeout = setTimeout(() => {
      if (!isTranslationComplete) {
        // console.error('Translation incomplete. Retrying...')
        ws.off('message', handleMessage)
        reject(new Error('Translation incomplete.'))
      }
    }, timeoutDuration)

    // Refresh the session every 25 minutes to prevent expiration
    const sessionRefreshInterval = 25 * 60 * 1000 // 25 minutes
    const sessionRefresh = setInterval(() => {
      const refreshEvent = {
        type: 'session.update',
        session: {
          instructions: 'Continue translation.'
        }
      }
      ws.send(JSON.stringify(refreshEvent))
      console.log('Session refreshed.')
    }, sessionRefreshInterval)

    // Cleanup on completion or error
    const cleanup = () => {
      clearTimeout(timeout)
      clearInterval(sessionRefresh)
      ws.off('message', handleMessage)
    }

    // Resolve or reject the promise
    resolve()
      .then(cleanup)
      .catch((err) => {
        cleanup()
        reject(err)
      })
  })
}

// const translateAudio = async (
//   ws,
//   language,
//   audioFilePath,
//   translatedAudioPath,
//   videoChunkPath,
//   finalVideoPath,
//   tempWavPath,
//   chunkIndex
// ) => {
//   return new Promise((resolve, reject) => {
//     // Use a unique outputRawFile for each translation request
//     const outputRawFile = `./audios/translated_audio_${chunkIndex}.raw`;

//     // Convert the audio to WAV format
//     const command = `ffmpeg -i "${audioFilePath}" -ac 1 -ar 24000 -sample_fmt s16 "${tempWavPath}" -y`;

//     try {
//       execSync(command, { encoding: 'utf-8' });
//     } catch (error) {
//       console.error('FFmpeg Error:', error.message);
//       reject(error);
//       return;
//     }

//     // Read the converted file as base64
//     const audioBuffer = fs.readFileSync(tempWavPath);
//     const base64Audio = audioBuffer.toString('base64');

//     // Send the audio to the WebSocket for translation
//     const event = {
//       type: 'conversation.item.create',
//       item: {
//         type: 'message',
//         role: 'user',
//         content: [
//           {
//             type: 'input_audio',
//             audio: base64Audio,
//           },
//         ],
//       },
//     };

//     ws.send(JSON.stringify(event));

//     // Send the translation request
//     const event2 = {
//       type: 'response.create',
//       response: {
//         modalities: ['audio', 'text'],
//         instructions: `Translate this audio to ${language}.`,
//         voice: 'alloy',
//       },
//     };

//     ws.send(JSON.stringify(event2));

//     // Array to store received audio chunks
//     let receivedAudioChunks = [];
//     let isTranslationComplete = false;

//     // Unique event handler for this translation request
//     const handleMessage = (message) => {
//       const serverEvent = JSON.parse(message.toString());
//       console.log('WebSocket Message:', serverEvent);
//       if (serverEvent.type === 'response.audio.delta' && serverEvent.delta) {
//         receivedAudioChunks.push(serverEvent.delta);
//         console.log(`Received audio chunk: ${serverEvent.delta.length} bytes`);
//       }

//       if (serverEvent.type === 'response.output_item.done') {
//         console.log('Translation complete. Writing file...');
//         isTranslationComplete = true;

//         // Combine all audio chunks and write to file
//         const audioData = Buffer.from(receivedAudioChunks.join(''), 'base64');
//         fs.writeFileSync(outputRawFile, audioData);

//         try {
//           // Convert the raw audio to AAC format
//           execSync(
//             `ffmpeg -f s16le -ar 24000 -ac 1 -i "${outputRawFile}" -c:a aac -b:a 128k "${translatedAudioPath}" -y`
//           );

//           // Merge the translated audio with the video
//           mergeAudioWithVideo(videoChunkPath, translatedAudioPath, finalVideoPath)
//             .then(() => {
//               // Remove the event listener for this translation request
//               ws.off('message', handleMessage);
//               resolve();
//             })
//             .catch((err) => {
//               ws.off('message', handleMessage);
//               reject(err);
//             });
//         } catch (ffmpegError) {
//           ws.off('message', handleMessage);
//           reject(ffmpegError);
//         }
//       }
//     };

//     // Attach the event listener for this translation request
//     ws.on('message', handleMessage);

//     // Add a timeout to handle cases where the translation is incomplete
//     setTimeout(() => {
//       if (!isTranslationComplete) {
//         console.error('Translation incomplete. Retrying...');
//         ws.off('message', handleMessage);
//         reject(new Error('Translation incomplete.'));
//       }
//     }, 30000); // 30 seconds timeout
//   });
// };

// const translateAudio = async (
//   ws,
//   language,
//   audioFilePath,
//   translatedAudioPath,
//   videoChunkPath,
//   finalVideoPath,
//   tempWavPath,
//   chunkIndex
// ) => {
//   const command = `ffmpeg -i "${audioFilePath}" -ac 1 -ar 24000 -sample_fmt s16 "${tempWavPath}" -y`

//   try {
//     const output = execSync(command, { encoding: 'utf-8' }) // Capture stdout
//     console.log('FFmpeg Output:', output)
//   } catch (error) {
//     console.error('FFmpeg Error:', error.message)
//     console.error('FFmpeg stderr:', error.stderr?.toString())
//   }

//   // Read the converted file as base64
//   const audioBuffer = fs.readFileSync(tempWavPath)
//   const base64Audio = audioBuffer.toString('base64')
//   const outputRawFile = './audios/translated_audio.raw'
//   const event = {
//     type: 'conversation.item.create',
//     item: {
//       type: 'message',
//       role: 'user',
//       content: [
//         {
//           type: 'input_audio',
//           audio: base64Audio
//         }
//       ]
//     }
//   }
//   ws.send(JSON.stringify(event))

//   // ws.on('message', (data) => {
//   //   const serverEvent = JSON.parse(data.toString())
//   //   console.log('Received data:', serverEvent)

//   // })

//   // if (chunkIndex % 6 === 0) {
//   // console.log('Ping to be kept')
//   //   if (ws.readyState === WebSocket.OPEN) {
//   // ws.send(
//   //   JSON.stringify({
//   //     type: 'session.update',
//   //     session: {
//   //       modalities: ['audio', 'text'],
//   //       instructions: 'Continue'
//   //     }
//   //   })
//   // )
//   // console.log('Ping sent to keep WebSocket alive')
//   // //   }
//   // } else {

//   const event2 = {
//     type: 'response.create',
//     response: {
//       modalities: ['audio', 'text'],
//       instructions: `Translate this audio to ${language}.`,
//       voice: 'alloy'
//       // instructions: `Translate this audio to ${language}. Let the translated audio length match the origial audio. Include all background sounds. Inject emotions into your voice. Talk gently. If no voice is talking, just stay quiet until the perso or another person starts talking.`
//       // instructions: `Translate this audio to ${language}. Let the translated audio length match the origial audio. Include all background sounds. Inject emotions into your voice. Talk gently. Most importantly, please select the voice that match the current speaker's, be it female, male, child or any voice, please let it match atleast, or be related.`
//     }
//   }

//   ws.send(JSON.stringify(event2))

//   // }

//   // WebRTC data channel and WebSocket both have .send()

//   let receivedAudioChunks = []

//   ws.on('message', (message) => {
//     const serverEvent = JSON.parse(message.toString())
//     console.log('New Server event: ', serverEvent)
//     // if (serverEvent.type === 'session.updated')
//     if (
//       (serverEvent.response !== undefined &&
//         serverEvent.response.status === 'incomplete') ||
//       serverEvent.type === 'session.updated'
//     ) {
//       receivedAudioChunks = []
//       translateAudio(
//         ws,
//         language,
//         audioFilePath,
//         translatedAudioPath,
//         videoChunkPath,
//         finalVideoPath,
//         chunkIndex
//       )
//     }
//     if (serverEvent.type === 'response.audio.delta' && serverEvent.delta) {
//       // console.log('Server event: ', serverEvent)
//       receivedAudioChunks.push(serverEvent.delta)
//     }

//     if (serverEvent.type === 'response.output_item.done') {
//       console.log('Translation complete. Writing file...')
//       const audioData = Buffer.from(receivedAudioChunks.join(''), 'base64')
//       fs.writeFileSync(outputRawFile, audioData)
//       try {
//         // execSync(
//         //   `ffmpeg -f s16le -ar 24000 -ac 1 -i "${outputRawFile}" "${translatedAudioPath}" -y`
//         // )
//         execSync(
//           `ffmpeg -f s16le -ar 24000 -ac 1 -i "${outputRawFile}" -c:a aac -b:a 128k "${translatedAudioPath}" -y`
//         )
//         mergeAudioWithVideo(videoChunkPath, translatedAudioPath, finalVideoPath)

//         return
//         // 4️⃣ Convert WAV to MP3 if needed
//         // execSync(
//         //   `ffmpeg -i "${outputWavFile}" -acodec mp3 "${outputMp3File}" -y`
//         // )
//         // console.log(`Converted MP3 saved as: ${outputMp3File}`)
//       } catch (ffmpegError) {
//         console.error('FFmpeg conversion error:', ffmpegError)
//       }
//     }
//   })

//   console.log('Here')
// }

module.exports = { translateAudio }
