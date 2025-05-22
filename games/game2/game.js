/**
 * Flappy Bird Game with Open Game Protocol Integration
 */

// Game Configuration
const CONFIG = {
    gravity: 0.05,
    jumpStrength: 3,
    maxVelocity: 5,
    birdInitialY: 300,
    birdWidth: 30,
    birdHeight: 30,
    birdX: 50,
    obstacleWidth: 50,
    obstacleSpeed: 2,
    gapSize: 150,
    canvasWidth: 400,
    canvasHeight: 600,
    birdColor: '#FFD700',
    obstacleColor: '#228B22'
};

// Game Element References
const DOM = {
    canvas: document.getElementById('gameCanvas'),
    startScreen: document.getElementById('startScreen'),
    gameOverScreen: document.getElementById('gameOverScreen'),
    startButton: document.getElementById('startButton'),
    playAgainButton: document.getElementById('playAgainButton'),
    finalScore: document.getElementById('finalScore'),
    ogpPointsDisplay: document.getElementById('ogpPoints')
};

// Game State
const gameState = {
    ctx: DOM.canvas.getContext('2d'),
    birdY: CONFIG.birdInitialY,
    birdVelocity: 0,
    obstacleX: CONFIG.canvasWidth,
    gap: CONFIG.gapSize,
    obstacleHeight: 0,
    score: 0,
    ogpPoints: 0,
    gameRunning: false,
    animationFrameId: null
};

// OGP Integration
class OGPManager {
    constructor() {
        this.ogp = null;
        this.isInitialized = false;
        this.initialize();
    }

    initialize() {
        try {
            console.log('Initializing OGP SDK...');
            this.ogp = new OpenGameSDK({
                ui: {
                    gameIcon: 'https://dpid.github.io/flappy-test/icon.png'
                },
                useCustomAuth: false
            });

            this.ogp.init({ gameId: 'flappy-bird', playerId: 'player-123'})
                .then(() => {
                    console.log('OGP SDK initialized successfully');
                    this.isInitialized = true;
                    this.setupListeners();
                    this.updateTotalOgpPoints();
                })
                .catch(error => {
                    console.error('Failed to initialize OGP SDK:', error);
                    this.handleInitError();
                });
            
            // Call gameReadyToPlay outside the init chain
            this.ogp.gameReadyToPlay();
        } catch (error) {
            console.error('Error initializing OGP:', error);
            this.handleInitError();
        }
    }

    setupListeners() {
        this.ogp.on('OnReady', () => {
            console.log('OGP SDK is ready');
            DOM.startScreen.style.display = 'block';
        });

        this.ogp.on('SavePointsSuccess', () => {
            console.log('OGP points saved successfully');
            this.updateTotalOgpPoints();
        });
    }

    handleInitError() {
        // Fallback to allow game to run without OGP
        DOM.startScreen.style.display = 'block';
    }

    saveScore(points) {
        if (!this.isInitialized || points <= 0) return Promise.resolve();

        return this.ogp.savePoints(points)
            .then(response => {
                console.log('Points saved:', response);
            })
            .catch(error => {
                console.error('Failed to save points:', error);
                return Promise.reject(error);
            });
    }

    updateTotalOgpPoints() {
        if (!this.isInitialized) return Promise.resolve();

        return this.ogp.getPoints()
            .then(response => {
                console.log('Total OGP points:', response);
                gameState.ogpPoints = response;
                DOM.ogpPointsDisplay.textContent = gameState.ogpPoints;
                return gameState.ogpPoints;
            })
            .catch(error => {
                console.error('Failed to get total OGP points:', error);
                return Promise.reject(error);
            });
    }
}

// Game Logic
class FlappyBirdGame {
    constructor(ogpManager) {
        this.ogpManager = ogpManager;
        this.setupEventListeners();
        this.resetObstacle();
    }

    setupEventListeners() {
        DOM.startButton.addEventListener('click', () => this.startGame());
        DOM.playAgainButton.addEventListener('click', () => this.startGame());
        DOM.canvas.addEventListener('click', () => this.jump());
        DOM.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.jump();
        });
        
        // Add keyboard support
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' || e.key === ' ' || e.keyCode === 32) {
                this.jump();
            }
        });
    }

    startGame() {
        DOM.startScreen.style.display = 'none';
        DOM.gameOverScreen.style.display = 'none';
        
        gameState.birdY = CONFIG.birdInitialY;
        gameState.birdVelocity = 0;
        gameState.obstacleX = CONFIG.canvasWidth;
        gameState.score = 0;
        gameState.gameRunning = true;
        
        this.resetObstacle();
        this.gameLoop();
    }

    gameLoop() {
        if (!gameState.gameRunning) return;
        
        this.update();
        this.render();
        
        gameState.animationFrameId = requestAnimationFrame(() => this.gameLoop());
    }

    update() {
        // Update bird position
        gameState.birdVelocity = Math.min(gameState.birdVelocity + CONFIG.gravity, CONFIG.maxVelocity);
        gameState.birdY += gameState.birdVelocity;

        // Update obstacle position
        gameState.obstacleX -= CONFIG.obstacleSpeed;
        
        // Check if obstacle passed
        if (gameState.obstacleX < -CONFIG.obstacleWidth) {
            this.resetObstacle();
            gameState.score++;
        }

        // Check for collisions
        this.checkCollisions();
    }

    render() {
        const { ctx } = gameState;
        
        // Clear canvas
        ctx.clearRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);

        // Draw bird
        ctx.fillStyle = CONFIG.birdColor;
        ctx.fillRect(CONFIG.birdX, gameState.birdY, CONFIG.birdWidth, CONFIG.birdHeight);

        // Draw obstacles
        ctx.fillStyle = CONFIG.obstacleColor;
        ctx.fillRect(gameState.obstacleX, 0, CONFIG.obstacleWidth, gameState.obstacleHeight);
        ctx.fillRect(
            gameState.obstacleX, 
            gameState.obstacleHeight + gameState.gap, 
            CONFIG.obstacleWidth, 
            CONFIG.canvasHeight - gameState.obstacleHeight - gameState.gap
        );

        // Draw score
        ctx.fillStyle = 'white';
        ctx.font = '24px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(`Score: ${gameState.score}`, 10, 30);
    }

    checkCollisions() {
        // Check if bird hit the ground or ceiling
        if (gameState.birdY < 0 || gameState.birdY + CONFIG.birdHeight > CONFIG.canvasHeight) {
            this.endGame();
            return;
        }

        // Check if bird hit an obstacle
        const birdRight = CONFIG.birdX + CONFIG.birdWidth;
        const birdBottom = gameState.birdY + CONFIG.birdHeight;
        const obstacleRight = gameState.obstacleX + CONFIG.obstacleWidth;
        
        if (
            birdRight > gameState.obstacleX && 
            CONFIG.birdX < obstacleRight &&
            (gameState.birdY < gameState.obstacleHeight || 
             birdBottom > gameState.obstacleHeight + gameState.gap)
        ) {
            this.endGame();
        }
    }

    resetObstacle() {
        gameState.obstacleX = CONFIG.canvasWidth;
        gameState.obstacleHeight = Math.random() * (CONFIG.canvasHeight - gameState.gap - 100) + 50;
    }

    endGame() {
        gameState.gameRunning = false;
        
        if (gameState.animationFrameId) {
            cancelAnimationFrame(gameState.animationFrameId);
            gameState.animationFrameId = null;
        }

        DOM.finalScore.textContent = gameState.score;
        DOM.ogpPointsDisplay.textContent = gameState.ogpPoints;
        DOM.gameOverScreen.style.display = 'block';

        if (gameState.score > 0) {
            this.ogpManager.saveScore(gameState.score)
        }
    }

    jump() {
        if (gameState.gameRunning) {
            gameState.birdVelocity = -CONFIG.jumpStrength;
        }
    }
}

// Initialize the game when the window loads
window.addEventListener('load', () => {
    const ogpManager = new OGPManager();
    const game = new FlappyBirdGame(ogpManager);
}); 