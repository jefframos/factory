
import { json } from "@assetpack/core/json";

const GAME = process.env.GAME;
if (!GAME) {
    console.error('❌ Please specify GAME=game1');
    process.exit(1);
}

export default {
    pipes: [
        json()
    ]
};