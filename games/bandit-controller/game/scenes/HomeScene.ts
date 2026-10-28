// HomeScene.ts
//
// The friendly front screen: the squad idling in 3D, PLAY to resume the saved level,
// EDIT SQUAD, and CHOOSE LEVEL for the world picker with completion checks and locks.
// It only exposes Signals — index.ts is the one that changes scenes.

import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import * as THREE from 'three';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { BendService } from 'core/services/BendService';
import { TextureBuilder } from '../builders/TextureBuilder';
import {
    CHARACTER_VIEWS,
    SQUAD_COLORS,
    SQUAD_VIEW_NAMES,
    isSquadColorTaken,
    setSquadColor,
    resolveSkinImagePath,
    setSquadFace,
    setSquadHat,
} from '../data/CharacterViews';
import { GameState } from '../data/GameState';
import { FACES, HATS, Wardrobe, WardrobeItem } from '../data/Wardrobe';
import { HatIcons } from '../ui/HatIcons';
import { LevelCatalog, WorldInfo, worldGateStars } from '../data/LevelCatalog';
import { Progress } from '../data/Progress';
import type MainPlayer from '../player/MainPlayer';
import { UiKit } from '../ui/UiKit';
import MoneyHud from '../ui/MoneyHud';
import { WorldEnvironment } from './shared/WorldEnvironment';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { GameAudio } from '../audio/GameAudio';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { reloadToHome, resetProgressionData } from '../data/ProgressionStorage';
import { UiAnim, UiTween } from '../ui/UiAnim';
import { closeButton, cornerButton, popupPanel, titleRibbon } from '../ui/UiParts';

const CARD_COLUMNS = 4;
const CARD_WIDTH = 124;
const CARD_HEIGHT = 118;
const CARD_GAP = 14;
const PAGE_SIZE = 8;
/** Edit Squad layout rows (design space, panel centred on 0). */
const EDIT_MEMBERS_Y = -222;
const EDIT_TABS_Y = -128;
const EDIT_GRID_Y = -14;
const EDIT_DOTS_Y = 208;
const EDIT_DONE_Y = 245;
/** Edit Squad is wider than the home menu; it scales to the screen width, not DESIGN_WIDTH. */
const EDIT_WIDTH = 600;
/** Podium per squad member: x, z and top height. Blue (the main character) stands in the centre, a step higher and in front. */
const PODIUM = [
    { x: 0, z: 0.9, height: 0.7 },
    { x: -1.75, z: -0.3, height: 0.35 },
    { x: 1.75, z: -0.3, height: 0.35 },
];
const PODIUM_CAP_HEIGHT = 0.06;
const CAMERA_FOV = 30;
const CAMERA_DISTANCE = 15;
const SQUAD_FRAME_WIDTH = 7.2;
const CAMERA_HEIGHT = 3.2;
const LOOK_HEIGHT = 1.1;
const MENU_HEIGHT = 590;
const HOME_MENU_HEIGHT = 190;
const DESIGN_WIDTH = 420;
const GRID_COLUMNS = 4;
const TILE = 88;
const TILE_GAP = 14;
/** The level picker is its own, larger panel: 4 x 3 tiles fit a 10-level world. */
const LEVEL_PANEL_WIDTH = 470;
const LEVEL_PANEL_HEIGHT = 530;
const LEVEL_TITLE_Y = -LEVEL_PANEL_HEIGHT / 2 + 46;
const LEVEL_GRID_Y = 6;

/** Cash the settings ADD MONEY button grants per tap. */
const SETTINGS_MONEY = 1000;

/** Clash-style shop palette: deep royal blue panel, chunky dark outlines, saturated rarity cards. */
const SHOP = {
    outline: 0x0b1840,
    panel: 0x2a64e0,
    panelDark: 0x1a43a8,
    header: 0x4a8cff,
    well: 0x10307e,
    gold: 0xffd43b,
    equipped: 0x3fd04a,
    equippedLight: 0x7cf06a,
};
/** Card colours by price tier (common, rare, epic, legendary): [base, light top]. */
const RARITY: Array<{ max: number; base: number; light: number }> = [
    { max: 0, base: 0x2f9bff, light: 0x6cc4ff },
    { max: 199, base: 0x2f9bff, light: 0x6cc4ff },
    { max: 399, base: 0xff8a1f, light: 0xffbb4d },
    { max: 799, base: 0xa246ff, light: 0xcf8cff },
    { max: Infinity, base: 0xffb400, light: 0xffe45c },
];

const TILE_COLORS = { done: 0x3fd04a, open: 0x2f9bff, locked: 0x6d7d9e };

const textStyle = (size: number, stroke = 0x1d2b3a): Partial<PIXI.ITextStyle> => ({
    fontFamily: UiKit.fontFamily('primary'),
    fontSize: size,
    fill: 0xffffff,
    stroke,
    strokeThickness: Math.max(3, Math.round(size / 6)),
    align: 'center',
});

function label(text: string, size: number, stroke?: number): PIXI.Text {
    const result = new PIXI.Text(text, textStyle(size, stroke));
    result.anchor.set(0.5);
    return result;
}

export default class HomeScene extends ThreeScene {
    /** Fired after LevelCatalog.select(): index.ts switches to the level scene. */
    public readonly onPlayLevel: Signal = new Signal();

    private env!: WorldEnvironment;
    private readonly moneyHud: MoneyHud;
    private players: MainPlayer[] = [];
    private root?: PIXI.Container;
    private menu!: PIXI.Container;
    private editPanel!: PIXI.Container;
    private levelPicker!: PIXI.Container;
    private levelPanel!: PIXI.Container;
    private levelDim!: PIXI.Graphics;
    private worldTitle!: PIXI.Text;
    private worldProgress!: PIXI.Text;
    private dailyModal?: PIXI.Container;
    private settingsButton?: PIXI.Container;
    private settingsModal?: PIXI.Container;
    private podiumMaterials: THREE.MeshStandardMaterial[] = [];
    private worldLock!: PIXI.Sprite;
    private grid!: PIXI.Container;
    private editBody!: PIXI.Container;
    private editMember = 0;
    private editTab: 'faces' | 'hats' | 'colors' = 'faces';
    private editPage = 0;
    private toast!: PIXI.Text;
    private worldIndex = 0;
    private editing = false;
    private destroyed = false;
    private tweens: UiTween[] = [];
    private sceneryReady: Promise<void> = Promise.resolve();
    private readonly sceneryResources: Array<THREE.BufferGeometry | THREE.Material> = [];
    private readonly disposables: THREE.Texture[] = [];
    private sceneryGeneration = 0;

    public constructor(game: Game, moneyHud: MoneyHud) {
        super(game);
        this.moneyHud = moneyHud;
    }

    public get ready(): Promise<void> {
        return Promise.all([this.env.playerReady, this.sceneryReady]).then(() => undefined);
    }

    public build(): void {
        this.destroyed = false;
        this.editing = false;
        this.env = new WorldEnvironment(this.threeScene, BendService, 40, 16, 1, undefined, false);
        this.buildGarden();
        this.threeScene.add(new THREE.HemisphereLight(0xfff4df, 0x6c8874, 0.8));
        this.podiumMaterials = [];
        this.players = SQUAD_VIEW_NAMES.map((name, index) => {
            const spot = PODIUM[index];
            this.buildPodium(spot, new THREE.Color(CHARACTER_VIEWS[name].color));
            const player = this.env.spawnPlayer(this, new THREE.Vector3(spot.x, spot.height + PODIUM_CAP_HEIGHT, spot.z), undefined, CHARACTER_VIEWS[name]);
            player.movementController.enabled = false;
            (player.rigidBody as { useGravity: boolean }).useGravity = false;
            return player;
        });
        this.threeCamera.fov = CAMERA_FOV;
        this.threeCamera.updateProjectionMatrix();
        this.placeCamera();
        void this.env.playerReady.then(() => {
            if (!this.destroyed) {
                this.players.forEach((player) => player.character?.faceDirection(0, 1));
            }
        });

        const located = LevelCatalog.locate(LevelCatalog.all()[LevelCatalog.getIndex()]);
        this.worldIndex = located ? located.world.number - 1 : 0;
        this.buildUi();
        this.refreshWorld();
    }

    private buildGarden(): void {
        const generation = ++this.sceneryGeneration;
        const geometry = new THREE.PlaneGeometry(70, 70, 48, 48);
        const material = new THREE.MeshStandardMaterial({ color: 0x55b94c, roughness: 1 });
        BendService.applyBend(material);
        const ground = new THREE.Mesh(geometry, material);
        ground.name = 'home-garden-ground';
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.02;
        this.sceneryResources.push(geometry, material);
        this.threeScene.add(ground);

        // Heist loot backdrop: the big vault behind the squad, flanked by gold bars and cash piles.
        const props: Array<{ model: string; x: number; z: number; height: number; yaw: number }> = [
            { model: 'heist/vault/vault.gltf', x: 0, z: -17, height: 7.5, yaw: 0 },
            { model: 'resources/Gold_Bars_Stack_Large.gltf', x: -4.2, z: -11, height: 1.6, yaw: 0.4 },
            { model: 'resources/Money_Pile_Large.gltf', x: 4.3, z: -10.8, height: 1.8, yaw: -0.5 },
            { model: 'resources/Money_Pile_Medium.gltf', x: -3.1, z: 1.6, height: 0.9, yaw: 0.5 },
            { model: 'resources/Gold_Bars_Stack_Medium.gltf', x: 3.1, z: 1.7, height: 0.8, yaw: -0.4 },
            { model: 'resources/Money_Bills_Stack_Large.gltf', x: -2.4, z: 2.6, height: 0.5, yaw: 0 },
            { model: 'resources/Gold_Nuggets.gltf', x: 2.4, z: 2.7, height: 0.35, yaw: 1.2 },
        ];
        this.sceneryReady = Promise.all(props.map(async (spot, index) => {
            const prop = await ModelLoaderManager.instance.loadModel(`./${this.game.folderPath}/models/${spot.model}`);
            if (this.destroyed || generation !== this.sceneryGeneration) {
                return;
            }
            prop.rotation.y = spot.yaw;
            prop.updateMatrixWorld(true);
            const size = new THREE.Box3().setFromObject(prop).getSize(new THREE.Vector3());
            prop.scale.multiplyScalar(spot.height / Math.max(1e-4, size.y));
            prop.updateMatrixWorld(true);
            const bounds = new THREE.Box3().setFromObject(prop);
            prop.position.set(spot.x, -bounds.min.y, spot.z);
            prop.name = `home-loot-${index}`;
            prop.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    const cloneMaterial = (source: THREE.Material): THREE.Material => {
                        const clone = source.clone();
                        BendService.applyBend(clone);
                        this.sceneryResources.push(clone);
                        return clone;
                    };
                    child.material = Array.isArray(child.material)
                        ? child.material.map(cloneMaterial)
                        : cloneMaterial(child.material);
                }
            });
            this.threeScene.add(prop);
        })).then(() => undefined).catch((error) => {
            console.error('[HomeScene] Could not load the loot backdrop', error);
        });

        // Warm gold pool on the grass under the vault so the loot reads as the prize.
        const glowCanvas = document.createElement('canvas');
        glowCanvas.width = glowCanvas.height = 128;
        const context = glowCanvas.getContext('2d')!;
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,220,90,0.9)');
        gradient.addColorStop(1, 'rgba(255,200,40,0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, 128, 128);
        const glowTexture = new THREE.CanvasTexture(glowCanvas);
        const glowMaterial = new THREE.MeshBasicMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 });
        BendService.applyBend(glowMaterial);
        const glowGeometry = new THREE.PlaneGeometry(20, 10);
        const glow = new THREE.Mesh(glowGeometry, glowMaterial);
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(0, 0.01, -13);
        this.sceneryResources.push(glowGeometry, glowMaterial);
        this.disposables.push(glowTexture);
        this.threeScene.add(glow);
    }

    private buildPodium(spot: { x: number; z: number; height: number }, color: THREE.Color): void {
        const base = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.35), roughness: 0.5 });
        const top = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
        this.podiumMaterials.push(base);
        BendService.applyBend(base);
        BendService.applyBend(top);
        const column = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, spot.height, 40), base);
        column.position.set(spot.x, spot.height / 2, spot.z);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, PODIUM_CAP_HEIGHT, 40), top);
        cap.position.set(spot.x, spot.height + PODIUM_CAP_HEIGHT / 2, spot.z);
        cap.scale.set(1, 1, 1);
        this.threeScene.add(column, cap);
    }

    private placeCamera(): void {
        const aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const fitDistance = SQUAD_FRAME_WIDTH / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * aspect);
        this.threeCamera.position.set(0, CAMERA_HEIGHT, Math.max(CAMERA_DISTANCE, fitDistance));
        this.threeCamera.lookAt(0, LOOK_HEIGHT, 0);
    }

    private world(): WorldInfo {
        return LevelCatalog.worlds()[this.worldIndex];
    }

    private buildUi(): void {
        this.dailyModal = undefined;
        const root = new PIXI.Container();
        this.root = root;

        this.menu = this.buildMenu();
        this.editPanel = this.buildEditPanel();
        this.editPanel.visible = false;
        this.levelPicker = new PIXI.Container();
        this.levelPicker.name = 'level-picker';
        this.levelDim = new PIXI.Graphics();
        this.levelDim.eventMode = 'static';
        this.levelPanel = this.buildLevelPanel();
        this.levelPicker.addChild(this.levelDim, this.levelPanel);
        this.levelPicker.visible = false;
        this.settingsModal = undefined;
        this.settingsButton = this.buildSettingsButton();
        // Settings (reset progress, unlock all...) is a developer tool for now: only with ?dev=1.
        this.settingsButton.visible = Boolean(Game.debugParams.dev);
        root.addChild(this.menu, this.editPanel, this.levelPicker, this.settingsButton);
        this.game.uiLayer.addChild(root);
        this.resize();
        this.track(UiAnim.staggerRise(this.menu.children, 0.15, 0.1, 80));
        this.track(UiAnim.staggerPop([this.settingsButton], 0.3));
        this.offerDailyReward();
    }

    /** Remembers running animations so destroy() can kill them; finished ones are dropped. */
    private track(tweens: UiTween[]): void {
        this.tweens = this.tweens.filter((tween) => tween.totalProgress() < 1);
        this.tweens.push(...tweens);
    }

    /** Dim + springy panel; returns a close function that animates out and destroys the modal. */
    private presentModal(modal: PIXI.Container, dim: PIXI.Container, box: PIXI.Container, onClosed: () => void): () => void {
        modal.addChild(dim, box);
        this.root?.addChild(modal);
        this.layoutDaily();
        this.track(UiAnim.popIn(box, dim));
        let closing = false;
        return () => {
            if (closing || modal.destroyed) {
                return;
            }
            closing = true;
            this.track(UiAnim.popOut(box, dim, () => {
                modal.destroy({ children: true });
                onClosed();
            }));
        };
    }

    /** Debug hook: (re)opens the daily reward popup if one is claimable. */
    public showDailyReward(): void {
        if (this.dailyModal && !this.dailyModal.destroyed) {
            UiAnim.kill(this.dailyModal);
            this.dailyModal.destroy({ children: true });
            this.dailyModal = undefined;
        }
        this.offerDailyReward();
    }

    private offerDailyReward(): void {
        const reward = Progress.dailyReward();
        if (!reward.available || !this.root) {
            return;
        }
        GameAnalytics.dailyShown(reward.streak);
        const width = 340;
        const height = 300;
        const modal = new PIXI.Container();
        modal.name = 'daily-modal';
        const dim = new PIXI.Graphics();
        dim.beginFill(0x000000, 0.55).drawRect(-1200, -1200, 2400, 2400).endFill();
        dim.eventMode = 'static';
        const box = new PIXI.Container();
        const glow = UiAnim.rays(box, 280);
        const panel = popupPanel(width, height);

        const ribbon = titleRibbon('DAILY REWARD', 30);
        ribbon.position.set(0, -height / 2 - 4);

        const streakText = label(`DAY ${reward.streak} STREAK`, 18, 0x1d4a7a);
        streakText.position.set(0, -94);
        const days = this.buildStreakRow(reward.streak);
        days.position.set(0, -54);

        const amount = label('$0', 54, 0x5a3a00);
        amount.style.fill = [0xfff27a, 0xffc229];
        amount.position.set(0, 4);
        const next = label(
            reward.streak >= 7 ? 'MAX STREAK!' : `TOMORROW: $${Progress.dailyAmount(reward.streak + 1)}`,
            15,
            0x1d4a7a,
        );
        next.alpha = 0.9;
        next.position.set(0, 46);

        this.dailyModal = modal;
        const close = this.presentModal(modal, dim, box, () => {
            this.dailyModal = undefined;
        });
        const claim = this.makeButton('Button01_s_Green', 210, 66, 'CLAIM', 28, () => {
            if (Progress.claimDaily() > 0) {
                GameAnalytics.dailyClaimed(reward.streak);
                GameAudio.play('bonus');
                this.moneyHud.setResourceCount(GameState.getMoney());
                if (this.root) this.track(UiAnim.confetti(this.root, modal.x, modal.y, 50));
            }
            close();
        });
        claim.name = 'daily-claim';
        claim.position.set(0, 100);
        box.addChild(panel, streakText, days, amount, next, claim, ribbon);
        this.track(glow.tweens);
        this.track(UiAnim.dropIn(ribbon, 80, 0.15));
        this.track(UiAnim.staggerPop(days.children, 0.3, 0.05));
        this.track(UiAnim.countUp(amount, 0, reward.amount, (value) => `$${value}`, 0.8, 0.35));
        this.track(UiAnim.pulse(claim, 0.06));
    }

    /** Seven day tiles: past days claimed (green), today highlighted (gold), future greyed. */
    private buildStreakRow(streak: number): PIXI.Container {
        const row = new PIXI.Container();
        const size = 36;
        const gap = 6;
        const total = 7 * size + 6 * gap;
        for (let day = 1; day <= 7; day++) {
            const tile = new PIXI.Container();
            const isToday = day === streak;
            const fill = day < streak ? 0x36d43a : isToday ? 0xffc229 : 0x6f8aa6;
            const g = new PIXI.Graphics();
            g.beginFill(0x000000, 0.25).drawRoundedRect(-size / 2, -size / 2 + 3, size, size, 9).endFill();
            g.lineStyle(3, 0x123049).beginFill(fill).drawRoundedRect(-size / 2, -size / 2, size, size, 9).endFill();
            g.lineStyle(0).beginFill(0xffffff, 0.3).drawRoundedRect(-size / 2 + 5, -size / 2 + 4, size - 10, 7, 3).endFill();
            const text = label(String(day), isToday ? 20 : 17, 0x123049);
            tile.addChild(g, text);
            tile.alpha = day > streak ? 0.75 : 1;
            tile.position.set(-total / 2 + size / 2 + (day - 1) * (size + gap), 0);
            if (isToday) {
                tile.scale.set(1.15);
            }
            row.addChild(tile);
        }
        return row;
    }

    /** Cog button matching the sound toggle; sits just left of it in the top-right corner. */
    private buildSettingsButton(): PIXI.Container {
        const { button } = cornerButton('Icon_Setting', 42, () => this.openSettings());
        button.name = 'settings-button';
        return button;
    }

    private openSettings(): void {
        if (this.settingsModal && !this.settingsModal.destroyed) {
            return;
        }
        GameAudio.play('tap');
        const modal = new PIXI.Container();
        modal.name = 'settings-modal';
        const dim = new PIXI.Graphics();
        dim.beginFill(0x000000, 0.55).drawRect(-1200, -1200, 2400, 2400).endFill();
        dim.eventMode = 'static';
        const box = new PIXI.Container();
        this.settingsModal = modal;
        const close = this.presentModal(modal, dim, box, () => {
            this.settingsModal = undefined;
        });
        dim.on('pointertap', close);
        const panel = popupPanel(340, 360);
        const title = titleRibbon('SETTINGS', 30);
        title.position.set(0, -184);
        const status = label('', 15);
        status.position.set(0, 148);
        const notify = (text: string): void => {
            status.text = text;
            status.alpha = 1;
            this.track(UiAnim.punch(status, 0.3));
            this.track([gsap.fromTo(status, { alpha: 1 }, { alpha: 0, duration: 0.5, delay: 1.2 })]);
        };
        const unlock = this.makeButton('Button01_s_Green', 250, 62, LevelCatalog.isAllUnlocked() ? 'ALL UNLOCKED' : 'UNLOCK ALL LEVELS', 20, () => {
            LevelCatalog.unlockAll();
            this.refreshWorld();
            notify('EVERY LEVEL IS OPEN');
        });
        unlock.name = 'settings-unlock-all';
        unlock.position.set(0, -70);
        const money = this.makeButton('Button01_s_Yellow', 250, 62, `ADD $${SETTINGS_MONEY}`, 22, () => {
            GameState.addMoney(SETTINGS_MONEY);
            this.moneyHud.setResourceCount(GameState.getMoney());
            GameAudio.play('bonus');
            notify(`+$${SETTINGS_MONEY}`);
        });
        money.name = 'settings-add-money';
        money.position.set(0, 4);
        const clear = this.makeButton('Button01_s_Red', 250, 62, 'CLEAR DATA', 22, () => {
            if (!window.confirm('Clear all Bandit Controller progress, stars, cash, wardrobe, squad looks and daily rewards? This cannot be undone.')) {
                return;
            }
            resetProgressionData();
            reloadToHome();
        });
        clear.name = 'settings-clear-data';
        clear.position.set(0, 78);
        const closeBtn = closeButton(close);
        closeBtn.position.set(150, -150);
        box.addChild(panel, unlock, money, clear, status, title, closeBtn);
        this.track(UiAnim.staggerRise([unlock, money, clear], 0.12, 0.07));
    }

    private layoutDaily(): void {
        const screen = Game.overlayScreenData;
        const modalScale = Math.min(1.1, screen.width / DESIGN_WIDTH, screen.height / 720);
        if (this.dailyModal && !this.dailyModal.destroyed) {
            this.dailyModal.position.set(screen.center.x, screen.center.y);
            this.dailyModal.scale.set(modalScale);
        }
        if (this.settingsModal && !this.settingsModal.destroyed) {
            this.settingsModal.position.set(screen.center.x, screen.center.y);
            this.settingsModal.scale.set(modalScale);
        }
        // Left of the global sound toggle (SoundToggleButton.reposition).
        this.settingsButton?.position.set(screen.topRight.x - 44 - 76, screen.topLeft.y + 44);
    }

    private makeButton(frame: string, width: number, height: number, text: string, size: number, onTap: () => void): PIXI.Container {
        const button = new PIXI.Container();
        // Press feedback lives on an inner body so callers can freely scale/pulse the outer button.
        const body = new PIXI.Container();
        body.name = 'button-body';
        const plane = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), 30, 40, 30, 40);
        plane.width = width;
        plane.height = height;
        plane.position.set(-width / 2, -height / 2);
        body.addChild(plane, label(text, size));
        button.addChild(body);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerdown', () => {
            gsap.killTweensOf(body.scale);
            body.scale.set(0.92);
        });
        button.on('pointerupoutside', () => this.track([gsap.to(body.scale, { x: 1, y: 1, duration: 0.2, ease: 'back.out(2)' })]));
        button.on('pointertap', () => {
            gsap.killTweensOf(body.scale);
            body.scale.set(1);
            this.track(UiAnim.punch(body, 0.12));
            onTap();
        });
        return button;
    }

    /** Diagonal light streak that sweeps across a button every few seconds. */
    private addShine(button: PIXI.Container, width: number, height: number): void {
        const shine = new PIXI.Graphics();
        shine.beginFill(0xffffff, 0.45).drawPolygon([-14, -height, 14, -height, -6, height, -34, height]).endFill();
        shine.beginFill(0xffffff, 0.25).drawPolygon([22, -height, 32, -height, 12, height, 2, height]).endFill();
        const mask = new PIXI.Graphics();
        mask.beginFill(0xffffff).drawRoundedRect(-width / 2 + 6, -height / 2 + 4, width - 12, height - 14, height / 3).endFill();
        shine.mask = mask;
        shine.eventMode = 'none';
        const body = button.getChildByName('button-body') as PIXI.Container | null;
        (body ?? button).addChild(mask, shine);
        shine.x = -width;
        this.track([gsap.to(shine, { x: width, duration: 0.9, ease: 'power1.inOut', repeat: -1, repeatDelay: 2.2, delay: 1 })]);
    }

    private arrow(frame: string, x: number, onTap: () => void, y = -118): PIXI.Sprite {
        const arrow = PIXI.Sprite.from(frame);
        arrow.anchor.set(0.5);
        arrow.scale.set(0.8);
        arrow.position.set(x, y);
        arrow.eventMode = 'static';
        arrow.cursor = 'pointer';
        arrow.hitArea = new PIXI.Rectangle(-40, -50, 80, 100);
        arrow.on('pointertap', onTap);
        return arrow;
    }

    private buildMenu(): PIXI.Container {
        const menu = new PIXI.Container();
        menu.name = 'home-actions';
        const edit = this.makeButton('Button01_s_Blue', 180, 62, 'EDIT SQUAD', 20, () => this.setEditing(true));
        edit.name = 'edit-squad';
        edit.position.set(-96, -60);
        const choose = this.makeButton('Button01_s_Blue', 180, 62, 'CHOOSE LEVEL', 20, () => this.setChoosingLevel(true));
        choose.name = 'choose-level';
        choose.position.set(96, -60);
        const play = this.makeButton('Button01_s_Yellow', 354, 96, 'PLAY', 42, () => {
            GameAudio.play('tap');
            this.play(LevelCatalog.getIndex());
        });
        play.name = 'play';
        play.position.set(0, 35);
        this.addShine(play, 354, 96);
        this.track(UiAnim.pulse(play, 0.04, 0.8));
        menu.addChild(edit, choose, play);
        return menu;
    }

    private buildLevelPanel(): PIXI.Container {
        const menu = new PIXI.Container();
        const back = new PIXI.Graphics();
        const left = -LEVEL_PANEL_WIDTH / 2;
        const top = -LEVEL_PANEL_HEIGHT / 2;
        back.beginFill(0x000000, 0.3).drawRoundedRect(left, top + 10, LEVEL_PANEL_WIDTH, LEVEL_PANEL_HEIGHT, 30).endFill();
        back.beginFill(SHOP.panelDark).lineStyle(6, SHOP.outline).drawRoundedRect(left, top, LEVEL_PANEL_WIDTH, LEVEL_PANEL_HEIGHT, 30).endFill();
        back.lineStyle(0).beginFill(SHOP.panel).drawRoundedRect(left + 6, top + 6, LEVEL_PANEL_WIDTH - 12, LEVEL_PANEL_HEIGHT - 20, 25).endFill();
        back.beginFill(SHOP.header).drawRoundedRect(left + 12, top + 12, LEVEL_PANEL_WIDTH - 24, 90, 22).endFill();
        back.beginFill(0xffffff, 0.18).drawRoundedRect(left + 20, top + 16, LEVEL_PANEL_WIDTH - 40, 30, 15).endFill();
        back.beginFill(SHOP.well).drawRoundedRect(left + 14, top + 114, LEVEL_PANEL_WIDTH - 28, LEVEL_PANEL_HEIGHT - 210, 20).endFill();
        menu.addChild(back);

        this.worldTitle = label('', 30);
        this.worldTitle.position.set(0, LEVEL_TITLE_Y);
        this.worldProgress = label('', 18);
        this.worldProgress.position.set(0, LEVEL_TITLE_Y + 32);
        this.worldLock = PIXI.Sprite.from('Icon_Lock02');
        this.worldLock.anchor.set(0.5);
        this.worldLock.scale.set(0.3);
        menu.addChild(
            this.worldTitle,
            this.worldProgress,
            this.worldLock,
            this.arrow('arrow-left', -LEVEL_PANEL_WIDTH / 2 + 40, () => this.changeWorld(-1), LEVEL_TITLE_Y + 10),
            this.arrow('arrow-right', LEVEL_PANEL_WIDTH / 2 - 40, () => this.changeWorld(1), LEVEL_TITLE_Y + 10),
        );

        this.grid = new PIXI.Container();
        menu.addChild(this.grid);

        const backButton = this.makeButton('Button01_s_Blue', 200, 58, 'BACK', 25, () => this.setChoosingLevel(false));
        backButton.name = 'close-level-picker';
        backButton.position.set(0, LEVEL_PANEL_HEIGHT / 2 - 46);
        menu.addChild(backButton);
        return menu;
    }

    private buildEditPanel(): PIXI.Container {
        const panel = new PIXI.Container();
        panel.name = 'edit-panel';
        const back = new PIXI.Graphics();
        const top = -MENU_HEIGHT / 2;
        const left = -EDIT_WIDTH / 2;
        back.beginFill(0x000000, 0.3).drawRoundedRect(left, top + 10, EDIT_WIDTH, MENU_HEIGHT, 30).endFill();
        back.beginFill(SHOP.panelDark).lineStyle(6, SHOP.outline).drawRoundedRect(left, top, EDIT_WIDTH, MENU_HEIGHT, 30).endFill();
        back.lineStyle(0).beginFill(SHOP.panel).drawRoundedRect(left + 6, top + 6, EDIT_WIDTH - 12, MENU_HEIGHT - 20, 25).endFill();
        // Bright header band behind the member picker, with a glossy highlight.
        back.beginFill(SHOP.header).drawRoundedRect(left + 12, top + 12, EDIT_WIDTH - 24, 112, 22).endFill();
        back.beginFill(0xffffff, 0.18).drawRoundedRect(left + 20, top + 16, EDIT_WIDTH - 40, 30, 15).endFill();
        // Deep inset well behind the item grid.
        back.beginFill(SHOP.outline, 0.55).drawRoundedRect(left + 12, EDIT_GRID_Y - CARD_HEIGHT / 2 - 12, EDIT_WIDTH - 24, CARD_HEIGHT * 2 + CARD_GAP + 30, 20).endFill();
        back.beginFill(SHOP.well).drawRoundedRect(left + 14, EDIT_GRID_Y - CARD_HEIGHT / 2 - 10, EDIT_WIDTH - 28, CARD_HEIGHT * 2 + CARD_GAP + 24, 18).endFill();
        this.editBody = new PIXI.Container();
        this.toast = label('', 20, 0x7a1d1d);
        this.toast.position.set(0, EDIT_GRID_Y + CARD_HEIGHT / 2 + CARD_GAP / 2);
        this.toast.alpha = 0;
        panel.addChild(back, this.editBody, this.toast);
        return panel;
    }

    /** Rebuilds the edit panel; `animate` pops the item cards in (tab / page / member change). */
    private refreshEdit(animate = false): void {
        // Fast taps rebuild mid-animation: kill pops/sparks first or gsap writes to nulled transforms.
        this.editBody.removeChildren().forEach((child) => {
            UiAnim.kill(child as PIXI.Container);
            child.destroy({ children: true });
        });

        SQUAD_VIEW_NAMES.forEach((name, index) => {
            const view = CHARACTER_VIEWS[name];
            const selected = index === this.editMember;
            const member = new PIXI.Container();
            member.name = `edit-member-${index}`;
            const disc = new PIXI.Graphics();
            if (selected) {
                disc.beginFill(SHOP.gold, 0.45).drawCircle(0, 0, 42).endFill();
            }
            disc.beginFill(0x000000, 0.3).drawCircle(0, 5, 34).endFill();
            disc.beginFill(selected ? SHOP.gold : 0xffffff).lineStyle(4, SHOP.outline).drawCircle(0, 0, 35).endFill();
            disc.lineStyle(0).beginFill(new THREE.Color(view.color).getHex()).drawCircle(0, 0, 28).endFill();
            disc.beginFill(0xffffff, 0.3).drawEllipse(-8, -14, 14, 7).endFill();
            const face = PIXI.Sprite.from(resolveSkinImagePath(view.face));
            face.anchor.set(0.5);
            face.width = face.height = 46;
            member.addChild(disc, face);
            member.position.set((index - 1) * 150, EDIT_MEMBERS_Y);
            member.scale.set(selected ? 1.1 : 0.85);
            member.alpha = selected ? 1 : 0.8;
            member.eventMode = 'static';
            member.cursor = 'pointer';
            member.hitArea = new PIXI.Circle(0, 0, 40);
            member.on('pointertap', () => {
                if (this.editMember === index) {
                    return;
                }
                GameAudio.play('tap');
                this.editMember = index;
                this.editPage = 0;
                this.refreshEdit(true);
                this.hopMember(index);
            });
            this.editBody.addChild(member);
            if (selected && animate) {
                this.track(UiAnim.punch(member, 0.2));
            }
        });

        this.buildTabBar();

        const cards: PIXI.Container[] = [];
        let pages = 1;
        if (this.editTab === 'colors') {
            cards.push(...this.buildColorGrid());
        } else {
            const items: (WardrobeItem | undefined)[] = this.editTab === 'faces' ? FACES : [undefined, ...HATS];
            pages = Math.ceil(items.length / PAGE_SIZE);
            this.editPage = Math.min(this.editPage, pages - 1);
            items.slice(this.editPage * PAGE_SIZE, (this.editPage + 1) * PAGE_SIZE).forEach((item, index) => {
                const column = index % CARD_COLUMNS;
                const row = Math.floor(index / CARD_COLUMNS);
                const card = this.buildCard(item);
                card.position.set((column - (CARD_COLUMNS - 1) / 2) * (CARD_WIDTH + CARD_GAP), EDIT_GRID_Y + row * (CARD_HEIGHT + CARD_GAP));
                this.editBody.addChild(card);
                cards.push(card);
            });
        }
        if (animate) {
            this.track(UiAnim.staggerPop(cards, 0, 0.03));
        }

        if (pages > 1) {
            const prev = this.arrow('arrow-left', -200, () => this.turnPage(-1, pages), EDIT_DONE_Y);
            const next = this.arrow('arrow-right', 200, () => this.turnPage(1, pages), EDIT_DONE_Y);
            prev.scale.set(0.75);
            next.scale.set(0.75);
            this.editBody.addChild(prev, next);
            for (let i = 0; i < pages; i++) {
                const dot = new PIXI.Graphics();
                const current = i === this.editPage;
                dot.beginFill(current ? 0xffe14d : 0xffffff, current ? 1 : 0.35).drawCircle(0, 0, current ? 7 : 5).endFill();
                dot.position.set((i - (pages - 1) / 2) * 22, EDIT_DOTS_Y);
                dot.eventMode = 'static';
                dot.cursor = 'pointer';
                dot.hitArea = new PIXI.Circle(0, 0, 11);
                dot.on('pointertap', () => this.turnPage(i - this.editPage, pages));
                this.editBody.addChild(dot);
            }
        }

        const done = this.makeButton('Button01_s_Green', 220, 60, 'DONE', 30, () => this.setEditing(false));
        done.name = 'edit-done';
        done.position.set(0, EDIT_DONE_Y);
        this.editBody.addChild(done);
    }

    /** Segmented FACES / HATS / COLORS control; the active tab is raised and green. */
    private buildTabBar(): void {
        const tabs: ['faces' | 'hats' | 'colors', string][] = [['faces', 'FACES'], ['hats', 'HATS'], ['colors', 'COLORS']];
        const width = 172;
        const bar = new PIXI.Graphics();
        bar.beginFill(SHOP.outline).drawRoundedRect(-(width * 3 + 20) / 2, EDIT_TABS_Y - 30, width * 3 + 20, 60, 30).endFill();
        this.editBody.addChild(bar);
        tabs.forEach(([tab, text], index) => {
            const active = this.editTab === tab;
            const button = this.makeButton(active ? 'Button01_s_Yellow' : 'Button01_s_Blue', width - 6, active ? 54 : 48, text, active ? 23 : 20, () => {
                if (this.editTab === tab) {
                    return;
                }
                GameAudio.play('tap');
                this.editTab = tab;
                this.editPage = 0;
                this.refreshEdit(true);
            });
            button.name = `edit-tab-${tab}`;
            button.position.set((index - 1) * width, EDIT_TABS_Y);
            this.editBody.addChild(button);
        });
    }

    /** Squash-and-stretch the 3D squad member that was just edited. */
    private hopMember(index: number): void {
        const container = this.players[index]?.character?.container;
        if (!container) {
            return;
        }
        gsap.killTweensOf(container.scale);
        const base = container.userData.homeScale ?? container.scale.x;
        container.userData.homeScale = base;
        container.scale.setScalar(base);
        this.track([gsap.timeline()
            .to(container.scale, { x: base * 1.18, y: base * 0.8, z: base * 1.18, duration: 0.09, ease: 'power2.out' })
            .to(container.scale, { x: base * 0.92, y: base * 1.14, z: base * 0.92, duration: 0.12, ease: 'power2.out' })
            .to(container.scale, { x: base, y: base, z: base, duration: 0.45, ease: 'elastic.out(1.2, 0.35)' })]);
    }

    private buildColorGrid(): PIXI.Container[] {
        const name = SQUAD_VIEW_NAMES[this.editMember];
        const swatches: PIXI.Container[] = [];
        SQUAD_COLORS.forEach((hex, index) => {
            const taken = isSquadColorTaken(name, hex);
            const selected = CHARACTER_VIEWS[name].color === hex;
            const swatch = new PIXI.Container();
            const disc = new PIXI.Graphics();
            if (selected) {
                disc.beginFill(SHOP.gold, 0.5).drawCircle(0, 0, 41).endFill();
            }
            disc.beginFill(0x000000, 0.35).drawCircle(0, 5, 33).endFill();
            disc.beginFill(selected ? SHOP.gold : SHOP.outline).drawCircle(0, 0, 33).endFill();
            disc.beginFill(new THREE.Color(hex).getHex()).drawCircle(0, 0, 28).endFill();
            disc.beginFill(0xffffff, 0.35).drawEllipse(-9, -12, 11, 6).endFill();
            swatch.addChild(disc);
            if (selected) {
                const check = PIXI.Sprite.from('Icon_Check02');
                check.anchor.set(0.5);
                check.scale.set(0.42);
                check.position.set(22, -22);
                swatch.addChild(check);
            }
            if (taken) {
                disc.alpha = 0.3;
                const lock = PIXI.Sprite.from('Icon_Close02');
                lock.anchor.set(0.5);
                lock.scale.set(0.42);
                swatch.addChild(lock);
            }
            swatch.position.set(((index % 5) - 2) * 104, EDIT_GRID_Y + Math.floor(index / 5) * (CARD_HEIGHT + CARD_GAP));
            swatch.eventMode = 'static';
            swatch.cursor = taken ? 'default' : 'pointer';
            swatch.hitArea = new PIXI.Circle(0, 0, 36);
            swatch.on('pointertap', () => {
                if (taken) {
                    GameAudio.play('blocked');
                    this.showToast('COLOR IN USE');
                    this.track(UiAnim.shake(swatch, 8, 0.35));
                    return;
                }
                if (setSquadColor(name, hex)) {
                    GameAudio.play('equip');
                    GameAnalytics.colorPicked(hex);
                    this.players[this.editMember]?.character?.setColor(hex);
                    this.podiumMaterials[this.editMember]?.color.set(new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.35));
                    const { x, y } = swatch.position;
                    this.refreshEdit();
                    this.celebrateEquip(x, y, new THREE.Color(hex).getHex());
                }
            });
            this.editBody.addChild(swatch);
            swatches.push(swatch);
        });
        return swatches;
    }

    /** Spark burst on the grid slot plus a hop from the edited squad member. */
    private celebrateEquip(x: number, y: number, color = 0xffe066): void {
        this.track(UiAnim.sparkBurst(this.editBody, x, y, color, 70));
        this.hopMember(this.editMember);
    }

    private turnPage(step: number, pages: number): void {
        if (step === 0) {
            return;
        }
        GameAudio.play('tap');
        this.editPage = (this.editPage + step + pages) % pages;
        this.refreshEdit(true);
    }

    private equippedId(): string | undefined {
        const view = CHARACTER_VIEWS[SQUAD_VIEW_NAMES[this.editMember]];
        return this.editTab === 'faces' ? view.face : view.hat;
    }

    /** One face or hat card; `undefined` is the "no hat" card. */
    private buildCard(item?: WardrobeItem): PIXI.Container {
        const card = new PIXI.Container();
        card.name = `edit-card-${item?.id ?? 'none'}`;
        const owned = !item || (this.editTab === 'faces' ? Wardrobe.ownsFace(item.id) : Wardrobe.ownsHat(item.id));
        const equipped = (item?.id) === this.equippedId();
        const affordable = owned || GameState.getMoney() >= (item?.price ?? 0);
        const left = -CARD_WIDTH / 2;
        const top = -CARD_HEIGHT / 2;
        const rarity = RARITY.find((tier) => (item?.price ?? 0) <= tier.max) ?? RARITY[0];
        const base = equipped ? SHOP.equipped : rarity.base;
        const light = equipped ? SHOP.equippedLight : rarity.light;
        const back = new PIXI.Graphics();
        if (equipped) {
            back.beginFill(SHOP.gold, 0.5).drawRoundedRect(left - 6, top - 6, CARD_WIDTH + 12, CARD_HEIGHT + 12, 20).endFill();
        }
        back.beginFill(0x000000, 0.35).drawRoundedRect(left, top + 6, CARD_WIDTH, CARD_HEIGHT, 16).endFill();
        back.beginFill(equipped ? SHOP.gold : SHOP.outline).drawRoundedRect(left, top, CARD_WIDTH, CARD_HEIGHT, 16).endFill();
        // Two-tone fill reads as a vertical gradient, plus a glossy streak.
        back.beginFill(base).drawRoundedRect(left + 4, top + 4, CARD_WIDTH - 8, CARD_HEIGHT - 8, 12).endFill();
        back.beginFill(light).drawRoundedRect(left + 4, top + 4, CARD_WIDTH - 8, (CARD_HEIGHT - 8) * 0.55, 12).endFill();
        back.beginFill(0xffffff, 0.3).drawRoundedRect(left + 10, top + 8, CARD_WIDTH - 20, 10, 5).endFill();
        // Dark footer strip for the caption / price.
        back.beginFill(SHOP.outline, 0.55).drawRoundedRect(left + 4, top + CARD_HEIGHT - 32, CARD_WIDTH - 8, 28, 10).endFill();
        card.addChild(back);

        const icon = new PIXI.Sprite();
        icon.anchor.set(0.5);
        icon.position.set(0, -12);
        if (!item) {
            icon.texture = PIXI.Texture.from('Icon_Close02');
            icon.scale.set(0.6);
        } else if (this.editTab === 'faces') {
            icon.texture = PIXI.Texture.from(resolveSkinImagePath(item.id));
            icon.width = icon.height = 74;
        } else {
            void HatIcons.get(item.id).then((texture) => {
                if (texture && !icon.destroyed) {
                    icon.texture = texture;
                    icon.width = icon.height = 80;
                }
            });
        }
        card.addChild(icon);

        if (owned) {
            const text = label(!item ? 'NONE' : item.name.toUpperCase(), 17, SHOP.outline);
            text.scale.set(Math.min(1, (CARD_WIDTH - 10) / Math.max(1, text.width)));
            text.position.set(0, CARD_HEIGHT / 2 - 16);
            card.addChild(text);
        } else {
            const pill = new PIXI.Graphics();
            pill.beginFill(SHOP.outline).drawRoundedRect(-CARD_WIDTH / 2 + 6, CARD_HEIGHT / 2 - 30, CARD_WIDTH - 12, 26, 13).endFill();
            pill.beginFill(affordable ? 0x3fd04a : 0x8a94a6).drawRoundedRect(-CARD_WIDTH / 2 + 8, CARD_HEIGHT / 2 - 28, CARD_WIDTH - 16, 22, 11).endFill();
            pill.beginFill(0xffffff, 0.3).drawRoundedRect(-CARD_WIDTH / 2 + 12, CARD_HEIGHT / 2 - 26, CARD_WIDTH - 24, 7, 4).endFill();
            const price = label(`${item!.price}`, 19, SHOP.outline);
            price.position.set(8, CARD_HEIGHT / 2 - 17);
            const coin = new PIXI.Graphics();
            coin.beginFill(SHOP.gold).lineStyle(2, SHOP.outline).drawCircle(0, 0, 8).endFill();
            coin.position.set(price.x - price.width / 2 - 9, price.y);
            card.addChild(pill, coin, price);
            const lock = PIXI.Sprite.from('Icon_Lock02');
            lock.anchor.set(0.5);
            lock.scale.set(0.22);
            lock.position.set(CARD_WIDTH / 2 - 14, -CARD_HEIGHT / 2 + 14);
            card.addChild(lock);
        }
        if (equipped) {
            const check = PIXI.Sprite.from('Icon_Check02');
            check.anchor.set(0.5);
            check.scale.set(0.42);
            check.position.set(CARD_WIDTH / 2 - 8, -CARD_HEIGHT / 2 + 8);
            card.addChild(check);
        }

        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.on('pointerdown', () => {
            gsap.killTweensOf(card.scale);
            card.scale.set(0.93);
        });
        card.on('pointerupoutside', () => card.scale.set(1));
        card.on('pointertap', () => {
            card.scale.set(1);
            this.onCard(item, card);
        });
        return card;
    }

    private onCard(item: WardrobeItem | undefined, card: PIXI.Container): void {
        const kind = this.editTab === 'faces' ? 'face' : 'hat';
        if ((item?.id) === this.equippedId()) {
            this.track(UiAnim.punch(card, 0.12));
            return;
        }
        const wasOwned = !item || (kind === 'face' ? Wardrobe.ownsFace(item.id) : Wardrobe.ownsHat(item.id));
        if (item && !Wardrobe.buy(kind, item)) {
            GameAudio.play('blocked');
            this.showToast('NOT ENOUGH CASH');
            this.track(UiAnim.shake(card, 8, 0.35));
            return;
        }
        GameAudio.play(wasOwned ? 'equip' : 'bonus');
        if (item && !wasOwned) {
            GameAnalytics.itemBought(kind, item.id);
        } else {
            GameAnalytics.itemEquipped(kind, item?.id);
        }
        this.moneyHud.setResourceCount(GameState.getMoney());
        const name = SQUAD_VIEW_NAMES[this.editMember];
        const player = this.players[this.editMember];
        if (kind === 'face') {
            setSquadFace(name, item!.id);
            void TextureBuilder.load(resolveSkinImagePath(item!.id)).then((texture) => {
                if (!this.destroyed) {
                    player?.character?.setFaceTexture(texture);
                }
            });
        } else {
            setSquadHat(name, item?.id);
            player?.character?.setHat(item ? `bandit-controller/models/hats/${item.id}.glb` : undefined);
        }
        const { x, y } = card.position;
        this.refreshEdit();
        const fresh = this.editBody.getChildByName(card.name ?? '') as PIXI.Container | null;
        if (fresh) {
            this.track(UiAnim.punch(fresh, 0.2));
        }
        this.celebrateEquip(x, y, wasOwned ? 0xffe066 : 0x7dff8a);
        if (!wasOwned) {
            this.showToast('UNLOCKED!');
        }
    }

    private showToast(text: string): void {
        gsap.killTweensOf(this.toast);
        gsap.killTweensOf(this.toast.scale);
        this.toast.text = text;
        this.toast.alpha = 1;
        this.track(UiAnim.punch(this.toast, 0.25));
        this.track([gsap.to(this.toast, { alpha: 0, duration: 0.5, delay: 0.9 })]);
    }

    private setEditing(editing: boolean): void {
        if (this.editing === editing) {
            return;
        }
        GameAudio.play('tap');
        this.editing = editing;
        if (editing) {
            this.hideMenu();
            this.editPanel.visible = true;
            this.editPanel.eventMode = 'auto';
            this.refreshEdit(true);
            this.resize(true);
            this.slidePanel(this.editPanel, true);
        } else {
            this.editPanel.eventMode = 'none';
            this.slidePanel(this.editPanel, false, () => {
                this.editPanel.visible = false;
            });
            this.resize(true);
            this.showMenu();
        }
    }

    private setChoosingLevel(choosing: boolean): void {
        GameAudio.play('tap');
        gsap.killTweensOf(this.levelPanel);
        gsap.killTweensOf(this.levelPanel.scale);
        gsap.killTweensOf(this.levelDim);
        if (choosing) {
            this.hideMenu();
            this.levelPicker.visible = true;
            this.levelPanel.eventMode = 'auto';
            this.levelDim.eventMode = 'static';
            this.levelPanel.alpha = 1;
            this.refreshWorld(true);
            this.resize();
            this.track(UiAnim.popIn(this.levelPanel, this.levelDim));
        } else {
            this.track(UiAnim.popOut(this.levelPanel, this.levelDim, () => {
                this.levelPicker.visible = false;
                this.levelPanel.alpha = 1;
                this.levelDim.alpha = 1;
                this.resize();
            }));
            this.showMenu();
        }
    }

    /** Home buttons sink and fade out; input is off until they come back. */
    private hideMenu(): void {
        gsap.killTweensOf(this.menu);
        gsap.killTweensOf(this.menu.pivot);
        this.menu.eventMode = 'none';
        this.track([
            gsap.to(this.menu, { alpha: 0, duration: 0.18, onComplete: () => {
                this.menu.visible = false;
            } }),
            gsap.to(this.menu.pivot, { y: -60, duration: 0.2, ease: 'power2.in' }),
        ]);
    }

    private showMenu(): void {
        gsap.killTweensOf(this.menu);
        gsap.killTweensOf(this.menu.pivot);
        this.menu.visible = true;
        this.menu.alpha = 1;
        this.menu.pivot.y = 0;
        this.menu.eventMode = 'auto';
        this.track(UiAnim.staggerRise(this.menu.children, 0.12, 0.08, 70));
    }

    /** Slides a bottom-anchored panel up from (or down below) the screen edge. */
    private slidePanel(panel: PIXI.Container, show: boolean, onDone?: () => void): void {
        gsap.killTweensOf(panel.pivot);
        gsap.killTweensOf(panel);
        const offscreen = -(MENU_HEIGHT + 80);
        if (show) {
            panel.alpha = 1;
            this.track([gsap.fromTo(panel.pivot, { y: offscreen }, { y: 0, duration: 0.5, ease: 'back.out(1.2)' })]);
        } else {
            this.track([gsap.to(panel.pivot, { y: offscreen, duration: 0.3, ease: 'power2.in', onComplete: () => {
                panel.pivot.y = 0;
                onDone?.();
            } })]);
        }
    }

    private changeWorld(step: number): void {
        GameAudio.play('tap');
        const count = LevelCatalog.worlds().length;
        this.worldIndex = (this.worldIndex + step + count) % count;
        this.refreshWorld(true, step);
    }

    private globalIndex(level: ReturnType<typeof LevelCatalog.all>[number]): number {
        return LevelCatalog.all().indexOf(level);
    }

    /** `animate` pops the tiles in; `direction` (±1) also slides them in from that side. */
    private refreshWorld(animate = false, direction = 0): void {
        const world = this.world();
        const progress = LevelCatalog.worldProgress(world);
        const unlocked = LevelCatalog.isUnlocked(this.globalIndex(world.levels[0]));
        this.worldTitle.text = world.tutorial ? 'TUTORIAL' : `${world.label}. ${world.name.toUpperCase()}`;
        this.worldTitle.scale.set(1);
        this.worldTitle.scale.set(Math.min(1, (LEVEL_PANEL_WIDTH - 150) / this.worldTitle.width));
        const stars = Progress.worldStars(world.levels);
        const gate = worldGateStars(world.number);
        this.worldProgress.text = unlocked
            ? `${progress.done}/${progress.total} DONE   ★ ${stars.earned}/${stars.max}`
            : `NEED ★ ${gate} (YOU HAVE ${Progress.totalStars()})`;
        this.worldLock.visible = !unlocked;
        this.worldLock.position.set(this.worldTitle.width / 2 + 24, LEVEL_TITLE_Y);

        this.grid.removeChildren().forEach((child) => {
            UiAnim.kill(child as PIXI.Container);
            child.destroy({ children: true });
        });
        // The 5-level tutorial reads better as 3 + 2 than 4 + 1.
        const columns = world.levels.length <= 6 ? 3 : GRID_COLUMNS;
        const rows = Math.ceil(world.levels.length / columns);
        world.levels.forEach((level, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            // A short last row is centred instead of hugging the left edge.
            const inRow = Math.min(columns, world.levels.length - row * columns);
            const x = (column - (inRow - 1) / 2) * (TILE + TILE_GAP);
            const y = LEVEL_GRID_Y + (row - (rows - 1) / 2) * (TILE + TILE_GAP);
            const tile = this.buildTile(level, index + 1);
            tile.position.set(x, y);
            this.grid.addChild(tile);
        });
        if (animate) {
            gsap.killTweensOf(this.grid);
            this.grid.x = 0;
            this.grid.alpha = 1;
            if (direction !== 0) {
                this.track([gsap.fromTo(this.grid, { x: direction * 120, alpha: 0 }, { x: 0, alpha: 1, duration: 0.35, ease: 'power3.out' })]);
                this.track(UiAnim.punch(this.worldTitle, 0.15));
            }
            this.track(UiAnim.staggerPop(this.grid.children, direction ? 0.05 : 0.15, 0.035));
        }
    }

    private buildTile(level: ReturnType<typeof LevelCatalog.all>[number], number: number): PIXI.Container {
        const index = this.globalIndex(level);
        const done = LevelCatalog.isCompleted(level);
        const open = LevelCatalog.isUnlocked(index);
        const color = done ? TILE_COLORS.done : open ? TILE_COLORS.open : TILE_COLORS.locked;
        const tile = new PIXI.Container();
        const back = new PIXI.Graphics();
        back.beginFill(0x000000, 0.35).drawRoundedRect(-TILE / 2, -TILE / 2 + 7, TILE, TILE, 20).endFill();
        back.beginFill(SHOP.outline).drawRoundedRect(-TILE / 2, -TILE / 2, TILE, TILE, 20).endFill();
        back.beginFill(color).drawRoundedRect(-TILE / 2 + 5, -TILE / 2 + 5, TILE - 10, TILE - 10, 16).endFill();
        back.beginFill(0xffffff, 0.22).drawRoundedRect(-TILE / 2 + 5, -TILE / 2 + 5, TILE - 10, (TILE - 10) * 0.5, 16).endFill();
        tile.addChild(back);
        if (open) {
            const numberLabel = label(String(number), done ? 34 : 42);
            numberLabel.position.y = done ? -10 : 0;
            tile.addChild(numberLabel);
            const earned = Progress.starsFor(level);
            for (let i = 0; done && i < 3; i++) {
                const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
                star.anchor.set(0.5);
                star.scale.set(24 / Math.max(star.texture.width, 1));
                star.position.set((i - 1) * 24, TILE / 2 - 20 + (i === 1 ? -3 : 0));
                if (i >= earned) {
                    star.tint = 0x202020;
                    star.alpha = 0.5;
                }
                tile.addChild(star);
            }
        } else {
            const lock = PIXI.Sprite.from('Icon_Lock02');
            lock.anchor.set(0.5);
            lock.scale.set(0.6);
            tile.addChild(lock);
        }
        if (done) {
            const check = PIXI.Sprite.from('Icon_Check02');
            check.anchor.set(0.5);
            check.scale.set(0.5);
            check.position.set(TILE / 2 - 6, -TILE / 2 + 6);
            tile.addChild(check);
        }
        tile.eventMode = 'static';
        tile.cursor = open ? 'pointer' : 'default';
        tile.on('pointertap', () => {
            if (open) {
                GameAudio.play('tap');
                this.track(UiAnim.punch(tile, 0.15));
                this.play(index);
            } else {
                GameAudio.play('blocked');
                this.track(UiAnim.shake(tile, 8, 0.35));
            }
        });
        return tile;
    }

    private play(index: number): void {
        LevelCatalog.select(index);
        this.onPlayLevel.dispatch();
    }

    public resize(animateCamera = false): void {
        this.layoutDaily();
        const screen = Game.overlayScreenData;
        if (!this.root || !screen) {
            return;
        }
        const scale = Math.min(1.1, screen.width / DESIGN_WIDTH, screen.height / 720);

        const menuCenter = screen.bottomLeft.y - (HOME_MENU_HEIGHT / 2 + 24) * scale;
        this.menu.scale.set(scale);
        this.menu.position.set(screen.center.x, menuCenter);
        const editScale = Math.min(1.2, screen.width / (EDIT_WIDTH + 30), (screen.height * 0.48) / MENU_HEIGHT);
        const editCenter = screen.bottomLeft.y - (MENU_HEIGHT / 2 + 20) * editScale;
        this.editPanel.scale.set(editScale);
        this.editPanel.position.set(screen.center.x, editCenter);
        const menuTop = this.editing ? editCenter - (MENU_HEIGHT / 2) * editScale : menuCenter - (HOME_MENU_HEIGHT / 2) * scale;

        this.levelPicker.position.set(screen.center.x, screen.center.y);
        if (!gsap.isTweening(this.levelPanel.scale)) {
            this.levelPanel.scale.set(Math.min(1.15, screen.width / (LEVEL_PANEL_WIDTH + 24), screen.height / (LEVEL_PANEL_HEIGHT + 40)));
        }
        this.levelDim.clear().beginFill(0x122c3d, 0.65)
            .drawRect(-screen.width / 2, -screen.height / 2, screen.width, screen.height).endFill();

        // Keep the squad between the persistent corner controls and the bottom panel.
        const bottomEdge = menuTop;
        const free = (screen.topLeft.y + 120 * scale + bottomEdge) / 2 + 125 * scale;
        const fraction = (free - screen.topLeft.y) / Math.max(1, screen.height);
        const target = 0.5 - fraction;
        gsap.killTweensOf(this.cameraShift);
        if (animateCamera) {
            this.track([gsap.to(this.cameraShift, { value: target, duration: 0.5, ease: 'power2.inOut', onUpdate: () => this.applyCameraShift() })]);
        } else {
            this.cameraShift.value = target;
            this.applyCameraShift();
        }
    }

    /** Vertical view offset (fraction of the screen height) that frames the squad above the panel. */
    private readonly cameraShift = { value: 0 };

    private applyCameraShift(): void {
        if (this.destroyed) {
            return;
        }
        const height = Math.max(1, window.innerHeight);
        this.threeCamera.setViewOffset(window.innerWidth, height, 0, this.cameraShift.value * height, window.innerWidth, height);
    }

    public update(delta: number): void {
        this.env.update(delta);
        super.update(delta);
    }

    public fixedUpdate(delta: number): void {
        this.players.forEach((player, index) => {
            player.transform.position.y = PODIUM[index].height + PODIUM_CAP_HEIGHT;
            player.rigidBody.velocity.y = 0;
        });
        this.env.fixedUpdate(delta);
        this.players.forEach((player, index) => {
            player.transform.position.y = PODIUM[index].height + PODIUM_CAP_HEIGHT;
            player.rigidBody.grounded = true;
        });
        this.placeCamera();
        BendService.updateOrigin(this.threeCamera.position.clone().setY(0).setZ(0));
    }

    public destroy(): void {
        this.destroyed = true;
        this.tweens.forEach((tween) => tween.kill());
        this.tweens = [];
        this.root?.removeFromParent();
        this.root?.destroy({ children: true });
        this.root = undefined;
        this.threeCamera.clearViewOffset();
        this.env?.destroy();
        this.sceneryResources.forEach((resource) => resource.dispose());
        this.sceneryResources.length = 0;
        this.disposables.forEach((texture) => texture.dispose());
        this.disposables.length = 0;
        super.destroy();
    }
}
