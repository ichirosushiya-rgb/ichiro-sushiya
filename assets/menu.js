// Carta de Ichiro Sushiya — sacada del diseño de Canva.
// Para cambiar precios o platos, se edita solo este archivo y se actualizan los dos prototipos.
window.ICHIRO = {
  whatsapp: "5492215566644",
  whatsappLabel: "+54 9 221 556-6644",
  instagram: "ichirosushiya",
  horarios: [
    { dia: "Lunes a viernes", detalle: "Mediodías de 12:00 a 14:30 hs · solo pokes" },
    { dia: "Sábados y domingos", detalle: "A la noche · encargues de sushi y más" },
  ],
  aviso: "Pedidos con anticipación, reservas limitadas",
  categorias: [
    {
      id: "sashimi", nombre: "Sashimi", jp: "刺身",
      items: [
        { n: "Salmón", d: "Corte de salmón fresco (x4)", p: 7500 },
        { n: "Trucha", d: "Corte de trucha fresca (x4)", p: 5500 },
      ],
    },
    {
      id: "nigiri", nombre: "Nigiri", jp: "握り",
      items: [
        { n: "Salmón", d: "Arroz, corte de salmón (x5)", p: 18500 },
        { n: "Salmón flambeado", d: "Arroz, corte de salmón flambeado (x5)", p: 20000 },
        { n: "Tamago", d: "Arroz, corte de tamagoyaki (omelette de huevo al estilo japonés), nori", p: 9500 },
        { n: "Trucha", d: "Arroz, corte de trucha (x5)", p: 13750 },
      ],
    },
    {
      id: "especial", nombre: "Especial", jp: "特製",
      items: [
        { n: "Geisha", d: "Corte de salmón, relleno de cream cheese, palta (x5)", p: 18500 },
      ],
    },
    {
      id: "maki", nombre: "Maki", jp: "巻き",
      items: [
        { n: "Geisha", d: "Corte de salmón, relleno de cream cheese, palta (x5)", p: 18500 },
      ],
    },
    {
      id: "rolls", nombre: "Rolls", jp: "ロール",
      items: [
        { n: "California", d: "Kanikama, palta, pepino (x4)", p: 8500 },
        { n: "New York", d: "Salmón, palta (x4)", p: 12200 },
        { n: "Philadelphia", d: "Salmón, palta, queso philadelphia (x4)", p: 12200 },
        { n: "Tijuana", d: "Salmón, guacamole, batata frita (x4)", p: 19100 },
        { n: "Tuna", d: "Atún cocido, mayonesa, cebolla de verdeo (x4)", p: 10200 },
        { n: "Yasai", d: "Shiitake, zanahoria, cream cheese (x4)", p: 7500 },
        { n: "Okayama", d: "Salmón por fuera y dentro, pepino, palta (x4)", p: 10200 },
        { n: "Niigata", d: "Salmón por fuera, pepino, palta, cream cheese (x4)", p: 10200 },
      ],
    },
    {
      id: "combinados", nombre: "Combinados", jp: "盛り合わせ",
      items: [
        { n: "15 pzs mixto", d: "3 maki, 8 rolls, 4 nigiri", p: 32500 },
        { n: "15 pzs salmón", d: "3 maki, 8 rolls, 4 nigiri", p: 39500 },
        { n: "30 pzs mixto", d: "6 maki, 16 rolls, 8 nigiri", p: 63000 },
        { n: "30 pzs salmón", d: "6 maki, 16 rolls, 8 nigiri", p: 70500 },
        { n: "45 pzs mixto", d: "6 maki, 24 rolls, 10 nigiri, 5 sashimi", p: 89000 },
        { n: "45 pzs salmón", d: "6 maki, 24 rolls, 10 nigiri, 5 sashimi", p: 105000 },
      ],
    },
  ],
};

window.precio = (p) => "$" + p.toLocaleString("es-AR");
