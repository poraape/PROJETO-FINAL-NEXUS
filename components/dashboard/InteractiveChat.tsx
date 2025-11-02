// Fix: Implementing the InteractiveChat component.
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedReport, SimulationResult, ChatMessage } from '../../types.ts';
import { UserAvatarIcon } from '../icons/UserAvatarIcon.tsx';
import { ChatChart } from './ChatChart.tsx';
import { GoogleGenAI, Chat } from '@google/genai';
import { useErrorLog } from '../../hooks/useErrorLog.ts';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

const SendIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.126A59.768 59.768 0 0 1 21.485 12 59.77 59.77 0 0 1 3.27 20.876L5.999 12Zm0 0h7.5" />
    </svg>
);

export const InteractiveChat: React.FC<{
  report: GeneratedReport;
  simulationResult: SimulationResult | null;
}> = ({ report, simulationResult }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<Chat | null>(null);
  const { logError } = useErrorLog();

  useEffect(() => {
    const context = `
      Relatório Executivo: ${JSON.stringify(report.executiveSummary)}
      Simulação Tributária (se disponível): ${JSON.stringify(simulationResult)}
    `;

    const systemInstruction = `Você é um assistente de IA especialista em análise fiscal e contábil brasileira, integrado à plataforma Nexus QuantumI2A2. Seu nome é Nexus AI.
    Seu objetivo é ajudar o usuário a entender o relatório fiscal e as simulações tributárias.
    Seja conciso, claro e prestativo. Use os dados do contexto para basear suas respostas.
    
    IMPORTANTE: Se sua resposta contiver dados que podem ser visualizados em um gráfico de barras simples (ex: comparação de valores), você DEVE formatar esses dados em uma linha especial no final da sua resposta, começando com "CHART_DATA::".
    Exemplo de formato:
    CHART_DATA::{"type":"bar","title":"Impostos Pagos","data":{"ICMS":${report.executiveSummary.keyMetrics.valorTotalDeICMS},"PIS":${report.executiveSummary.keyMetrics.valorTotalDePIS},"COFINS":${report.executiveSummary.keyMetrics.valorTotalDeCOFINS}}}
    
    Não invente dados. Baseie-se estritamente no contexto fornecido.`;
    
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
      content: `Olá! Sou a Nexus AI. Analisei seu relatório e estou pronto para ajudar. O que você gostaria de saber?`,
    };
    setMessages([introMessage]);
  }, [report, simulationResult]);
  
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim() || isTyping || !chatRef.current) return;

    const userMessage: ChatMessage = { sender: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);
    
    try {
        const response = await chatRef.current.sendMessage({ message: input });
        let content = response.text;
        let chartData = null;

        if (content.includes('CHART_DATA::')) {
            const parts = content.split('CHART_DATA::');
            content = parts[0].trim();
            try {
                chartData = JSON.parse(parts[1]);
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
        console.error("Chat error:", error);
        const errorMessageStr = error instanceof Error ? error.message : "Erro desconhecido no chat."
        logError({
            source: 'InteractiveChat',
            message: errorMessageStr,
            severity: 'critical',
            details: error
        });
        const errorMessage: ChatMessage = { sender: 'ai', content: `Desculpe, ocorreu um erro ao processar sua pergunta. O erro foi registrado para análise.` };
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

      <div className="mt-4 border-t border-border-glass pt-4">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Pergunte sobre o relatório..."
            disabled={isTyping}
            className="w-full bg-bg-secondary-opaque/50 border border-border-glass rounded-xl py-2 pl-4 pr-12 text-sm text-content-default focus:ring-1 focus:ring-accent focus:outline-none disabled:opacity-50"
          />
          <button onClick={handleSend} disabled={isTyping} className="absolute inset-y-0 right-0 flex items-center justify-center w-10 text-content-default hover:text-accent transition-colors disabled:cursor-not-allowed">
            <SendIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
