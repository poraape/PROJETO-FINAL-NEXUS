import React from 'react';
import { Card, Title, Text, List, ListItem } from '@tremor/react';
import { CsvInsight } from '../../types';
import { TableIcon } from '../icons/TableIcon';

interface CsvAnalysisInsightsProps {
  insights: CsvInsight[];
}

export const CsvAnalysisInsights: React.FC<CsvAnalysisInsightsProps> = ({ insights }) => {
  return (
    <Card className="mt-6 bg-bg-secondary/50 border border-border-glass ring-0">
        <div className="flex items-center mb-4">
             <div className="bg-teal-500/20 p-3 rounded-xl mr-4">
                <TableIcon className="w-6 h-6 text-teal-300" />
            </div>
            <div>
                <Title className="text-content-emphasis">Insights dos Arquivos CSV</Title>
                <Text className="text-content-default">Resumos gerados a partir dos dados tabulares fornecidos.</Text>
            </div>
        </div>
      <List>
        {insights.map((item, index) => (
          <ListItem key={index} className="space-x-4">
            <div className="flex-1 space-y-1">
              <div className="flex items-center justify-between">
                <Text className="font-semibold text-content-emphasis">{item.fileName}</Text>
                <Text className="text-content-default/70">{item.rowCount} linhas analisadas</Text>
              </div>
              <Text className="text-content-default">{item.insight}</Text>
            </div>
          </ListItem>
        ))}
      </List>
    </Card>
  );
};