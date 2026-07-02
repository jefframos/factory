export interface LoaderPatternConfig {
    /** Path to a tiling image, resolved the same way manifest asset paths are (relative to the public root). */
    image: string;
    /** CSS background-size for the tile, e.g. '128px' or 'cover'. Defaults to 'auto'. */
    size?: string;
    /** Opacity of the pattern layer (0-1). Defaults to 0.15. */
    opacity?: number;
}

export interface LoaderBarConfig {
    width?: string;
    height?: string;
    /** Fill color of the progress bar. */
    fillColor?: string;
    /** Background color behind the fill (the "empty" portion of the bar). */
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: string;
    borderRadius?: string;
}

export interface LoaderConfig {
    /** Background color covering the whole screen behind the bar. */
    backgroundColor?: string;
    /** Optional tiling pattern drawn over the background. */
    pattern?: LoaderPatternConfig;
    bar?: LoaderBarConfig;
    /** Fade-out duration in ms when hide() is called. */
    fadeDuration?: number;
}
