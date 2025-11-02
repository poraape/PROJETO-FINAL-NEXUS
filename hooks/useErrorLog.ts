import { useContext } from 'react';
import { ErrorLogContext } from '../contexts/ErrorLogContext.tsx';

export const useErrorLog = () => {
  const context = useContext(ErrorLogContext);
  if (context === undefined) {
    throw new Error('useErrorLog must be used within an ErrorLogProvider');
  }
  return context;
};
