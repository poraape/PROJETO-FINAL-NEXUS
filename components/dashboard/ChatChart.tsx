// Fix: Implementing the ChatChart component for displaying charts in the interactive chat.
import React from 'react';
import { BarChart, Title } from '@tremor/react';

interface ChatChartProps {
    data: {
        type: 'bar';
        data: { [key: string]: number };
        title: string;
    }
}

const valueFormatter = (number: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(number);

export const ChatChart: React.FC<ChatChartProps> = ({ data }) => {
    if (data.type !== 'bar' || !data.data) {
        return null;
    }

    const chartData = Object.entries(data.data).map(([name, value]) => ({ name, 'Valor': value }));

    return (
        <div className="mt-4 bg-bg-secondary/50 p-3 rounded-xl border border-border-glass">
            <Title className="text-content-default text-sm">{data.title}</Title>
            <BarChart
                className="mt-2 h-32"
                data={chartData}
                index="name"
                categories={['Valor']}
                colors={['cyan']}
                valueFormatter={valueFormatter}
                yAxisWidth={60}
                showLegend={false}
            />
        </div>
    );
};