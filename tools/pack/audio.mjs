// assetpack.config.ts
import { ffmpeg } from "@assetpack/core/ffmpeg";

export default {
    pipes: [
        ffmpeg({
            inputs: ['.mp3', '.ogg', '.wav', '.m4a', '.mp4'],
            deleteOriginals: true,
            outputs: [
                {
                    formats: ['.webm'],
                    recompress: false,
                    options: {
                        audioBitrate: 96,
                        audioCodec: 'libopus'
                    },
                }
                // ,
                // {
                //     formats: ['.ogg'],
                //     recompress: false,
                //     options: {
                //         audioBitrate: 32,
                //         audioChannels: 1,
                //         audioFrequency: 22050,
                //     },
                // },
            ],
        }),
    ],
};