// Textos de la interficie del mini-app "Viatge a Lituania".
//
// Per afegir un idioma: copia el bloc "ca", tradueix-lo amb la mateixa clau
// ("lt", "en") i posa lang="lt" a l'<html> de la pagina corresponent. Els textos
// dels punts viuen a data/punts.json, amb la mateixa estructura { ca, lt, en }.
// Si falta una traduccio, es mostra el catala. Els textos fixos de la pagina
// (titol, botons de mode...) son a l'HTML, com a la resta de la web: cada
// idioma tindra el seu index.html.

window.VL_I18N = {
  ca: {
    mapaEtiqueta: "Mapa interactiu de Lituània",
    introText: "Sortim de Lleida i volem cap al nord-est d'Europa: uns 2.300 km en línia recta fins a Vílnius.",
    introLleida: "Lleida",
    pantallaCompleta: "Pantalla completa",
    surtPantallaCompleta: "Surt de la pantalla completa",
    compte: (n) => (n === 1 ? "1 punt" : `${n} punts`),
    capPunt: "No hi ha cap punt amb aquests filtres. Activa alguna categoria.",
    benvingudaTitol: "Tria un punt",
    benvingudaText: "Fes clic en un punt del mapa o tria'l de la llista per veure'n la fitxa. Pots filtrar per categoria o començar el recorregut guiat.",
    benvingudaRecorregut: "Comença el recorregut",
    tanca: "Tanca la fitxa",
    data: "Data",
    dataMobil: "Data variable",
    orientativa: "Ubicació orientativa: és una tradició o un plat de tot el país.",
    foto: "Foto",
    senseFoto: "Encara no hi ha foto per a aquest punt.",
    parada: (i, n) => `Parada ${i} de ${n}`,
    anterior: "Anterior",
    seguent: "Següent",
    finalTitol: "Final del viatge!",
    tornaComencar: "Torna a començar",
    teclesRecorregut: "Fes servir les fletxes ← → del teclat (o el comandament de la presentació) per canviar de parada.",
    errorMapa: "No s'ha pogut carregar el mapa. Comprova la connexió a internet: la llista de punts i les fitxes continuen funcionant.",
    errorDades: "No s'han pogut carregar els punts del mapa. Torna-ho a provar més tard.",
  },
};
