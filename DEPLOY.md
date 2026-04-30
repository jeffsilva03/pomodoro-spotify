# Deploy gratuito do FOCO!

Este guia usa Render Free para rodar o Flask e Neon Free para salvar os dados em Postgres.

## 1. Preparar o GitHub

1. Crie uma conta em https://github.com, se ainda nao tiver.
2. Crie um repositorio novo, por exemplo `foco`.
3. Envie este projeto para esse repositorio.
4. Confirme que o arquivo `.env` nao foi enviado. Ele guarda chaves privadas e deve ficar so no seu computador.

## 2. Criar o banco no Neon

1. Acesse https://neon.tech.
2. Entre com GitHub ou email.
3. Clique em `New Project`.
4. Escolha um nome, por exemplo `foco`.
5. Escolha a regiao mais proxima disponivel.
6. Crie o projeto.
7. Na tela do projeto, copie a connection string do banco.
8. Use a string no formato com `sslmode=require`, parecida com:

```text
postgresql://usuario:senha@host.neon.tech/nome_do_banco?sslmode=require
```

Voce vai colar essa string no Render como `DATABASE_URL`.

## 3. Criar o Web Service no Render

1. Acesse https://render.com.
2. Entre com GitHub.
3. Clique em `New`.
4. Clique em `Web Service`.
5. Conecte o repositorio do projeto.
6. Configure:

```text
Name: foco
Runtime: Python
Branch: main
Build Command: pip install -r requirements.txt
Start Command: gunicorn app:app
Instance Type: Free
```

7. Antes de finalizar, abra a area `Environment Variables`.

## 4. Variaveis de ambiente no Render

Cadastre estas variaveis:

```text
SECRET_KEY=uma_frase_grande_e_aleatoria
DATABASE_URL=sua_connection_string_do_neon
JAMENDO_CLIENT_ID=sua_chave_do_jamendo
SPOTIFY_CLIENT_ID=seu_client_id_spotify
SPOTIFY_CLIENT_SECRET=seu_client_secret_spotify
SPOTIFY_REDIRECT_URI=https://NOME-DO-SEU-SERVICO.onrender.com/callback
APP_TIMEZONE=America/Sao_Paulo
```

Troque `NOME-DO-SEU-SERVICO` pelo nome que o Render mostrar na URL final.

## 5. Ajustar o callback no Spotify

1. Acesse https://developer.spotify.com/dashboard.
2. Abra o app do Spotify usado neste projeto.
3. Entre em `Settings`.
4. Em `Redirect URIs`, adicione:

```text
https://NOME-DO-SEU-SERVICO.onrender.com/callback
```

5. Salve.

O valor precisa ser exatamente igual ao `SPOTIFY_REDIRECT_URI` do Render.

## 6. Fazer o primeiro deploy

1. No Render, clique em `Create Web Service`.
2. Aguarde o build terminar.
3. Quando aparecer `Live`, abra a URL do Render.
4. Crie uma conta no FOCO!.
5. Teste:
   - timer
   - Jamendo
   - estatisticas
   - missoes
   - login/logout
   - conectar Spotify, se quiser usar Spotify

## 7. Limites importantes do plano gratis

- O Render Free dorme apos um tempo sem acesso.
- O primeiro acesso depois disso pode demorar cerca de 1 minuto.
- O SQLite nao deve ser usado no Render Free, porque arquivos locais podem sumir.
- O banco do Neon Free e suficiente para prototipo, portfolio e uso pequeno.

## 8. Quando atualizar o site

Depois que o projeto estiver no GitHub:

1. Edite o projeto aqui no computador.
2. Envie as alteracoes para o GitHub.
3. O Render vai fazer deploy automatico.

