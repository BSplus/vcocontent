import React, { useEffect } from 'react';

interface SimpleModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function SimpleModal({ 
  isOpen, 
  onClose, 
  title, 
  children 
}: SimpleModalProps) {
  
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-80 transition-opacity" 
        onClick={onClose} // Close when backdrop is clicked
      />
      
      {/* Modal */}
      <div className="bg-background border relative rounded-lg m-4 p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto z-50">
        {/* Header */}
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button 
            type="button" 
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
            <span className="sr-only">Close</span>
          </button>
        </div>
        
        {/* Content */}
        <div>
          {children}
        </div>
      </div>
    </div>
  );
}