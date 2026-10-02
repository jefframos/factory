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
    /** Fill of the progress bar — any CSS background: a color or a gradient. */
    fillColor?: string;
    /** CSS box-shadow on the fill — e.g. an inset top highlight for a glossy look. Default none. */
    fillShadow?: string;
    /** CSS border-radius of the fill's own ends (rounded leading edge). Default '0' — square, clipped by the bar's own radius. */
    fillRadius?: string;
    /** Behind the fill (the "empty" portion of the bar) — any CSS background: a color or a gradient. */
    backgroundColor?: string;
    borderColor?: string;
    borderWidth?: string;
    borderRadius?: string;
    /** CSS box-shadow on the whole bar — drop shadow and/or an inset to look recessed. Default none. */
    shadow?: string;
}

export interface LoaderConfig {
    /** Covers the whole screen behind the bar — any CSS background: a color or a gradient. */
    backgroundColor?: string;
    /** Color of the Pong paddles + ball above the bar (any CSS background). Default white. */
    accentColor?: string;
    /** CSS box-shadow on the paddles + ball. Default none. */
    accentShadow?: string;
    /** Optional tiling pattern drawn over the background. */
    pattern?: LoaderPatternConfig;
    bar?: LoaderBarConfig;
    /** Fade-out duration in ms when hide() is called. */
    fadeDuration?: number;
}
