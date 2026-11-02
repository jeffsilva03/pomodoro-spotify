# Auditoria de portfólio — FOCO!

Revisão em 02/11/2026. Base: `da027d7cd81b39ab57dc8181822029e5d9085049`.

Foram inventariados os arquivos atuais e o histórico alcançável pelas referências disponíveis no clone: 20 objetos Git e 14 versões de arquivos de texto próprios. A busca incluiu padrões de tokens, chaves privadas, URLs de conexão, configurações de segredo, e-mails e hashes de senha. Valores sensíveis não foram reproduzidos neste documento.

A revisão não abrange segredos da hospedagem, bancos pessoais, logs externos, caches, releases ou forks, nem equivale a um pentest. Não houve alteração de visibilidade ou reescrita do histórico. As ilustrações do README representam fluxos e não usam contas ou bancos pessoais.

## Dados e arquivos

- Não foram detectados bancos, tokens reais, chaves de provedor ou cadastros pessoais nos arquivos e histórico disponíveis. Os valores de `.env.example`, do README anterior e de `DEPLOY.md` eram exemplos ou placeholders.
- Removido `features.txt`, que continha somente linhas vazias e separadores.
- `.gitignore` ampliado para `.env.*` com exceção de `.env.example`, `.venv/` e logs. Banco SQLite, `instance/`, ambiente virtual e cache já eram ignorados.
- README adaptado ao modelo StoreAPI, com quatro SVGs nos temas claro/escuro. A documentação anterior não foi copiada para criar uma segunda versão redundante; `DEPLOY.md` foi preservado.

## Limitações de segurança observadas

O servidor usa segredo padrão de desenvolvimento se o ambiente estiver vazio e habilita debug em `python app.py`. Os tokens Spotify são campos do banco e não recebem cifra adicional da aplicação. Não foi identificada proteção CSRF explícita; a validação de configurações também precisa ser reforçada.

Essas observações não indicam vazamento de credenciais reais neste repositório. Antes de hospedar, configure segredos próprios e revise sessão, transporte, retenção e acesso ao banco. OAuth e reprodução não foram exercitados com contas reais.

## Referências externas conferidas

O README usa a documentação oficial do Spotify para os requisitos do Web Playback SDK e do callback local:

- [Web Playback SDK — início](https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started)
- [Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)

Preços e ofertas de Render, Neon ou Jamendo não foram conferidos. `DEPLOY.md` é um guia anterior, não uma garantia de disponibilidade ou gratuidade dos serviços.
