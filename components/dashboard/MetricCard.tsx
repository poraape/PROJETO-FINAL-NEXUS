import React from 'react';
import { Card, Metric, Text } from '@tremor/react';

interface MetricCardProps {
  title: string;
  value: string;
  description?: string;
  isAlert?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({ title, value, description, isAlert }) => {
  return (
    <Card
      className="bg-bg-secondary/50 border border-border-glass ring-0"
      decoration="top"
      decorationColor={isAlert ? 'rose' : undefined}
    >
      <Text className="text-content-default">{title}</Text>
      <Metric className={`mt-1 ${isAlert ? 'text-red-400' : 'text-content-emphasis'}`}>{value}</Metric>
      {description && <Text className="text-xs text-content-default/70 mt-2">{description}</Text>}
    </Card>
  );
};