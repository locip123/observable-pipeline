import React from 'react'

// ── Step-specific SVG illustrations (simplified frames of animation) ──────────

export const TaskIcon = () => (
  <svg viewBox="0 0 32 32" width="20" height="20" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="24" height="24" rx="4" stroke="currentColor" strokeWidth="2"/>
    <path d="M10 12h12M10 16h8M10 20h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)

export const AssetImportSvg = () => (
  <svg viewBox="0 0 48 48" width="36" height="36" fill="none" aria-hidden="true">
    <rect x="6" y="6" width="36" height="36" rx="6" fill="var(--a-bg)" stroke="var(--a-l)" strokeWidth="1.5"/>
    <path d="M24 14v16M17 27l7 7 7-7" stroke="var(--a-l)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <rect x="12" y="34" width="24" height="3" rx="1.5" fill="var(--a-m)" opacity=".4"/>
  </svg>
)

export const FrameExtractionSvg = () => (
  <svg viewBox="0 0 48 48" width="36" height="36" fill="none" aria-hidden="true">
    <rect x="2" y="10" width="13" height="28" rx="2" fill="var(--a-bg)" stroke="var(--a-l)" strokeWidth="1.5"/>
    <rect x="17.5" y="10" width="13" height="28" rx="2" fill="var(--a-bg)" stroke="var(--a-l)" strokeWidth="1.5"/>
    <rect x="33" y="10" width="13" height="28" rx="2" fill="var(--a-bg)" stroke="var(--a-l)" strokeWidth="1.5"/>
    <circle cx="8.5" cy="24" r="3" fill="var(--a-l)" opacity=".6"/>
    <circle cx="24" cy="24" r="3" fill="var(--a-l)" opacity=".8"/>
    <circle cx="39.5" cy="24" r="3" fill="var(--a-l)"/>
  </svg>
)

export const BackgroundRemovalSvg = () => (
  <svg viewBox="0 0 48 48" width="36" height="36" fill="none" aria-hidden="true">
    <defs>
      <pattern id="checker" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
        <rect width="4" height="4" fill="var(--n-2)"/>
        <rect x="4" y="4" width="4" height="4" fill="var(--n-2)"/>
        <rect x="4" y="0" width="4" height="4" fill="var(--n-1)"/>
        <rect x="0" y="4" width="4" height="4" fill="var(--n-1)"/>
      </pattern>
    </defs>
    <rect x="4" y="4" width="40" height="40" rx="4" fill="url(#checker)"/>
    <ellipse cx="24" cy="22" rx="10" ry="12" fill="var(--gpu-color)" opacity=".7"/>
    <ellipse cx="24" cy="34" rx="14" ry="7" fill="var(--gpu-color)" opacity=".5"/>
  </svg>
)

export const StyleTransferSvg = () => (
  <svg viewBox="0 0 48 48" width="36" height="36" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="40" height="40" rx="6" fill="var(--a-bg)"/>
    <path d="M12 36 Q18 12 24 24 Q30 36 36 12" stroke="var(--gpu-color)" strokeWidth="3" fill="none" strokeLinecap="round"/>
    <path d="M12 28 Q20 18 24 24 Q28 30 36 20" stroke="var(--a-l)" strokeWidth="2" fill="none" strokeLinecap="round" opacity=".7"/>
    <circle cx="24" cy="24" r="4" fill="var(--a-m)" opacity=".9"/>
  </svg>
)

export const FrameCompositionSvg = () => (
  <svg viewBox="0 0 48 48" width="36" height="36" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="18" height="14" rx="2" fill="var(--a-bg)" stroke="var(--a-l)" strokeWidth="1.5"/>
    <rect x="26" y="4" width="18" height="14" rx="2" fill="var(--a-bg)" stroke="var(--a-l)" strokeWidth="1.5"/>
    <rect x="4" y="22" width="18" height="14" rx="2" fill="var(--a-bg)" stroke="var(--a-l)" strokeWidth="1.5"/>
    <rect x="26" y="22" width="18" height="14" rx="2" fill="var(--a-bg)" stroke="var(--a-l)" strokeWidth="1.5"/>
    <rect x="12" y="38" width="24" height="6" rx="2" fill="var(--success)" opacity=".7"/>
    <path d="M22 41h4M24 39v4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

export const VideoEncodingSvg = () => (
  <svg viewBox="0 0 48 48" width="36" height="36" fill="none" aria-hidden="true">
    <rect x="4" y="8" width="30" height="32" rx="4" fill="var(--a-bg)" stroke="var(--a-l)" strokeWidth="1.5"/>
    <polygon points="34,12 44,24 34,36" fill="var(--success)" opacity=".8"/>
    <path d="M10 18h18M10 24h14M10 30h16" stroke="var(--a-l)" strokeWidth="2" strokeLinecap="round" opacity=".6"/>
  </svg>
)

export const STEP_SVG: Record<string, React.FC> = {
  asset_import:       AssetImportSvg,
  frame_extraction:   FrameExtractionSvg,
  background_removal: BackgroundRemovalSvg,
  style_transfer:     StyleTransferSvg,
  frame_composition:  FrameCompositionSvg,
  video_encoding:     VideoEncodingSvg,
}

export const GpuChipSvg = () => (
  <svg viewBox="0 0 20 20" width="14" height="14" fill="none" aria-hidden="true">
    <rect x="4" y="4" width="12" height="12" rx="2" stroke="var(--gpu-color)" strokeWidth="1.5"/>
    <rect x="7" y="7" width="6" height="6" rx="1" fill="var(--gpu-color)" opacity=".4"/>
    <path d="M7 2v2M10 2v2M13 2v2M7 16v2M10 16v2M13 16v2M2 7h2M2 10h2M2 13h2M16 7h2M16 10h2M16 13h2"
          stroke="var(--gpu-color)" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
)

export const CacheBadgeSvg = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
    <path d="M8 2a6 6 0 100 12A6 6 0 008 2z" stroke="var(--warning)" strokeWidth="1.5"/>
    <path d="M5 8l2 2 4-4" stroke="var(--warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)
