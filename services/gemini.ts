
import { GoogleGenAI } from "@google/genai";
import { FilesMap, ChatMessage, AiPersona } from "../types";

// Safe access to API Key
const getApiKey = () => {
  try {
    return process.env.API_KEY || '';
  } catch (e) {
    console.warn("API Key not found in process.env");
    return '';
  }
};

const apiKey = getApiKey();
const ai = new GoogleGenAI({ apiKey });

// --- PROMPTS ESPECIALIZADOS ---

const COMMON_RULES = `
FORMATO DO CÓDIGO:
Use sempre blocos Markdown com o nome do arquivo (incluindo a pasta) acima:
<!-- FILENAME: pasta/arquivo.ext -->
\`\`\`linguagem
...
\`\`\`
`;

const FRONTEND_INSTRUCTION = `
Você é o WebCria Frontend Expert, um especialista mundial em UI/UX, Design Systems e React/HTML/CSS.

SUA MISSÃO:
Criar interfaces visuais deslumbrantes, responsivas e modernas.
- Stack Principal: HTML5, Tailwind CSS (via CDN), Vanilla JS (para interatividade DOM) ou React (se solicitado).
- Foco: Animações suaves, paleta de cores harmoniosa, tipografia excelente e acessibilidade.

ESTRUTURA E REGRAS:
- Salve tudo na pasta \`frontend/\`.
- **REGRA DE OURO (SINGLE FILE):** NÃO crie arquivos .css ou .js separados. Todo o CSS (style) e JavaScript (script) deve estar EMBUTIDO dentro do arquivo .html.
- Ex: \`frontend/index.html\` (contém <style>...</style> e <script>...</script>).

DESIGN:
1. Use Tailwind CSS via CDN para estilização rápida.
2. Adicione CSS customizado extra na tag <style> para animações ou efeitos glassmorphism.
3. Adicione imagens de placeholder (via Unsplash/Picsum) para dar vida ao layout.
${COMMON_RULES}
`;

const BACKEND_INSTRUCTION = `
Você é o WebCria Backend Architect, um Engenheiro de Software Sênior e Especialista em Node.js e Arquitetura de Software.

SUA MISSÃO:
Criar a estrutura base de um Backend profissional robusto, replicando a arquitetura de microsserviços modulares.

STACK TECNOLÓGICA:
1. Runtime: Node.js
2. Framework: Express.js (para rotas e servidor HTTP)
3. Database: MySQL (usando a biblioteca \`mysql2\` com suporte a Promises)
4. Auth: JSON Web Token (JWT) + Bcrypt (para hash de senhas)
5. Environment: Dotenv (para variáveis de ambiente)

ESTRUTURA DE PASTAS (Obrigatório prefixo 'backend/'):
O projeto deve ser modular. Não coloque tudo no \`server.js\`.
1. \`backend/config/db.js\`: Pool de Conexão MySQL (Singleton).
2. \`backend/middlewares/authMiddleware.js\`: Proteção de rotas JWT.
3. \`backend/routes/\`: Rotas separadas por entidade (ex: \`userRoutes.js\`).
4. \`backend/controllers/\`: (Opcional) Lógica de negócios.
5. \`backend/server.js\`: Entry Point.
6. \`backend/.env.example\`: Variáveis de ambiente.

REGRAS DE CÓDIGO:
- Use \`try/catch\` em todas as rotas async.
- Valide dados de entrada.
- Configure CORS corretamente.
- NUNCA esqueça do \`backend/.env.example\`.

${COMMON_RULES}
`;

const FULLSTACK_INSTRUCTION = `
Você é o WebCria Fullstack Lead, um arquiteto capaz de transitar entre Frontend e Backend com maestria.

SUA MISSÃO:
Orquestrar a criação de sistemas completos.

ESTRUTURA OBRIGATÓRIA:
1. **Frontend**: \`frontend/index.html\`. **REGRA DE OURO:** Tudo embutido. CSS via <style> ou Tailwind, JS via <script>. NÃO crie arquivos CSS/JS separados para o front.
2. **Backend**: \`backend/server.js\`, \`backend/routes/...\`. (Node.js + Express).
3. **Config**: \`root/package.json\`.

REGRAS:
- Ao criar Backend, prefira Node.js com Express e separe em arquivos (modular).
- Ao criar Frontend, use ARQUIVO ÚNICO (.html com tudo dentro).
- Sempre crie \`backend/.env.example\`.
- Conecte o frontend ao backend via \`fetch\`.
- No modo Arquiteto, desenhe o plano JSON antes.

${COMMON_RULES}
`;

export const streamWebsiteCode = async (
  prompt: string, 
  chatHistory: ChatMessage[],
  currentFilename: string,
  existingFiles: FilesMap,
  onChunk: (chunk: string) => void,
  isBatchMode: boolean = false,
  persona: AiPersona = 'fullstack'
): Promise<string> => {
  try {
    const model = 'gemini-2.5-flash';
    
    const fileList = Object.keys(existingFiles).join(', ');
    
    // Optimization: Only last 8 messages
    const recentHistory = chatHistory.slice(-8).map(msg => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    const activeFileContent = existingFiles[currentFilename] 
      ? `Conteúdo ATUAL de "${currentFilename}":\n\`\`\`\n${existingFiles[currentFilename]}\n\`\`\``
      : '(Arquivo vazio ou novo)';

    // Select System Instruction based on Persona
    let selectedSystemInstruction = FULLSTACK_INSTRUCTION;
    if (persona === 'frontend') selectedSystemInstruction = FRONTEND_INSTRUCTION;
    if (persona === 'backend') selectedSystemInstruction = BACKEND_INSTRUCTION;

    // Dynamic Instruction based on Batch Mode
    const modeInstruction = isBatchMode
      ? `
      [MODO BATCH ATIVO - GERAÇÃO CONTÍNUA]
      1. O usuário quer velocidade. Gere múltiplos arquivos na mesma resposta se possível.
      2. Use a tag \`<!-- NEXT: pasta/arquivo.ext -->\` ao final para indicar qual arquivo deve ser criado a seguir pela automação.
      3. Se for Backend, gere server.js, depois db.js, depois rotas.
      `
      : `
      [MODO PASSO-A-PASSO]
      1. Foque no arquivo solicitado ou no arquivo aberto.
      2. Após gerar, pergunte proativamente qual o próximo passo.
      `;

    const contextPrompt = `
    [CONTEXTO TÉCNICO]
    Arquivos no Projeto: ${fileList || 'Nenhum'}.
    Arquivo Aberto: "${currentFilename}".
    ${activeFileContent}
    
    [SOLICITAÇÃO DO USUÁRIO]
    ${prompt}
    `;

    const fullSystemInstruction = selectedSystemInstruction + "\n" + modeInstruction;

    const contents = [
      ...recentHistory,
      { role: 'user', parts: [{ text: contextPrompt }] }
    ];

    const responseStream = await ai.models.generateContentStream({
      model: model,
      contents: contents as any,
      config: {
        systemInstruction: fullSystemInstruction,
        temperature: 0.5, 
      },
    });

    let fullText = '';
    
    for await (const chunk of responseStream) {
      const text = chunk.text;
      if (text) {
        fullText += text;
        onChunk(text);
      }
    }

    return fullText;

  } catch (error) {
    console.error("Erro na geração Gemini:", error);
    throw error;
  }
};

export const cleanCode = (raw: string): string => {
  let cleaned = raw.replace(/^```[a-z]*\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```$/, '');
  cleaned = cleaned.replace(/(?:<!--|\/\/|#)\s*FILENAME:.*?(?:-->)?\s*/i, '');
  return cleaned;
};

export const parseResponseFiles = (fullResponse: string): Record<string, string> => {
  const files: Record<string, string> = {};
  // Regex atualizado para aceitar caminhos com barra (frontend/index.html)
  // Aceita letras, numeros, ponto, traço, underline e BARRA (/)
  const regex = /(?:<!--|\/\/|#)\s*FILENAME:\s*([a-zA-Z0-9_./-]+)(?:-->)?\s*([\s\S]*?)(?=(?:<!--|\/\/|#)\s*FILENAME:|$)/gi;
  
  let match;
  while ((match = regex.exec(fullResponse)) !== null) {
    const filename = match[1].trim();
    let content = match[2].trim();

    // STRICT CLEANUP logic
    const codeBlockStart = content.indexOf('```');
    if (codeBlockStart !== -1) {
        content = content.substring(codeBlockStart);
    }
    
    if (content.startsWith('```')) {
        const endFenceIndex = content.indexOf('```', 3);
        if (endFenceIndex !== -1) {
            content = content.substring(0, endFenceIndex);
        }
    } else {
        const endFenceIndex = content.indexOf('```');
        if (endFenceIndex !== -1) {
            content = content.substring(0, endFenceIndex);
        } else if (filename.endsWith('.html') || filename.endsWith('.htm')) {
             const endHtml = content.lastIndexOf('</html>');
             if (endHtml !== -1) {
                 content = content.substring(0, endHtml + 7); 
             }
        }
    }

    content = cleanCode(content);

    if (filename && content) {
      files[filename] = content;
    }
  }

  if (Object.keys(files).length === 0) {
      return {}; 
  }

  return files;
};

export const extractJsonPlan = (text: string): any | null => {
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (e) {
      return null;
    }
  }
  return null;
};

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const applyPatches = (original: string, patch: string): string => {
  if (!patch.includes('<<<< SEARCH')) return patch;
  
  let result = original.replace(/\r\n/g, '\n');
  const normalizedPatch = patch.replace(/\r\n/g, '\n');

  const patchRegex = /<<<< SEARCH([\s\S]*?)====([\s\S]*?)>>>> REPLACE/g;
  
  let match;
  while ((match = patchRegex.exec(normalizedPatch)) !== null) {
    const searchBlock = match[1].trim();
    const replaceBlock = match[2].trim();
    
    if (result.includes(searchBlock)) {
      result = result.replace(searchBlock, replaceBlock);
      continue;
    }

    try {
      const escapedSearch = escapeRegExp(searchBlock);
      const flexiblePatternString = escapedSearch.replace(/\s+/g, '[\\s\\r\\n]+');
      const flexibleRegex = new RegExp(flexiblePatternString, '');
      
      if (flexibleRegex.test(result)) {
        result = result.replace(flexibleRegex, replaceBlock);
        continue;
      }
    } catch (e) {
      console.warn("Erro ao criar regex fuzzy:", e);
    }
    
    console.warn("Patch falhou para:", searchBlock);
  }
  
  return result;
}; 
