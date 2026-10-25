import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { isModalOpen } from './shared.js';
import { openModelPicker, setModelCatalog, modelThumbUrl } from './modelPicker.js';
import { initWorldStyles, loadWorldStyles, renderWorldStyles, saveWorldStyles, hasUnsavedStyles, styleOf } from './worldStyles.js';
import { initUiTab, refreshUiTab, saveUiKit, hasUnsavedUiChanges } from './uikit.js';

// ---------------------------------------------------------------- state
let levels = [];
let level = null;
let dirty = false;
let tool = 'select';
let selection = null; // { type, index, sub? }
let pendingModel = null;
let wallDraft = [];
let hoverPoint = new THREE.Vector3();
let gameUrl = 'http://localhost:9001/';
let activeTab = 'level';
let drag = null;
let panning = null;
let spaceDown = false;

const $ = (id) => document.getElementById(id);
const round = (value) => Math.round(value * 1000) / 1000;
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------- three setup
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a3038);
scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(-6, 20, 8);
scene.add(sun);

const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 500);
camera.up.set(0, 0, -1);
const view = { cx: 0, cz: 0, height: 36 };

const staticGroup = new THREE.Group();
const objectGroup = new THREE.Group();
const overlayGroup = new THREE.Group();
scene.add(staticGroup, objectGroup, overlayGroup);

const loader = new GLTFLoader();
const modelCache = new Map();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function updateCamera() {
    const aspect = Math.max(0.1, viewport.clientWidth) / Math.max(1, viewport.clientHeight);
    camera.left = -view.height * aspect / 2;
    camera.right = view.height * aspect / 2;
    camera.top = view.height / 2;
    camera.bottom = -view.height / 2;
    camera.position.set(view.cx, 100, view.cz);
    camera.lookAt(view.cx, 0, view.cz);
    camera.updateProjectionMatrix();
}

function resize() {
    renderer.setSize(viewport.clientWidth, viewport.clientHeight);
    updateCamera();
}
window.addEventListener('resize', resize);

function frameLevel() {
    view.cx = 0;
    view.cz = 0;
    view.height = Math.max(level.floor.depth, level.floor.width * 0.7) + 14;
    updateCamera();
}

function loop() {
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- helpers
function snapValue(value) {
    if (!$('snap').checked) {
        return round(value);
    }
    const cell = level.grid.cell || 0.5;
    return round(Math.round(value / cell) * cell);
}

function worldPoint(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    raycaster.ray.intersectPlane(groundPlane, hit);
    return hit;
}

function markDirty() {
    dirty = true;
    const status = $('status');
    status.textContent = 'Unsaved changes';
    status.className = 'dirty';
}

function markClean(text = 'Saved') {
    dirty = false;
    const status = $('status');
    status.textContent = text;
    status.className = '';
}

function colorOf(hex) {
    return new THREE.Color(hex);
}

function mesh(geometry, color, y = 0, opacity = 1) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.8, transparent: opacity < 1, opacity });
    const result = new THREE.Mesh(geometry, material);
    result.position.y = y;
    return result;
}

function labelSprite(text, color = '#ffffff') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 64, 68);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
    sprite.scale.set(1.1, 1.1, 1);
    return sprite;
}

function clearGroup(group) {
    for (const child of [...group.children]) {
        group.remove(child);
        child.traverse((node) => {
            if (node.userData.sharedModel) {
                return;
            }
            node.geometry?.dispose?.();
            if (node.material && !node.userData.sharedMaterial) {
                (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => material.dispose?.());
            }
        });
    }
}

// ---------------------------------------------------------------- models
function loadModel(path) {
    if (!modelCache.has(path)) {
        modelCache.set(path, loader.loadAsync(`/models/${path}`).then((gltf) => gltf.scene));
    }
    return modelCache.get(path);
}

function markShared(root) {
    root.traverse((node) => {
        node.userData.sharedMaterial = true;
        if (node.isMesh) {
            node.userData.sharedModel = true;
        }
    });
}

/** Places a model the same way the game does: props are scaled to a target height, loot by a flat scale. */
async function fillHolder(holder, path, options) {
    try {
        const source = await loadModel(path);
        const object = source.clone(true);
        markShared(object);
        if (options.height !== undefined) {
            object.updateMatrixWorld(true);
            const size = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
            if (size.y > 1e-4) {
                object.scale.multiplyScalar(options.height / size.y);
            }
        } else {
            object.scale.setScalar(options.scale);
        }
        object.rotation.y = options.rotationY ?? 0;
        object.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(object);
        object.position.y = options.lift ?? -bounds.min.y;
        if (options.ghost) {
            object.traverse((node) => {
                if (node.isMesh) {
                    node.material = Array.isArray(node.material)
                        ? node.material.map((material) => Object.assign(material.clone(), { transparent: true, opacity: 0.55 }))
                        : Object.assign(node.material.clone(), { transparent: true, opacity: 0.55 });
                    node.userData.sharedMaterial = false;
                }
            });
        }
        holder.add(object);
        holder.userData.modelSize = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
        updateSelectionOverlay();
    } catch (error) {
        console.warn('Could not load model', path, error);
        const fallback = mesh(new THREE.BoxGeometry(1, 1, 1), 0xff5577, 0.5);
        holder.add(fallback);
    }
}

// ---------------------------------------------------------------- scene building
function rebuildStatic() {
    clearGroup(staticGroup);
    const { floor } = level;
    const floorStyle = styleOf('floor', level.styles?.floor);
    const wallStyle = styleOf('wall', level.styles?.wall);

    const ground = mesh(new THREE.PlaneGeometry(floor.width + 26, floor.depth + 22), styleOf('ground', level.styles?.ground).color, -0.03);
    ground.rotation.x = -Math.PI / 2;
    staticGroup.add(ground);

    if (level.entryPath) {
        const entry = mesh(new THREE.PlaneGeometry(level.entryPath.width, level.entryPath.depth), styleOf('path', level.styles?.path).color, -0.02);
        entry.rotation.x = -Math.PI / 2;
        entry.position.set(level.entryPath.x, -0.02, level.entryPath.z);
        staticGroup.add(entry);
    }

    const checker = document.createElement('canvas');
    checker.width = checker.height = 2;
    const ctx = checker.getContext('2d');
    ctx.fillStyle = floorStyle.colorA;
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = floorStyle.colorB;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillRect(1, 1, 1, 1);
    const texture = new THREE.CanvasTexture(checker);
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    const cell = floorStyle.checkerScale || 1.5;
    texture.repeat.set(floor.width / cell / 2, floor.depth / cell / 2);
    const floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(floor.width, floor.depth),
        new THREE.MeshBasicMaterial({ map: texture }),
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.01;
    staticGroup.add(floorMesh);

    const gridCell = level.grid.cell || 0.5;
    const half = { x: floor.width / 2 + 8, z: floor.depth / 2 + 8 };
    const points = [];
    for (let x = -Math.floor(half.x / gridCell) * gridCell; x <= half.x; x += gridCell) {
        points.push(x, 0.01, -half.z, x, 0.01, half.z);
    }
    for (let z = -Math.floor(half.z / gridCell) * gridCell; z <= half.z; z += gridCell) {
        points.push(-half.x, 0.01, z, half.x, 0.01, z);
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    staticGroup.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 })));

    level.walls.forEach((wall, wallIndex) => {
        const selected = selection && selection.index === wallIndex && (selection.type === 'wall' || selection.type === 'wallPoint');
        const segments = wall.points.length - (wall.closed ? 0 : 1);
        for (let i = 0; i < segments; i++) {
            const a = wall.points[i];
            const b = wall.points[(i + 1) % wall.points.length];
            const length = Math.hypot(b.x - a.x, b.z - a.z);
            const piece = mesh(new THREE.BoxGeometry(length + 0.35, 0.5, 0.35), selected ? 0xffd15c : wallStyle.bottomColor, 0.25);
            piece.position.x = (a.x + b.x) / 2;
            piece.position.z = (a.z + b.z) / 2;
            piece.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
            staticGroup.add(piece);
        }
        wall.points.forEach((point, pointIndex) => {
            const handle = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.8, 12), 0xffffff, 0.4);
            handle.position.x = point.x;
            handle.position.z = point.z;
            if (selection?.type === 'wallPoint' && selection.index === wallIndex && selection.sub === pointIndex) {
                handle.material.color.set(0xff5577);
            }
            staticGroup.add(handle);
        });
        wall.openings.forEach((opening, openingIndex) => {
            const width = opening.maxX - opening.minX;
            const depth = opening.maxZ - opening.minZ;
            const isSelected = selection?.type === 'opening' && selection.index === wallIndex && selection.sub === openingIndex;
            const color = isSelected ? 0xff5577 : opening.kind === 'door' ? 0xffb347 : opening.kind === 'gap' ? 0xb6f58a : 0x6cc6ff;
            const box = mesh(new THREE.BoxGeometry(Math.max(width, 0.4), 0.7, Math.max(depth, 0.4)), color, 0.4);
            box.position.x = (opening.minX + opening.maxX) / 2;
            box.position.z = (opening.minZ + opening.maxZ) / 2;
            staticGroup.add(box);
        });
    });

    const stops = [level.start, ...level.waypoints];
    const route = new THREE.BufferGeometry().setFromPoints(stops.map((point) => new THREE.Vector3(point.x, 0.06, point.z)));
    staticGroup.add(new THREE.Line(route, new THREE.LineDashedMaterial({ color: 0xffd889, dashSize: 0.4, gapSize: 0.3 })));
    staticGroup.children.at(-1).computeLineDistances();

    const startMarker = mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.12, 24), 0x52dda0, 0.06);
    startMarker.position.set(level.start.x, 0.06, level.start.z);
    staticGroup.add(startMarker);
    const startLabel = labelSprite('S', '#52dda0');
    startLabel.position.set(level.start.x, 1.2, level.start.z);
    staticGroup.add(startLabel);

    level.waypoints.forEach((point, index) => {
        const isExit = index === level.waypoints.length - 1;
        const marker = mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 24), isExit ? 0xff725e : 0xffd889, 0.06);
        marker.position.set(point.x, 0.06, point.z);
        staticGroup.add(marker);
        const label = labelSprite(String(index + 1), isExit ? '#ff725e' : '#ffd889');
        label.position.set(point.x, 1.2, point.z);
        staticGroup.add(label);
    });
    drawGuards();
    drawExtras();
    updateSelectionOverlay();
}

function guardHeading(guard) {
    if (guard.path.length > 1) {
        return Math.atan2(guard.path[1].x - guard.path[0].x, guard.path[1].z - guard.path[0].z);
    }
    return (guard.facing * Math.PI) / 180;
}

function drawGuards() {
    level.guards.forEach((guard, guardIndex) => {
        if (!guard.path.length) return;
        const selected = selection && (selection.type === 'guard' || selection.type === 'guardPoint') && selection.index === guardIndex;
        const color = selected ? 0xff9a9a : 0xff4040;
        if (guard.path.length > 1) {
            const points = guard.path.map((point) => new THREE.Vector3(point.x, 0.08, point.z));
            if (guard.loop) points.push(points[0].clone());
            staticGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })));
        }
        guard.path.forEach((point, pointIndex) => {
            const marker = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 14), pointIndex === 0 ? 0xff2020 : color, 0.15);
            marker.position.x = point.x;
            marker.position.z = point.z;
            if (selection?.type === 'guardPoint' && selection.index === guardIndex && selection.sub === pointIndex) {
                marker.material.color.set(0xffffff);
            }
            staticGroup.add(marker);
        });
        const heading = guardHeading(guard);
        const half = (guard.fov * Math.PI) / 360;
        const shape = [new THREE.Vector3(guard.path[0].x, 0.09, guard.path[0].z)];
        for (let i = 0; i <= 16; i++) {
            const angle = heading - half + (half * 2 * i) / 16;
            shape.push(new THREE.Vector3(guard.path[0].x + Math.sin(angle) * guard.range, 0.09, guard.path[0].z + Math.cos(angle) * guard.range));
        }
        const geometry = new THREE.BufferGeometry().setFromPoints(shape);
        const indices = [];
        for (let i = 1; i < shape.length - 1; i++) indices.push(0, i, i + 1);
        geometry.setIndex(indices);
        const cone = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
        staticGroup.add(cone);
        const label = labelSprite('G', '#ff6a6a');
        label.position.set(guard.path[0].x, 1.4, guard.path[0].z);
        staticGroup.add(label);
    });
}

const SQUAD_COLORS = { blue: 0x42a5f5, purple: 0xab47bc, orange: 0xffa726 };
const isSel = (type, index, sub) => selection?.type === type && selection.index === index && (sub === undefined || selection.sub === sub);

function addCone(x, z, heading, half, range, color, opacity = 0.3) {
    const shape = [new THREE.Vector3(x, 0.09, z)];
    for (let i = 0; i <= 16; i++) {
        const angle = heading - half + (half * 2 * i) / 16;
        shape.push(new THREE.Vector3(x + Math.sin(angle) * range, 0.09, z + Math.cos(angle) * range));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(shape);
    const indices = [];
    for (let i = 1; i < shape.length - 1; i++) indices.push(0, i, i + 1);
    geometry.setIndex(indices);
    staticGroup.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false })));
}

function addMarker(x, z, radius, color, text, sel) {
    const marker = mesh(new THREE.CylinderGeometry(radius, radius, 0.12, 24), sel ? 0xffffff : color, 0.06);
    marker.position.set(x, 0.06, z);
    staticGroup.add(marker);
    const label = labelSprite(text, '#' + color.toString(16).padStart(6, '0'));
    label.position.set(x, 1.2, z);
    staticGroup.add(label);
}

function drawExtras() {
    (level.squad ?? []).forEach((member, index) => {
        const color = SQUAD_COLORS[member.view] ?? 0xcccccc;
        const stops = [member.start, ...member.waypoints];
        const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(stops.map((p) => new THREE.Vector3(p.x, 0.07, p.z))),
            new THREE.LineDashedMaterial({ color, dashSize: 0.4, gapSize: 0.3 }),
        );
        line.computeLineDistances();
        staticGroup.add(line);
        addMarker(member.start.x, member.start.z, 0.8, color, 'S' + (index + 1), isSel('squadStart', index));
        member.waypoints.forEach((p, sub) => addMarker(p.x, p.z, 1.0, color, `${index + 1}.${sub + 1}`, isSel('squadPoint', index, sub)));
    });
    const goal = level.sharedGoal;
    if (goal) {
        const box = mesh(new THREE.BoxGeometry(goal.width, 0.1, goal.depth), isSel('goal', 0) ? 0xffffff : 0x6dff8a, 0.05, goal.enabled === false ? 0.12 : 0.35);
        box.position.set(goal.x, 0.05, goal.z);
        staticGroup.add(box);
        const label = labelSprite('SAFE', '#6dff8a');
        label.position.set(goal.x, 1.2, goal.z);
        staticGroup.add(label);
    }
    (level.cameras ?? []).forEach((camera, index) => {
        const sel = isSel('camera', index);
        const heading = (camera.facing * Math.PI) / 180;
        const half = (camera.fov * Math.PI) / 360;
        addCone(camera.x, camera.z, heading, half, camera.range, 0x7fd8ff, 0.3);
        if (camera.sweep > 0) {
            const sweep = (camera.sweep * Math.PI) / 180;
            for (const sign of [-1, 1]) {
                const a = heading + sign * sweep;
                staticGroup.add(new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(camera.x, 0.1, camera.z), new THREE.Vector3(camera.x + Math.sin(a) * camera.range, 0.1, camera.z + Math.cos(a) * camera.range)]),
                    new THREE.LineBasicMaterial({ color: 0x7fd8ff }),
                ));
            }
        }
        const body = mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), sel ? 0xffffff : 0x2c333b, 0.4);
        body.position.x = camera.x;
        body.position.z = camera.z;
        staticGroup.add(body);
        const label = labelSprite('CAM', '#7fd8ff');
        label.position.set(camera.x, 1.5, camera.z);
        staticGroup.add(label);
    });
    (level.traps ?? []).forEach((trap, index) => {
        const box = mesh(new THREE.BoxGeometry(trap.width, 0.2, trap.depth), isSel('trap', index) ? 0xffffff : 0xd04040, 0.1, 0.8);
        box.position.set(trap.x, 0.1, trap.z);
        staticGroup.add(box);
        const label = labelSprite(`SPIKES ${trap.active}/${trap.period}s`, '#ff8080');
        label.position.set(trap.x, 1.2, trap.z);
        staticGroup.add(label);
    });
    (level.drones ?? []).forEach((drone, index) => {
        if (!drone.path.length) return;
        if (drone.path.length > 1) {
            staticGroup.add(new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(drone.path.map((p) => new THREE.Vector3(p.x, 0.08, p.z))),
                new THREE.LineBasicMaterial({ color: 0xffe066 }),
            ));
        }
        drone.path.forEach((p, sub) => {
            const marker = mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.3, 14), isSel('dronePoint', index, sub) ? 0xffffff : 0xffe066, 0.15);
            marker.position.set(p.x, 0.15, p.z);
            staticGroup.add(marker);
        });
        const disc = mesh(new THREE.CylinderGeometry(drone.radius, drone.radius, 0.05, 32), 0xffe066, 0.04, 0.25);
        disc.position.set(drone.path[0].x, 0.04, drone.path[0].z);
        staticGroup.add(disc);
        const label = labelSprite('DRONE', '#ffe066');
        label.position.set(drone.path[0].x, 1.6, drone.path[0].z);
        staticGroup.add(label);
    });
}

const holders = { prop: [], loot: [] };

function rebuildObjects() {
    clearGroup(objectGroup);
    holders.prop = [];
    holders.loot = [];
    level.props.forEach((prop, index) => {
        const holder = new THREE.Group();
        holder.position.set(prop.x, 0, prop.z);
        objectGroup.add(holder);
        holders.prop[index] = holder;
        void fillHolder(holder, prop.model, { height: prop.height, rotationY: prop.rotationY, ghost: prop.revealAt > 0 });
    });
    level.loot.forEach((loot, index) => {
        const holder = new THREE.Group();
        holder.position.set(loot.x, 0, loot.z);
        const ring = mesh(new THREE.TorusGeometry(0.7, 0.07, 6, 24), 0xffd15c, 0.05);
        ring.rotation.x = Math.PI / 2;
        holder.add(ring);
        objectGroup.add(holder);
        holders.loot[index] = holder;
        void fillHolder(holder, loot.model, { scale: loot.scale, lift: 0.1, ghost: loot.revealAt > 0 });
    });
    updateSelectionOverlay();
}

function holderBox(type, index) {
    const holder = holders[type][index];
    const box = new THREE.Box3().setFromObject(holder);
    if (box.isEmpty()) {
        const p = holder.position;
        return new THREE.Box3(new THREE.Vector3(p.x - 0.6, 0, p.z - 0.6), new THREE.Vector3(p.x + 0.6, 1, p.z + 0.6));
    }
    return box;
}

function updateSelectionOverlay() {
    clearGroup(overlayGroup);
    if (wallDraft.length) {
        const points = [...wallDraft, { x: hoverPoint.x, z: hoverPoint.z }].map((point) => new THREE.Vector3(point.x, 0.7, point.z));
        overlayGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0xffd15c })));
        wallDraft.forEach((point) => {
            const dot = mesh(new THREE.SphereGeometry(0.3), 0xffd15c, 0.7);
            dot.position.x = point.x;
            dot.position.z = point.z;
            overlayGroup.add(dot);
        });
    }
    if (!selection) {
        return;
    }
    if (selection.type === 'prop' || selection.type === 'loot') {
        if (!holders[selection.type][selection.index]) {
            return;
        }
        const box = holderBox(selection.type, selection.index);
        box.max.y = Math.max(box.max.y, 0.5);
        overlayGroup.add(new THREE.Box3Helper(box, 0xff5577));
    } else if (selection.type === 'start' || selection.type === 'waypoint') {
        const point = selection.type === 'start' ? level.start : level.waypoints[selection.index];
        if (point) {
            const ring = mesh(new THREE.TorusGeometry(1.3, 0.08, 6, 32), 0xff5577, 0.2);
            ring.rotation.x = Math.PI / 2;
            ring.position.x = point.x;
            ring.position.z = point.z;
            overlayGroup.add(ring);
        }
    }
}

function rebuildAll() {
    rebuildStatic();
    rebuildObjects();
}

// ---------------------------------------------------------------- picking
function nearestWallSegment(point, maxDistance) {
    let best = null;
    level.walls.forEach((wall, wallIndex) => {
        const count = wall.points.length - (wall.closed ? 0 : 1);
        for (let i = 0; i < count; i++) {
            const a = wall.points[i];
            const b = wall.points[(i + 1) % wall.points.length];
            const dx = b.x - a.x;
            const dz = b.z - a.z;
            const lengthSq = dx * dx + dz * dz || 1;
            const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq));
            const px = a.x + dx * t;
            const pz = a.z + dz * t;
            const distance = Math.hypot(point.x - px, point.z - pz);
            if (distance <= maxDistance && (!best || distance < best.distance)) {
                best = { wallIndex, segment: i, distance, px, pz, a, b };
            }
        }
    });
    return best;
}

function pick(point) {
    const zoomScale = view.height / 36;
    const handleRadius = 0.6 * Math.max(0.6, zoomScale);
    for (let w = 0; w < level.walls.length; w++) {
        for (let p = 0; p < level.walls[w].points.length; p++) {
            const wallPoint = level.walls[w].points[p];
            if (Math.hypot(wallPoint.x - point.x, wallPoint.z - point.z) < handleRadius) {
                return { type: 'wallPoint', index: w, sub: p };
            }
        }
    }
    for (let w = 0; w < level.walls.length; w++) {
        for (let o = 0; o < level.walls[w].openings.length; o++) {
            const op = level.walls[w].openings[o];
            if (point.x >= op.minX - 0.2 && point.x <= op.maxX + 0.2 && point.z >= op.minZ - 0.2 && point.z <= op.maxZ + 0.2) {
                return { type: 'opening', index: w, sub: o };
            }
        }
    }
    for (let g = level.guards.length - 1; g >= 0; g--) {
        for (let p = 0; p < level.guards[g].path.length; p++) {
            const guardPoint = level.guards[g].path[p];
            if (Math.hypot(guardPoint.x - point.x, guardPoint.z - point.z) < 0.8) {
                return { type: 'guardPoint', index: g, sub: p };
            }
        }
    }
    for (let i = (level.drones ?? []).length - 1; i >= 0; i--) {
        for (let p = 0; p < level.drones[i].path.length; p++) {
            const d = level.drones[i].path[p];
            if (Math.hypot(d.x - point.x, d.z - point.z) < 0.8) return { type: 'dronePoint', index: i, sub: p };
        }
    }
    for (let i = (level.cameras ?? []).length - 1; i >= 0; i--) {
        if (Math.hypot(level.cameras[i].x - point.x, level.cameras[i].z - point.z) < 0.9) return { type: 'camera', index: i };
    }
    for (let i = (level.squad ?? []).length - 1; i >= 0; i--) {
        const member = level.squad[i];
        for (let p = 0; p < member.waypoints.length; p++) {
            if (Math.hypot(member.waypoints[p].x - point.x, member.waypoints[p].z - point.z) < 1.1) return { type: 'squadPoint', index: i, sub: p };
        }
        if (Math.hypot(member.start.x - point.x, member.start.z - point.z) < 0.9) return { type: 'squadStart', index: i };
    }
    for (let i = (level.traps ?? []).length - 1; i >= 0; i--) {
        const t = level.traps[i];
        if (Math.abs(t.x - point.x) <= t.width / 2 && Math.abs(t.z - point.z) <= t.depth / 2) return { type: 'trap', index: i };
    }
    for (let i = level.waypoints.length - 1; i >= 0; i--) {
        if (Math.hypot(level.waypoints[i].x - point.x, level.waypoints[i].z - point.z) < 1.2) {
            return { type: 'waypoint', index: i };
        }
    }
    if (Math.hypot(level.start.x - point.x, level.start.z - point.z) < 1.0) {
        return { type: 'start', index: 0 };
    }
    for (const type of ['loot', 'prop']) {
        for (let i = level[type === 'prop' ? 'props' : 'loot'].length - 1; i >= 0; i--) {
            if (!holders[type][i]) {
                continue;
            }
            const box = holderBox(type, i);
            if (point.x >= box.min.x && point.x <= box.max.x && point.z >= box.min.z && point.z <= box.max.z) {
                return { type, index: i };
            }
        }
    }
    const goal = level.sharedGoal;
    if (goal && Math.abs(goal.x - point.x) <= goal.width / 2 && Math.abs(goal.z - point.z) <= goal.depth / 2) {
        return { type: 'goal', index: 0 };
    }
    const segment = nearestWallSegment(point, 0.5);
    return segment ? { type: 'wall', index: segment.wallIndex } : null;
}

// ---------------------------------------------------------------- selection helpers
function entityPosition(sel) {
    switch (sel.type) {
        case 'prop': return level.props[sel.index];
        case 'loot': return level.loot[sel.index];
        case 'start': return level.start;
        case 'waypoint': return level.waypoints[sel.index];
        case 'wallPoint': return level.walls[sel.index].points[sel.sub];
        case 'guardPoint': return level.guards[sel.index].path[sel.sub];
        case 'squadStart': return level.squad[sel.index].start;
        case 'squadPoint': return level.squad[sel.index].waypoints[sel.sub];
        case 'goal': return level.sharedGoal;
        case 'camera': return level.cameras[sel.index];
        case 'trap': return level.traps[sel.index];
        case 'dronePoint': return level.drones[sel.index].path[sel.sub];
        default: return null;
    }
}

function select(sel) {
    selection = sel;
    rebuildStatic();
    renderInspector();
}

function moveEntity(sel, x, z) {
    if (sel.type === 'opening') {
        const op = level.walls[sel.index].openings[sel.sub];
        const dx = x - (op.minX + op.maxX) / 2;
        const dz = z - (op.minZ + op.maxZ) / 2;
        op.minX = round(op.minX + dx);
        op.maxX = round(op.maxX + dx);
        op.minZ = round(op.minZ + dz);
        op.maxZ = round(op.maxZ + dz);
        return;
    }
    const target = entityPosition(sel);
    if (target) {
        target.x = x;
        target.z = z;
    }
}

function deleteSelection() {
    if (!selection) {
        return;
    }
    const { type, index, sub } = selection;
    if (type === 'prop') level.props.splice(index, 1);
    else if (type === 'loot') level.loot.splice(index, 1);
    else if (type === 'waypoint') {
        if (level.waypoints.length <= 1) {
            return setHint('A level needs at least one checkpoint (the exit).');
        }
        level.waypoints.splice(index, 1);
    } else if (type === 'wall') level.walls.splice(index, 1);
    else if (type === 'wallPoint') {
        if (level.walls[index].points.length <= 2) {
            level.walls.splice(index, 1);
        } else {
            level.walls[index].points.splice(sub, 1);
        }
    } else if (type === 'opening') level.walls[index].openings.splice(sub, 1);
    else if (type === 'guardPoint') {
        const guard = level.guards[index];
        guard.path.splice(sub, 1);
        if (guard.path.length === 0) level.guards.splice(index, 1);
    } else if (type === 'camera') level.cameras.splice(index, 1);
    else if (type === 'trap') level.traps.splice(index, 1);
    else if (type === 'goal') delete level.sharedGoal;
    else if (type === 'dronePoint') {
        const drone = level.drones[index];
        drone.path.splice(sub, 1);
        if (drone.path.length === 0) level.drones.splice(index, 1);
    } else if (type === 'squadPoint') {
        const member = level.squad[index];
        if (member.waypoints.length <= 1) return setHint('A squad member needs at least one goal.');
        member.waypoints.splice(sub, 1);
    } else return;
    selection = null;
    markDirty();
    rebuildAll();
    renderInspector();
}

// ---------------------------------------------------------------- tools
function setTool(next) {
    tool = next;
    wallDraft = [];
    document.querySelectorAll('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === next));
    const addSelect = $('addTool');
    addSelect.value = [...addSelect.options].some((option) => option.value === next) ? next : '';
    addSelect.classList.toggle('active', Boolean(addSelect.value));
    const hints = {
        select: 'Click to select, drag to move. Pick a model on the left to drop it.',
        wall: 'Click to add wall points. Enter or double-click finishes; Esc cancels.',
        door: 'Click on a wall to place a door.',
        window: 'Click on a wall to place a window.',
        start: 'Click to set the player start.',
        waypoint: 'Click to add a checkpoint (the last one is the exit).',
        camera: 'Click to place a security camera.',
        trap: 'Click to place a spike trap.',
        drone: 'Click to lay out a drone route (2+ points). Enter or double-click finishes.',
        guard: 'Click to lay out a guard patrol. Enter or double-click finishes (one point = stationary guard).',
    };
    setHint(hints[next]);
    updateSelectionOverlay();
}

function setHint(text) {
    $('hint').textContent = text;
}

function finishWall() {
    if (tool === 'drone') {
        if (wallDraft.length >= 2) {
            (level.drones ??= []).push({ path: wallDraft.map((p) => ({ x: p.x, z: p.z })), speed: 2, radius: 1.8 });
            markDirty();
            selection = { type: 'dronePoint', index: level.drones.length - 1, sub: 0 };
            renderInspector();
        }
        wallDraft = [];
        rebuildStatic();
        return;
    }
    if (tool === 'guard') {
        if (wallDraft.length >= 1) {
            level.guards.push({
                path: wallDraft.map((point) => ({ x: point.x, z: point.z })),
                loop: false, speed: 1.6, pause: 1, fov: 60, range: 6, sweep: wallDraft.length === 1 ? 35 : 0, facing: 180,
            });
            markDirty();
            selection = { type: 'guardPoint', index: level.guards.length - 1, sub: 0 };
            renderInspector();
        }
        wallDraft = [];
        rebuildStatic();
        return;
    }
    if (wallDraft.length >= 2) {
        level.walls.push({ closed: false, points: wallDraft.map((point) => ({ x: point.x, z: point.z })), openings: [] });
        markDirty();
        selection = { type: 'wall', index: level.walls.length - 1 };
        renderInspector();
    }
    wallDraft = [];
    rebuildStatic();
}

function placeOpening(point, kind) {
    const hit = nearestWallSegment(point, 1.5);
    if (!hit) {
        return setHint('Click closer to a wall.');
    }
    const alongX = Math.abs(hit.b.x - hit.a.x) >= Math.abs(hit.b.z - hit.a.z);
    const length = kind === 'door' ? 2.5 : 3;
    const cx = alongX ? snapValue(hit.px) : hit.px;
    const cz = alongX ? hit.pz : snapValue(hit.pz);
    const wall = level.walls[hit.wallIndex];
    wall.openings.push(alongX
        ? { kind, minX: round(cx - length / 2), maxX: round(cx + length / 2), minZ: round(cz - 0.3), maxZ: round(cz + 0.3) }
        : { kind, minX: round(cx - 0.3), maxX: round(cx + 0.3), minZ: round(cz - length / 2), maxZ: round(cz + length / 2) });
    markDirty();
    selection = { type: 'opening', index: hit.wallIndex, sub: wall.openings.length - 1 };
    rebuildStatic();
    renderInspector();
}

async function dropModel(point) {
    const asLoot = $('dropAs').value === 'loot' || ($('dropAs').value === 'auto' && pendingModel.startsWith('resources/'));
    const x = snapValue(point.x);
    const z = snapValue(point.z);
    if (asLoot) {
        level.loot.push({ model: pendingModel, x, z, amount: 25, scale: 1.35, revealAt: 0 });
        selection = { type: 'loot', index: level.loot.length - 1 };
    } else {
        let height = 2;
        try {
            const size = new THREE.Box3().setFromObject(await loadModel(pendingModel)).getSize(new THREE.Vector3());
            height = Math.max(0.1, Math.round(size.y * 20) / 20);
        } catch { /* keep default */ }
        level.props.push({ model: pendingModel, x, z, rotationY: 0, height, collider: null, revealAt: 0 });
        selection = { type: 'prop', index: level.props.length - 1 };
    }
    markDirty();
    rebuildObjects();
    rebuildStatic();
    renderInspector();
}

// ---------------------------------------------------------------- pointer input
const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 1 || event.button === 2 || (event.button === 0 && spaceDown)) {
        panning = { x: event.clientX, y: event.clientY, cx: view.cx, cz: view.cz };
        return;
    }
    if (event.button !== 0) {
        return;
    }
    const raw = worldPoint(event);
    const point = new THREE.Vector3(snapValue(raw.x), 0, snapValue(raw.z));

    if (pendingModel) {
        void dropModel(raw);
        return;
    }
    if (tool === 'camera') {
        (level.cameras ??= []).push({ x: point.x, z: point.z, facing: 180, sweep: 40, period: 6, fov: 50, range: 9 });
        selection = { type: 'camera', index: level.cameras.length - 1 };
        markDirty();
        rebuildStatic();
        return renderInspector();
    }
    if (tool === 'trap') {
        (level.traps ??= []).push({ x: point.x, z: point.z, width: 6, depth: 2, period: 3, active: 1.2, offset: 0 });
        selection = { type: 'trap', index: level.traps.length - 1 };
        markDirty();
        rebuildStatic();
        return renderInspector();
    }
    if (tool === 'wall' || tool === 'guard' || tool === 'drone') {
        if (event.detail >= 2) {
            return finishWall();
        }
        wallDraft.push({ x: point.x, z: point.z });
        updateSelectionOverlay();
        return;
    }
    if (tool === 'door' || tool === 'window') {
        return placeOpening(raw, tool);
    }
    if (tool === 'start') {
        level.start = { x: point.x, z: point.z };
        markDirty();
        rebuildStatic();
        return renderInspector();
    }
    if (tool === 'waypoint') {
        level.waypoints.push({ x: point.x, z: point.z });
        selection = { type: 'waypoint', index: level.waypoints.length - 1 };
        markDirty();
        rebuildStatic();
        return renderInspector();
    }

    const hit = pick(raw);
    select(hit);
    if (hit && hit.type !== 'wall') {
        let origin;
        if (hit.type === 'opening') {
            const op = level.walls[hit.index].openings[hit.sub];
            origin = { x: (op.minX + op.maxX) / 2, z: (op.minZ + op.maxZ) / 2 };
        } else {
            origin = clone(entityPosition(hit));
        }
        drag = { hit, grabX: raw.x - origin.x, grabZ: raw.z - origin.z, moved: false };
    }
});

canvas.addEventListener('pointermove', (event) => {
    if (panning) {
        const scale = view.height / canvas.clientHeight;
        view.cx = panning.cx - (event.clientX - panning.x) * scale;
        view.cz = panning.cz - (event.clientY - panning.y) * scale;
        updateCamera();
        return;
    }
    const raw = worldPoint(event);
    hoverPoint.set(snapValue(raw.x), 0, snapValue(raw.z));
    $('status').dataset.cursor = '';
    if (wallDraft.length) {
        updateSelectionOverlay();
    }
    if (drag) {
        const x = snapValue(raw.x - drag.grabX);
        const z = snapValue(raw.z - drag.grabZ);
        moveEntity(drag.hit, x, z);
        drag.moved = true;
        const { type, index } = drag.hit;
        if (type === 'prop' || type === 'loot') {
            holders[type][index].position.set(x, 0, z);
            updateSelectionOverlay();
        } else {
            rebuildStatic();
        }
        markDirty();
    }
});

canvas.addEventListener('pointerup', () => {
    if (drag?.moved) {
        renderInspector();
    }
    drag = null;
    panning = null;
});

canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const before = worldPoint(event);
    view.height = Math.min(120, Math.max(6, view.height * (event.deltaY > 0 ? 1.1 : 0.9)));
    updateCamera();
    const after = worldPoint(event);
    view.cx += before.x - after.x;
    view.cz += before.z - after.z;
    updateCamera();
}, { passive: false });

window.addEventListener('keydown', (event) => {
    if (isModalOpen()) return;
    if (activeTab !== 'level') {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
            event.preventDefault();
            void saveUiKit();
        }
        return;
    }
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName);
    if (event.code === 'Space' && !typing) {
        spaceDown = true;
        event.preventDefault();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveLevel();
        return;
    }
    if (typing) {
        return;
    }
    if (event.key === 'Escape') {
        pendingModel = null;
        wallDraft = [];
        renderModelList();
        setTool('select');
    } else if (event.key === 'Enter' && (tool === 'wall' || tool === 'guard' || tool === 'drone')) {
        finishWall();
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
        deleteSelection();
    } else if (event.key.toLowerCase() === 'r' && selection?.type === 'prop') {
        const prop = level.props[selection.index];
        prop.rotationY = round((prop.rotationY + Math.PI / 2) % (Math.PI * 2));
        markDirty();
        rebuildObjects();
        renderInspector();
    } else if (event.key.startsWith('Arrow') && selection) {
        event.preventDefault();
        const step = level.grid.cell || 0.5;
        const target = selection.type === 'opening' ? null : entityPosition(selection);
        if (target) {
            target.x = round(target.x + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0));
            target.z = round(target.z + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0));
            markDirty();
            rebuildAll();
            renderInspector();
        }
    }
});
window.addEventListener('keyup', (event) => {
    if (event.code === 'Space') {
        spaceDown = false;
    }
});
window.addEventListener('beforeunload', (event) => {
    if (dirty || hasUnsavedUiChanges() || hasUnsavedStyles()) {
        event.preventDefault();
    }
});

// ---------------------------------------------------------------- inspector
function field(label, value, onChange, options = {}) {
    const row = document.createElement('div');
    row.className = 'field';
    const text = document.createElement('span');
    text.textContent = label;
    let input;
    if (options.type === 'checkbox') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = Boolean(value);
        input.addEventListener('change', () => onChange(input.checked));
    } else if (options.choices) {
        input = document.createElement('select');
        options.choices.forEach((choice) => input.add(new Option(choice, choice, false, choice === value)));
        input.addEventListener('change', () => onChange(input.value));
    } else {
        input = document.createElement('input');
        input.type = options.type ?? 'number';
        input.value = value;
        if (options.step) input.step = options.step;
        if (options.min !== undefined) input.min = options.min;
        input.addEventListener('change', () => onChange(input.type === 'number' ? Number(input.value) : input.value));
    }
    row.append(text, input);
    return row;
}

function button(label, onClick, className = '') {
    const element = document.createElement('button');
    element.textContent = label;
    element.className = className;
    element.addEventListener('click', onClick);
    return element;
}

function renderInspector() {
    const panel = $('inspector');
    panel.replaceChildren();
    if (!selection) {
        panel.innerHTML = '<p class="muted">Nothing selected.</p>';
        return;
    }
    const { type, index, sub } = selection;
    const change = (apply, objects = false) => (value) => {
        apply(value);
        markDirty();
        objects ? rebuildObjects() : rebuildStatic();
        if (objects) rebuildStatic();
        renderInspector();
    };
    const title = document.createElement('div');
    title.className = 'muted';
    panel.append(title);

    if (type === 'prop' || type === 'loot') {
        const item = type === 'prop' ? level.props[index] : level.loot[index];
        if (!item) return;
        title.textContent = `${type.toUpperCase()} · ${item.model}`;
        panel.append(
            button('Change model…', () => openModelPicker({
                current: item.model,
                title: 'Replace model',
                confirmLabel: 'Use model',
                onPick: (path) => {
                    item.model = path;
                    markDirty();
                    rebuildAll();
                    renderInspector();
                },
            })),
            field('X', item.x, change((v) => (item.x = v), true), { step: 0.25 }),
            field('Z', item.z, change((v) => (item.z = v), true), { step: 0.25 }),
        );
        if (type === 'prop') {
            panel.append(
                field('Rotation °', Math.round(item.rotationY * 180 / Math.PI), change((v) => (item.rotationY = round(v * Math.PI / 180)), true), { step: 15 }),
                field('Height', item.height, change((v) => (item.height = Math.max(0.1, v)), true), { step: 0.1 }),
                field('Collider', Boolean(item.collider), change((v) => (item.collider = v ? autoCollider(index) : null), true), { type: 'checkbox' }),
            );
            if (item.collider) {
                ['halfX', 'halfY', 'halfZ'].forEach((key) => panel.append(
                    field(key, item.collider[key], change((v) => (item.collider[key] = Math.max(0.05, v))), { step: 0.05 }),
                ));
                panel.append(button('Fit collider to model', () => {
                    item.collider = autoCollider(index);
                    markDirty();
                    renderInspector();
                }));
            }
        } else {
            panel.append(
                field('Money', item.amount, change((v) => (item.amount = Math.max(0, v))), { step: 5 }),
                field('Scale', item.scale, change((v) => (item.scale = Math.max(0.1, v)), true), { step: 0.05 }),
            );
        }
        panel.append(field('Reveal at', item.revealAt, change((v) => (item.revealAt = Math.max(0, Math.round(v))), true), { step: 1, min: 0 }));
        panel.append(button('Duplicate', () => {
            const copy = { ...clone(item), x: round(item.x + 1), z: round(item.z + 1) };
            (type === 'prop' ? level.props : level.loot).push(copy);
            selection = { type, index: (type === 'prop' ? level.props : level.loot).length - 1 };
            markDirty();
            rebuildObjects();
            renderInspector();
        }));
    } else if (type === 'start' || type === 'waypoint') {
        const point = entityPosition(selection);
        title.textContent = type === 'start' ? 'PLAYER START' : `CHECKPOINT ${index + 1}${index === level.waypoints.length - 1 ? ' (exit)' : ''}`;
        panel.append(
            field('X', point.x, change((v) => (point.x = v)), { step: 0.25 }),
            field('Z', point.z, change((v) => (point.z = v)), { step: 0.25 }),
        );
        if (type === 'waypoint') {
            panel.append(
                button('Earlier', () => swapWaypoint(index, index - 1)),
                button('Later', () => swapWaypoint(index, index + 1)),
            );
        }
    } else if (type === 'guardPoint') {
        const guard = level.guards[index];
        const point = guard.path[sub];
        title.textContent = `GUARD ${index + 1} · POINT ${sub + 1}/${guard.path.length}`;
        panel.append(
            field('X', point.x, change((v) => (point.x = v)), { step: 0.25 }),
            field('Z', point.z, change((v) => (point.z = v)), { step: 0.25 }),
            field('Speed', guard.speed, change((v) => (guard.speed = Math.max(0.2, v))), { step: 0.1 }),
            field('Pause (s)', guard.pause, change((v) => (guard.pause = Math.max(0, v))), { step: 0.25 }),
            field('Cone angle °', guard.fov, change((v) => (guard.fov = Math.min(170, Math.max(10, v)))), { step: 5 }),
            field('Cone range', guard.range, change((v) => (guard.range = Math.max(1, v))), { step: 0.5 }),
            field('Look sweep °', guard.sweep, change((v) => (guard.sweep = Math.max(0, v))), { step: 5 }),
            field('Facing ° (single point)', guard.facing, change((v) => (guard.facing = v)), { step: 15 }),
            field('Loop circuit', guard.loop, change((v) => (guard.loop = v)), { type: 'checkbox' }),
            button('Add point after this', () => {
                guard.path.splice(sub + 1, 0, { x: round(point.x + 1), z: point.z });
                selection = { type: 'guardPoint', index, sub: sub + 1 };
                markDirty();
                rebuildStatic();
                renderInspector();
            }),
        );
    } else if (type === 'squadStart' || type === 'squadPoint') {
        const member = level.squad[index];
        const point = entityPosition(selection);
        title.textContent = type === 'squadStart' ? `SQUAD ${index + 1} (${member.view}) · START` : `SQUAD ${index + 1} (${member.view}) · GOAL ${sub + 1}/${member.waypoints.length}`;
        panel.append(
            field('X', point.x, change((v) => (point.x = v)), { step: 0.25 }),
            field('Z', point.z, change((v) => (point.z = v)), { step: 0.25 }),
            field('Character', member.view, change((v) => (member.view = v)), { choices: ['blue', 'purple', 'orange'] }),
        );
    } else if (type === 'goal') {
        const goal = level.sharedGoal;
        title.textContent = 'SHARED SAFE ROOM';
        panel.append(
            field('X', goal.x, change((v) => (goal.x = v)), { step: 0.25 }),
            field('Z', goal.z, change((v) => (goal.z = v)), { step: 0.25 }),
            field('Width', goal.width, change((v) => (goal.width = Math.max(1, v))), { step: 0.5 }),
            field('Depth', goal.depth, change((v) => (goal.depth = Math.max(1, v))), { step: 0.5 }),
            field('Everyone must reach it', goal.enabled !== false, change((v) => (goal.enabled = v)), { type: 'checkbox' }),
        );
    } else if (type === 'camera') {
        const camera = level.cameras[index];
        title.textContent = `SECURITY CAMERA ${index + 1}`;
        panel.append(
            field('X', camera.x, change((v) => (camera.x = v)), { step: 0.25 }),
            field('Z', camera.z, change((v) => (camera.z = v)), { step: 0.25 }),
            field('Facing °', camera.facing, change((v) => (camera.facing = v)), { step: 15 }),
            field('Sweep ±°', camera.sweep, change((v) => (camera.sweep = Math.max(0, v))), { step: 5 }),
            field('Period (s)', camera.period, change((v) => (camera.period = Math.max(0.5, v))), { step: 0.5 }),
            field('Cone angle °', camera.fov, change((v) => (camera.fov = Math.min(170, Math.max(10, v)))), { step: 5 }),
            field('Cone range', camera.range, change((v) => (camera.range = Math.max(1, v))), { step: 0.5 }),
        );
    } else if (type === 'trap') {
        const trap = level.traps[index];
        title.textContent = `SPIKE TRAP ${index + 1}`;
        panel.append(
            field('X', trap.x, change((v) => (trap.x = v)), { step: 0.25 }),
            field('Z', trap.z, change((v) => (trap.z = v)), { step: 0.25 }),
            field('Width', trap.width, change((v) => (trap.width = Math.max(0.5, v))), { step: 0.5 }),
            field('Depth', trap.depth, change((v) => (trap.depth = Math.max(0.5, v))), { step: 0.5 }),
            field('Cycle (s)', trap.period, change((v) => (trap.period = Math.max(1, v))), { step: 0.2 }),
            field('Spikes up (s)', trap.active, change((v) => (trap.active = Math.max(0.2, v))), { step: 0.2 }),
            field('Time offset (s)', trap.offset, change((v) => (trap.offset = v)), { step: 0.25 }),
        );
    } else if (type === 'dronePoint') {
        const drone = level.drones[index];
        const point = drone.path[sub];
        title.textContent = `DRONE ${index + 1} · POINT ${sub + 1}/${drone.path.length}`;
        panel.append(
            field('X', point.x, change((v) => (point.x = v)), { step: 0.25 }),
            field('Z', point.z, change((v) => (point.z = v)), { step: 0.25 }),
            field('Speed', drone.speed, change((v) => (drone.speed = Math.max(0.2, v))), { step: 0.1 }),
            field('Light radius', drone.radius, change((v) => (drone.radius = Math.max(0.5, v))), { step: 0.2 }),
            button('Add point after this', () => {
                drone.path.splice(sub + 1, 0, { x: round(point.x + 1), z: point.z });
                selection = { type: 'dronePoint', index, sub: sub + 1 };
                markDirty();
                rebuildStatic();
                renderInspector();
            }),
        );
    } else if (type === 'wall' || type === 'wallPoint') {
        const wall = level.walls[index];
        title.textContent = type === 'wall' ? `WALL ${index + 1}` : `WALL ${index + 1} · POINT ${sub + 1}`;
        if (type === 'wallPoint') {
            const point = wall.points[sub];
            panel.append(
                field('X', point.x, change((v) => (point.x = v)), { step: 0.25 }),
                field('Z', point.z, change((v) => (point.z = v)), { step: 0.25 }),
            );
        }
        panel.append(field('Closed loop', wall.closed, change((v) => (wall.closed = v)), { type: 'checkbox' }));
    } else if (type === 'opening') {
        const opening = level.walls[index].openings[sub];
        title.textContent = `${opening.kind.toUpperCase()} (wall ${index + 1})`;
        panel.append(field('Kind', opening.kind, change((v) => (opening.kind = v)), { choices: ['door', 'window', 'gap'] }));
        ['minX', 'maxX', 'minZ', 'maxZ'].forEach((key) => panel.append(
            field(key, opening[key], change((v) => (opening[key] = v)), { step: 0.25 }),
        ));
    }
    panel.append(button('Delete', deleteSelection, 'danger'));
}

function autoCollider(index) {
    const prop = level.props[index];
    const size = holders.prop[index]?.userData.modelSize;
    if (!size) {
        return { halfX: 0.6, halfY: Math.max(0.3, prop.height / 2), halfZ: 0.6 };
    }
    return { halfX: round(size.x / 2), halfY: round(size.y / 2), halfZ: round(size.z / 2) };
}

function swapWaypoint(from, to) {
    if (to < 0 || to >= level.waypoints.length) {
        return;
    }
    [level.waypoints[from], level.waypoints[to]] = [level.waypoints[to], level.waypoints[from]];
    selection = { type: 'waypoint', index: to };
    markDirty();
    rebuildStatic();
    renderInspector();
}

// ---------------------------------------------------------------- level list / settings
let worlds = [];

const worldOf = (id) => worlds.find((world) => world.levels.includes(id));

function renderLevelList() {
    const list = $('levelList');
    const scroll = list.scrollTop;
    list.replaceChildren();
    const byId = new Map(levels.map((entry) => [entry.id, entry]));
    const addItem = (entry, number) => {
        const item = document.createElement('li');
        item.className = entry.id === level?.id ? 'active' : '';
        item.innerHTML = `<span>${number}. ${entry.name}</span><small>${entry.id}</small>`;
        item.addEventListener('click', () => openLevel(entry.id));
        list.append(item);
    };
    const addHeader = (text) => {
        const header = document.createElement('li');
        header.className = 'world-header';
        header.style.cssText = 'font-weight:700;opacity:.7;font-size:11px;text-transform:uppercase;cursor:default;pointer-events:none;padding-top:8px';
        header.textContent = text;
        list.append(header);
    };
    worlds.forEach((world, index) => {
        const members = world.levels.map((id) => byId.get(id)).filter(Boolean);
        addHeader(`World ${index + 1} · ${world.name} (${members.length})`);
        members.forEach((entry, i) => addItem(entry, i + 1));
    });
    const loose = levels.filter((entry) => !worldOf(entry.id));
    if (loose.length) {
        addHeader(`Unassigned (${loose.length})`);
        loose.forEach((entry, i) => addItem(entry, i + 1));
    }
    const select = $('levelWorld');
    select.replaceChildren();
    worlds.forEach((world, index) => select.append(new Option(`${index + 1}. ${world.name}`, world.id)));
    select.append(new Option('Unassigned', ''));
    select.value = (level && worldOf(level.id)?.id) ?? '';
    list.scrollTop = scroll;
    list.querySelector('li.active')?.scrollIntoView({ block: 'nearest' });
}

async function loadWorlds() {
    worlds = (await api('/api/worlds')).worlds ?? [];
}

async function saveWorlds() {
    const current = await api('/api/worlds');
    current.worlds = worlds;
    await api('/api/worlds', { method: 'PUT', body: JSON.stringify(current) });
}

async function moveToWorld(worldId) {
    const target = worlds.find((world) => world.id === worldId);
    worlds.forEach((world) => (world.levels = world.levels.filter((id) => id !== level.id)));
    if (target) {
        target.levels.push(level.id);
        // Re-skin the level so the editor matches what the game will show.
        level.styles = { ...level.styles, ...target.styles };
        rebuildAll();
        renderInspector();
        syncSettings();
    }
    await saveWorlds();
    renderLevelList();
    await saveLevel();
}

function syncSettings() {
    $('levelName').value = level.name;
    $('gridCell').value = level.grid.cell;
    $('floorWidth').value = level.floor.width;
    $('floorDepth').value = level.floor.depth;
    renderWorldStyles();
    $('hasEntry').checked = Boolean(level.entryPath);
}

function bindSettings() {
    const bind = (id, apply, objects = false) => $(id).addEventListener('change', () => {
        apply($(id));
        markDirty();
        renderLevelList();
        objects ? rebuildAll() : rebuildStatic();
    });
    bind('levelName', (input) => (level.name = input.value));
    bind('gridCell', (input) => (level.grid.cell = Math.max(0.1, Number(input.value))));
    bind('floorWidth', (input) => (level.floor.width = Math.max(2, Number(input.value))));
    bind('floorDepth', (input) => (level.floor.depth = Math.max(2, Number(input.value))));
    bind('hasEntry', (input) => {
        level.entryPath = input.checked
            ? { x: level.start.x, z: level.start.z, width: 4.8, depth: 6 }
            : null;
    });
}

async function api(path, options) {
    const response = await fetch(path, options && { headers: { 'Content-Type': 'application/json' }, ...options });
    const body = await response.json();
    if (!response.ok) {
        throw new Error(body.error ?? response.statusText);
    }
    return body;
}

async function refreshLevels(selectId) {
    levels = await api('/api/levels');
    await loadWorlds();
    const target = levels.find((entry) => entry.id === selectId) ?? levels[0];
    if (target) {
        level = clone(target);
        level.guards ??= [];
        selection = null;
        syncSettings();
        rebuildAll();
        frameLevel();
        renderInspector();
        markClean('Loaded');
    }
    renderLevelList();
}

function confirmDiscard() {
    return !dirty || window.confirm('You have unsaved changes. Discard them?');
}

async function openLevel(id) {
    if (id === level?.id || !confirmDiscard()) {
        return;
    }
    dirty = false;
    await refreshLevels(id);
}

async function saveLevel() {
    try {
        await saveWorldStyles();
        await api(`/api/levels/${level.id}`, { method: 'PUT', body: JSON.stringify(level) });
        const index = levels.findIndex((entry) => entry.id === level.id);
        if (index >= 0) {
            levels[index] = clone(level);
        }
        renderLevelList();
        markClean('Saved ✓');
    } catch (error) {
        window.alert(`Save failed: ${error.message}`);
    }
}

async function reorder(delta) {
    const group = worldOf(level.id)?.levels;
    if (group) {
        const index = group.indexOf(level.id);
        const target = index + delta;
        if (target < 0 || target >= group.length) return;
        [group[index], group[target]] = [group[target], group[index]];
        await saveWorlds();
        renderLevelList();
        return;
    }
    const index = levels.findIndex((entry) => entry.id === level.id);
    const target = index + delta;
    if (target < 0 || target >= levels.length) return;
    [levels[index], levels[target]] = [levels[target], levels[index]];
    await api('/api/order', { method: 'PUT', body: JSON.stringify({ levels: levels.map((entry) => entry.id) }) });
    renderLevelList();
}

$('newLevel').addEventListener('click', async () => {
    if (!confirmDiscard()) return;
    const name = window.prompt('Level name', `Level ${levels.length + 1}`);
    if (name === null) return;
    const created = await api('/api/levels', { method: 'POST', body: JSON.stringify({ name }) });
    dirty = false;
    await refreshLevels(created.id);
});
$('dupLevel').addEventListener('click', async () => {
    if (!confirmDiscard()) return;
    const created = await api('/api/levels', { method: 'POST', body: JSON.stringify({ copyOf: level.id, name: `${level.name} copy` }) });
    dirty = false;
    await refreshLevels(created.id);
});
$('delLevel').addEventListener('click', async () => {
    if (levels.length <= 1) {
        return window.alert('Keep at least one level.');
    }
    if (!window.confirm(`Delete "${level.name}"? This removes the file.`)) return;
    await api(`/api/levels/${level.id}`, { method: 'DELETE' });
    dirty = false;
    await refreshLevels();
});
$('addTool').addEventListener('change', () => {
    pendingModel = null;
    renderModelList();
    setTool($('addTool').value || 'select');
});
$('levelWorld').addEventListener('change', () => moveToWorld($('levelWorld').value));
$('moveUp').addEventListener('click', () => reorder(-1));
$('moveDown').addEventListener('click', () => reorder(1));
$('save').addEventListener('click', saveLevel);
$('play').addEventListener('click', async () => {
    await saveLevel();
    window.open(`${gameUrl}?level=${encodeURIComponent(level.id)}`, '_blank');
});
document.querySelectorAll('[data-tool]').forEach((element) => element.addEventListener('click', () => {
    pendingModel = null;
    renderModelList();
    setTool(element.dataset.tool);
}));

// ---------------------------------------------------------------- model browser
function renderModelList() {
    const holder = $('modelList');
    holder.replaceChildren();
    if (pendingModel) {
        const thumb = document.createElement('img');
        thumb.src = modelThumbUrl(pendingModel);
        thumb.alt = '';
        const name = document.createElement('div');
        name.className = 'chip-name';
        name.textContent = pendingModel.split('/').pop().replace(/\.glb$/, '');
        name.title = pendingModel;
        const clear = document.createElement('button');
        clear.className = 'icon-btn';
        clear.textContent = '✕';
        clear.title = 'Stop placing';
        clear.addEventListener('click', () => {
            pendingModel = null;
            setHint('');
            renderModelList();
        });
        const chip = document.createElement('div');
        chip.className = 'model-chip';
        chip.append(thumb, name, clear);
        holder.append(chip);
    }
}
$('pickModel').addEventListener('click', () => openModelPicker({
    current: pendingModel,
    title: 'Choose a model to place',
    confirmLabel: 'Place on map',
    onPick: (path) => {
        pendingModel = path;
        setHint(`Click the map to drop ${path} (Esc to stop).`);
        renderModelList();
    },
}));

// ---------------------------------------------------------------- tabs
let uiTabReady = false;
async function switchTab(name) {
    activeTab = name;
    document.querySelectorAll('[data-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.id !== `tab-${name}`; });
    if (name === 'level') {
        resize();
    } else if (!uiTabReady) {
        uiTabReady = true;
        await initUiTab($('tab-ui'));
    } else {
        refreshUiTab();
    }
    history.replaceState(null, '', `#${name}`);
}
document.querySelectorAll('[data-tab]').forEach((tab) => tab.addEventListener('click', () => void switchTab(tab.dataset.tab)));

// ---------------------------------------------------------------- init
async function init() {
    bindSettings();
    initWorldStyles($('worldStyles'), {
        level: () => level,
        levels: () => levels.map((entry) => (entry.id === level?.id ? level : entry)),
        onLevelChange: () => { markDirty(); rebuildStatic(); },
        onStylesChange: () => { markDirty(); rebuildStatic(); },
    });
    await loadWorldStyles();
    setTool('select');
    resize();
    loop();
    const config = await api('/api/config');
    gameUrl = config.gameUrl;
    setModelCatalog(await api('/api/models'));
    renderModelList();
    await refreshLevels();
    if (location.hash === '#ui') await switchTab('ui');
}

init().catch((error) => {
    console.error(error);
    $('hint').textContent = `Editor failed to start: ${error.message}`;
});
