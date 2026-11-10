// plugin.mjs
//
// The Vite plugin the recorder adds to a project's own dev server: the in-game hook (client/inject.js) as the first
// script of the game's page, and the recorder's pages and API under /__recorder. Nothing in the game changes.

import { createApi } from './api.mjs';

export function recorderPlugin({ outDir, cwd }) {
    return {
        name: 'game-recorder',
        apply: 'serve',
        transformIndexHtml(html) {
            // A plain (not module) script first in <head>: it runs before the game's code does.
            return html.replace(/<head[^>]*>/i, (head) => `${head}\n    <script src="/__recorder/client/inject.js"></script>`);
        },
        configureServer(server) {
            server.middlewares.use('/__recorder', createApi({ outDir, cwd }));
        },
    };
}
