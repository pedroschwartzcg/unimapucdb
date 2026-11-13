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
| `supabase/migrations/20261113000000_add_submission_media.sql` | Migração aditiva para descrição, fotos privadas e estado de rejeição. Deve ser revisada e executada manualmente. |
| `test/lib.test.js` | Testes unitários das funções compartilhadas. |

## Configuração do Supabase

1. Confira em `config.js` a URL do projeto, a chave publicável (anon) e o e-mail do administrador. A chave publicável pode estar no front-end; nunca coloque a `service_role` no site.
2. Confirme que o administrador tem uma conta no Supabase Auth com senha. `admin.html` usa e-mail e senha; `CFG.DEV_EMAIL` e a função `public.is_dev()` devem corresponder ao e-mail dessa conta.
3. Revise e execute manualmente a migração `supabase/migrations/20261113000000_add_submission_media.sql` no SQL Editor. Ela acrescenta colunas à tabela existente, cria o bucket privado `place-images` se não existir e adiciona policies de Storage com nomes novos. Ela não executa nenhuma operação de deploy.
4. Se o bucket `place-images` já existia, a migração preserva sua configuração. Confira manualmente se ele está privado, aceita somente `image/jpeg`, `image/png` e `image/webp`, e limita uploads a 5 MiB. Ajuste-o no painel do Storage se necessário.
5. Mantenha as policies de `public.places` existentes. A leitura pública deve continuar restrita aos registros aprovados; a policy de inserção de alunos precisa permitir `approved = false`, `autor = 'aluno'` e `cat = 'Sugestão'`, como no esquema deste projeto.

O bucket é privado. O site só gera URLs temporárias para imagens aprovadas; o administrador autenticado pode revisar fotos pendentes. A validação de tamanho e formato também é configurada no bucket, além da validação no navegador.

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
