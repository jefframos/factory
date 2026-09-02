// FarmCropHud.ts
//
// The ONE growth-status HUD for the whole farm system — same "single shared
// instance, one per FarmPlotTile candidate registers into" shape as
// FarmSeedPicker.ts (see that file's own doc for the full reasoning: a
// per-tile popup risks more than one showing/overlapping at once).
//
// A resource icon (CropConfig.yield.resourceType's own icon, same
// icon-bg-square backdrop InventoryPopup's/FarmSeedPicker's own cells use)
// is shown the ENTIRE time a candidate is active — both while growing and
// once ready — so it's always obvious what this plant is going to yield,
// not just once it's collectible. Below that: while still growing, a
// BarComponent.ts progress bar (the ONE shared bar shape AnimalNode's own
// capture bar also uses now — see BarComponent.ts's own doc); once
// CropTypes.isCropReady(), the bar is replaced by a "Collect" button, and a
// checkmark badge (Icon_Check03_s, same "raw texture key" convention
// Gate.ts's own REQUIREMENT_BADGE_MET uses) overlaps the resource icon's
// own bottom-right corner — same corner-badge composition ShopZone's own
// upgrade-available badge uses on its tool icon. Harvesting is now always
// that deliberate tap — never automatic on collision (auto-collect is
// planned as a future unlockable OPTION, not implemented yet).
//
// Anchored above the CROP TILE itself (like AnimalNode's own bar floats
// above the animal, not the player), not the player's head like
// FarmSeedPicker — this is a status readout tied to a specific plant, not a
// menu that should follow the player around.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import Entity from '../ecs/Entity';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { createLibraryButton } from '../ui/ButtonLibrary';
import BarComponent from '../ui/BarComponent';
import { MIN_BAR_HEIGHT } from '../ui/BarRegistry';
import { CROP_CONFIG, CropId, getCropTotalGrowSec, isCropReady } from '../data/CropTypes';
import { ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from './AssetLibraryRegistry';

/** World-space offset above the crop TILE's own ground-level position — see this file's own top doc for why this tracks the tile, not the player. Raised further than a single-line-of-text HUD would need since BarComponent's own MIN_BAR_HEIGHT (56) makes the whole readout noticeably taller. */
const HUD_OFFSET = new THREE.Vector3(0, 2.3, 0);

const BAR_WIDTH = 100;

/** The resource icon shown ABOVE the bar/button — see this file's own top doc. Same "square tinted backdrop behind a smaller icon" composition InventoryPopup's/FarmSeedPicker's own grid cells use. */
const ICON_SIZE = 40;
const ICON_BG_SIZE = 48;
const ICON_BG_TEXTURE_KEY = 'BorderFrame_Squrare_Bg';
const ICON_BG_TINT = 0x000000;
const ICON_BG_ALPHA = 0.5;
/** Gap between the icon's own bottom edge and the bar/button row below it. */
const ICON_GAP = 8;
/** Checkmark badge overlapping the resource icon's own bottom-right corner once ready — same corner-badge idiom ShopZone's own SHOP_UPGRADE_AVAILABLE_ICON badge uses on its tool icon. */
const CHECK_BADGE_TEXTURE = 'Icon_Check03_s';
const CHECK_BADGE_SIZE = 24;
const CHECK_BADGE_INSET = 2;

const COLLECT_BUTTON_WIDTH = 96;
const COLLECT_BUTTON_HEIGHT = 36;

interface Candidate {
    position: THREE.Vector3;
    cropId: CropId;
    plantedAtSec: number;
    onCollect: () => void;
}

export default class FarmCropHud extends Entity {
    private readonly screenHost: ScreenAnchorHost;

    private content!: PIXI.Container;
    private resourceIcon!: PIXI.Sprite;
    private checkBadge!: PIXI.Sprite;
    private bar!: BarComponent;
    private collectButton!: PIXI.Container;

    /** Every growing/ready tile the player's own trigger currently overlaps — resolveActive() picks the winner every frame, same proximity-to-player-position tie-break FarmSeedPicker.ts uses (see that file's own doc for why registration order alone isn't reliable). */
    private readonly candidates = new Map<string, Candidate>();
    private activeTileKey?: string;
    private wasReady = false;
    /** Whichever ResourceType resourceIcon's texture was last set to — skips re-resolving/re-assigning the texture every frame the active candidate's own yield hasn't changed (almost always). */
    private lastIconResourceType?: ResourceType;

    public constructor(screenHost: ScreenAnchorHost) {
        super();
        this.screenHost = screenHost;
    }

    public override awake(): void {
        // Local y=0 is the BOTTOM of the bar/button row — both BarComponent (a NineSlicePlane
        // pair, top-left anchored, no PIXI `anchor` concept of its own) and collectButton sit
        // with their own bottom edge there, so swapping one for the other on ready never shifts
        // anything else. The icon sits ABOVE that whole row, offset by ICON_GAP from its own
        // top edge (MIN_BAR_HEIGHT, the taller of the two — see BarRegistry.MIN_BAR_HEIGHT's own
        // doc) — see this file's own top doc for why the icon shows regardless of ready state.
        const rowTopY = -MIN_BAR_HEIGHT;
        const iconCenterY = rowTopY - ICON_GAP - ICON_BG_SIZE / 2 - 10;

        const iconBg = new PIXI.Sprite(PIXI.Texture.from(ICON_BG_TEXTURE_KEY));
        iconBg.tint = ICON_BG_TINT;
        iconBg.alpha = ICON_BG_ALPHA;
        iconBg.anchor.set(0.5, 0.5);
        iconBg.width = ICON_BG_SIZE;
        iconBg.height = ICON_BG_SIZE;
        iconBg.position.set(0, iconCenterY);

        this.resourceIcon = new PIXI.Sprite();
        this.resourceIcon.anchor.set(0.5, 0.5);
        this.resourceIcon.width = ICON_SIZE;
        this.resourceIcon.height = ICON_SIZE;
        this.resourceIcon.position.set(0, iconCenterY);

        this.checkBadge = new PIXI.Sprite(PIXI.Texture.from(CHECK_BADGE_TEXTURE));
        this.checkBadge.anchor.set(1, 1);
        this.checkBadge.width = CHECK_BADGE_SIZE;
        this.checkBadge.height = CHECK_BADGE_SIZE;
        this.checkBadge.position.set(
            ICON_BG_SIZE / 2 - CHECK_BADGE_INSET,
            iconCenterY + ICON_BG_SIZE / 2 - CHECK_BADGE_INSET,
        );

        this.bar = new BarComponent('Green', BAR_WIDTH, MIN_BAR_HEIGHT);
        this.bar.position.set(-BAR_WIDTH / 2, rowTopY);

        this.collectButton = createLibraryButton({
            color: 'green',
            width: COLLECT_BUTTON_WIDTH, height: COLLECT_BUTTON_HEIGHT,
            label: 'Collect',
            onClick: () => this.collectActive(),
        });
        this.collectButton.position.set(-COLLECT_BUTTON_WIDTH / 2, -COLLECT_BUTTON_HEIGHT);
        // Matches wasReady's own false default — without this, a sprite's PIXI default
        // (visible=true) would leave the badge/button showing on the very first-ever candidate
        // if it happens to still be growing, since the ready!==wasReady toggle below only runs
        // on a CHANGE, and false===false never counts as one.
        this.checkBadge.visible = false;
        this.collectButton.visible = false;

        this.content = new PIXI.Container();
        this.content.addChild(iconBg, this.resourceIcon, this.checkBadge, this.bar, this.collectButton);
        this.content.visible = false;

        const anchorPosition = new THREE.Vector3();
        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.content,
            () => {
                const candidate = this.activeTileKey ? this.candidates.get(this.activeTileKey) : undefined;
                return candidate ? anchorPosition.copy(candidate.position).add(HUD_OFFSET) : anchorPosition.copy(HUD_OFFSET);
            },
        ));
    }

    public override update(delta: number): void {
        super.update(delta);
        this.resolveActive();

        const candidate = this.activeTileKey ? this.candidates.get(this.activeTileKey) : undefined;
        if (!candidate) {
            this.content.visible = false;
            return;
        }

        const cropConfig = CROP_CONFIG[candidate.cropId];
        const resourceType = cropConfig.yield.resourceType;
        if (resourceType !== this.lastIconResourceType) {
            this.lastIconResourceType = resourceType;
            this.resourceIcon.texture = getAssetIcon(resolveResourceAssetKey(resourceType));
        }

        const ready = isCropReady(cropConfig, candidate.plantedAtSec);
        if (ready !== this.wasReady) {
            this.wasReady = ready;
            this.bar.visible = !ready;
            this.checkBadge.visible = ready;
            this.collectButton.visible = ready;
        }

        if (!ready) {
            const totalGrowSec = getCropTotalGrowSec(cropConfig);
            const elapsedSec = Date.now() / 1000 - candidate.plantedAtSec;
            const fraction = totalGrowSec > 0 ? elapsedSec / totalGrowSec : 1;
            this.bar.setProgress(fraction);
        }

        this.content.visible = true;
    }

    /** Adds/updates `tileKey` as a live candidate — see this file's own top doc and FarmSeedPicker.register()'s own doc (same shape/reasoning) for why registering doesn't unconditionally make it THE active one. `position` is the tile's own world position (its center). */
    public register(tileKey: string, position: THREE.Vector3, cropId: CropId, plantedAtSec: number, onCollect: () => void): void {
        this.candidates.set(tileKey, { position: position.clone(), cropId, plantedAtSec, onCollect });
        this.resolveActive();
    }

    /** Drops `tileKey` from the candidate set — no-ops if it wasn't registered. */
    public unregister(tileKey: string): void {
        if (this.candidates.delete(tileKey)) {
            this.resolveActive();
        }
    }

    /** Picks whichever registered candidate's own position is closest to the player's actual body position right now — see FarmSeedPicker.resolveActive()'s own doc for the identical reasoning. */
    private resolveActive(): void {
        const viewerPosition = this.screenHost.getViewerPosition?.();

        let closestTileKey: string | undefined;
        let closestDistanceSq = Infinity;
        if (viewerPosition) {
            for (const [tileKey, candidate] of this.candidates) {
                const distanceSq = candidate.position.distanceToSquared(viewerPosition);
                if (distanceSq < closestDistanceSq) {
                    closestDistanceSq = distanceSq;
                    closestTileKey = tileKey;
                }
            }
        } else if (this.candidates.size > 0) {
            closestTileKey = this.candidates.has(this.activeTileKey ?? '') ? this.activeTileKey : this.candidates.keys().next().value;
        }

        this.activeTileKey = closestTileKey;
    }

    /** Tapped "Collect" — fires the active candidate's own onCollect() (FarmPlotTile.harvest()), which itself unregisters this tile once the harvest actually completes. No-ops if nothing's active (shouldn't happen — the button only shows while a ready candidate is active). */
    private collectActive(): void {
        const candidate = this.activeTileKey ? this.candidates.get(this.activeTileKey) : undefined;
        candidate?.onCollect();
    }
}
