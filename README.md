# FOCO! — Pomodoro + Spotify

Aplicação de produtividade que integra timer Pomodoro com player Spotify.

---

## Pré-requisitos

- Python 3.9+
- Conta Spotify **Premium** para usar o Web Playback SDK
- Client ID gratuito do Jamendo para o player alternativo
- Credenciais do Spotify Developer, se quiser conectar Spotify

---

## 1. Configurar o Spotify Developer

1. Acesse https://developer.spotify.com/dashboard
2. Clique em **Create App**
3. Preencha:
   - App name: `FOCO!`
   - Redirect URI: `http://localhost:5000/callback`
   - Marque: **Web API** e **Web Playback SDK**
4. Copie o **Client ID** e **Client Secret**

---

## 2. Instalar e configurar

```bash
# Clone / extraia o projeto e entre na pasta
cd pomodoro-spotify

# Crie o ambiente virtual
python -m venv venv
source venv/bin/activate        # Linux/Mac
venv\Scripts\activate           # Windows

# Instale as dependências
pip install -r requirements.txt

# Configure as variáveis de ambiente
cp .env.example .env
```

Edite o arquivo `.env`:

```env
SECRET_KEY=uma-chave-secreta-longa-e-aleatoria
SPOTIFY_CLIENT_ID=seu_client_id_aqui
SPOTIFY_CLIENT_SECRET=seu_client_secret_aqui
SPOTIFY_REDIRECT_URI=http://localhost:5000/callback
JAMENDO_CLIENT_ID=seu_client_id_jamendo
```

---

## 3. Rodar

```bash
python app.py
```

Acesse: **http://localhost:5000**

---

## Fluxo de uso

1. Crie uma conta (email + senha)
2. Clique em **Conectar Spotify** — autorize o acesso
3. Configure o tempo de foco/pausa no painel **Timer**
4. Escolha uma playlist no painel **Música**
5. Clique **Iniciar** — o timer e a música rodam juntos
6. Na pausa, a música pausa automaticamente (configurável)
7. Veja seu progresso no painel **Estatísticas**

---

## Estrutura do projeto

```
pomodoro-spotify/
├── app.py                  # Backend Flask (rotas, auth, API)
├── requirements.txt
├── .env.example
├── templates/
│   ├── base.html
│   ├── login.html
│   ├── register.html
│   └── app.html            # Interface principal
└── static/
    ├── css/main.css         # Estilos (tema escuro)
    └── js/app.js            # Timer + Spotify SDK
```

---

## Notas técnicas

- **Tokens Spotify**: expiram a cada 1h. O sistema faz refresh automático via `/api/spotify/token`.
- **Web Playback SDK**: roda 100% no browser. O backend apenas gerencia tokens.
- **Banco de dados**: SQLite por padrão. Para produção, configure `DATABASE_URL` com PostgreSQL.
- **Spotify Premium**: o Web Playback SDK continua exigindo Premium.
- **Jamendo**: funciona como alternativa gratuita, mas exige um Client ID proprio do Jamendo.

---

## Para produção

- Troque `SECRET_KEY` por uma chave criptograficamente segura
- Configure `DATABASE_URL` para PostgreSQL
- Use `gunicorn app:app` ao invés de `python app.py`
- Ative HTTPS e atualize o `SPOTIFY_REDIRECT_URI`
