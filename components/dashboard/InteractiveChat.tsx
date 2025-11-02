// Fix: Implementing the InteractiveChat component.
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedReport, SimulationResult, ChatMessage } from '../../types.ts';
import { UserAvatarIcon } from '../icons/UserAvatarIcon.tsx';
import { ChatChart } from './ChatChart.tsx';
import { GoogleGenAI, Chat, Part, GenerateContentResponse } from '@google/genai';
import { useErrorLog } from '../../hooks/useErrorLog.ts';
import { PaperclipIcon } from '../icons/PaperclipIcon.tsx';
import { XCircleIcon } from '../icons/XCircleIcon.tsx';
import { convertFilesToGeminiParts } from '../../services/geminiService.ts';
import { getApiKey } from '../../config.ts';
import { getLastReportSummary } from '../../services/contextMemory.ts';

const SendIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5" />
    </svg>
);

/**
 * Saves the last failed chat payload to localStorage for debugging purposes.
 * @param payload The payload that caused the error.
 */
const handleChatError = (payload: any) => {
    try {
        const payloadString = JSON.stringify(payload);
        localStorage.setItem('lastFailedChatPayload', payloadString);
        console.warn("DEBUG: The last failed chat payload has been saved to localStorage. You can inspect it by running `JSON.parse(localStorage.getItem('lastFailedChatPayload'))` in the console.");
    } catch (e) {
        console.error("Failed to save the chat error payload to localStorage:", e);
    }
};

export const InteractiveChat: React.FC<{
  report: GeneratedReport;
  simulationResult: SimulationResult | null;
}> = ({ report, simulationResult }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<Chat | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { logError } = useErrorLog();

  useEffect(() => {
    const apiKey = getApiKey();
    if (!apiKey) {
      logError({
        source: 'InteractiveChat',
        message: 'API Key não encontrada para inicializar o chat.',
        severity: 'critical'
      });
      setMessages([{ sender: 'ai', content: 'Erro: A chave da API não foi configurada.' }]);
      return;
    }
    const ai = new GoogleGenAI({ apiKey });
    
    // Load context from cognitive memory for robustness
    const reportSummaryFromMemory = getLastReportSummary();
    const executiveContext = reportSummaryFromMemory || report.executiveSummary;

    const context = `
      Relatório Executivo: ${JSON.stringify(executiveContext)}
      Simulação Tributária (se disponível): ${JSON.stringify(simulationResult)}
    `;

    const systemInstruction = `Você é a Nexus AI, uma IA especialista em análise fiscal e contábil brasileira na plataforma Nexus QuantumI2A2.
    Sua função é ajudar o usuário a entender os relatórios e simulações. Seja conciso e prestativo.
    Baseie-se ESTRITAMENTE no contexto fornecido e nos arquivos que eu anexar. Ao analisar arquivos, seja seletivo e foque nos dados mais importantes para responder à minha pergunta. Não descreva o arquivo inteiro. Extraia apenas a informação necessária.

    IMPORTANTE - GRÁFICOS: Se sua resposta contiver dados comparativos simples (ex: valores de impostos), formate-os em uma linha especial no final da resposta:
    CHART_DATA::{"type":"bar","title":"Título do Gráfico","data":{"Label 1":valor1,"Label 2":valor2}}
    Exemplo: CHART_DATA::{"type":"bar","title":"Impostos Pagos","data":{"ICMS":1234.56,"PIS":234.56,"COFINS":345.67}}`;
    
    chatRef.current = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction,
        temperature: 0.5,
      },
      history: [
          {
              role: 'user',
              parts: [{ text: `Aqui está o contexto para nossa conversa. ${context}`}]
          },
          {
              role: 'model',
              parts: [{ text: 'Entendido. Tenho o contexto do relatório e da simulação. Estou pronto para ajudar.'}]
          }
      ]
    });

    const introMessage: ChatMessage = {
      sender: 'ai',
      content: `Olá! Sou a Nexus AI. Analisei seu relatório e estou pronto para ajudar. O que você gostaria de saber ou analisar? Você pode anexar arquivos para uma análise mais profunda.`,
    };
    setMessages([introMessage]);
  }, [report, simulationResult, logError]);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      setAttachedFiles(prev => [...prev, ...Array.from(event.target.files!)]);
    }
    // Reset file input to allow selecting the same file again
    if(fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setAttachedFiles(prev => prev.filter(f => f.name !== fileName));
  };

  const sendMessageWithRetry = async (chat: Chat, originalParts: Part[]): Promise<GenerateContentResponse> => {
      const MAX_RETRIES = 3;
      let lastError: any = null;
      let currentParams = { message: [...originalParts] };

      console.log("DEBUG [Chat]: Preparing to send payload:", JSON.stringify({ parts_count: currentParams.message.length }, null, 2));

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
              return await chat.sendMessage(currentParams);
          } catch (error: any) {
              lastError = error;
              const errorMessage = error.toString().toLowerCase();
              const isRetriableError = errorMessage.includes('500') || errorMessage.includes('internal error') || errorMessage.includes('429');

              if (isRetriableError) {
                   if (attempt < MAX_RETRIES) {
                       const waitTime = (2 ** (attempt - 1)) * 2000; // 2s, 4s
                       logError({ source: 'InteractiveChat', message: `Falha no envio da mensagem. Tentando novamente em ${waitTime/1000}s...`, severity: 'warning' });
                       
                       // Reduce text part by 50%
                       currentParams.message = currentParams.message.map(part => 
                           part.text ? { text: part.text.substring(0, Math.ceil(part.text.length / 2)) } : part
                       );

                       await new Promise(res => setTimeout(res, waitTime));
                       continue;
                   } else {
                        handleChatError({ parts: originalParts });
                   }
              } else {
                throw error; // Rethrow non-retriable errors immediately
              }
          }
      }
      if (lastError && (lastError.toString().toLowerCase().includes('500') || lastError.toString().toLowerCase().includes('internal error') || lastError.toString().toLowerCase().includes('429'))) {
          throw new Error(`Falha no envio da mensagem. O payload original foi salvo no localStorage para depuração. Erro: ${lastError.message}`);
      }
      throw lastError;
  }

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || isTyping || !chatRef.current) return;

    const userMessageContent = attachedFiles.length > 0 
        ? `${input}\n\n[Analisando ${attachedFiles.length} arquivo(s): ${attachedFiles.map(f => f.name).join(', ')}]`
        : input;

    const userMessage: ChatMessage = { sender: 'user', content: userMessageContent };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);
    
    const startTime = Date.now();
    let originalParts: Part[] = [];
    try {
        originalParts.push({ text: input });
        if (attachedFiles.length > 0) {
            const fileParts = await convertFilesToGeminiParts(attachedFiles);
            originalParts.push(...fileParts);
        }
        
        const response = await sendMessageWithRetry(chatRef.current, originalParts);
        setAttachedFiles([]); // Clear files after successful send

        const latency = Date.now() - startTime;
        logError({
            source: 'InteractiveChat',
            message: `Chat response received in ${latency}ms.`,
            severity: 'info',
            details: { latency, promptLength: input.length, responseTextLength: response.text.length, files: attachedFiles.length }
        });
        
        let content = response.text;
        let chartData = null;

        if (content.includes('CHART_DATA::')) {
            const responseParts = content.split('CHART_DATA::');
            content = responseParts[0].trim();
            try {
                chartData = JSON.parse(responseParts[1]);
            } catch (e) {
                console.error("Failed to parse chart data:", e);
                logError({
                    source: 'InteractiveChat',
                    message: 'Falha ao parsear dados do gráfico da IA.',
                    severity: 'warning',
                    details: e
                });
            }
        }

        const aiResponse: ChatMessage = { sender: 'ai', content, chartData };
        setMessages(prev => [...prev, aiResponse]);

    } catch (error) {
        const latency = Date.now() - startTime;
        console.error("Chat error:", error);
        const errorMessageStr = error instanceof Error ? error.message : "Erro desconhecido no chat."
        logError({
            source: 'InteractiveChat',
            message: errorMessageStr,
            severity: 'critical',
            details: { error, latency }
        });
        const errorMessage: ChatMessage = { sender: 'ai', content: `Desculpe, ocorreu um erro ao processar sua pergunta. ${errorMessageStr}` };
        setMessages(prev => [...prev, errorMessage]);
    } finally {
        setIsTyping(false);
    }
  };

  return (
    <div className="bg-bg-secondary backdrop-blur-xl rounded-3xl border border-border-glass shadow-glass p-4 h-full flex flex-col max-h-[calc(100vh-200px)] animate-subtle-bob">
      <h3 className="text-lg font-bold text-content-emphasis mb-4 px-2">Chat Interativo com IA</h3>
      
      <div className="flex-1 overflow-y-auto pr-2 space-y-4">
        {messages.map((msg, index) => (
          <div key={index} className={`flex items-start gap-3 ${msg.sender === 'user' ? 'justify-end' : ''}`}>
             {msg.sender === 'ai' && <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-teal-400 flex-shrink-0"></div>}
             <div className={`max-w-md p-3 rounded-2xl ${msg.sender === 'ai' ? 'bg-bg-secondary-opaque/80' : 'bg-blue-600'}`}>
                <p className="text-sm text-content-emphasis whitespace-pre-wrap">{msg.content}</p>
                {msg.chartData && <ChatChart data={msg.chartData} />}
             </div>
             {msg.sender === 'user' && <UserAvatarIcon className="w-8 h-8 flex-shrink-0" />}
          </div>
        ))}
        {isTyping && (
             <div className={`flex items-start gap-3`}>
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-teal-400 flex-shrink-0"></div>
                <div className={`max-w-md p-3 rounded-2xl bg-bg-secondary-opaque/80`}>
                    <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 bg-content-default rounded-full animate-bounce" style={{animationDelay: '0s'}}></span>
                        <span className="w-2 h-2 bg-content-default rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></span>
                        <span className="w-2 h-2 bg-content-default rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></span>
                    </div>
                </div>
            </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      
      {/* Attached Files Display */}
      {attachedFiles.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border-glass flex flex-wrap gap-2">
            {attachedFiles.map(file => (
                <div key={file.name} className="flex items-center gap-2 bg-bg-secondary-opaque/80 rounded-full py-1 pl-3 pr-1 text-xs">
                    <span className="text-content-default">{file.name}</span>
                    <button onClick={() => handleRemoveFile(file.name)} className="text-content-default/50 hover:text-red-400">
                        <XCircleIcon className="w-4 h-4" />
                    </button>
                </div>
            ))}
        </div>
      )}

      <div className="mt-4 border-t border-border-glass pt-4">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Pergunte sobre o relatório ou anexe arquivos..."
            disabled={isTyping}
            className="w-full bg-bg-secondary-opaque/50 border border-border-glass rounded-xl py-2 pl-10 pr-12 text-sm text-content-default focus:ring-1 focus:ring-accent focus:outline-none disabled:opacity-50"
          />
          <input 
            type="file" 
            ref={fileInputRef} 
            multiple
            onChange={handleFileSelect} 
            className="hidden" 
            accept=".xml,.csv,.txt,.json,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,image/png,image/jpeg,image/webp"
          />
          <button onClick={() => fileInputRef.current?.click()} disabled={isTyping} className="absolute inset-y-0 left-0 flex items-center justify-center w-10 text-content-default hover:text-accent transition-colors disabled:cursor-not-allowed">
            <PaperclipIcon className="w-5 h-5" />
          </button>
          <button onClick={handleSend} disabled={isTyping} className="absolute inset-y-0 right-0 flex items-center justify-center w-10 text-content-default hover:text-accent transition-colors disabled:cursor-not-allowed">
            <SendIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
