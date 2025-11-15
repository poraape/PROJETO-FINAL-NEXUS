import React from 'react';
import { AreaChart, Card, Title, Text } from '@tremor/react';
import { JobAnalyticsTimeSeriesPoint } from '../../types.ts';

interface NfeTrendChartProps {
  series?: JobAnalyticsTimeSeriesPoint[];
  fallbackValue?: number;
}

const valueFormatter = (number: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(number);

export const NfeTrendChart: React.FC<NfeTrendChartProps> = ({ series, fallbackValue = 0 }) => {
  const chartData = (series && series.length > 0)
    ? series.map(point => ({ Período: point.period, 'Valor NF-e': point.totalValue }))
    : [{ Período: 'Atual', 'Valor NF-e': fallbackValue }];

  return (
    <Card className="bg-bg-secondary/50 border border-border-glass ring-0 h-full">
      <Title className="text-content-emphasis">Tendência do Valor Total das NFes</Title>
      {chartData.length === 1 && !series?.length ? (
        <div className="flex h-full items-center justify-center">
          <Text className="text-content-default/70 mt-4">Aguardando consolidação temporal.</Text>
        </div>
      ) : (
        <AreaChart
          className="mt-4 h-48"
          data={chartData}
          index="Período"
          categories={['Valor NF-e']}
          colors={['cyan']}
          valueFormatter={valueFormatter}
          yAxisWidth={70}
          showLegend={false}
        />
      )}
    </Card>
  );
};