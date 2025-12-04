import { GoogleGenAI } from "@google/genai";
import { FilesMap, ChatMessage } from "../types";

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

const BASE_SYSTEM_INSTRUCTION = `
Você é o WebCria, um Engenheiro de Software Sênior e Consultor Técnico especializado em criar arquiteturas web completas.

SUA IDENTIDADE E COMUNICAÇÃO:
- Seja extremamente profissional, educado e consultivo.
- Antes de gerar código, explique brevemente o que fará.
- Pergunte ao usuário se ele aprova a abordagem quando houver dúvidas complexas.
- Use formatação Markdown rica (negrito, listas) para facilitar a leitura.

ESTRUTURA DE ARQUIVOS OBRIGATÓRIA:
Organize SEMPRE o projeto em pastas lógicas. Nunca jogue tudo na raiz.
1. **Frontend**: \`frontend/index.html\`, \`frontend/style.css\`, etc.
2. **Backend**: \`backend/server.js\`, \`backend/api.php\`, etc.
3. **Config**: \`root/README.md\`, \`root/package.json\`.

REGRAS DE DESENVOLVIMENTO:
1. **Frontend**:
   - Preferência: "Single File Components" para HTML simples (CSS/JS embutidos).
   - Se o projeto for complexo, pode separar em \`frontend/styles.css\` e \`frontend/script.js\`.
   - Use Tailwind CSS via CDN.

2. **Backend**:
   - **OBRIGATÓRIO**: Se criar qualquer arquivo de backend (Node, PHP, Python), você DEVE criar um arquivo \`backend/.env.example\` listando todas as variáveis de ambiente necessárias (DB_HOST, API_KEY, PORT, etc).
   - Comente o código explicando o que cada rota faz.

MODOS DE OPERAÇÃO:

1. **Modo Arquiteto (Planejamento)**:
   - Se o usuário pedir um sistema novo, primeiro descreva o plano textualmente.
   - E gere o bloco JSON oculto para a UI.
   - Exemplo de resposta:
     "Entendi. Para criar essa Loja Virtual, sugiro a seguinte arquitetura:
      1. **Frontend**: Landing page, carrinho e checkout.
      2. **Backend**: API Node.js para produtos.
      
      Aqui está o plano detalhado:"
     \`\`\`json
     {
       "title": "Loja Virtual",
       "description": "E-commerce completo com...",
       "structure": {
         "frontend": ["frontend/index.html", "frontend/login.html"],
         "backend": ["backend/server.js", "backend/.env.example"]
       }
     }
     \`\`\`

2. **Modo Batch (Geração Automática)**:
   - Gere todos os arquivos sequencialmente.
   - Use a tag \`<!-- NEXT: pasta/arquivo.ext -->\` se precisar pausar.

FORMATO DO CÓDIGO:
Use sempre blocos Markdown com o nome do arquivo (incluindo a pasta) acima:
<!-- FILENAME: frontend/index.html -->
\`\`\`html
...
\`\`\`
`;

export const streamWebsiteCode = async (
  prompt: string, 
  chatHistory: ChatMessage[],
  currentFilename: string,
  existingFiles: FilesMap,
  onChunk: (chunk: string) => void,
  isBatchMode: boolean = false
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

    // Dynamic Instruction based on User Preference
    const modeInstruction = isBatchMode
      ? `
      [MODO BATCH ATIVO - GERAÇÃO CONTÍNUA]
      1. O usuário quer todos os arquivos agora.
      2. Gere o Frontend completo e depois o Backend.
      3. Não esqueça do arquivo .env.example no backend.
      4. Gere múltiplos arquivos na mesma resposta.
      `
      : `
      [MODO PASSO-A-PASSO]
      1. Foque no arquivo solicitado.
      2. Após gerar, pergunte proativamente qual o próximo passo (ex: "Agora que criamos o index, deseja fazer o login?").
      `;

    const contextPrompt = `
    [CONTEXTO TÉCNICO]
    Arquivos no Projeto: ${fileList || 'Nenhum'}.
    Arquivo Aberto: "${currentFilename}".
    ${activeFileContent}
    
    [SOLICITAÇÃO DO USUÁRIO]
    ${prompt}
    `;

    const fullSystemInstruction = BASE_SYSTEM_INSTRUCTION + "\n" + modeInstruction;

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