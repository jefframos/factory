import pako from 'pako';

/**
 * Loads a file that may be gzip-compressed (.gz). If the URL ends with .gz,
 * fetches and decompresses it; otherwise fetches normally. Returns a blob URL
 * that can be passed to THREE.js loaders (FBXLoader, GLTFLoader, etc.).
 *
 * Works on localhost and GitHub Pages / any static host.
 */
export async function loadCompressedFile(url: string): Promise<string> {
    if (!url.endsWith('.gz')) {
        // Not gzipped, return the original URL
        return url;
    }

    try {
        // Fetch the .gz file as an ArrayBuffer
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
        }

        const compressed = await response.arrayBuffer();

        // Decompress using pako
        const decompressed = pako.inflate(new Uint8Array(compressed));

        // Create a blob from the decompressed data
        const blob = new Blob([decompressed], { type: 'application/octet-stream' });

        // Return a blob URL that loaders can use
        return URL.createObjectURL(blob);
    } catch (error) {
        console.error(`Error decompressing ${url}:`, error);
        throw error;
    }
}

/**
 * Release a blob URL created by loadCompressedFile() when done with it.
 * Call this after the loader finishes so the memory can be freed.
 */
export function releaseObjectURL(url: string): void {
    if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
    }
}
