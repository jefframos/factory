import dotenv from 'dotenv';
import { resolve } from 'path';
import { defineConfig } from 'vite';

// Load .env file
dotenv.config();

const GAME = process.env.GAME;

if (!GAME) {
    throw new Error('Please specify the GAME environment variable in your .env file (GAME=game1)');
}

export default defineConfig({
    root: `games/${GAME}`,
    base: './',
    publicDir: resolve(__dirname, 'public'),
    resolve: {
        alias: {
            '@core': resolve(__dirname, 'core'),
        },
    },
    build: {
        outDir: `../../dist/`,
        emptyOutDir: true,
        rollupOptions: {
            input: resolve(__dirname, `games/${GAME}/index.html`),
        },
    },
    server: {
        host: '0.0.0.0',
        port: 9001,
        open: true,
    }
});


// import { defineConfig } from 'vite';
// import { resolve } from 'path';

// const GAME = process.env.GAME;

// if (!GAME) {
//   throw new Error('Missing GAME env variable. Set it in your .env file.');
// }

// export default defineConfig({
//   root: `games/${GAME}`,
//   base: '/',
//   publicDir: resolve(__dirname, 'public'),
//   resolve: {
//     alias: {
//       '@core': resolve(__dirname, 'core'),
//     },
//   },
//   build: {
//     outDir: `../../dist/${GAME}`,
//     emptyOutDir: true,
//     rollupOptions: {
//       input: resolve(__dirname, `games/${GAME}/index.html`),
//     },
//   },
// });
