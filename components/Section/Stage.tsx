/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { WaterConfig } from '../../types/index.tsx';
import WaterScene from '../Core/WaterScene.tsx';
import { motion } from 'framer-motion';

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
        backgroundColor: '#000', 
    }}>
        <motion.div
            {...({
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              transition: { duration: 1 }
            } as any)}
            style={{ position: 'absolute', width: '100%', height: '100%' }}
        >
            <WaterScene config={waterConfig} />
        </motion.div>
    </div>
  );
};

export default Stage;