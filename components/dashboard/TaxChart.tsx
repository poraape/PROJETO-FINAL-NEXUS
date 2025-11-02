import React from 'react';
import { Card, Title, BarList, Text } from '@tremor/react';
import { KeyMetrics } from '../../types';

interface TaxChartProps {
    metrics: KeyMetrics;
}

const valueFormatter = (number: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact' }).format(number);

export const TaxChart: React.FC<TaxChartProps> = ({ metrics }) => {
    const taxes = [
        { name: 'ICMS', value: metrics.valorTotalDeICMS, color: 'blue' },
        { name: 'PIS', value: metrics.valorTotalDePIS, color: 'teal' },
        { name: 'COFINS', value: metrics.valorTotalDeCOFINS, color: 'indigo' },
        { name: 'ISS', value: metrics.valorTotalDeISS, color: 'purple' },
    ].filter(tax => tax.value > 0);

    const totalTaxes = taxes.reduce((acc, tax) => acc + tax.value, 0);

    return (
        <Card className="bg-bg-secondary/50 border border-border-glass ring-0 h-full">
            <Title className="text-content-emphasis">Composição de Impostos</Title>
            {totalTaxes > 0 ? (
                <BarList data={taxes} className="mt-4" valueFormatter={valueFormatter} />
            ) : (
                <div className="flex h-full items-center justify-center">
                    <Text className="text-content-default/70 mt-4">Nenhum imposto identificado.</Text>
                </div>
            )}
        </Card>
    );
};