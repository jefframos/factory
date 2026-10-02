import { LoaderConfig } from 'core/loader/LoaderConfig';

// Casual/hybrid-casual look: a saturated blue backdrop (the game's sky/water family, pushed
// brighter), a glossy golden bar with a white rim in a recessed dark-blue track, and white Pong
// pieces with a soft drop shadow.
const loaderConfig: LoaderConfig = {
    backgroundColor: 'radial-gradient(circle at 50% 40%, #6fd3ff 0%, #2f9bff 45%, #1a5fd9 100%)',
    accentColor: '#ffffff',
    accentShadow: '0 3px 0 rgba(10, 40, 120, 0.35)',
    bar: {
        width: '320px',
        height: '30px',
        fillColor: 'linear-gradient(180deg, #ffe680 0%, #ffc61a 50%, #ff9f0a 100%)',
        // Glossy highlight along the top, darker lip along the bottom.
        fillShadow: 'inset 0 3px 0 rgba(255, 255, 255, 0.55), inset 0 -3px 0 rgba(200, 90, 0, 0.35)',
        fillRadius: '999px',
        backgroundColor: 'rgba(8, 36, 110, 0.45)',
        borderColor: '#ffffff',
        borderWidth: '3px',
        borderRadius: '999px',
        // Drop shadow under the bar + inner shadow so the track reads as recessed.
        shadow: '0 4px 0 rgba(10, 40, 120, 0.35), inset 0 3px 6px rgba(0, 0, 40, 0.35)',
    },
    fadeDuration: 400,
};

export default loaderConfig;
