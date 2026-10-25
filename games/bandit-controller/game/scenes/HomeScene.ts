// HomeScene.ts
//
// The friendly front screen: the squad idling in 3D, a world picker with a level grid (checks for
// completed levels, locks for ones not reached yet), a PLAY button, an EDIT SQUAD panel and a reserved
// SHOP slot. It only exposes Signals — index.ts is the one that changes scenes.

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
    SQUAD_VIEW_NAMES,
    resolveSkinImagePath,
    setSquadFace,
    setSquadHat,
} from '../data/CharacterViews';
import { GameState } from '../data/GameState';
import { FACES, HATS, Wardrobe, WardrobeItem } from '../data/Wardrobe';
import { HatIcons } from '../ui/HatIcons';
import { LevelCatalog, WorldInfo } from '../data/LevelCatalog';
import type MainPlayer from '../player/MainPlayer';
import { UiKit } from '../ui/UiKit';
import MoneyHud from '../ui/MoneyHud';
import { WorldEnvironment } from './shared/WorldEnvironment';

const CARD_COLUMNS = 5;
const CARD_WIDTH = 70;
const CARD_HEIGHT = 76;
const CARD_GAP = 9;
const PAGE_SIZE = 10;
/** Podium per squad member: x, z and top height. Blue (the main character) stands in the centre, a step higher and in front. */
const PODIUM = [
    { x: 0, z: 0.9, height: 0.7 },
    { x: -2.15, z: -0.3, height: 0.35 },
    { x: 2.15, z: -0.3, height: 0.35 },
];
const CAMERA_FOV = 30;
const CAMERA_DISTANCE = 15;
const CAMERA_HEIGHT = 3.2;
const LOOK_HEIGHT = 1.1;
const MENU_HEIGHT = 330;
const DESIGN_WIDTH = 420;
const GRID_COLUMNS = 4;
const TILE = 72;
const TILE_GAP = 12;

const TILE_COLORS = { done: 0x5cc84a, open: 0x3b9ae8, locked: 0x8a97a6 };

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
    private title!: PIXI.Container;
    private shopButton!: PIXI.Container;
    private worldTitle!: PIXI.Text;
    private worldProgress!: PIXI.Text;
    private worldLock!: PIXI.Sprite;
    private grid!: PIXI.Container;
    private editBody!: PIXI.Container;
    private editMember = 0;
    private editTab: 'faces' | 'hats' = 'faces';
    private editPage = 0;
    private toast!: PIXI.Text;
    private worldIndex = 0;
    private editing = false;
    private destroyed = false;
    private tweens: gsap.core.Tween[] = [];

    public constructor(game: Game, moneyHud: MoneyHud) {
        super(game);
        this.moneyHud = moneyHud;
    }

    public get ready(): Promise<void> {
        return this.env.playerReady;
    }

    public build(): void {
        this.destroyed = false;
        this.editing = false;
        this.env = new WorldEnvironment(this.threeScene, BendService, 40, 16, 1);
        this.players = SQUAD_VIEW_NAMES.map((name, index) => {
            const spot = PODIUM[index];
            this.buildPodium(spot, new THREE.Color(CHARACTER_VIEWS[name].color));
            const player = this.env.spawnPlayer(this, new THREE.Vector3(spot.x, spot.height, spot.z), undefined, CHARACTER_VIEWS[name]);
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

    private buildPodium(spot: { x: number; z: number; height: number }, color: THREE.Color): void {
        const base = new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.35), roughness: 0.5 });
        const top = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
        BendService.applyBend(base);
        BendService.applyBend(top);
        const column = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, spot.height, 40), base);
        column.position.set(spot.x, spot.height / 2, spot.z);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.06, 40), top);
        cap.position.set(spot.x, spot.height + 0.03 - 0.06, spot.z);
        cap.scale.set(1, 1, 1);
        this.threeScene.add(column, cap);
    }

    private placeCamera(): void {
        this.threeCamera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
        this.threeCamera.lookAt(0, LOOK_HEIGHT, 0);
    }

    private world(): WorldInfo {
        return LevelCatalog.worlds()[this.worldIndex];
    }

    private buildUi(): void {
        const root = new PIXI.Container();
        this.root = root;

        this.title = new PIXI.Container();
        const ribbon = PIXI.Sprite.from('Title_Ribbon01_Green');
        ribbon.anchor.set(0.5);
        ribbon.scale.set(0.85);
        this.title.addChild(ribbon, label('HEIST CREW', 24, 0x1d5a2a));

        this.shopButton = this.roundButton('Icon_Lock02', 0x9aa6b4);
        const soon = label('SHOP', 13);
        soon.position.set(0, 42);
        this.shopButton.addChild(soon);

        this.menu = this.buildMenu();
        this.editPanel = this.buildEditPanel();
        this.editPanel.visible = false;
        root.addChild(this.title, this.shopButton, this.menu, this.editPanel);
        this.game.uiLayer.addChild(root);
        this.resize();
    }

    private roundButton(icon: string, color: number): PIXI.Container {
        const button = new PIXI.Container();
        const back = new PIXI.Graphics();
        back.beginFill(0x000000, 0.25).drawCircle(0, 4, 30).endFill();
        back.beginFill(color).lineStyle(4, 0xffffff).drawCircle(0, 0, 30).endFill();
        const sprite = PIXI.Sprite.from(icon);
        sprite.anchor.set(0.5);
        sprite.scale.set(34 / Math.max(sprite.texture.width, sprite.texture.height, 1));
        button.addChild(back, sprite);
        return button;
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
        const back = new PIXI.Graphics();
        back.beginFill(0x16324a, 0.92).lineStyle(4, 0xffffff, 0.9).drawRoundedRect(-DESIGN_WIDTH / 2, -MENU_HEIGHT / 2, DESIGN_WIDTH, MENU_HEIGHT, 26).endFill();
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

        const edit = this.makeButton('Button01_s_Blue', 150, 58, 'EDIT SQUAD', 20, () => this.setEditing(true));
        edit.position.set(-100, 120);
        const play = this.makeButton('Button01_s_Green', 190, 68, 'PLAY', 34, () => this.playRecommended());
        play.position.set(85, 120);
        menu.addChild(edit, play);
        return menu;
    }

    private buildEditPanel(): PIXI.Container {
        const panel = new PIXI.Container();
        const back = new PIXI.Graphics();
        back.beginFill(0x16324a, 0.94).lineStyle(4, 0xffffff, 0.9).drawRoundedRect(-DESIGN_WIDTH / 2, -MENU_HEIGHT / 2, DESIGN_WIDTH, MENU_HEIGHT, 26).endFill();
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

        const tabs: ['faces' | 'hats', string][] = [['faces', 'FACES'], ['hats', 'HATS']];
        tabs.forEach(([tab, text], index) => {
            const button = this.makeButton(this.editTab === tab ? 'Button01_s_Green' : 'Button01_s_Gray', 130, 38, text, 18, () => {
                this.editTab = tab;
                this.editPage = 0;
                this.refreshEdit();
            });
            button.position.set((index - 0.5) * 140, -98);
            this.editBody.addChild(button);
        });

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
            this.showToast('NOT ENOUGH CASH');
            this.tweens.push(gsap.fromTo(card, { rotation: -0.08 }, { rotation: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)' }));
            return;
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
        this.worldProgress.text = `${progress.done}/${progress.total} COMPLETE`;
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
            tile.addChild(label(String(number), 34));
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

    /** First unfinished unlocked level of the current world, otherwise its first level. */
    private playRecommended(): void {
        const world = this.world();
        const target = world.levels.find((level) => !LevelCatalog.isCompleted(level) && LevelCatalog.isUnlocked(this.globalIndex(level)))
            ?? world.levels.find((level) => LevelCatalog.isUnlocked(this.globalIndex(level)));
        if (target) {
            this.play(this.globalIndex(target));
        }
    }

    private play(index: number): void {
        LevelCatalog.select(index);
        this.onPlayLevel.dispatch();
    }

    public resize(): void {
        const screen = Game.overlayScreenData;
        if (!this.root || !screen) {
            return;
        }
        const scale = Math.min(1.1, screen.width / DESIGN_WIDTH, screen.height / 720);
        this.title.scale.set(scale);
        this.title.position.set(screen.center.x, screen.topLeft.y + 80 * scale);
        this.shopButton.scale.set(scale);
        this.shopButton.position.set(screen.topRight.x - 44 * scale, screen.topLeft.y + 44 * scale);

        const menuCenter = screen.bottomLeft.y - (MENU_HEIGHT / 2 + 14) * scale;
        this.menu.scale.set(scale);
        this.menu.position.set(screen.center.x, menuCenter);
        const menuTop = menuCenter - (MENU_HEIGHT / 2) * scale;

        this.editPanel.scale.set(scale);
        this.editPanel.position.set(screen.center.x, menuCenter);

        // The squad is centered in the free space between the title and the bottom panel.
        const bottomEdge = menuTop;
        const free = (screen.topLeft.y + 120 * scale + bottomEdge) / 2;
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
            player.transform.position.y = PODIUM[index].height;
            player.rigidBody.velocity.y = 0;
        });
        this.env.fixedUpdate(delta);
        this.players.forEach((player, index) => {
            player.transform.position.y = PODIUM[index].height;
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
        super.destroy();
    }
}
