import React from 'react';
import { Card, Title, BarList, Text } from '@tremor/react';
import { JobAnalyticsCategoryEntry } from '../../types.ts';

interface Props {
  entries?: JobAnalyticsCategoryEntry[];
}

export const CfopBreakdownChart: React.FC<Props> = ({ entries }) => {
  if (!entries || entries.length === 0) {
    return (
      <Card className="bg-bg-secondary/50 border border-border-glass ring-0 h-full">
        <Title className="text-content-emphasis">Distribuição por CFOP</Title>
        <div className="flex h-full items-center justify-center">
          <Text className="text-content-default/70 mt-4">Aguardando classificação fiscal.</Text>
        </div>
      </Card>
    );
  }

  const barData = entries.map(entry => ({ name: entry.label, value: entry.value }));
  const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' });

  return (
    <Card className="bg-bg-secondary/50 border border-border-glass ring-0 h-full">
      <Title className="text-content-emphasis">Top CFOP por Valor</Title>
      <BarList data={barData} className="mt-4" valueFormatter={(value) => currency.format(value)} />
    </Card>
  );
};
