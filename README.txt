UNIMAP — PROJETO FRONT-END

ESTRUTURA
- index.html: estrutura da interface.
- style.css: estilos e responsividade.
- script.js: dados dos locais e funcionalidades.
- campus-map.svg: planta esquemática de demonstração.

IMPORTANTE
Este protótipo foi pensado para os estudantes apenas CONSULTAREM o mapa.
Não há upload de planta nem cadastro de locais pela interface pública.

CONFIGURAÇÃO PELA EQUIPE DE DESENVOLVIMENTO
1. Substitua campus-map.svg pela planta oficial, mantendo o nome ou alterando o caminho em script.js.
2. Em script.js, edite campusConfig.campusName.
3. Configure campusConfig.floors com os pavimentos reais e o arquivo de planta correspondente.
4. Cadastre os locais em campusConfig.locations.
5. Para cada local, defina:
   id: identificador único;
   name: nome exibido;
   code: código curto do marcador (ex.: B204);
   category: categoria;
   floor: id do pavimento;
   x e y: posição percentual na planta (0 a 100);
   icon: símbolo;
   description: descrição curta.

COORDENADAS
x=0 é a borda esquerda; x=100 é a borda direita.
y=0 é a borda superior; y=100 é a borda inferior.
Ajuste os percentuais visualmente para cada planta.

EXECUÇÃO
Abra index.html em um navegador. Para desenvolvimento, recomenda-se usar a extensão Live Server do VS Code.
Os locais de exemplo e a planta esquemática são fictícios; substitua-os pelos dados oficiais da universidade.

LIMITAÇÃO ATUAL
A interface permite pesquisar e localizar espaços por pavimento. O botão "Como chegar" marca o destino, mas não calcula rotas reais por corredores. Para isso, será necessário cadastrar a rede de circulação (corredores, portas, escadas, elevadores e conexões entre andares) e implementar um algoritmo de caminho, como A*.
