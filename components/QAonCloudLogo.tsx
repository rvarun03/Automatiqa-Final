import React from 'react';

export const QAonCloudLogo = ({ className = "h-12 mx-auto mb-6" }: { className?: string }) => (
  <div className={className + " flex items-center justify-center gap-3"}>
    <svg width="44" height="44" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Inner circle */}
      <circle cx="50" cy="50" r="14" stroke="white" strokeWidth="8" />
      
      {/* Outer broken circle - Top Left part ending with an inward line */}
      <path 
        d="M32 32 A 32 32 0 1 1 68 68 L 82 82" 
        stroke="white" 
        strokeWidth="8" 
        strokeLinecap="round" 
        fill="none"
      />
      
      {/* Outer broken circle - Bottom Right part ending with an inward line */}
      <path 
        d="M68 68 A 32 32 0 1 1 32 32 L 18 18" 
        stroke="white" 
        strokeWidth="8" 
        strokeLinecap="round" 
        fill="none"
      />
    </svg>
    <span className="text-white text-4xl font-bold tracking-tight" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>QAonCloud</span>
  </div>
);
