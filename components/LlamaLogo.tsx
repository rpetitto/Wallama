
import React from 'react';

interface LlamaLogoProps {
  className?: string;
  // Color prop removed as we are using a static PNG
}

export const LlamaLogo: React.FC<LlamaLogoProps> = ({ className = "w-12 h-12" }) => {
  return (
    <img 
      src="/logo.png" 
      alt="Wallama Logo" 
      className={`object-contain ${className}`}
    />
  );
};
