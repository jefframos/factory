import { texturePacker, texturePackerCompress } from '@assetpack/core/texture-packer';

const options = {
    jpg: {},
    png: { quality: 90 },
    webp: { quality: 80, alphaQuality: 80, },
    avif: false,
    bc7: false,
    astc: false,
    basis: false,
    etc: false
};

export default {
    pipes: [
        texturePacker({
            texturePacker: {
                padding: 2,
                nameStyle: "relative",
                removeFileExtension: false,
            },
            resolutionOptions: {
                template: "@%%x",
                resolutions: { default: 1, low: 0.5 },
                fixedResolution: "default",
                maximumTextureSize: 8192,
            },
        }),
        //compress(options),
        texturePackerCompress(options),
    ]
};