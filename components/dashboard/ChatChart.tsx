// Fix: Implementing the ChatChart component for displaying charts in the interactive chat.
import React from 'react';
import { BarChart, Title, LineChart, DonutChart } from '@tremor/react';
import { ChartConfig } from '../../types';

interface ChatChartProps {
    data: ChartConfig;
}

const valueFormatter = (number: number) => {
    if (typeof number !== 'number') return String(number);
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(number);
}

export const ChatChart: React.FC<ChatChartProps> = ({ data: config }) => {
    if (!config || !config.data || !Array.isArray(config.data) || config.data.length === 0) {
        return (
             <div className="mt-4 bg-bg-secondary/50 p-3 rounded-xl border border-border-glass">
                <p className="text-sm text-content-default">Dados insuficientes para renderizar o gráfico.</p>
             </div>
        );
    }

    const renderChart = () => {
        switch (config.type) {
            case "bar":
                return <BarChart 
                            className="mt-2 h-48"
                            data={config.data} 
                            index={config.xField} 
                            categories={[config.yField]} 
                            colors={['cyan']}
                            valueFormatter={valueFormatter}
                            yAxisWidth={60}
                       />;
            case "line":
                return <LineChart 
                            className="mt-2 h-48"
                            data={config.data} 
                            index={config.xField} 
                            categories={[config.yField]} 
                            colors={['cyan']}
                            valueFormatter={valueFormatter}
                            yAxisWidth={60}
                       />;
            case "pie":
                return <DonutChart 
                            className="mt-2 h-48"
                            data={config.data} 
                            category={config.yField} 
                            index={config.xField}
                            colors={['cyan', 'blue', 'indigo', 'violet', 'fuchsia']}
                            valueFormatter={valueFormatter}
                       />;
            default:
                return <p className="text-sm text-amber-400">Tipo de gráfico '{config.type}' não suportado.</p>;
        }
    }

    return (
        <div className="mt-4 bg-bg-secondary/50 p-3 rounded-xl border border-border-glass">
            <Title className="text-content-default text-sm">{config.title}</Title>
            {renderChart()}
        </div>
    );
};