import pako from 'pako';

/**
 * Loads a file that may be gzip-compressed (.gz). If the URL ends with .gz,
 * fetches and decompresses it; otherwise fetches normally. Returns a blob URL
 * that can be passed to THREE.js loaders (FBXLoader, GLTFLoader, etc.).
 */
export async function loadCompressedFile(url: string): Promise<string> {
    if (!url.endsWith('.gz')) {
        return url;
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }

        const compressed = await response.arrayBuffer();
        const decompressed = pako.inflate(new Uint8Array(compressed));
        const blob = new Blob([decompressed], { type: 'application/octet-stream' });

        return URL.createObjectURL(blob);
    } catch (error) {
        console.error(`Error decompressing ${url}:`, error);
        throw error;
    }
}

/** Release a blob URL created by loadCompressedFile() when done with it. */
export function releaseObjectURL(url: string): void {
    if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
}
