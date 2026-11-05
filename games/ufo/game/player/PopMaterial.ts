// PopMaterial.ts
//
// The saucers' stylised look, to stand out from the map like hole.io's holes: vivid colours, simple cartoon shading (a lit
// side and a shadow side, not the scene's lights), an edge that goes darker, and clear glass. An outline's there if it's
// asked for. Tuned in the editor's UFO tab (`saucerLook`). Bent with the world.

import * as THREE from 'three';
import { DESIGN } from '../data/UfoConfig';
import { bendUniforms } from '../services/Bend';

export interface PopStyle {
    /** 1 is the texture's own colours. */
    saturation: number;
    brightness: number;
    /** How dark the shadow side is: 1 is no shadow at all. */
    shadow: number;
    /** How much darker its edge goes: 0 not at all, 1 to black. */
    rim: number;
    /** How far in from the edge that reaches (0..1, of how much the surface faces the camera). */
    rimWidth: number;
    /** The dark outline's width, in thousandths of the screen's height. 0: none. */
    outline: number;
}

export interface PopApplied {
    materials: THREE.Material[];
    outlines: THREE.Mesh[];
    /** Which stylised material stands in for which lit one. */
    of: Map<THREE.Material, THREE.ShaderMaterial>;
}

const OUTLINE_COLOR = 0x12102c;
/** Where the shading's light comes from, in the world. */
const LIGHT = new THREE.Vector3(-0.45, 0.8, 0.4).normalize();

const bentPosition = `
uniform vec3 uBendOrigin;
uniform float uBendStrength;
vec4 bentClipPosition() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 away = world.xz - uBendOrigin.xz;
    world.y -= dot(away, away) * uBendStrength;
    return projectionMatrix * viewMatrix * world;
}
`;

const popVertex = `
uniform vec3 uBendOrigin;
uniform float uBendStrength;
uniform vec3 uLight;
uniform mat4 uToBody;
varying vec2 vUv2;
varying vec3 vNormal2;
varying vec3 vLight;
varying vec3 vViewPosition2;
varying vec2 vBody;
void main() {
    vUv2 = uv;
    vBody = (uToBody * vec4(position, 1.0)).xz;
    vNormal2 = normalMatrix * normal;
    vLight = mat3(viewMatrix) * uLight;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec2 away = world.xz - uBendOrigin.xz;
    world.y -= dot(away, away) * uBendStrength;
    vec4 view = viewMatrix * world;
    vViewPosition2 = view.xyz;
    gl_Position = projectionMatrix * view;
}
`;

const popFragment = `
uniform vec3 uColor;
uniform float uOpacity;
uniform sampler2D uMap;
uniform bool uHasMap;
uniform vec3 uEmissive;
uniform sampler2D uEmissiveMap;
uniform bool uHasEmissiveMap;
uniform sampler2D uNormalMap;
uniform bool uHasNormalMap;
uniform sampler2D uOcclusionMap;
uniform bool uHasOcclusionMap;
uniform float uSaturation;
uniform float uBrightness;
uniform float uShadow;
uniform float uRim;
uniform float uRimWidth;
uniform bool uGlass;
uniform bool uRadialRim;
varying vec2 vUv2;
varying vec3 vNormal2;
varying vec3 vLight;
varying vec3 vViewPosition2;
varying vec2 vBody;

/** The normal map's relief, worked out from how the position and UVs change across the screen. */
vec3 reliefNormal(vec3 normal) {
    vec3 q0 = dFdx(vViewPosition2);
    vec3 q1 = dFdy(vViewPosition2);
    vec2 st0 = dFdx(vUv2);
    vec2 st1 = dFdy(vUv2);
    vec3 q1perp = cross(q1, normal);
    vec3 q0perp = cross(normal, q0);
    vec3 tangent = q1perp * st0.x + q0perp * st1.x;
    vec3 bitangent = q1perp * st0.y + q0perp * st1.y;
    float size = max(dot(tangent, tangent), dot(bitangent, bitangent));
    float scale = size == 0.0 ? 0.0 : inversesqrt(size);
    vec3 relief = texture2D(uNormalMap, vUv2).xyz * 2.0 - 1.0;
    return normalize(tangent * scale * relief.x + bitangent * scale * relief.y + normal * relief.z);
}

void main() {
    vec3 color = uColor;
    if (uHasMap) color *= texture2D(uMap, vUv2).rgb;
    float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
    // Kept in range: past 1, the shading and the rim below would be darkening what's over-bright and not show.
    color = clamp(mix(vec3(grey), color, uSaturation) * uBrightness, 0.0, 1.0);
    // Its panels' creases.
    if (uHasOcclusionMap) color *= texture2D(uOcclusionMap, vUv2).r;
    vec3 shape = normalize(vNormal2);
    vec3 normal = uHasNormalMap ? reliefNormal(shape) : shape;
    vec3 light = normalize(vLight);
    // Falling off round the shape, from the lit side to the shadow side.
    float lit = smoothstep(-0.25, 0.7, dot(normal, light));
    // (Squared-ish: these work in linear colour, and should look like the numbers say.)
    color *= pow(mix(uShadow, 1.0, lit), 2.2);
    // Darker where the shape turns away from the camera, whatever its relief.
    float edge = 1.0 - smoothstep(0.0, uRimWidth, shape.z);
    if (uRadialRim) {
        // The hull's a flat disc, whose far edge faces the camera as much as its middle: there it goes by the distance out.
        float out_ = length(vBody);
        edge = max(edge, smoothstep(1.0 - uRimWidth * 0.55, 1.0, out_) * (1.0 - smoothstep(1.02, 1.1, out_)));
    }
    color *= pow(1.0 - uRim * edge, 2.2);
    vec3 glow = uEmissive;
    if (uHasEmissiveMap) glow *= texture2D(uEmissiveMap, vUv2).rgb;
    color += glow;
    float alpha = uOpacity;
    if (uGlass) {
        // Clear in the middle, seen at its edge, and solid where it's lit up.
        alpha = clamp(alpha + edge * 0.45 + length(glow) * 0.35, 0.0, 1.0);
    }
    gl_FragColor = vec4(color, alpha);
    #include <colorspace_fragment>
}
`;

// The outline: the shape's back faces, pushed out along their normals by a set width on screen, whatever the shape's size.
const outlineVertex = `
${bentPosition}
uniform float uWidth;
void main() {
    gl_Position = bentClipPosition();
    vec2 away = (normalMatrix * normal).xy;
    float size = length(away);
    if (size > 1e-4) {
        float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
        gl_Position.xy += (away / size) * uWidth * 0.002 * gl_Position.w * vec2(1.0 / aspect, 1.0);
    }
}
`;

const outlineFragment = `
uniform vec3 uColor;
void main() {
    gl_FragColor = vec4(uColor, 1.0);
    #include <colorspace_fragment>
}
`;

/** The settings' look; null if it's turned off. */
export function popStyle(): PopStyle | null {
    return DESIGN.saucerLook.pop ? DESIGN.saucerLook : null;
}

function createPopMaterial(lit: THREE.MeshStandardMaterial, style: PopStyle, toBody: THREE.Matrix4): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            uBendOrigin: bendUniforms.uBendOrigin,
            uBendStrength: bendUniforms.uBendStrength,
            uLight: { value: LIGHT },
            uColor: { value: lit.color.clone() },
            uOpacity: { value: lit.opacity },
            uMap: { value: lit.map },
            uHasMap: { value: lit.map !== null },
            uEmissive: { value: lit.emissive.clone().multiplyScalar(lit.emissiveIntensity) },
            uEmissiveMap: { value: lit.emissiveMap },
            uHasEmissiveMap: { value: lit.emissiveMap !== null },
            uSaturation: { value: style.saturation },
            uBrightness: { value: style.brightness },
            uShadow: { value: style.shadow },
            uRim: { value: style.rim },
            uRimWidth: { value: style.rimWidth },
            uToBody: { value: toBody },
            // The hull and its guns: only they have a normal map.
            uRadialRim: { value: lit.normalMap !== null },
            uNormalMap: { value: lit.normalMap },
            uHasNormalMap: { value: lit.normalMap !== null },
            uOcclusionMap: { value: lit.aoMap },
            uHasOcclusionMap: { value: lit.aoMap !== null },
            uGlass: { value: lit.transparent },
        },
        vertexShader: popVertex,
        fragmentShader: popFragment,
        transparent: lit.transparent,
        side: lit.side,
        depthWrite: lit.depthWrite,
    });
}

function createOutlineMaterial(style: PopStyle): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        uniforms: {
            uBendOrigin: bendUniforms.uBendOrigin,
            uBendStrength: bendUniforms.uBendStrength,
            uWidth: { value: style.outline },
            uColor: { value: new THREE.Color(OUTLINE_COLOR) },
        },
        vertexShader: outlineVertex,
        fragmentShader: outlineFragment,
        side: THREE.BackSide,
    });
}

/** Takes off what applyPop() added: its outlines and materials. */
export function removePop(applied: PopApplied): void {
    applied.outlines.forEach((outline) => outline.removeFromParent());
    applied.materials.forEach((material) => material.dispose());
}

/**
 * Each lit material under `root` swapped for a stylised copy of how it looks now, and an outline added. The lit one's kept on
 * the mesh (`litMaterial`), for its look can change: call again, after removePop(), to catch up.
 */
export function applyPop(root: THREE.Object3D, style: PopStyle): PopApplied {
    const applied: PopApplied = { materials: [], outlines: [], of: new Map() };
    const meshes: THREE.Mesh[] = [];
    root.updateWorldMatrix(true, true);
    const rootInverse = root.matrixWorld.clone().invert();
    root.traverse((child) => {
        if (child instanceof THREE.Mesh && !Array.isArray(child.material)) meshes.push(child);
    });
    const outlineMaterial = style.outline > 0 ? createOutlineMaterial(style) : null;
    if (outlineMaterial) applied.materials.push(outlineMaterial);
    for (const mesh of meshes) {
        const lit = (mesh.userData.litMaterial ?? mesh.material) as THREE.Material;
        if (!(lit instanceof THREE.MeshStandardMaterial)) continue;
        mesh.userData.litMaterial = lit;
        let material = applied.of.get(lit);
        if (!material) {
            material = createPopMaterial(lit, style, rootInverse.clone().multiply(mesh.matrixWorld));
            applied.of.set(lit, material);
            applied.materials.push(material);
        }
        mesh.material = material;
        // See-through parts (the dome) get none: it would show through them.
        if (!outlineMaterial || lit.transparent) continue;
        const outline = new THREE.Mesh(mesh.geometry, outlineMaterial);
        mesh.add(outline);
        applied.outlines.push(outline);
    }
    return applied;
}
