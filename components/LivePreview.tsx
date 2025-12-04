import React, { useState, useEffect, useRef } from 'react';
import { Smartphone, Monitor, Tablet, RotateCw, Globe, Terminal, XCircle, AlertTriangle, Info, Database } from 'lucide-react';
import { DevicePreview, LogEntry } from '../types';

interface LivePreviewProps {
  code: string;
  isGenerating: boolean;
  activeFilename: string;
  onNavigate: (href: string) => void;
}

export const LivePreview: React.FC<LivePreviewProps> = ({ code, isGenerating, activeFilename, onNavigate }) => {
  const [device, setDevice] = useState<DevicePreview>('desktop');
  const [key, setKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  // Console Logs State
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const isHtml = activeFilename.endsWith('.html') || activeFilename.endsWith('.htm');
  const isPatching = code.includes('<<<< SEARCH');

  const getWidth = () => {
    switch (device) {
      case 'mobile': return '375px';
      case 'tablet': return '768px';
      default: return '100%';
    }
  };

  const handleReload = () => {
    setLogs([]); // Clear logs on reload
    setKey(prev => prev + 1);
  };

  useEffect(() => {
    if (showConsole && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, showConsole]);

  const injectionScript = `
    <script>
      (function() {
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;
        const originalInfo = console.info;

        function sendLog(type, args) {
          try {
            const message = args.map(arg => {
              if (typeof arg === 'object') return JSON.stringify(arg);
              return String(arg);
            }).join(' ');
            window.parent.postMessage({ type: 'CONSOLE_LOG', logType: type, message }, '*');
          } catch (e) {}
        }

        console.log = function(...args) { sendLog('log', args); originalLog.apply(console, args); };
        console.error = function(...args) { sendLog('error', args); originalError.apply(console, args); };
        console.warn = function(...args) { sendLog('warn', args); originalWarn.apply(console, args); };
        console.info = function(...args) { sendLog('info', args); originalInfo.apply(console, args); };
      })();

      document.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link) {
          const href = link.getAttribute('href');
          if (href && !href.startsWith('http') && !href.startsWith('#')) {
            e.preventDefault();
            window.parent.postMessage({ type: 'NAVIGATE', url: href }, '*');
          }
        }
      });
    </script>
  `;

  const finalCode = isHtml 
    ? (code.includes('</body>') 
        ? code.replace('</body>', `${injectionScript}</body>`)
        : code + injectionScript)
    : '';

  if (!isHtml) {
    return (
      <div className="flex flex-col h-full bg-gray-900 items-center justify-center text-gray-400 p-8 text-center">
        <div className="w-20 h-20 bg-gray-800 rounded-2xl flex items-center justify-center mb-6 shadow-xl">
           <Database size={40} className="text-purple-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-200 mb-2">Arquivo de Backend / Script</h2>
        <p className="max-w-md text-sm mb-6">
          O arquivo <span className="text-yellow-400 font-mono bg-gray-800 px-1 rounded">{activeFilename}</span> é código de servidor (Node.js, PHP, Python) ou configuração. 
          Não é possível renderizar um preview visual direto no navegador.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 relative">
      <div className="bg-gray-800 border-b border-gray-700 px-4 flex justify-between items-center text-xs font-mono text-gray-500 shrink-0 h-10">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-300">
            <Globe size={14} className="text-blue-400"/>
            <span>localhost:3000/{activeFilename}</span>
        </div>
        <div className="flex items-center gap-2 bg-gray-900 rounded-lg p-1">
          <button onClick={() => setDevice('mobile')} className={`p-1.5 rounded transition-all ${device === 'mobile' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}><Smartphone size={16} /></button>
          <button onClick={() => setDevice('tablet')} className={`p-1.5 rounded transition-all ${device === 'tablet' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}><Tablet size={16} /></button>
          <button onClick={() => setDevice('desktop')} className={`p-1.5 rounded transition-all ${device === 'desktop' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}><Monitor size={16} /></button>
        </div>
        <button onClick={handleReload} className="text-gray-400 hover:text-white p-1 hover:rotate-180 transition-transform duration-500">
          <RotateCw size={14} />
        </button>
      </div>
      
      <div className="flex-1 flex justify-center bg-gray-950 overflow-hidden relative">
        {(isGenerating || isPatching) && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-gray-900/80 backdrop-blur-sm transition-all duration-300">
             <div className="w-64 space-y-3 text-center">
                {isPatching ? (
                    <div className="flex flex-col items-center gap-2">
                        <RotateCw className="animate-spin text-purple-400" size={32}/>
                        <p className="text-sm font-medium text-purple-200">Aplicando Patch Inteligente...</p>
                        <p className="text-xs text-purple-300/60">O preview retornará em breve.</p>
                    </div>
                ) : (
                    <>
                        <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
                            <div className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 w-full animate-progress origin-left"></div>
                        </div>
                        <p className="text-sm font-medium text-blue-200 animate-pulse">WebCria trabalhando...</p>
                    </>
                )}
             </div>
          </div>
        )}

        <div 
          className="transition-all duration-500 ease-out h-full bg-white shadow-2xl origin-top"
          style={{ 
            width: getWidth(), 
            borderLeft: device !== 'desktop' ? '1px solid #333' : 'none', 
            borderRight: device !== 'desktop' ? '1px solid #333' : 'none',
            transform: device !== 'desktop' ? 'scale(0.95) translateY(10px)' : 'scale(1)'
          }}
        >
          <iframe
            ref={iframeRef}
            key={key}
            srcDoc={finalCode}
            title="preview"
            className="w-full h-full border-none bg-white"
            sandbox="allow-scripts allow-modals allow-forms allow-popups allow-same-origin"
          />
        </div>
      </div>

      <div className={`absolute bottom-0 left-0 right-0 bg-[#0d1117] border-t border-gray-700 transition-all duration-300 flex flex-col z-30 ${showConsole ? 'h-48' : 'h-8'}`}>
        <div 
          className="h-8 bg-gray-800 flex items-center justify-between px-4 cursor-pointer hover:bg-gray-750"
          onClick={() => setShowConsole(!showConsole)}
        >
          <div className="flex items-center gap-2 text-xs font-mono text-gray-300">
            <Terminal size={12} />
            <span>Console ({logs.length})</span>
          </div>
          <div className="text-[10px] text-gray-500">
            {showConsole ? 'Clique para ocultar' : 'Clique para expandir'}
          </div>
        </div>
        
        {showConsole && (
           <div className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-1 custom-scrollbar">
             {logs.length === 0 ? (
               <div className="text-gray-600 italic px-2">Nenhum log registrado.</div>
             ) : (
               logs.map((log, i) => (
                 <div key={i} className={`flex gap-2 px-2 py-1 border-b border-gray-800/50 ${
                   log.type === 'error' ? 'text-red-400 bg-red-900/10' : 
                   log.type === 'warn' ? 'text-yellow-400 bg-yellow-900/10' : 
                   'text-gray-300'
                 }`}>
                    <span className="text-gray-600 shrink-0">[{log.timestamp}]</span>
                    {log.type === 'error' && <XCircle size={12} className="mt-0.5 shrink-0"/>}
                    {log.type === 'warn' && <AlertTriangle size={12} className="mt-0.5 shrink-0"/>}
                    {log.type === 'info' && <Info size={12} className="mt-0.5 shrink-0"/>}
                    <span className="break-all">{log.message}</span>
                 </div>
               ))
             )}
             <div ref={logsEndRef} />
           </div>
        )}
      </div>

      <style>{`
        @keyframes progress { 0% { transform: translateX(-100%); } 50% { transform: translateX(0%); } 100% { transform: translateX(100%); } }
        .animate-progress { animation: progress 1.5s infinite linear; }
      `}</style>
    </div>
  );
};