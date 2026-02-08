
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ButtonVariant, ButtonSize } from '../components/Core/Button.tsx';

// --- Window Management ---
export type WindowId = 'control' | 'code' | 'console';

export interface WindowState {
  id: WindowId;
  title: string;
  isOpen: boolean;
  zIndex: number;
  x: number;
  y: number;
}

// --- Console Logging ---
export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
}

// --- Button Props for Meta Prototype ---
export interface MetaButtonProps {
    label: string;
    variant: ButtonVariant;
    size: ButtonSize;
    icon: string;
    customFill: string;
    customColor: string;
    customRadius: string;
    // States
    disabled: boolean;
    forcedHover: boolean;
    forcedFocus: boolean;
    forcedActive: boolean;
}

// --- Water Simulation Props ---
export interface WaterConfig {
  // Visuals
  colorShallow: string;
  colorDeep: string;
  foamColor: string;
  transparency: number; // 0-1
  roughness: number; // 0-1
  waveHeight: number; // 0-5
  waveSpeed: number; // 0-2
  waveScale: number; // 0-50
  normalFlatness: number; // 0-100
  
  // Ripple Physics
  rippleDamping: number; // 0.9 - 0.999
  rippleStrength: number; // 0.01 - 1.0
  rippleRadius: number; // 0.01 - 0.2
  rippleIntensity: number; // 0.1 - 5.0
}
