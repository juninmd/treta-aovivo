/**
 * Fictional debate used by the README screenshots: invented city, people and
 * sources (.example domains, RFC 2606), so no real person is scored.
 */
import type { FallacyKind, SearchResult, Verdict } from "../../src/core/types";

export interface Line {
  speaker: number;
  start: number;
  end: number;
  text: string;
  /** Two voices at once: the turn is shown as doubtful and does not score. */
  overlap?: boolean;
}

export const NAMES = ["Marta", "Helena", "Rafael"];
export const PARTICIPANTS = "Helena Prado; Rafael Teixeira; Marta Lins";

export const LINES: Line[] = [
  { speaker: 0, start: 2, end: 14, text: "Boa noite. Começa agora o debate para a prefeitura de Vila Aurora. Eu sou Marta Lins e vou mediar. Candidata Helena Prado, a primeira pergunta é sua." },
  { speaker: 1, start: 15, end: 41, text: "Boa noite, Marta. Rafael, a tarifa de ônibus subiu 30% em dois anos enquanto você era secretário de Mobilidade. Quem paga essa conta é o trabalhador que pega dois ônibus por dia." },
  { speaker: 2, start: 42, end: 80, text: "Boa noite. Helena, você nunca administrou nem uma padaria e quer dar aula de gestão? A tarifa subiu porque o diesel subiu. E mesmo assim nós entregamos doze unidades básicas de saúde em quatro anos." },
  { speaker: 0, start: 81, end: 86, text: "Tempo, candidato. Réplica da candidata Helena, um minuto." },
  { speaker: 1, start: 87, end: 118, text: "O desemprego em Vila Aurora é o maior da região, 14%. E o candidato fala de padaria porque não tem resposta para quem perdeu o emprego." },
  { speaker: 2, start: 119, end: 150, text: "Ou a cidade aprova o meu plano de concessões agora, ou Vila Aurora vai falir no ano que vem. Não existe terceira via." },
  { speaker: 0, start: 151, end: 158, text: "Próximo bloco: saúde. Candidato Rafael, a pergunta é sua." },
  { speaker: 2, start: 159, end: 190, text: "Helena, o seu partido votou contra o novo hospital municipal na Câmara. Como explicar isso para quem espera na fila?" },
  { speaker: 1, start: 191, end: 230, text: "Votamos contra a emenda que tirava dinheiro da atenção básica, e o hospital foi aprovado com os nossos votos. A fila de cirurgias eletivas tem hoje 3.200 pessoas, segundo a própria secretaria." },
  { speaker: 2, start: 231, end: 236, text: "Deixa eu terminar, Rafael. Você teve o seu tempo.", overlap: true },
  { speaker: 0, start: 237, end: 243, text: "Candidatos, um de cada vez, por favor. Candidato Rafael, réplica." },
  { speaker: 2, start: 244, end: 275, text: "Quem tem medo de concessão é quem vive de cargo público há vinte anos. A arrecadação da cidade cresceu 11% no ano passado." },
  { speaker: 1, start: 276, end: 300, text: "Arrecadação crescendo e tarifa subindo: a conta não fecha para quem mora na periferia." },
  { speaker: 0, start: 301, end: 309, text: "Obrigada, candidatos. Encerramos o primeiro bloco." },
];

export interface ClaimFixture {
  quote: string;
  query: string;
  verdict: Verdict;
  explanation: string;
  confidence: number;
  results: SearchResult[];
}

const gov = (path: string, title: string, snippet: string): SearchResult => ({ url: `https://transparencia.vilaaurora.example/${path}`, title, snippet });
const news = (path: string, title: string, snippet: string): SearchResult => ({ url: `https://diariodevilaaurora.example/${path}`, title, snippet });

export const CLAIMS: ClaimFixture[] = [
  {
    quote: "a tarifa de ônibus subiu 30% em dois anos",
    query: "reajuste tarifa ônibus Vila Aurora 2024 2026",
    verdict: "impreciso",
    explanation: "O portal da prefeitura registra reajustes de 9% e 8% no período, cerca de 18% acumulados, não 30%.",
    confidence: 0.8,
    results: [
      gov("mobilidade/tarifas", "Tarifas do transporte coletivo: histórico de reajustes", "Reajuste de 9% em 2025 e de 8% em 2026; tarifa atual de R$ 5,30."),
      news("cidade/tarifa-onibus-sobe-8", "Tarifa de ônibus sobe 8% e chega a R$ 5,30", "É o segundo reajuste em dois anos; somados, os aumentos passam de 17%."),
    ],
  },
  {
    quote: "nós entregamos doze unidades básicas de saúde em quatro anos",
    query: "unidades básicas de saúde inauguradas Vila Aurora 2023 2026",
    verdict: "verdadeiro",
    explanation: "O relatório da Secretaria de Saúde lista 12 UBS inauguradas entre 2023 e 2026.",
    confidence: 0.85,
    results: [gov("saude/ubs", "Relatório de gestão da Saúde 2023–2026", "Foram inauguradas 12 unidades básicas de saúde no período.")],
  },
  {
    quote: "O desemprego em Vila Aurora é o maior da região, 14%",
    query: "taxa de desemprego Vila Aurora região 2026",
    verdict: "falso",
    explanation: "A pesquisa regional mais recente aponta 8,1% em Vila Aurora, abaixo de duas cidades vizinhas.",
    confidence: 0.9,
    results: [
      gov("trabalho/pesquisa-regional", "Pesquisa regional de emprego — 2º trimestre de 2026", "Vila Aurora: 8,1%. Porto Claro: 9,4%. Serra Alta: 10,2%."),
      news("economia/desemprego-cai", "Desemprego cai pelo terceiro trimestre seguido", "Taxa da cidade ficou em 8,1%, a terceira menor da região."),
    ],
  },
  {
    quote: "o seu partido votou contra o novo hospital municipal na Câmara",
    query: "votação hospital municipal Câmara Vila Aurora partido",
    verdict: "enganoso",
    explanation: "A ata mostra voto contrário a uma emenda de financiamento, não ao projeto do hospital, que o partido aprovou.",
    confidence: 0.75,
    results: [
      gov("camara/atas/2025-05-14", "Ata da sessão de 14/05/2025 — Hospital municipal", "Projeto aprovado por 17 a 2; emenda 3 rejeitada com votos da bancada da candidata."),
      news("politica/hospital-aprovado", "Câmara aprova hospital municipal", "Oposição votou a favor do projeto e contra a emenda que remanejava verba da atenção básica."),
    ],
  },
  {
    quote: "A fila de cirurgias eletivas tem hoje 3.200 pessoas",
    query: "fila cirurgias eletivas Vila Aurora secretaria 2026",
    verdict: "verdadeiro",
    explanation: "O painel da Secretaria de Saúde informa 3.214 pacientes na fila de cirurgias eletivas.",
    confidence: 0.8,
    results: [gov("saude/painel-filas", "Painel de filas da Saúde", "Cirurgias eletivas: 3.214 pacientes aguardando; tempo médio de 7 meses.")],
  },
  {
    quote: "A arrecadação da cidade cresceu 11% no ano passado",
    query: "arrecadação Vila Aurora 2025 crescimento",
    verdict: "sem evidência",
    explanation: "Os resultados trazem a arrecadação de 2025, mas sem a comparação anual; não dá para confirmar os 11%.",
    confidence: 0.4,
    results: [gov("financas/receitas-2025", "Receitas municipais 2025", "Receita corrente líquida de R$ 1,9 bilhão em 2025.")],
  },
];

export interface FallacyFixture {
  kind: FallacyKind;
  quote: string;
  explanation: string;
}

export const FALLACIES: FallacyFixture[] = [
  { kind: "ad hominem", quote: "você nunca administrou nem uma padaria e quer dar aula de gestão", explanation: "Ataca a experiência pessoal da adversária em vez de responder sobre a tarifa." },
  { kind: "falso dilema", quote: "Ou a cidade aprova o meu plano de concessões agora, ou Vila Aurora vai falir no ano que vem", explanation: "Apresenta só duas saídas e ignora alternativas, como renegociar contratos." },
  { kind: "ad hominem", quote: "Quem tem medo de concessão é quem vive de cargo público há vinte anos", explanation: "Desqualifica a trajetória da adversária em vez de discutir as concessões." },
];

export const SUMMARY = {
  resumo:
    "O primeiro bloco girou em torno da tarifa de ônibus, do desemprego e da saúde. Helena acertou o tamanho da fila de cirurgias, mas errou o desemprego. Rafael comprovou as novas UBS, porém recorreu a ataques pessoais e a um falso dilema sobre as concessões.",
  momentoMaisQuente: "A troca sobre o hospital municipal, quando os dois falaram ao mesmo tempo e a mediadora pediu ordem.",
};
