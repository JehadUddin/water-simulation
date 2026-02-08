
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { WaterConfig } from '../../types/index.tsx';
import WaterScene from '../Core/WaterScene.tsx';

interface StageProps {
  waterConfig: WaterConfig;
}

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
        backgroundColor: '#e0f7fa', 
    }}>
        <WaterScene config={waterConfig} />
    </div>
  );
};

export default Stage;
