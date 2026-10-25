// HomeScene.ts
//
// The friendly front screen: the squad idling in 3D, EDIT SQUAD, and CHOOSE LEVEL,
// which opens a separate world picker with completion checks and locked levels.
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

const CARD_COLUMNS = 5;
const CARD_WIDTH = 70;
const CARD_HEIGHT = 76;
const CARD_GAP = 9;
const PAGE_SIZE = 10;
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
const MENU_HEIGHT = 330;
const HOME_MENU_HEIGHT = 190;
const DESIGN_WIDTH = 420;
const GRID_COLUMNS = 4;
const TILE = 72;
const TILE_GAP = 12;

const TILE_COLORS = { done: 0x55a989, open: 0x4d96c5, locked: 0x8798a8 };

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
    private tweens: gsap.core.Tween[] = [];
    private sceneryReady: Promise<void> = Promise.resolve();
    private readonly sceneryResources: Array<THREE.BufferGeometry | THREE.Material> = [];
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

        const trees = [
            { x: -5.2, z: -4.5, height: 4.2 },
            { x: -3.4, z: -7, height: 4.8 },
            { x: 0.4, z: -8, height: 4.4 },
            { x: 3.6, z: -6.5, height: 4.7 },
            { x: 5.4, z: -3.8, height: 4 },
        ];
        this.sceneryReady = Promise.all(trees.map(async (spot, index) => {
            const kind = index % 2 ? 'tree-small' : 'tree-large';
            const tree = await ModelLoaderManager.instance.loadModel(`./${this.game.folderPath}/models/heist/trees/${kind}.glb`);
            if (this.destroyed || generation !== this.sceneryGeneration) {
                return;
            }
            const bounds = new THREE.Box3().setFromObject(tree);
            const scale = spot.height / (bounds.max.y - bounds.min.y);
            tree.scale.setScalar(scale);
            tree.position.set(spot.x, -bounds.min.y * scale, spot.z);
            tree.rotation.y = index * 1.3;
            tree.name = `home-tree-${index}`;
            tree.traverse((child) => {
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
            this.threeScene.add(tree);
        })).then(() => undefined).catch((error) => {
            console.error('[HomeScene] Could not load garden trees', error);
        });
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
        root.addChild(this.menu, this.editPanel, this.levelPicker);
        this.game.uiLayer.addChild(root);
        this.resize();
        this.offerDailyReward();
    }

    private offerDailyReward(): void {
        const reward = Progress.dailyReward();
        if (!reward.available) {
            return;
        }
        const modal = new PIXI.Container();
        const dim = new PIXI.Graphics();
        dim.beginFill(0x000000, 0.55).drawRect(-1200, -1200, 2400, 2400).endFill();
        dim.eventMode = 'static';
        const panel = new PIXI.NineSlicePlane(PIXI.Texture.from('ItemFrame01_Single_Blue'), 30, 30, 30, 30);
        panel.width = 300;
        panel.height = 220;
        panel.position.set(-150, -110);
        const title = label('DAILY REWARD', 24, 0x1d5a2a);
        title.position.set(0, -70);
        const streak = label(`DAY ${reward.streak} STREAK`, 16);
        streak.position.set(0, -35);
        const amount = label(`$${reward.amount}`, 40);
        amount.position.set(0, 5);
        const claim = this.makeButton('Button01_s_Blue', 190, 64, 'CLAIM', 22, () => {
            Progress.claimDaily();
            GameAudio.play('bonus');
            this.moneyHud.setResourceCount(GameState.getMoney());
            modal.destroy({ children: true });
            this.dailyModal = undefined;
        });
        claim.position.set(0, 70);
        modal.addChild(dim, panel, title, streak, amount, claim);
        this.root?.addChild(modal);
        this.dailyModal = modal;
        this.layoutDaily();
    }

    private layoutDaily(): void {
        const screen = Game.overlayScreenData;
        if (this.dailyModal && !this.dailyModal.destroyed) this.dailyModal.position.set(screen.center.x, screen.center.y);
    }

    private makeButton(frame: string, width: number, height: number, text: string, size: number, onTap: () => void): PIXI.Container {
        const button = new PIXI.Container();
        const plane = new PIXI.NineSlicePlane(PIXI.Texture.from(frame), 30, 40, 30, 40);
        plane.width = width;
        plane.height = height;
        plane.position.set(-width / 2, -height / 2);
        button.addChild(plane, label(text, size));
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerdown', () => button.scale.set(0.94));
        button.on('pointerupoutside', () => button.scale.set(1));
        button.on('pointertap', () => {
            button.scale.set(1);
            onTap();
        });
        return button;
    }

    private arrow(frame: string, x: number, onTap: () => void): PIXI.Sprite {
        const arrow = PIXI.Sprite.from(frame);
        arrow.anchor.set(0.5);
        arrow.scale.set(0.8);
        arrow.position.set(x, -118);
        arrow.eventMode = 'static';
        arrow.cursor = 'pointer';
        arrow.hitArea = new PIXI.Rectangle(-40, -50, 80, 100);
        arrow.on('pointertap', onTap);
        return arrow;
    }

    private buildMenu(): PIXI.Container {
        const menu = new PIXI.Container();
        menu.name = 'home-actions';
        const edit = this.makeButton('Button01_s_Blue', 210, 58, 'EDIT SQUAD', 23, () => this.setEditing(true));
        edit.name = 'edit-squad';
        edit.position.set(0, -56);
        const choose = this.makeButton('Button01_s_Yellow', 354, 92, 'CHOOSE LEVEL', 32, () => this.setChoosingLevel(true));
        choose.name = 'choose-level';
        choose.position.set(0, 35);
        menu.addChild(edit, choose);
        return menu;
    }

    private buildLevelPanel(): PIXI.Container {
        const menu = new PIXI.Container();
        const back = new PIXI.Graphics();
        back.beginFill(0x23465a, 0.98).lineStyle(4, 0xeaf3f5, 0.9).drawRoundedRect(-DESIGN_WIDTH / 2, -MENU_HEIGHT / 2, DESIGN_WIDTH, MENU_HEIGHT, 26).endFill();
        menu.addChild(back);

        this.worldTitle = label('', 26);
        this.worldTitle.position.set(0, -128);
        this.worldProgress = label('', 16);
        this.worldProgress.position.set(0, -100);
        this.worldLock = PIXI.Sprite.from('Icon_Lock02');
        this.worldLock.anchor.set(0.5);
        this.worldLock.scale.set(0.3);
        menu.addChild(
            this.worldTitle,
            this.worldProgress,
            this.worldLock,
            this.arrow('arrow-left', -DESIGN_WIDTH / 2 + 38, () => this.changeWorld(-1)),
            this.arrow('arrow-right', DESIGN_WIDTH / 2 - 38, () => this.changeWorld(1)),
        );

        this.grid = new PIXI.Container();
        menu.addChild(this.grid);

        const backButton = this.makeButton('Button01_s_Blue', 180, 52, 'BACK', 23, () => this.setChoosingLevel(false));
        backButton.name = 'close-level-picker';
        backButton.position.set(0, 126);
        menu.addChild(backButton);
        return menu;
    }

    private buildEditPanel(): PIXI.Container {
        const panel = new PIXI.Container();
        const back = new PIXI.Graphics();
        back.beginFill(0x23465a, 0.96).lineStyle(4, 0xeaf3f5, 0.9).drawRoundedRect(-DESIGN_WIDTH / 2, -MENU_HEIGHT / 2, DESIGN_WIDTH, MENU_HEIGHT, 26).endFill();
        this.editBody = new PIXI.Container();
        this.toast = label('', 15, 0x7a1d1d);
        this.toast.position.set(0, 5);
        this.toast.alpha = 0;
        panel.addChild(back, this.editBody, this.toast);
        return panel;
    }

    private refreshEdit(): void {
        this.editBody.removeChildren().forEach((child) => child.destroy({ children: true }));

        SQUAD_VIEW_NAMES.forEach((name, index) => {
            const view = CHARACTER_VIEWS[name];
            const selected = index === this.editMember;
            const member = new PIXI.Container();
            const disc = new PIXI.Graphics();
            disc.beginFill(new THREE.Color(view.color).getHex()).lineStyle(selected ? 5 : 3, selected ? 0xffe14d : 0xffffff).drawCircle(0, 0, 21).endFill();
            const face = PIXI.Sprite.from(resolveSkinImagePath(view.face));
            face.anchor.set(0.5);
            face.width = face.height = 30;
            member.addChild(disc, face);
            member.position.set((index - 1) * 74, -140);
            member.scale.set(selected ? 1.15 : 0.9);
            member.eventMode = 'static';
            member.cursor = 'pointer';
            member.hitArea = new PIXI.Circle(0, 0, 28);
            member.on('pointertap', () => {
                this.editMember = index;
                this.refreshEdit();
            });
            this.editBody.addChild(member);
        });

        const tabs: ['faces' | 'hats' | 'colors', string][] = [['faces', 'FACES'], ['hats', 'HATS'], ['colors', 'COLORS']];
        tabs.forEach(([tab, text], index) => {
            const button = this.makeButton(this.editTab === tab ? 'Button01_s_Green' : 'Button01_s_Gray', 98, 38, text, 15, () => {
                this.editTab = tab;
                this.editPage = 0;
                this.refreshEdit();
            });
            button.position.set((index - 1) * 104, -98);
            this.editBody.addChild(button);
        });

        if (this.editTab === 'colors') {
            this.buildColorGrid();
            const doneButton = this.makeButton('Button01_s_Green', 150, 52, 'DONE', 26, () => this.setEditing(false));
            doneButton.position.set(0, 126);
            this.editBody.addChild(doneButton);
            return;
        }

        const items: (WardrobeItem | undefined)[] = this.editTab === 'faces' ? FACES : [undefined, ...HATS];
        const pages = Math.ceil(items.length / PAGE_SIZE);
        this.editPage = Math.min(this.editPage, pages - 1);
        items.slice(this.editPage * PAGE_SIZE, (this.editPage + 1) * PAGE_SIZE).forEach((item, index) => {
            const column = index % CARD_COLUMNS;
            const row = Math.floor(index / CARD_COLUMNS);
            const card = this.buildCard(item);
            card.position.set((column - (CARD_COLUMNS - 1) / 2) * (CARD_WIDTH + CARD_GAP), -38 + row * (CARD_HEIGHT + 8));
            this.editBody.addChild(card);
        });

        const done = this.makeButton('Button01_s_Green', 150, 52, 'DONE', 26, () => this.setEditing(false));
        done.position.set(0, 126);
        this.editBody.addChild(done);
        if (pages > 1) {
            const prev = this.arrow('arrow-left', -140, () => this.turnPage(-1, pages));
            const next = this.arrow('arrow-right', 140, () => this.turnPage(1, pages));
            for (const side of [prev, next]) {
                side.y = 126;
                side.scale.set(0.5);
            }
            const counter = label(`${this.editPage + 1}/${pages}`, 14);
            counter.position.set(108, 126);
            this.editBody.addChild(prev, next, counter);
        }
    }

    private buildColorGrid(): void {
        const name = SQUAD_VIEW_NAMES[this.editMember];
        SQUAD_COLORS.forEach((hex, index) => {
            const taken = isSquadColorTaken(name, hex);
            const selected = CHARACTER_VIEWS[name].color === hex;
            const swatch = new PIXI.Container();
            const disc = new PIXI.Graphics();
            disc.beginFill(new THREE.Color(hex).getHex()).lineStyle(selected ? 5 : 3, selected ? 0xffe14d : 0xffffff).drawCircle(0, 0, 25).endFill();
            swatch.addChild(disc);
            if (taken) {
                disc.alpha = 0.3;
                const lock = PIXI.Sprite.from('Icon_Close02');
                lock.anchor.set(0.5);
                lock.scale.set(0.35);
                swatch.addChild(lock);
            }
            swatch.position.set(((index % 5) - 2) * 58, -38 + Math.floor(index / 5) * 62);
            swatch.eventMode = 'static';
            swatch.cursor = taken ? 'default' : 'pointer';
            swatch.hitArea = new PIXI.Circle(0, 0, 30);
            swatch.on('pointertap', () => {
                if (taken) {
                    this.showToast('COLOR IN USE');
                    return;
                }
                if (setSquadColor(name, hex)) {
                    this.players[this.editMember]?.character?.setColor(hex);
                    this.podiumMaterials[this.editMember]?.color.set(new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.35));
                    this.refreshEdit();
                }
            });
            this.editBody.addChild(swatch);
        });
    }

    private turnPage(step: number, pages: number): void {
        this.editPage = (this.editPage + step + pages) % pages;
        this.refreshEdit();
    }

    private equippedId(): string | undefined {
        const view = CHARACTER_VIEWS[SQUAD_VIEW_NAMES[this.editMember]];
        return this.editTab === 'faces' ? view.face : view.hat;
    }

    /** One face or hat card; `undefined` is the "no hat" card. */
    private buildCard(item?: WardrobeItem): PIXI.Container {
        const card = new PIXI.Container();
        const owned = !item || (this.editTab === 'faces' ? Wardrobe.ownsFace(item.id) : Wardrobe.ownsHat(item.id));
        const equipped = (item?.id) === this.equippedId();
        const back = new PIXI.Graphics();
        back.beginFill(equipped ? 0x2f8f3f : owned ? 0x2c5f8a : 0x3a4656).lineStyle(equipped ? 4 : 2, equipped ? 0xffe14d : 0xffffff, equipped ? 1 : 0.6)
            .drawRoundedRect(-CARD_WIDTH / 2, -CARD_HEIGHT / 2, CARD_WIDTH, CARD_HEIGHT, 12).endFill();
        card.addChild(back);

        const icon = new PIXI.Sprite();
        icon.anchor.set(0.5);
        icon.position.set(0, -10);
        if (!item) {
            icon.texture = PIXI.Texture.from('Icon_Close02');
            icon.scale.set(0.5);
        } else if (this.editTab === 'faces') {
            icon.texture = PIXI.Texture.from(resolveSkinImagePath(item.id));
            icon.width = icon.height = 44;
        } else {
            void HatIcons.get(item.id).then((texture) => {
                if (texture && !icon.destroyed) {
                    icon.texture = texture;
                    icon.width = icon.height = 50;
                }
            });
        }
        if (!owned) {
            icon.tint = 0xb8c2cf;
        }
        card.addChild(icon);

        const caption = !item ? 'NONE' : owned ? item.name.toUpperCase() : `${item.price}`;
        const text = label(caption, 12);
        text.position.set(owned ? 0 : 8, 26);
        card.addChild(text);
        if (item && !owned) {
            const coin = new PIXI.Graphics();
            coin.beginFill(0xffc83d).lineStyle(2, 0xb8860b).drawCircle(0, 0, 6).endFill();
            coin.position.set(-text.width / 2 + 2, 26);
            card.addChild(coin);
        }

        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.on('pointertap', () => this.onCard(item, card));
        return card;
    }

    private onCard(item: WardrobeItem | undefined, card: PIXI.Container): void {
        const kind = this.editTab === 'faces' ? 'face' : 'hat';
        if (item && !Wardrobe.buy(kind, item)) {
            GameAudio.play('blocked');
            this.showToast('NOT ENOUGH CASH');
            this.tweens.push(gsap.fromTo(card, { rotation: -0.08 }, { rotation: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' }));
            return;
        }
        GameAudio.play('equip');
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
        this.refreshEdit();
    }

    private showToast(text: string): void {
        this.toast.text = text;
        this.toast.alpha = 1;
        this.tweens.push(gsap.to(this.toast, { alpha: 0, duration: 0.5, delay: 0.9 }));
    }

    private setEditing(editing: boolean): void {
        this.editing = editing;
        this.menu.visible = !editing;
        this.editPanel.visible = editing;
        if (editing) {
            this.refreshEdit();
        }
        this.resize();
    }

    private setChoosingLevel(choosing: boolean): void {
        this.levelPicker.visible = choosing;
        this.menu.visible = !choosing;
        if (choosing) {
            this.refreshWorld();
        }
        this.resize();
    }

    private changeWorld(step: number): void {
        const count = LevelCatalog.worlds().length;
        this.worldIndex = (this.worldIndex + step + count) % count;
        this.refreshWorld();
    }

    private globalIndex(level: ReturnType<typeof LevelCatalog.all>[number]): number {
        return LevelCatalog.all().indexOf(level);
    }

    private refreshWorld(): void {
        const world = this.world();
        const progress = LevelCatalog.worldProgress(world);
        const unlocked = LevelCatalog.isUnlocked(this.globalIndex(world.levels[0]));
        this.worldTitle.text = `${world.number}. ${world.name.toUpperCase()}`;
        this.worldTitle.scale.set(1);
        this.worldTitle.scale.set(Math.min(1, (DESIGN_WIDTH - 140) / this.worldTitle.width));
        const stars = Progress.worldStars(world.levels);
        const gate = worldGateStars(world.number);
        this.worldProgress.text = unlocked
            ? `${progress.done}/${progress.total} DONE   ★ ${stars.earned}/${stars.max}`
            : `NEED ★ ${gate} (YOU HAVE ${Progress.totalStars()})`;
        this.worldLock.visible = !unlocked;
        this.worldLock.position.set(this.worldTitle.width / 2 + 24, -128);

        this.grid.removeChildren().forEach((child) => child.destroy({ children: true }));
        const rows = Math.ceil(world.levels.length / GRID_COLUMNS);
        world.levels.forEach((level, index) => {
            const column = index % GRID_COLUMNS;
            const row = Math.floor(index / GRID_COLUMNS);
            const x = (column - (GRID_COLUMNS - 1) / 2) * (TILE + TILE_GAP);
            const y = -35 + (row - (rows - 1) / 2) * (TILE + TILE_GAP) + (TILE + TILE_GAP) / 2 - 6;
            const tile = this.buildTile(level, index + 1);
            tile.position.set(x, y);
            this.grid.addChild(tile);
        });
    }

    private buildTile(level: ReturnType<typeof LevelCatalog.all>[number], number: number): PIXI.Container {
        const index = this.globalIndex(level);
        const done = LevelCatalog.isCompleted(level);
        const open = LevelCatalog.isUnlocked(index);
        const color = done ? TILE_COLORS.done : open ? TILE_COLORS.open : TILE_COLORS.locked;
        const tile = new PIXI.Container();
        const back = new PIXI.Graphics();
        back.beginFill(0x000000, 0.25).drawRoundedRect(-TILE / 2, -TILE / 2 + 5, TILE, TILE, 16).endFill();
        back.beginFill(color).lineStyle(4, 0xffffff).drawRoundedRect(-TILE / 2, -TILE / 2, TILE, TILE, 16).endFill();
        tile.addChild(back);
        if (open) {
            const numberLabel = label(String(number), done ? 28 : 34);
            numberLabel.position.y = done ? -8 : 0;
            tile.addChild(numberLabel);
            const earned = Progress.starsFor(level);
            for (let i = 0; done && i < 3; i++) {
                const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
                star.anchor.set(0.5);
                star.scale.set(16 / Math.max(star.texture.width, 1));
                star.position.set((i - 1) * 17, TILE / 2 - 16);
                if (i >= earned) {
                    star.tint = 0x202020;
                    star.alpha = 0.5;
                }
                tile.addChild(star);
            }
        } else {
            const lock = PIXI.Sprite.from('Icon_Lock02');
            lock.anchor.set(0.5);
            lock.scale.set(0.5);
            tile.addChild(lock);
        }
        if (done) {
            const check = PIXI.Sprite.from('Icon_Check02');
            check.anchor.set(0.5);
            check.scale.set(0.5);
            check.position.set(TILE / 2 - 6, TILE / 2 - 6);
            tile.addChild(check);
        }
        tile.eventMode = 'static';
        tile.cursor = open ? 'pointer' : 'default';
        tile.on('pointertap', () => {
            if (open) {
                this.play(index);
            } else {
                this.tweens.push(gsap.fromTo(tile, { rotation: -0.08 }, { rotation: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' }));
            }
        });
        return tile;
    }

    private play(index: number): void {
        LevelCatalog.select(index);
        this.onPlayLevel.dispatch();
    }

    public resize(): void {
        this.layoutDaily();
        const screen = Game.overlayScreenData;
        if (!this.root || !screen) {
            return;
        }
        const scale = Math.min(1.1, screen.width / DESIGN_WIDTH, screen.height / 720);

        const panelHeight = this.editing ? MENU_HEIGHT : HOME_MENU_HEIGHT;
        const menuCenter = screen.bottomLeft.y - (panelHeight / 2 + 24) * scale;
        this.menu.scale.set(scale);
        this.menu.position.set(screen.center.x, menuCenter);
        const menuTop = menuCenter - (panelHeight / 2) * scale;

        this.editPanel.scale.set(scale);
        this.editPanel.position.set(screen.center.x, menuCenter);
        this.levelPicker.position.set(screen.center.x, screen.center.y);
        this.levelPanel.scale.set(scale);
        this.levelDim.clear().beginFill(0x122c3d, 0.65)
            .drawRect(-screen.width / 2, -screen.height / 2, screen.width, screen.height).endFill();

        // Keep the squad between the persistent corner controls and the bottom panel.
        const bottomEdge = menuTop;
        const free = (screen.topLeft.y + 120 * scale + bottomEdge) / 2 + 125 * scale;
        const fraction = (free - screen.topLeft.y) / Math.max(1, screen.height);
        const height = Math.max(1, window.innerHeight);
        this.threeCamera.setViewOffset(window.innerWidth, height, 0, (0.5 - fraction) * height, window.innerWidth, height);
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
        super.destroy();
    }
}
