/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { MotionValue } from 'framer-motion';
import { MetaButtonProps, WaterConfig } from '../../types/index.tsx';
import WaterScene from '../Core/WaterScene.tsx';

// --- HELPER TYPES & COMPONENTS ---

type StageButtonProps = Omit<MetaButtonProps, 'customRadius'> & {
  customRadius: any; // Allow MotionValue
}

interface StageProps {
  btnProps: StageButtonProps;
  waterConfig: WaterConfig;
  onButtonClick: () => void;
  showMeasurements: boolean;
  showTokens: boolean;
  view3D: boolean;
  viewRotateX: MotionValue<number>;
  viewRotateZ: MotionValue<number>;
  layerSpacing: MotionValue<number>;
}

// --- MAIN COMPONENT ---

const Stage: React.FC<StageProps> = ({ 
    waterConfig,
}) => {

  return (
    <div style={{ 
        position: 'relative', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        padding: '0px',
        width: '100%',
        height: '100%',
        backgroundColor: '#e0f7fa', // Day sky background
    }}>
        {/* Background Water Simulation */}
        <WaterScene config={waterConfig} />
        
        {/* Button and Overlays removed as per request */}
    </div>
  );
};

export default Stage;