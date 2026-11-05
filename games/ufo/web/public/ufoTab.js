// The UFO tab: this game's own settings (ui/ufo.json `ufo`, `camera` and `people`). The game reloads when the file is saved.

import { api, el, toast } from './shared.js';

const FIELDS = {
    ufo: [
        ['startRadius', 'Start radius', 'The saucer\'s size at the start: what fits under it.'],
        ['speed', 'Speed', 'Units per second at radius 0.'],
        ['speedPerRadius', 'Speed per radius', 'How much faster each unit of radius flies.'],
        ['accel', 'Acceleration', 'How quickly it reaches its speed and stops.'],
        ['altitudeBase', 'Altitude base', 'Altitude = base + per radius × radius.'],
        ['altitudePerRadius', 'Altitude per radius', 'How much higher each unit of radius flies: anything taller blocks it.'],
        ['growth', 'Growth', 'Radius² gained per point of an eaten thing\'s value.'],
        ['valuePower', 'Value power', 'A thing\'s value = its volume ^ this. Lower: big things count for less.'],
        ['growSpeed', 'Grow speed', 'How quickly the saucer eases to its new size.'],
        ['waterMargin', 'Over the water', 'How far past the shore it can fly before it stops, with arrows pointing back to land.'],
        ['sizeStep', 'Size step', 'How much radius makes one "size" on its bar: each one reached is a milestone.'],
        ['completeShare', 'Eat-everything margin', 'The share of the town that wins those levels. 0.97 leaves 3% for what\'s too small to find.'],
        ['firstSizeBoost', 'First size boost', 'How many times faster the player grows until its second size. 1 is no boost.'],
        ['collideShare', 'Collision size', 'The share of its radius that hits things too tall to fly over.'],
    ],
    rivals: [
        ['speed', 'Speed', 'As a share of the player\'s: 1 is just as fast.'],
        ['respawnSeconds', 'Back after (seconds)', 'After being eaten, for the player too.'],
        ['respawnSize', 'Size kept', 'The share of its size it comes back with.'],
        ['protectSeconds', 'Safe for (seconds)', 'How long after coming back it can\'t be eaten.'],
        ['eatMargin', 'Bigger by', 'How many times bigger a saucer must be to eat another.'],
        ['playerKeeps', 'Player keeps', 'The share of its size the player comes back with. Each rival\'s size share is `rivals.ratios` in ui/ufo.json.'],
        ['huntSeconds', 'Hunts for (seconds)', 'One rival at a time hunts the player for this long…'],
        ['restSeconds', 'Then rests (seconds)', '…then none does for this long.'],
        ['afterEatenSeconds', 'After you\'re eaten (seconds)', 'Nobody hunts the player for this long.'],
        ['stillSeconds', 'Holding still (seconds)', 'After this long without moving, the player isn\'t hunted.'],
        ['seenSeconds', 'On screen first (seconds)', 'A hunter must have been on screen this long to eat the player.'],
        ['keepAway', 'Keep away', 'How far those that could eat the player stay off, when not hunting.'],
        ['shrinkPerSecond', 'Shrink over cap', 'A rival over its cap eases down by this share of its size a second.'],
        ['floorShare', 'Rubber band floor', 'A rival under this share of its cap grows towards it on its own.'],
        ['catchUp', 'Rubber band speed', 'How much of the gap to that floor it closes a second.'],
        ['gentleShare', 'Eat-everything levels: largest', 'In those levels nobody eats the player, and each rival stays under this share of its size.'],
    ],
    people: [
        ['speed', 'Walking speed', ''],
        ['height', 'Height', 'Keep it under the saucer\'s starting height to eat them from the start.'],
        ['wander', 'Wander distance', 'How far away people in a wander area pick their next spot. Where people are and how many: the People card in the Town tab.'],
        ['pauseMin', 'Shortest stop (seconds)', ''],
        ['pauseMax', 'Longest stop (seconds)', ''],
    ],
    intro: [
        ['hold', 'Wait first (seconds)', 'Before the camera sets off, while the screen opens.'],
        ['seconds', 'Camera time (seconds)', 'From high above down to the player.'],
        ['pitchDeg', 'Starting pitch (degrees)', '90 is straight down.'],
        ['zoomOut', 'Starting distance', 'As a share of what shows the whole island. 1 is all of it.'],
        ['gatherRadius', 'Rivals wait this far off', 'From the player, before they fly out.'],
        ['spreadSeconds', 'Rivals fly out (seconds)', 'At their normal speed, away from the player. Then the level starts.'],
    ],
    scarcity: [
        ['offscreenCooldown', 'Off-screen eat cooldown (seconds)', 'A rival out of sight only pretends to eat a thing: it grows and the thing stays. Rivals leave that thing alone this long.'],
        ['droughtSeconds', 'Restore after (seconds)', 'With the player eating nothing for this long, eaten things come back. Never in eat-everything levels.'],
        ['minEatable', 'Restore under this many', 'Also when fewer than this are left that the player can eat.'],
        ['riskShare', 'Points safety', 'Also when this share of the points left would not reach the target.'],
        ['batch', 'How many come back', 'At a time: out of sight, the nearest and biggest that fit the player.'],
        ['every', 'At most every (seconds)', ''],
    ],
    saucerLook: [
        ['pop', 'Stylised UFOs', 'Vivid colours, cartoon shading and a darker edge, on every UFO: in the game, on the main screen and in the shop.', 'toggle'],
        ['saturation', 'Saturation', '1 is the skin\'s own colours, higher is more vivid.'],
        ['brightness', 'Brightness', '1 is the skin\'s own colours.'],
        ['shadow', 'Shadow side', 'How dark the shaded side is: 1 is no shadow, lower is more contrast.'],
        ['rim', 'Dark edge', 'How much darker the outside of the shape goes. 0 is none, 1 is black.'],
        ['rimWidth', 'Dark edge width', 'How far in from the outside it reaches. Higher takes in more of the shape; too high darkens the whole top.'],
        ['outline', 'Outline', 'A dark line round it. 0 is none.'],
    ],
    home: [
        ['baked', 'Use baked images', 'On: the island and UFO are smooth images over the live sea, and the view doesn\'t swing. Off: live 3D.', 'toggle'],
        ['pitchDeg', 'Pitch (degrees)', 'How steeply it looks down at the miniature. Lower is less top-down, 90 is straight down.'],
        ['yawDeg', 'Yaw (degrees)', 'Turns the view round the player point. 0 looks from the south, 90 from the east, 45 gives a diagonal view.'],
        ['fov', 'Field of view', 'Low is a long lens: flatter, more like a miniature.'],
        ['fill', 'Island size on screen', 'How much of the screen\'s narrower side the island fills (0.8 is 80%).'],
        ['drop', 'Player point below the middle', 'As a share of the island\'s size. 0 is the middle of the screen.'],
        ['drift', 'Swing', 'How far the view swings round the player point. 0 holds it still.'],
        ['driftSpeed', 'Swing speed', ''],
        ['ufoSize', 'UFO size', 'As a share of the island\'s size.'],
        ['ufoHeight', 'UFO height', 'As a share of the island\'s size.'],
    ],
    camera: [
        ['pitchDeg', 'Pitch (degrees)', 'How steeply it looks down at the start.'],
        ['endPitchDeg', 'Pitch when grown', 'It steepens to this as the saucer grows, which keeps the big saucer from looking stretched.'],
        ['endPitchRadius', 'Grown radius', 'The saucer\'s radius when it reaches that pitch.'],
        ['fov', 'Field of view', ''],
        ['distance', 'Distance', 'From the saucer, at altitude 0.'],
        ['perAltitude', 'Distance per altitude', 'How far it pulls back as the saucer climbs.'],
        ['maxShare', 'Largest saucer on screen', 'The share of the screen\'s narrower side it can fill (0.3 is 30%) before the camera pulls back further.'],
        ['followSpeed', 'Follow speed', ''],
        ['zoomSpeed', 'Zoom speed', ''],
        ['rivalsZoom', 'Zoom out with rivals', 'How much further back it sits in a round with rivals: 1 is the same as alone.'],
        ['bend', 'World bend', 'How strongly the world curves away. 0 is flat, 0.002 is the same as the mow game.'],
    ],
};

let dirty = false;
export const hasUnsavedUfo = () => dirty;

export async function initUfoTab(host) {
    const settings = await api('/api/mow');
    const edits = { ufo: {}, rivals: {}, camera: {}, home: {}, saucerLook: {}, intro: {}, scarcity: {}, people: {} };
    const field = (section, [key, label, hint, kind]) => el('label', {},
        el('span', {}, label, hint ? el('small', {}, hint) : null),
        kind === 'toggle' ? el('input', {
            type: 'checkbox', checked: settings[section][key] === true,
            onchange: (event) => {
                edits[section][key] = event.target.checked;
                dirty = true;
            },
        }) : el('input', {
            type: 'number', step: 'any', value: String(settings[section][key]),
            oninput: (event) => {
                const value = event.target.valueAsNumber;
                if (Number.isFinite(value)) {
                    edits[section][key] = value;
                    dirty = true;
                }
            },
        }));
    const save = async () => {
        try {
            await api('/api/ufo', { method: 'PUT', body: JSON.stringify(edits) });
            dirty = false;
            toast('Saved');
        } catch (error) {
            toast(error.message, 'error');
        }
    };
    host.replaceChildren(el('div', { class: 'ufo-form' },
        el('h2', {}, 'UFO'), FIELDS.ufo.map((entry) => field('ufo', entry)),
        el('h2', {}, 'Level start'), FIELDS.intro.map((entry) => field('intro', entry)),
        el('h2', {}, 'Never running out'), FIELDS.scarcity.map((entry) => field('scarcity', entry)),
        el('h2', {}, 'UFO look'), FIELDS.saucerLook.map((entry) => field('saucerLook', entry)),
        el('h2', {}, 'Rivals'), FIELDS.rivals.map((entry) => field('rivals', entry)),
        el('h2', {}, 'People'), FIELDS.people.map((entry) => field('people', entry)),
        el('h2', {}, 'Camera'), FIELDS.camera.map((entry) => field('camera', entry)),
        el('h2', {}, 'Main screen camera'), FIELDS.home.map((entry) => field('home', entry)),
        el('button', { class: 'primary', onclick: save }, '💾 Save')));
}
