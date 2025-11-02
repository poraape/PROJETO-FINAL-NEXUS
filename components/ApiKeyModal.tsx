import React, { useState } from 'react';
import { Dialog, DialogPanel, Title, TextInput, Button } from '@tremor/react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onSave: (key: string) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onSave }) => {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  const handleSave = () => {
    if (!key.trim()) {
      setError('A chave da API não pode estar em branco.');
      return;
    }
    setError('');
    onSave(key.trim());
  };

  return (
    <Dialog open={isOpen} onClose={() => {}} static={true}>
      <DialogPanel className="bg-bg-secondary-opaque border border-border-glass rounded-2xl shadow-glass text-center p-6">
        <Title className="text-content-emphasis text-xl mb-2">Configure sua Chave da API Gemini</Title>
        <p className="text-content-default text-sm mb-4">
          Para utilizar a aplicação, por favor, insira sua chave da API do Google Gemini.
          Sua chave será salva localmente no seu navegador.
        </p>
        <TextInput
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Cole sua chave da API aqui"
          type="password"
          error={!!error}
          errorMessage={error}
          className="mb-4"
        />
        <Button onClick={handleSave} className="w-full bg-blue-600 hover:bg-blue-700 border-none">
          Salvar e Continuar
        </Button>
        <p className="text-xs text-content-default/70 mt-4">
          Não tem uma chave? Obtenha uma no{' '}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Google AI Studio
          </a>.
        </p>
      </DialogPanel>
    </Dialog>
  );
};
