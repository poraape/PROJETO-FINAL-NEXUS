import React from 'react';
import { TaxScenario } from '../../types';
import { Card, Metric, Text, Badge } from '@tremor/react';

interface ScenarioCardProps {
  scenario: TaxScenario;
  isBest?: boolean;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

export const ScenarioCard: React.FC<ScenarioCardProps> = ({ scenario, isBest = false }) => {
  return (
    <Card className={`transition-all duration-300 ${isBest ? 'bg-accent/20 border-accent' : 'bg-bg-secondary/50 border-border-glass'} border`}>
      {isBest && (
        <div className="flex justify-end -mt-4 -mr-4">
           <Badge color="cyan" className="shadow-lg">Recomendado</Badge>
        </div>
      )}
      <Text className="text-content-default">{scenario.parametros.regime} - {scenario.parametros.uf}</Text>
      <Metric className="text-content-emphasis">{scenario.nome}</Metric>
      
      <div className="my-4">
        <Text className="text-content-default">Carga Tributária Total</Text>
        <Metric className="text-3xl text-accent-light">{formatCurrency(scenario.cargaTributariaTotal)}</Metric>
        <Text className="text-content-emphasis font-semibold">{scenario.aliquotaEfetiva} Alíquota Efetiva</Text>
      </div>

      <div className="space-y-1 text-sm mb-4">
        {Object.entries(scenario.impostos).map(([key, value]) => value && (
          <div key={key} className="flex justify-between border-b border-border-glass/50 py-1">
            <span className="text-content-default uppercase">{key}</span>
            <span className="font-mono text-content-emphasis">{formatCurrency(value as number)}</span>
          </div>
        ))}
      </div>
      
      <Text className="font-semibold text-content-emphasis mb-2">Recomendações</Text>
      <ul className="space-y-2">
        {scenario.recomendacoes.map((rec, index) => (
          <li key={index} className="flex items-start text-xs">
            <span className="text-accent mr-2 mt-0.5">◆</span>
            <p className="text-content-default">{rec}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
};