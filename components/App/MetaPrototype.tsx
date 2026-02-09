
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect } from 'react';
import { useTheme } from '../../Theme.tsx';
import Stage from '../Section/Stage.tsx';
import { WaterConfig } from '../../types/index.tsx';
import { GUI } from 'lil-gui';

/**
 * 🏎️ Meta Prototype App
 * Acts as the main state orchestrator for the application.
 */
const MetaPrototype = () => {
  const { theme } = useTheme();

  // -- Water Simulation State --
  const [waterConfig, setWaterConfig] = useState<WaterConfig>({
    // Realistic Marine Defaults
    colorShallow: '#60c0d0', // Natural Sea Green/Cyan
    colorDeep: '#001020',    // Very Dark Navy (Abyss)
    foamColor: '#ffffff',
    transparency: 0.8,
    roughness: 0.2,          
    waveHeight: 0.4,         
    waveSpeed: 0.2,          
    waveScale: 1.5,
    normalFlatness: 10.0,    
    
    underwaterFogDensity: 0.15, // Lower fog for clearer water
    underwaterLightIntensity: 2.0, 
    
    rippleDamping: 0.96,
    rippleStrength: 0.15,
    rippleRadius: 0.04,
    rippleIntensity: 2.5,
  });

  useEffect(() => {
    const gui = new GUI({ title: 'Sim Control' });
    const params = { ...waterConfig };
    const updateConfig = () => setWaterConfig({ ...params });

    const visualFolder = gui.addFolder('Visuals');
    visualFolder.addColor(params, 'colorShallow').name('Shallow / Light').onChange(updateConfig);
    visualFolder.addColor(params, 'colorDeep').name('Deep / Fog').onChange(updateConfig);
    visualFolder.addColor(params, 'foamColor').name('Foam / Particles').onChange(updateConfig);
    visualFolder.add(params, 'transparency', 0.0, 1.0).name('Transparency').onChange(updateConfig);
    visualFolder.add(params, 'roughness', 0.0, 1.0).name('Roughness').onChange(updateConfig);
    
    const waveFolder = gui.addFolder('Waves');
    waveFolder.add(params, 'waveHeight', 0, 2).name('Height').onChange(updateConfig);
    waveFolder.add(params, 'waveSpeed', 0, 2).name('Speed').onChange(updateConfig);
    waveFolder.add(params, 'waveScale', 0.1, 5.0).name('Scale').onChange(updateConfig);
    waveFolder.add(params, 'normalFlatness', 0, 100).name('Flatness').onChange(updateConfig);

    const uwFolder = gui.addFolder('Underwater');
    uwFolder.add(params, 'underwaterFogDensity', 0.0, 1.0).name('Fog Density').onChange(updateConfig);
    uwFolder.add(params, 'underwaterLightIntensity', 0.1, 10.0).name('Light Intensity').onChange(updateConfig);

    const rippleFolder = gui.addFolder('Ripple Physics');
    rippleFolder.add(params, 'rippleIntensity', 0.1, 10.0).name('Vis Intensity').onChange(updateConfig);
    rippleFolder.add(params, 'rippleDamping', 0.80, 0.999).name('Damping').onChange(updateConfig);
    rippleFolder.add(params, 'rippleStrength', 0.01, 1.0).name('Input Strength').onChange(updateConfig);
    rippleFolder.add(params, 'rippleRadius', 0.01, 0.2).name('Input Radius').onChange(updateConfig);
    
    visualFolder.open();
    waveFolder.open();
    uwFolder.open(); 
    return () => { gui.destroy(); };
  }, []);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: theme.Color.Base.Surface[1],
      overflow: 'hidden',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Stage waterConfig={waterConfig} />
    </div>
  );
};

export default MetaPrototype;
