
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
    colorShallow: '#22aaff', 
    colorDeep: '#001e3b',    
    foamColor: '#ffffff',
    transparency: 0.8,
    roughness: 0.45,         
    waveHeight: 0.6,         
    waveSpeed: 0.2,          
    waveScale: 1.5,
    normalFlatness: 1.0,
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
    visualFolder.add(params, 'waveHeight', 0, 2).name('Wave Height').onChange(updateConfig);
    visualFolder.add(params, 'waveSpeed', 0, 2).name('Wave Speed').onChange(updateConfig);
    visualFolder.add(params, 'rippleIntensity', 0.1, 10.0).name('Ripple Strength').onChange(updateConfig);
    
    visualFolder.open();
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
