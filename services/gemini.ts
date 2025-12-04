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
Você é o WebCria, um Arquiteto de Software Sênior e Desenvolvedor Full Stack.

MODOS DE OPERAÇÃO:
1. **Arquiteto (Planejamento)**: Se o usuário pedir um sistema complexo:
   - Retorne APENAS um bloco JSON estrito com o plano seguindo EXATAMENTE este formato:
     \`\`\`json
     {
       "title": "Nome do Projeto",
       "description": "Descrição breve",
       "structure": {
         "frontend": ["index.html"],
         "backend": ["server.js", "api.php"]
       }
     \`\`\`
   - **REGRA DE OURO**: Planeje o Frontend para ser "Single File". O HTML deve conter o CSS (<style>) e JS (<script>) embutidos. NÃO sugira arquivos style.css ou script.js separados para frontend, exceto se for uma biblioteca externa massiva.

2. **Desenvolvedor (Execução Focada)**:
   - **ESTILO DE CÓDIGO**: Para Frontend, **SEMPRE** embuta CSS (<style>) e JS (<script>) dentro do arquivo HTML.
   - **FORMATO OBRIGATÓRIO**:
     O código DEVE estar dentro de blocos Markdown (\`\`\`).
     A tag FILENAME deve estar imediatamente antes ou dentro do bloco.
     
     Exemplo Correto:
     <!-- FILENAME: index.html -->
     \`\`\`html
     <!DOCTYPE html>
     ...
     \`\`\`
     
   - **PROIBIDO**: NUNCA escreva texto conversacional (ex: "Aqui está o código", "Espero que goste") DENTRO do bloco do arquivo ou colado nele. Texto conversacional deve vir APÓS o fechamento do bloco de código.

3. **Modo Edição (Patch Inteligente)**:
   - Ao editar arquivos existentes, se a mudança for pequena (menos de 50% do arquivo), USE PATCH.
   - Use o formato de PATCH para substituir blocos de código:
     <!-- FILENAME: nome.ext -->
     <<<< SEARCH
     (copie aqui o bloco de código original EXATAMENTE como ele é, caractere por caractere)
     ====
     (escreva aqui o novo código que substituirá o bloco acima)
     >>>> REPLACE
   - **IMPORTANTE**: O bloco SEARCH deve ser único no arquivo para que eu saiba onde substituir.
   - Se você for reescrever o arquivo quase todo, NÃO use patch, envie o arquivo completo.

REGRAS TÉCNICAS:
- Idioma: PORTUGUÊS (PT-BR).
- Frontend: Use Tailwind CSS via CDN.
- Backend: Suporte a Node.js, Python e PHP.
- Imagens: 'https://picsum.photos/seed/{random}/width/height'.
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
    
    // Optimization: Only last 8 messages to save tokens and reduce confusion
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
      [MODO DE GERAÇÃO EM LOTE - FLUXO CONTÍNUO]
      1. O usuário quer o projeto completo.
      2. Gere APENAS UM arquivo de cada vez (o mais prioritário ou o próximo da lista).
      3. Ao final da sua resposta, SE houver mais arquivos necessários para o sistema funcionar (css, js, outras páginas), adicione EXATAMENTE esta tag na última linha:
         <!-- NEXT: nome_do_proximo_arquivo.ext -->
      4. Se o projeto estiver 100% pronto e não precisar de mais arquivos, adicione:
         <!-- PROJECT_COMPLETED -->
      `
      : `
      [MODO PASSO-A-PASSO]
      - Gere APENAS UM arquivo por vez (o mais importante ou o solicitado).
      - Após terminar o arquivo, PARE e pergunte ao usuário se ele quer criar o próximo.
      `;

    const contextPrompt = `
    [ESTADO DO PROJETO]
    Arquivos Existentes: ${fileList || 'Nenhum'}.
    Arquivo Focado/Ativo: "${currentFilename}".
    ${activeFileContent}
    
    [INSTRUÇÃO ESPECÍFICA]
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
  // Regex captures: 1=filename, 2=everything after
  const regex = /(?:<!--|\/\/|#)\s*FILENAME:\s*([a-zA-Z0-9_.-]+)(?:-->)?\s*([\s\S]*?)(?=(?:<!--|\/\/|#)\s*FILENAME:|$)/gi;
  
  let match;
  while ((match = regex.exec(fullResponse)) !== null) {
    const filename = match[1].trim();
    let content = match[2].trim();

    // STRICT CLEANUP: Prevent conversational text from leaking into the file content
    
    // Strategy 1: Discard text preceding code block
    const codeBlockStart = content.indexOf('```');
    if (codeBlockStart !== -1) {
        // Discard text before the code block
        content = content.substring(codeBlockStart);
    }
    
    // Strategy 2: Look for Markdown fences for ending
    if (content.startsWith('```')) {
        // Find closing fence, skip the opening ones
        const endFenceIndex = content.indexOf('```', 3);
        if (endFenceIndex !== -1) {
            content = content.substring(0, endFenceIndex);
        }
    } else {
        // Strategy 3: If no start fence (should imply previous strategy handled it or AI didn't use markdown)
        // look for end fence (maybe filename was inside block)
        const endFenceIndex = content.indexOf('```');
        if (endFenceIndex !== -1) {
            content = content.substring(0, endFenceIndex);
        } else if (filename.endsWith('.html') || filename.endsWith('.htm')) {
             // Strategy 4: Fallback for HTML without markdown - Look for end of HTML
             const endHtml = content.lastIndexOf('</html>');
             if (endHtml !== -1) {
                 content = content.substring(0, endHtml + 7); // +7 to include </html>
             }
        }
    }

    content = cleanCode(content);

    if (filename && content) {
      files[filename] = content;
    }
  }

  // Fallback: If no filename tag found, but content looks like code and has no text
  if (Object.keys(files).length === 0) {
      // Return empty if we are unsure, let chat handle it
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

// Helper to escape regex special characters
function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const applyPatches = (original: string, patch: string): string => {
  // If not a patch format, return the patch content as is (assuming it's a full rewrite)
  if (!patch.includes('<<<< SEARCH')) return patch;
  
  let result = original;
  // Regex: Finds SEARCH block and REPLACE block
  const patchRegex = /<<<< SEARCH([\s\S]*?)====([\s\S]*?)>>>> REPLACE/g;
  
  let match;
  while ((match = patchRegex.exec(patch)) !== null) {
    const searchBlock = match[1].trim();
    const replaceBlock = match[2].trim();
    
    // STRATEGY 1: Exact Match
    if (result.includes(searchBlock)) {
      result = result.replace(searchBlock, replaceBlock);
      continue;
    }

    // STRATEGY 2: Robust Fuzzy Match
    try {
      const escapedSearch = escapeRegExp(searchBlock);
      // Allow any amount of whitespace (newlines/spaces) between words/symbols
      const flexiblePatternString = escapedSearch.replace(/\s+/g, '[\\s\\r\\n]+');
      const flexibleRegex = new RegExp(flexiblePatternString, '');
      
      if (flexibleRegex.test(result)) {
        result = result.replace(flexibleRegex, replaceBlock);
        continue;
      }
    } catch (e) {
      console.warn("Erro ao criar regex fuzzy:", e);
    }
    
    console.warn("Patch falhou: Bloco não encontrado via Exact ou Fuzzy match.", "\nProcurado:", searchBlock);
  }
  
  return result;
};