import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
let allModels = [];
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

    const ground = mesh(new THREE.PlaneGeometry(floor.width + 26, floor.depth + 22), 0x3d5a3a, -0.03);
    ground.rotation.x = -Math.PI / 2;
    staticGroup.add(ground);

    if (level.entryPath) {
        const entry = mesh(new THREE.PlaneGeometry(level.entryPath.width, level.entryPath.depth), 0x9a744d, -0.02);
        entry.rotation.x = -Math.PI / 2;
        entry.position.set(level.entryPath.x, -0.02, level.entryPath.z);
        staticGroup.add(entry);
    }

    const checker = document.createElement('canvas');
    checker.width = checker.height = 2;
    const ctx = checker.getContext('2d');
    ctx.fillStyle = floor.colorA;
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillStyle = floor.colorB;
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillRect(1, 1, 1, 1);
    const texture = new THREE.CanvasTexture(checker);
    texture.magFilter = THREE.NearestFilter;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    const cell = floor.checkerScale || 1.5;
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
            const piece = mesh(new THREE.BoxGeometry(length + 0.35, 0.5, 0.35), selected ? 0xffd15c : 0x378f91, 0.25);
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
            const color = isSelected ? 0xff5577 : opening.kind === 'door' ? 0xffb347 : 0x6cc6ff;
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
    updateSelectionOverlay();
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
    else return;
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
    const hints = {
        select: 'Click to select, drag to move. Pick a model on the left to drop it.',
        wall: 'Click to add wall points. Enter or double-click finishes; Esc cancels.',
        door: 'Click on a wall to place a door.',
        window: 'Click on a wall to place a window.',
        start: 'Click to set the player start.',
        waypoint: 'Click to add a checkpoint (the last one is the exit).',
    };
    setHint(hints[next]);
    updateSelectionOverlay();
}

function setHint(text) {
    $('hint').textContent = text;
}

function finishWall() {
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
    if (tool === 'wall') {
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
    } else if (event.key === 'Enter' && tool === 'wall') {
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
    if (dirty) {
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
        panel.append(field('Kind', opening.kind, change((v) => (opening.kind = v)), { choices: ['door', 'window'] }));
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
function renderLevelList() {
    const list = $('levelList');
    list.replaceChildren();
    levels.forEach((entry, index) => {
        const item = document.createElement('li');
        item.className = entry.id === level?.id ? 'active' : '';
        item.innerHTML = `<span>${index + 1}. ${entry.name}</span><small>${entry.id}</small>`;
        item.addEventListener('click', () => openLevel(entry.id));
        list.append(item);
    });
}

function syncSettings() {
    $('levelName').value = level.name;
    $('gridCell').value = level.grid.cell;
    $('floorWidth').value = level.floor.width;
    $('floorDepth').value = level.floor.depth;
    $('colorA').value = level.floor.colorA;
    $('colorB').value = level.floor.colorB;
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
    bind('colorA', (input) => (level.floor.colorA = input.value));
    bind('colorB', (input) => (level.floor.colorB = input.value));
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
    const target = levels.find((entry) => entry.id === selectId) ?? levels[0];
    if (target) {
        level = clone(target);
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
    const index = levels.findIndex((entry) => entry.id === level.id);
    const target = index + delta;
    if (target < 0 || target >= levels.length) {
        return;
    }
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
    const filter = $('modelSearch').value.trim().toLowerCase();
    const list = $('modelList');
    list.replaceChildren();
    let currentCategory = '';
    for (const path of allModels) {
        if (filter && !path.toLowerCase().includes(filter)) {
            continue;
        }
        const category = path.split('/').slice(0, -1).join('/') || '/';
        if (category !== currentCategory) {
            currentCategory = category;
            const header = document.createElement('div');
            header.className = 'cat';
            header.textContent = category;
            list.append(header);
        }
        const item = document.createElement('div');
        item.className = `item${path === pendingModel ? ' active' : ''}`;
        item.textContent = path.split('/').pop();
        item.title = path;
        item.addEventListener('click', () => {
            pendingModel = pendingModel === path ? null : path;
            setHint(pendingModel ? `Click the map to drop ${path} (Esc to stop).` : '');
            renderModelList();
        });
        list.append(item);
    }
}
$('modelSearch').addEventListener('input', renderModelList);

// ---------------------------------------------------------------- init
async function init() {
    bindSettings();
    setTool('select');
    resize();
    loop();
    const config = await api('/api/config');
    gameUrl = config.gameUrl;
    allModels = await api('/api/models');
    renderModelList();
    await refreshLevels();
}

init().catch((error) => {
    console.error(error);
    $('hint').textContent = `Editor failed to start: ${error.message}`;
});
