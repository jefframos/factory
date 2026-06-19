async function startLoadSDK(): Promise<void> {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");

        script.src = "https://www.youtube.com/game_api/v1";

        script.onload = () => {
            const check = () => {
                if (window.ytgame) {
                    resolve();
                } else {
                    setTimeout(check, 10);
                }
            };

            check();
        };

        script.onerror = reject;

        document.head.appendChild(script);
    });
}

async function bootstrap() {
    await startLoadSDK();

    // IMPORTANT: import your GAME file, not index.ts
    await import('./index.ts');

}

bootstrap();