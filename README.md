# Web d'ALKA

Web de l'Associacio Lituano-Catalana d'Avancament (alka.cat), en catala,
lituna i angles, amb els formularis d'alta de soci i de voluntariat.

## Que hi ha aqui

    server.js      servidor Node sense dependencies: serveix public/ i rep els formularis
    public/        el lloc web ja generat (27 pagines + imatges)
    Dockerfile     imatge de produccio

## Desplegament

Coolify construeix el Dockerfile i publica el contenidor al port 3000.

Variables d'entorn obligatories:

    NOTION_TOKEN           secret de la integracio de Notion
    NOTION_DB_SOCIS        id de la base "Socis ALKA"
    NOTION_DB_VOLUNTARIS   id de la base "Voluntaris ALKA"
    NOTION_DB_ACTUALITAT   id de la base "Actualitat" (opcional: sense ella /actualitat surt buida)

Sense aquestes variables el web es veu perfectament, pero els formularis
responen amb un missatge d'error i no desen res. Com que aquest repositori
es public, ni el token ni els identificadors de les bases no son al codi.

## Pagina /actualitat

No surt de `public/`: la genera `actualitat.js` (cridat des de `server.js`) llegint de
Notion la base "Actualitat", nomes les files amb Estat = Publicat i sense "Enllac mort".
Aprofita la capcalera i el peu de `public/educacio.html`; si el disseny canvia i no hi
troba les marques, serveix una pagina senzilla. Cache de 15 minuts a memoria. Nomes en
catala: els menus de LT i EN tambe hi apunten. La base ha d'estar compartida amb la
integracio de Notion del `NOTION_TOKEN`. Les entrades les alimenta un flux de n8n.

## D'on surt public/

Les pagines es generen a partir dels fitxers mestres en catala (`*.dc.html`)
del projecte de disseny: primer es tradueixen a lituna i angles i despres es
compilen amb les URL definitives. El contingut generat es puja al repositori
perque Coolify no hagi d'executar cap pas de build.

No editis res dins de `public/` a ma: el proper build ho sobreescriura.

## En local

    node server.js      # http://localhost:3000
