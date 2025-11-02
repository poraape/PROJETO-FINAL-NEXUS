import React, { useState } from 'react';
import { GeneratedReport, SimulationParams, SimulationResult, TaxRegime, LogError } from '../../types.ts';
import { simulateTaxScenario } from '../../services/geminiService.ts';
import { CalculatorIcon } from '../icons/CalculatorIcon.tsx';
import { FileExportIcon } from '../icons/FileExportIcon.tsx';
import { ScenarioCard } from './ScenarioCard.tsx';
import { BarChart, Card, Subtitle, Title } from '@tremor/react';
import { getCachedSimulation, storeSimulationResult } from '../../services/contextMemory.ts';
import { calculateAllScenarios } from '../../services/taxCalculator.ts';

interface TaxSimulatorProps {
  report: GeneratedReport;
  onSimulationComplete: (result: SimulationResult) => void;
  logError: (error: Omit<LogError, 'timestamp'>) => void;
}

const ufs = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
const taxRegimes = Object.values(TaxRegime);
const opTypes = ["Venda de Mercadoria", "Prestação de Serviço", "Venda Mista"];

const valueFormatter = (number: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(number);

export const TaxSimulator: React.FC<TaxSimulatorProps> = ({ report, onSimulationComplete, logError }) => {
  const [params, setParams] = useState<Omit<SimulationParams, 'valorBase'>>({
    regimeTributario: TaxRegime.LUCRO_PRESUMIDO,
    uf: 'SP',
    cnae: '47.81-4-00', // Exemplo
    tipoOperacao: opTypes[0],
  });
  const [valorBase, setValorBase] = useState<string>(report?.executiveSummary?.keyMetrics?.valorTotalDasNfes?.toString() || '100000');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimulationResult | null>(null);

  const handleSimulate = async () => {
    if (isLoading) return;
    
    const fullParams: SimulationParams = {
      ...params,
      valorBase: parseFloat(valorBase) || 0,
    };

    // Check cognitive memory first
    const cachedResult = getCachedSimulation(fullParams);
    if (cachedResult) {
        setResult(cachedResult);
        onSimulationComplete(cachedResult);
        logError({ source: 'TaxSimulator', message: 'Resultado da simulação carregado do cache.', severity: 'info' });
        return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    
    try {
      // Step 1: Perform local calculations
      logError({ source: 'TaxSimulator', message: 'Realizando cálculos fiscais locais...', severity: 'info' });
      const calculatedScenarios = calculateAllScenarios(fullParams, report.executiveSummary.keyMetrics);
      
      // Step 2: Send calculated data to AI for textual analysis
      logError({ source: 'TaxSimulator', message: 'Enviando cálculos para a IA para análise textual.', severity: 'info' });
      const simulationResult = await simulateTaxScenario(calculatedScenarios, logError);
      
      setResult(simulationResult);
      onSimulationComplete(simulationResult);
      // Step 3: Store the final combined result in cognitive memory
      storeSimulationResult(fullParams, simulationResult);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Ocorreu um erro desconhecido.';
      setError(errorMessage);
      logError({
        source: 'TaxSimulator',
        message: errorMessage,
        severity: 'critical',
        details: err
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const bestScenario = result?.cenarios.find(s => s.nome === result.recomendacaoPrincipal);
  
  const chartData = result?.cenarios.map(s => ({
    name: s.nome,
    'Carga Tributária': s.cargaTributariaTotal,
    color: s.nome === result.recomendacaoPrincipal ? 'cyan' : 'gray',
  })) || [];
  
  const formInputStyle = "bg-bg-secondary-opaque/50 border border-border-glass rounded-lg py-1.5 px-2 text-sm focus:ring-1 focus:ring-accent focus:outline-none w-full";

  return (
    <div className="bg-bg-secondary backdrop-blur-xl rounded-3xl border border-border-glass shadow-glass p-6 h-full flex flex-col animate-subtle-bob">
      <div className="flex items-center mb-6">
        <div className="bg-green-500/20 p-3 rounded-xl mr-4">
          <CalculatorIcon className="w-6 h-6 text-green-300" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-content-emphasis">Simulador Tributário Inteligente</h2>
          <p className="text-content-default">Projete e compare cenários fiscais para otimizar sua carga tributária.</p>
        </div>
      </div>

      {/* --- Inputs --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
          {/* Valor Base */}
          <div className="flex flex-col">
              <label className="text-xs text-content-default mb-1">Valor Base (R$)</label>
              <input type="number" value={valorBase} onChange={e => setValorBase(e.target.value)} className={formInputStyle}/>
          </div>
          {/* Regime */}
          <div className="flex flex-col">
              <label className="text-xs text-content-default mb-1">Regime Tributário</label>
              <select value={params.regimeTributario} onChange={e => setParams(p => ({...p, regimeTributario: e.target.value as TaxRegime}))} className={formInputStyle}>
                  {taxRegimes.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
          </div>
          {/* UF */}
          <div className="flex flex-col">
              <label className="text-xs text-content-default mb-1">UF</label>
              <select value={params.uf} onChange={e => setParams(p => ({...p, uf: e.target.value}))} className={formInputStyle}>
                  {ufs.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
          </div>
          {/* CNAE */}
          <div className="flex flex-col">
              <label className="text-xs text-content-default mb-1">CNAE Principal</label>
              <input type="text" value={params.cnae} onChange={e => setParams(p => ({...p, cnae: e.target.value}))} className={formInputStyle}/>
          </div>
          {/* Botão */}
          <div className="flex items-end">
              <button onClick={handleSimulate} disabled={isLoading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-4 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center h-[34px]">
                  {isLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : 'Simular'}
              </button>
          </div>
      </div>
      
      {/* --- Results --- */}
      <div className="flex-1 overflow-y-auto mt-4 pr-2">
        {error && <p className="text-red-400 text-center">{error}</p>}
        {!isLoading && !result && (
          <div className="text-center text-content-default/70 py-16">
            <p>Preencha os parâmetros e clique em "Simular" para iniciar a análise.</p>
          </div>
        )}
        {result && (
          <div className="space-y-6">
            {/* Summary & Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
               <Card className="bg-bg-secondary/50 border border-border-glass ring-0">
                  <Title className="text-content-emphasis">Resumo da Simulação</Title>
                  <p className="text-sm text-content-default mt-2">{result.resumoExecutivo}</p>
                  <div className="mt-4 pt-4 border-t border-border-glass/50">
                    <Subtitle className="text-content-emphasis">Recomendação Principal</Subtitle>
                    {bestScenario && <p className="text-sm text-accent-light mt-1">O cenário <span className="font-bold">{bestScenario.nome}</span> apresenta a menor carga tributária.</p>}
                  </div>
              </Card>
              <Card className="bg-bg-secondary/50 border border-border-glass ring-0">
                <Title className="text-content-emphasis">Comparativo de Carga Tributária</Title>
                <BarChart
                    className="mt-4 h-48"
                    data={chartData}
                    index="name"
                    categories={['Carga Tributária']}
                    colors={['cyan']}
                    valueFormatter={valueFormatter}
                    yAxisWidth={80}
                    showLegend={false}
                    layout="vertical"
                 />
              </Card>
            </div>

            {/* Scenario Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {result.cenarios.map(sc => (
                    <ScenarioCard key={sc.nome} scenario={sc} isBest={sc.nome === result.recomendacaoPrincipal}/>
                ))}
            </div>

            {/* Export */}
            <div className="flex justify-end gap-3 mt-4">
              <button className="flex items-center gap-2 text-sm bg-bg-secondary-opaque/50 hover:bg-white/10 border border-border-glass text-content-default font-semibold py-2 px-3 rounded-lg transition-colors"><FileExportIcon className="w-4 h-4" /> Exportar CSV</button>
              <button className="flex items-center gap-2 text-sm bg-bg-secondary-opaque/50 hover:bg-white/10 border border-border-glass text-content-default font-semibold py-2 px-3 rounded-lg transition-colors"><FileExportIcon className="w-4 h-4" /> Exportar PDF</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};