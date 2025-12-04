import React, { useState, useRef, useEffect } from 'react';
import { Send, Zap, Code, Layout, Layers, Loader2, Sparkles, FileCode, Plus, FolderOpen, Download, FileJson, FileText, Database, Copy, Check, Upload, Trash2, ArrowRight, Play, Server, Monitor, RotateCcw, MessageSquare, ToggleLeft, ToggleRight } from 'lucide-react';
import { streamWebsiteCode, cleanCode, parseResponseFiles, extractJsonPlan, applyPatches } from './services/gemini';
import { CodeViewer } from './components/CodeViewer';
import { LivePreview } from './components/LivePreview';
import { FilesMap, AppMode, ChatMessage, ProjectPlan } from './types';
// @ts-ignore
import JSZip from 'jszip';

export function App() {
  const [appMode, setAppMode] = useState<AppMode>('welcome');
  
  // State: Files
  const [files, setFiles] = useState<FilesMap>({});
  const [activeFilename, setActiveFilename] = useState<string>('');
  
  // State: Chat & AI
  const [prompt, setPrompt] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<ProjectPlan | null>(null);
  const [isBatchMode, setIsBatchMode] = useState(false);
  
  // State: UI
  const [activeTab, setActiveTab] = useState<'both' | 'code' | 'preview'>('both');
  const [copied, setCopied] = useState(false);
  
  // Refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamBufferRef = useRef('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  
  // Snapshot for Patching
  const originalFilesSnapshot = useRef<FilesMap>({});

  // --- Initialization ---

  const startEmptyProject = () => {
    setFiles({
      'index.html': `<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <title>Novo Projeto</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-white flex items-center justify-center h-screen">
    <h1 class="text-3xl font-bold">Olá Mundo!</h1>
</body>
</html>`
    });
    setActiveFilename('index.html');
    setAppMode('ide');
    addSystemMessage("Projeto vazio iniciado. O que vamos criar hoje?");
  };

  const startArchitectMode = () => {
    setFiles({});
    setActiveFilename('');
    setAppMode('ide');
    addSystemMessage("Modo Arquiteto ativado. Descreva o sistema completo que você deseja (ex: 'Uma Loja Virtual de Roupas' ou 'Um Dashboard Financeiro'). Eu criarei o plano.");
  };

  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      try {
        const zip = new JSZip();
        const content = await zip.loadAsync(file);
        const newFiles: FilesMap = {};
        
        for (const relativePath of Object.keys(content.files)) {
          if (!content.files[relativePath].dir) {
            const fileData = await content.files[relativePath].async("string");
            const fileName = relativePath.split('/').pop() || relativePath;
            newFiles[fileName] = fileData;
          }
        }
        
        setFiles(newFiles);
        const firstFile = Object.keys(newFiles).find(f => f.endsWith('.html')) || Object.keys(newFiles)[0];
        setActiveFilename(firstFile || '');
        setAppMode('ide');
        addSystemMessage(`Projeto importado com sucesso! ${Object.keys(newFiles).length} arquivos carregados.`);
      } catch (err) {
        console.error(err);
        alert("Erro ao ler arquivo ZIP.");
      }
    }
  };

  // --- Chat & AI Logic ---

  const addSystemMessage = (text: string) => {
    setChatHistory(prev => [...prev, { id: Date.now().toString(), role: 'system', text }]);
  };

  const handleSendMessage = async (overridePrompt?: string) => {
    const textToSend = overridePrompt || prompt;
    if (!textToSend.trim() || isGenerating) return;

    // Add User Message
    const newUserMsg: ChatMessage = { 
        id: Date.now().toString(), 
        role: 'user', 
        text: textToSend,
        batchMode: isBatchMode
    };
    setChatHistory(prev => [...prev, newUserMsg]);
    setPrompt('');
    setIsGenerating(true);
    streamBufferRef.current = '';
    
    // Snapshot files before generation for patching
    originalFilesSnapshot.current = { ...files };

    try {
      await streamWebsiteCode(
        textToSend,
        [...chatHistory, newUserMsg],
        activeFilename,
        files,
        (chunk) => {
          streamBufferRef.current += chunk;
          
          // REAL-TIME PARSING:
          const partialFiles = parseResponseFiles(streamBufferRef.current);
          const foundFiles = Object.keys(partialFiles);
          
          if (foundFiles.length > 0) {
            setFiles(prev => {
                const next = { ...prev };
                // During stream, we just display the generated text (even if it is a patch)
                // so the user can see what the AI is writing.
                foundFiles.forEach(fname => {
                    next[fname] = partialFiles[fname];
                });
                return next;
            });
            
            // Logic to switch active file if the AI starts writing a new one
            setActiveFilename(prev => {
                // If we are currently viewing the file being written, stay. 
                // If a new file appears that isn't the current one, switch to it to show progress.
                const lastModifiedFile = foundFiles[foundFiles.length - 1];
                if (lastModifiedFile && prev !== lastModifiedFile) {
                    return lastModifiedFile;
                }
                if (!prev || prev === '') return foundFiles[0];
                return prev;
            });
          }
        },
        isBatchMode // PASS BATCH MODE STATE
      );

      const fullResponse = streamBufferRef.current;
      
      // Check for Plan
      const plan = extractJsonPlan(fullResponse);
      if (plan) {
        setPendingPlan(plan);
        setChatHistory(prev => [...prev, { 
          id: Date.now().toString(), 
          role: 'model', 
          text: "Criei um plano para o seu sistema. Analise abaixo e aprove para começar.",
          isPlan: true,
          planData: plan
        }]);
      } else {
        // Final Parse & Patch Application
        const generatedFiles = parseResponseFiles(fullResponse);
        const fileNames = Object.keys(generatedFiles);
        
        if (fileNames.length > 0) {
          // Now we apply patches properly using the snapshot
          setFiles(prev => {
              const finalFiles = { ...prev };
              fileNames.forEach(fname => {
                  const content = generatedFiles[fname];
                  // Check if it is a patch
                  if (content.includes('<<<< SEARCH')) {
                      const original = originalFilesSnapshot.current[fname] || '';
                      // Use robust fuzzy patch application
                      finalFiles[fname] = applyPatches(original, content);
                  } else {
                      // Full rewrite
                      finalFiles[fname] = content;
                  }
              });
              return finalFiles;
          });

          // Check for NEXT FILE tag from Batch Mode
          const nextFileRegex = /<!-- NEXT: (.+?) -->/i;
          const nextFileMatch = fullResponse.match(nextFileRegex);
          let nextFile = null;
          if (nextFileMatch) {
              nextFile = nextFileMatch[1].trim();
          }

          // Check for suggested next files in the text (heuristic fallback)
          const suggestionRegex = /próximo arquivo lógico.*?['"](.+?)['"]/i;
          const suggestionMatch = fullResponse.match(suggestionRegex);
          let suggestion = null;
          if (suggestionMatch && !files[suggestionMatch[1]]) {
              suggestion = suggestionMatch[1];
          }

          setChatHistory(prev => [...prev, { 
            id: Date.now().toString(), 
            role: 'model', 
            text: `Código atualizado: ${fileNames.join(', ')}.${nextFile ? `\n[Auto] Preparando ${nextFile}...` : ''}`,
            suggestedFile: suggestion || undefined
          }]);

        } else {
          setChatHistory(prev => [...prev, { 
            id: Date.now().toString(), 
            role: 'model', 
            text: fullResponse 
          }]);
        }
      }

    } catch (error: any) {
      console.error(error);
      let errorMessage = "Erro ao conectar com a IA. Tente novamente.";
      
      if (error?.message?.includes('429') || error?.status === 429 || error?.message?.includes('RESOURCE_EXHAUSTED')) {
        errorMessage = "⚠️ Cota de uso da IA excedida (Erro 429). Por favor, aguarde alguns instantes antes de tentar novamente ou verifique seu plano.";
        // Stop batch mode if error occurs
        setIsBatchMode(false);
      }
      
      addSystemMessage(errorMessage);
    } finally {
      setIsGenerating(false);
      originalFilesSnapshot.current = {}; // Clean up
    }
  };

  // --- Auto-Chain Logic for Batch Mode ---
  useEffect(() => {
    if (!isGenerating && isBatchMode && chatHistory.length > 0) {
        const lastMsg = chatHistory[chatHistory.length - 1];
        if (lastMsg.role === 'model') {
            const nextFileRegex = /<!-- NEXT: (.+?) -->/i;
            const match = lastMsg.text.match(nextFileRegex);
            if (match) {
                const fileToCreate = match[1].trim();
                // Add a small delay to avoid hitting rate limits instantly
                const timer = setTimeout(() => {
                    handleSendMessage(`Criando automaticamente: ${fileToCreate}`);
                }, 2000); // 2 second delay
                return () => clearTimeout(timer);
            }
        }
    }
  }, [chatHistory, isGenerating, isBatchMode]);

  const handleApprovePlan = (startWith: 'frontend' | 'backend') => {
    if (!pendingPlan) return;
    setPendingPlan(null);
    
    let structureList = '';
    if (startWith === 'frontend' && Array.isArray(pendingPlan.structure?.frontend)) {
        structureList = pendingPlan.structure.frontend.join(', ');
    } else if (startWith === 'backend' && Array.isArray(pendingPlan.structure?.backend)) {
        structureList = pendingPlan.structure.backend.join(', ');
    } else {
        structureList = 'os arquivos principais';
    }

    const instruction = isBatchMode 
        ? `Plano Aprovado. Inicie a criação do ${startWith.toUpperCase()}. Comece pelo arquivo mais importante. Lembre-se de usar a tag NEXT: arquivo para continuar a sequência.`
        : `Plano Aprovado. Comece criando APENAS o arquivo principal do ${startWith.toUpperCase()} (ex: index.html ou server.js).`;

    handleSendMessage(instruction);
  };

  const handleContinueGeneration = () => {
    handleSendMessage("Continue gerando o código EXATAMENTE de onde parou na mensagem anterior.");
  };

  const handleDeleteFile = (filename: string) => {
    if (confirm(`Tem certeza que deseja excluir ${filename}?`)) {
      setFiles(prev => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
      if (activeFilename === filename) {
        setActiveFilename(Object.keys(files).find(f => f !== filename) || '');
      }
    }
  };

  const handleCreateNewFile = () => {
    const name = window.prompt("Nome do arquivo (ex: script.js):");
    if (name) {
      setFiles(prev => ({ ...prev, [name]: '// Novo arquivo' }));
      setActiveFilename(name);
    }
  };

  const handleCodeUpdate = (newCode: string) => {
    if (activeFilename) {
        setFiles(prev => ({ ...prev, [activeFilename]: newCode }));
    }
  };

  const handleExport = async () => {
    const zip = new JSZip();
    Object.entries(files).forEach(([filename, content]) => {
      // Clean patching markers if present by accident
      const clean = content.includes('<<<< SEARCH') ? applyPatches(content, '') : cleanCode(content);
      zip.file(filename, clean);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "projeto-webcria.zip";
    a.click();
  };

  const handleCreateSuggestion = (filename: string) => {
      handleSendMessage(`Crie o arquivo ${filename} agora.`);
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, isGenerating]);

  if (appMode === 'welcome') {
    return (
      <div className="h-screen w-screen bg-[#0f172a] text-white flex items-center justify-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0">
            <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-600/20 rounded-full blur-[100px]"></div>
            <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-purple-600/20 rounded-full blur-[100px]"></div>
        </div>

        <div className="z-10 max-w-4xl w-full p-8 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
           <div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 bg-gradient-to-tr from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
                   <Sparkles size={24} className="text-white" />
                </div>
                <h1 className="text-4xl font-bold tracking-tight">WebCria AI</h1>
              </div>
              <h2 className="text-5xl font-extrabold mb-6 leading-tight">
                Crie Softwares <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">em segundos.</span>
              </h2>
              <p className="text-gray-400 text-lg mb-8 leading-relaxed">
                Um ambiente de desenvolvimento completo impulsionado por IA. 
                De landing pages a sistemas full-stack, veja o código sendo escrito em tempo real.
              </p>
           </div>

           <div className="space-y-4">
              <button onClick={startEmptyProject} className="w-full bg-gray-800/50 hover:bg-gray-800 border border-gray-700 hover:border-blue-500/50 p-6 rounded-2xl text-left transition-all group flex items-center justify-between">
                 <div>
                    <h3 className="font-semibold text-xl mb-1 group-hover:text-blue-400 transition-colors">Projeto Vazio</h3>
                    <p className="text-sm text-gray-400">Comece do zero com um editor limpo.</p>
                 </div>
                 <ArrowRight className="text-gray-600 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
              </button>

              <button onClick={startArchitectMode} className="w-full bg-gradient-to-r from-blue-600/10 to-purple-600/10 hover:from-blue-600/20 hover:to-purple-600/20 border border-blue-500/30 hover:border-blue-500/50 p-6 rounded-2xl text-left transition-all group flex items-center justify-between relative overflow-hidden">
                 <div className="relative z-10">
                    <h3 className="font-semibold text-xl mb-1 text-blue-200">IA Arquiteto</h3>
                    <p className="text-sm text-blue-200/60">Planeje e gere sistemas completos.</p>
                 </div>
                 <Sparkles className="text-blue-400 relative z-10" />
                 <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 to-purple-600/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
              </button>

              <div className="relative w-full">
                <input 
                  type="file" 
                  accept=".zip"
                  onChange={handleZipImport}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                />
                <div className="w-full bg-gray-800/50 hover:bg-gray-800 border border-gray-700 border-dashed hover:border-gray-500 p-6 rounded-2xl text-left transition-all flex items-center justify-between">
                    <div>
                        <h3 className="font-semibold text-xl mb-1">Importar ZIP</h3>
                        <p className="text-sm text-gray-400">Carregue um projeto existente.</p>
                    </div>
                    <Upload className="text-gray-600" />
                </div>
              </div>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gray-950 text-white flex flex-col overflow-hidden font-sans">
      <header className="h-14 border-b border-gray-800 bg-[#0d1117] flex items-center justify-between px-4 z-20 shrink-0">
        <div className="flex items-center gap-3">
          <div onClick={() => setAppMode('welcome')} className="cursor-pointer w-8 h-8 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-900/20 hover:scale-105 transition">
            <Sparkles size={16} className="text-white" />
          </div>
          <h1 className="font-bold text-sm tracking-tight text-gray-100">WebCria AI</h1>
        </div>
        
        <div className="flex items-center gap-3">
            <button 
              onClick={handleExport}
              className="flex items-center gap-2 text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-md transition border border-gray-700"
            >
                <Download size={14} /> Exportar ZIP
            </button>

            <div className="flex bg-gray-900/50 p-1 rounded-lg border border-gray-800/50">
              <button onClick={() => setActiveTab('code')} className={`px-3 py-1.5 rounded-md flex items-center gap-2 text-xs font-medium transition-all ${activeTab === 'code' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}>
                <Code size={14} /> Editor
              </button>
              <button onClick={() => setActiveTab('both')} className={`px-3 py-1.5 rounded-md flex items-center gap-2 text-xs font-medium transition-all ${activeTab === 'both' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}>
                <Layers size={14} /> Dividido
              </button>
              <button onClick={() => setActiveTab('preview')} className={`px-3 py-1.5 rounded-md flex items-center gap-2 text-xs font-medium transition-all ${activeTab === 'preview' ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}>
                <Layout size={14} /> Preview
              </button>
            </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        
        {/* Sidebar Left: Files */}
        <div className="w-64 flex flex-col border-r border-gray-800 bg-[#0d1117] shrink-0 z-10">
          <div className="h-10 px-3 border-b border-gray-800 bg-gray-900 flex items-center justify-between shrink-0">
               <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                 <FolderOpen size={12}/> Arquivos
               </span>
               <button onClick={handleCreateNewFile} className="text-gray-500 hover:text-blue-400 transition p-1 hover:bg-gray-800 rounded">
                 <Plus size={14} />
               </button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            {Object.keys(files).length === 0 && (
                <div className="text-center py-8 text-gray-600 text-xs italic">Sem arquivos.</div>
            )}
            {Object.keys(files).map(filename => (
              <div key={filename} className="group flex items-center justify-between pr-2 rounded-lg hover:bg-gray-800 transition-colors">
                  <button
                    onClick={() => setActiveFilename(filename)}
                    className={`flex-1 text-left px-3 py-2 text-sm font-mono flex items-center gap-2 truncate ${activeFilename === filename ? 'text-blue-400 font-medium' : 'text-gray-400'}`}
                  >
                    {filename.endsWith('.html') ? <FileCode size={14} className="text-orange-400 shrink-0" /> : 
                     filename.endsWith('.css') ? <Layout size={14} className="text-blue-400 shrink-0" /> :
                     filename.endsWith('.js') ? <FileJson size={14} className="text-yellow-400 shrink-0" /> :
                     <FileText size={14} className="text-gray-500 shrink-0" />}
                    <span className="truncate">{filename}</span>
                  </button>
                  <button 
                    onClick={() => handleDeleteFile(filename)}
                    className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 p-1 transition-all"
                  >
                      <Trash2 size={12} />
                  </button>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar Middle: Chat */}
        <div className="w-80 flex flex-col border-r border-gray-800 bg-[#0d1117] shrink-0 z-10">
             <div className="h-10 border-b border-gray-800 bg-gray-900 flex items-center px-4 shrink-0">
                <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                  <MessageSquare size={12}/> Assistente
                </span>
             </div>
             <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
                {chatHistory.map((msg) => (
                    <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[90%] rounded-xl p-3 text-sm leading-relaxed ${
                            msg.role === 'user' 
                            ? 'bg-blue-600 text-white rounded-br-none' 
                            : msg.role === 'system'
                            ? 'bg-gray-800/50 text-gray-400 text-xs border border-dashed border-gray-700 w-full text-center'
                            : 'bg-gray-800 text-gray-200 rounded-bl-none border border-gray-700'
                        }`}>
                            {msg.role === 'model' && <div className="flex items-center gap-1 mb-1 text-xs text-blue-400 font-medium"><Sparkles size={10}/> WebCria</div>}
                            {msg.text}
                            {msg.isPlan && msg.planData && (
                                <div className="mt-3 bg-gray-900 rounded p-2 border border-gray-700">
                                    <div className="text-xs font-mono mb-2 text-green-400">Plano Gerado:</div>
                                    <div className="grid gap-2">
                                        <button 
                                            onClick={() => handleApprovePlan('frontend')}
                                            className="flex items-center gap-2 text-xs bg-gray-800 hover:bg-gray-700 p-2 rounded border border-gray-600 transition"
                                        >
                                            <Monitor size={12}/> Criar Frontend
                                        </button>
                                        <button 
                                            onClick={() => handleApprovePlan('backend')}
                                            className="flex items-center gap-2 text-xs bg-gray-800 hover:bg-gray-700 p-2 rounded border border-gray-600 transition"
                                        >
                                            <Server size={12}/> Criar Backend
                                        </button>
                                    </div>
                                </div>
                            )}
                            {msg.suggestedFile && (
                                <button 
                                    onClick={() => handleCreateSuggestion(msg.suggestedFile!)}
                                    className="mt-2 w-full text-xs flex items-center justify-center gap-1 bg-blue-900/30 hover:bg-blue-800/50 text-blue-300 py-1.5 rounded border border-blue-900 transition"
                                >
                                    <Plus size={10} /> Criar {msg.suggestedFile}
                                </button>
                            )}
                        </div>
                    </div>
                ))}
                {isGenerating && (
                    <div className="flex items-center gap-2 text-gray-500 text-xs pl-2">
                        <Loader2 size={12} className="animate-spin"/> Pensando e escrevendo...
                    </div>
                )}
                <div ref={chatEndRef} />
             </div>

             {!isGenerating && chatHistory.length > 0 && chatHistory[chatHistory.length - 1].role === 'model' && (
                 <div className="px-4 pb-2">
                    <button 
                        onClick={handleContinueGeneration}
                        className="w-full text-xs flex items-center justify-center gap-1 text-gray-500 hover:text-blue-400 py-2 border-t border-gray-800 hover:bg-gray-900 transition"
                    >
                        <RotateCcw size={10} /> Continuar geração anterior
                    </button>
                 </div>
             )}

             <div className="p-3 bg-[#0d1117] border-t border-gray-800 shrink-0">
                <div className="flex items-center justify-between px-1 pb-2">
                   <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setIsBatchMode(!isBatchMode)}
                        className={`flex items-center gap-2 text-[10px] font-medium px-2 py-1 rounded-full transition-colors border ${isBatchMode ? 'bg-purple-900/20 text-purple-300 border-purple-800' : 'bg-gray-800 text-gray-500 border-gray-700 hover:border-gray-500'}`}
                        title={isBatchMode ? "A IA criará todos os arquivos sequencialmente" : "A IA criará um arquivo por vez e perguntará"}
                      >
                         {isBatchMode ? <ToggleRight size={14} className="text-purple-400"/> : <ToggleLeft size={14}/>}
                         {isBatchMode ? "Modo Completo (Batch)" : "Passo a Passo"}
                      </button>
                   </div>
                </div>

                <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="relative">
                    <textarea
                      ref={textareaRef}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                      placeholder="Instrua a IA..."
                      className="w-full bg-gray-900 text-white text-sm rounded-xl pl-3 pr-10 py-3 focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-none min-h-[44px] max-h-[120px] placeholder-gray-600 border border-gray-800"
                      rows={1}
                      disabled={isGenerating}
                    />
                    <button
                      type="submit"
                      disabled={!prompt.trim() || isGenerating}
                      className="absolute right-2 bottom-2 p-1.5 text-blue-500 hover:text-white hover:bg-blue-600 rounded-lg transition-all disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      <Send size={16} />
                    </button>
                </form>
             </div>
        </div>

        <div className="flex-1 flex min-w-0 bg-[#1e1e1e]">
          {(activeTab === 'both' || activeTab === 'code') && (
            <div className={`${activeTab === 'both' ? 'w-1/2' : 'w-full'} flex flex-col h-full border-r border-gray-800 relative`}>
              <div className="bg-[#1e1e1e] border-b border-gray-800 px-4 flex justify-between items-center text-xs font-mono text-gray-500 shrink-0 h-10">
                 <span className="flex items-center gap-2">
                   {activeFilename ? (
                       <>
                           <span className="text-gray-400">Arquivo:</span>
                           <span className="text-yellow-500 font-semibold">{activeFilename}</span>
                           {files[activeFilename]?.includes('<<<< SEARCH') && (
                               <span className="text-purple-400 text-[10px] uppercase font-bold px-1.5 py-0.5 bg-purple-900/30 rounded border border-purple-800 ml-2">Patch Mode</span>
                           )}
                       </>
                   ) : (
                       <span className="text-gray-600">Nenhum arquivo selecionado</span>
                   )}
                 </span>
                 
                 {activeFilename && (
                     <button 
                        onClick={() => {
                            navigator.clipboard.writeText(files[activeFilename]);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                        }}
                        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                     >
                        {copied ? <Check size={12} className="text-green-400"/> : <Copy size={12}/>}
                     </button>
                 )}
              </div>
              
              <div className="flex-1 min-h-0 relative">
                <CodeViewer 
                    code={files[activeFilename] || ''} 
                    isGenerating={isGenerating} 
                    onChange={handleCodeUpdate}
                />
              </div>
            </div>
          )}

          {(activeTab === 'both' || activeTab === 'preview') && (
            <div className={`${activeTab === 'both' ? 'w-1/2' : 'w-full'} flex flex-col h-full`}>
              <LivePreview 
                code={files[activeFilename] || ''} 
                isGenerating={isGenerating} 
                activeFilename={activeFilename}
                onNavigate={(href) => {
                    if (files[href]) setActiveFilename(href);
                    else alert(`Arquivo ${href} não encontrado.`);
                }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }
}