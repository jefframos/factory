export interface SceneTheme {
    topColor: string;
    bottomColor: string;
    keyLightColor: number;
    fillLightColor: number;
    ambientColor: number;
    waterColor: number;
    intensity: number;
}

export const THEMES = {
    NIGHT: {
        topColor: '#020024',
        bottomColor: '#6a00ff',
        keyLightColor: 0xff0080, // Pink
        fillLightColor: 0x00ffff, // Cyan
        ambientColor: 0x202020,
        waterColor: 0x00f2ff,
        intensity: 2
    },
    DRIVE_MAD: {
        topColor: '#0072ff',    // Bold Electric Blue
        bottomColor: '#00c6ff', // Bright Cyan Horizon
        keyLightColor: 0xffffff, // Blinding White Sun
        fillLightColor: 0x99e6ff, // Blue-tinted shadow fill
        ambientColor: 0x4488ff,  // High-saturation blue shadows
        waterColor: 0x00c6ff,    // Vibrant Tropical Water
        intensity: 2.5           // High intensity for that "blown out" sunny look
    },
    DAY: {
        topColor: '#4ca1af', // Deep Sky Blue
        bottomColor: '#c4e0e5', // Soft Mist
        keyLightColor: 0xffffff, // White Sun
        fillLightColor: 0xfdfbd3, // Warm Bounce
        ambientColor: 0x88aaff, // Blueish shadows
        waterColor: 0x00aaff, // Deep Blue Water
        intensity: 1.2
    }
};