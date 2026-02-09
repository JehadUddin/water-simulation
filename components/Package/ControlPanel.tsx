/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React from 'react';
import { useMotionValue } from 'framer-motion';
import { useTheme } from '../../Theme.tsx';
import { MetaButtonProps, WaterConfig } from '../../types/index.tsx';
import Input from '../Core/Input.tsx';
import Select from '../Core/Select.tsx';
import RangeSlider from '../Core/RangeSlider.tsx';
import ColorPicker from '../Core/ColorPicker.tsx';
import Toggle from '../Core/Toggle.tsx';

interface ControlPanelProps {
  btnProps: MetaButtonProps;
  waterConfig: WaterConfig;
  onPropChange: (keyOrObj: string | Partial<MetaButtonProps>, value?: any) => void;
  onWaterPropChange: (updates: Partial<WaterConfig>) => void;
  radiusMotionValue: any; // Using any for MotionValue<number>
  onRadiusCommit: (value: number) => void;
  showMeasurements: boolean;
  onToggleMeasurements: () => void;
  showTokens: boolean;
  onToggleTokens: () => void;
  // 3D View Props
  view3D: boolean;
  onToggleView3D: () => void;
  layerSpacing: any; // Using any for MotionValue<number>
  viewRotateX: any;
  viewRotateZ: any;
}

// Helper for local motion values to use RangeSlider
const LocalRange: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
}> = ({ label, value, min, max, onChange }) => {
  const mv = useMotionValue(value);
  
  // Keep MV in sync if external value changes (optional but good for consistency)
  React.useEffect(() => {
    mv.set(value);
  }, [value, mv]);

  return (
    <RangeSlider
      label={label}
      motionValue={mv}
      onCommit={(v) => {
        mv.set(v);
        onChange(v);
      }}
      min={min}
      max={max}
    />
  );
};

const ControlPanel: React.FC<ControlPanelProps> = ({ 
  btnProps, 
  waterConfig,
  onPropChange, 
  onWaterPropChange,
  radiusMotionValue, 
  onRadiusCommit, 
  showMeasurements, 
  onToggleMeasurements, 
  showTokens,
  onToggleTokens,
  view3D,
  onToggleView3D,
  layerSpacing,
  viewRotateX,
  viewRotateZ
}) => {
  const { theme, themeName } = useTheme();

  // Helper to determine current interaction state
  const currentInteraction = btnProps.disabled ? 'disabled' 
    : btnProps.forcedActive ? 'active'
    : btnProps.forcedFocus ? 'focus'
    : btnProps.forcedHover ? 'hover'
    : 'default';

  const handleInteractionChange = (e: any) => {
    const val = e.target.value;
    const updates: Partial<MetaButtonProps> = {
      disabled: false,
      forcedHover: false,
      forcedFocus: false,
      forcedActive: false,
    };
    if (val !== 'default') {
        if (val === 'disabled') updates.disabled = true;
        else if (val === 'hover') updates.forcedHover = true;
        else if (val === 'focus') updates.forcedFocus = true;
        else if (val === 'active') updates.forcedActive = true;
    }
    onPropChange(updates);
  };

  return (
    <>
      <label style={{ ...theme.Type.Readable.Label.S, display: 'block', marginBottom: theme.spacing['Space.M'], color: theme.Color.Base.Content[2], textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Element Props
      </label>
      <Input
        label="Label"
        value={btnProps.label}
        onChange={(e) => onPropChange('label', e.target.value)}
      />
      <div style={{ display: 'flex', gap: theme.spacing['Space.M'], marginTop: theme.spacing['Space.L'] }}>
        <div style={{ flex: 1 }}>
          <Select
            label="Variant"
            value={btnProps.variant}
            onChange={(e) => onPropChange('variant', e.target.value)}
            options={[
              { value: 'primary', label: 'Primary' },
              { value: 'secondary', label: 'Secondary' },
              { value: 'ghost', label: 'Ghost' },
              { value: 'outline', label: 'Outline' },
            ]}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Select
            label="Size"
            value={btnProps.size}
            onChange={(e) => onPropChange('size', e.target.value)}
            options={[
              { value: 'S', label: 'Small (S)' },
              { value: 'M', label: 'Medium (M)' },
              { value: 'L', label: 'Large (L)' },
            ]}
          />
        </div>
      </div>
      <div style={{ marginTop: theme.spacing['Space.L'] }}>
          <Select
            label="Icon (Phosphor)"
            value={btnProps.icon || ''}
            onChange={(e) => onPropChange('icon', e.target.value)}
            options={[
                { value: '', label: 'None' },
                { value: 'ph-sparkle', label: 'Sparkle' },
                { value: 'ph-heart', label: 'Heart' },
                { value: 'ph-bell', label: 'Bell' },
                { value: 'ph-rocket', label: 'Rocket' },
                { value: 'ph-gear', label: 'Gear' },
            ]}
          />
      </div>
      <div style={{ marginTop: theme.spacing['Space.L'] }}>
          <RangeSlider
            label="Corner Radius"
            motionValue={radiusMotionValue}
            onCommit={onRadiusCommit}
            min={0}
            max={56}
          />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing['Space.M'], marginTop: theme.spacing['Space.L'], width: '100%' }}>
        <ColorPicker
          label="Fill Color"
          value={btnProps.customFill || (themeName === 'dark' ? '#ffffff' : '#000000')}
          onChange={(e) => onPropChange('customFill', e.target.value)}
        />
        <ColorPicker
          label="Text Color"
          value={btnProps.customColor || (themeName === 'dark' ? '#000000' : '#ffffff')}
          onChange={(e) => onPropChange('customColor', e.target.value)}
        />
      </div>

      <div style={{ borderTop: `1px solid ${theme.Color.Base.Surface[3]}`, margin: `${theme.spacing['Space.L']} 0` }} />

      {/* --- WATER SIMULATION --- */}
      <label style={{ ...theme.Type.Readable.Label.S, display: 'block', marginBottom: theme.spacing['Space.M'], color: theme.Color.Base.Content[2], textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Water Simulation
      </label>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing['Space.M'] }}>
         <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <ColorPicker
                label="Deep"
                value={waterConfig.colorDeep}
                onChange={(e) => onWaterPropChange({ colorDeep: e.target.value })}
            />
            <ColorPicker
                label="Shallow"
                value={waterConfig.colorShallow}
                onChange={(e) => onWaterPropChange({ colorShallow: e.target.value })}
            />
         </div>
         <ColorPicker
            label="Foam"
            value={waterConfig.foamColor}
            onChange={(e) => onWaterPropChange({ foamColor: e.target.value })}
         />
         <LocalRange label="Wave Height" value={waterConfig.waveHeight * 10} min={0} max={50} onChange={(v) => onWaterPropChange({ waveHeight: v / 10 })} />
         <LocalRange label="Wave Speed" value={waterConfig.waveSpeed * 100} min={0} max={100} onChange={(v) => onWaterPropChange({ waveSpeed: v / 100 })} />
         <LocalRange label="Scale" value={waterConfig.waveScale * 10} min={1} max={100} onChange={(v) => onWaterPropChange({ waveScale: v / 10 })} />
         <LocalRange label="Roughness" value={waterConfig.roughness * 100} min={0} max={100} onChange={(v) => onWaterPropChange({ roughness: v / 100 })} />
         <LocalRange label="Normal Flatness" value={waterConfig.normalFlatness} min={1} max={100} onChange={(v) => onWaterPropChange({ normalFlatness: v })} />
      </div>

      <div style={{ borderTop: `1px solid ${theme.Color.Base.Surface[3]}`, margin: `${theme.spacing['Space.L']} 0` }} />
      
      {/* --- FORCED STATES --- */}
      <div style={{ width: '100%' }}>
            <Select 
                label="Interaction State"
                value={currentInteraction}
                onChange={handleInteractionChange}
                options={[
                    { value: 'default', label: 'Default' },
                    { value: 'hover', label: 'Hover' },
                    { value: 'focus', label: 'Focus' },
                    { value: 'active', label: 'Click' },
                    { value: 'disabled', label: 'Disabled' },
                ]}
            />
      </div>

      <div style={{ borderTop: `1px solid ${theme.Color.Base.Surface[3]}`, margin: `${theme.spacing['Space.L']} 0` }} />
      
      {/* --- INSPECTION TOOLS --- */}
      <label style={{ ...theme.Type.Readable.Label.S, display: 'block', marginBottom: theme.spacing['Space.M'], color: theme.Color.Base.Content[2], textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Inspector
      </label>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: theme.spacing['Space.M'] }}>
        <Toggle
          label="Show Measurements"
          isOn={showMeasurements}
          onToggle={onToggleMeasurements}
        />
        <Toggle
          label="Show Tokens"
          isOn={showTokens}
          onToggle={onToggleTokens}
        />
        <Toggle
          label="3D Layer View"
          isOn={view3D}
          onToggle={onToggleView3D}
        />
        
        {view3D && (
          <div style={{ 
            marginTop: theme.spacing['Space.S'], 
            padding: theme.spacing['Space.M'], 
            backgroundColor: theme.Color.Base.Surface[2], 
            borderRadius: theme.radius['Radius.M'],
            border: `1px solid ${theme.Color.Base.Surface[3]}`,
            display: 'flex',
            flexDirection: 'column',
            gap: theme.spacing['Space.M']
          }}>
             <RangeSlider
              label="Layer Spacing"
              motionValue={layerSpacing}
              onCommit={() => {}}
              min={0}
              max={150}
            />
            <RangeSlider
              label="Rotate X"
              motionValue={viewRotateX}
              onCommit={() => {}}
              min={0}
              max={90}
            />
            <RangeSlider
              label="Rotate Z"
              motionValue={viewRotateZ}
              onCommit={() => {}}
              min={0}
              max={360}
            />
          </div>
        )}
      </div>
    </>
  );
};

export default ControlPanel;