
import React, { useEffect, useRef, useState } from 'react';

interface CodeViewerProps {
  code: string;
  isGenerating: boolean;
  onChange?: (newCode: string) => void;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({ code, isGenerating, onChange }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Sync scroll between line numbers and textarea
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  useEffect(() => {
    // Only auto-scroll to bottom if generating to follow the stream
    // Using scrollTop = scrollHeight is smoother than scrollIntoView and prevents jumping up
    if (isGenerating && textareaRef.current) {
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }
  }, [code, isGenerating]);

  // Generate line numbers
  const lines = (code || '').split('\n');
  
  return (
    <div className="h-full w-full bg-[#1e1e1e] flex text-sm font-mono overflow-hidden relative">
      {/* Line Numbers Container */}
      <div 
        ref={lineNumbersRef}
        className="bg-[#1e1e1e] text-gray-600 text-right pr-4 pl-2 py-4 select-none border-r border-gray-800 shrink-0 min-w-[3rem] font-mono leading-6 overflow-hidden h-full box-border"
      >
        {lines.map((_, i) => (
          <div key={i} className="h-6">{i + 1}</div>
        ))}
      </div>

      {/* Editable Code Content */}
      <textarea
        ref={textareaRef}
        value={code || ""}
        onChange={(e) => onChange && onChange(e.target.value)}
        onScroll={handleScroll}
        spellCheck={false}
        className="flex-1 resize-none bg-[#1e1e1e] text-blue-100 p-4 font-mono leading-6 tab-4 outline-none border-none whitespace-pre overflow-auto w-full h-full box-border custom-scrollbar"
        disabled={false}
      />
      
      {isGenerating && (
        <div className="absolute top-2 right-4">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]"></span>
        </div>
      )}
    </div>
  );
};
