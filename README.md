# UniMap UCDB — manual do administrador

Mapa do campus feito com Leaflet e OpenStreetMap, com dados no Supabase. O painel administrativo preserva o fluxo existente de autenticação, edição e importação. Sugestões dos alunos ficam ocultas do público até serem aprovadas.

## Arquivos principais

| Arquivo | Função |
|---|---|
| `index.html` | Mapa público, busca, envio de sugestões, fotos e localização do aluno. |
| `admin.html` | Painel de revisão, aprovação/rejeição, edição, ajuste dos pinos e importação JSON. |
| `lib.js` | Busca, escape de HTML, importação e validação compartilhada. |
| `config.js` | URL/chave publicável do Supabase e e-mail de administrador. |
| `schema.sql` | Esquema inicial e policies existentes. Não reaplique sobre uma instalação em uso: o arquivo original remove e recria policies nomeadas. |
| `supabase/migrations/20261113000000_add_submission_media.sql` | Migração aditiva para tabela complementar, rate limit e policies do bucket. Não altera `places`; revise e execute manualmente. |
| `supabase/functions/submit-place-suggestion/` | Valida, limita e grava sugestões usando segredos server-side; remove uploads quando a gravação falha. |
| `supabase/functions/cleanup-orphaned-place-image/` | Retry seguro para remover somente fotos recentes sem referência. |
| `supabase/functions/_shared/submission.mjs` | Helpers empacotados junto às funções para validar e limitar o corpo, e assinar a autorização temporária de limpeza. |
| `test/lib.test.js` | Testes unitários das funções compartilhadas. |

## Configuração do Supabase

1. Confira em `config.js` a URL do projeto, a chave publicável (anon) e o e-mail do administrador. A chave publicável pode estar no front-end; nunca coloque a `service_role` no site.
2. Confirme que o administrador tem uma conta no Supabase Auth com senha. `admin.html` usa e-mail e senha; `CFG.DEV_EMAIL` e a função `public.is_dev()` devem corresponder ao e-mail dessa conta.
3. Revise e execute manualmente a migração `supabase/migrations/20261113000000_add_submission_media.sql` no SQL Editor. Ela cria tabelas complementares para descrição/foto/rejeição e limite por IP, cria o bucket privado se não existir e acrescenta policies. **Não altera `public.places` nem remove policies existentes.**
4. Se `place-images` já existia, a migração preserva sua configuração. Confirme que está privado, aceita apenas `image/jpeg`, `image/png` e `image/webp`, e limita uploads a 5 MiB. Confirme também que o administrador autenticado corresponde a `public.is_dev()`.
5. Publique as duas Edge Functions após revisar o código: `supabase functions deploy submit-place-suggestion` e `supabase functions deploy cleanup-orphaned-place-image`. O `supabase/config.toml` desativa a validação JWT do gateway; o envio é protegido por validação, assinatura binária e limite de requisição efetivamente lido de 5 MiB + 64 KiB. A limpeza exige um token HMAC de uso restrito ao caminho e válido por 30 minutos, assinado pelo endpoint de envio. CORS/Origin não autorizam a limpeza. A `service_role` fica somente no servidor.
6. Configure `RATE_LIMIT_SALT` e `CLEANUP_TOKEN_SECRET` com valores aleatórios independentes de pelo menos 32 bytes. Mantenha `UNIMAP_ALLOWED_ORIGINS` alinhado ao domínio Netlify e, em desenvolvimento, `http://localhost:3000`. O runtime também precisa fornecer `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` às funções. Nunca coloque esses segredos em `config.js`. A política restritiva de Storage bloqueia upload direto por clientes anônimos; o endpoint server-side faz os uploads.
7. Mantenha as policies existentes de `public.places`. A leitura pública continua filtrada por `approved`; a policy existente de sugestão permanece intacta. As funções criam o registro pendente por meio da credencial server-side e também criam a linha correspondente em `place_submission_details`.

O bucket é privado. O público só recebe URLs temporárias de imagens ligadas a locais aprovados; o administrador autenticado pode revisar fotos pendentes. Tamanho e MIME são checados no navegador, na assinatura binária da Edge Function, nos metadados `storage.objects` e pelos limites do bucket. O limite atual é por IP e pode agrupar vários alunos que usem a mesma rede. Para exposição pública maior, acrescente Turnstile como barreira contra bots e reveja o limite para redes compartilhadas.

## Acesso administrativo

1. Abra `admin.html` no domínio publicado e entre com o e-mail e a senha cadastrados no Supabase Auth.
2. Confira a imagem, o nome, a descrição e as coordenadas de cada sugestão. Use **Ver no mapa** para centralizar o ponto.
3. Use **Aprovar** para publicar o local e sua foto. Use **Rejeitar** para manter o registro no banco, oculto do mapa público. Rejeitados podem ser reabertos para análise.
4. As ações existentes de renomear, excluir, arrastar pinos e importar JSON permanecem disponíveis. Excluir continua sendo uma ação separada de rejeitar.

## Publicação no Netlify

O site é estático. Para publicação manual, use a raiz do repositório como diretório publicado e deixe o comando de build vazio. `index.html`, `admin.html`, `config.js`, `lib.js` e `campus-map.svg` devem permanecer acessíveis na raiz. A autenticação e o Storage precisam estar configurados no Supabase antes de testar o fluxo. Não é necessário executar build nem migrar os arquivos legados `script.js` e `style.css` para esta implementação.

## Desenvolvimento e verificação

Requer Node.js 18 ou superior.

```sh
npm test
npm start
```

`npm start` serve os arquivos estáticos em `http://localhost:3000`. A geolocalização funciona em contexto seguro (HTTPS; `localhost` também é aceito pelo navegador).

Formato de importação JSON:

```json
[{"name":"Bloco A","cat":"Bloco","lat":-20.4065,"lng":-54.6169}]
```

## Observação sobre arquivos legados

`script.js`, `style.css` e `campus-map.svg` vieram de uma versão demonstrativa estática e não são carregados pela página Leaflet atual. O guia dos alunos fica em `README.txt`.
