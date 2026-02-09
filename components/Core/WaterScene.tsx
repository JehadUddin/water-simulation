
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WaterConfig } from '../../types/index.tsx';

interface WaterSceneProps {
  config: WaterConfig;
  initialCameraState?: { position: [number, number, number], target: [number, number, number] } | null;
}

// --- SHADER UTILS ---
const commonNoise = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 )) + i.x + vec3(0.0, i1.x, 1.0 ));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m ;
  m = m*m ;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
`;

const voronoiUtils = `
vec2 hash2( vec2 p ) { return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453); }

float voronoi( in vec2 x ) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float m = 8.0;
    for( int j=-1; j<=1; j++ )
    for( int i=-1; i<=1; i++ ) {
        vec2 g = vec2( float(i), float(j) );
        vec2 o = hash2( n + g );
        o = 0.5 + 0.5*sin( uTime * 1.5 + 6.2831*o );
        vec2 r = g + o - f;
        float d = dot(r,r);
        if( d<m ) m=d;
    }
    return m;
}
`;

// --- RIPPLE SHADERS ---
const rippleVertexShader = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`;
const rippleFragmentShader = `
precision highp float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uDamping;
varying vec2 vUv;
void main() {
    vec2 pixel = 1.0 / uResolution;
    float left = texture2D(uTexture, vUv + vec2(-pixel.x, 0.0)).r;
    float right = texture2D(uTexture, vUv + vec2(pixel.x, 0.0)).r;
    float up = texture2D(uTexture, vUv + vec2(0.0, -pixel.y)).r;
    float down = texture2D(uTexture, vUv + vec2(0.0, pixel.y)).r;
    vec4 current = texture2D(uTexture, vUv);
    float average = (left + right + up + down) * 0.25;
    float vel = (average - current.r) * 2.0;
    current.g = (current.g + vel) * uDamping;
    current.r += current.g;
    current.r *= 0.995; 
    gl_FragColor = current;
}
`;
const rippleDropFragmentShader = `
precision highp float;
uniform sampler2D uTexture;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uStrength;
varying vec2 vUv;
void main() {
    vec4 info = texture2D(uTexture, vUv);
    float dist = distance(vUv, uCenter);
    if (dist < uRadius) {
        float drop = pow(max(0.0, 1.0 - dist / uRadius), 2.0);
        info.r -= drop * uStrength; 
        info.g -= drop * uStrength * 0.5;
    }
    gl_FragColor = info;
}
`;

// --- AAA GRAPHICS SHADERS ---

// 1. GOD RAYS
const godRayVertexShader = `
varying vec2 vUv;
varying float vAlpha;
uniform float uTime;
${commonNoise}
void main() {
    vUv = uv;
    vec3 pos = position;
    float sway = snoise(vec2(pos.y * 0.05, uTime * 0.15)) * 6.0;
    pos.x += sway * (1.0 - uv.y); 
    pos.z += sway * 0.5 * (1.0 - uv.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    vAlpha = smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.6, uv.y);
}
`;
const godRayFragmentShader = `
uniform float uTime;
uniform vec3 uColor;
uniform float uLightIntensity;
varying vec2 vUv;
varying float vAlpha;
${commonNoise}
void main() {
    float n1 = snoise(vec2(vUv.x * 3.0 + uTime * 0.1, vUv.y * 0.5 - uTime * 0.2));
    float n2 = snoise(vec2(vUv.x * 6.0 - uTime * 0.05, vUv.y * 2.0 - uTime * 0.4));
    float beam = smoothstep(0.4, 0.8, n1 * 0.5 + n2 * 0.5 + 0.45);
    float xFade = 1.0 - abs(vUv.x - 0.5) * 2.0;
    xFade = smoothstep(0.0, 0.4, xFade);
    float alpha = vAlpha * beam * xFade * 0.3 * uLightIntensity; 
    gl_FragColor = vec4(uColor, alpha);
}
`;

// 2. PROCEDURAL TERRAIN (REALISTIC SAND)
const terrainVertexShader = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorldPos;
varying float vElevation;
${commonNoise}

void main() {
    vUv = uv;
    vec3 pos = position;
    
    // Procedural Terrain
    // Plane rotated -90 on X, so pos.xy is world XZ
    float large = snoise(pos.xy * 0.002) * 45.0; // Larger dunes
    float medium = snoise(pos.xy * 0.01 + uTime * 0.01) * 6.0; 
    float small = snoise(pos.xy * 0.08) * 1.5;
    
    float elevation = large + medium + small;
    pos.z += elevation;
    vElevation = elevation;

    vec4 worldPosition = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const terrainFragmentShader = `
uniform float uTime;
uniform vec3 uColorDeep;
uniform vec3 uColorShallow;
uniform float uLightIntensity;
varying vec2 vUv;
varying vec3 vWorldPos;
varying float vElevation;
${voronoiUtils}
${commonNoise}

void main() {
    // REALISTIC SAND PALETTE
    vec3 sandColor = vec3(0.85, 0.78, 0.65); // Natural Beige
    vec3 rockColor = vec3(0.4, 0.35, 0.3);   // Darker shadows
    
    // Mix sand based on height (valleys are darker)
    float heightFactor = smoothstep(-20.0, 30.0, vElevation);
    vec3 albedo = mix(rockColor, sandColor, heightFactor);
    
    // Texture grain
    float noise = snoise(vWorldPos.xz * 0.8);
    albedo *= (0.9 + 0.1 * noise);

    // CAUSTICS - UPGRADED
    vec2 uv = vWorldPos.xz * 0.04;
    
    // Domain warping for liquidity (makes lines curvy)
    vec2 warp = vec2(
        snoise(uv * 0.5 + uTime * 0.1),
        snoise(uv * 0.5 - uTime * 0.1)
    ) * 0.2;
    
    vec2 warpedUV = uv + warp;
    
    // Scrolling layers
    vec2 scroll1 = vec2(uTime * 0.05, uTime * 0.02);
    vec2 scroll2 = vec2(-uTime * 0.03, uTime * 0.04);
    
    // Chromatic Aberration offsets
    float aber = 0.005;
    
    // R Channel
    float v1r = voronoi(warpedUV * 1.5 + scroll1 + vec2(aber, 0.0)); 
    float v2r = voronoi(warpedUV * 2.0 + scroll2 - vec2(aber, 0.0) + 0.5);
    float cR = min(v1r, v2r);
    
    // G Channel
    float v1g = voronoi(warpedUV * 1.5 + scroll1);
    float v2g = voronoi(warpedUV * 2.0 + scroll2 + 0.5);
    float cG = min(v1g, v2g);
    
    // B Channel
    float v1b = voronoi(warpedUV * 1.5 + scroll1 - vec2(aber, 0.0));
    float v2b = voronoi(warpedUV * 2.0 + scroll2 + vec2(aber, 0.0) + 0.5);
    float cB = min(v1b, v2b);
    
    // Sharpen and Intensity
    vec3 caustics = vec3(
        pow(1.0 - sqrt(cR), 45.0),
        pow(1.0 - sqrt(cG), 45.0),
        pow(1.0 - sqrt(cB), 45.0)
    );
    
    // Add extra "hot spots" boost
    caustics += pow(caustics, vec3(1.5)) * 1.5;

    // Add caustics to sand
    vec3 finalColor = albedo + (caustics * uLightIntensity * 3.0);

    // DISTANCE FOG (Physically Based)
    // Water absorbs red light first, then green, leaving blue.
    float dist = length(vWorldPos.xz); 
    
    // Exponential fog
    float fogDensity = 0.0025;
    float fogFactor = 1.0 - exp(-dist * fogDensity);
    
    // Fog color isn't just "deep color", it's light scattering
    // Near surface: Lighter. Deep: Darker.
    vec3 fogColor = mix(uColorDeep, uColorShallow * 0.5, 0.3);
    
    // Blend geometry into fog
    finalColor = mix(finalColor, fogColor, fogFactor);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// 3. UNIFIED ENVIRONMENT (ABYSS GRADIENT)
const gradientVertexShader = `
varying vec3 vWorldPos;
void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;
const gradientFragmentShader = `
uniform vec3 uColorDeep;
uniform vec3 uColorShallow;
uniform float uTransition; 
uniform vec3 uSunPosition;
uniform float uLightIntensity;
varying vec3 vWorldPos;

void main() {
    vec3 dir = normalize(vWorldPos);
    
    // Vertical Gradient
    // Up: Surface Light. Down: Total Darkness.
    float y = dir.y;
    
    // 1. Abyss (Bottom)
    // Fade to black/void at the very bottom (-1.0)
    vec3 deepVoid = vec3(0.005, 0.01, 0.02); // Almost black
    
    // Mix Deep Config Color with Void based on depth
    vec3 bottomColor = mix(deepVoid, uColorDeep, smoothstep(-1.0, -0.2, y));
    
    // 2. Mid-Water (Scattering)
    // As we go up, introduce scatter from light
    vec3 midColor = mix(bottomColor, uColorShallow * 0.4, smoothstep(-0.2, 0.4, y));
    
    // 3. Sky/Surface (Top)
    vec3 skyHorizon = vec3(0.8, 0.9, 0.95); 
    vec3 topColor = mix(midColor, skyHorizon, smoothstep(0.4, 1.0, y));

    vec3 finalCol = topColor;

    // Sun Highlight
    float sun = max(0.0, dot(dir, vec3(0,1,0)));
    finalCol += uColorShallow * pow(sun, 8.0) * 0.4 * uLightIntensity;
    
    // Camera transition Logic (handled in JS usually, but kept for blending)
    // Here we primarily render the environment map.
    
    gl_FragColor = vec4(finalCol, 1.0);
}
`;

// 4. MAIN WATER SHADER 
const waterVertexShader = `
precision highp float;
uniform float uTime;
uniform float uWaveHeight;
uniform float uWaveSpeed;
uniform float uWaveScale;
uniform float uRoughness;
uniform sampler2D tRipple;
uniform vec2 uRippleCenter;
uniform float uRippleSize;
uniform float uRippleIntensity;
varying vec3 vWorldPos;
varying vec3 vViewPosition;
varying vec3 vNormal;
varying float vElevation;
varying float vDepth; 
${commonNoise}
float getShoaling(vec2 pos) {
    float noiseVal = snoise(pos * 0.0005); 
    return smoothstep(-0.5, 0.6, noiseVal); 
}
void calculateWave(vec2 dir, float wavelength, float speed, float amplitude, float seed, inout vec3 P, inout vec3 N, float shoalingFactor) {
    float activeAmp = amplitude * mix(1.0, 2.5, shoalingFactor * 0.5); 
    float activeSpeed = speed * mix(1.0, 0.6, shoalingFactor); 
    float k = 6.28318 / wavelength; 
    float w = k * activeSpeed;
    float phase = dot(dir, P.xz) * k + uTime * w + seed;
    float sinp = sin(phase);
    float cosp = cos(phase);
    float steepness = mix(uRoughness, uRoughness * 0.5, shoalingFactor);
    float Q = steepness / (k * activeAmp * 4.0); 
    float qa = Q * activeAmp;
    float wa = k * activeAmp;
    P.x -= dir.x * qa * sinp;
    P.z -= dir.y * qa * sinp;
    P.y += activeAmp * cosp;
    float wa_cos = wa * cosp;
    float wa_sin = wa * sinp;
    N.x -= dir.x * wa_sin;
    N.z -= dir.y * wa_sin;
    N.y -= wa_cos; 
}
void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vec3 finalPos = worldPosition.xyz;
    float shoaling = getShoaling(finalPos.xz);
    vDepth = shoaling;
    vec3 normalAccum = vec3(0.0, 1.0, 0.0);
    float h = uWaveHeight;
    float s = uWaveSpeed;
    float sc = max(0.1, uWaveScale);
    calculateWave(normalize(vec2(1.0, 0.1)), 160.0 * sc, 0.8 * s, 3.5 * h, 0.0, finalPos, normalAccum, shoaling);
    calculateWave(normalize(vec2(0.6, 0.7)), 90.0 * sc, 1.0 * s, 1.8 * h, 12.34, finalPos, normalAccum, shoaling);
    calculateWave(normalize(vec2(0.9, -0.4)), 75.0 * sc, 0.9 * s, 1.4 * h, 45.12, finalPos, normalAccum, shoaling);
    calculateWave(normalize(vec2(0.8, 0.4)), 35.0 * sc, 1.4 * s, 0.7 * h, 99.99, finalPos, normalAccum, shoaling);
    
    vec2 rippleUV = (finalPos.xz - uRippleCenter) / uRippleSize + 0.5;
    if (rippleUV.x >= 0.0 && rippleUV.x <= 1.0 && rippleUV.y >= 0.0 && rippleUV.y <= 1.0) {
        float rippleH = texture2D(tRipple, rippleUV).r * uRippleIntensity;
        finalPos.y += rippleH;
        float offset = 1.0 / 256.0; 
        float hL = texture2D(tRipple, rippleUV + vec2(-offset, 0.0)).r * uRippleIntensity;
        float hR = texture2D(tRipple, rippleUV + vec2(offset, 0.0)).r * uRippleIntensity;
        float hD = texture2D(tRipple, rippleUV + vec2(0.0, -offset)).r * uRippleIntensity;
        float hU = texture2D(tRipple, rippleUV + vec2(0.0, offset)).r * uRippleIntensity;
        vec3 rippleNormal = normalize(vec3(hL - hR, 2.0, hD - hU)); 
        normalAccum = normalize(normalAccum + (rippleNormal - vec3(0,1,0)) * 0.5);
    }
    vNormal = normalize(normalAccum);
    vWorldPos = finalPos; 
    vElevation = finalPos.y;
    vec4 mvPosition = viewMatrix * vec4(finalPos, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
}
`;

const waterFragmentShader = `
precision highp float;
uniform vec3 uColorDeep;
uniform vec3 uColorShallow;
uniform vec3 uFoamColor;
uniform vec3 uSunPosition;
uniform float uTime;
uniform float uWaveHeight;
uniform sampler2D tBackground; 
uniform vec2 uResolution;      
uniform float uRoughness;
uniform float uTransparency;
uniform float uNormalFlatness; 
uniform float uLightIntensity; 
varying vec3 vWorldPos;
varying vec3 vViewPosition;
varying vec3 vNormal;
varying float vElevation;
varying float vDepth; 
${commonNoise}

vec3 getSkyColor(vec3 rd) {
    vec3 sunDir = normalize(uSunPosition);
    float sunDot = max(dot(rd, sunDir), 0.0);
    vec3 col = mix(vec3(0.6, 0.7, 0.8), vec3(0.1, 0.3, 0.6), rd.y * 0.5 + 0.5);
    col += 0.8 * vec3(1.0, 0.95, 0.9) * pow(sunDot, 120.0);
    return col;
}

vec3 applyMicroNormals(vec3 geomNormal, vec3 worldPos, float time) {
    vec2 uv = worldPos.xz;
    vec2 uv1 = uv * 0.5 + vec2(time * 0.5, time * 0.2);
    float n1 = snoise(uv1);
    vec2 uv2 = uv * 1.5 - vec2(time * 0.4, time * 0.6);
    float n2 = snoise(uv2);
    vec3 microBump = vec3(n1, 6.0 / max(0.01, uRoughness), n2);
    return normalize(geomNormal + (microBump - 0.5) * 0.3);
}

void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 sunDir = normalize(uSunPosition);
    float dist = length(vViewPosition); 
    
    // --- UNDERWATER VIEW ---
    if (!gl_FrontFacing) {
        vec2 distort = vNormal.xz * 0.2; 
        vec3 distortedView = normalize(viewDir + vec3(distort.x, 0.0, distort.y));
        float NdotV = max(0.0, dot(vec3(0,1,0), distortedView));
        float fresnel = pow(1.0 - NdotV, 3.5); 
        
        vec3 skyColor = getSkyColor(distortedView);
        
        // Reflection of Deep (The Void)
        // Make this DARK to contrast with window
        vec3 deepReflect = uColorDeep * 0.2; 
        
        vec3 finalUnder = mix(skyColor, deepReflect, fresnel);
        
        // Rim glow
        float rim = smoothstep(0.0, 0.15, fresnel) * smoothstep(0.3, 0.0, fresnel);
        finalUnder += uColorShallow * rim * uLightIntensity;
        
        // Sun
        float sunDot = max(0.0, dot(distortedView, sunDir));
        finalUnder += vec3(1.0, 0.95, 0.8) * pow(sunDot, 40.0) * (1.0 - fresnel);

        gl_FragColor = vec4(finalUnder, uTransparency);
        return;
    }

    // --- SURFACE VIEW ---
    vec3 normal = normalize(vNormal);
    normal.xz *= (1.0 - uNormalFlatness); 
    normal = normalize(normal);
    normal = applyMicroNormals(normal, vWorldPos, uTime);

    // Foam
    vec2 foamUV = vWorldPos.xz * 1.2; 
    vec2 flow = vec2(uTime * 0.08, uTime * 0.04); 
    float f1 = snoise(foamUV + flow);
    float bubbles = pow((0.5 + 0.5 * f1), 2.0); 
    bubbles = smoothstep(0.3, 0.8, bubbles);
    float crestFoam = smoothstep(uWaveHeight * 0.8, uWaveHeight * 1.2, vElevation);
    float finalFoam = mix(bubbles * crestFoam, 1.0, smoothstep(0.9, 1.0, crestFoam));
    finalFoam *= (1.0 - smoothstep(100.0, 500.0, dist));

    // Fresnel
    float NdotV = max(dot(viewDir, normal), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
    
    // Refraction (Body Color)
    // Make surface look like it has depth
    vec3 refracted = mix(uColorDeep, uColorShallow, 0.5); 
    float sss = smoothstep(-1.0, 1.0, vElevation) * (1.0 - NdotV);
    refracted += uColorShallow * sss * 0.5;

    // Reflection
    vec3 refDir = reflect(-viewDir, normal);
    vec3 reflected = getSkyColor(refDir);
    
    // Specular
    vec3 halfVec = normalize(sunDir + viewDir);
    float NdotH = max(dot(normal, halfVec), 0.0);
    float specular = pow(NdotH, 800.0); 
    
    vec3 finalColor = mix(refracted, reflected, fresnel);
    finalColor += vec3(1.0) * specular;
    finalColor = mix(finalColor, uFoamColor, finalFoam);

    // Fog (Surface)
    float fog = smoothstep(200.0, 1000.0, dist);
    
    float foamOpacity = smoothstep(0.0, 0.5, finalFoam);
    float surfaceAlpha = mix(uTransparency, 1.0, foamOpacity);
    
    gl_FragColor = vec4(mix(finalColor, getSkyColor(viewDir), fog), surfaceAlpha);
}
`;

// 5. BUBBLES SHADERS (FIXED: Constrained below surface)
const bubbleVertexShader = `
uniform float uTime;
attribute float aScale;
attribute float aSpeed;
attribute float aRandom;
varying float vAlpha;

void main() {
    vec3 pos = position;
    
    // Rising mechanic
    // Define exact range: Rise from deep (-80) to just below surface (-2)
    float bottom = -80.0;
    float top = -2.0; 
    float range = top - bottom;
    
    // Use modulo to loop Y position within range
    // aRandom * 100.0 offsets the start cycle so they don't all loop together
    float loopY = mod(pos.y + uTime * aSpeed * 4.0, range);
    pos.y = bottom + loopY;
    
    // Lateral drift (wobble)
    float wobble = sin(uTime * 3.0 + aRandom * 10.0) * 0.5;
    pos.x += wobble;
    pos.z += cos(uTime * 2.0 + aRandom * 10.0) * 0.5;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aScale * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;

    // Fade logic: Fade in at bottom, fade out at top
    float fadeOut = 1.0 - smoothstep(top - 10.0, top, pos.y);
    float fadeIn = smoothstep(bottom, bottom + 10.0, pos.y);
    vAlpha = fadeIn * fadeOut;
}
`;

const bubbleFragmentShader = `
uniform vec3 uColor;
varying float vAlpha;

void main() {
    vec2 uv = gl_PointCoord.xy - vec2(0.5);
    float len = length(uv);
    if(len > 0.5) discard;

    // Bubble Aesthetics
    float rim = smoothstep(0.35, 0.45, len);
    float glow = 1.0 - smoothstep(0.0, 0.4, len);
    float spot = 1.0 - smoothstep(0.0, 0.12, length(uv - vec2(0.15, 0.15)));
    
    // Composition
    float alpha = (rim + spot + glow * 0.2) * 0.8;
    
    gl_FragColor = vec4(uColor, alpha * vAlpha);
}
`;

const TILE_SIZE = 1000;
const RIPPLE_SIZE = 256; 
const RIPPLE_WORLD_SIZE = 300; 

const WaterScene: React.FC<WaterSceneProps> = ({ config, initialCameraState }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialsRef = useRef<THREE.ShaderMaterial[]>([]);
  const frameIdRef = useRef<number>(0);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  // Group Refs
  const envMeshRef = useRef<THREE.Mesh | null>(null);
  const underwaterGroupRef = useRef<THREE.Group | null>(null);

  const mouse = useRef(new THREE.Vector2());
  const raycaster = useRef(new THREE.Raycaster());

  // Ripple Refs
  const rippleMeshRef = useRef<THREE.Mesh | null>(null);
  const rippleCameraRef = useRef<THREE.Camera | null>(null);
  const rippleSceneRef = useRef<THREE.Scene | null>(null);
  const currentBufferIndexRef = useRef(0);
  const rippleBuffersRef = useRef<THREE.WebGLRenderTarget[]>([]);
  const rippleMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const dropMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const waterMaterialRef = useRef<THREE.ShaderMaterial | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // RENDERER
    const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 5000);
    if (initialCameraState) camera.position.set(...initialCameraState.position);
    else camera.position.set(0, 20, 80);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI; 
    controls.minDistance = 1;
    controls.maxDistance = 500;
    if (initialCameraState) controls.target.set(...initialCameraState.target);

    // --- ENVIRONMENT ---
    const sunPos = new THREE.Vector3(50, 40, -100);

    // Unified Sky/Abyss Sphere
    const envGeo = new THREE.SphereGeometry(4500, 32, 32);
    const envMat = new THREE.ShaderMaterial({
        vertexShader: gradientVertexShader,
        fragmentShader: gradientFragmentShader,
        uniforms: { 
            uColorDeep: { value: new THREE.Color(config.colorDeep) }, 
            uColorShallow: { value: new THREE.Color(config.colorShallow) },
            uSunPosition: { value: sunPos },
            uTransition: { value: 0.0 },
            uLightIntensity: { value: config.underwaterLightIntensity }
        },
        side: THREE.BackSide
    });
    materialsRef.current.push(envMat);
    const envMesh = new THREE.Mesh(envGeo, envMat);
    envMeshRef.current = envMesh;
    scene.add(envMesh);

    // --- UNDERWATER GROUP ---
    const underwaterGroup = new THREE.Group();
    underwaterGroupRef.current = underwaterGroup;
    scene.add(underwaterGroup);

    // --- SEABED (PROCEDURAL TERRAIN) ---
    const bedGeo = new THREE.PlaneGeometry(1000, 1000, 256, 256);
    bedGeo.rotateX(-Math.PI / 2); 
    
    const bedMat = new THREE.ShaderMaterial({
        vertexShader: terrainVertexShader,
        fragmentShader: terrainFragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uColorDeep: { value: new THREE.Color(config.colorDeep) },
            uColorShallow: { value: new THREE.Color(config.colorShallow) },
            uLightIntensity: { value: config.underwaterLightIntensity }
        },
    });
    materialsRef.current.push(bedMat);
    const seabed = new THREE.Mesh(bedGeo, bedMat);
    seabed.position.y = -60; 
    underwaterGroup.add(seabed);

    // God Rays
    const rayGeo = new THREE.ConeGeometry(12, 200, 32, 1, true);
    rayGeo.translate(0, -100, 0); 
    const rayMat = new THREE.ShaderMaterial({
        vertexShader: godRayVertexShader,
        fragmentShader: godRayFragmentShader,
        uniforms: { 
            uTime: { value: 0 }, 
            uColor: { value: new THREE.Color(config.colorShallow) },
            uLightIntensity: { value: config.underwaterLightIntensity }
        },
        transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    });
    materialsRef.current.push(rayMat);
    for(let i=0; i<12; i++) {
        const ray = new THREE.Mesh(rayGeo, rayMat);
        const r = 10 + Math.random() * 80;
        const a = Math.random() * Math.PI * 2;
        ray.position.set(Math.cos(a)*r, 5, Math.sin(a)*r); 
        ray.rotation.x = (Math.random()-0.5)*0.2;
        ray.rotation.z = (Math.random()-0.5)*0.2;
        ray.scale.setScalar(0.8 + Math.random() * 0.5);
        underwaterGroup.add(ray);
    }
    
    // --- BUBBLES (LITTLE BUBBLES) ---
    const bCount = 400;
    const bGeo = new THREE.BufferGeometry();
    const bPos = new Float32Array(bCount * 3);
    const bScale = new Float32Array(bCount);
    const bSpeed = new Float32Array(bCount);
    const bRandom = new Float32Array(bCount);
    
    for(let i=0; i<bCount; i++) {
        // Spread bubbles around the center, mostly underwater
        const r = 40 * Math.sqrt(Math.random());
        const theta = Math.random() * 2 * Math.PI;
        bPos[i*3] = r * Math.cos(theta); // X
        // Y Position: Pre-seed randomly between bottom and top of range
        bPos[i*3+1] = Math.random() * 80 - 80; // range -80 to 0
        bPos[i*3+2] = r * Math.sin(theta); // Z
        
        bScale[i] = Math.random() * 1.5 + 0.5; // Small to medium size
        bSpeed[i] = Math.random() * 1.0 + 0.5; // Moderate speed
        bRandom[i] = Math.random();
    }
    
    bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    bGeo.setAttribute('aScale', new THREE.BufferAttribute(bScale, 1));
    bGeo.setAttribute('aSpeed', new THREE.BufferAttribute(bSpeed, 1));
    bGeo.setAttribute('aRandom', new THREE.BufferAttribute(bRandom, 1));
    
    const bMat = new THREE.ShaderMaterial({
        vertexShader: bubbleVertexShader,
        fragmentShader: bubbleFragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(config.colorShallow) }
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    materialsRef.current.push(bMat);
    const bubbles = new THREE.Points(bGeo, bMat);
    underwaterGroup.add(bubbles);


    // --- RIPPLES SETUP ---
    const rtParams = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.FloatType };
    rippleBuffersRef.current = [new THREE.WebGLRenderTarget(RIPPLE_SIZE, RIPPLE_SIZE, rtParams), new THREE.WebGLRenderTarget(RIPPLE_SIZE, RIPPLE_SIZE, rtParams)];
    const rippleScene = new THREE.Scene();
    rippleSceneRef.current = rippleScene;
    const rippleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    rippleCameraRef.current = rippleCamera;
    const rippleMat = new THREE.ShaderMaterial({ vertexShader: rippleVertexShader, fragmentShader: rippleFragmentShader, uniforms: { uTexture: { value: null }, uResolution: { value: new THREE.Vector2(RIPPLE_SIZE, RIPPLE_SIZE) }, uDamping: { value: config.rippleDamping } } });
    rippleMaterialRef.current = rippleMat;
    const dropMat = new THREE.ShaderMaterial({ vertexShader: rippleVertexShader, fragmentShader: rippleDropFragmentShader, uniforms: { uTexture: { value: null }, uCenter: { value: new THREE.Vector2() }, uRadius: { value: config.rippleRadius }, uStrength: { value: config.rippleStrength } } });
    dropMaterialRef.current = dropMat;
    const rippleMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), rippleMat);
    rippleMeshRef.current = rippleMesh;
    rippleScene.add(rippleMesh);

    // --- WATER SURFACE ---
    const waterMat = new THREE.ShaderMaterial({
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        uniforms: {
            uTime: { value: 0 }, uWaveHeight: { value: config.waveHeight }, uWaveSpeed: { value: config.waveSpeed }, uWaveScale: { value: config.waveScale }, uRoughness: { value: config.roughness },
            uColorDeep: { value: new THREE.Color(config.colorDeep) }, uColorShallow: { value: new THREE.Color(config.colorShallow) }, uFoamColor: { value: new THREE.Color(config.foamColor) },
            uTransparency: { value: config.transparency },
            uNormalFlatness: { value: config.normalFlatness / 100 }, 
            uLightIntensity: { value: config.underwaterLightIntensity },
            uSunPosition: { value: sunPos }, tBackground: { value: null }, uResolution: { value: new THREE.Vector2(width, height) },
            tRipple: { value: rippleBuffersRef.current[0].texture }, uRippleCenter: { value: new THREE.Vector2(0, 0) }, uRippleSize: { value: RIPPLE_WORLD_SIZE }, uRippleIntensity: { value: config.rippleIntensity }
        },
        side: THREE.DoubleSide, 
        transparent: true 
    });
    waterMaterialRef.current = waterMat;
    materialsRef.current.push(waterMat);
    
    const ocean = new THREE.Group();
    scene.add(ocean);
    const tileGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 128, 128);
    tileGeo.rotateX(-Math.PI / 2);
    const centerTile = new THREE.Mesh(tileGeo, waterMat);
    ocean.add(centerTile);

    // --- INTERACTION ---
    const updateMouse = (e: MouseEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    let isMouseDown = false;
    const addDrop = () => {
        raycaster.current.setFromCamera(mouse.current, camera);
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersectPoint = new THREE.Vector3();
        raycaster.current.ray.intersectPlane(plane, intersectPoint);
        if (intersectPoint) {
            const uvX = (intersectPoint.x + RIPPLE_WORLD_SIZE / 2) / RIPPLE_WORLD_SIZE;
            const uvY = (intersectPoint.z + RIPPLE_WORLD_SIZE / 2) / RIPPLE_WORLD_SIZE;
            if (uvX >= 0 && uvX <= 1 && uvY >= 0 && uvY <= 1) {
                const writeBuffer = rippleBuffersRef.current[currentBufferIndexRef.current];
                const readBuffer = rippleBuffersRef.current[1 - currentBufferIndexRef.current];
                dropMaterialRef.current!.uniforms.uTexture.value = readBuffer.texture;
                dropMaterialRef.current!.uniforms.uCenter.value.set(uvX, uvY);
                rippleMeshRef.current!.material = dropMaterialRef.current!;
                renderer.setRenderTarget(writeBuffer);
                renderer.render(rippleScene, rippleCamera);
                renderer.setRenderTarget(null);
                currentBufferIndexRef.current = 1 - currentBufferIndexRef.current;
            }
        }
    };
    const handlePointerMove = (e: MouseEvent) => { updateMouse(e); if (isMouseDown) addDrop(); };
    const handlePointerDown = (e: MouseEvent) => { isMouseDown = true; updateMouse(e); addDrop(); };
    const handlePointerUp = () => { isMouseDown = false; };
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('mouseup', handlePointerUp);

    // --- ANIMATION ---
    const clock = new THREE.Clock();
    const animate = () => {
        const time = clock.getElapsedTime();
        materialsRef.current.forEach(mat => { if(mat.uniforms.uTime) mat.uniforms.uTime.value = time; });

        // Ripples
        const readBuffer = rippleBuffersRef.current[1 - currentBufferIndexRef.current];
        const writeBuffer = rippleBuffersRef.current[currentBufferIndexRef.current];
        rippleMeshRef.current!.material = rippleMaterialRef.current!;
        rippleMaterialRef.current!.uniforms.uTexture.value = readBuffer.texture;
        renderer.setRenderTarget(writeBuffer);
        renderer.render(rippleScene, rippleCamera);
        renderer.setRenderTarget(null);
        currentBufferIndexRef.current = 1 - currentBufferIndexRef.current;
        waterMaterialRef.current!.uniforms.tRipple.value = writeBuffer.texture;

        controls.update();

        // --- SMOOTH TRANSITIONS ---
        // Calculate factor based on depth (-1m to +1m transition zone)
        const transition = THREE.MathUtils.clamp((0.5 - camera.position.y) / 1.0, 0, 1);
        
        // Update Fog (Use config Fog Density)
        const white = new THREE.Color(0xffffff);
        const deep = new THREE.Color(config.colorDeep);
        const shallow = new THREE.Color(config.colorShallow);
        
        // Brighter fog color mixing
        const underwaterFogColor = deep.clone().lerp(shallow, 0.5 * config.underwaterLightIntensity * 0.3); 
        const fogColor = white.clone().lerp(underwaterFogColor, transition);
        
        // Use user fog density
        const fogDensity = THREE.MathUtils.lerp(0.0002, config.underwaterFogDensity * 0.05, transition);
        
        if(scene.fog instanceof THREE.FogExp2) {
             scene.fog.color.copy(fogColor);
             scene.fog.density = fogDensity;
        } else {
             scene.fog = new THREE.FogExp2(fogColor, fogDensity);
        }

        // Update Background Uniform
        if(envMeshRef.current) {
            (envMeshRef.current.material as THREE.ShaderMaterial).uniforms.uTransition.value = transition;
            // Keep sphere centered on camera
            envMeshRef.current.position.copy(camera.position);
        }

        // Visibility
        if(underwaterGroupRef.current) {
             // Fade out underwater objects when far above surface?
             // Or just hide them if very high up to save perf
             underwaterGroupRef.current.visible = camera.position.y < 50;
        }

        // Tiling
        const snapX = Math.floor(camera.position.x / TILE_SIZE + 0.5) * TILE_SIZE;
        const snapZ = Math.floor(camera.position.z / TILE_SIZE + 0.5) * TILE_SIZE;
        centerTile.position.set(snapX, 0, snapZ);

        renderer.render(scene, camera);
        frameIdRef.current = requestAnimationFrame(animate);
    };
    frameIdRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
        if(!containerRef.current || !rendererRef.current) return;
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        rendererRef.current.setSize(w, h);
        camera.aspect = w/h;
        camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    return () => {
        cancelAnimationFrame(frameIdRef.current);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('mousemove', handlePointerMove);
        window.removeEventListener('mousedown', handlePointerDown);
        window.removeEventListener('mouseup', handlePointerUp);
        if(containerRef.current) containerRef.current.innerHTML = '';
        renderer.dispose();
    };
  }, []);

  // Update Props
  useEffect(() => {
    const deep = new THREE.Color(config.colorDeep);
    const shallow = new THREE.Color(config.colorShallow);
    const foam = new THREE.Color(config.foamColor);
    materialsRef.current.forEach(mat => {
        if(mat.uniforms.uColorDeep) mat.uniforms.uColorDeep.value.copy(deep);
        if(mat.uniforms.uColorShallow) mat.uniforms.uColorShallow.value.copy(shallow);
        if(mat.uniforms.uColor) mat.uniforms.uColor.value.copy(
            mat.vertexShader === godRayVertexShader ? shallow : 
            mat.vertexShader === bubbleVertexShader ? shallow : deep
        );
        if(mat.uniforms.uLightColor) mat.uniforms.uLightColor.value.copy(shallow);
        if(mat.uniforms.uWaveHeight) mat.uniforms.uWaveHeight.value = config.waveHeight;
        if(mat.uniforms.uWaveSpeed) mat.uniforms.uWaveSpeed.value = config.waveSpeed;
        if(mat.uniforms.uWaveScale) mat.uniforms.uWaveScale.value = config.waveScale;
        if(mat.uniforms.uRoughness) mat.uniforms.uRoughness.value = config.roughness;
        if(mat.uniforms.uRippleIntensity) mat.uniforms.uRippleIntensity.value = config.rippleIntensity;
        // Update Transparency
        if(mat.uniforms.uTransparency) mat.uniforms.uTransparency.value = config.transparency;
        // Update Normal Flatness
        if(mat.uniforms.uNormalFlatness) mat.uniforms.uNormalFlatness.value = config.normalFlatness / 100;
        // Update Light Intensity
        if(mat.uniforms.uLightIntensity) mat.uniforms.uLightIntensity.value = config.underwaterLightIntensity;
    });
    if(dropMaterialRef.current) {
        dropMaterialRef.current.uniforms.uRadius.value = config.rippleRadius;
        dropMaterialRef.current.uniforms.uStrength.value = config.rippleStrength;
    }
    if(rippleMaterialRef.current) rippleMaterialRef.current.uniforms.uDamping.value = config.rippleDamping;
  }, [config]);

  return <div ref={containerRef} style={{position:'absolute', top:0, left:0, width:'100%', height:'100%', background:'#000'}} />;
};

export default WaterScene;
