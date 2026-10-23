// PizzaDebugMenu.ts
//
// Every pizza debug tool, on core/debug's DebugOverlay — one floating panel per topic, opened from
// the "Debug" launcher pill (top-left) or the backtick key. Shown with ?dev=1 (or ?debug=1); without
// it the overlay hands out inert panels, so building the menu costs nothing. Replaces the old
// dat.gui (DevGuiManager) folders and the bottom-left InGameButtonList buttons.
//
//   Progression   jump to a store level (PlaytestUnlock — reloads with ?unlockTo=N), scenarios
//                 (PlaytestScenario), store / staff / tool shortcuts
//   Economy       add money, resources, seeds
//   World         teleport, fly / top-down camera, camera tuning, tile readout, UI avoidance,
//                 map layout suggestions
//   Carrier       live carrier transform / stack tuning (PlayerConfig.carrier)
//   Reset         clear any one save storage, or everything
//   Performance   render stats, resource streaming radii, camera far, pause, diagnostics dumps
//   Tool Stats    live gather stats per tool (they change with shop upgrades)
//
// Panel values marked persist are saved by the panel's Apply button and restored next load
// (the overlay's own DebugPersistence); buttons and readouts are never saved.

import * as THREE from 'three';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import type { DebugPanel } from 'core/debug/DebugPanel';
import PlatformHandler from 'core/platforms/PlatformHandler';
import SetupThree from 'core/scene/SetupThree';
import type MainPlayer from '../player/MainPlayer';
import { getShopConfig, getUpgradeCost, SHOP_CONFIG_BY_ID } from '../shop/ShopTypes';
import { ShopUpgradeStorage } from '../shop/ShopUpgradeStorage';
import { TriggerStorage } from '../data/TriggerStorage';
import { FarmPlotStorage } from '../data/FarmPlotStorage';
import { SeedId } from '../data/SeedTypes';
import { SeedStorage } from '../data/SeedStorage';
import { TutorialProgressStorage } from '../tutorial/TutorialProgressStorage';
import { QueueStorage } from '../data/QueueStorage';
import { EconomyStorage } from '../data/EconomyStorage';
import { CurrencyType } from '../data/EconomyTypes';
import { AnimalFollowStorage } from '../data/AnimalFollowStorage';
import { clearAllPlayerData } from '../data/PlayerDataReset';
import { GlobalResourceStorage } from '../data/GlobalResourceStorage';
import { BackpackStorage } from '../data/BackpackStorage';
import { BuildingStorage } from '../data/BuildingStorage';
import { GateStorage } from '../data/GateStorage';
import { PlayerPositionStorage } from '../data/PlayerPositionStorage';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { PROVIDER_CONFIG } from '../actions/ProviderTypes';
import { ACTION_CONFIG } from '../actions/ActionTypes';
import { getToolIcon } from '../actions/ToolRegistry';
import { UpgradeNotificationManager } from '../ui/notifications/UpgradeNotificationManager';
import { NotificationRarity, NotificationType } from '../ui/notifications/NotificationTypes';
import { CarrierStackMode, getPlayerConfig } from '../data/PlayerConfig';
import { STORE_CONFIG_BY_ID, type StoreWorkerRole } from '../store/StoreTypes';
import { StoreProgressStorage } from '../store/StoreProgressStorage';
import { getCarrierCapacity, getCarrierLevel, getCarrierShopIds } from '../data/CarrierCapacity';
import { CarryStack } from '../player/CarryStack';
import PlayerUIAvoidanceComponent from '../components/PlayerUIAvoidanceComponent';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';
import { downloadGameData } from './GameDataBaker';
import { MapLayoutSuggestionTool, MapLayoutArchetype } from './MapLayoutSuggestionTool';
import { captureSaveState } from '../playtest/PlaytestScenario';
import { buildSectionNow, type SectionBuildHost } from './DebugSectionBuilder';

/** The scene-side actions and objects the menu drives — PizzaScene passes closures over its own privates. */
export interface PizzaDebugHost extends SectionBuildHost {
    readonly threeScene: THREE.Scene;
    readonly threeCamera: THREE.PerspectiveCamera;
    readonly player: MainPlayer;
    /** Live camera tuning object (yawDeg / pitchDeg / distance / followSpeed) — read every frame. */
    readonly cameraSettings: { yawDeg: number; pitchDeg: number; distance: number; followSpeed: number };
    tileReadout(): string;
    revealNextZone(): void;
    teleportToNextTeleporter(): void;
    unlockAllTools(): void;
    toggleFlyCamera(): void;
    toggleTopDownCamera(): void;
    addMoneyToCurrentStore(amount: number): void;
    fillAvailableStorages(amount: number): void;
    hireStoreWorker(role: StoreWorkerRole): void;
    resetCraftingProgress(): void;
    resetDynamicResources(): void;
    resetShapeResources(): void;
    dumpSceneMeshes(): void;
}

/** Scenario files known to ship in games/pizza/playtest-scenarios/ (the Load field takes any name). */
const KNOWN_SCENARIOS = ['diner'];
/** Store levels offered as one-click jumps. */
const QUICK_LEVELS = [3, 5, 8, 10, 13];
/** "Build room" buttons: label -> storeSection id (Buildings tab). */
const BUILD_ROOMS: [string, string][] = [
    ['Office', 'storeRoom1'],
    ['Bakery', 'storeRoom2'],
    ['Diner', 'storeRoom3'],
    ['Arcade', 'storeRoom4'],
];

/** Builds every panel — see this file's own doc. The overlay itself is initialized in index.ts. */
export function buildPizzaDebugMenu(host: PizzaDebugHost): void {
    buildProgressionPanel(host);
    buildEconomyPanel();
    buildWorldPanel(host);
    buildCarrierPanel(host);
    buildResetPanel(host);
    buildPerformancePanel(host);
    buildToolStatsPanel();
}

function panel(title: string, id: string, open = false): DebugPanel {
    return DebugOverlay.instance.panel(title, { id: `pizza.${id}`, closed: !open, foldersCollapsed: false });
}

/** Reloads the page with these query changes (undefined removes a key) — boot-time tools (unlockTo, scenario) need a fresh boot. */
function reloadWith(changes: Record<string, string | undefined>): void {
    const params = new URLSearchParams(window.location.search);
    for (const key of ['unlockTo', 'scenario', 'fresh']) {
        params.delete(key);
    }
    for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) {
            params.delete(key);
        } else {
            params.set(key, value);
        }
    }
    window.location.search = params.toString();
}

function firstStoreId(): string | undefined {
    return Object.keys(STORE_CONFIG_BY_ID).find(id => !STORE_CONFIG_BY_ID[id]?.disabled);
}

// ---- Progression

function buildProgressionPanel(host: PizzaDebugHost): void {
    const progression = panel('Progression', 'progression', true);
    const storeId = firstStoreId();
    progression.monitor('Store level', () => (storeId ? StoreProgressStorage.getLevel(storeId) : '—'));

    // Build: one store room and everything inside it, live — raises the store level if needed (DebugSectionBuilder.ts).
    const build = progression.folder('Build room (live)');
    let building = false;
    build.buttons(BUILD_ROOMS.map(([label, sectionId]) => ({
        label,
        variant: 'accent' as const,
        tooltip: `Builds ${sectionId} and what's inside it (stations, storages, machines) for free`,
        action: () => {
            if (building) {
                return;
            }
            building = true;
            DebugOverlay.instance.toast(`Building ${label}...`);
            buildSectionNow(host, sectionId)
                .then(summary => DebugOverlay.instance.toast(summary))
                .catch(error => {
                    console.error('[PizzaDebugMenu] build failed', error);
                    DebugOverlay.instance.toast(`Build ${label} failed — see console`, true);
                })
                .finally(() => { building = false; });
        },
    })));

    // Jump: wipe the save and boot at that store level with everything possible built (PlaytestUnlock.ts).
    const jump = progression.folder('Jump to store level');
    const target = { level: 8 };
    jump.number(target, 'level', { min: 1, max: 20, step: 1, label: 'Level', persist: false });
    const go = (level: number): void => {
        if (window.confirm(`Wipe the save and start at store level ${level} with everything possible built?`)) {
            reloadWith({ unlockTo: String(level) });
        }
    };
    jump.button('Jump (wipes save)', () => go(target.level), { variant: 'danger', tooltip: 'Reloads with ?unlockTo=N — rooms, storages, stations, farms, staff and 2000 money' });
    jump.buttons(QUICK_LEVELS.map(level => ({ label: `Lv ${level}`, action: () => go(level) })));

    // Scenarios: whole-save snapshots in games/pizza/playtest-scenarios/ (PlaytestScenario.ts).
    const scenarios = progression.folder('Scenarios');
    scenarios.buttons(KNOWN_SCENARIOS.map(name => ({ label: `Load "${name}"`, action: () => reloadWith({ scenario: name }) })));
    const custom = { name: '' };
    scenarios.text(custom, 'name', { label: 'Scenario name', persist: false });
    scenarios.button('Load named scenario', () => custom.name.trim() && reloadWith({ scenario: custom.name.trim() }));
    scenarios.button('Save state (download)', () => {
        const level = storeId ? StoreProgressStorage.getLevel(storeId) : 0;
        const snapshot = captureSaveState(`saved from the debug menu at store level ${level}`);
        const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 1)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `scenario-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, { tooltip: 'Drop the file in games/pizza/playtest-scenarios/ and load it by name' });

    const store = progression.folder('Store');
    store.button('Add 50 to store (as a sale)', () => host.addMoneyToCurrentStore(50));
    store.button('Fill storages +3', () => host.fillAvailableStorages(3));
    store.button('Open next zone', () => host.revealNextZone());

    const staff = progression.folder('Staff');
    staff.buttons((['cashier', 'restocker', 'cleaner', 'baker'] as StoreWorkerRole[]).map(role => ({
        label: `Hire ${role}`,
        action: () => host.hireStoreWorker(role),
    })));

    const tools = progression.folder('Tools');
    tools.button('Unlock all tools', () => host.unlockAllTools());
    // Fully funds AND completes the shop's next level in one click — bypasses the deposit walk-up
    // and its cooldown — with the same notification ShopZone's own completion shows.
    for (const [id, config] of Object.entries(SHOP_CONFIG_BY_ID)) {
        if (!config) {
            continue;
        }
        tools.button(`Upgrade ${config.name}`, () => {
            if (ShopUpgradeStorage.isMaxLevel(id, config)) {
                return;
            }
            const cost = getUpgradeCost(config, ShopUpgradeStorage.getLevel(id));
            ShopUpgradeStorage.addProgress(id, config, cost.money);
            for (const [type, amount] of Object.entries(cost.resources) as [ResourceType, number][]) {
                ShopUpgradeStorage.addResourceProgress(id, config, type, amount);
            }
            if (ShopUpgradeStorage.tryCompleteUpgrade(id, config)) {
                UpgradeNotificationManager.instance.show({
                    type: NotificationType.Upgrade,
                    rarity: NotificationRarity.Common,
                    icon: getToolIcon(config.tool),
                    title: 'UPGRADE!',
                    subtitle: `${config.tool.toUpperCase()} LEVEL ${ShopUpgradeStorage.getLevel(id)}`,
                });
            }
        });
    }
    tools.button('Reset upgrades', () => void ShopUpgradeStorage.clearAll(), { variant: 'danger' });
}

// ---- Economy

function buildEconomyPanel(): void {
    const economy = panel('Economy', 'economy');
    economy.monitor('Money', () => EconomyStorage.getBalance(CurrencyType.Money));
    economy.buttons([
        { label: '+100 money', action: () => EconomyStorage.add(CurrencyType.Money, 100) },
        { label: '+1000 money', action: () => EconomyStorage.add(CurrencyType.Money, 1000) },
    ]);
    // Skips Pig (caught, not handed out), Garbage and anything disabled.
    economy.button('+10 of each resource', () => {
        for (const type of Object.values(ResourceType)) {
            if (type === ResourceType.Pig || type === ResourceType.Garbage || RESOURCE_CONFIG[type]?.disabled) {
                continue;
            }
            BackpackStorage.add(type, 10);
        }
    });
    economy.button('+5 of every seed', () => {
        for (const seedId of Object.values(SeedId)) {
            SeedStorage.add(seedId, 5);
        }
    });
}

// ---- World

function buildWorldPanel(host: PizzaDebugHost): void {
    const world = panel('World', 'world');
    world.monitor('Tile', () => host.tileReadout());
    world.button('Teleport: next', () => host.teleportToNextTeleporter());
    world.buttons([
        { label: 'Fly camera', action: () => host.toggleFlyCamera(), tooltip: 'WASD + Q/E, right-drag to look, wheel to zoom' },
        { label: 'Top-down view', action: () => host.toggleTopDownCamera() },
    ]);

    // Bound straight to the live camera settings — read every frame.
    const camera = world.folder('Camera');
    camera.slider(host.cameraSettings, 'yawDeg', -180, 180, 1, 'Yaw');
    camera.slider(host.cameraSettings, 'pitchDeg', 0, 89, 1, 'Pitch');
    camera.slider(host.cameraSettings, 'distance', 2, 30, 0.1, 'Distance');
    camera.slider(host.cameraSettings, 'followSpeed', 0.5, 20, 0.1, 'Follow speed');

    // The "keep UI off the player" region 'simple' popups dodge (PlayerUIAvoidanceComponent) — both live.
    const uiAvoidance = host.player.getComponent(PlayerUIAvoidanceComponent);
    if (uiAvoidance) {
        const avoidance = world.folder('UI avoidance');
        avoidance.slider(uiAvoidance, 'radius', 0, 200, 1, 'Radius');
        avoidance.toggle(uiAvoidance, 'showDebugPreview', { label: 'Show preview', persist: false });
    }

    // A ghost overlay of a zone-layout archetype on the live map (MapLayoutSuggestionTool) — design sketch only.
    const layout = world.folder('Map layout suggestions', { collapsed: true });
    layout.select(MapLayoutSuggestionTool.settings, 'archetype', ['loop', 'ring', 'valley'] as MapLayoutArchetype[], { label: 'Archetype', persist: false });
    layout.buttons([
        { label: 'Show', action: () => MapLayoutSuggestionTool.show(host.threeScene) },
        { label: 'Shuffle', action: () => MapLayoutSuggestionTool.reroll(host.threeScene) },
        { label: 'Clear', action: () => MapLayoutSuggestionTool.clear() },
    ]);
}

// ---- Carrier

/** Live-tunes PlayerConfig.carrier on the loaded character — session-only: copy values you like into the editor's Player tab. */
function buildCarrierPanel(host: PizzaDebugHost): void {
    const carrier = panel('Carrier', 'carrier');
    const initial = getPlayerConfig().carrier;
    const values = {
        offsetX: initial.offset.x, offsetY: initial.offset.y, offsetZ: initial.offset.z,
        rotX: initial.rotationDeg.x, rotY: initial.rotationDeg.y, rotZ: initial.rotationDeg.z,
        scale: initial.scale,
    };
    const apply = (): void => {
        host.player.character?.setCarrierTransform({
            models: initial.models,
            offset: { x: values.offsetX, y: values.offsetY, z: values.offsetZ },
            rotationDeg: { x: values.rotX, y: values.rotY, z: values.rotZ },
            scale: values.scale,
            stackMode: initial.stackMode,
        });
    };
    const transform = carrier.folder('Transform');
    for (const key of ['offsetX', 'offsetY', 'offsetZ'] as const) {
        transform.slider(values, key, -200, 200, 0.5).onChange(apply);
    }
    for (const key of ['rotX', 'rotY', 'rotZ'] as const) {
        transform.slider(values, key, -180, 180, 1).onChange(apply);
    }
    transform.slider(values, 'scale', 0, 150, 0.5).onChange(apply);

    // Written into the LIVE config — the stack visual reads it every frame and re-fits / rebuilds.
    const stack = carrier.folder('Stack');
    const itemScale = { itemScale: initial.itemScale ?? 1 };
    stack.slider(itemScale, 'itemScale', 0.25, 4, 0.05, 'Item scale').onChange(value => { initial.itemScale = value; });
    stack.select(initial as unknown as Record<string, unknown>, 'stackMode', ['grid', 'tower'] as CarrierStackMode[], { label: 'Stack mode' });
    stack.monitor('Capacity', () => getCarrierCapacity());
    stack.monitor('Carrier level', () => getCarrierLevel());
    stack.monitor('Carried', () => CarryStack.carriedCount());

    // Capacity comes from the carrier shop's level — buy/reset it for free to test limits.
    carrier.button('Upgrade carrier (+1 level, free)', () => {
        const shopId = getCarrierShopIds()[0];
        const config = shopId ? getShopConfig(shopId) : undefined;
        if (!shopId || !config || !ShopUpgradeStorage.grantLevel(shopId, config)) {
            DebugOverlay.instance.toast('No carrier shop, or already maxed', true);
        }
    });
    carrier.button('Reset carrier level', () => getCarrierShopIds().forEach(shopId => ShopUpgradeStorage.resetShop(shopId)));
    carrier.button('Log carrier config', () => console.log('PlayerConfig.carrier =', JSON.stringify({
        models: initial.models,
        offset: { x: values.offsetX, y: values.offsetY, z: values.offsetZ },
        rotationDeg: { x: values.rotX, y: values.rotY, z: values.rotZ },
        scale: values.scale,
        stackMode: initial.stackMode,
        itemScale: initial.itemScale,
    })));
}

// ---- Reset

function buildResetPanel(host: PizzaDebugHost): void {
    const reset = panel('Reset', 'reset');
    // The same wipe + reload as the Settings popup's "Clear Data" (PlayerDataReset.ts).
    reset.button('Reset everything (reload)', () => clearAllPlayerData(), { variant: 'danger' });
    const one = reset.folder('Clear one save (no reload)');
    const clears: [string, () => unknown][] = [
        ['Backpack', () => BackpackStorage.clearAll()],
        ['Money', () => EconomyStorage.clearAll()],
        ['Global resources', () => GlobalResourceStorage.clearAll()],
        ['Buildings', () => BuildingStorage.clearAll()],
        ['Gates', () => GateStorage.clearAll()],
        ['Queues', () => QueueStorage.clearAll()],
        ['Shop upgrades', () => ShopUpgradeStorage.clearAll()],
        ['Crafting', () => host.resetCraftingProgress()],
        ['Dynamic resources', () => host.resetDynamicResources()],
        ['Shape resources', () => host.resetShapeResources()],
        ['Animal followers', () => AnimalFollowStorage.clearAll()],
        ['Player position', () => PlayerPositionStorage.clearAll()],
        ['Farms', () => FarmPlotStorage.clearAll()],
        ['Tutorial progress', () => TutorialProgressStorage.clearAll()],
        ['Triggers', () => TriggerStorage.clearAll()],
    ];
    for (const [label, clear] of clears) {
        one.button(label, () => void clear());
    }
}

// ---- Performance

function buildPerformancePanel(host: PizzaDebugHost): void {
    const performance = panel('Performance', 'performance');
    // meshCount = every mesh in the scene; drawCalls/triangles = what actually got drawn (after
    // frustum culling, which tests the UN-bent bounds) — comparing them spots wrong culling.
    const render = performance.folder('Render');
    render.monitor('Triangles', () => SetupThree.renderer.info.render.triangles);
    render.monitor('Draw calls', () => SetupThree.renderer.info.render.calls);
    render.monitor('Meshes', () => {
        let count = 0;
        host.threeScene.traverse(object => {
            if ((object as THREE.Mesh).isMesh) {
                count++;
            }
        });
        return count;
    });

    // Read fresh every frame (PerformanceConfig.ts) — camera far needs updateProjectionMatrix().
    const streaming = performance.folder('Streaming');
    streaming.slider(PERFORMANCE_CONFIG, 'cameraFar', 100, 3000, 10, 'Camera far').onChange(() => {
        host.threeCamera.far = PERFORMANCE_CONFIG.cameraFar;
        host.threeCamera.updateProjectionMatrix();
    });
    streaming.slider(PERFORMANCE_CONFIG, 'resourceLoadRadius', 5, 150, 1, 'Load radius');
    streaming.slider(PERFORMANCE_CONFIG, 'resourceUnloadRadius', 5, 160, 1, 'Unload radius');
    streaming.slider(PERFORMANCE_CONFIG, 'resourcePopInSec', 0, 1.5, 0.05, 'Pop in (s)');
    streaming.slider(PERFORMANCE_CONFIG, 'resourcePopOutSec', 0, 1.5, 0.05, 'Pop out (s)');

    // Fires the platform pause / resume signals (ad-break flow) on demand.
    const platform = { paused: false };
    performance.toggle(platform, 'paused', {
        label: 'Pause game (platform)',
        persist: false,
        onChange: paused => (paused ? PlatformHandler.instance.onPause.dispatch() : PlatformHandler.instance.onResume.dispatch()),
    });

    const dumps = performance.folder('Dumps', { collapsed: true });
    dumps.button('Bake game data (download)', () => downloadGameData());
    dumps.button('Dump scene meshes (download)', () => host.dumpSceneMeshes());
}

// ---- Tool stats

/** One folder per tool shop with the gather knobs a shop upgrade moves (ActionTypes.ts) — live readouts. */
function buildToolStatsPanel(): void {
    const stats = panel('Tool Stats', 'toolStats');
    for (const config of Object.values(SHOP_CONFIG_BY_ID)) {
        const action = config?.action;
        if (!config || action === undefined) {
            continue;
        }
        const provider = Object.values(PROVIDER_CONFIG).find(p => p.action === action);
        if (!provider) {
            continue;
        }
        const folder = stats.folder(config.tool.charAt(0).toUpperCase() + config.tool.slice(1));
        folder.monitor('Seconds per swing', () => ACTION_CONFIG[action].hitIntervalSec, { decimals: 2 });
        folder.monitor('Hits per swing', () => ACTION_CONFIG[action].hitScale, { decimals: 2 });
        folder.monitor('Yield per hit', () => provider.amountPerGather * ACTION_CONFIG[action].resourcePerHit, { decimals: 2 });
        folder.monitor('Hit angle (deg)', () => ACTION_CONFIG[action].hitAngleDeg);
        folder.monitor('Hit range (m)', () => ACTION_CONFIG[action].hitRangeMeters, { decimals: 2 });
    }
}
