import { resolve } from 'path';
import { defineConfig } from 'vite';
const GAME = process.env.GAME;

if (!GAME) {
    throw new Error('Please specify the GAME environment variable, e.g., GAME=game1');
}

export default defineConfig({
    root: `games/${GAME}`,
    base: `/`,
    publicDir: resolve(__dirname, 'public'),
    // base: `./`,
    resolve: {
        alias: {
            '@core': resolve(__dirname, 'core'),
        },
    },
    build: {
        //outDir: resolve(__dirname, 'dist', GAME),
        outDir: `../../dist/${GAME}`,
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(__dirname, `games/${GAME}/index.html`),
        },
    },
    server: {
        host: '0.0.0.0', port: 9001, open: true,
    }
});
