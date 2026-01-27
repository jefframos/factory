// assetpack.config.ts
import { ffmpeg } from "@assetpack/core/ffmpeg";

export default {
    pipes: [
        ffmpeg({
            inputs: ['.mp3', '.ogg', '.wav', '.m4a', '.mp4'],
            outputs: [
                {
                    formats: ['.mp3'],
                    recompress: false,
                    options: {
                        audioBitrate: 96,
                        audioChannels: 1,
                        audioFrequency: 48000,
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