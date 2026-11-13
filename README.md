# UniMap UCDB — manual do administrador

Mapa do campus feito com Leaflet e OpenStreetMap, com dados no Supabase. O painel administrativo preserva o fluxo de autenticação, edição e importação. Sugestões e fotos ficam ocultas do público até a aprovação.

## Configuração local

Requer Node.js 18 ou superior. Em `config.js`, configure a URL do projeto Supabase, a chave publicável (anon) e o e-mail usado pelo administrador. A chave publicável é própria para o frontend com RLS habilitada; nunca coloque uma chave `service_role` ou secret nesse arquivo.

```sh
npm ci
npm test
npm start
```

`npm start` serve a página em `http://localhost:3000`. Para testar as Edge Functions localmente, instale Deno, Supabase CLI e Docker e use `supabase functions serve`. Os testes unitários e `deno check` não precisam de secrets nem de uma conexão com o projeto Supabase.

## Configuração do Supabase

A migração `supabase/migrations/20261113000000_add_submission_media.sql` é aditiva: cria tabelas complementares, bucket se ausente e policies adicionais; não altera a tabela `places` nem remove policies existentes. Revise-a e aplique manualmente em um projeto de teste antes de planejar produção. Ela não foi executada nesta revisão.

O bucket `place-images` deve permanecer privado e aceitar apenas JPEG, PNG e WebP, até 5 MiB. Se o bucket já existir, a migração preserva as configurações existentes; confira-as no painel. As policies filtram as fotos pendentes para o administrador e a leitura pública para locais aprovados. Mantenha as policies atuais de `public.places`; a função de envio cria registros pendentes usando credenciais apenas do servidor.

## Configuração do administrador

Crie a conta administrativa no Supabase Auth e use e-mail e senha no `admin.html`. O e-mail da conta deve corresponder a `CFG.DEV_EMAIL` e ao resultado de `public.is_dev()`. A verificação no navegador controla a interface; a autorização real para ler pendências e administrar dados depende de RLS e Storage policies.

No painel, confira nome, descrição, foto e coordenadas antes da decisão. **Aprovar** publica o local; **Rejeitar** mantém a sugestão oculta e marcada como rejeitada; **Reabrir análise** a retorna ao estado pendente. Renomear, mover pinos, excluir e importar locais continuam disponíveis. Se excluir o registro funcionar e a remoção da foto falhar, o painel informa que o arquivo precisa ser revisado no Storage.

## Secrets das Edge Functions

O runtime do Supabase fornece `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Configure também os valores abaixo no painel de secrets das Edge Functions ou no ambiente local. Não grave valores reais no repositório:

| Nome | Uso |
|---|---|
| `RATE_LIMIT_SALT` | Salt aleatório, com pelo menos 32 bytes, para gerar hashes de IP no limite de envios. |
| `CLEANUP_TOKEN_SECRET` | Segredo aleatório independente, com pelo menos 32 bytes, para assinar tokens de limpeza válidos por 30 minutos e vinculados a um único caminho. |
| `UNIMAP_ALLOWED_ORIGINS` | Lista separada por vírgulas de origens do site e dos endereços locais de desenvolvimento. É configuração CORS, não autenticação. |

Para desenvolvimento local, use `supabase/functions/.env` e execute `supabase functions serve --env-file supabase/functions/.env`. O arquivo é ignorado pelo Git. Não reutilize os secrets de produção em testes locais. A `service_role` nunca deve ser enviada ao navegador.

O endpoint de envio limita cada corpo a 5 MiB + 64 KiB antes de interpretar multipart e aplica até 20 envios por IP/hash por hora. A limpeza exige um token HMAC temporário emitido pelo servidor; Origin/CORS não autorizam essa ação. O bucket também deve impor limites de tipo e tamanho. Para maior exposição, adicione uma barreira contra bots e monitore o limite por rede compartilhada.

## Deploy futuro

O deploy não faz parte da validação local. Após revisar e testar as mudanças em um projeto Supabase separado, aplique migrações manualmente e publique as funções:

```sh
supabase functions deploy submit-place-suggestion
supabase functions deploy cleanup-orphaned-place-image
```

Depois, publique o site estático no Netlify pela raiz do repositório, sem comando de build. Confirme que `index.html`, `admin.html`, `config.js` e `lib.js` estão disponíveis. Não coloque credenciais secretas nos arquivos publicados.

## Procedimentos de teste

```sh
npm ci
npm test
deno check --frozen-lockfile supabase/functions/submit-place-suggestion/index.ts supabase/functions/cleanup-orphaned-place-image/index.ts
supabase functions serve
```

`deno check` valida sintaxe, tipos e resolução dos imports. `supabase functions serve` executa as funções no runtime local e requer Docker; use somente secrets e serviços de teste. A CI executa `npm test` e `deno check` em push e pull request para esta branch. Nenhum desses comandos aplica SQL ou publica o site.

Formato do JSON de importação:

```json
[{"name":"Bloco A","cat":"Bloco","lat":-20.4065,"lng":-54.6169}]
```

## Arquivos legados

`script.js`, `style.css` e `campus-map.svg` pertencem a uma demonstração estática antiga e não são carregados pela página Leaflet atual. Não inclua uma planta oficial da UCDB em publicações ou materiais de distribuição. O guia dos alunos fica em `README.txt`.
