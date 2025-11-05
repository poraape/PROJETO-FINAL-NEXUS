WORKDIR /usr/src/app

# Copia os arquivos de manifesto do pacote e instala as dependências
COPY package.json ./
# Usamos `npm install` em vez de `npm ci` porque não teremos um `package-lock.json` no início.
RUN npm install --only=production

# Copia o código da aplicação
COPY . .

# Estágio 2: Produção (Otimização)
# Se quiséssemos uma imagem menor, poderíamos ter um segundo estágio aqui,
# mas para simplicidade, vamos manter um único estágio por enquanto.

# Expõe a porta que a aplicação usa
EXPOSE 3001

# Comando para iniciar a aplicação
CMD [ "node", "server.js" ]

