// CheapLights.ts
//
// MeshStandardMaterial's lighting without its shine, for phones: only the diffuse light is worked out (like a Lambert
// material's), not the highlights and the energy lost to them, most of that shader's cost. A matte, cartoony world looks the
// same; metal goes matte (and keeps half its colour, or it would be black). It changes three's own shader chunks, so every
// material gets it, however it's made.
//
// install() once, before anything's drawn. With a three whose chunks read differently it does nothing.

import * as THREE from 'three';

const CHEAP = /* glsl */ `
void RE_Direct_Cheap( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
    reflectedLight.directDiffuse += saturate( dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_Lambert( material.diffuseContribution );
}
#define RE_Direct RE_Direct_Cheap`;

let installed = false;

export const CheapLights = {
    install(): void {
        if (installed) return;
        installed = true;
        const chunks = THREE.ShaderChunk as Record<string, string>;
        const direct = /#define RE_Direct\s+RE_Direct_Physical/;
        const specular = /#define RE_IndirectSpecular\s+RE_IndirectSpecular_Physical/;
        const lights = chunks.lights_physical_pars_fragment;
        if (!direct.test(lights) || !specular.test(lights)) return;
        // (Without RE_IndirectSpecular three leaves that part out altogether: there's no environment to reflect anyway.)
        chunks.lights_physical_pars_fragment = lights.replace(direct, CHEAP).replace(specular, '');
        chunks.lights_physical_fragment = chunks.lights_physical_fragment
            .replace('diffuseColor.rgb * ( 1.0 - metalnessFactor );', 'diffuseColor.rgb * ( 1.0 - metalnessFactor * 0.5 );');
    },
};
