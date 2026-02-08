
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

// --- 1. INFINITE GRADIENT BACKGROUND ---
// Uses view direction to ensure no black voids.
const gradientVertexShader = `
varying vec3 vViewDir;
void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    // Since we position the sphere at the camera, position is effectively direction
    vViewDir = position; 
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const gradientFragmentShader = `
uniform vec3 uColorDeep;
uniform vec3 uColorShallow;
varying vec3 vViewDir;

void main() {
    vec3 dir = normalize(vViewDir);
    float y = dir.y;
    
    // Smooth gradient from deep (bottom) to shallow (top)
    // Map -1..1 to a pleasing blend curve
    float t = smoothstep(-0.8, 0.5, y);
    
    vec3 col = mix(uColorDeep, uColorShallow, t);
    
    // Add a "Sun" glow at the very top
    float sun = max(0.0, dot(dir, vec3(0.0, 1.0, 0.0)));
    col += vec3(0.9, 0.95, 1.0) * pow(sun, 64.0) * 0.4;
    
    // Darken the very bottom for the "abyss" feel
    if (y < -0.5) {
        col = mix(col, vec3(0.0, 0.0, 0.05), abs(y + 0.5));
    }

    gl_FragColor = vec4(col, 1.0);
}
`;

// --- 2. GOD RAYS (Inspired by User Code) ---
const godRayVertexShader = `
varying vec2 vUv;
varying float vAlpha;
uniform float uTime;

void main() {
    vUv = uv;
    vec3 pos = position;
    
    // Swaying motion
    float sway = sin(uTime * 0.5 + pos.y * 0.05) * 2.0;
    pos.x += sway * (1.0 - uv.y);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    
    // Fade at edges
    vAlpha = smoothstep(0.0, 0.1, uv.y) * smoothstep(1.0, 0.5, uv.y);
}
`;

const godRayFragmentShader = `
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;

void main() {
    vec2 beam = vUv * vec2(10.0, 1.0); // Stretch UVs
    float time = uTime * 0.5;

    // Interference pattern inspired by the shark shader
    float bright = 
        - sin(beam.y * 6.0 + beam.x * 6.0 + time * 0.53) * 0.1 
        - sin(beam.y + beam.x * 8.0 + time * 0.6) * 0.1
        - cos(beam.x * 6.0 - time * 0.4) * 0.1 
        - sin(beam.x * 20.0 + time * 1.8) * 0.1;
    
    // Normalize and sharpen
    bright = 0.5 + bright * 2.5;
    bright = smoothstep(0.4, 0.9, bright);
    
    // Horizontal fade
    float xFade = 1.0 - abs(vUv.x - 0.5) * 2.0;
    xFade = smoothstep(0.0, 0.2, xFade);

    float alpha = vAlpha * bright * xFade * 0.25; 
    gl_FragColor = vec4(uColor, alpha);
}
`;

// --- 3. CAUSTICS (Seabed) ---
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
        o = 0.5 + 0.5*sin( uTime * 1.2 + 6.2831*o );
        vec2 r = g + o - f;
        float d = dot(r,r);
        if( d<m ) m=d;
    }
    return m;
}

void main() {
    vec2 uv = vWorldPos.xz * 0.05; 
    
    // Dual Voronoi for "Gobo" style
    float v1 = voronoi(uv * 1.0 + uTime * 0.1);
    float v2 = voronoi(uv * 1.5 - vec2(uTime * 0.05, 0.0));
    
    float c = min(v1, v2);
    float light = 1.0 - sqrt(c);
    light = pow(light, 12.0); // Sharpen
    
    // Chromatic Aberration
    float aberration = 0.006;
    float r = pow(1.0 - sqrt(min(voronoi(uv * 1.0 + uTime * 0.1 + aberration), v2)), 12.0);
    float b = pow(1.0 - sqrt(min(voronoi(uv * 1.0 + uTime * 0.1 - aberration), v2)), 12.0);
    
    vec3 causticColor = vec3(r, light, b);
    
    // Distance falloff
    float dist = length(vWorldPos.xz);
    float vign = smoothstep(100.0, 20.0, dist);
    
    vec3 finalColor = uColor * 0.8 + uLightColor * causticColor * 2.5 * vign;
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
    // Infinite Scroll effect
    float height = 80.0;
    pos.y = mod(pos.y - uTime * aVelocity.y, height) - (height * 0.5);
    
    // Horizontal drift
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
  
  // Ref for the environment mesh to make it follow camera
  const envMeshRef = useRef<THREE.Mesh | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    // RENDERER
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
    // Set a fallback background
    scene.background = new THREE.Color(config.colorDeep);

    // CAMERA (Increased Far Plane)
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
    // Huge sphere that will follow the camera position
    const envGeo = new THREE.SphereGeometry(500, 32, 32);
    const envMat = new THREE.ShaderMaterial({
        vertexShader: gradientVertexShader,
        fragmentShader: gradientFragmentShader,
        uniforms: {
            uColorDeep: { value: new THREE.Color(config.colorDeep) },
            uColorShallow: { value: new THREE.Color(config.colorShallow) }
        },
        side: THREE.BackSide,
        depthWrite: false, // Background
    });
    materialsRef.current.push(envMat);
    const environment = new THREE.Mesh(envGeo, envMat);
    envMeshRef.current = environment;
    scene.add(environment);

    // --- 2. GOD RAYS ---
    const rayGeo = new THREE.ConeGeometry(5, 100, 32, 1, true); 
    rayGeo.translate(0, -50, 0); // Tip at 0, Base at -100
    rayGeo.rotateX(-Math.PI);    // Tip points up (towards surface)
    
    const rayMat = new THREE.ShaderMaterial({
        vertexShader: godRayVertexShader,
        fragmentShader: godRayFragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(config.colorShallow) }
        },
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    materialsRef.current.push(rayMat);

    const raysGroup = new THREE.Group();
    raysGroup.position.y = 10; // Start at surface level
    scene.add(raysGroup);

    for (let i = 0; i < 15; i++) {
        const ray = new THREE.Mesh(rayGeo, rayMat);
        const r = 10 + Math.random() * 50;
        const a = Math.random() * Math.PI * 2;
        ray.position.set(Math.cos(a)*r, 0, Math.sin(a)*r);
        
        // Tilt towards center slightly
        ray.rotation.x = (Math.random() - 0.5) * 0.2;
        ray.rotation.z = (Math.random() - 0.5) * 0.2;
        ray.scale.setScalar(0.8 + Math.random() * 1.2);
        raysGroup.add(ray);
    }

    // --- 3. SEABED ---
    const bedGeo = new THREE.PlaneGeometry(300, 300, 64, 64);
    bedGeo.rotateX(-Math.PI / 2);
    const bedMat = new THREE.ShaderMaterial({
        vertexShader: causticsVertexShader,
        fragmentShader: causticsFragmentShader,
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(config.colorDeep) },
            uLightColor: { value: new THREE.Color(config.colorShallow) }
        },
        transparent: true,
        blending: THREE.AdditiveBlending, // Blend with background gradient
    });
    materialsRef.current.push(bedMat);
    const seabed = new THREE.Mesh(bedGeo, bedMat);
    seabed.position.y = -40;
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

    // --- ANIMATION LOOP ---
    const clock = new THREE.Clock();

    const animate = () => {
      const time = clock.getElapsedTime();
      
      // Update Uniforms
      materialsRef.current.forEach(mat => {
          if (mat.uniforms.uTime) mat.uniforms.uTime.value = time;
      });

      // Keep Environment Sphere centered on camera to create infinite illusion
      if (envMeshRef.current) {
          envMeshRef.current.position.copy(camera.position);
      }

      // Transition check
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

  // Update Config
  useEffect(() => {
      if (!sceneRef.current) return;
      const deep = new THREE.Color(config.colorDeep);
      const shallow = new THREE.Color(config.colorShallow);
      const foam = new THREE.Color(config.foamColor);
      
      // Update Background
      sceneRef.current.background = deep;
      
      materialsRef.current.forEach(mat => {
          if (mat.uniforms.uColorDeep) mat.uniforms.uColorDeep.value.copy(deep);
          if (mat.uniforms.uColorShallow) mat.uniforms.uColorShallow.value.copy(shallow);
          if (mat.uniforms.uColor) mat.uniforms.uColor.value.copy(
              mat.vertexShader === godRayVertexShader ? shallow : 
              mat.vertexShader === snowVertexShader ? foam : deep
          );
          if (mat.uniforms.uLightColor) mat.uniforms.uLightColor.value.copy(shallow);
      });
  }, [config]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', background: '#000' }} />;
};

export default UnderwaterScene;
