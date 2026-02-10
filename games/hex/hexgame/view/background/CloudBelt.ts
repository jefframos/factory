import * as PIXI from "pixi.js";

export interface CloudSettings {
    count: number;
    textures: PIXI.Texture[];
    scaleRange: { min: number, max: number };
    yRange: { start: number, end: number };
    speedRange: { min: number, max: number };
    xNoise: number;
    side: 'left' | 'right';
    circularRadius: number;
    circularSpeed: number;
    overlapPercent: number; // e.g., 0.3 for 30% overlap
}

interface CloudData {
    sprite: PIXI.Sprite;
    speed: number;
    angle: number;
    angleStep: number;
    spawnX: number;
    currentPathY: number;
}

export class CloudBelt extends PIXI.ParticleContainer {
    private clouds: CloudData[] = [];
    private settings: CloudSettings;
    private lastY: number = 0; // Tracks the tail of the cloud stack

    constructor(settings: CloudSettings) {
        super(settings.count, {
            position: true,
            scale: true,
            rotation: true,
            alpha: false,
            uvs: true
        });
        this.settings = settings;
        this.setupClouds();
    }

    private setupClouds(): void {
        // Start the stack slightly above the yRange to ensure no initial gap
        this.lastY = this.settings.yRange.start - 200;

        for (let i = 0; i < this.settings.count; i++) {
            const texture = this.settings.textures[Math.floor(Math.random() * this.settings.textures.length)];
            const sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5);

            const data: CloudData = {
                sprite,
                speed: 0,
                angle: Math.random() * Math.PI * 2,
                angleStep: (Math.random() > 0.5 ? 1 : -1) * this.settings.circularSpeed,
                spawnX: 0,
                currentPathY: 0
            };

            // Initial build of the stack
            this.resetCloud(data, true);
            this.addChild(sprite);
            this.clouds.push(data);
        }
    }

    private resetCloud(data: CloudData, isInitial: boolean = false): void {
        const baseScale = this.settings.scaleRange.min + Math.random() * (this.settings.scaleRange.max - this.settings.scaleRange.min);

        // Flip logic
        const scaleX = this.settings.side === 'left' ? -baseScale : baseScale;
        data.sprite.scale.set(scaleX, baseScale);

        // X Positioning with Noise
        const halfWidth = (data.sprite.texture.width * baseScale) / 2;
        const noise = Math.random() * this.settings.xNoise;
        data.spawnX = this.settings.side === 'left' ? -(halfWidth + noise) : (halfWidth + noise);

        // Movement Speed
        data.speed = this.settings.speedRange.min + Math.random() * (this.settings.speedRange.max - this.settings.speedRange.min);

        // --- GAP FIX LOGIC ---
        const cloudHeight = data.sprite.texture.height * baseScale;
        const overlap = cloudHeight * this.settings.overlapPercent;

        if (isInitial) {
            // Stack them downwards initially
            data.currentPathY = this.lastY;
            this.lastY += (cloudHeight - overlap);
        } else {
            // When wrapping from bottom to top, find the highest cloud in the belt
            let highestY = this.clouds[0].currentPathY;
            for (const c of this.clouds) {
                if (c.currentPathY < highestY) highestY = c.currentPathY;
            }
            // Place this cloud above the current highest one
            data.currentPathY = highestY - (cloudHeight - overlap);
        }
    }

    public update(delta: number): void {
        for (const data of this.clouds) {
            data.currentPathY += data.speed * delta;
            data.angle += data.angleStep * delta;

            const offsetX = Math.cos(data.angle) * this.settings.circularRadius;
            const offsetY = Math.sin(data.angle) * this.settings.circularRadius;

            data.sprite.x = data.spawnX + offsetX;
            data.sprite.y = data.currentPathY + offsetY;

            // Loop logic: if cloud passes bottom, reset it to the top of the stack
            if (data.currentPathY > this.settings.yRange.end + 300) {
                this.resetCloud(data, false);
            }
        }
    }
}