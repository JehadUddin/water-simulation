
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
}

// --- RIPPLE SIMULATION SHADERS ---

const rippleVertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

const rippleFragmentShader = `
precision highp float;
uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform float uDamping;

varying vec2 vUv;

void main() {
    vec2 pixel = 1.0 / uResolution;
    
    // Sample neighbors
    float left = texture2D(uTexture, vUv + vec2(-pixel.x, 0.0)).r;
    float right = texture2D(uTexture, vUv + vec2(pixel.x, 0.0)).r;
    float up = texture2D(uTexture, vUv + vec2(0.0, -pixel.y)).r;
    float down = texture2D(uTexture, vUv + vec2(0.0, pixel.y)).r;
    
    vec4 current = texture2D(uTexture, vUv);
    
    // Wave equation: Acceleration = Laplacian * Speed
    // Simplified: (Average of neighbors - Current) * Speed
    float average = (left + right + up + down) * 0.25;
    float vel = (average - current.r) * 2.0;
    
    // Apply velocity to height (R channel) and damp velocity (G channel)
    current.g = (current.g + vel) * uDamping;
    current.r += current.g;
    
    // Prevent runaway
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
        // Smooth drop shape
        float drop = pow(max(0.0, 1.0 - dist / uRadius), 2.0);
        info.r -= drop * uStrength; // Negative for depression, or positive for peak
        info.g -= drop * uStrength * 0.5; // Add some impulse
    }
    
    gl_FragColor = info;
}
`;

// --- NOISE FUNCTIONS (Shared) ---
const noiseCommon = `
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
           -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy) );
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
  + i.x + vec3(0.0, i1.x, 1.0 ));
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

// --- VERTEX SHADER ---
const waterVertexShader = `
precision highp float;

uniform float uTime;
uniform float uWaveHeight;
uniform float uWaveSpeed;
uniform float uWaveScale;
uniform float uRoughness;

// Ripple Uniforms
uniform sampler2D tRipple;
uniform vec2 uRippleCenter;
uniform float uRippleSize;
uniform float uRippleIntensity;

varying vec3 vWorldPos;
varying vec3 vViewPosition;
varying vec3 vNormal;
varying float vElevation;
varying float vDepth; 

${noiseCommon}

float getShoaling(vec2 pos) {
    float noiseVal = snoise(pos * 0.0005); 
    return smoothstep(-0.5, 0.6, noiseVal); 
}

void calculateWave(
    vec2 dir, float wavelength, float speed, float amplitude, float seed,
    inout vec3 P, inout vec3 N, float shoalingFactor
) {
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

    // Sum of amplitudes: 3.5 + 1.8 + 1.4 + 0.7 + 0.3 + 0.2 = ~7.9
    // This multiplier setup creates rich detailed waves
    calculateWave(normalize(vec2(1.0, 0.1)), 160.0 * sc, 0.8 * s, 3.5 * h, 0.0, finalPos, normalAccum, shoaling);
    calculateWave(normalize(vec2(0.6, 0.7)), 90.0 * sc, 1.0 * s, 1.8 * h, 12.34, finalPos, normalAccum, shoaling);
    calculateWave(normalize(vec2(0.9, -0.4)), 75.0 * sc, 0.9 * s, 1.4 * h, 45.12, finalPos, normalAccum, shoaling);
    calculateWave(normalize(vec2(0.8, 0.4)), 35.0 * sc, 1.4 * s, 0.7 * h, 99.99, finalPos, normalAccum, shoaling);
    calculateWave(normalize(vec2(0.5, 0.8)), 18.0 * sc, 1.7 * s, 0.3 * h, 137.5, finalPos, normalAccum, shoaling);
    calculateWave(normalize(vec2(0.7, -0.6)), 12.0 * sc, 1.9 * s, 0.2 * h, 256.0, finalPos, normalAccum, shoaling);

    // --- INTERACTIVE RIPPLE DISPLACEMENT ---
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

// --- FRAGMENT SHADER ---
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

${noiseCommon}

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
    vec3 microBump = vec3(n1, 8.0 / max(0.01, uRoughness), n2);
    return normalize(geomNormal + (microBump - 0.5) * 0.3);
}

void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 sunDir = normalize(uSunPosition);
    float dist = length(vViewPosition); 

    vec3 normal = normalize(vNormal);
    normal = applyMicroNormals(normal, vWorldPos, uTime);

    // --- IMPROVED FOAM LOGIC ---
    
    // 1. Better Bubble Texture (Higher Frequency, more organic)
    vec2 foamUV = vWorldPos.xz * 1.2; 
    vec2 flow = vec2(uTime * 0.08, uTime * 0.04); 

    float f1 = snoise(foamUV + flow);
    float f2 = snoise(foamUV * 2.0 - flow * 1.5);
    
    // Organic cellular look
    float bubbles = (0.5 + 0.5 * f1) * (0.5 + 0.5 * f2);
    bubbles = pow(bubbles, 2.0); // Sharpen
    bubbles = smoothstep(0.3, 0.8, bubbles);

    // 2. Adaptive Thresholds based on Wave Height scale
    // Calculate slope intensity relative to wave height to maintain consistent foam coverage
    // dFdx/dFdy give screen space derivatives, but we want world space feel.
    // Length of gradient approximates slope.
    float slope = length(vec2(dFdx(vElevation), dFdy(vElevation)));
    
    // Normalize slope by wave height so increasing height doesn't just fill screen with foam
    float normalizedSlope = slope / max(0.01, uWaveHeight);

    // Estimate max probable height based on vertex shader amplitudes (~8x base height)
    float probableMaxHeight = uWaveHeight * 6.0;
    
    float crestBase = probableMaxHeight * 0.55; 
    float breakNoise = snoise(vWorldPos.xz * 0.03 + uTime * 0.05);
    
    // Elevation Mask: Trigger near tops
    float elevationMask = smoothstep(crestBase + breakNoise * uWaveHeight, probableMaxHeight, vElevation);
    
    // Slope Mask: Trigger on steep faces (normalized)
    float slopeMask = smoothstep(0.05, 0.15, normalizedSlope); 
    
    float crestFoam = elevationMask;
    
    // Add foam to steep slopes (breaking waves), but weight it lower than top crests
    crestFoam += slopeMask * 0.3;
    crestFoam = clamp(crestFoam, 0.0, 1.0);

    // 3. Shore/Depth Foam
    float tide = sin(uTime * 0.4 + vWorldPos.x * 0.05) * 0.08 
               + cos(uTime * 0.3 + vWorldPos.z * 0.05) * 0.08;
    
    float edgeFoam = smoothstep(0.85 + tide, 1.0, vDepth);
    float washFoam = smoothstep(0.6 + tide, 0.95, vDepth) * 0.6;

    // Combine
    float foamIntensity = max(crestFoam, max(edgeFoam, washFoam));
    
    // Apply bubble pattern to the foam intensity
    // Mix solid foam at very high intensity with bubbles at medium intensity
    float finalFoam = mix(bubbles * foamIntensity, 1.0, smoothstep(0.8, 1.0, foamIntensity));
    
    float distFade = 1.0 - smoothstep(100.0, 800.0, dist);
    finalFoam *= distFade;

    // --- LIGHTING & COLOR ---

    float NdotV = max(dot(viewDir, normal), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

    vec2 screenUV = gl_FragCoord.xy / uResolution;
    vec2 refractUV = screenUV + normal.xz * 0.015; 
    vec3 refractedColor = texture2D(tBackground, refractUV).rgb;

    float opticalDepth = dist;
    vec3 absorptionCoeffs = vec3(0.012, 0.004, 0.001);
    vec3 transmittance = exp(-opticalDepth * absorptionCoeffs);

    float heightMix = smoothstep(-uWaveHeight, uWaveHeight * 0.6, vElevation);
    float depthMix = smoothstep(0.0, 0.9, vDepth);
    float churnMix = foamIntensity * 0.25; 
    
    float totalColorMix = clamp(heightMix * 0.4 + depthMix * 0.6 + churnMix, 0.0, 1.0);
    vec3 waterVolumeColor = mix(uColorDeep, uColorShallow, totalColorMix);

    vec3 underwater = refractedColor * waterVolumeColor * transmittance * 1.5;

    float sunViewDot = max(0.0, dot(viewDir, -sunDir));
    float backlight = pow(sunViewDot, 8.0); 
    
    float thickness = smoothstep(-0.5, uWaveHeight, vElevation);
    
    float ambientScatter = smoothstep(0.0, 1.0, vElevation) * 0.3;
    float shoreScatter = vDepth * 0.6; 
    
    float scatterTotal = (backlight * 3.0) + ambientScatter + shoreScatter;
    
    vec3 sssColor = mix(uColorDeep, uColorShallow, clamp(thickness + shoreScatter * 0.5, 0.0, 1.0));
    vec3 sss = sssColor * scatterTotal * thickness * 0.8; 
    
    underwater += sss;

    vec3 refDir = reflect(-viewDir, normal);
    vec3 skyRefl = getSkyColor(refDir);
    
    vec3 halfVec = normalize(sunDir + viewDir);
    float NdotH = max(dot(normal, halfVec), 0.0);
    float specular = pow(NdotH, 500.0) * 2.0; 
    
    vec3 reflectedColor = skyRefl + vec3(1.0) * specular;

    vec3 finalColor = mix(underwater, reflectedColor, fresnel);

    float waterDepth = (1.0 - vDepth) * 5.0; 
    float shallow = smoothstep(0.0, 2.0, waterDepth);
    finalColor = mix(finalColor * 1.3, finalColor, shallow);
    
    finalColor = mix(finalColor, uFoamColor, clamp(finalFoam, 0.0, 1.0));

    float fog = smoothstep(500.0, 1500.0, dist);
    gl_FragColor = vec4(mix(finalColor, getSkyColor(viewDir), fog), 1.0);
}
`;

const skyVertexShader = `
varying vec3 vWorldPosition;
void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const skyFragmentShader = `
uniform vec3 topColor;
uniform vec3 bottomColor;
uniform float offset;
uniform float exponent;
uniform vec3 uSunPosition;

varying vec3 vWorldPosition;

void main() {
    vec3 viewDirection = normalize(vWorldPosition);
    float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
    vec3 skyGrad = mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
    vec3 sunDir = normalize(uSunPosition);
    float sunDist = dot(viewDirection, sunDir);
    float sunHalo = pow(max(0.0, sunDist), 400.0) * 1.5;
    float sunDisc = smoothstep(0.998, 0.999, sunDist) * 10.0;
    gl_FragColor = vec4(skyGrad + vec3(1.0, 0.9, 0.7) * (sunHalo + sunDisc), 1.0);
}
`;

const TILE_SIZE = 1000;
const RIPPLE_SIZE = 256; 
const RIPPLE_WORLD_SIZE = 300; 

const WaterScene: React.FC<WaterSceneProps> = ({ config }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const bgRenderTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const frameIdRef = useRef<number>(0);

  // Ripple Refs
  const rippleMeshRef = useRef<THREE.Mesh | null>(null);
  const rippleCameraRef = useRef<THREE.Camera | null>(null);
  const rippleSceneRef = useRef<THREE.Scene | null>(null);
  const currentBufferIndexRef = useRef(0);
  const rippleBuffersRef = useRef<THREE.WebGLRenderTarget[]>([]);
  const rippleMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  const dropMaterialRef = useRef<THREE.ShaderMaterial | null>(null);

  const sunPos = new THREE.Vector3(50, 40, -100);
  const mouse = useRef(new THREE.Vector2());
  const raycaster = useRef(new THREE.Raycaster());

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const renderer = new THREE.WebGLRenderer({ 
        alpha: false, 
        antialias: true,
        powerPreference: 'high-performance',
        depth: true,
        stencil: false,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const rtParams = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.FloatType, 
        depthBuffer: false,
        stencilBuffer: false,
    };
    const rippleBuffer1 = new THREE.WebGLRenderTarget(RIPPLE_SIZE, RIPPLE_SIZE, rtParams);
    const rippleBuffer2 = new THREE.WebGLRenderTarget(RIPPLE_SIZE, RIPPLE_SIZE, rtParams);
    rippleBuffersRef.current = [rippleBuffer1, rippleBuffer2];

    const rippleScene = new THREE.Scene();
    rippleSceneRef.current = rippleScene;
    
    const rippleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    rippleCameraRef.current = rippleCamera;

    const rippleGeo = new THREE.PlaneGeometry(2, 2);

    const rippleMaterial = new THREE.ShaderMaterial({
        vertexShader: rippleVertexShader,
        fragmentShader: rippleFragmentShader,
        uniforms: {
            uTexture: { value: null },
            uResolution: { value: new THREE.Vector2(RIPPLE_SIZE, RIPPLE_SIZE) },
            uDamping: { value: config.rippleDamping }
        }
    });
    rippleMaterialRef.current = rippleMaterial;

    const dropMaterial = new THREE.ShaderMaterial({
        vertexShader: rippleVertexShader,
        fragmentShader: rippleDropFragmentShader,
        uniforms: {
            uTexture: { value: null },
            uCenter: { value: new THREE.Vector2() },
            uRadius: { value: config.rippleRadius }, 
            uStrength: { value: config.rippleStrength }
        }
    });
    dropMaterialRef.current = dropMaterial;

    const rippleMesh = new THREE.Mesh(rippleGeo, rippleMaterial);
    rippleScene.add(rippleMesh);
    rippleMeshRef.current = rippleMesh;

    // --- MAIN SCENE ---

    const bgRenderTarget = new THREE.WebGLRenderTarget(width * window.devicePixelRatio, height * window.devicePixelRatio, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        stencilBuffer: false,
    });
    bgRenderTargetRef.current = bgRenderTarget;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff); 
    scene.fog = new THREE.FogExp2(0xffffff, 0.00015);

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 5000);
    camera.position.set(0, 20, 80); 
    
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 10;
    controls.maxDistance = 500;
    controls.target.set(0, 0, -20);

    const waterMaterial = new THREE.ShaderMaterial({
        vertexShader: waterVertexShader,
        fragmentShader: waterFragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uWaveHeight: { value: config.waveHeight },
            uWaveSpeed: { value: config.waveSpeed },
            uWaveScale: { value: config.waveScale },
            uRoughness: { value: config.roughness },
            uColorDeep: { value: new THREE.Color(config.colorDeep) },
            uColorShallow: { value: new THREE.Color(config.colorShallow) },
            uFoamColor: { value: new THREE.Color(config.foamColor) },
            uSunPosition: { value: sunPos },
            tBackground: { value: null },
            uResolution: { value: new THREE.Vector2(width * window.devicePixelRatio, height * window.devicePixelRatio) },
            
            // New Ripple Uniforms
            tRipple: { value: rippleBuffer1.texture },
            uRippleCenter: { value: new THREE.Vector2(0, 0) },
            uRippleSize: { value: RIPPLE_WORLD_SIZE },
            uRippleIntensity: { value: config.rippleIntensity }
        },
        side: THREE.FrontSide,
        wireframe: false,
    });
    materialRef.current = waterMaterial;

    const oceanGroup = new THREE.Group();
    scene.add(oceanGroup);

    const highResGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 256, 256);
    highResGeo.rotateX(-Math.PI / 2);
    
    const lowResGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 64, 64);
    lowResGeo.rotateX(-Math.PI / 2);

    const centerTile = new THREE.Mesh(highResGeo, waterMaterial);
    oceanGroup.add(centerTile);

    const outerTiles: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
        const mesh = new THREE.Mesh(lowResGeo, waterMaterial);
        outerTiles.push(mesh);
        oceanGroup.add(mesh);
    }

    const skyGeom = new THREE.SphereGeometry(4500, 32, 32);
    const skyMat = new THREE.ShaderMaterial({
        vertexShader: skyVertexShader,
        fragmentShader: skyFragmentShader,
        uniforms: {
            topColor: { value: new THREE.Color(0x2266aa) }, 
            bottomColor: { value: new THREE.Color(0xffffff) }, 
            offset: { value: 33 },
            exponent: { value: 0.6 },
            uSunPosition: { value: sunPos }
        },
        side: THREE.BackSide
    });
    const sky = new THREE.Mesh(skyGeom, skyMat);
    scene.add(sky);

    // --- INTERACTION ---
    const updateMouse = (e: MouseEvent) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    
    let lastIntersect: THREE.Vector3 | null = null;
    let isMouseDown = false;

    const handlePointerMove = (e: MouseEvent) => {
        updateMouse(e);
        if (isMouseDown) addDrop(e);
    };
    const handlePointerDown = (e: MouseEvent) => {
        isMouseDown = true;
        addDrop(e);
    };
    const handlePointerUp = () => {
        isMouseDown = false;
        lastIntersect = null;
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('mouseup', handlePointerUp);

    const addDrop = (e: MouseEvent) => {
        raycaster.current.setFromCamera(mouse.current, camera);
        const planeNormal = new THREE.Vector3(0, 1, 0);
        const planeConstant = 0;
        const plane = new THREE.Plane(planeNormal, planeConstant);
        
        const intersectPoint = new THREE.Vector3();
        raycaster.current.ray.intersectPlane(plane, intersectPoint);

        if (intersectPoint) {
            const uvX = (intersectPoint.x + RIPPLE_WORLD_SIZE / 2) / RIPPLE_WORLD_SIZE;
            const uvY = (intersectPoint.z + RIPPLE_WORLD_SIZE / 2) / RIPPLE_WORLD_SIZE;
            
            if (uvX >= 0 && uvX <= 1 && uvY >= 0 && uvY <= 1) {
                const writeBuffer = rippleBuffersRef.current[currentBufferIndexRef.current];
                const readBuffer = rippleBuffersRef.current[1 - currentBufferIndexRef.current];
                
                if (dropMaterialRef.current && rippleMeshRef.current && rippleCameraRef.current) {
                    dropMaterialRef.current.uniforms.uTexture.value = readBuffer.texture;
                    dropMaterialRef.current.uniforms.uCenter.value.set(uvX, uvY);
                    
                    rippleMeshRef.current.material = dropMaterialRef.current;
                    renderer.setRenderTarget(writeBuffer);
                    renderer.render(rippleSceneRef.current!, rippleCameraRef.current);
                    renderer.setRenderTarget(null);
                    
                    currentBufferIndexRef.current = 1 - currentBufferIndexRef.current;
                }
            }
        }
    };

    const animate = (time: number) => {
        const t = time * 0.001;
        
        const readBuffer = rippleBuffersRef.current[1 - currentBufferIndexRef.current];
        const writeBuffer = rippleBuffersRef.current[currentBufferIndexRef.current];

        if (rippleMaterialRef.current && rippleMeshRef.current && rippleCameraRef.current) {
            rippleMeshRef.current.material = rippleMaterialRef.current;
            rippleMaterialRef.current.uniforms.uTexture.value = readBuffer.texture;
            
            renderer.setRenderTarget(writeBuffer);
            renderer.render(rippleSceneRef.current!, rippleCameraRef.current);
            renderer.setRenderTarget(null);
            
            currentBufferIndexRef.current = 1 - currentBufferIndexRef.current;
            
            if (materialRef.current) {
                materialRef.current.uniforms.uTime.value = t;
                materialRef.current.uniforms.tRipple.value = writeBuffer.texture;
            }
        }

        controls.update();

        oceanGroup.visible = false;
        if (bgRenderTargetRef.current) {
            renderer.setRenderTarget(bgRenderTargetRef.current);
            renderer.render(scene, camera);
            renderer.setRenderTarget(null); 
            if (materialRef.current) {
                 materialRef.current.uniforms.tBackground.value = bgRenderTargetRef.current.texture;
            }
        }

        oceanGroup.visible = true;

        const snapX = Math.floor(camera.position.x / TILE_SIZE + 0.5) * TILE_SIZE;
        const snapZ = Math.floor(camera.position.z / TILE_SIZE + 0.5) * TILE_SIZE;

        centerTile.position.set(snapX, 0, snapZ);

        let tileIndex = 0;
        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                if (x === 0 && z === 0) continue;
                if (outerTiles[tileIndex]) {
                    outerTiles[tileIndex].position.set(snapX + x * TILE_SIZE, 0, snapZ + z * TILE_SIZE);
                    tileIndex++;
                }
            }
        }
        
        renderer.render(scene, camera);
        frameIdRef.current = requestAnimationFrame(animate);
    };
    frameIdRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
        if (containerRef.current && rendererRef.current) {
            const w = containerRef.current.clientWidth;
            const h = containerRef.current.clientHeight;
            rendererRef.current.setSize(w, h);
            
            const pixelRatio = window.devicePixelRatio;
            if (bgRenderTargetRef.current) {
                bgRenderTargetRef.current.setSize(w * pixelRatio, h * pixelRatio);
            }
            if (materialRef.current) {
                materialRef.current.uniforms.uResolution.value.set(w * pixelRatio, h * pixelRatio);
            }

            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
    };
    window.addEventListener('resize', handleResize);

    return () => {
        cancelAnimationFrame(frameIdRef.current);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('mousemove', handlePointerMove);
        window.removeEventListener('mousedown', handlePointerDown);
        window.removeEventListener('mouseup', handlePointerUp);
        
        if (containerRef.current && rendererRef.current) {
            containerRef.current.removeChild(rendererRef.current.domElement);
        }
        if (bgRenderTargetRef.current) bgRenderTargetRef.current.dispose();
        renderer.dispose();
        
        rippleBuffersRef.current.forEach(b => b.dispose());
    };
  }, []);

  useEffect(() => {
    if (materialRef.current && dropMaterialRef.current && rippleMaterialRef.current) {
        const u = materialRef.current.uniforms;
        u.uColorDeep.value.set(config.colorDeep);
        u.uColorShallow.value.set(config.colorShallow);
        u.uFoamColor.value.set(config.foamColor);
        u.uWaveHeight.value = config.waveHeight;
        u.uWaveSpeed.value = config.waveSpeed;
        u.uWaveScale.value = config.waveScale;
        u.uRoughness.value = config.roughness;
        u.uRippleIntensity.value = config.rippleIntensity;

        dropMaterialRef.current.uniforms.uRadius.value = config.rippleRadius;
        dropMaterialRef.current.uniforms.uStrength.value = config.rippleStrength;
        
        rippleMaterialRef.current.uniforms.uDamping.value = config.rippleDamping;
    }
  }, [config]);

  return (
    <div 
        ref={containerRef} 
        style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            width: '100%', 
            height: '100%', 
            background: '#000', 
            cursor: 'crosshair', // Indicate interaction
        }} 
    />
  );
};

export default WaterScene;
