import React, { createContext, useState, useCallback, ReactNode } from 'react';
import { LogError } from '../types.ts';

interface ErrorLogContextType {
  logs: LogError[];
  logError: (error: Omit<LogError, 'timestamp'>) => void;
}

export const ErrorLogContext = createContext<ErrorLogContextType | undefined>(undefined);

export const ErrorLogProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [logs, setLogs] = useState<LogError[]>([]);

  const logError = useCallback((error: Omit<LogError, 'timestamp'>) => {
    const newLog: LogError = {
      ...error,
      timestamp: new Date().toISOString(),
    };
    console.log("Logging new error:", newLog);
    setLogs(prevLogs => [newLog, ...prevLogs]);
  }, []);

  return (
    <ErrorLogContext.Provider value={{ logs, logError }}>
      {children}
    </ErrorLogContext.Provider>
  );
};
