/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState, useEffect } from 'react';
import { useMotionValue, useTransform, AnimatePresence } from 'framer-motion';
import { useTheme } from '../../Theme.tsx';
import ThemeToggleButton from '../Core/ThemeToggleButton.tsx';
import FloatingWindow from '../Package/FloatingWindow.tsx';
import Dock from '../Section/Dock.tsx';
import Stage from '../Section/Stage.tsx';
import ControlPanel from '../Package/ControlPanel.tsx';
import CodePanel from '../Package/CodePanel.tsx';
import ConsolePanel from '../Package/ConsolePanel.tsx';
import UndoRedo from '../Package/UndoRedo.tsx';
import Confetti from '../Core/Confetti.tsx';
import { WindowId, WindowState, LogEntry, MetaButtonProps, WaterConfig } from '../../types/index.tsx';

/**
 * 🏎️ Meta Prototype App
 * Acts as the main state orchestrator for the application.
 */
const MetaPrototype = () => {
  const { theme } = useTheme();
  
  // -- App State --
  const [btnProps, setBtnProps] = useState<MetaButtonProps>({
    label: 'Do Magic',
    variant: 'primary',
    size: 'M',
    icon: 'ph-sparkle',
    customFill: '',
    customColor: '',
    customRadius: '56px',
    disabled: false,
    forcedHover: false,
    forcedFocus: false,
    forcedActive: false,
  });

  // -- Water Simulation State --
  const [waterConfig, setWaterConfig] = useState<WaterConfig>({
    colorShallow: '#22aaff', // Bright Azure
    colorDeep: '#001e3b',    // Deep Navy
    foamColor: '#ffffff',
    transparency: 0.8,
    roughness: 0.45,         // Balanced steepness (prevents black folding)
    waveHeight: 0.6,         // Realistic swell height
    waveSpeed: 0.2,          // Calm motion
    waveScale: 1.5,
    normalFlatness: 1.0,
  });
  
  // -- View / Inspection State --
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  
  // 3D Layer View State
  const [view3D, setView3D] = useState(false);
  const layerSpacing = useMotionValue(0);
  const viewRotateX = useMotionValue(55);
  const viewRotateZ = useMotionValue(45);

  // -- Confetti State --
  const [confettiTrigger, setConfettiTrigger] = useState(0);

  // -- Real-time MotionValue for live UI updates --
  const radiusMotionValue = useMotionValue(parseInt(btnProps.customRadius) || 0);
  const radiusStringMotionValue = useTransform(radiusMotionValue, (v) => `${Math.round(v)}px`);

  // Sync MotionValue when state is changed by other means (e.g., undo/redo)
  useEffect(() => {
    radiusMotionValue.set(parseInt(btnProps.customRadius) || 0);
  }, [btnProps.customRadius, radiusMotionValue]);
  
  // Auto-expand layers when entering 3D mode
  useEffect(() => {
    if (view3D) {
      layerSpacing.set(40);
    } else {
      layerSpacing.set(0);
    }
  }, [view3D, layerSpacing]);


  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // -- History State --
  const [history, setHistory] = useState<MetaButtonProps[]>([]);
  const [future, setFuture] = useState<MetaButtonProps[]>([]);

  // --- Window Management ---
  const WINDOW_WIDTH = 400;
  const CONTROL_PANEL_HEIGHT = 640; // Increased height for new 3D controls
  const CODE_PANEL_HEIGHT = 408;
  const CONSOLE_PANEL_HEIGHT = 200; // Increased slightly for better visibility

  const [windows, setWindows] = useState<Record<WindowId, WindowState>>({
    control: { id: 'control', title: 'Control', isOpen: false, zIndex: 1, x: -WINDOW_WIDTH / 2, y: -CONTROL_PANEL_HEIGHT / 2 },
    code: { id: 'code', title: 'Code I/O', isOpen: false, zIndex: 2, x: -WINDOW_WIDTH / 2, y: -CODE_PANEL_HEIGHT / 2 },
    console: { id: 'console', title: 'Console', isOpen: false, zIndex: 3, x: -WINDOW_WIDTH / 2, y: -CONSOLE_PANEL_HEIGHT / 2 },
  });

  // -- Code Editor State --
  const [codeText, setCodeText] = useState('');
  const [isCodeFocused, setIsCodeFocused] = useState(false);
  
  useEffect(() => {
    if (!isCodeFocused) {
      // Switched to WaterConfig as it's the active visualization
      setCodeText(JSON.stringify(waterConfig, null, 2));
    }
  }, [waterConfig, isCodeFocused]);

  // -- Actions --

  const logEvent = (msg: string) => {
    const entry: LogEntry = {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      message: msg,
    };
    // Append new logs to the end (Standard Console behavior)
    // Keep only the last 50 logs
    setLogs(prev => [...prev, entry].slice(-50));
  };
  
  // Initial Log
  useEffect(() => {
      logEvent('System Ready. Meta Prototype initialized.');
  }, []);

  const updateBtnProps = (newProps: MetaButtonProps, saveHistory: boolean = true) => {
    if (saveHistory) {
      setHistory(prev => [...prev, btnProps]);
      setFuture([]);
    }
    setBtnProps(newProps);
  };

  const updateWaterConfig = (updates: Partial<WaterConfig>) => {
    setWaterConfig(prev => ({ ...prev, ...updates }));
    logEvent(`Water updated: ${Object.keys(updates).join(', ')}`);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const newHistory = history.slice(0, -1);
    setFuture(prev => [btnProps, ...prev]);
    setBtnProps(previous);
    setHistory(newHistory);
    logEvent('Undo performed');
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    setHistory(prev => [...prev, btnProps]);
    setBtnProps(next);
    setFuture(newFuture);
    logEvent('Redo performed');
  };

  const bringToFront = (id: WindowId) => {
    setWindows(prev => {
      const maxZ = Math.max(...Object.values(prev).map((w: WindowState) => w.zIndex));
      if (prev[id].zIndex === maxZ) return prev;
      return { ...prev, [id]: { ...prev[id], zIndex: maxZ + 1 } };
    });
  };

  const toggleWindow = (id: WindowId) => {
    setWindows(prev => {
      const isOpen = !prev[id].isOpen;
      const next = { ...prev, [id]: { ...prev[id], isOpen } };
      if (isOpen) {
        const maxZ = Math.max(...Object.values(prev).map((w: WindowState) => w.zIndex));
        next[id].zIndex = maxZ + 1;
      }
      return next;
    });
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(codeText);
    logEvent('JSON copied to clipboard');
  };
  
  const handlePropChange = (keyOrObj: string | Partial<MetaButtonProps>, value?: any) => {
    if (typeof keyOrObj === 'string') {
        updateBtnProps({ ...btnProps, [keyOrObj]: value });
        logEvent(`Prop updated: ${keyOrObj} = ${value}`);
    } else {
        updateBtnProps({ ...btnProps, ...keyOrObj });
        logEvent(`State updated: ${Object.keys(keyOrObj).join(', ')}`);
    }
  };

  const handleRadiusCommit = (value: number) => {
    handlePropChange('customRadius', `${value}px`);
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setCodeText(newVal);
    try {
      const parsed = JSON.parse(newVal);
      // Now updating WaterConfig
      updateWaterConfig(parsed);
    } catch (err) {
      // Invalid JSON, just update text
    }
  };

  const handleToggleMeasurements = () => {
    setShowMeasurements(prev => !prev);
    if (showTokens) setShowTokens(false); // Exclusive toggle
    logEvent(`Measurements toggled: ${!showMeasurements ? 'On' : 'Off'}`);
  };

  const handleToggleTokens = () => {
    setShowTokens(prev => !prev);
    if (showMeasurements) setShowMeasurements(false); // Exclusive toggle
    logEvent(`Tokens toggled: ${!showTokens ? 'On' : 'Off'}`);
  };
  
  const handleStageButtonClick = () => {
    logEvent('Button Clicked! (Triggered Action)');
    setConfettiTrigger(prev => prev + 1);
  };

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
      <ThemeToggleButton />
      <Confetti trigger={confettiTrigger} />

      <Stage
        btnProps={{...btnProps, customRadius: radiusStringMotionValue}}
        waterConfig={waterConfig}
        onButtonClick={handleStageButtonClick}
        showMeasurements={showMeasurements}
        showTokens={showTokens}
        view3D={view3D}
        viewRotateX={viewRotateX}
        viewRotateZ={viewRotateZ}
        layerSpacing={layerSpacing}
      />

      {/* --- WINDOWS --- */}
      <AnimatePresence>
        {windows.control.isOpen && (
          <FloatingWindow
            key="control"
            {...windows.control}
            onClose={() => toggleWindow('control')}
            onFocus={() => bringToFront('control')}
            footer={<UndoRedo onUndo={handleUndo} onRedo={handleRedo} canUndo={history.length > 0} canRedo={future.length > 0} />}
          >
            <ControlPanel
                btnProps={btnProps}
                waterConfig={waterConfig}
                onPropChange={handlePropChange}
                onWaterPropChange={updateWaterConfig}
                radiusMotionValue={radiusMotionValue}
                onRadiusCommit={handleRadiusCommit}
                showMeasurements={showMeasurements}
                onToggleMeasurements={handleToggleMeasurements}
                showTokens={showTokens}
                onToggleTokens={handleToggleTokens}
                // 3D Props
                view3D={view3D}
                onToggleView3D={() => setView3D(!view3D)}
                layerSpacing={layerSpacing}
                viewRotateX={viewRotateX}
                viewRotateZ={viewRotateZ}
            />
          </FloatingWindow>
        )}

        {windows.code.isOpen && (
          <FloatingWindow
            key="code"
            {...windows.code}
            onClose={() => toggleWindow('code')}
            onFocus={() => bringToFront('code')}
          >
            <CodePanel
              codeText={codeText}
              onCodeChange={handleCodeChange}
              onCopyCode={handleCopyCode}
              onFocus={() => setIsCodeFocused(true)}
              onBlur={() => setIsCodeFocused(false)}
              waterConfig={waterConfig}
            />
          </FloatingWindow>
        )}

        {windows.console.isOpen && (
          <FloatingWindow
            key="console"
            {...windows.console}
            onClose={() => toggleWindow('console')}
            onFocus={() => bringToFront('console')}
          >
            <ConsolePanel logs={logs} />
          </FloatingWindow>
        )}
      </AnimatePresence>

      <Dock windows={windows} toggleWindow={toggleWindow} />
    </div>
  );
};

export default MetaPrototype;