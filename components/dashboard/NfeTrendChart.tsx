import React from 'react';
import { AreaChart, Card, Title } from '@tremor/react';

interface NfeTrendChartProps {
  value: number;
}

const valueFormatter = (number: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(number);


export const NfeTrendChart: React.FC<NfeTrendChartProps> = ({ value }) => {
  const labels = ['Mês-5', 'Mês-4', 'Mês-3', 'Mês-2', 'Mês-1', 'Atual'];
  
  // Simulate historical data based on the current value
  const randomFactor = () => 0.8 + Math.random() * 0.4; // between 0.8 and 1.2
  const chartData = [
    { Mês: labels[0], 'Valor NF-e': value * 0.7 * randomFactor() },
    { Mês: labels[1], 'Valor NF-e': value * 0.8 * randomFactor() },
    { Mês: labels[2], 'Valor NF-e': value * 0.6 * randomFactor() },
    { Mês: labels[3], 'Valor NF-e': value * 0.9 * randomFactor() },
    { Mês: labels[4], 'Valor NF-e': value * 0.85 * randomFactor() },
    { Mês: labels[5], 'Valor NF-e': value },
  ];

  return (
    <Card className="bg-bg-secondary/50 border border-border-glass ring-0 h-full">
      <Title className="text-content-emphasis">Tendência do Valor Total das NFes</Title>
      <AreaChart
        className="mt-4 h-48"
        data={chartData}
        index="Mês"
        categories={['Valor NF-e']}
        colors={['cyan']}
        valueFormatter={valueFormatter}
        yAxisWidth={70}
        showLegend={false}
      />
    </Card>
  );
};