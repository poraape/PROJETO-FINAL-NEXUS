import React, { useState, useEffect, useRef } from 'react';
import { GeneratedReport, SimulationResult, ChatMessage } from '../../types.ts';
import { UserAvatarIcon } from '../icons/UserAvatarIcon.tsx';
import { ChatChart } from './ChatChart.tsx';
import { useErrorLog } from '../../hooks/useErrorLog.ts';
import { PaperclipIcon } from '../icons/PaperclipIcon.tsx';
import { XCircleIcon } from '../icons/XCircleIcon.tsx';
import { getChatResponse, generateChartConfigFromData } from '../../services/chatService.ts';

const SendIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5" />
    </svg>
);

export const InteractiveChat: React.FC<{
  report: GeneratedReport;
  simulationResult: SimulationResult | null;
  processedFiles: File[];
}> = ({ report, simulationResult, processedFiles }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { logError } = useErrorLog();

  useEffect(() => {
    const introMessage: ChatMessage = {
      sender: 'ai',
      content: `Olá! Sou a Nexus AI. O conteúdo dos seus arquivos foi indexado. Agora posso responder perguntas com base em todo o contexto. O que você gostaria de saber?`,
    };
    setMessages([introMessage]);
  }, [report]);
  
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
    if(fileInputRef.current) {
        fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setAttachedFiles(prev => prev.filter(f => f.name !== fileName));
  };

  const handleSend = async () => {
    if ((!input.trim() && attachedFiles.length === 0) || isTyping) return;

    const userMessageContent = attachedFiles.length > 0
        ? `${input}\n\n[Analisando ${attachedFiles.length} arquivo(s) em anexo...]`
        : input;

    const userMessage: ChatMessage = { sender: 'user', content: userMessageContent };
    setMessages(prev => [...prev, userMessage]);
    
    const currentInput = input;
    const currentFiles = [...attachedFiles];
    setInput('');
    setAttachedFiles([]);
    setIsTyping(true);

    try {
      const chartKeywords = ['gráfico', 'visualização', 'tendência', 'distribuição', 'mostre', 'exiba', 'compare', 'evolução'];
      const isChartRequest = chartKeywords.some(kw => currentInput.toLowerCase().includes(kw));

      if (isChartRequest) {
        setMessages(prev => [...prev, { sender: 'ai', content: 'Analisando dados para gerar uma visualização...' }]);
        const chartConfig = await generateChartConfigFromData(currentInput, report, logError);
        
        setMessages(prev => prev.slice(0, prev.length - 1));

        if (chartConfig) {
            const aiResponse: ChatMessage = { 
                sender: 'ai', 
                content: `Aqui está a visualização para "${chartConfig.title}".`,
                chartData: chartConfig 
            };
            setMessages(prev => [...prev, aiResponse]);
        } else {
            const fallbackMessage: ChatMessage = { 
                sender: 'ai', 
                content: 'Desculpe, não consegui gerar um gráfico com base na sua solicitação. Poderia tentar reformular a pergunta de forma mais específica sobre os dados?' 
            };
            setMessages(prev => [...prev, fallbackMessage]);
        }
      } else {
        const responseText = await getChatResponse(
            currentInput,
            processedFiles,
            currentFiles, // Newly attached files
            logError
        );
        
        const aiResponse: ChatMessage = { sender: 'ai', content: responseText };
        setMessages(prev => [...prev, aiResponse]);
      }

    } catch (error) {
        console.error("Chat error:", error);
        const errorMessageStr = error instanceof Error ? error.message : "Erro desconhecido no chat."
        logError({ source: 'InteractiveChat', message: errorMessageStr, severity: 'critical', details: { error } });
        const errorMessage: ChatMessage = { sender: 'ai', content: `Desculpe, ocorreu um erro ao processar sua pergunta. ${errorMessageStr}` };
        setMessages(prev => [...prev, errorMessage]);
    } finally {
        setIsTyping(false);
    }
  };

  return (
    <div id="chat-container" className="bg-bg-secondary backdrop-blur-xl rounded-3xl border border-border-glass shadow-glass p-4 h-full flex flex-col max-h-[calc(100vh-200px)] animate-subtle-bob">
      <h3 className="text-lg font-bold text-content-emphasis mb-4 px-2">Chat Interativo com IA</h3>
      
      <div id="chat-messages-container" className="flex-1 overflow-y-auto pr-2 space-y-4">
        {messages.map((msg, index) => (
          <div key={index} className={`chat-message ${msg.sender} flex items-start gap-3 ${msg.sender === 'user' ? 'justify-end' : ''}`}>
             {msg.sender === 'ai' && <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-teal-400 flex-shrink-0"></div>}
             <div className={`max-w-md p-3 rounded-2xl ${msg.sender === 'ai' ? 'bg-bg-secondary-opaque/80' : 'bg-blue-600'}`}>
                <p className={`text-sm whitespace-pre-wrap leading-relaxed ${msg.sender === 'ai' ? 'text-content-emphasis' : 'text-white'}`}>{msg.content}</p>
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
            placeholder="Pergunte sobre os arquivos..."
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