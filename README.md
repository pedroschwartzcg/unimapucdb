# UniMap UCDB

Mapa do campus (Leaflet + OpenStreetMap) com banco no Supabase. Alunos sugerem locais; o dev aprova no painel.

## Arquivos
| Arquivo | Função |
|---|---|
| `index.html` | Mapa público: busca, "Como chegar", sugestão de local |
| `admin.html` | Painel do dev (login Google): aprovar, renomear, excluir, arrastar pinos, importar JSON |
| `lib.js` | Funções puras compartilhadas (escape, busca, validação, importação). **É o que os testes cobrem** |
| `config.js` | URL e chave `anon` do Supabase + e-mail do dev |
| `schema.sql` | Tabela, RLS e policies (a segurança real está aqui) |
| `test/lib.test.js` | Testes unitários |

## Configuração
1. Supabase: crie o projeto, copie URL e chave `anon` (Settings > API) para `config.js`.
2. Em `schema.sql`, troque `seu.email@gmail.com` pelo seu Gmail e rode no SQL Editor. Use o mesmo e-mail em `DEV_EMAIL`.
3. Authentication > Providers: ative Google e inclua a URL do `admin.html` em Redirect URLs.
4. Publique os arquivos juntos (GitHub Pages, Netlify, etc.).

## Desenvolvimento
```
npm test        # roda os testes (Node 18+, sem dependências)
npm start       # servidor local em http://localhost:3000 (usa npx serve)
```
Formato do JSON de importação: `[{"name":"Bloco A","cat":"Bloco","lat":-20.4065,"lng":-54.6169}]`
(`cat`, `w` e `h` são opcionais; itens inválidos são ignorados e listados no aviso).

## Regra de ouro
Lógica nova que não depende de tela vai em `lib.js` com teste em `test/`; as páginas só ligam a interface.
