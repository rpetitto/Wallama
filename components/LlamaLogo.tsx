
import React from 'react';

interface LlamaLogoProps {
  className?: string;
  // Color prop removed as we are using a static PNG
}

export const LlamaLogo: React.FC<LlamaLogoProps> = ({ className = "w-12 h-12" }) => {
  return (
    <img 
      src="https://res.cloudinary.com/robertpetitto/image/upload/v1768482715/Wallama/logo.png" 
      alt="Wallama Logo" 
      className={`object-contain ${className}`}
    />
  );
};
