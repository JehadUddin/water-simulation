
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

// --- SHADER UTILS (Shared Noise Function) ---
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

// 1. VOLUMETRIC GOD RAYS
const godRayVertexShader = `
varying vec2 vUv;
varying float vAlpha;
uniform float uTime;
${commonNoise}
void main() {
    vUv = uv;
    vec3 pos = position;
    // Organic sway based on depth
    float sway = snoise(vec2(pos.y * 0.05, uTime * 0.15)) * 6.0;
    pos.x += sway * (1.0 - uv.y); 
    pos.z += sway * 0.5 * (1.0 - uv.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    // Fade out top (surface) and bottom (deep)
    vAlpha = smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.6, uv.y);
}
`;
const godRayFragmentShader = `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
${commonNoise}
void main() {
    // Scrolling noise patterns to simulate light passing through waves
    float n1 = snoise(vec2(vUv.x * 3.0 + uTime * 0.1, vUv.y * 0.5 - uTime * 0.2));
    float n2 = snoise(vec2(vUv.x * 6.0 - uTime * 0.05, vUv.y * 2.0 - uTime * 0.4));
    
    // Combine for complex interference pattern
    float beam = smoothstep(0.4, 0.8, n1 * 0.5 + n2 * 0.5 + 0.45);
    
    // Soft horizontal edges for the beam
    float xFade = 1.0 - abs(vUv.x - 0.5) * 2.0;
    xFade = smoothstep(0.0, 0.4, xFade);

    float alpha = vAlpha * beam * xFade * 0.15; 
    gl_FragColor = vec4(uColor, alpha);
}
`;

// 2. SHARP "GOBO" CAUSTICS
const causticsVertexShader = `
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
    vUv = uv;
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;
const causticsFragmentShader = `
uniform float uTime;
uniform vec3 uColor;       
uniform vec3 uLightColor;  
varying vec2 vUv;
varying vec3 vWorldPos;

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

void main() {
    vec2 uv = vWorldPos.xz * 0.06; 
    
    // Dual-layer Voronoi for complex movement
    float v1 = voronoi(uv * 1.0 + uTime * 0.1);
    float v2 = voronoi(uv * 1.5 - vec2(uTime * 0.05, 0.0));
    
    // Min distance
    float c = min(v1, v2);
    
    // AAA TRICK: Invert and sharpen powerfully.
    // Real caustics are focused light, so they are thin bright lines.
    float light = 1.0 - sqrt(c);
    light = pow(light, 16.0); // Extreme sharpening
    
    // AAA TRICK: Chromatic Aberration
    // Sample the noise at slightly different offsets for R and B channels
    float aberration = 0.004;
    float r = pow(1.0 - sqrt(min(voronoi(uv * 1.0 + uTime * 0.1 + aberration), v2)), 16.0);
    float b = pow(1.0 - sqrt(min(voronoi(uv * 1.0 + uTime * 0.1 - aberration), v2)), 16.0);
    
    vec3 causticColor = vec3(r, light, b);

    // Falloff vignette
    float dist = length(vWorldPos.xz);
    float vign = smoothstep(120.0, 40.0, dist);
    
    vec3 finalColor = uColor * 0.2 + uLightColor * causticColor * 3.0 * vign;
    
    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// 3. UNIFIED ENVIRONMENT GRADIENT (Sky + Abyss)
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
uniform float uTransition; // 0.0 (Above) to 1.0 (Below)
uniform vec3 uSunPosition;
varying vec3 vWorldPos;

void main() {
    vec3 dir = normalize(vWorldPos);
    
    // -- ABYSS LAYER --
    float t = smoothstep(-200.0, 10.0, vWorldPos.y);
    vec3 abyss = mix(vec3(0.0), uColorDeep, t * 0.9 + 0.1); 
    // Underwater Sun Glow
    float sun = max(0.0, dot(dir, vec3(0,1,0)));
    abyss = mix(abyss, uColorShallow, pow(sun, 6.0) * 0.3); 
    
    // -- SKY LAYER --
    // Simple gradients
    vec3 skyHorizon = vec3(0.8, 0.9, 0.95); // White-ish blue at horizon
    vec3 skyZenith = vec3(0.2, 0.5, 0.9);   // Deep blue at top
    vec3 sky = mix(skyHorizon, skyZenith, smoothstep(0.0, 0.5, dir.y));
    
    // Sun Disc
    float sunDot = max(0.0, dot(dir, normalize(uSunPosition)));
    sky += vec3(1.0, 0.9, 0.8) * pow(sunDot, 64.0);
    // Sun Glow
    sky += vec3(1.0, 0.9, 0.7) * pow(sunDot, 4.0) * 0.2;

    // Mix based on camera state (smoothed in JS)
    vec3 finalCol = mix(sky, abyss, uTransition);
    
    gl_FragColor = vec4(finalCol, 1.0);
}
`;

// 4. MAIN WATER SHADER (With Snell's Window Fix)
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
varying vec3 vWorldPos;
varying vec3 vViewPosition;
varying vec3 vNormal;
varying float vElevation;
varying float vDepth; 
${commonNoise}

vec3 getSkyColor(vec3 rd) {
    vec3 sunDir = normalize(uSunPosition);
    float sunDot = max(dot(rd, sunDir), 0.0);
    // Simple gradient for reflections
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
    
    // --- AAA UNDERWATER LOGIC (Snell's Window) ---
    // If we are looking at the backface (underwater looking up):
    if (!gl_FrontFacing) {
        
        vec2 distort = vNormal.xz * 0.3; 
        vec3 distortedView = normalize(viewDir + vec3(distort.x, 0.0, distort.y));
        
        // Critical Angle (Approximate)
        float NdotV = max(0.0, dot(vec3(0,1,0), distortedView));
        
        // Fresnel curve
        float fresnel = pow(1.0 - NdotV, 3.0); 
        
        // 1. SKY (Refraction)
        vec3 skyColor = getSkyColor(distortedView);
        
        // 2. REFLECTION OF DEEP
        // FIX: Don't use dark black multiplier. Blend shallow and deep for a translucent look.
        vec3 deepReflect = mix(uColorDeep, uColorShallow, 0.3); 
        
        vec3 finalUnder = mix(skyColor, deepReflect, fresnel);
        
        // Sun Spot
        float sunDot = max(0.0, dot(distortedView, sunDir));
        finalUnder += vec3(1.0, 0.95, 0.8) * pow(sunDot, 30.0) * (1.0 - fresnel);

        gl_FragColor = vec4(finalUnder, 1.0);
        return;
    }

    // --- SURFACE VIEW ---
    vec3 normal = normalize(vNormal);
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

    // Fresnel & Reflection
    float NdotV = max(dot(viewDir, normal), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
    
    vec3 refracted = mix(uColorDeep, uColorShallow, 0.6); 
    float sss = smoothstep(-1.0, 1.0, vElevation) * (1.0 - NdotV);
    refracted += uColorShallow * sss * 0.5;

    vec3 refDir = reflect(-viewDir, normal);
    vec3 reflected = getSkyColor(refDir);
    
    vec3 halfVec = normalize(sunDir + viewDir);
    float NdotH = max(dot(normal, halfVec), 0.0);
    float specular = pow(NdotH, 800.0); 
    
    vec3 finalColor = mix(refracted, reflected, fresnel);
    finalColor += vec3(1.0) * specular;
    
    finalColor = mix(finalColor, uFoamColor, finalFoam);

    // We let global fog handle distance fading, but can mix slightly here to avoid hard edges
    float fog = smoothstep(200.0, 1000.0, dist);
    gl_FragColor = vec4(mix(finalColor, getSkyColor(viewDir), fog), 1.0);
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
            uTransition: { value: 0.0 }
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

    // Seabed (Caustics)
    const bedGeo = new THREE.PlaneGeometry(300, 300, 128, 128);
    bedGeo.rotateX(-Math.PI / 2);
    const bedMat = new THREE.ShaderMaterial({
        vertexShader: causticsVertexShader,
        fragmentShader: causticsFragmentShader,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(config.colorDeep) }, uLightColor: { value: new THREE.Color(config.colorShallow) } },
        transparent: true,
        blending: THREE.AdditiveBlending, 
    });
    materialsRef.current.push(bedMat);
    const seabed = new THREE.Mesh(bedGeo, bedMat);
    seabed.position.y = -50;
    underwaterGroup.add(seabed);

    // God Rays
    const rayGeo = new THREE.ConeGeometry(12, 200, 32, 1, true);
    rayGeo.translate(0, -100, 0); 
    const rayMat = new THREE.ShaderMaterial({
        vertexShader: godRayVertexShader,
        fragmentShader: godRayFragmentShader,
        uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(config.colorShallow) } },
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
        
        // Update Fog
        const white = new THREE.Color(0xffffff);
        const deep = new THREE.Color(config.colorDeep);
        const fogColor = white.clone().lerp(deep, transition);
        const fogDensity = THREE.MathUtils.lerp(0.0002, 0.02, transition);
        
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
        if(mat.uniforms.uColor) mat.uniforms.uColor.value.copy(mat.vertexShader === godRayVertexShader ? shallow : deep);
        if(mat.uniforms.uLightColor) mat.uniforms.uLightColor.value.copy(shallow);
        if(mat.uniforms.uWaveHeight) mat.uniforms.uWaveHeight.value = config.waveHeight;
        if(mat.uniforms.uWaveSpeed) mat.uniforms.uWaveSpeed.value = config.waveSpeed;
        if(mat.uniforms.uRippleIntensity) mat.uniforms.uRippleIntensity.value = config.rippleIntensity;
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
