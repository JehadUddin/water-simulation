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

// --- SUBNAUTICA-STYLE OCEAN SHADERS ---
// Modern Game Techniques:
// 1. "Infinite Grid" -> 9-Tile LOD System following the camera.
// 2. "Vertex Density" -> High detail center tile, optimized outer tiles.
// 3. "Surface Foam" -> Jacobian-based foam accumulation at wave peaks.
// 4. "SSS" -> View-dependent and height-dependent light scattering.

const waterVertexShader = `
precision highp float;

uniform float uTime;
uniform float uWaveHeight;
uniform float uWaveSpeed;
uniform float uWaveScale;
uniform float uRoughness; // Used as Steepness Multiplier

varying vec3 vWorldPos;
varying vec3 vViewPosition;
varying vec3 vNormal;
varying float vElevation;
varying float vFoam;

// Gerstner Wave Calculation
// Accumulates Position (P), Normal (N), and Foam factor
void calculateWave(
    vec2 dir,           // Direction (normalized)
    float wavelength,   // Length
    float speed,        // Speed
    float steepness,    // 0..1 (Controlled by uRoughness)
    float amplitude,    // Height
    inout vec3 P, 
    inout vec3 N,
    inout float foamAccum
) {
    float k = 6.28318 / wavelength; // Wavenumber
    float c = sqrt(9.8 / k);        // Phase speed
    float w = k * c;                // Angular frequency
    
    // Phase
    float f = k * (dot(dir, P.xz) - w * uTime * speed);
    
    // Optimization: Precompute trig
    float sinf = sin(f);
    float cosf = cos(f);

    // Steepness constraint:
    // To avoid loops, Sum(Q * A * k) should be < 1. 
    // We scale Q based on A and k to be safe.
    // Q = steepness / (amplitude * k * TOTAL_WAVES)
    float Q = steepness / (k * amplitude * 1.5); // 1.5 is a safety factor
    
    // Displacement
    float wa = k * amplitude;
    float qa = Q * amplitude;
    
    P.x -= dir.x * qa * sinf;
    P.z -= dir.y * qa * sinf;
    P.y += amplitude * cosf;

    // Normal Derivatives
    // dH/dx = -dir.x * wa * sinf
    // dH/dz = -dir.y * wa * sinf
    // Vertical compression = 1 - Q * wa * cosf
    
    float wa_sin = wa * sinf;
    float wa_cos = wa * cosf;
    
    N.x -= dir.x * wa_sin;
    N.z -= dir.y * wa_sin;
    N.y -= Q * wa_cos;
    
    // Foam: Accumulate based on "pinching" (Jacobian approximation)
    // When waves bunch up, Jacobian < 0 -> foam.
    foamAccum += max(0.0, 1.0 - Q * wa_cos); // Basic Jacobian-like metric
}

void main() {
    // IMPORTANT: To support infinite ocean, we use the world position for wave calculations.
    // This allows the mesh to slide (follow player) while waves stay in place.
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vec3 finalPos = worldPosition.xyz;
    
    vec3 normalAccum = vec3(0.0, 1.0, 0.0); // Start with Up normal
    float foamAccum = 0.0;
    
    // Config Multipliers
    float h = uWaveHeight;
    float s = uWaveSpeed;
    float sc = max(0.1, uWaveScale);
    float st = clamp(uRoughness, 0.0, 0.8); // Clamp steepness to avoid black folding
    
    // --- WAVE SPECTRUM (Prime Numbers & Irregular Angles to break Grid) ---
    // We use a specific set of waves that don't harmonically align.
    
    // Wave 1: Main Swell (Angle 0)
    calculateWave(normalize(vec2(1.0, 0.1)), 100.0 * sc, 1.0 * s, st, 2.0 * h, finalPos, normalAccum, foamAccum);
    
    // Wave 2: Crossing Swell (Angle ~60)
    calculateWave(normalize(vec2(0.5, 0.866)), 53.0 * sc, 1.1 * s, st, 0.9 * h, finalPos, normalAccum, foamAccum);
    
    // Wave 3: Chop (Angle ~130)
    calculateWave(normalize(vec2(-0.64, 0.76)), 29.0 * sc, 1.2 * s, st, 0.5 * h, finalPos, normalAccum, foamAccum);
    
    // Wave 4: Detail (Angle ~210)
    calculateWave(normalize(vec2(-0.86, -0.5)), 17.0 * sc, 1.4 * s, st, 0.25 * h, finalPos, normalAccum, foamAccum);
    
    // Wave 5: Micro (Angle ~310)
    calculateWave(normalize(vec2(0.64, -0.76)), 9.0 * sc, 1.8 * s, st, 0.1 * h, finalPos, normalAccum, foamAccum);

    // Normalize Final Normal
    vec3 N = normalize(vec3(normalAccum.x, normalAccum.y, normalAccum.z));
    
    vNormal = N;
    vWorldPos = finalPos; // Use the wave-displaced position for fragments
    vElevation = finalPos.y;
    vFoam = smoothstep(3.5, 5.0, foamAccum); // Threshold foam based on Jacobian
    
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

varying vec3 vWorldPos;
varying vec3 vViewPosition;
varying vec3 vNormal;
varying float vElevation;
varying float vFoam;

const vec3 SUN_COLOR = vec3(1.0, 0.95, 0.9);
const vec3 AMBIENT_COLOR = vec3(0.05, 0.1, 0.15); // Balanced ambient

// --- SIMPLEX NOISE ---
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

// --- FBM ---
float fbm(vec2 x) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    // Rotate to reduce axial bias
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
    for (int i = 0; i < 4; ++i) {
        v += a * snoise(x);
        x = rot * x * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

// Sky Color Gradient
vec3 getSkyColor(vec3 rd) {
    vec3 sunDir = normalize(uSunPosition);
    float sunDot = max(dot(rd, sunDir), 0.0);
    // Horizon to Zenith
    vec3 col = mix(vec3(0.6, 0.7, 0.8), vec3(0.1, 0.3, 0.6), rd.y * 0.5 + 0.5);
    // Sun Glare
    col += 0.8 * SUN_COLOR * pow(sunDot, 120.0);
    return col;
}

void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 sunDir = normalize(uSunPosition);
    vec3 baseNormal = normalize(vNormal);

    // --- 1. SURFACE MICRO-DETAIL ---
    // Use FBM for realistic ripples and calculate gradient for normal perturbation
    float timeScale = 0.4;
    vec2 uv = vWorldPos.xz * 0.08; // Detail scale
    
    // Layer 1
    float h1 = fbm(uv + uTime * timeScale * vec2(0.1, 0.1));
    // Layer 2
    float h2 = fbm(uv * 2.5 - uTime * timeScale * vec2(0.2, 0.1));
    
    float heightMap = h1 * 0.6 + h2 * 0.4;
    
    // Compute Gradient (Finite Difference)
    vec2 epsilon = vec2(0.1, 0.0);
    float h_x = fbm((uv + epsilon) + uTime * timeScale * vec2(0.1, 0.1)) * 0.6 + 
                fbm((uv + epsilon) * 2.5 - uTime * timeScale * vec2(0.2, 0.1)) * 0.4;
    float h_y = fbm((uv + epsilon.yx) + uTime * timeScale * vec2(0.1, 0.1)) * 0.6 + 
                fbm((uv + epsilon.yx) * 2.5 - uTime * timeScale * vec2(0.2, 0.1)) * 0.4;
                
    vec3 normalPerturb = normalize(vec3(heightMap - h_x, 8.0, heightMap - h_y)); // 8.0 controls bump strength (Higher = Smoother)
    
    // Combine with base normal (Gerstner)
    vec3 finalNormal = normalize(baseNormal + (normalPerturb - vec3(0,1,0)) * 0.4);

    // --- 2. LIGHTING MODEL ---
    
    // Specular
    vec3 H = normalize(sunDir + viewDir);
    float NdotH = max(dot(finalNormal, H), 0.0);
    float specPower = 400.0; // Sharp highlights
    float specular = pow(NdotH, specPower);
    
    // Fresnel
    float F0 = 0.02; 
    float NdotV = max(dot(finalNormal, viewDir), 0.0);
    float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);
    
    // SSS (Subsurface Scattering)
    // Enhances light passing through wave peaks and view-dependent depth.
    float LdotV = dot(-sunDir, viewDir);
    float sss = max(0.0, LdotV) * 0.4 + 0.1; 
    sss += max(0.0, vElevation * 0.2); 
    
    // --- 3. COLOR COMPOSITION ---
    
    // Base Mix
    float mixFactor = (finalNormal.y * 0.5 + 0.5) + (vElevation * 0.1);
    vec3 albedo = mix(uColorDeep, uColorShallow, clamp(mixFactor, 0.0, 1.0));
    
    // Light Accumulation
    float NdotL = max(dot(finalNormal, sunDir), 0.0);
    vec3 diffuse = albedo * NdotL * SUN_COLOR;
    vec3 ambient = albedo * AMBIENT_COLOR;
    vec3 scatterLight = uColorShallow * sss * 0.6; // Strengthen SSS for that "tropical" look
    
    vec3 waterBodyColor = ambient + diffuse + scatterLight;
    
    // Reflection
    vec3 refDir = reflect(-viewDir, finalNormal);
    vec3 skyRefl = getSkyColor(refDir);
    
    vec3 finalColor = mix(waterBodyColor, skyRefl, fresnel);
    
    // Specular Add
    finalColor += SUN_COLOR * specular * 1.5;
    
    // Foam
    float foamNoise = fbm(uv * 4.0 + uTime);
    float foamMask = smoothstep(1.8, 3.0, vElevation + foamNoise * 0.5);
    finalColor = mix(finalColor, uFoamColor, foamMask * 0.8);

    gl_FragColor = vec4(finalColor, 1.0);
    
    // Fog (Seamless edge blending)
    // The grid radius is approx 1500 (3 tiles of 1000, centered). 
    // We start fog at 100 and fully obscure by 1500 to hide the edge of the world.
    float dist = length(vViewPosition);
    float fog = smoothstep(100.0, 1500.0, dist);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, getSkyColor(viewDir), fog);
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
    
    // Gradient
    float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
    vec3 skyGrad = mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0));
    
    // Sun
    vec3 sunDir = normalize(uSunPosition);
    float sunDist = dot(viewDirection, sunDir);
    float sunHalo = pow(max(0.0, sunDist), 400.0) * 1.5;
    float sunDisc = smoothstep(0.998, 0.999, sunDist) * 10.0;
    
    gl_FragColor = vec4(skyGrad + vec3(1.0, 0.9, 0.7) * (sunHalo + sunDisc), 1.0);
}
`;

// Configuration for the Infinite Grid
const TILE_SIZE = 1000;

const WaterScene: React.FC<WaterSceneProps> = ({ config }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const frameIdRef = useRef<number>(0);

  // Sun Position (Low angle for drama)
  const sunPos = new THREE.Vector3(50, 40, -100);

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

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff); 
    scene.fog = new THREE.FogExp2(0xffffff, 0.00015);

    // Camera setup
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 5000);
    camera.position.set(0, 20, 80); 
    
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // Prevent going underwater
    controls.minDistance = 10;
    controls.maxDistance = 500;
    controls.target.set(0, 0, -20);

    // Water Material
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
        },
        side: THREE.FrontSide,
        wireframe: false,
    });
    materialRef.current = waterMaterial;

    // --- INFINITE OCEAN SYSTEM ---
    
    // Group to hold our tiles
    const oceanGroup = new THREE.Group();
    scene.add(oceanGroup);

    // Geometries
    // High Density: 256 segments (for the center tile)
    const highResGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 256, 256);
    highResGeo.rotateX(-Math.PI / 2);
    
    // Low Density: 64 segments (for outer tiles)
    const lowResGeo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE, 64, 64);
    lowResGeo.rotateX(-Math.PI / 2);

    // Meshes
    // 1 Center Tile (High Res)
    const centerTile = new THREE.Mesh(highResGeo, waterMaterial);
    oceanGroup.add(centerTile);

    // 8 Outer Tiles (Low Res)
    const outerTiles: THREE.Mesh[] = [];
    for (let i = 0; i < 8; i++) {
        const mesh = new THREE.Mesh(lowResGeo, waterMaterial);
        outerTiles.push(mesh);
        oceanGroup.add(mesh);
    }

    // Sky Dome
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

    const animate = (time: number) => {
        const t = time * 0.001;
        if (materialRef.current) {
            materialRef.current.uniforms.uTime.value = t;
        }
        
        controls.update();

        // --- TILE FOLLOWING LOGIC ---
        // Snap the grid center to the camera's position (rounded to nearest TILE_SIZE)
        const snapX = Math.floor(camera.position.x / TILE_SIZE + 0.5) * TILE_SIZE;
        const snapZ = Math.floor(camera.position.z / TILE_SIZE + 0.5) * TILE_SIZE;

        // Place Center Tile (High Res)
        centerTile.position.set(snapX, 0, snapZ);

        // Place 8 Outer Tiles (Low Res) around the center
        // Grid Offsets:
        // (-1, -1) (0, -1) (1, -1)
        // (-1,  0) (High)  (1,  0)
        // (-1,  1) (0,  1) (1,  1)
        let tileIndex = 0;
        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                // Skip the center (0,0), that's our high res tile
                if (x === 0 && z === 0) continue;
                
                if (outerTiles[tileIndex]) {
                    outerTiles[tileIndex].position.set(
                        snapX + x * TILE_SIZE, 
                        0, 
                        snapZ + z * TILE_SIZE
                    );
                    tileIndex++;
                }
            }
        }
        
        // Since the shader uses World Position for noise/waves, the water pattern
        // stays stationary in the world even as the meshes "jump" to new snap positions.

        renderer.render(scene, camera);
        frameIdRef.current = requestAnimationFrame(animate);
    };
    frameIdRef.current = requestAnimationFrame(animate);

    const handleResize = () => {
        if (containerRef.current && rendererRef.current) {
            const w = containerRef.current.clientWidth;
            const h = containerRef.current.clientHeight;
            rendererRef.current.setSize(w, h);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        }
    };
    window.addEventListener('resize', handleResize);

    return () => {
        cancelAnimationFrame(frameIdRef.current);
        window.removeEventListener('resize', handleResize);
        if (containerRef.current && rendererRef.current) {
            containerRef.current.removeChild(rendererRef.current.domElement);
        }
        renderer.dispose();
        waterMaterial.dispose();
        highResGeo.dispose();
        lowResGeo.dispose();
        skyMat.dispose();
        skyGeom.dispose();
    };
  }, []);

  // Update uniforms when config changes
  useEffect(() => {
    if (materialRef.current) {
        const u = materialRef.current.uniforms;
        u.uColorDeep.value.set(config.colorDeep);
        u.uColorShallow.value.set(config.colorShallow);
        u.uFoamColor.value.set(config.foamColor);
        u.uWaveHeight.value = config.waveHeight;
        u.uWaveSpeed.value = config.waveSpeed;
        u.uWaveScale.value = config.waveScale;
        u.uRoughness.value = config.roughness;
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
        }} 
    />
  );
};

export default WaterScene;