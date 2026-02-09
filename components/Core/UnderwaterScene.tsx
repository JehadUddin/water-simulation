
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WaterConfig } from '../../types/index.tsx';

interface UnderwaterSceneProps {
  config: WaterConfig;
  initialCameraState?: { position: [number, number, number], target: [number, number, number] } | null;
  onSurface?: (pos: [number, number, number], target: [number, number, number]) => void;
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
        o = 0.5 + 0.5*sin( uTime * 1.2 + 6.2831*o );
        vec2 r = g + o - f;
        float d = dot(r,r);
        if( d<m ) m=d;
    }
    return m;
}
`;

// --- 1. INFINITE GRADIENT BACKGROUND ---
const gradientVertexShader = `
varying vec3 vViewDir;
void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vViewDir = position; 
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const gradientFragmentShader = `
uniform vec3 uColorDeep;
uniform vec3 uColorShallow;
varying vec3 vViewDir;
uniform float uLightIntensity;

void main() {
    vec3 dir = normalize(vViewDir);
    float y = dir.y;
    
    // Light Penetration
    float lightFactor = smoothstep(-0.2, 1.0, y); 
    vec3 col = mix(uColorDeep, uColorShallow, lightFactor);
    
    // Deep Scatter (Tyndall Effect)
    float depthFactor = smoothstep(0.2, -1.0, y); 
    vec3 scatter = uColorShallow * 0.15 * uLightIntensity;
    vec3 abyssColor = (uColorDeep + scatter) * 0.6; 
    
    col = mix(col, abyssColor, depthFactor * 0.9);

    // Sun Glow
    float sun = max(0.0, dot(dir, vec3(0.0, 1.0, 0.0)));
    col += uColorShallow * pow(sun, 16.0) * 0.3 * uLightIntensity;

    gl_FragColor = vec4(col, 1.0);
}
`;

// --- 2. GOD RAYS ---
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

// --- 3. PROCEDURAL TERRAIN (Subnautica Style) ---
const terrainVertexShader = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorldPos;
varying float vElevation;
${commonNoise}

void main() {
    vUv = uv;
    vec3 pos = position;
    
    // Procedural Terrain Generation
    // Since Plane is rotated -90 on X, 'pos.xy' are the plane coordinates. 
    // 'pos.z' is the normal direction (UP in world Y).
    
    // 1. Large rolling dunes
    float large = snoise(pos.xy * 0.003) * 25.0;
    
    // 2. Medium hills
    float medium = snoise(pos.xy * 0.01 + uTime * 0.02) * 5.0; // Subtle shift over time
    
    // 3. Small sandy ripples
    float small = snoise(pos.xy * 0.08) * 1.5;
    
    float elevation = large + medium + small;
    
    // Apply elevation to Z (which maps to World Y)
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
    // 1. Base Sand Color (Gradient based on height)
    // "Bone Sand" high, "Deep Moss" low
    vec3 sandHigh = vec3(0.95, 0.98, 0.9); // Bioluminescent white/yellow
    vec3 sandLow = mix(uColorDeep, vec3(0.1, 0.4, 0.4), 0.5);   // Darker teal in valleys
    
    float heightFactor = smoothstep(-20.0, 30.0, vElevation);
    vec3 albedo = mix(sandLow, sandHigh, heightFactor);
    
    // 2. Texture Detail (Grain)
    float noise = snoise(vWorldPos.xz * 0.5);
    albedo *= (0.8 + 0.2 * noise);

    // 3. Caustics (Projected)
    vec2 uv = vWorldPos.xz * 0.04;
    float v1 = voronoi(uv * 1.0 + uTime * 0.2);
    float v2 = voronoi(uv * 1.5 - vec2(uTime * 0.1, 0.0));
    float c = min(v1, v2);
    float light = 1.0 - sqrt(c);
    light = pow(light, 16.0); // Sharpen
    
    // Chromatic aberration
    float aberration = 0.004;
    float r = pow(1.0 - sqrt(min(voronoi(uv * 1.0 + uTime * 0.2 + aberration), v2)), 16.0);
    float b = pow(1.0 - sqrt(min(voronoi(uv * 1.0 + uTime * 0.2 - aberration), v2)), 16.0);
    vec3 causticColor = vec3(r, light, b);

    // Combine Sand + Caustics
    // Caustics are very bright in Subnautica
    vec3 finalColor = albedo * 0.4 + (causticColor * uLightIntensity * 1.5);

    // 4. Distance Fog (Seamless Blend)
    float dist = length(vWorldPos.xz); 
    float fogStart = 200.0;
    float fogEnd = 480.0;
    float fog = smoothstep(fogStart, fogEnd, dist);
    
    // Fog color matches the deep background color
    vec3 fogColor = uColorDeep; 
    finalColor = mix(finalColor, fogColor, fog);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;

// --- 4. PARTICLES (Marine Snow) ---
const snowVertexShader = `
uniform float uTime;
attribute float aScale;
attribute vec3 aVelocity;
varying float vAlpha;

void main() {
    vec3 pos = position;
    float height = 100.0;
    pos.y = mod(pos.y - uTime * aVelocity.y, height) - (height * 0.5);
    pos.x += sin(uTime * aVelocity.x + pos.y * 0.1);
    pos.z += cos(uTime * aVelocity.z + pos.y * 0.1);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aScale * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
    
    float dist = length(mvPosition.xyz);
    vAlpha = smoothstep(60.0, 40.0, dist) * smoothstep(0.0, 5.0, dist);
}
`;

const snowFragmentShader = `
uniform vec3 uColor;
varying float vAlpha;
void main() {
    vec2 xy = gl_PointCoord.xy - vec2(0.5);
    if(length(xy) > 0.5) discard;
    float glow = 1.0 - length(xy) * 2.0;
    gl_FragColor = vec4(uColor, vAlpha * glow);
}
`;

const UnderwaterScene: React.FC<UnderwaterSceneProps> = ({ config, initialCameraState, onSurface }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const frameIdRef = useRef<number>(0);
  const materialsRef = useRef<THREE.ShaderMaterial[]>([]);
  const controlsRef = useRef<OrbitControls | null>(null);
  const envMeshRef = useRef<THREE.Mesh | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(config.colorDeep);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    cameraRef.current = camera;
    if (initialCameraState) camera.position.set(...initialCameraState.position);
    else camera.position.set(0, -10, 30);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enablePan = false;
    controls.minDistance = 5;
    controls.maxDistance = 150;
    controls.maxPolarAngle = Math.PI - 0.1; 

    if (initialCameraState) controls.target.set(...initialCameraState.target);
    else controls.target.set(0, 5, 0);

    // --- 1. INFINITE ENVIRONMENT ---
    const envGeo = new THREE.SphereGeometry(500, 32, 32);
    const envMat = new THREE.ShaderMaterial({
        vertexShader: gradientVertexShader,
        fragmentShader: gradientFragmentShader,
        uniforms: {
            uColorDeep: { value: new THREE.Color(config.colorDeep) },
            uColorShallow: { value: new THREE.Color(config.colorShallow) },
            uLightIntensity: { value: config.underwaterLightIntensity }
        },
        side: THREE.BackSide,
        depthWrite: false,
    });
    materialsRef.current.push(envMat);
    const environment = new THREE.Mesh(envGeo, envMat);
    envMeshRef.current = environment;
    scene.add(environment);

    // --- 2. GOD RAYS ---
    const rayGeo = new THREE.ConeGeometry(5, 100, 32, 1, true); 
    rayGeo.translate(0, -50, 0); 
    rayGeo.rotateX(-Math.PI);    
    
    const rayMat = new THREE.ShaderMaterial({
        vertexShader: godRayVertexShader,
        fragmentShader: godRayFragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(config.colorShallow) },
            uLightIntensity: { value: config.underwaterLightIntensity }
        },
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    materialsRef.current.push(rayMat);

    const raysGroup = new THREE.Group();
    raysGroup.position.y = 10; 
    scene.add(raysGroup);

    for (let i = 0; i < 15; i++) {
        const ray = new THREE.Mesh(rayGeo, rayMat);
        const r = 10 + Math.random() * 50;
        const a = Math.random() * Math.PI * 2;
        ray.position.set(Math.cos(a)*r, 0, Math.sin(a)*r);
        ray.rotation.x = (Math.random() - 0.5) * 0.2;
        ray.rotation.z = (Math.random() - 0.5) * 0.2;
        ray.scale.setScalar(0.8 + Math.random() * 1.2);
        raysGroup.add(ray);
    }

    // --- 3. SEABED (PROCEDURAL TERRAIN) ---
    // High segment count for vertex displacement
    const bedGeo = new THREE.PlaneGeometry(1000, 1000, 256, 256);
    bedGeo.rotateX(-Math.PI / 2); // Lay flat on XZ plane
    
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
    seabed.position.y = -60; // Lower it to allow for "mountains"
    scene.add(seabed);

    // --- 4. PARTICLES ---
    const pCount = 2000;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    const pScale = new Float32Array(pCount);
    const pVel = new Float32Array(pCount * 3);

    for(let i=0; i<pCount; i++) {
        pPos[i*3] = (Math.random() - 0.5) * 150;
        pPos[i*3+1] = (Math.random() - 0.5) * 80;
        pPos[i*3+2] = (Math.random() - 0.5) * 150;
        pScale[i] = Math.random() * 1.5 + 0.5;
        pVel[i*3] = (Math.random() - 0.5) * 0.2;
        pVel[i*3+1] = Math.random() * 0.3 + 0.1;
        pVel[i*3+2] = (Math.random() - 0.5) * 0.2;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('aScale', new THREE.BufferAttribute(pScale, 1));
    pGeo.setAttribute('aVelocity', new THREE.BufferAttribute(pVel, 3));

    const pMat = new THREE.ShaderMaterial({
        vertexShader: snowVertexShader,
        fragmentShader: snowFragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(config.foamColor) }
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    materialsRef.current.push(pMat);
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    const clock = new THREE.Clock();
    const animate = () => {
      const time = clock.getElapsedTime();
      
      materialsRef.current.forEach(mat => {
          if (mat.uniforms.uTime) mat.uniforms.uTime.value = time;
      });

      if (envMeshRef.current) {
          envMeshRef.current.position.copy(camera.position);
      }

      if (onSurface && camera.position.y > 0.1) {
          const target = new THREE.Vector3();
          if (controlsRef.current) target.copy(controlsRef.current.target);
          onSurface([camera.position.x, camera.position.y, camera.position.z], [target.x, target.y, target.z]);
          return;
      }

      controls.update();
      renderer.render(scene, camera);
      frameIdRef.current = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      rendererRef.current.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frameIdRef.current);
      window.removeEventListener('resize', handleResize);
      if (containerRef.current && rendererRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
      }
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
      if (!sceneRef.current) return;
      const deep = new THREE.Color(config.colorDeep);
      const shallow = new THREE.Color(config.colorShallow);
      const foam = new THREE.Color(config.foamColor);
      
      sceneRef.current.background = deep;
      
      materialsRef.current.forEach(mat => {
          if (mat.uniforms.uColorDeep) mat.uniforms.uColorDeep.value.copy(deep);
          if (mat.uniforms.uColorShallow) mat.uniforms.uColorShallow.value.copy(shallow);
          if (mat.uniforms.uColor) mat.uniforms.uColor.value.copy(
              mat.vertexShader === godRayVertexShader ? shallow : 
              mat.vertexShader === snowVertexShader ? foam : deep
          );
          if (mat.uniforms.uLightIntensity) mat.uniforms.uLightIntensity.value = config.underwaterLightIntensity;
      });
  }, [config]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#000' }} />;
};

export default UnderwaterScene;
