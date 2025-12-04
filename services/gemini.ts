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

3. **Modo Edição (Atualização)**:
   - **PREFERÊNCIA**: Se o arquivo tiver menos de 300 linhas, **REESCREVA O ARQUIVO INTEIRO**. É mais seguro e evita erros.
   - Use PATCH (Blocos SEARCH/REPLACE) **APENAS** se o arquivo for GIGANTE e a mudança for minúscula (ex: mudar 1 linha em 1000).
   - Formato PATCH:
     <!-- FILENAME: nome.ext -->
     <<<< SEARCH
     (copie aqui o bloco de código original EXATAMENTE como ele é, incluindo espaços)
     ====
     (escreva aqui o novo código que substituirá o bloco acima)
     >>>> REPLACE
   - **CRÍTICO**: O bloco SEARCH deve ser copiado IDÊNTICO ao original. Se você não tem certeza, REESCREVA O ARQUIVO INTEIRO.

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
      [MODO DE GERAÇÃO EM LOTE - MÁXIMA VELOCIDADE]
      1. O usuário quer o projeto COMPLETO e FUNCIONAL.
      2. Gere MÚLTIPLOS arquivos na mesma resposta, um após o outro. Não pause.
      3. Exemplo de saída contínua:
         <!-- FILENAME: index.html -->
         \`\`\`html ... \`\`\`
         <!-- FILENAME: style.css -->
         \`\`\`css ... \`\`\`
         <!-- FILENAME: script.js -->
         \`\`\`js ... \`\`\`
      4. Se a resposta for ficar longa demais (limite de tokens), pare o arquivo atual e use a tag:
         <!-- NEXT: nome_do_proximo_arquivo.ext -->
         Isso fará o sistema pedir a continuação automaticamente.
      5. Se terminar todos os arquivos, use: <!-- PROJECT_COMPLETED -->
      `
      : `
      [MODO PASSO-A-PASSO]
      - Gere APENAS UM arquivo por vez (o mais importante ou o solicitado).
      - Após terminar o arquivo, PARE e pergunte ao usuário se ele quer criar o próximo.
      - Se for uma EDIÇÃO, prefira reescrever o arquivo completo a menos que seja algo muito pontual.
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
  
  // Normalize line endings to LF to avoid issues with CRLF vs LF
  let result = original.replace(/\r\n/g, '\n');
  const normalizedPatch = patch.replace(/\r\n/g, '\n');

  // Regex: Finds SEARCH block and REPLACE block
  const patchRegex = /<<<< SEARCH([\s\S]*?)====([\s\S]*?)>>>> REPLACE/g;
  
  let match;
  while ((match = patchRegex.exec(normalizedPatch)) !== null) {
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
    // Note: We deliberately do not modify result if patch fails to avoid corruption.
  }
  
  return result;
};