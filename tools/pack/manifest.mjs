import { pixiManifest } from "@assetpack/core/manifest";
import { spineAtlasManifestMod } from '@assetpack/core/spine';

export default {
    pipes: [
        // These options are the default values, all options shown here are optional
        // This should be the last pipe in the list
        pixiManifest({
            output: "manifest.json",
            createShortcuts: true,
            trimExtensions: false,
            includeMetaData: true,
            nameStyle: 'short'
        }),
        spineAtlasManifestMod(),
    ],
};